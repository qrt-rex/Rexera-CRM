/**
 * Blutec Dialer + IVR relay (docs: https://docs.dialer.blutec.ai). Runs server-side only — in the local dev server
 * (vite.config.ts) and in the live server (server.mjs) — because requests are signed with a secret that must
 * never reach a browser, and Blutec does not accept browser (CORS) calls.
 *
 * Click-to-call (`/api/v1`) uses key_id + api_key + HMAC-SHA256 signing. The DND list uses the dialer's long-lived
 * API token (blt_…). IVR uses a login token (email + password of a dedicated API account — the IVR product has no
 * long-lived tokens). Uses only Web Crypto + fetch, so the same file works in Node 18+ and Deno.
 */
export interface BlutecEnv {
  dialerUrl?: string
  keyId?: string
  apiKey?: string
  signingSecret?: string
  /** a DID of the company's (the one campaigns use) shown to the agent and the client; unset = Blutec picks */
  callerId?: string
  /** long-lived dialer API token (blt_…), for the DND list */
  token?: string
  ivrUrl?: string
  ivrEmail?: string
  ivrPassword?: string
}
export type BlutecRequest =
  | { action: 'status' }
  | { action: 'agent'; email: string }
  | { action: 'leadLookup'; phone: string }
  | { action: 'dncCheck'; phone: string }
  | { action: 'dncAdd'; phone: string; reason?: string }
  | { action: 'callStatus'; refId: string }
  | { action: 'campaigns' }
  | { action: 'campaignLeads'; id: number }
  /** only these campaigns (the server works out which are the signed-in person's) */
  | { action: 'campaignsByIds'; ids: number[] }
  | { action: 'ivrList' }
  | { action: 'ivrStats'; id: number }
  | { action: 'ivrGet'; id: number }
  | { action: 'ivrControl'; id: number; op: 'start' | 'pause' | 'resume' | 'stop' }
  | { action: 'ivrConnects'; dateFrom?: string; dateTo?: string; phone?: string }
  | { action: 'ivrCalls'; id: number; page?: number; limit?: number }
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
const dncReady = (e: BlutecEnv) => !!e.token
/** Indian 10-digit numbers get the 91 country code (how Blutec stores numbers). */
const toE164ish = (phone: string) => { const p = String(phone).replace(/\D/g, ''); return p.length === 10 ? `91${p}` : p }

/** Dialer API with the long-lived token (DND list). */
async function dialerApi(e: BlutecEnv, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const res = await fetch(`${(e.dialerUrl || 'https://dialer.blutec.ai').replace(/\/$/, '')}${path}`, {
    method, headers: { Authorization: `Bearer ${e.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({ success: false, message: `Dialer answered ${res.status}` })) }
}
/** Blutec answers lists as `data: [...]` or `data: { <key>: [...] }`. */
const rows = (body: unknown, key: string): unknown[] => {
  const d = (body as { data?: unknown })?.data
  return Array.isArray(d) ? d : Array.isArray((d as Record<string, unknown>)?.[key]) ? (d as Record<string, unknown[]>)[key] : []
}
/** The dialer webhook's signing secret, read from Blutec with the long-lived token (null when it can't be read). */
export async function revealWebhookSecret(e: BlutecEnv): Promise<string | null> {
  if (!dncReady(e)) return null
  const r = await dialerApi(e, 'POST', '/api/webhooks/reveal-secret').catch(() => null)
  const b = r?.status === 200 ? (r.body as { data?: unknown; secret?: unknown }) : null
  const d = b?.data as Record<string, unknown> | string | undefined
  // Blutec doesn't document the field name: the secret is the first string among the usual ones
  const v = typeof d === 'string' ? d : d?.secret ?? d?.signing_secret ?? d?.webhook_secret ?? b?.secret
  return typeof v === 'string' && v.length >= 8 ? v : null
}
async function isDnc(e: BlutecEnv, phone: string) {
  const r = await dialerApi(e, 'GET', `/api/dnc/check?phone=${encodeURIComponent(toE164ish(phone))}`)
  if (r.status !== 200) throw new Error(`DND check failed (${r.status})`)
  return !!(r.body as { data?: { is_dnc?: boolean } }).data?.is_dnc
}
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

// a refused IVR sign-in is not retried for 15 minutes: retrying on every screen refresh locks the Blutec IVR login
let ivrRefused: { message: string; at: number } | null = null
async function ivrLogin(e: BlutecEnv) {
  if (ivrRefused && Date.now() - ivrRefused.at < 15 * 60_000) throw new Error(ivrRefused.message)
  const res = await fetch(`${(e.ivrUrl || 'https://ivr.blutec.ai').replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e.ivrEmail, password: e.ivrPassword }),
  })
  const j = await res.json().catch(() => ({})) as { data?: { accessToken?: string }; message?: string }
  if (!res.ok || !j.data?.accessToken) {
    const message = `Blutec IVR refused the sign-in (BLUTEC_IVR_EMAIL / BLUTEC_IVR_PASSWORD on the server): ${j.message || res.status}. The CRM tries again in 15 minutes.`
    ivrRefused = { message, at: Date.now() }
    throw new Error(message)
  }
  ivrRefused = null
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

/** The lead in a Blutec answer: `data`, `data.lead`, `data.leads[0]`, `data[0]` or the answer itself; null without an id. */
export function leadOf(body: unknown): Obj | null {
  const d = isObj(body) && 'data' in body ? body.data : body
  const x = Array.isArray(d) ? d[0] : isObj(d) ? (isObj(d.lead) ? d.lead : Array.isArray(d.leads) ? d.leads[0] : isObj(d.data) ? d.data : d) : null
  return isObj(x) && x.id != null ? x : null
}
/** What the CRM takes from a Blutec lead and its latest call. Empty strings = Blutec didn't say (never guessed). */
export interface BlutecLeadInfo {
  blutecLeadId: number | null; name: string; company: string; email: string; city: string
  disposition: string; calledAt: string; agent: string; campaign: string; durationSec: number | null; notes: string
}
type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const nk = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '')
/** The first non-empty text among these keys (any case / _), in these objects, in order. Nested { name } counts. */
const pick = (objs: unknown[], keys: string[]) => {
  for (const o of objs) {
    if (!isObj(o)) continue
    for (const k of keys) {
      const hit = Object.entries(o).find(([x]) => nk(x) === nk(k))?.[1]
      const v = isObj(hit) ? hit.name ?? hit.label : hit
      if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim()
    }
  }
  return ''
}
/**
 * Reads Blutec's lead lookup, lead details and call history whatever the exact field names (the docs show only
 * id / phone / name / status), the latest call that has a disposition first.
 */
export function blutecLeadInfo(raw: { lookup?: unknown; lead?: unknown; history?: unknown }): BlutecLeadInfo {
  const lead = { ...(isObj(raw.lookup) ? raw.lookup : {}), ...(isObj(raw.lead) ? raw.lead : {}) }
  const custom = ['custom_data', 'custom_fields', 'customData', 'extra', 'data'].map((k) => lead[k]).filter(isObj)
  const people = [lead, ...custom]
  const h = raw.history
  const list: unknown[] = Array.isArray(h) ? h : isObj(h) ? (['history', 'calls', 'items', 'records', 'dispositions'].map((k) => h[k]).find(Array.isArray) ?? []) : []
  const WHEN = ['disposed_at', 'call_time', 'called_at', 'start_time', 'started_at', 'end_time', 'created_at', 'createdAt', 'updated_at']
  const DISPO = ['disposition_name', 'disposition', 'last_disposition', 'dispositionName']
  const time = (r: unknown) => { const t = Date.parse(pick([r], WHEN)); return Number.isFinite(t) ? t : 0 }
  const calls = list.filter(isObj).sort((a, b) => time(b) - time(a))
  const last = calls.find((r) => pick([r], DISPO)) ?? calls[0]
  const first = pick(people, ['first_name', 'firstname']), lastName = pick(people, ['last_name', 'lastname'])
  const dur = pick([last], ['talk_duration_seconds', 'talk_duration', 'talk_time', 'duration_seconds', 'duration', 'billsec'])
  const at = last ? time(last) : 0
  const id = Number(lead.id)
  return {
    blutecLeadId: Number.isFinite(id) ? id : null,
    name: pick(people, ['name', 'full_name', 'customer_name', 'contact_name', 'client_name']) || [first, lastName].filter(Boolean).join(' '),
    company: pick(people, ['company', 'company_name', 'business', 'business_name', 'firm', 'firm_name', 'organization', 'organisation']),
    email: pick(people, ['email', 'email_id', 'mail']),
    city: pick(people, ['city', 'location']),
    disposition: pick([last], DISPO) || pick([lead], DISPO),
    calledAt: at ? new Date(at).toISOString() : '',
    agent: pick([last], ['agent_name', 'agent', 'user_name', 'user', 'disposed_by']),
    campaign: pick([last, lead], ['campaign_name', 'campaign']),
    // seconds, or "00:00:43" as Blutec's own screens show it
    durationSec: /^\d+(:\d+){1,2}$/.test(dur) ? dur.split(':').reduce((s, x) => s * 60 + Number(x), 0) : dur && Number.isFinite(Number(dur)) ? Math.round(Number(dur)) : null,
    notes: pick([last], ['notes', 'note', 'remarks', 'comment']),
  }
}

/** One line for the call: "Hot Prospect · 4 Nov 2026, 12:01 pm · 43s · IT Sample Camp. · by Dhairya Dave". */
export const blutecCallSummary = (b: Pick<BlutecLeadInfo, 'disposition' | 'calledAt' | 'durationSec' | 'campaign' | 'agent'>) => [
  b.disposition,
  b.calledAt && new Date(b.calledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  b.durationSec != null && `${b.durationSec}s`, b.campaign, b.agent && `by ${b.agent}`,
].filter(Boolean).join(' · ')

/** Blutec's disposition (Hot Prospect, Interested, Intro, …) → the client entry status, if it names one. */
export function entryStatusFromDisposition(text?: string): 'HOT' | 'INTERESTED' | 'NOT_INTERESTED' | 'CALL_BACK' | 'PAYMENT_PENDING' | '' {
  const k = (text ?? '').toLowerCase()
  if (/not\s*interest/.test(k)) return 'NOT_INTERESTED'
  if (/hot/.test(k)) return 'HOT'
  if (/interest|intro/.test(k)) return 'INTERESTED'
  if (/call\s*back/.test(k)) return 'CALL_BACK'
  if (/payment/.test(k)) return 'PAYMENT_PENDING'
  return ''
}

export async function handleBlutec(req: BlutecRequest, e: BlutecEnv): Promise<BlutecResult> {
  try {
    switch (req.action) {
      case 'status':
        return { status: 200, body: { success: true, data: { dialer: dialerReady(e), ivr: ivrReady(e), dnc: dncReady(e), dialerUrl: e.dialerUrl || 'https://dialer.blutec.ai', ivrUrl: e.ivrUrl || 'https://ivr.blutec.ai' } } }
      case 'agent':
        if (!dialerReady(e)) return fail(503, 'Click-to-call is not configured.', 'NOT_CONFIGURED')
        return { status: 200, body: { success: true, data: { agent_uuid: await agentUuid(e, req.email) } } }
      case 'leadLookup': {
        // the sales person called this number from Blutec's own dialer: what Blutec knows about it (lead + latest call)
        if (!dncReady(e)) return fail(503, 'Looking up Blutec leads needs the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const ten = String(req.phone).replace(/\D/g, '').slice(-10)
        if (!/^[6-9]\d{9}$/.test(ten)) return fail(422, 'A valid 10-digit mobile is required.', 'VALIDATION_ERROR')
        // Blutec stores numbers as 91XXXXXXXXXX; older lists may hold +91 or the bare 10 digits
        let found: Obj | null = null
        const tried: { phone: string; status: number; answer: string }[] = []
        for (const p of [`91${ten}`, ten, `+91${ten}`]) {
          const r = await dialerApi(e, 'GET', `/api/leads/lookup-by-phone?phone=${encodeURIComponent(p)}`)
          found = r.status === 200 ? leadOf(r.body) : null
          if (found) break
          // what Blutec said, so a lookup that finds nothing can be checked (the browser console shows it)
          tried.push({ phone: p, status: r.status, answer: JSON.stringify(r.body).slice(0, 1500) })
        }
        if (!found) return { status: 200, body: { success: true, data: { found: false, tried } } }
        const id = Number(found.id)
        const [lead, history] = await Promise.all([dialerApi(e, 'GET', `/api/leads/${id}`), dialerApi(e, 'GET', `/api/leads/${id}/history`)])
        const raw = { lookup: found, lead: lead.status === 200 ? leadOf(lead.body) ?? (lead.body as { data?: unknown }).data : null, history: history.status === 200 ? (history.body as { data?: unknown }).data ?? history.body : null }
        return { status: 200, body: { success: true, data: { found: true, ...blutecLeadInfo(raw), raw } } }
      }
      case 'dncCheck': {
        if (!dncReady(e)) return fail(503, 'The DND list needs the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const p = toE164ish(req.phone)
        if (p.length < 10 || p.length > 15) return fail(422, 'The number must have 10–15 digits.', 'VALIDATION_ERROR')
        return { status: 200, body: { success: true, data: { phone: p, is_dnc: await isDnc(e, p) } } }
      }
      case 'dncAdd': {
        if (!dncReady(e)) return fail(503, 'The DND list needs the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const p = toE164ish(req.phone)
        if (p.length < 10 || p.length > 15) return fail(422, 'The number must have 10–15 digits.', 'VALIDATION_ERROR')
        return await dialerApi(e, 'POST', '/api/dnc', { phone: p, reason: String(req.reason ?? 'Customer asked not to be called').slice(0, 200), source: 'rexera-crm' })
      }
      case 'campaigns': {
        if (!dncReady(e)) return fail(503, 'Blutec campaigns need the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const r = await dialerApi(e, 'GET', '/api/campaigns?limit=100')
        if (r.status !== 200) return r
        return { status: 200, body: { success: true, data: rows(r.body, 'campaigns') } }
      }
      case 'campaignsByIds': {
        const ids = new Set((Array.isArray(req.ids) ? req.ids : []).map(Number).filter(Number.isFinite))
        if (!ids.size) return { status: 200, body: { success: true, data: [] } }
        if (!dncReady(e)) return fail(503, 'Blutec campaigns need the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const r = await dialerApi(e, 'GET', '/api/campaigns?limit=100')
        if (r.status !== 200) return r
        return { status: 200, body: { success: true, data: rows(r.body, 'campaigns').filter((c) => ids.has(Number((c as { id?: unknown }).id))) } }
      }
      case 'campaignLeads': {
        if (!dncReady(e)) return fail(503, 'Blutec campaigns need the Blutec API token (BLUTEC_TOKEN).', 'NOT_CONFIGURED')
        const lists = await dialerApi(e, 'GET', `/api/campaigns/${Number(req.id)}/lead-lists`)
        if (lists.status !== 200) return lists
        // ponytail: first 500 leads of each list; page through /leads?page= if lists grow bigger
        const pages = await Promise.all(rows(lists.body, 'lead_lists').map((l) => dialerApi(e, 'GET', `/api/lead-lists/${Number((l as { id: number }).id)}/leads?limit=500`)))
        return { status: 200, body: { success: true, data: pages.flatMap((p) => p.status === 200 ? rows(p.body, 'leads') : []) } }
      }
      case 'callStatus':
        if (!dialerReady(e)) return fail(503, 'Click-to-call is not configured.', 'NOT_CONFIGURED')
        if (!/^[\w-]{8,64}$/.test(req.refId)) return fail(422, 'Bad call reference.', 'VALIDATION_ERROR')
        return await signed(e, 'GET', `/api/v1/calls/${req.refId}`)
      case 'ivrList':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        return await ivr(e, 'GET', '/api/ivr')
      case 'ivrGet':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        return await ivr(e, 'GET', `/api/ivr/${Number(req.id)}`)
      case 'ivrStats':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        return await ivr(e, 'GET', `/api/ivr/${Number(req.id)}/broadcast/stats`)
      case 'ivrControl':
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        if (!['start', 'pause', 'resume', 'stop'].includes(req.op)) return fail(422, 'Unknown broadcast action.', 'VALIDATION_ERROR')
        return await ivr(e, 'POST', `/api/ivr/${Number(req.id)}/broadcast/${req.op}`)
      case 'ivrCalls': {
        if (!ivrReady(e)) return fail(503, 'IVR is not configured.', 'NOT_CONFIGURED')
        const q = new URLSearchParams({ page: String(Math.max(1, Number(req.page) || 1)), limit: String(Math.min(500, Math.max(1, Number(req.limit) || 100))) })
        return await ivr(e, 'GET', `/api/ivr/${Number(req.id)}/broadcast/calls?${q}`)
      }
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

/**
 * Reads the settings from an environment map (Node process.env, Vite loadEnv, or Deno.env.toObject()).
 * BTC_KEY_ID / BTC_API_KEY / BTC_SIGNING_SECRET (the names in Blutec's own guide) work too.
 */
export function blutecEnv(env: Record<string, string | undefined>): BlutecEnv {
  const v = (...keys: string[]) => keys.map((k) => env[k]?.trim()).find(Boolean)
  return {
    dialerUrl: v('BLUTEC_DIALER_URL'), keyId: v('BLUTEC_KEY_ID', 'BTC_KEY_ID'), apiKey: v('BLUTEC_API_KEY', 'BTC_API_KEY'),
    signingSecret: v('BLUTEC_SIGNING_SECRET', 'BTC_SIGNING_SECRET'), callerId: v('BLUTEC_CALLER_ID')?.replace(/\D/g, '') || undefined, token: v('BLUTEC_TOKEN', 'BLUTEC_API_TOKEN'),
    ivrUrl: v('BLUTEC_IVR_URL'), ivrEmail: v('BLUTEC_IVR_EMAIL'), ivrPassword: v('BLUTEC_IVR_PASSWORD'),
  }
}
