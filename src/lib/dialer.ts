import { CLOUD } from './cloud'
import { getSupabase } from './supabase'

/**
 * Talks to the Blutec relay at /api/blutec — the local dev server (vite.config.ts) or, on the live site, server.mjs. Secrets live only on the relay; the browser never sees them.
 */
export interface BlutecStatus { dialer: boolean; ivr: boolean; dnc?: boolean; dialerUrl: string; ivrUrl: string }
export interface CallStatus {
  ref_id: string; status: string; agent_name?: string; destination_number?: string
  start_time?: string; answer_time?: string; end_time?: string; duration_seconds?: number; talk_duration_seconds?: number
  hangup_cause?: string; disposition?: string; recording_status?: string
}
export interface BlutecCampaign { id: number; name: string; status: string; total_leads?: number; fresh_leads?: number }
export interface BlutecLead { id: number; phone: string; name?: string; full_name?: string; first_name?: string; last_name?: string; status?: string }
export interface Ivr { id: number; name: string; status: string; broadcast_status: string; max_concurrent_calls?: number; agent_connect_enabled?: boolean }
/** Live broadcast numbers, in Blutec OBD's own terms (Queued · Dialing · Completed · Interested · Total leads). */
export interface IvrStats { broadcast_status: string; total_leads: number; dialed: number; queued: number; dialing: number; completed: number; interested: number }
/** One broadcast call, whatever Blutec names the fields (key = digit pressed, disposition = its name, e.g. INTERESTED). */
export interface IvrCall { id: string; phone: string; name: string; state: string; key: string; disposition: string; duration: number; at: string }
export interface AgentConnect { id: number; lead_phone: string; agent_name: string; status: string; wait_seconds: number; talk_seconds: number; hangup_by?: string; recording?: boolean; created_at: string }

export class DialerError extends Error { constructor(message: string, public code?: string, public status?: number) { super(message) } }

const KEY = 'rexera-dialer-key'
/** The access key this computer sends to the live server (set once in the Dialer → connection window). */
export const dialerKey = {
  get: () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } },
  set: (k: string) => { try { localStorage.setItem(KEY, k.trim()) } catch { /* ignore */ } },
}
/** The IVR access key, kept apart from the dialer key so one computer (the Super Admin's) can run calls and IVR. */
const IVR_KEY = 'rexera-ivr-key'
export const ivrKey = {
  get: () => { try { return localStorage.getItem(IVR_KEY) ?? '' } catch { return '' } },
  set: (k: string) => { try { localStorage.setItem(IVR_KEY, k.trim()) } catch { /* ignore */ } },
}

/** Signed in with Supabase, the server checks the person's own sign-in (no access keys on each computer). */
export const KEYLESS = CLOUD

async function endpoint(): Promise<{ url: string; headers: Record<string, string> }> {
  if (import.meta.env.DEV && !CLOUD) return { url: '/api/blutec', headers: {} }
  if (CLOUD) {
    const { data: { session } } = await (await getSupabase()).auth.getSession()
    return { url: '/api/blutec', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } }
  }
  // the live server (server.mjs) relays to Blutec with the BLUTEC_* settings from Render
  return { url: '/api/blutec', headers: { 'X-Dialer-Key': dialerKey.get(), 'X-Ivr-Key': ivrKey.get() } }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { url, headers } = await endpoint()
  let res: Response
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
  catch { throw new DialerError('Could not reach the dialer relay.', 'OFFLINE') }
  const j = await res.json().catch(() => null) as { success?: boolean; message?: string; code?: string; data?: unknown; ref_id?: string; status?: string } | null
  if (!res.ok || !j || j.success === false) throw new DialerError(j?.message || `Dialer request failed (${res.status}).`, j?.code, res.status)
  return (j.data ?? j) as T
}

export const blutec = {
  status: () => call<BlutecStatus>({ action: 'status' }),
  /**
   * Rings the agent's own phone first, then connects the customer. `attempt` makes the Idempotency-Key: pass the same
   * one only when retrying the same click (e.g. after CHANNEL_LIMIT), so Blutec never dials twice.
   */
  clickToCall: (agentEmail: string, phone: string, leadId?: string, attempt = `${Date.now()}`, userId?: string) =>
    call<{ ref_id: string; status: string }>({ action: 'call', agentEmail, phone, leadId, attempt, userId }),
  /** Adds the number to the company's Do-Not-Disturb list in Blutec (no campaign or click-to-call will dial it). */
  dncAdd: (phone: string, reason: string) => call<unknown>({ action: 'dncAdd', phone, reason }),
  callStatus: (refId: string) => call<CallStatus>({ action: 'callStatus', refId }),
  campaigns: () => call<BlutecCampaign[]>({ action: 'campaigns' }),
  campaignLeads: (id: number) => call<BlutecLead[]>({ action: 'campaignLeads', id }),
  ivrList: () => call<Ivr[]>({ action: 'ivrList' }),
  ivrStats: (id: number) => call<unknown>({ action: 'ivrStats', id }).then(readIvrStats),
  ivrControl: (id: number, op: 'start' | 'pause' | 'resume' | 'stop') => call<unknown>({ action: 'ivrControl', id, op }),
  /** One page of an IVR broadcast's calls (per number: answered or not, key pressed). */
  ivrCalls: (id: number, page: number, limit: number) => call<unknown>({ action: 'ivrCalls', id, page, limit }).then(readIvrCalls),
  ivrConnects: (dateFrom?: string, dateTo?: string) => call<{ items: AgentConnect[] }>({ action: 'ivrConnects', dateFrom, dateTo }),
}

/** A disposition that means the client is a hot prospect (go straight to a CRM entry). */
export const isHot = (disposition?: string) => !!disposition && /interest|hot|convert|sale|book|ready/i.test(disposition)
export const FINAL_STATUSES = ['completed', 'failed', 'no_answer', 'busy', 'cancelled', 'rejected']

/**
 * Blutec's live broadcast stats, read whatever the exact field names (the docs say total_leads, dialed, answered,
 * pressed_1, dialing_now, remaining; accounts can answer in camelCase or one level deeper). The raw answer is logged
 * once per campaign in the console, to check what Blutec really sends.
 */
const logged = new Set<string>()
export function readIvrStats(raw: unknown): IvrStats {
  const fields = new Map<string, unknown>()
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')
  // lists like dispositions: [{ name: 'INTERESTED', count: 2 }] become fields too (interested → 2)
  const countRow = (x: unknown) => {
    if (!x || typeof x !== 'object') return
    const r = x as Record<string, unknown>
    const label = [r.name, r.label, r.disposition, r.outcome, r.key, r.state, r.status].find((v) => typeof v === 'string' && v)
    const n = [r.count, r.total, r.value, r.calls, r.leads].map(Number).find((v) => Number.isFinite(v))
    if (typeof label === 'string' && n !== undefined && !fields.has(norm(label))) fields.set(norm(label), n)
  }
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) { for (const x of v) countRow(x) }
      else if (v && typeof v === 'object') { if (depth < 2) walk(v, depth + 1) }
      else if (!fields.has(norm(k))) fields.set(norm(k), v)
    }
  }
  walk(raw, 0)
  const key = JSON.stringify(Object.keys((raw ?? {}) as object))
  if (!logged.has(key)) { logged.add(key); console.info('[ivr stats] Blutec answered:', raw) }
  const num = (...names: string[]) => { for (const n of names) { const v = Number(fields.get(n)); if (fields.has(n) && Number.isFinite(v)) return v } return 0 }
  // any count whose name mentions the word (e.g. interested_count, total_interested), when no exact name matched
  const like = (word: string) => { for (const [k, v] of fields) if (k.includes(word) && Number.isFinite(Number(v)) && typeof v !== 'boolean') return Number(v); return 0 }
  const text = (...names: string[]) => { for (const n of names) { const v = fields.get(n); if (typeof v === 'string' && v) return v } return '' }
  // OBD answers queued / dialing / completed / interested; the API docs say remaining / dialing_now / answered / pressed_1
  const total = num('totalleads', 'leadstotal', 'totalleadcount', 'leadcount', 'leads', 'total')
  const queued = num('queued', 'queue', 'remaining', 'pending', 'left', 'remainingleads')
  const dialed = num('dialed', 'dialled', 'totaldialed', 'attempted', 'called') || Math.max(0, total - queued)
  return {
    broadcast_status: text('broadcaststatus', 'status', 'state'),
    total_leads: total, dialed, queued,
    dialing: num('dialing', 'dialingnow', 'activecalls', 'inprogress', 'live', 'ringing'),
    completed: num('completed', 'answered', 'connected', 'answeredcalls', 'pickedup'),
    interested: num('interested', 'interestedleads', 'pressed1', 'pressedkey', 'keypressed', 'keypresses', 'dtmf1', 'pressed', 'starred', 'stars', 'hot', 'hotleads') || like('interest') || like('star'),
  }
}


/** Blutec's broadcast call records, read from wherever the list is in the answer (data.items, data.calls, data …). */
const loggedCalls = new Set<string>()
export function readIvrCalls(raw: unknown): { items: IvrCall[]; total: number } {
  let list: Record<string, unknown>[] = [], total = 0
  const find = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { if (!list.length && o.some((x) => x && typeof x === 'object')) list = o as Record<string, unknown>[]; return }
    const r = o as Record<string, unknown>
    for (const k of ['total', 'count', 'total_count', 'totalCount', 'total_records']) if (!total && r[k] != null && Number.isFinite(Number(r[k]))) total = Number(r[k])
    for (const v of Object.values(r)) if (Array.isArray(v)) find(v, depth)
    if (depth < 3) for (const v of Object.values(r)) if (v && typeof v === 'object' && !Array.isArray(v)) find(v, depth + 1)
  }
  find(raw, 0)
  const key = JSON.stringify([Object.keys((raw ?? {}) as object), Object.keys(list[0] ?? {})])
  if (!loggedCalls.has(key)) { loggedCalls.add(key); console.info('[ivr calls] Blutec answered:', raw) }
  const str = (r: Record<string, unknown>, ...names: string[]) => {
    for (const n of names) {
      const v = r[n]
      if (typeof v === 'string' || typeof v === 'number') { if (String(v) !== '') return String(v) }
      else if (v && typeof v === 'object') { const o = v as Record<string, unknown>; const t = o.name ?? o.label; if (typeof t === 'string' && t) return t }
    }
    return ''
  }
  const items = list.map((r, i) => {
    const lead = (r.lead && typeof r.lead === 'object' ? r.lead : {}) as Record<string, unknown>
    const custom = (lead.custom_data && typeof lead.custom_data === 'object' ? lead.custom_data : {}) as Record<string, unknown>
    return {
      id: str(r, 'id', 'call_id', 'uuid') || String(i),
      phone: str(r, 'phone', 'lead_phone', 'number', 'mobile', 'destination', 'destination_number', 'msisdn') || str(lead, 'phone', 'number'),
      name: str(r, 'name', 'lead_name', 'company', 'company_name') || str(custom, 'name', 'company') || str(lead, 'name'),
      state: str(r, 'state', 'status', 'call_state', 'outcome'),
      key: str(r, 'digit_pressed', 'digit', 'keypress', 'key_pressed', 'dtmf', 'pressed_key', 'disposition_digit'),
      disposition: str(r, 'disposition', 'disposition_name', 'disposition_label', 'dispo'),
      duration: Number(r.duration_seconds ?? r.duration ?? r.billsec ?? r.talk_seconds ?? 0) || 0,
      at: str(r, 'created_at', 'called_at', 'last_called_at', 'updated_at', 'start_time', 'date'),
    }
  })
  return { items, total: total || items.length }
}
