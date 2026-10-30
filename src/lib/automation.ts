import type { AutomationAction, AutomationRecipient, AutomationRule, AutomationRun, Booking, ClientEntry, DB, Invoice, Lead, LeaveRequest, Role, User } from './types'
import { isMaster, ROLES, rolesOf } from './rbac'
import { getDb, mutate, onCommit } from './store'
import { ActionError } from './actions'
import { CLOUD, cloudUserId } from './cloud'
import { deliver } from './email'
import { BOOKING_STATUS, LEAD_STATUS, STAGES } from './workflow'
import { CLIENT_ENTRY_STATUS } from './clientEntries'
import { addDays, bookingMoney, daysBetween, invoiceTotals, nowIso, today, uid, ymd } from './format'
import {
  BUILTINS, builtinId, MAX_PER_RUN, ruleEntity, ruleMatches, ruleProblems, scheduleRunId, fillText, triggerOf,
} from '../../supabase/automation-rules.mjs'

/**
 * Automation Center (Workspace → Automation Center). IT Support — and only IT Support — creates rules and switches
 * the built-in automations on or off; Super Admin can look. Event rules run in the browser that made the change
 * (store.onCommit sees what changed); daily checks run in Super Admin / IT browsers with the company jobs (Shell).
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
/** Only IT Support edits automations. */
export const canEditAutomation = (u: User) => rolesOf(u).includes('it')
/** Super Admin and IT see the Automation Center. */
export const canViewAutomation = (u: User) => isMaster(u)
const need = (me: User) => assert(canEditAutomation(me), 'Only the IT Support team can change automations.')

// ------------------------------------------------------------------ facts: what a rule can check and say
type FieldType = 'select' | 'text' | 'number' | 'money' | 'days' | 'bool'
export interface FieldDef { label: string; type: FieldType; options?: { id: string; label: string }[] }
const opts = (r: Record<string, { label: string }>) => Object.entries(r).map(([id, v]) => ({ id, label: v.label }))
const ROLE_OPTS = () => ROLES.map((r) => ({ id: r.id, label: r.label }))
export const FIELDS: Record<string, Record<string, FieldDef>> = {
  booking: {
    status: { label: 'Status', type: 'select', options: opts(BOOKING_STATUS) },
    prevStatus: { label: 'Status before the change', type: 'select', options: opts(BOOKING_STATUS) },
    stage: { label: 'Processing stage (1–8)', type: 'number' },
    prevStage: { label: 'Stage before the change', type: 'number' },
    service: { label: 'Service', type: 'text' },
    company: { label: 'Company name', type: 'text' },
    state: { label: 'Client state', type: 'text' },
    bookingType: { label: 'Booking type', type: 'select', options: [{ id: 'SINGLE', label: 'Single' }, { id: 'MULTIPLE', label: 'Multiple' }, { id: 'COMBO_3', label: 'Combo 3 months' }, { id: 'COMBO_6', label: 'Combo 6 months' }, { id: 'COMBO_9', label: 'Combo 9 months' }, { id: 'COMBO_12', label: 'Combo 12 months' }] },
    priority: { label: 'Priority', type: 'select', options: [{ id: 'LOW', label: 'Low' }, { id: 'MEDIUM', label: 'Medium' }, { id: 'HIGH', label: 'High' }] },
    mode: { label: 'Mode', type: 'select', options: [{ id: 'Refundable', label: 'Refundable' }, { id: 'Non-Refundable', label: 'Non-Refundable' }] },
    quoted: { label: 'Total quoted (₹, before GST)', type: 'money' },
    collected: { label: 'Collected (₹, with GST)', type: 'money' },
    outstanding: { label: 'Outstanding (₹)', type: 'money' },
    payment: { label: 'Payment just added (₹)', type: 'money' },
    documentCategory: { label: 'Document just uploaded (type)', type: 'text' },
    hasOps: { label: 'Operations person assigned', type: 'bool' },
    hasAdmin: { label: 'Admin assigned', type: 'bool' },
    daysInStatus: { label: 'Days since the last decision', type: 'days' },
    daysSinceCreated: { label: 'Days since it was entered', type: 'days' },
    daysToDeadline: { label: 'Days left to the deadline', type: 'days' },
  },
  lead: {
    status: { label: 'Status', type: 'select', options: opts(LEAD_STATUS) },
    prevStatus: { label: 'Status before the change', type: 'select', options: opts(LEAD_STATUS) },
    source: { label: 'Source', type: 'text' },
    service: { label: 'Service', type: 'text' },
    city: { label: 'City', type: 'text' },
    assigned: { label: 'Assigned to someone', type: 'bool' },
    calls: { label: 'Calls made', type: 'number' },
    daysSinceCreated: { label: 'Days since it came in', type: 'days' },
    daysSinceLastCall: { label: 'Days since the last call', type: 'days' },
  },
  clientEntry: {
    status: { label: 'Status', type: 'select', options: opts(CLIENT_ENTRY_STATUS) },
    prevStatus: { label: 'Status before the change', type: 'select', options: opts(CLIENT_ENTRY_STATUS) },
    scheme: { label: 'Scheme', type: 'text' },
    pitchedPrice: { label: 'Pitched price (₹)', type: 'money' },
    followUpOverdueDays: { label: 'Follow-up overdue by (days)', type: 'days' },
    daysSinceCreated: { label: 'Days since it was saved', type: 'days' },
  },
  invoice: {
    type: { label: 'Type', type: 'select', options: [{ id: 'TAX', label: 'Tax invoice' }, { id: 'PROFORMA', label: 'Proforma' }] },
    status: { label: 'Status', type: 'select', options: [{ id: 'ISSUED', label: 'Issued' }, { id: 'PARTIALLY_PAID', label: 'Partially paid' }, { id: 'PAID', label: 'Paid' }, { id: 'CANCELLED', label: 'Cancelled' }] },
    total: { label: 'Total (₹, with GST)', type: 'money' },
    balance: { label: 'Balance due (₹)', type: 'money' },
    daysOverdue: { label: 'Days past the due date', type: 'days' },
    client: { label: 'Client', type: 'text' },
  },
  leave: {
    leaveType: { label: 'Leave type', type: 'select', options: [{ id: 'CL', label: 'CL' }, { id: 'SL', label: 'SL' }, { id: 'EL', label: 'EL' }, { id: 'LOP', label: 'LOP' }] },
    status: { label: 'Status', type: 'select', options: [{ id: 'PENDING', label: 'Pending' }, { id: 'APPROVED', label: 'Approved' }, { id: 'REJECTED', label: 'Rejected' }, { id: 'CANCELLED', label: 'Cancelled' }] },
    days: { label: 'Days', type: 'number' },
    daysUntilStart: { label: 'Days until it starts', type: 'days' },
  },
  user: {
    role: { label: 'Role', type: 'select', options: ROLE_OPTS() },
    department: { label: 'Department', type: 'text' },
  },
}
/** Placeholders a rule's texts can use, by kind of record (shown as chips in the editor). */
export const PLACEHOLDERS: Record<string, string[]> = {
  booking: ['record', 'company', 'client', 'service', 'status', 'stage', 'quoted', 'collected', 'outstanding', 'payment', 'document', 'owner', 'daysInStatus', 'link'],
  lead: ['record', 'client', 'company', 'phone', 'service', 'status', 'owner', 'daysSinceLastCall', 'link'],
  clientEntry: ['record', 'client', 'company', 'scheme', 'status', 'pitchedPrice', 'owner', 'followUpOverdueDays', 'link'],
  invoice: ['record', 'client', 'total', 'balance', 'status', 'daysOverdue', 'owner', 'link'],
  leave: ['record', 'owner', 'leaveType', 'days', 'status', 'link'],
  user: ['record', 'owner', 'role', 'department', 'link'],
}

type Facts = { values: Record<string, unknown>; text: Record<string, string | number> }
type Rec = Booking | Lead | ClientEntry | Invoice | LeaveRequest | User
const nameOf = (d: DB, id?: string) => d.users.find((u) => u.id === id)?.name ?? '—'
const rupees = (n: number) => Math.round(n).toLocaleString('en-IN')
const daysSince = (iso: string | undefined, t: string) => (iso ? Math.max(0, daysBetween(ymd(iso), t)) : 0)

/** The facts of one record (`prev`: the record before the change, for "status before"). */
export function factsOf(d: DB, entity: string, r: Rec, prev?: Rec, t = today()): Facts {
  const v: Record<string, unknown> = {}, x: Record<string, string | number> = {}
  if (entity === 'booking') {
    const b = r as Booking, pb = prev as Booking | undefined, m = bookingMoney(b)
    const lastDecision = [b.createdAt, ...b.approvals.map((a) => a.at)].sort().pop()
    const pay = b.payments[b.payments.length - 1], doc = b.documents[b.documents.length - 1]
    Object.assign(v, {
      status: b.status, prevStatus: pb?.status, stage: b.stage, prevStage: pb?.stage, service: b.serviceName, company: b.companyName, state: b.state,
      bookingType: b.bookingType, priority: b.priority, mode: b.mode, quoted: b.totalQuoted, collected: m.collected, outstanding: m.outstanding,
      payment: pay?.amount, documentCategory: doc?.category, hasOps: !!b.opsMemberId, hasAdmin: !!b.adminId,
      daysInStatus: daysSince(lastDecision, t), daysSinceCreated: daysSince(b.createdAt, t), daysToDeadline: b.deadline ? daysBetween(t, b.deadline) : undefined,
    })
    Object.assign(x, {
      record: b.bookingId, company: b.companyName, client: b.contactPerson, service: b.serviceName, status: BOOKING_STATUS[b.status]?.label ?? b.status,
      stage: `${b.stage}. ${STAGES[b.stage - 1] ?? ''}`, quoted: rupees(b.totalQuoted), collected: rupees(m.collected), outstanding: rupees(m.outstanding),
      payment: pay ? rupees(pay.amount) : '0', document: doc ? `${doc.category}: ${doc.name}` : '', owner: nameOf(d, b.createdBy), daysInStatus: v.daysInStatus as number, link: `/bookings/${b.id}`,
    })
  } else if (entity === 'lead') {
    const l = r as Lead, pl = prev as Lead | undefined
    const lastCall = l.calls.map((c) => c.at).sort().pop()
    Object.assign(v, {
      status: l.status, prevStatus: pl?.status, source: l.source, service: l.service, city: l.city, assigned: !!l.assignedTo, calls: l.calls.length,
      daysSinceCreated: daysSince(l.createdAt, t), daysSinceLastCall: daysSince(lastCall ?? l.assignedAt ?? l.createdAt, t),
    })
    Object.assign(x, { record: l.code, client: l.name, company: l.company || l.name, phone: l.phone, service: l.service, status: LEAD_STATUS[l.status]?.label ?? l.status, owner: nameOf(d, l.assignedTo), daysSinceLastCall: v.daysSinceLastCall as number, link: '/dialer' })
  } else if (entity === 'clientEntry') {
    const e = r as ClientEntry, pe = prev as ClientEntry | undefined
    const open = e.status !== 'CONVERTED' && e.status !== 'NOT_INTERESTED'
    Object.assign(v, {
      status: e.status, prevStatus: pe?.status, scheme: e.scheme, pitchedPrice: e.pitchedPrice,
      followUpOverdueDays: open && e.followUp && e.followUp < t ? daysBetween(e.followUp, t) : 0, daysSinceCreated: daysSince(e.createdAt, t),
    })
    Object.assign(x, { record: `${e.clientName} (${e.companyName})`, client: e.clientName, company: e.companyName, scheme: e.scheme, status: CLIENT_ENTRY_STATUS[e.status]?.label ?? e.status, pitchedPrice: rupees(e.pitchedPrice), owner: nameOf(d, e.ownerId), followUpOverdueDays: v.followUpOverdueDays as number, link: '/client-entries' })
  } else if (entity === 'invoice') {
    const inv = r as Invoice, tot = invoiceTotals(inv, d.settings.supplierState)
    const overdue = inv.status !== 'PAID' && inv.status !== 'CANCELLED' && inv.due < t ? daysBetween(inv.due, t) : 0
    Object.assign(v, { type: inv.type, status: inv.status, total: tot.grand, balance: inv.status === 'CANCELLED' ? 0 : Math.max(0, tot.balance), daysOverdue: overdue, client: inv.client })
    Object.assign(x, { record: inv.number, client: inv.client, total: rupees(tot.grand), balance: rupees(Math.max(0, tot.balance)), status: inv.status.replace('_', ' ').toLowerCase(), daysOverdue: overdue, owner: nameOf(d, inv.salesPerson), link: `/billing/${inv.id}` })
  } else if (entity === 'leave') {
    const l = r as LeaveRequest
    Object.assign(v, { leaveType: l.type, status: l.status, days: l.days, daysUntilStart: daysBetween(t, l.from) })
    Object.assign(x, { record: `${l.from} → ${l.to}`, owner: nameOf(d, l.userId), leaveType: l.type, days: l.days, status: l.status.toLowerCase(), link: '/leave' })
  } else if (entity === 'user') {
    const u = r as User
    Object.assign(v, { role: u.role, department: u.department })
    Object.assign(x, { record: u.name, owner: u.name, role: ROLES.find((q) => q.id === u.role)?.label ?? u.role, department: u.department || '—', link: '/employees' })
  }
  return { values: v, text: x }
}
const recordId = (r: Rec) => r.id
const ownerOf = (entity: string, r: Rec): string | undefined =>
  entity === 'booking' ? (r as Booking).createdBy : entity === 'lead' ? (r as Lead).assignedTo : entity === 'clientEntry' ? (r as ClientEntry).ownerId
    : entity === 'invoice' ? (r as Invoice).salesPerson : entity === 'leave' ? (r as LeaveRequest).userId : (r as User).id

/** The people an action goes to (active staff, each once). */
export function recipientsOf(d: DB, entity: string, r: Rec, to: AutomationRecipient[]): User[] {
  const ids = new Set<string>()
  const owner = ownerOf(entity, r)
  for (const x of to) {
    if (x.kind === 'owner' && owner) ids.add(owner)
    if (x.kind === 'teamlead') { const tl = entity === 'booking' ? (r as Booking).teamLeadId ?? d.users.find((u) => u.id === owner)?.teamLeadId : d.users.find((u) => u.id === owner)?.teamLeadId; if (tl) ids.add(tl) }
    if (x.kind === 'ops' && entity === 'booking' && (r as Booking).opsMemberId) ids.add((r as Booking).opsMemberId!)
    if (x.kind === 'admin' && entity === 'booking' && (r as Booking).adminId) ids.add((r as Booking).adminId!)
    if (x.kind === 'role' && x.role) for (const u of d.users) if (u.active && rolesOf(u).includes(x.role)) ids.add(u.id)
    if (x.kind === 'user' && x.userId) ids.add(x.userId)
  }
  return d.users.filter((u) => ids.has(u.id) && u.active)
}

/** Carries out a rule's actions on one record (inside a mutate). Answers what was done. */
function applyActions(d: DB, rule: AutomationRule, entity: string, r: Rec, f: Facts, actor: string): string[] {
  const done: string[] = []
  const at = nowIso()
  for (const a of rule.actions) {
    const people = a.to ? recipientsOf(d, entity, r, a.to) : []
    if (a.type === 'notify') {
      for (const u of people) d.notices.unshift({ id: uid('n-'), userId: u.id, title: fillText(a.title, f).slice(0, 200), body: fillText(a.body ?? '', f).slice(0, 1000), link: String(f.text.link ?? ''), at, read: false, kind: 'action' })
      done.push(`notified ${people.length}`)
    } else if (a.type === 'email') {
      // in an email the link is a full address (it may be read outside the CRM)
      const origin = typeof location !== 'undefined' ? location.origin : ''
      const ef: Facts = { ...f, text: { ...f.text, link: `${origin}${f.text.link ?? ''}` } }
      if (people.length) deliver(d, 'system', people, fillText(a.subject, ef), fillText(a.body, ef), { automation: `rule:${rule.id}` })
      done.push(`emailed ${people.length}`)
    } else if (entity === 'booking') {
      const b = d.bookings.find((x) => x.id === r.id)
      if (!b) continue
      if (a.type === 'task') {
        const assignee = people[0]?.id
        b.tasks.push({ id: uid('t-'), title: fillText(a.title, f).slice(0, 300), done: false, due: ymd(addDays(new Date(), Number(a.dueInDays) || 0)), by: actor || b.createdBy, assignee, createdAt: at })
        done.push(`task for ${assignee ? nameOf(d, assignee) : 'the file'}`)
      } else if (a.type === 'comment') {
        b.comments.push({ id: uid('c-'), by: actor || b.createdBy, at, text: fillText(a.text, f).slice(0, 2000), kind: 'Automation' })
        done.push('note added')
      } else if (a.type === 'priority' && a.value && b.priority !== a.value) {
        b.priority = a.value
        done.push(`priority ${a.value.toLowerCase()}`)
      }
      b.updatedAt = at
    }
  }
  return done
}

// ------------------------------------------------------------------ switches
/** A built-in automation runs unless IT Support switched it off. */
export const builtinOn = (d: DB, key: string) => d.automationRules?.find((r) => r.id === builtinId(key))?.enabled !== false
export const customRules = (d: DB) => (d.automationRules ?? []).filter((r) => !r.id.startsWith('builtin:')).sort((a, b) => a.position - b.position)

function logRun(d: DB, run: AutomationRun) {
  d.automationRuns = [run, ...(d.automationRuns ?? []).filter((x) => x.id !== run.id)]
  // browser mode keeps the newest 500; the live database keeps them all (only IT clears them)
  if (!CLOUD && d.automationRuns.length > 500) d.automationRuns.length = 500
}
const actorId = () => { if (CLOUD) return cloudUserId() ?? ''; try { return (JSON.parse(localStorage.getItem('rexera-session') || 'null') as { userId?: string } | null)?.userId ?? '' } catch { return '' } }

// ------------------------------------------------------------------ events: what changed in one save
type Event = { trigger: string; entity: string; record: Rec; prev?: Rec }
const LISTS: [keyof DB, string][] = [['bookings', 'booking'], ['leads', 'lead'], ['clientEntries', 'clientEntry'], ['invoices', 'invoice'], ['leaves', 'leave'], ['users', 'user']]
/** The events one change made (records added, statuses / stages changed, payments and documents added). */
export function eventsBetween(prev: DB, next: DB): Event[] {
  const out: Event[] = []
  for (const [key, entity] of LISTS) {
    const a = (prev[key] ?? []) as Rec[], b = (next[key] ?? []) as Rec[]
    if (a === b) continue
    const before = new Map(a.map((r) => [recordId(r), r]))
    for (const r of b) {
      const old = before.get(recordId(r))
      if (old === r) continue
      if (!old) { out.push({ trigger: `${entity}.${entity === 'leave' ? 'requested' : 'created'}`, entity, record: r }); continue }
      if (entity === 'booking') {
        const o = old as Booking, n = r as Booking
        if (o.status !== n.status) out.push({ trigger: 'booking.status', entity, record: r, prev: old })
        if (o.stage !== n.stage) out.push({ trigger: 'booking.stage', entity, record: r, prev: old })
        if (n.payments.length > o.payments.length) out.push({ trigger: 'booking.payment', entity, record: r, prev: old })
        if (n.documents.length > o.documents.length) out.push({ trigger: 'booking.document', entity, record: r, prev: old })
      } else if (entity === 'lead') {
        const o = old as Lead, n = r as Lead
        if (o.status !== n.status) out.push({ trigger: 'lead.status', entity, record: r, prev: old })
        if (n.assignedTo && o.assignedTo !== n.assignedTo) out.push({ trigger: 'lead.assigned', entity, record: r, prev: old })
      } else if (entity === 'clientEntry') {
        if ((old as ClientEntry).status !== (r as ClientEntry).status) out.push({ trigger: 'clientEntry.status', entity, record: r, prev: old })
      } else if (entity === 'invoice') {
        if ((old as Invoice).status !== 'PAID' && (r as Invoice).status === 'PAID') out.push({ trigger: 'invoice.paid', entity, record: r, prev: old })
      } else if (entity === 'leave') {
        const o = old as LeaveRequest, n = r as LeaveRequest
        if (o.status !== n.status && (n.status === 'APPROVED' || n.status === 'REJECTED')) out.push({ trigger: 'leave.decided', entity, record: r, prev: old })
      }
    }
  }
  return out
}

let running = false
/** Runs the matching event rules for one change (called after every save in this browser). */
function onChange(prev: DB, next: DB) {
  if (running || !next.automationRules?.length || !builtinOn(next, 'custom-rules')) return
  const rules = customRules(next).filter((r) => r.enabled && !triggerOf(r.trigger)?.schedule)
  if (!rules.length) return
  const events = eventsBetween(prev, next)
  if (!events.length) return
  const actor = actorId()
  if (!actor) return
  // after this save has finished: the rule's own changes are a new save (and never start rules again)
  queueMicrotask(() => {
    running = true
    try {
      mutate((d) => {
        for (const rule of rules) {
          const mine = events.filter((e) => e.trigger === rule.trigger)
          let n = 0
          for (const e of mine) {
            const f = factsOf(d, e.entity, e.record, e.prev)
            if (!ruleMatches(rule, f, FIELDS[e.entity] ?? {})) continue
            if (++n > MAX_PER_RUN) continue
            let ok = true, detail = ''
            try { detail = applyActions(d, rule, e.entity, e.record, f, actor).join(' · ') } catch (err) { ok = false; detail = err instanceof Error ? err.message : 'failed' }
            logRun(d, { id: uid('ar-'), ruleId: rule.id, ruleName: rule.name, at: nowIso(), by: actor, trigger: rule.trigger, recordType: e.entity, recordId: e.record.id, recordLabel: String(f.text.record ?? e.record.id), ok, detail })
          }
          if (n > MAX_PER_RUN) logRun(d, { id: uid('ar-'), ruleId: rule.id, ruleName: rule.name, at: nowIso(), by: actor, trigger: rule.trigger, recordType: mine[0]!.entity, recordId: '', recordLabel: `${n - MAX_PER_RUN} more records`, ok: false, detail: `Skipped — a rule acts on at most ${MAX_PER_RUN} records per change (bulk change)` })
        }
      })
    } catch (err) { console.warn('[automation]', err) } finally { running = false }
  })
}
let started = false
/** Starts listening for changes (once, from the app shell). */
export function startAutomations() { if (started) return; started = true; onCommit(onChange) }

const recordsOf = (d: DB, entity: string): Rec[] => {
  const key = LISTS.find(([, e]) => e === entity)?.[0]
  return key ? ((d[key] ?? []) as Rec[]) : []
}
/** What a daily check would act on today (the editor's preview, and the job below). */
export function scheduleMatches(d: DB, rule: AutomationRule, t = today()) {
  const entity = ruleEntity(rule)
  const out: { record: Rec; facts: Facts; runId: string; done: boolean }[] = []
  for (const r of recordsOf(d, entity)) {
    const f = factsOf(d, entity, r, undefined, t)
    if (!ruleMatches(rule, f, FIELDS[entity] ?? {})) continue
    const runId = scheduleRunId(rule, r.id, t)
    out.push({ record: r, facts: f, runId, done: !!d.automationRuns?.some((x) => x.id === runId) })
  }
  return out
}
/** Daily checks: run in Super Admin / IT browsers every few minutes; each record once per period (scheduleRunId). */
export function runScheduledRules() {
  const d0 = getDb()
  if (!d0.automationRules?.length || !builtinOn(d0, 'custom-rules')) return 0
  const rules = customRules(d0).filter((r) => r.enabled && triggerOf(r.trigger)?.schedule)
  const work = rules.map((rule) => ({ rule, due: scheduleMatches(d0, rule).filter((m) => !m.done).slice(0, MAX_PER_RUN) })).filter((w) => w.due.length)
  if (!work.length) return 0
  const actor = actorId()
  let n = 0
  running = true
  try {
    mutate((d) => {
      for (const { rule, due } of work) {
        const entity = ruleEntity(rule)
        for (const m of due) {
          if (d.automationRuns?.some((x) => x.id === m.runId)) continue
          let ok = true, detail = ''
          try { detail = applyActions(d, rule, entity, m.record, m.facts, actor).join(' · ') } catch (err) { ok = false; detail = err instanceof Error ? err.message : 'failed' }
          logRun(d, { id: m.runId, ruleId: rule.id, ruleName: rule.name, at: nowIso(), by: actor, trigger: rule.trigger, recordType: entity, recordId: m.record.id, recordLabel: String(m.facts.text.record ?? m.record.id), ok, detail })
          n++
        }
      }
    })
  } finally { running = false }
  return n
}

// ------------------------------------------------------------------ IT Support: rules and switches
export type RuleInput = Omit<AutomationRule, 'id' | 'position' | 'createdAt' | 'updatedAt' | 'updatedBy'>
const audit = (d: DB, me: User, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }
const fieldTypes = () => Object.fromEntries(Object.entries(FIELDS).map(([e, f]) => [e, f]))

export const automationProblems = (r: Partial<RuleInput>) => ruleProblems(r, fieldTypes())

export function saveAutomationRule(me: User, x: RuleInput, id?: string) {
  need(me)
  const v: RuleInput = { ...x, name: x.name.trim(), description: x.description?.trim() || undefined, entity: triggerOf(x.trigger)?.schedule ? x.entity : undefined, repeatDays: triggerOf(x.trigger)?.schedule ? Number(x.repeatDays) || 0 : undefined }
  const problems = automationProblems(v)
  assert(!problems.length, problems.slice(0, 3).join(' '))
  return mutate((d) => {
    d.automationRules ??= []
    const at = nowIso()
    if (id) {
      const cur = d.automationRules.find((r) => r.id === id)
      assert(cur && !cur.id.startsWith('builtin:'), 'Rule not found.')
      Object.assign(cur, v, { updatedAt: at, updatedBy: me.id })
      if (!v.description) delete cur.description
      if (v.entity === undefined) delete cur.entity
      if (v.repeatDays === undefined) delete cur.repeatDays
      audit(d, me, 'AUTOMATION_EDIT', `${cur.name}${cur.enabled ? '' : ' (off)'}`)
      return cur.id
    }
    const r: AutomationRule = { ...v, id: uid('rule-'), position: 1 + Math.max(0, ...customRules(d).map((y) => y.position)), createdAt: at, updatedAt: at, updatedBy: me.id }
    d.automationRules.push(r)
    audit(d, me, 'AUTOMATION_ADD', r.name)
    return r.id
  })
}
export function setAutomationEnabled(me: User, id: string, enabled: boolean) {
  need(me)
  mutate((d) => {
    d.automationRules ??= []
    let r = d.automationRules.find((x) => x.id === id)
    if (!r && id.startsWith('builtin:')) {
      const b = BUILTINS.find((x) => builtinId(x.key) === id)
      assert(b, 'Automation not found.')
      r = { id, name: b.name, enabled, position: 0, trigger: 'builtin', conditions: [], actions: [] }
      d.automationRules.push(r)
    }
    assert(r, 'Automation not found.')
    r.enabled = enabled
    r.updatedAt = nowIso(); r.updatedBy = me.id
    audit(d, me, 'AUTOMATION_SWITCH', `${r.name}: ${enabled ? 'on' : 'off'}`)
  })
}
export function deleteAutomationRule(me: User, id: string) {
  need(me)
  mutate((d) => {
    const r = d.automationRules?.find((x) => x.id === id)
    assert(r && !id.startsWith('builtin:'), 'Rule not found.')
    d.automationRules = d.automationRules!.filter((x) => x.id !== id)
    audit(d, me, 'AUTOMATION_DELETE', r.name)
  })
}
export function moveAutomationRule(me: User, id: string, dir: -1 | 1) {
  need(me)
  mutate((d) => {
    const list = customRules(d)
    const i = list.findIndex((r) => r.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j]!, list[i]!]
    list.forEach((r, k) => { const row = d.automationRules!.find((y) => y.id === r.id)!; if (row.position !== k + 1) row.position = k + 1 })
  })
}
/** Clears the run history (IT Support). */
export function clearAutomationRuns(me: User) {
  need(me)
  mutate((d) => { d.automationRuns = []; audit(d, me, 'AUTOMATION_HISTORY_CLEAR', 'Run history cleared') })
}
/** Runs a rule's daily check now (IT Support, from the editor). */
export function runRuleNow(me: User, id: string) {
  need(me)
  const rule = getDb().automationRules?.find((r) => r.id === id)
  assert(rule && triggerOf(rule.trigger)?.schedule, 'Only a daily check can be run now — event rules run when the event happens.')
  assert(rule.enabled, 'Switch the rule on first.')
  return runScheduledRules()
}

export const roleOptions = (): { id: Role; label: string }[] => ROLES.map((r) => ({ id: r.id, label: r.label }))
