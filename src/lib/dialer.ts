/**
 * Talks to the Blutec relay at /api/blutec — the local dev server (vite.config.ts) or, on the live site, server.mjs. Secrets live only on the relay; the browser never sees them.
 */
export interface BlutecStatus { dialer: boolean; ivr: boolean; dnc?: boolean; dialerUrl: string; ivrUrl: string }
export interface CallStatus {
  ref_id: string; status: string; agent_name?: string; destination_number?: string
  start_time?: string; answer_time?: string; end_time?: string; duration_seconds?: number; talk_duration_seconds?: number
  hangup_cause?: string; disposition?: string; recording_status?: string
}
export interface Ivr { id: number; name: string; status: string; broadcast_status: string; max_concurrent_calls?: number; agent_connect_enabled?: boolean }
export interface IvrStats { broadcast_status: string; dialing_now: number; total_leads: number; dialed: number; answered: number; pressed_1: number; remaining: number }
export interface AgentConnect { id: number; lead_phone: string; agent_name: string; status: string; wait_seconds: number; talk_seconds: number; hangup_by?: string; recording?: boolean; created_at: string }

export class DialerError extends Error { constructor(message: string, public code?: string, public status?: number) { super(message) } }

const KEY = 'rexera-dialer-key'
/** The access key this computer sends to the live server (set once in the Dialer → connection window). */
export const dialerKey = {
  get: () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } },
  set: (k: string) => { try { localStorage.setItem(KEY, k.trim()) } catch { /* ignore */ } },
}

function endpoint(): { url: string; headers: Record<string, string> } {
  if (import.meta.env.DEV) return { url: '/api/blutec', headers: {} }
  // the live server (server.mjs) relays to Blutec with the BLUTEC_* settings from Render
  return { url: '/api/blutec', headers: { 'X-Dialer-Key': dialerKey.get() } }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { url, headers } = endpoint()
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
  clickToCall: (agentEmail: string, phone: string, leadId?: string, attempt = `${Date.now()}`) =>
    call<{ ref_id: string; status: string }>({ action: 'call', agentEmail, phone, leadId, attempt }),
  /** Adds the number to the company's Do-Not-Disturb list in Blutec (no campaign or click-to-call will dial it). */
  dncAdd: (phone: string, reason: string) => call<unknown>({ action: 'dncAdd', phone, reason }),
  callStatus: (refId: string) => call<CallStatus>({ action: 'callStatus', refId }),
  ivrList: () => call<Ivr[]>({ action: 'ivrList' }),
  ivrStats: (id: number) => call<IvrStats>({ action: 'ivrStats', id }),
  ivrControl: (id: number, op: 'start' | 'pause' | 'resume' | 'stop') => call<unknown>({ action: 'ivrControl', id, op }),
  ivrConnects: (dateFrom?: string, dateTo?: string) => call<{ items: AgentConnect[] }>({ action: 'ivrConnects', dateFrom, dateTo }),
}

/** A disposition that means the client is a hot prospect (go straight to a CRM entry). */
export const isHot = (disposition?: string) => !!disposition && /interest|hot|convert|sale|book|ready/i.test(disposition)
export const FINAL_STATUSES = ['completed', 'failed', 'no_answer', 'busy', 'cancelled', 'rejected']
