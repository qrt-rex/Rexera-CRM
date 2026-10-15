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
export interface IvrCall { id: number; phone: string; state?: string; digit_pressed?: string | null; duration_seconds?: number; cli?: string; created_at?: string }
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
  ivrCalls: (id: number, page: number, limit: number) => call<{ items?: IvrCall[]; pagination?: { page: number; limit: number; total: number } }>({ action: 'ivrCalls', id, page, limit }),
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
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return
    for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') { if (depth < 2) walk(v, depth + 1) } else if (!fields.has(norm(k))) fields.set(norm(k), v) }
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
    interested: num('interested', 'pressed1', 'pressedkey', 'keypressed', 'keypresses', 'dtmf1', 'pressed') || like('interest'),
  }
}

