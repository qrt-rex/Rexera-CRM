import type { Booking, ClientEntry, ClientMessage, DB, User } from './types'
import { rolesOf } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { CLOUD } from './cloud'
import { getSupabase } from './supabase'
import { BOOKING_STATUS, STAGES } from './workflow'
import { CLIENT_ENTRY_STATUS } from './clientEntries'
import { normPhone, nowIso, uid } from './format'
import {
  canEditTemplates, DEFAULT_TEMPLATES, fillMessage, messageProblem, stageClosed, stageOf, stagesFor, templatesWith,
  type Channel, type MessageRecord, type MessageStage, type MessageStageId, type MessageStatus, type MessageTemplate,
} from '../../supabase/message-rules.mjs'

/**
 * Client communication (WhatsApp and email) from a CRM entry or a client entry. The live server sends and records
 * every message (server/clientMessages.mjs); the rules — who sends what, when — are shared (supabase/message-rules.mjs).
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }

export type Target = { kind: 'booking'; b: Booking } | { kind: 'entry'; e: ClientEntry }
const isEmail = (s?: string) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

/** The record as the rules see it (status, stage, owner, their team leader). */
export function recordOf(d: DB, t: Target): MessageRecord {
  if (t.kind === 'booking') return { kind: 'booking', status: t.b.status, holdFrom: t.b.holdFrom, stage: t.b.stage, ownerId: t.b.createdBy, teamLeadId: t.b.teamLeadId }
  return { kind: 'entry', status: t.e.status, ownerId: t.e.ownerId, teamLeadId: d.users.find((u) => u.id === t.e.ownerId)?.teamLeadId }
}
/** Where a message goes: the email / mobile saved on the record (the server uses the same, never one typed here). */
export function contactOf(t: Target): { email?: string; phone?: string } {
  if (t.kind === 'booking') return { email: isEmail(t.b.email) ? t.b.email : isEmail(t.b.paymentEmail) ? t.b.paymentEmail : undefined, phone: normPhone(t.b.mobile) || normPhone(t.b.paymentContact ?? '') || undefined }
  return { email: isEmail(t.e.email) ? t.e.email : undefined, phone: normPhone(t.e.phone) || undefined }
}
/** The messages this person may send about this record, each with why it is closed (if it is). */
export function stagesOpen(d: DB, me: User, t: Target): { stage: MessageStage; closed: string | null }[] {
  const rec = recordOf(d, t)
  return stagesFor(rolesOf(me), me.id, rec).map((stage) => ({ stage, closed: stageClosed(stage.id, rec) }))
}
export const mayMessage = (d: DB, me: User, t: Target) => stagesOpen(d, me, t).length > 0

/** {placeholders} for this record and sender. */
export function varsOf(d: DB, me: User, t: Target): Record<string, string> {
  const base = { team_member: me.name, team_phone: me.phone ?? '', our_company: d.settings.companyName || 'Rexera' }
  if (t.kind === 'booking') {
    const b = t.b
    return { ...base, client_name: b.contactPerson, company: b.companyName, application_no: b.bookingId, status: BOOKING_STATUS[b.status]?.label ?? b.status, stage: `${b.stage}. ${STAGES[b.stage - 1] ?? ''}`, service: b.serviceName }
  }
  const e = t.e
  return { ...base, client_name: e.clientName, company: e.companyName, application_no: 'your enquiry', status: CLIENT_ENTRY_STATUS[e.status]?.label ?? e.status, stage: 'Enquiry', service: e.scheme }
}

// ------------------------------------------------------------------ templates (Operation Team / Admin)
export const templatesOf = (d: DB) => templatesWith(d.settings.clientTemplates as Record<string, Partial<MessageTemplate>> | undefined)
export const mayEditTemplates = (me: User) => canEditTemplates(rolesOf(me))
/** A stage's template filled for this record and sender. */
export function draftFor(d: DB, me: User, t: Target, stage: MessageStageId) {
  const tpl = templatesOf(d)[stage], v = varsOf(d, me, t)
  return { subject: fillMessage(tpl.subject, v), email: fillMessage(tpl.email, v), whatsapp: fillMessage(tpl.whatsapp || tpl.email, v) }
}
export function saveTemplate(me: User, stage: MessageStageId, x: MessageTemplate) {
  assert(mayEditTemplates(me), 'Only the Operation Team and Admin edit the message templates.')
  assert(stageOf(stage), 'Unknown message.')
  assert(x.subject.trim().length >= 3 && x.subject.length <= 200, 'Write the email subject (3–200 characters).')
  assert(x.email.trim().length >= 3 && x.email.length <= 6000, 'Write the email text (up to 6000 characters).')
  assert(x.whatsapp.length <= 900, 'A WhatsApp message can be up to 900 characters.')
  mutate((d) => {
    d.settings.clientTemplates = { ...(d.settings.clientTemplates ?? {}), [stage]: { subject: x.subject.trim(), email: x.email.trim(), whatsapp: x.whatsapp.trim(), updatedAt: nowIso(), updatedBy: me.id } }
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'CLIENT_TEMPLATE', detail: `${stageOf(stage)!.label} template edited` })
  })
}
export function resetTemplate(me: User, stage: MessageStageId) {
  assert(mayEditTemplates(me), 'Only the Operation Team and Admin edit the message templates.')
  mutate((d) => {
    const next = { ...(d.settings.clientTemplates ?? {}) }
    delete next[stage]
    d.settings.clientTemplates = next
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'CLIENT_TEMPLATE', detail: `${stageOf(stage)!.label} template back to the built-in text` })
  })
}
export { DEFAULT_TEMPLATES }

// ------------------------------------------------------------------ the log
export const messagesFor = (d: DB, t: Target) => (d.clientMessages ?? []).filter((m) => (t.kind === 'booking' ? m.bookingId === t.b.id : m.clientEntryId === t.e.id))
/** The last good send of a stage on a channel (to show "sent on …" next to its button). */
export const lastSent = (d: DB, t: Target, stage: string, channel: Channel) => messagesFor(d, t).find((m) => m.stage === stage && m.channel === channel && (m.status === 'SENT' || m.status === 'MANUAL'))

// ------------------------------------------------------------------ sending
export interface SendInput { stage: MessageStageId; channel: Channel; subject?: string; body: string; manual?: boolean; requestId: string }
export interface SendResult { ok: boolean; status: MessageStatus | 'ERROR'; message: string }
export const newRequestId = () => `cm-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`

/**
 * Sends one message on one channel (the server checks and records it). `manual`: it was sent from the person's own
 * WhatsApp / mail app — only recorded. Browser mode (no live server): recorded here, nothing is sent.
 */
export async function sendMessage(me: User, t: Target, x: SendInput): Promise<SendResult> {
  const ids = t.kind === 'booking' ? { bookingId: t.b.id } : { clientEntryId: t.e.id }
  const problem = messageProblem({ ...x, ...ids })
  if (problem) return { ok: false, status: 'ERROR', message: problem }
  const rec = recordOf(getDb(), t)
  const allowed = stagesFor(rolesOf(me), me.id, rec).some((s) => s.id === x.stage)
  if (!allowed) return { ok: false, status: 'ERROR', message: 'Your team does not send this message.' }
  const closed = stageClosed(x.stage, rec)
  if (closed) return { ok: false, status: 'ERROR', message: closed }
  const to = x.channel === 'EMAIL' ? contactOf(t).email : contactOf(t).phone
  if (!to) return { ok: false, status: 'ERROR', message: x.channel === 'EMAIL' ? 'No email address is saved for this client — add it to the record first.' : 'No valid 10-digit mobile number is saved for this client.' }

  if (!CLOUD) {
    // browser mode: nothing can be sent from here — the attempt (or the manual send) is recorded locally
    const status: MessageStatus = x.manual ? 'MANUAL' : 'NOT_CONFIGURED'
    mutate((d) => {
      const m: ClientMessage = { id: x.requestId, ...ids, stage: x.stage, channel: x.channel, to, ...(x.channel === 'EMAIL' ? { subject: x.subject?.trim() } : {}), body: x.body.trim(), status, ...(x.manual ? {} : { error: 'Sending needs the live CRM server.' }), by: me.id, at: nowIso() }
      if (!(d.clientMessages ?? []).some((y) => y.id === m.id)) d.clientMessages = [m, ...(d.clientMessages ?? [])]
    })
    return x.manual ? { ok: true, status, message: 'Recorded.' } : { ok: false, status, message: 'Sending works on the live CRM. Here, use “Send from my WhatsApp” / “Send from my mail app”.' }
  }
  try {
    const { data: { session } } = await (await getSupabase()).auth.getSession()
    const res = await fetch('/api/client-message', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ ...x, ...ids, subject: x.channel === 'EMAIL' ? x.subject : undefined }),
    })
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return { ok: false, status: 'ERROR', message: 'This copy of the CRM has no server for sending.' }
    const j = await res.json().catch(() => ({})) as { success?: boolean; status?: MessageStatus; message?: string }
    return { ok: !!j.success, status: j.status ?? 'ERROR', message: j.message ?? `The server answered ${res.status}.` }
  } catch {
    // the server may still have sent it: the same request id is answered once if it is tried again
    return { ok: false, status: 'ERROR', message: 'The CRM server could not be reached — check the message log before trying again.' }
  }
}

/** Open WhatsApp / the mail app with the message ready (the person sends it themselves). */
export const whatsappLink = (phone: string, text: string) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
export const mailLink = (to: string, subject: string, body: string) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
