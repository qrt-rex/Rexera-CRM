// Blutec webhooks → the CRM (Supabase). Two feeds, each with its own signing secret from Blutec:
//  * IVR / OBD "interested" (POST /api/blutec/webhook/ivr, BLUTEC_IVR_WEBHOOK_SECRET): a caller pressed the key mapped
//    to an Interested disposition → that lead is created (or marked) as a hot prospect.
//  * Dialer calls (POST /api/blutec/webhook/calls, BLUTEC_CALLS_WEBHOOK_SECRET): call.initiated / call.completed of
//    CRM click-to-calls → the finished call lands in the lead's call history.
// Deliveries are verified as Blutec documents: X-Webhook-Signature = hex HMAC-SHA256(secret, `${timestamp}.${raw body}`)
// with X-Webhook-Timestamp. The server answers at once and stores afterwards; repeats are dropped (event + reference).
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { dispositionToStatus } from '../src/lib/workflow.ts'
import { blutecEnv, revealWebhookSecret } from '../supabase/functions/_shared/blutec.ts'

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Is this delivery really from Blutec? `timestamp` in seconds or ms; older than 10 minutes is refused (replays). */
export function verifySignature(secret, timestamp, rawBody, signature, now = Date.now()) {
  if (!secret || !signature) return false
  // with a timestamp Blutec signs `timestamp.body` (and old deliveries are replays); without one, the body alone
  if (timestamp) {
    const t = Number(timestamp)
    const ms = t > 1e12 ? t : t * 1000
    if (!Number.isFinite(ms) || Math.abs(now - ms) > 10 * 60_000) return false
  }
  const mac = crypto.createHmac('sha256', secret).update(timestamp ? `${timestamp}.${rawBody}` : rawBody).digest()
  const sig = String(signature).replace(/^sha256=/i, '').trim()
  // hex (any case) or base64
  return same(mac.toString('hex'), sig.toLowerCase()) || same(mac.toString('base64'), sig)
}
/** The webhook's secret token, sent as Authorization: Bearer whk_… (checked when it's set on the server). */
export const tokenOk = (expected, authorization) => !expected || same(`Bearer ${expected}`, String(authorization ?? '').trim())

/** Indian mobile as the CRM stores it (10 digits), or ''. */
export const tenDigits = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}

/** What an ivr.interested delivery says about the lead. */
export function ivrLead(p) {
  const data = p.lead?.custom_data ?? {}
  const phone = tenDigits(p.lead?.phone)
  const name = String(data.name ?? data.Name ?? '').trim() || `IVR lead ${phone.slice(-4)}`
  const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !['name', 'Name', 'city', 'City'].includes(k)).map(([k, v]) => [k, String(v)]))
  return {
    phone, name, email: String(p.lead?.email ?? '').trim().toLowerCase() || null, city: String(data.city ?? data.City ?? '').trim(),
    source: `IVR: ${p.ivr?.name ?? 'campaign'}`, at: p.occurred_at ?? new Date().toISOString(),
    note: `Pressed ${p.digit ?? 'the key'} (${p.disposition?.name ?? 'Interested'}) in “${p.ivr?.name ?? 'IVR'}”${p.call?.duration_seconds != null ? ` · ${p.call.duration_seconds}s call` : ''}`,
    extra: Object.keys(extra).length ? extra : null,
  }
}

/** The lead_calls row for a finished CRM click-to-call (call.completed), or null when it isn't linked to a lead. */
export function completedCall(p) {
  const c = p.payload?.call ?? p.call ?? {}
  const ref = p.payload?.ref_id ?? c.ref_id ?? c.call_uuid
  const ids = p.payload?.custom_identifier ?? p.custom_identifier ?? {}
  if (!ref || !ids.crm_lead_id) return null
  const fromBlutec = dispositionToStatus(c.disposition)
  const outcome = fromBlutec && fromBlutec !== 'NEW' ? fromBlutec : c.answer_time ? 'ANSWER' : 'NOT_PICKUP'
  return {
    id: `bt-${ref}`, lead_id: String(ids.crm_lead_id), called_at: c.start_time ?? c.end_time ?? new Date().toISOString(), called_by: ids.crm_user_id ? String(ids.crm_user_id) : null,
    outcome, note: [`Blutec call · ${String(c.status ?? 'completed').replace(/_/g, ' ')}`, c.hangup_cause && String(c.hangup_cause).replace(/_/g, ' ').toLowerCase(), c.disposition].filter(Boolean).join(' · '),
    duration_sec: Math.max(0, Math.round(Number(c.talk_duration_seconds ?? c.duration_seconds ?? 0)) || 0),
  }
}

const reply = (status, body) => ({ status, body })
const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

// the dialer webhook's secret can come straight from Blutec (BLUTEC_TOKEN) instead of Render; kept here once read
let revealed = null
async function callsSecret(env, fresh) {
  if (fresh || !revealed) revealed = await revealWebhookSecret(blutecEnv({ BLUTEC_TOKEN: env('BLUTEC_TOKEN'), BLUTEC_API_TOKEN: env('BLUTEC_API_TOKEN'), BLUTEC_DIALER_URL: env('BLUTEC_DIALER_URL') })).catch(() => null)
  return revealed
}

/**
 * Checks one delivery. Resolves with the HTTP answer and a `work` promise that stores it (run after answering:
 * Blutec retries slow endpoints). `kind` is 'ivr' or 'calls'.
 */
export async function receive(env, kind, headers, rawBody) {
  const name = kind === 'ivr' ? 'BLUTEC_IVR_WEBHOOK_SECRET' : 'BLUTEC_CALLS_WEBHOOK_SECRET'
  // header names differ between Blutec's webhook screens (X-Webhook-Signature / X-Signature …)
  const ts = headers['x-webhook-timestamp'] ?? headers['x-timestamp'], sig = headers['x-webhook-signature'] ?? headers['x-signature']
  if (!tokenOk(env(kind === 'ivr' ? 'BLUTEC_IVR_WEBHOOK_TOKEN' : 'BLUTEC_CALLS_WEBHOOK_TOKEN'), headers.authorization)) return { answer: reply(401, { success: false, message: 'Bad token' }) }
  let secret = env(name) || (kind === 'calls' ? await callsSecret(env, false) : '')
  if (!secret) return { answer: reply(503, { success: false, message: kind === 'ivr' ? `Set ${name} on the server.` : `Set ${name} on the server, or connect the webhook from the Dialer (Super Admin).` }) }
  let ok = verifySignature(secret, ts, rawBody, sig)
  // a secret read from Blutec may have been renewed there since: read it once more
  if (!ok && kind === 'calls' && !env(name)) { secret = await callsSecret(env, true); ok = !!secret && verifySignature(secret, ts, rawBody, sig) }
  if (!ok) return { answer: reply(401, { success: false, message: 'Bad signature' }) }
  let p
  try { p = JSON.parse(rawBody) } catch { return { answer: reply(400, { success: false, message: 'Bad JSON' }) } }
  const sb = admin(env)
  if (!sb) return { answer: reply(503, { success: false, message: 'Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.' }) }
  return { answer: reply(200, { success: true }), work: store(sb, kind, p) }
}

async function store(sb, kind, p) {
  const event = String(p.event ?? 'unknown')
  const ref = String(kind === 'ivr' ? `${p.ivr?.id ?? ''}:${p.lead?.id ?? ''}:${p.call?.id ?? p.occurred_at ?? ''}` : (p.payload?.ref_id ?? p.call?.call_uuid ?? p.occurred_at ?? ''))
  // every delivery is kept once (Blutec may send one twice); a repeat stops here
  const { data: fresh, error } = await sb.from('blutec_webhook_events')
    .upsert({ kind, event, ref, payload: p, test: !!p.test }, { onConflict: 'kind,event,ref', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`saving the ${event} delivery: ${error.message}`)
  if (!fresh?.length || p.test) return
  if (kind === 'ivr' && event === 'ivr.interested') await ivrInterested(sb, ivrLead(p))
  if (kind === 'calls' && event === 'call.completed') {
    const row = completedCall(p)
    if (!row) return
    const { data: lead } = await sb.from('leads').select('id').eq('id', row.lead_id).maybeSingle()
    if (!lead) return
    if (row.called_by) { const { data: u } = await sb.from('app_users').select('id').eq('id', row.called_by).maybeSingle(); if (!u) row.called_by = null }
    // the agent may have saved this call already (same id): theirs is kept
    const { error: e } = await sb.from('lead_calls').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
    if (e) throw new Error(`saving the call: ${e.message}`)
  }
}

/** A hot prospect from the IVR: a new unassigned lead (for the Super Admin to hand out), or the existing lead marked hot. */
async function ivrInterested(sb, x) {
  if (!x.phone) return
  const now = new Date().toISOString()
  const event = { at: x.at, by: '', action: 'IVR · pressed the key (interested)', note: x.note }
  const { data: old } = await sb.from('leads').select('id, name, status, assigned_to, history').eq('phone', x.phone).maybeSingle()
  const superAdmins = async () => ((await sb.from('app_users').select('id').eq('role', 'superadmin').eq('active', true)).data ?? []).map((u) => u.id)
  const notify = async (ids, title, body) => { if (ids.length) await sb.from('notifications').insert(ids.map((user_id) => ({ user_id, title, body, link: '/leads', kind: 'action', created_at: now }))) }
  if (old) {
    const keep = ['CONVERTED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'DND', 'SCRAP'].includes(old.status)
    await sb.from('leads').update({ ...(keep ? {} : { status: 'HOT_PROSPECT' }), history: [event, ...(old.history ?? [])].slice(0, 200) }).eq('id', old.id)
    await notify(old.assigned_to ? [old.assigned_to] : await superAdmins(), 'IVR: your lead is interested', `${old.name} — ${x.note}`)
    return
  }
  // LD- numbers come from the shared counter (the unique code stops two devices taking the same one)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: s } = await sb.from('app_settings').select('value').eq('key', 'counters').maybeSingle()
    const counters = s?.value ?? { booking: 1, lead: 1, invoice: 1 }
    const code = `LD-${counters.lead}`
    const { error } = await sb.from('leads').insert({
      id: `lead-ivr-${crypto.randomUUID().slice(0, 12)}`, code, name: x.name, phone: x.phone, email: x.email, city: x.city, state: '', company: '', service: '',
      source: x.source, status: 'HOT_PROSPECT', notes: '', created_at: x.at, extra: x.extra, history: [event],
    })
    if (!error) {
      await sb.from('app_settings').upsert({ key: 'counters', value: { ...counters, lead: counters.lead + 1 } }, { onConflict: 'key' })
      await notify(await superAdmins(), 'New hot prospect from the IVR', `${x.name} · ${x.phone} — assign it from CRM Leads → Unassigned`)
      return
    }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`creating the IVR lead: ${error.message}`)
    if (/phone/i.test(error.message)) return // the number arrived from another delivery meanwhile
    await sb.from('app_settings').upsert({ key: 'counters', value: { ...counters, lead: counters.lead + 1 } }, { onConflict: 'key' })
  }
}
