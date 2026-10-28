import type { ClientEntry, ClientEntryStatus, DB, User } from './types'
import { effectivePerms, isMaster, rolesOf } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { isPhone, normPhone, nowIso, today, uid } from './format'

/**
 * Client entry (pre-CRM entry): sales person → dialer → client entry → follow-ups (if needed) → CRM entry. The sales
 * person fills it while the call is on; the CRM entry is made from it once the payment is received, and only that
 * counts as a CRM entry. Shown only on the sales person's and team leader's dashboards.
 */
type Tone = 'navy' | 'orange' | 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'gray' | 'cyan' | 'pink'
export const CLIENT_ENTRY_STATUS: Record<ClientEntryStatus, { label: string; tone: Tone }> = {
  INTERESTED: { label: 'Interested', tone: 'blue' },
  HOT: { label: 'Hot prospect', tone: 'orange' },
  CALL_BACK: { label: 'Call back', tone: 'amber' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'violet' },
  NOT_INTERESTED: { label: 'Not interested', tone: 'red' },
  CONVERTED: { label: 'Converted to CRM entry', tone: 'green' },
}
/** What the sales person can pick (Converted comes only from making the CRM entry). */
export const ENTRY_STATUSES: ClientEntryStatus[] = (Object.keys(CLIENT_ENTRY_STATUS) as ClientEntryStatus[]).filter((s) => s !== 'CONVERTED')

function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }

/** Sales people and team leaders make their CRM entries from a client entry (Super Admin / IT are not held to it). */
export const startsFromClientEntry = (u: User) => !isMaster(u) && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead')
const usesEntries = (d: DB, u: User) => rolesOf(u).some((r) => r === 'sales' || r === 'teamlead') && effectivePerms(d, u).has('dialer.use')

/** The person's own entries; a team leader also sees their team's. */
export function visibleClientEntries(d: DB, me: User): ClientEntry[] {
  if (!rolesOf(me).some((r) => r === 'sales' || r === 'teamlead')) return []
  const team = new Set(d.users.filter((u) => u.teamLeadId === me.id).map((u) => u.id))
  return (d.clientEntries ?? []).filter((e) => e.ownerId === me.id || team.has(e.ownerId))
}
/** The open entry for a lead (one per lead until it is converted or dropped). */
export const openEntryForLead = (d: DB, leadId: string) => (d.clientEntries ?? []).find((e) => e.leadId === leadId && e.status !== 'CONVERTED' && e.status !== 'NOT_INTERESTED')
/** Entries the person can turn into a CRM entry now: their own, not yet converted. */
export const convertibleEntries = (d: DB, me: User) => (d.clientEntries ?? []).filter((e) => e.ownerId === me.id && e.status !== 'CONVERTED' && e.status !== 'NOT_INTERESTED')
export const followUpDue = (e: ClientEntry, t = today()) => !!e.followUp && e.followUp <= t && e.status !== 'CONVERTED' && e.status !== 'NOT_INTERESTED'

export interface ClientEntryForm {
  date: string; clientName: string; companyName: string; phone: string; serviceId: string
  pitchedPrice: number | ''; status: ClientEntryStatus | ''; requirement: string; note: string; followUp: string
}
export const emptyEntry = (lead?: { name: string; company: string; phone: string; requirement?: string; service?: string; price?: number }, d?: DB): ClientEntryForm => ({
  date: today(), clientName: lead?.name ?? '', companyName: lead?.company ?? '', phone: lead?.phone ?? '',
  serviceId: (lead?.service && d?.services.find((s) => s.active && s.name === lead.service)?.id) || '',
  pitchedPrice: lead?.price ?? '', status: '', requirement: lead?.requirement ?? '', note: '', followUp: '',
})

/** Every field but the follow-up is compulsory. Answers field → problem. */
export function entryProblems(d: DB, f: ClientEntryForm): Partial<Record<keyof ClientEntryForm, string>> {
  const p: Partial<Record<keyof ClientEntryForm, string>> = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) p.date = 'Required'
  if (f.clientName.trim().length < 2) p.clientName = 'Required'
  if (f.companyName.trim().length < 2) p.companyName = 'Required'
  if (!isPhone(f.phone)) p.phone = 'A valid 10-digit mobile is required'
  if (!d.services.some((s) => s.id === f.serviceId)) p.serviceId = 'Pick the scheme'
  if (f.pitchedPrice === '' || !Number.isFinite(Number(f.pitchedPrice)) || Number(f.pitchedPrice) <= 0) p.pitchedPrice = 'Enter the price you pitched'
  if (!f.status || !ENTRY_STATUSES.includes(f.status)) p.status = 'Pick the status'
  if (f.requirement.trim().length < 3) p.requirement = 'Required'
  if (f.note.trim().length < 3) p.note = 'Required'
  if (f.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(f.followUp)) p.followUp = 'Pick a date'
  return p
}

const LABELS: Record<keyof ClientEntryForm, string> = {
  date: 'Date', clientName: 'Client name', companyName: 'Company name', phone: 'Number', serviceId: 'Scheme', pitchedPrice: 'Pitched price',
  status: 'Status', requirement: 'Requirement', note: 'Note', followUp: 'Follow-up',
}

/** Saves the client entry the sales person filled (while on the call, or after it). Answers its id. */
export function createClientEntry(me: User, f: ClientEntryForm, leadId?: string) {
  const d0 = getDb()
  assert(usesEntries(d0, me), 'Client entries are made by sales people and team leaders from the dialer.')
  const missing = Object.keys(entryProblems(d0, f)) as (keyof ClientEntryForm)[]
  assert(!missing.length, `Fill in every field: ${missing.map((k) => LABELS[k]).join(', ')}.`)
  assert(!leadId || !openEntryForLead(d0, leadId), 'This client already has an open client entry — add a follow-up to it instead.')
  return mutate((d) => {
    const svc = d.services.find((s) => s.id === f.serviceId)!
    const at = nowIso()
    const e: ClientEntry = {
      id: uid('ce-'), date: f.date, clientName: f.clientName.trim(), companyName: f.companyName.trim(), phone: normPhone(f.phone),
      serviceId: svc.id, scheme: svc.name, pitchedPrice: Number(f.pitchedPrice), status: f.status as ClientEntryStatus,
      requirement: f.requirement.trim(), note: f.note.trim(), followUp: f.followUp || undefined, followUps: [],
      leadId, ownerId: me.id, createdAt: at, updatedAt: at,
    }
    d.clientEntries = [e, ...(d.clientEntries ?? [])]
    // the lead keeps the latest status and follow-up, so the dialer queue shows it
    const l = leadId ? d.leads.find((x) => x.id === leadId) : undefined
    if (l) {
      if (e.status === 'HOT' || e.status === 'PAYMENT_PENDING' || e.status === 'INTERESTED') l.status = 'HOT_PROSPECT'
      else if (e.status === 'CALL_BACK') l.status = 'CALL_BACK'
      else if (e.status === 'NOT_INTERESTED') l.status = 'NOT_INTERESTED'
      if (e.followUp) l.followUp = e.followUp
    }
    d.audit.unshift({ id: uid('a-'), at, by: me.id, action: 'CLIENT_ENTRY_CREATE', detail: `${e.clientName} · ${e.companyName} · ${e.scheme}` })
    if (d.audit.length > 1000) d.audit.length = 1000
    return e.id
  })
}

/** A follow-up on an entry: what happened, the new status and (optionally) the next follow-up date. */
export function addClientFollowUp(me: User, id: string, x: { status: ClientEntryStatus; note: string; next?: string }) {
  const d0 = getDb()
  const e0 = (d0.clientEntries ?? []).find((e) => e.id === id)
  assert(e0, 'Client entry not found.')
  assert(visibleClientEntries(d0, me).some((e) => e.id === id), 'Only the sales person or their team leader can follow up this client.')
  assert(e0.status !== 'CONVERTED', 'This client is already a CRM entry.')
  assert(ENTRY_STATUSES.includes(x.status), 'Pick the status.')
  assert(x.note.trim().length >= 3, 'Write what happened on this follow-up.')
  assert(!x.next || /^\d{4}-\d{2}-\d{2}$/.test(x.next), 'Pick the next follow-up date.')
  mutate((d) => {
    const e = d.clientEntries!.find((y) => y.id === id)!
    const at = nowIso()
    e.followUps.unshift({ id: uid('cf-'), at, by: me.id, date: today(), status: x.status, note: x.note.trim() })
    e.status = x.status
    e.followUp = x.next || undefined
    e.updatedAt = at
    const l = e.leadId ? d.leads.find((y) => y.id === e.leadId) : undefined
    if (l) { l.followUp = e.followUp; if (x.status === 'NOT_INTERESTED') l.status = 'NOT_INTERESTED' }
  })
}

/** createBooking calls this inside its change: the entry becomes Converted, linked to the new CRM entry. */
export function markConverted(d: DB, me: User, entryId: string, bookingId: string) {
  const e = (d.clientEntries ?? []).find((x) => x.id === entryId)
  assert(e, 'Client entry not found.')
  assert(e.ownerId === me.id, 'Only the sales person who made the client entry can convert it.')
  assert(e.status !== 'CONVERTED', 'This client entry is already a CRM entry.')
  const at = nowIso()
  e.status = 'CONVERTED'
  e.bookingId = bookingId
  e.convertedAt = at
  e.followUp = undefined
  e.updatedAt = at
}
