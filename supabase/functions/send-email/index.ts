// Supabase Edge Function: Email relay for OTP codes, Password Reset links and client emails (Operation team / Admin).
// Useful when frontend is deployed on static hosting (Render Static Site, Vercel, Netlify)
// without a Node.js backend server.
//
// Required Secrets in Supabase (Dashboard -> Settings -> Configuration -> Edge Functions Secrets):
//   SMTP_HOST = smtp.hostinger.com
//   SMTP_PORT = 587
//   SMTP_USER = no-reply@hr.rexera.in
//   SMTP_PASS = (the mailbox password — set it as a secret, never write it in code)
//   SMTP_FROM = "Rexera CRM" <no-reply@hr.rexera.in>

import nodemailer from 'npm:nodemailer@6.9.16'
import { checkClientEmail, renderClientEmail } from '../_shared/client-email.mjs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' })

  let body: { type?: 'otp' | 'reset' | 'client'; email?: string; code?: string; resetLink?: string; [k: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { success: false, message: 'Bad JSON payload' })
  }

  if (body.type === 'client') {
    const problem = checkClientEmail(body)
    if (problem) return json(400, { success: false, message: problem })
    const smtpUser = Deno.env.get('SMTP_USER'), smtpPass = Deno.env.get('SMTP_PASS')
    if (!smtpUser || !smtpPass) return json(500, { success: false, configured: false, message: 'SMTP credentials not configured in Supabase Edge Secrets (SMTP_USER / SMTP_PASS).' })
    const p = body as unknown as Parameters<typeof renderClientEmail>[0]
    const { html, text } = renderClientEmail(p)
    const port = Number(Deno.env.get('SMTP_PORT') || 587)
    try {
      await nodemailer.createTransport({ host: Deno.env.get('SMTP_HOST') || 'smtp.hostinger.com', port, secure: port === 465, auth: { user: smtpUser, pass: smtpPass } }).sendMail({
        from: Deno.env.get('SMTP_FROM') || `"Rexera CRM" <${smtpUser}>`, to: p.to, cc: p.cc?.length ? p.cc : undefined,
        replyTo: p.replyTo || p.sender.email || undefined, subject: p.subject, html, text,
      })
      return json(200, { success: true, message: `Email sent to ${p.to}` })
    } catch (err: any) {
      return json(500, { success: false, message: `SMTP error: ${err.message}` })
    }
  }

  const email = body.email?.trim()
  if (!email || !email.includes('@')) {
    return json(400, { success: false, message: 'A valid email is required' })
  }

  const smtpUser = Deno.env.get('SMTP_USER')
  const smtpPass = Deno.env.get('SMTP_PASS')
  const smtpHost = Deno.env.get('SMTP_HOST') || 'smtp.hostinger.com'
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || 587)
  const smtpFrom = Deno.env.get('SMTP_FROM') || `"Rexera CRM" <${smtpUser || 'no-reply@hr.rexera.in'}>`

  if (!smtpUser || !smtpPass) {
    return json(500, {
      success: false,
      configured: false,
      message: 'SMTP credentials not configured in Supabase Edge Secrets (SMTP_USER / SMTP_PASS).',
    })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    })

    if (body.type === 'otp') {
      const code = body.code?.trim()
      if (!code) return json(400, { success: false, message: 'Code is required for OTP' })

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

      return json(200, { success: true, message: `OTP delivered to ${email}` })
    }

    if (body.type === 'reset') {
      const resetLink = body.resetLink?.trim()
      if (!resetLink) return json(400, { success: false, message: 'resetLink is required for password reset' })

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

      return json(200, { success: true, message: `Email delivered to ${email}` })
    }

    return json(400, { success: false, message: 'Invalid type (expected "otp" or "reset")' })
  } catch (err: any) {
    console.error('[Supabase send-email error]:', err)
    return json(500, { success: false, message: `SMTP error: ${err.message}` })
  }
})
