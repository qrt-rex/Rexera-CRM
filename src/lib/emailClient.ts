import { cloudConfig } from './supabase'

export interface EmailDispatchResult {
  delivered: boolean
  message?: string
}

async function trySendViaEndpoint(endpoint: string, payload: unknown): Promise<{ ok: boolean; data?: any; isHtml?: boolean }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('text/html')) {
      // Hosted on a static server (e.g. Render Static Site) where SPA rewrite routed /api to index.html
      return { ok: false, isHtml: true }
    }

    if (!res.ok) {
      let errText = ''
      try {
        const j = await res.json()
        errText = j.message || res.statusText
      } catch {
        errText = await res.text()
      }
      return { ok: false, data: { message: errText } }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    clearTimeout(timeoutId)
    const isTimeout = err.name === 'AbortError' || /aborted/i.test(err.message)
    return { ok: false, data: { message: isTimeout ? 'Request timed out after 6 seconds' : err.message } }
  }
}

async function trySendViaSupabaseEdge(payload: unknown): Promise<{ ok: boolean; message?: string }> {
  const cfg = cloudConfig()
  if (cfg.status !== 'ready') return { ok: false, message: 'Supabase not configured' }

  const edgeUrl = `${cfg.url}/functions/v1/send-email`
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      let msg = ''
      try {
        const j = await res.json()
        msg = j.message || res.statusText
      } catch {
        msg = await res.text()
      }
      return { ok: false, message: msg }
    }

    const data = await res.json()
    return { ok: Boolean(data.success), message: data.message }
  } catch (err: any) {
    clearTimeout(timeoutId)
    const isTimeout = err.name === 'AbortError' || /aborted/i.test(err.message)
    return { ok: false, message: isTimeout ? 'Edge request timed out' : err.message }
  }
}

/** Sends 6-digit OTP verification email for login */
export async function sendOtpEmailClient(email: string, code: string): Promise<EmailDispatchResult> {
  const trimmed = email.trim()

  // 1. Try backend server endpoint (/api/send-otp-email)
  const localRes = await trySendViaEndpoint('/api/send-otp-email', { email: trimmed, code })
  if (localRes.ok && localRes.data?.success) {
    console.log(`[Email] OTP delivered to ${trimmed} via /api/send-otp-email`)
    return { delivered: true, message: localRes.data.message }
  }

  if (!localRes.isHtml && localRes.data?.message && localRes.data?.configured !== false) {
    console.warn(`[Email] /api/send-otp-email error:`, localRes.data.message)
  }

  // 2. Try Supabase Edge Function fallback (for static hosting like Render Static, Vercel, Netlify)
  const edgeRes = await trySendViaSupabaseEdge({ type: 'otp', email: trimmed, code })
  if (edgeRes.ok) {
    console.log(`[Email] OTP delivered to ${trimmed} via Supabase Edge Function`)
    return { delivered: true, message: edgeRes.message }
  }

  const failureReason = edgeRes.message || localRes.data?.message || 'SMTP service unreachable on live host'
  console.error(`[Email] OTP delivery failed for ${trimmed}:`, failureReason)
  return { delivered: false, message: failureReason }
}

/** Sends password reset email */
export async function sendResetEmailClient(email: string, resetLink: string): Promise<EmailDispatchResult> {
  const trimmed = email.trim()

  // 1. Try backend server endpoint (/api/send-reset-email)
  const localRes = await trySendViaEndpoint('/api/send-reset-email', { email: trimmed, resetLink })
  if (localRes.ok && localRes.data?.success) {
    console.log(`[Email] Reset link delivered to ${trimmed} via /api/send-reset-email`)
    return { delivered: true, message: localRes.data.message }
  }

  // 2. Try Supabase Edge Function fallback
  const edgeRes = await trySendViaSupabaseEdge({ type: 'reset', email: trimmed, resetLink })
  if (edgeRes.ok) {
    console.log(`[Email] Reset link delivered to ${trimmed} via Supabase Edge Function`)
    return { delivered: true, message: edgeRes.message }
  }

  const failureReason = edgeRes.message || localRes.data?.message || 'SMTP service unreachable on live host'
  console.error(`[Email] Reset link delivery failed for ${trimmed}:`, failureReason)
  return { delivered: false, message: failureReason }
}
