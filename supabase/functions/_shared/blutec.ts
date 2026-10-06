/**
 * Blutec Dialer + IVR relay (docs: https://docs.dialer.blutec.ai). Runs server-side only — in the local dev server
 * (vite.config.ts) and in the Supabase Edge Function `blutec` — because requests are signed with a secret that must
 * never reach a browser, and Blutec does not accept browser (CORS) calls.
 *
 * Click-to-call (`/api/v1`) uses key_id + api_key + HMAC-SHA256 signing. IVR uses a login token (email + password of a
 * dedicated API account). Uses only Web Crypto + fetch, so the same file works in Node 18+ and Deno.
 */
export interface BlutecEnv {
  dialerUrl?: string
  keyId?: string
  apiKey?: string
  signingSecret?: string
  ivrUrl?: string
  ivrEmail?: string
  ivrPassword?: string
}
export type BlutecRequest =
  | { action: 'status' }
  | { action: 'agent'; email: string }
  | { action: 'call'; agentEmail: string; phone: string; leadId?: string; attempt?: string }
  | { action: 'callStatus'; refId: string }
  | { action: 'ivrList' }
  | { action: 'ivrStats'; id: number }
  | { action: 'ivrControl'; id: number; op: 'start' | 'pause' | 'resume' | 'stop' }
  | { action: 'ivrConnects'; dateFrom?: string; dateTo?: string; phone?: string }
export interface BlutecResult { status: number; body: unknown }

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

const agentCache = new Map<string, string>()
let ivrToken: { token: string; at: number } | null = null

const dialerReady = (e: BlutecEnv) => !!(e.keyId && e.apiKey && e.signingSecret)
const ivrReady = (e: BlutecEnv) => !!(e.ivrEmail && e.ivrPassword)
const fail = (status: number, message: string, code?: string): BlutecResult => ({ status, body: { success: false, message, code } })

/** Signed request to the Click-to-Call API. `path` excludes the query string (as the signature requires). */
async function signed(e: BlutecEnv, method: 'GET' | 'POST', path: string, query = '', body?: unknown, idem?: string) {
  const raw = body === undefined ? '' : JSON.stringify(body)
  const ts = String(Math.floor(Date.now() / 1000))
  const rid = crypto.randomUUID()
  const sig = await hmac(e.signingSecret!, [method, path, ts, rid, await sha256(raw)].join('\n'))
  const res = await fetch(`${(e.dialerUrl || 'https://dialer.blutec.ai').replace(/\/$/, '')}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${e.keyId}.${e.apiKey}`, 'X-Timestamp': ts, 'X-Request-ID': rid, 'X-Signature': sig,
      ...(raw ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    body: raw || undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({ success: false, message: `Blutec answered ${res.status}` })) }
}

async function ivrLogin(e: BlutecEnv) {
  const res = await fetch(`${(e.ivrUrl || 'https://ivr.blutec.ai').replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e.ivrEmail, password: e.ivrPassword }),
  })
  const j = await res.json().catch(() => ({})) as { data?: { accessToken?: string }; message?: string }
  if (!res.ok || !j.data?.accessToken) throw new Error(j.message || `IVR sign-in failed (${res.status})`)
  ivrToken = { token: j.data.accessToken, at: Date.now() }
  return ivrToken.token
}
/** IVR call with the cached login token; signs in again once on 401 (IVR has no refresh endpoint). */
async function ivr(e: BlutecEnv, method: 'GET' | 'POST', path: string) {
  const url = `${(e.ivrUrl || 'https://ivr.blutec.ai').replace(/\/$/, '')}${path}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = ivrToken && Date.now() - ivrToken.at < 7.5 * 3600_000 ? ivrToken.token : await ivrLogin(e)
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined })
    if (res.status === 401 && attempt === 0) { ivrToken = null; continue }
    return { status: res.status, body: await res.json().catch(() => ({ success: false, message: `IVR answered ${res.status}` })) }
  }
  return fail(401, 'IVR sign-in was rejected.')
}

async function agentUuid(e: BlutecEnv, email: string) {
  const key = email.trim().toLowerCase()
  const hit = agentCache.get(key)
  if (hit) return hit
  const r = await signed(e, 'GET', '/api/v1/agents', `?email=${encodeURIComponent(key)}`)
  const uuid = (r.body as { data?: { agent_uuid?: string } }).data?.agent_uuid
  if (!uuid) throw Object.assign(new Error(`No dialer agent is set up for ${key}. Ask your Blutec admin to add this email as an agent.`), { status: 404 })
  agentCache.set(key, uuid)
  return uuid
}

export async function handleBlutec(req: BlutecRequest, e: BlutecEnv): Promise<BlutecResult> {
  try {
    switch (req.action) {
      case 'status':
        return { status: 200, body: { success: true, data: { dialer: dialerReady(e), ivr: ivrReady(e), dialerUrl: e.dialerUrl || 'https://dialer.blutec.ai', ivrUrl: e.ivrUrl || 'https://ivr.blutec.ai' } } }
      case 'agent':
        if (!dialerReady(e)) return fail(503, 'Click-to-call is not configured.', 'NOT_CONFIGURED')
        return { status: 200, body: { success: true, data: { agent_uuid: await agentUuid(e, req.email) } } }
      case 'call': {
        if (!dialerReady(e)) return fail(503, 'Click-to-call is not configured.', 'NOT_CONFIGURED')
        const phone = String(req.phone).replace(/\D/g, '')
        if (phone.length < 10 || phone.length > 15) return fail(422, 'The number must have 10–15 digits.', 'VALIDATION_ERROR')
        const uuid = await agentUuid(e, req.agentEmail)
        // Indian 10-digit numbers get the 91 country code
        const destination = phone.length === 10 ? `91${phone}` : phone
        return await signed(e, 'POST', '/api/v1/click-to-call', '', { agent_uuid: uuid, destination_number: destination, custom_identifier: req.leadId ? { crm_lead_id: req.leadId } : undefined },
          req.attempt ? `crm-${req.leadId ?? phone}-${req.attempt}` : undefined)
      }
      case 'callStatus':
        if (!dialerReady(e)) return fail(503, 'Click-to-call is not configured.', 'NOT_CONFIGURED')
        if (!/^[\w-]{8,64}$/.test(req.refId)) return fail(422, 'Bad call reference.', 'VALIDATION_ERROR')
        return await signed(e, 'GET', `/api/v1/calls/${req.refId}`)
      case 'ivrList':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        return await ivr(e, 'GET', '/api/ivr')
      case 'ivrStats':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        return await ivr(e, 'GET', `/api/ivr/${Number(req.id)}/broadcast/stats`)
      case 'ivrControl':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        if (!['start', 'pause', 'resume', 'stop'].includes(req.op)) return fail(422, 'Unknown broadcast action.', 'VALIDATION_ERROR')
        return await ivr(e, 'POST', `/api/ivr/${Number(req.id)}/broadcast/${req.op}`)
      case 'ivrConnects': {
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        const q = new URLSearchParams()
        if (req.dateFrom) q.set('dateFrom', req.dateFrom)
        if (req.dateTo) q.set('dateTo', req.dateTo)
        if (req.phone) q.set('phone', req.phone)
        const qs = q.toString()
        return await ivr(e, 'GET', `/api/ivr/agent-connects${qs ? `?${qs}` : ''}`)
      }
      default:
        return fail(400, 'Unknown action.')
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502
    return fail(status, err instanceof Error ? err.message : 'Blutec request failed.')
  }
}

/** Reads the BLUTEC_* settings from an environment map (Node process.env, Vite loadEnv, or Deno.env.toObject()). */
export function blutecEnv(env: Record<string, string | undefined>): BlutecEnv {
  return {
    dialerUrl: env.BLUTEC_DIALER_URL, keyId: env.BLUTEC_KEY_ID, apiKey: env.BLUTEC_API_KEY, signingSecret: env.BLUTEC_SIGNING_SECRET,
    ivrUrl: env.BLUTEC_IVR_URL, ivrEmail: env.BLUTEC_IVR_EMAIL, ivrPassword: env.BLUTEC_IVR_PASSWORD,
  }
}
