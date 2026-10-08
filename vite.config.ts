import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { blutecEnv, handleBlutec, type BlutecRequest } from './supabase/functions/_shared/blutec.ts'
import { checkClientEmail, renderClientEmail, type ClientEmailRequest } from './supabase/functions/_shared/client-email.mjs'

/**
 * Local relay for sending password reset emails via SMTP (Nodemailer) or Resend.
 * Reads SMTP_* or RESEND_API_KEY from .env.local on this computer.
 */
function mailerRelay(mode: string): Plugin {
  return {
    name: 'mailer-relay',
    configureServer(server) {
      server.middlewares.use('/api/send-reset-email', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let raw = ''
        req.on('data', (c) => { raw += c; if (raw.length > 20_000) req.destroy() })
        req.on('end', async () => {
          let body: { email?: string; resetLink?: string }
          try { body = JSON.parse(raw || '{}') } catch {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end('{"success":false,"message":"Bad JSON"}'); return
          }
          const viteEnv = loadEnv(mode, process.cwd(), '')
          const rawLocal = (() => {
            const out: Record<string, string> = {}
            try {
              const fs = require('node:fs')
              const txt = fs.readFileSync('.env.local', 'utf-8')
              for (const l of txt.split(/\r?\n/)) {
                const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/)
                if (m) {
                  let v = (m[2] || '').trim()
                  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
                  out[m[1]] = v
                }
              }
            } catch {}
            return out
          })()

          const env = { ...viteEnv, ...rawLocal }
          const { email, resetLink } = body
          if (!email || !resetLink) {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, message: 'Email and resetLink are required' }))
            return
          }

          const smtpUser = env.SMTP_USER || process.env.SMTP_USER
          const smtpPass = env.SMTP_PASS || process.env.SMTP_PASS
          const smtpHost = env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com'
          const smtpPort = Number(env.SMTP_PORT || process.env.SMTP_PORT) || 587
          const smtpFrom = env.SMTP_FROM || process.env.SMTP_FROM || `"Rexera CRM" <${smtpUser || 'no-reply@rexera.in'}>`
          const resendKey = env.RESEND_API_KEY || process.env.RESEND_API_KEY


          if (smtpUser && smtpPass) {
            try {
              const nodemailer = await import('nodemailer')
              const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                secure: smtpPort === 465,
                auth: { user: smtpUser, pass: smtpPass },
              })
              await transporter.sendMail({
                from: smtpFrom,
                to: email,
                subject: 'Reset your Rexera CRM password',
                html: `
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
                `,
              })
              res.statusCode = 200; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, message: `Email delivered to ${email}` }))
              return
            } catch (err: any) {
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, message: `SMTP error: ${err.message}` }))
              return
            }
          }

          if (resendKey) {
            try {
              const resendRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: env.RESEND_FROM || 'Rexera CRM <onboarding@resend.dev>',
                  to: [email],
                  subject: 'Reset your Rexera CRM password',
                  html: `
                    <div style="font-family: sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #E5E7EB; border-radius: 12px;">
                      <h2 style="color: #2E3A8C;">Reset Your Rexera CRM Password</h2>
                      <p>Click the link below to verify your email and set your new password:</p>
                      <p><a href="${resetLink}" style="background: #F47B20; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Reset Password</a></p>
                      <p style="color: #6B7280; font-size: 12px;">Expires in 15 minutes.</p>
                    </div>
                  `,
                }),
              })
              const rData = await resendRes.json()
              if (!resendRes.ok) throw new Error(rData.message || 'Resend error')
              res.statusCode = 200; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, message: `Email delivered to ${email}` }))
              return
            } catch (err: any) {
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, message: `Resend error: ${err.message}` }))
              return
            }
          }

          // Neither configured yet
          res.statusCode = 200; res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            success: false,
            configured: false,
            previewLink: resetLink,
            message: 'No SMTP or email credentials configured in .env.local',
          }))
        })
      })

      server.middlewares.use('/api/send-otp-email', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let raw = ''
        req.on('data', (c) => { raw += c; if (raw.length > 20_000) req.destroy() })
        req.on('end', async () => {
          let body: { email?: string; code?: string }
          try { body = JSON.parse(raw || '{}') } catch {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end('{"success":false,"message":"Bad JSON"}'); return
          }
          const viteEnv = loadEnv(mode, process.cwd(), '')
          const rawLocal = (() => {
            const out: Record<string, string> = {}
            try {
              const fs = require('node:fs')
              const txt = fs.readFileSync('.env.local', 'utf-8')
              for (const l of txt.split(/\r?\n/)) {
                const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/)
                if (m) {
                  let v = (m[2] || '').trim()
                  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
                  out[m[1]] = v
                }
              }
            } catch {}
            return out
          })()

          const env = { ...viteEnv, ...rawLocal }
          const { email, code } = body
          if (!email || !code) {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, message: 'Email and code are required' }))
            return
          }

          const smtpUser = env.SMTP_USER || process.env.SMTP_USER
          const smtpPass = env.SMTP_PASS || process.env.SMTP_PASS
          const smtpHost = env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com'
          const smtpPort = Number(env.SMTP_PORT || process.env.SMTP_PORT) || 587
          const smtpFrom = env.SMTP_FROM || process.env.SMTP_FROM || `"Rexera CRM" <${smtpUser || 'no-reply@hr.rexera.in'}>`

          if (smtpUser && smtpPass) {
            try {
              const nodemailer = await import('nodemailer')
              const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                secure: smtpPort === 465,
                auth: { user: smtpUser, pass: smtpPass },
              })
              await transporter.sendMail({
                from: smtpFrom,
                to: email,
                subject: `${code} is your Rexera CRM login verification code`,
                html: `
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
                `,
              })
              res.statusCode = 200; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, message: `OTP delivered to ${email}` }))
              return
            } catch (err: any) {
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, message: `SMTP error: ${err.message}` }))
              return
            }
          }

          res.statusCode = 200; res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, message: 'SMTP credentials not configured' }))
        })
      })

      // client emails (Operation team / Admin → client): same layout and checks as server.mjs
      server.middlewares.use('/api/send-client-email', (req, res) => {
        const reply = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let raw = ''
        req.on('data', (c) => { raw += c; if (raw.length > 50_000) req.destroy() })
        req.on('end', async () => {
          let body: ClientEmailRequest
          try { body = JSON.parse(raw || '{}') } catch { reply(400, { success: false, message: 'Bad JSON' }); return }
          const problem = checkClientEmail(body)
          if (problem) { reply(400, { success: false, message: problem }); return }
          const env = loadEnv(mode, process.cwd(), '')
          const smtpUser = env.SMTP_USER || process.env.SMTP_USER
          const smtpPass = env.SMTP_PASS || process.env.SMTP_PASS
          if (!smtpUser || !smtpPass) { reply(200, { success: false, configured: false, message: 'Email is not set up on this computer (SMTP_USER / SMTP_PASS in .env.local).' }); return }
          const smtpPort = Number(env.SMTP_PORT || process.env.SMTP_PORT) || 587
          const { html, text } = renderClientEmail(body)
          const cc = (body.cc ?? []).filter(Boolean)
          const replyTo = body.replyTo || body.sender.email || undefined
          try {
            const nodemailer = await import('nodemailer')
            const transporter = nodemailer.createTransport({
              host: env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com', port: smtpPort, secure: smtpPort === 465,
              auth: { user: smtpUser, pass: smtpPass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
            })
            await transporter.sendMail({
              from: env.SMTP_FROM || process.env.SMTP_FROM || `"Rexera CRM" <${smtpUser}>`, to: body.to, ...(cc.length && { cc }), ...(replyTo && { replyTo }),
              subject: body.subject, html, text,
            })
            reply(200, { success: true, message: `Email sent to ${body.to}` })
          } catch (err) {
            reply(500, { success: false, message: `SMTP error: ${err instanceof Error ? err.message : 'failed'}` })
          }
        })
      })
    },
  }
}

/**
 * Local relay for the Blutec dialer/IVR: POST /api/blutec. Reads BLUTEC_* from .env.local on this computer —
 * never VITE_-prefixed, so the keys stay out of the browser bundle. (The live site uses the Supabase function instead.)
 */
function blutecRelay(mode: string): Plugin {
  return {
    name: 'blutec-relay',
    configureServer(server) {
      const env = blutecEnv(loadEnv(mode, process.cwd(), ['BLUTEC_', 'BTC_']))
      server.middlewares.use('/api/blutec', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let raw = ''
        req.on('data', (c) => { raw += c; if (raw.length > 20_000) req.destroy() })
        req.on('end', async () => {
          let body: BlutecRequest
          try { body = JSON.parse(raw || '{}') } catch { res.statusCode = 400; res.end('{"success":false,"message":"Bad JSON"}'); return }
          const r = await handleBlutec(body, env)
          res.statusCode = r.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(r.body))
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), blutecRelay(mode), mailerRelay(mode)],
  server: { port: 5180 },
}))
