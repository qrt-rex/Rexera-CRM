import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import crypto from 'node:crypto'
import { checkClientEmail, renderClientEmail } from './supabase/functions/_shared/client-email.mjs'
import { aiConfig, aiOverLimit, answerAi, checkAiRequest } from './server/ai.mjs'
import { crmUser, setPassword } from './server/users.mjs'
import { receive as receiveBlutecWebhook } from './server/blutecWebhook.mjs'
import { receiveWebsiteLead, retryWebsiteLead } from './server/websiteLeads.mjs'
import { getSiteContent } from './server/site.mjs'
import { portalAdmin, portalClient } from './server/portal.mjs'
import { checkClientSender, checkOtpRequest, checkResetRequest, escapeHtml } from './server/mailGuard.mjs'
import { createClient } from '@supabase/supabase-js'
import { jobsAuthorized, runJobs } from './server/jobs.mjs'
import { getPublicForm, submitPublicForm } from './server/forms.mjs'
import { submitJobApplication } from './server/apply.mjs'
import { sendFormLink, sendInvoice, sendWelcomeNow } from './server/share.mjs'
import { whatsappConfigured } from './server/whatsapp.mjs'
import { incentiveReport, reportConfig } from './server/incentives.mjs'
import { blutecEnv, handleBlutec } from './supabase/functions/_shared/blutec.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, 'dist')

// -------------------------------------------------------------
// Load environment variables (.env / .env.local fallback with # preservation)
// -------------------------------------------------------------
function readEnvFile(filePath) {
  const result = {}
  if (!fs.existsSync(filePath)) return result
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/)
      if (match) {
        let val = (match[2] || '').trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        result[match[1]] = val
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not parse ${filePath}:`, err.message)
  }
  return result
}

const fileEnv = {
  ...readEnvFile(path.resolve(__dirname, '.env')),
  ...readEnvFile(path.resolve(__dirname, '.env.local')),
}

function getEnv(key, fallback = '') {
  let val = process.env[key] || fileEnv[key] || fallback
  if (typeof val === 'string') {
    val = val.trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
  }
  return val
}

// -------------------------------------------------------------
// Configuration
// -------------------------------------------------------------
const PORT = Number(process.env.PORT || fileEnv.PORT || 5180)
const HOST = '0.0.0.0'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

// -------------------------------------------------------------
// Nodemailer Transporter Helper
// -------------------------------------------------------------
function createMailer() {
  const smtpUser = getEnv('SMTP_USER')
  const smtpPass = getEnv('SMTP_PASS')
  const smtpHost = getEnv('SMTP_HOST', 'smtp.hostinger.com')
  const smtpPort = Number(getEnv('SMTP_PORT', '587'))

  if (!smtpUser || !smtpPass) return null

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
    // the mail server's certificate is checked (the password can't be read on the way); SMTP_TLS_STRICT=false turns
    // the check off for a mail host with a broken certificate
    tls: { rejectUnauthorized: getEnv('SMTP_TLS_STRICT') !== 'false' },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  })
}

async function sendViaResendApi(to, subject, html, extra = {}) {
  const resendKey = getEnv('RESEND_API_KEY') || getEnv('RESEND_KEY')
  if (!resendKey) return null

  const resendFrom = getEnv('RESEND_FROM', 'Rexera CRM <onboarding@resend.dev>')
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [to],
      subject,
      html,
      ...extra,
    }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || 'Resend API error')
  return data
}

// -------------------------------------------------------------
// Request Helpers
// -------------------------------------------------------------
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(data))
}

/** The body exactly as sent (webhook signatures are computed over these bytes). */
function readRawBody(req, limit = 256_000) {
  return new Promise((resolve, reject) => {
    const parts = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); reject(new Error('Payload too large')) } else parts.push(c) })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

/** Blutec webhooks (server/blutecWebhook.mjs): answer at once, store afterwards. */
async function handleBlutecWebhook(req, res, kind) {
  let raw
  try { raw = await readRawBody(req) } catch { return sendJson(res, 413, { success: false, message: 'Payload too large' }) }
  const { answer, work } = await receiveBlutecWebhook(getEnv, kind, req.headers, raw)
  sendJson(res, answer.status, answer.body)
  if (answer.status !== 200) console.warn(`[blutec webhook ${kind}] refused: ${answer.body.message}`)
  work?.catch((e) => console.error(`[blutec webhook ${kind}] ${e.message}`))
}

/**
 * Scheduled jobs (server/jobs.mjs): called by a Render Cron Job (POST /api/jobs/run) — or, on an always-on server,
 * every JOBS_INTERVAL_MINUTES. One run at a time.
 */
let jobsRunning = null
function runScheduledJobs(source) {
  jobsRunning ??= runJobs(getEnv, { send: deliverClientEmail })
    .then((r) => { console.log(`[jobs:${source}] ${r.ok ? r.summary : r.message}${r.errors?.length ? ` — ${r.errors.join('; ')}` : ''}`); return r })
    .catch((e) => { console.error(`[jobs:${source}] ${e.message}`); return { ok: false, message: e.message } })
    .finally(() => { jobsRunning = null })
  return jobsRunning
}
const jobsEvery = Number(getEnv('JOBS_INTERVAL_MINUTES')) || 0
if (jobsEvery >= 5) setInterval(() => runScheduledJobs('timer'), jobsEvery * 60_000).unref()

/** Website enquiry form → CRM lead (server/websiteLeads.mjs). A plain HTML form with a thank-you URL is redirected there. */
async function handleWebsiteLead(req, res) {
  let raw
  try { raw = await readRawBody(req, 64_000) } catch { return sendJson(res, 413, { success: false, message: 'Payload too large' }) }
  const ip = clientIp(req)
  try {
    const r = await receiveWebsiteLead(getEnv, { contentType: req.headers['content-type'], raw, ip, headerKey: req.headers['x-website-key'] })
    if (r.status !== 200) console.warn(`[website lead] ${r.status}: ${r.body.message}`)
    if (r.redirect && r.status === 200) { res.writeHead(303, { Location: r.redirect, 'Access-Control-Allow-Origin': '*' }); return res.end() }
    sendJson(res, r.status, r.body)
  } catch (e) {
    console.error(`[website lead] ${e.message}`)
    sendJson(res, 502, { success: false, message: 'Sorry, the enquiry could not be saved — please call us.' })
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 50_000) {
        req.destroy()
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

// -------------------------------------------------------------
// API Handlers
// -------------------------------------------------------------
async function handleSendResetEmail(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { success: false, message: err.message })
  }

  // never a phishing relay: no reset email from the live (Supabase) server, and only links to this CRM's own page
  const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '')
  const origins = [getEnv('APP_URL'), `https://${host}`, `http://${host}`].map((u) => { try { return new URL(u).origin } catch { return '' } }).filter(Boolean)
  const bad = checkResetRequest(body, { cloud: !!mailAdmin(), origins })
  if (bad) return sendJson(res, bad.status, { success: false, message: bad.message })
  const email = String(body.email).trim(), resetLink = String(body.resetLink)
  if (overLimit(`reset-ip:${clientIp(req)}`, 10, 3600_000) || overLimit(`reset-to:${email.toLowerCase()}`, 3, 3600_000)) {
    return sendJson(res, 429, { success: false, message: 'Too many reset emails — please try again later.' })
  }

  const resetHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #E5E7EB; border-radius: 16px;">
      <h2 style="color: #2E3A8C; margin-top: 0; font-size: 22px;">Rexera CRM · Reset Password</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">We received a request to reset the password for your Rexera CRM account (<b>${escapeHtml(email)}</b>).</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Click the button below to verify your email and set your new password:</p>
      <div style="margin: 28px 0; text-align: center;">
        <a href="${escapeHtml(resetLink)}" style="background-color: #F47B20; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
      </div>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.5;">This link will expire in 15 minutes. If you did not request a password reset, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">Rexera Financial Services Pvt. Ltd.</p>
    </div>
  `

  // 1. Try Resend API over HTTPS (port 443 - never blocked on Render free tier)
  try {
    const resendResult = await sendViaResendApi(email, 'Reset your Rexera CRM password', resetHtml)
    if (resendResult) {
      console.log(`[Resend API] Reset email delivered to ${email}`)
      return sendJson(res, 200, { success: true, message: `Email delivered to ${email}` })
    }
  } catch (resendErr) {
    console.warn('[Resend API Warning]:', resendErr.message)
  }

  // 2. Try Nodemailer SMTP
  const transporter = createMailer()
  const smtpUser = getEnv('SMTP_USER')
  const smtpFrom = getEnv('SMTP_FROM', `"Rexera CRM" <${smtpUser || 'no-reply@hr.rexera.in'}>`)

  if (!transporter) {
    return sendJson(res, 500, {
      success: false,
      configured: false,
      message: 'SMTP credentials not configured on the live server (SMTP_USER / SMTP_PASS).',
    })
  }

  try {
    console.log(`[SMTP] Delivering reset email to ${email}...`)
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'Reset your Rexera CRM password',
      html: resetHtml,
    })

    console.log(`[SMTP] Reset email successfully delivered to ${email}`)
    return sendJson(res, 200, { success: true, message: `Email delivered to ${email}` })
  } catch (err) {
    console.error('[SMTP Error - Reset Link]:', err.message)
    const isTimeout = /timeout|ETIMEDOUT|ECONNREFUSED/i.test(err.message)
    return sendJson(res, 500, {
      success: false,
      smtpBlocked: isTimeout,
      message: isTimeout
        ? 'SMTP connection timed out. Render Free tier blocks outbound SMTP ports (25, 465, 587).'
        : `SMTP error: ${err.message}`,
    })
  }
}

async function handleSendOtpEmail(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { success: false, message: err.message })
  }

  // only to the person who just signed in (their Supabase sign-in comes with the request), and only a 6-digit code
  const cloud = !!mailAdmin()
  const bad = checkOtpRequest(body, { cloud, authEmail: cloud ? await signedInEmail(req.headers.authorization) : null })
  if (bad) return sendJson(res, bad.status, { success: false, message: bad.message })
  const email = String(body.email).trim(), code = String(body.code)
  if (overLimit(`otp-ip:${clientIp(req)}`, 30, 3600_000) || overLimit(`otp-to:${email.toLowerCase()}`, 10, 3600_000)) {
    return sendJson(res, 429, { success: false, message: 'Too many codes — please wait a few minutes and sign in again.' })
  }

  const otpHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #E5E7EB; border-radius: 16px;">
      <h2 style="color: #2E3A8C; margin-top: 0; font-size: 22px;">Rexera CRM · Login Verification</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Your 6-digit login verification code for <b>${escapeHtml(email)}</b> is:</p>
      <div style="margin: 28px 0; text-align: center;">
        <span style="font-family: monospace, Courier; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #F47B20; background: #FFF7ED; padding: 14px 28px; border-radius: 12px; border: 1.5px dashed #F4A12A; display: inline-block;">${code}</span>
      </div>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.5;">This code is valid for 5 minutes. Enter this code on the login screen to access your account.</p>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.5;">If you did not attempt to sign in, please secure your account immediately.</p>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">Rexera Financial Services Pvt. Ltd.</p>
    </div>
  `

  // 1. Try Resend API over HTTPS (port 443 - never blocked on Render free tier)
  try {
    const resendResult = await sendViaResendApi(email, `${code} is your Rexera CRM login verification code`, otpHtml)
    if (resendResult) {
      console.log(`[Resend API] OTP delivered to ${email}`)
      return sendJson(res, 200, { success: true, message: `OTP delivered to ${email}` })
    }
  } catch (resendErr) {
    console.warn('[Resend API Warning]:', resendErr.message)
  }

  // 2. Try Nodemailer SMTP
  const transporter = createMailer()
  const smtpUser = getEnv('SMTP_USER')
  const smtpFrom = getEnv('SMTP_FROM', `"Rexera CRM" <${smtpUser || 'no-reply@hr.rexera.in'}>`)

  if (!transporter) {
    console.warn('[SMTP] Attempted OTP send but SMTP_USER / SMTP_PASS is missing')
    return sendJson(res, 500, {
      success: false,
      configured: false,
      message: 'SMTP credentials not configured on the live server (SMTP_USER / SMTP_PASS).',
    })
  }

  try {
    console.log(`[SMTP] Delivering a login code to ${email}...`)
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: `${code} is your Rexera CRM login verification code`,
      html: otpHtml,
    })

    console.log(`[SMTP] OTP code successfully delivered to ${email}`)
    return sendJson(res, 200, { success: true, message: `OTP delivered to ${email}` })
  } catch (err) {
    console.error('[SMTP Error - OTP]:', err.message)
    const isTimeout = /timeout|ETIMEDOUT|ECONNREFUSED/i.test(err.message)
    return sendJson(res, 500, {
      success: false,
      smtpBlocked: isTimeout,
      message: isTimeout
        ? 'SMTP connection timed out. Render Free tier blocks outbound SMTP ports (25, 465, 587).'
        : `SMTP error: ${err.message}`,
    })
  }
}

// Client emails (Operation team / Admin → client): only signed-in CRM staff (when the server can check sign-ins); the
// fixed branded layout built from plain text (escaped), rate-limited per caller and per recipient.
const sendLog = new Map()
/** The server's Supabase connection, when it can check sign-ins (the live CRM); else null. */
function mailAdmin() {
  const url = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL'), secret = getEnv('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}
/** The email of the Supabase sign-in sent with a request (Authorization: Bearer …), or null. */
async function signedInEmail(authorization) {
  const sb = mailAdmin(), token = String(authorization || '').replace(/^Bearer\s+/i, '')
  if (!sb || !token) return null
  const { data } = await sb.auth.getUser(token).catch(() => ({ data: null }))
  return data?.user?.email ?? null
}
/**
 * The caller's IP for rate limits. Render sits behind Cloudflare, which overwrites CF-Connecting-IP; the first
 * X-Forwarded-For entry is whatever the caller sent (spoofable), so only the last one (added by the proxy) is used.
 */
function clientIp(req) {
  const h = req.headers
  const trusted = String(h['cf-connecting-ip'] || h['true-client-ip'] || '').trim()
  if (trusted) return trusted
  const hops = String(h['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  return hops[hops.length - 1] || req.socket.remoteAddress || '?'
}
function overLimit(key, max, windowMs) {
  const now = Date.now()
  const hits = (sendLog.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= max) { sendLog.set(key, hits); return true }
  hits.push(now)
  sendLog.set(key, hits)
  if (sendLog.size > 5000) for (const [k, v] of sendLog) if (!v.some((t) => now - t < windowMs)) sendLog.delete(k)
  return false
}

async function handleSendClientEmail(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { success: false, message: err.message })
  }
  const problem = checkClientEmail(body)
  if (problem) return sendJson(res, 400, { success: false, message: problem })
  const cloud = !!mailAdmin()
  const staff = cloud && req.headers.authorization ? !!(await crmUser(getEnv, req.headers.authorization).catch(() => null)) : false
  const denied = checkClientSender({ cloud, staff })
  if (denied) return sendJson(res, denied.status, { success: false, message: denied.message })
  const ip = clientIp(req)
  if (overLimit(`ip:${ip}`, 60, 3600_000) || overLimit(`to:${body.to.toLowerCase()}`, 10, 3600_000)) {
    return sendJson(res, 429, { success: false, message: 'Too many emails in the last hour. Please try again later.' })
  }

  const r = await deliverClientEmail(body)
  return sendJson(res, r.success ? 200 : 500, r)
}

/**
 * Sends one branded client email (Resend when configured, else SMTP). Used by the endpoint above and by the scheduled
 * job's welcome retries. `attachments` = [{ filename, content (base64), contentType }] (server-made only, e.g. the
 * invoice PDF). Answers { success, message } — success only when the provider accepted it.
 */
async function deliverClientEmail(body, attachments = [], extra = {}) {
  const problem = checkClientEmail(body)
  if (problem) return { success: false, message: problem }
  const { html, text } = renderClientEmail(body, extra)
  const cc = (body.cc || []).filter(Boolean)
  const replyTo = body.replyTo || body.sender?.email || undefined
  try {
    const resendResult = await sendViaResendApi(body.to, body.subject, html, { text, ...(cc.length && { cc }), ...(replyTo && { reply_to: replyTo }), ...(attachments.length && { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) }) })
    if (resendResult) {
      console.log(`[Resend API] Client email delivered to ${body.to}`)
      return { success: true, message: `Email sent to ${body.to}` }
    }
  } catch (resendErr) {
    console.warn('[Resend API Warning]:', resendErr.message)
  }
  const transporter = createMailer()
  const smtpUser = getEnv('SMTP_USER')
  const smtpFrom = getEnv('SMTP_FROM', `"Rexera CRM" <${smtpUser || 'no-reply@hr.rexera.in'}>`)
  if (!transporter) return { success: false, configured: false, message: 'Email is not set up on the server (SMTP_USER / SMTP_PASS).' }
  try {
    await transporter.sendMail({
      from: smtpFrom, to: body.to, ...(cc.length && { cc }), ...(replyTo && { replyTo }), subject: body.subject, html, text,
      ...(attachments.length && { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64'), contentType: a.contentType })) }),
    })
    console.log(`[SMTP] Client email delivered to ${body.to}`)
    return { success: true, message: `Email sent to ${body.to}` }
  } catch (err) {
    console.error('[SMTP Error - Client email]:', err.message)
    const isTimeout = /timeout|ETIMEDOUT|ECONNREFUSED/i.test(err.message)
    return { success: false, smtpBlocked: isTimeout, message: isTimeout ? 'The email server could not be reached (SMTP timed out).' : `SMTP error: ${err.message}` }
  }
}

// Rexy AI assistant: the OpenAI key stays here; the browser sends the question + what the user can see
async function handleAiChat(req, res) {
  let body
  try { body = await readJsonBody(req) } catch (err) { return sendJson(res, 400, { success: false, message: err.message }) }
  const problem = checkAiRequest(body)
  if (problem) return sendJson(res, 400, { success: false, message: problem })
  // the AI key is the company's: on the live CRM only signed-in staff may use it
  if (mailAdmin() && !(req.headers.authorization && await crmUser(getEnv, req.headers.authorization).catch(() => null))) {
    return sendJson(res, 401, { success: false, message: 'Sign in to the CRM to use the assistant.' })
  }
  const ip = clientIp(req)
  const limited = aiOverLimit(ip, { hourly: Number(getEnv('AI_HOURLY_LIMIT', '150')), daily: Number(getEnv('AI_DAILY_LIMIT', '1500')) })
  if (limited) return sendJson(res, 429, { success: false, message: limited })
  const r = await answerAi(body, aiConfig((k) => getEnv(k)))
  return sendJson(res, r.status, r.body)
}

// -------------------------------------------------------------
// Static File Serving with SPA fallback
// -------------------------------------------------------------
// no framing by other sites (clickjacking), no MIME sniffing, HTTPS only, no full URLs in the Referer
const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
}

function serveStaticFile(req, res, pathname) {
  let relativePath = pathname
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html'
  }

  // Prevent directory traversal attacks
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(DIST_DIR, safePath)

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    // Cache long-term for hashed static assets, short-term for html
    const cacheControl = ext === '.html'
      ? 'no-cache, must-revalidate'
      : 'public, max-age=31536000, immutable'

    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // SPA fallback: return index.html for unknown routes (e.g. /reset-password, /crm-entries)
  const indexHtml = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(indexHtml)) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
    })
    fs.createReadStream(indexHtml).pipe(res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found. Build the app with `npm run build` first.')
}

// -------------------------------------------------------------
// Blutec dialer / IVR relay. The CRM signs in only inside the browser, so the server can't verify users;
// instead each staff computer is set up once with DIALER_ACCESS_KEY (IVR campaigns need IVR_ACCESS_KEY).
// ponytail: shared keys, per-user checks once CRM sign-in moves to Supabase Auth
// -------------------------------------------------------------
// IVR campaigns and the dialer webhook setup: Super Admin / IT (or the IVR access key until the Supabase switch)
const IVR_ACTIONS = ['ivrList', 'ivrStats', 'ivrControl', 'ivrConnects', 'ivrCalls', 'ivrGet']
const sameKey = (given, expected) => !!expected && crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(given)).digest(), crypto.createHash('sha256').update(expected).digest())

async function handleBlutecRelay(req, res) {
  // signed in with Supabase: the person's own sign-in is the check (IVR for Super Admin / IT); no access keys needed
  const who = req.headers.authorization ? await crmUser(getEnv, req.headers.authorization).catch(() => null) : null
  if (who) {
    let body
    try { body = await readJsonBody(req) } catch { return sendJson(res, 400, { success: false, message: 'Bad JSON' }) }
    if (IVR_ACTIONS.includes(body.action) && !who.roles.some((r) => r === 'superadmin' || r === 'it')) return sendJson(res, 403, { success: false, message: 'IVR campaigns are for the Super Admin and IT.' })
    // calls always ring the signed-in person's own agent phone
    if (body.action === 'call') { body.agentEmail = who.email; body.userId = who.id }
    if (body.action === 'agent') body.email = who.email
    const r = await handleBlutec(body, blutecEnv({ ...fileEnv, ...process.env }))
    return sendJson(res, r.status, r.body)
  }
  const dialerKey = getEnv('DIALER_ACCESS_KEY')
  if (!dialerKey) return sendJson(res, 503, { success: false, code: 'NOT_CONFIGURED', message: 'Set DIALER_ACCESS_KEY on the server (Render → Environment).' })
  const given = req.headers['x-dialer-key'] || ''
  // the IVR key may come in its own header (a computer with both keys) or as the only key
  const ivrOk = sameKey(req.headers['x-ivr-key'] || '', getEnv('IVR_ACCESS_KEY')) || sameKey(given, getEnv('IVR_ACCESS_KEY'))
  if (!ivrOk && !sameKey(given, dialerKey)) return sendJson(res, 401, { success: false, code: 'NO_KEY', message: 'Enter the dialer access key on this computer (ask the Super Admin).' })

  let body
  try { body = await readJsonBody(req) } catch { return sendJson(res, 400, { success: false, message: 'Bad JSON' }) }
  if (IVR_ACTIONS.includes(body.action) && !ivrOk) return sendJson(res, 403, { success: false, message: 'IVR campaigns need the IVR access key: open the connection button (top right of the Dialer) and enter it under “IVR access key”.' })

  const r = await handleBlutec(body, blutecEnv({ ...fileEnv, ...process.env }))
  sendJson(res, r.status, r.body)
}

// -------------------------------------------------------------
// Passwords with Supabase sign-in (server/users.mjs)
// -------------------------------------------------------------
async function handleSetPassword(req, res) {
  let body
  try { body = await readJsonBody(req) } catch { return sendJson(res, 400, { success: false, message: 'Bad JSON' }) }
  const r = await setPassword(getEnv, req.headers.authorization, body)
  sendJson(res, r.status, r.body)
}

// -------------------------------------------------------------
// Sales incentive report from Supabase (salaries and payouts): only computers set up with REPORTS_ACCESS_KEY
// ponytail: shared key, per-user checks once CRM sign-in moves to Supabase Auth
// -------------------------------------------------------------
async function handleIncentiveReport(req, res, query) {
  const reportsKey = getEnv('REPORTS_ACCESS_KEY')
  if (!reportsKey) return sendJson(res, 503, { success: false, code: 'NOT_CONFIGURED', message: 'Set REPORTS_ACCESS_KEY on the server (Render → Environment).' })
  if (!sameKey(req.headers['x-reports-key'] || '', reportsKey)) return sendJson(res, 401, { success: false, code: 'NO_KEY', message: 'Enter the reports access key on this computer (ask the Super Admin).' })
  const r = await incentiveReport(query, reportConfig((k) => getEnv(k)))
  sendJson(res, r.status, r.body)
}

// -------------------------------------------------------------
// Server creation
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = parsedUrl.pathname

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Website-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    res.end()
    return
  }

  // Health check endpoint
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      smtpConfigured: Boolean(getEnv('SMTP_USER') && getEnv('SMTP_PASS')),
      whatsappConfigured: whatsappConfigured(getEnv),
      // AI assistant set-up at a glance (never the key itself)
      aiConfigured: Boolean(getEnv('AI_API_KEY') || getEnv('OPENAI_API_KEY')),
      aiProvider: (() => { try { return new URL(getEnv('AI_BASE_URL') || 'https://api.openai.com/v1').host } catch { return 'invalid AI_BASE_URL' } })(),
      aiModel: getEnv('AI_MODEL') || getEnv('OPENAI_MODEL') || 'gpt-4.1-mini',
    })
  }

  // API Endpoints
  if (pathname === '/api/send-reset-email' && req.method === 'POST') {
    return handleSendResetEmail(req, res)
  }

  if (pathname === '/api/send-otp-email' && req.method === 'POST') {
    return handleSendOtpEmail(req, res)
  }

  if (pathname === '/api/send-client-email' && req.method === 'POST') {
    return handleSendClientEmail(req, res)
  }

  if (pathname === '/api/ai-chat' && req.method === 'POST') {
    return handleAiChat(req, res)
  }

  if (pathname === '/api/users/password' && req.method === 'POST') {
    return handleSetPassword(req, res).catch((err) => {
      console.error(`[users/password] ${err.message}`)
      sendJson(res, 502, { success: false, message: 'The password could not be changed right now — please try again.' })
    })
  }

  // the dialer call webhook was removed: Blutec may still send to it, so say "received" (stops its retries) and drop it
  if (pathname === '/api/blutec/webhook/calls' && req.method === 'POST') {
    req.resume()
    return sendJson(res, 200, { success: true, ignored: true })
  }
  if (pathname === '/api/blutec/webhook/ivr' && req.method === 'POST') {
    return handleBlutecWebhook(req, res, 'ivr')
  }

  // public job applications (no sign-in): the server checks and saves them, and tells HR
  const applyMatch = pathname.match(/^\/api\/apply\/([A-Za-z0-9_-]{6,64})$/)
  if (applyMatch && req.method === 'POST') {
    const ip = clientIp(req)
    let raw
    try { raw = await readRawBody(req, 64_000) } catch { return sendJson(res, 413, { success: false, message: 'Too large.' }) }
    try {
      const r = await submitJobApplication(getEnv, applyMatch[1], raw, ip)
      return sendJson(res, r.status, r.body)
    } catch (e) {
      console.error(`[apply] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'Sorry, your application could not be saved — please try again in a minute.' })
    }
  }

  // public client forms (no sign-in): read the form / send the answers
  const formMatch = pathname.match(/^\/api\/forms\/([A-Za-z0-9_-]{8,80})(\/submit)?$/)
  if (formMatch) {
    const ip = clientIp(req)
    try {
      if (!formMatch[2] && req.method === 'GET') { const r = await getPublicForm(getEnv, formMatch[1], parsedUrl.searchParams.get('mobile'), ip); return sendJson(res, r.status, r.body) }
      if (formMatch[2] && req.method === 'POST') {
        let raw
        try { raw = await readRawBody(req, 22_000_000) } catch { return sendJson(res, 413, { success: false, message: 'Files too large (15 MB in all).' }) }
        const r = await submitPublicForm(getEnv, formMatch[1], raw, ip)
        return sendJson(res, r.status, r.body)
      }
    } catch (e) {
      console.error(`[forms] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'Sorry, something went wrong — please try again or contact us.' })
    }
  }

  // sending to clients from a CRM screen (Supabase sign-in): invoice PDF by email / WhatsApp, WhatsApp welcome
  if ((pathname === '/api/invoices/send' || pathname === '/api/whatsapp/welcome' || pathname === '/api/forms/share') && req.method === 'POST') {
    let raw
    try { raw = await readRawBody(req, 8_000_000) } catch { return sendJson(res, 413, { success: false, message: 'The invoice PDF is too large.' }) }
    try {
      const r = pathname === '/api/invoices/send'
        ? await sendInvoice(getEnv, req.headers.authorization, raw, { deliverEmail: deliverClientEmail })
        : pathname === '/api/forms/share'
          ? await sendFormLink(getEnv, req.headers.authorization, raw, { appUrl: `https://${String(req.headers.host || '').replace(/[^\w.:-]/g, '')}` })
          : await sendWelcomeNow(getEnv, req.headers.authorization, raw)
      return sendJson(res, r.status, r.body)
    } catch (e) {
      console.error(`[${pathname}] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'Sending failed — please try again in a minute.' })
    }
  }

  if (pathname === '/api/jobs/run' && req.method === 'POST') {
    if (!jobsAuthorized(getEnv, req.headers['x-jobs-secret'], parsedUrl.searchParams.get('key'))) return sendJson(res, 401, { success: false, message: 'Bad or missing jobs secret.' })
    const r = await runScheduledJobs('cron')
    return sendJson(res, r.ok ? 200 : 503, { success: r.ok, ...r })
  }

  if (pathname === '/api/website-lead' && req.method === 'POST') {
    return handleWebsiteLead(req, res)
  }

  // the website reads its published content (public, read-only)
  if (pathname === '/api/site/content' && req.method === 'GET') {
    try {
      const r = await getSiteContent(getEnv, { fresh: parsedUrl.searchParams.has('fresh') })
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' })
      return res.end(JSON.stringify(r.body))
    } catch (e) {
      console.error(`[site content] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'Content not available right now.' })
    }
  }

  // Super Admin: save a failed website enquiry as a lead again
  if (pathname === '/api/website-lead/retry' && req.method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return sendJson(res, 400, { success: false, message: 'Bad JSON' }) }
    try {
      const who = req.headers.authorization ? await crmUser(getEnv, req.headers.authorization).catch(() => null) : null
      const url = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL'), secret = getEnv('SUPABASE_SECRET_KEY') || ''
      if (!url || !secret.startsWith('sb_secret_')) return sendJson(res, 503, { success: false, message: 'The CRM is not connected yet.' })
      const r = await retryWebsiteLead(createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }), who, body)
      return sendJson(res, r.status, r.body)
    } catch (e) {
      console.error(`[website lead retry] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'The lead could not be saved right now — please try again.' })
    }
  }

  // client portal: the Super Admin manages access; clients read and upload only through here (server/portal.mjs)
  const portalMatch = pathname.match(/^\/api\/(portal|portal-admin)\/([a-z-]{2,20})$/)
  if (portalMatch && (req.method === 'POST' || req.method === 'GET')) {
    const ip = clientIp(req)
    let body = {}
    if (req.method === 'POST') {
      try { body = JSON.parse((await readRawBody(req, 8_000_000)) || '{}') } catch { return sendJson(res, 400, { success: false, message: 'Bad request or file too large (5 MB).' }) }
    } else body = Object.fromEntries(parsedUrl.searchParams)
    const deps = { appUrl: `${req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https'}://${String(req.headers.host || '').replace(/[^\w.:-]/g, '')}`, sendEmail: (mail, extra) => deliverClientEmail(mail, [], extra) }
    try {
      const r = portalMatch[1] === 'portal-admin'
        ? await portalAdmin(getEnv, req.headers.authorization ? await crmUser(getEnv, req.headers.authorization).catch(() => null) : null, portalMatch[2], body, deps)
        : await portalClient(getEnv, req.headers.authorization, portalMatch[2], body, ip, deps)
      return sendJson(res, r.status, r.body)
    } catch (e) {
      console.error(`[portal ${portalMatch[2]}] ${e.message}`)
      return sendJson(res, 502, { success: false, message: 'Sorry, something went wrong — please try again in a minute.' })
    }
  }

  if (pathname === '/api/blutec' && req.method === 'POST') {
    return handleBlutecRelay(req, res).catch((err) => sendJson(res, 502, { success: false, message: err.message }))
  }

  if (pathname === '/api/incentive-report' && req.method === 'GET') {
    return handleIncentiveReport(req, res, parsedUrl.searchParams)
  }

  // Static Assets and SPA routing
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStaticFile(req, res, pathname)
  }

  sendJson(res, 404, { success: false, message: 'Route not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`)
  console.log(`🚀 Rexera CRM Live Production Server is running!`)
  console.log(`👉 URL: http://${HOST}:${PORT} (listening on all interfaces)`)
  console.log(`📞 Dialer: ${blutecEnv({ ...fileEnv, ...process.env }).keyId ? 'Configured' : '⚠️ NOT configured (Set BLUTEC_KEY_ID, BLUTEC_API_KEY, BLUTEC_SIGNING_SECRET)'}`)
  console.log(`📧 SMTP: ${getEnv('SMTP_USER') ? `Configured (${getEnv('SMTP_USER')})` : '⚠️ NOT configured (Set SMTP_USER & SMTP_PASS)'}`)
  console.log(`======================================================\n`)
})

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server')
  server.close(() => process.exit(0))
})
