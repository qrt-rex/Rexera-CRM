import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'

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
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  })
}

async function sendViaResendApi(to, subject, html) {
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
  })
  res.end(JSON.stringify(data))
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

  const { email, resetLink } = body
  if (!email || !resetLink) {
    return sendJson(res, 400, { success: false, message: 'Email and resetLink are required' })
  }

  const resetHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #E5E7EB; border-radius: 16px;">
      <h2 style="color: #2E3A8C; margin-top: 0; font-size: 22px;">Rexera CRM · Reset Password</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">We received a request to reset the password for your Rexera CRM account (<b>${email}</b>).</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Click the button below to verify your email and set your new password:</p>
      <div style="margin: 28px 0; text-align: center;">
        <a href="${resetLink}" style="background-color: #F47B20; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
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

  const { email, code } = body
  if (!email || !code) {
    return sendJson(res, 400, { success: false, message: 'Email and code are required' })
  }

  const otpHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #E5E7EB; border-radius: 16px;">
      <h2 style="color: #2E3A8C; margin-top: 0; font-size: 22px;">Rexera CRM · Login Verification</h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Your 6-digit login verification code for <b>${email}</b> is:</p>
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
    console.log(`[SMTP] Delivering OTP code ${code} to ${email}...`)
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

// -------------------------------------------------------------
// Static File Serving with SPA fallback
// -------------------------------------------------------------
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
// Server creation
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = parsedUrl.pathname

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    })
  }

  // API Endpoints
  if (pathname === '/api/send-reset-email' && req.method === 'POST') {
    return handleSendResetEmail(req, res)
  }

  if (pathname === '/api/send-otp-email' && req.method === 'POST') {
    return handleSendOtpEmail(req, res)
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
