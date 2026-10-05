import type {
  Booking, BookingStatus, BDoc, CallOutcome, DB, EventItem, Invoice, InvoiceItem, Lead, LeaveType, Perm, Post, Role, Scheme, User,
} from './types'
import { effectivePerms, isMaster, MASTER_ROLES, rolesOf, roleLabel } from './rbac'
import { getDb, mutate } from './store'
import { hashPassword } from './crypto'
import { DEMO_PASSWORD } from './seed'
import { CALL_OUTCOMES, OPEN_LEAD, STAGES } from './workflow'
import { fireAutomation } from './email'
import { addDays, daysBetween, fmtDate, isEmail, isGstin, isPan, isPhone, normPhone, nowIso, round2, today, uid, ymd } from './format'

// ============================================================ helpers
export class ActionError extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ActionError(msg)
}
const has = (me: User, ...perms: Perm[]) => {
  const p = effectivePerms(getDb(), me)
  return perms.some((x) => p.has(x))
}
function need(me: User, ...perms: Perm[]) {
  assert(has(me, ...perms), "You don't have access to do that.")
}
const isSA = (me: User) => rolesOf(me).includes('superadmin')
export const userName = (d: DB, id?: string) => d.users.find((u) => u.id === id)?.name ?? '—'

export function usersWithRole(d: DB, ...roles: Role[]) {
  return d.users.filter((u) => u.active && rolesOf(u).some((r) => roles.includes(r)))
}
function notify(d: DB, userIds: (string | undefined)[], title: string, body: string, link?: string, kind: 'info' | 'success' | 'warning' | 'action' = 'info') {
  for (const id of new Set(userIds.filter(Boolean) as string[])) {
    d.notices.unshift({ id: uid('n-'), userId: id, title, body, link, at: nowIso(), read: false, kind })
  }
  if (d.notices.length > 600) d.notices.length = 600
}
function audit(d: DB, by: string, action: string, detail: string) {
  d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail })
  if (d.audit.length > 1000) d.audit.length = 1000
}
const findB = (d: DB, id: string) => {
  const b = d.bookings.find((x) => x.id === id)
  assert(b, 'CRM entry not found.')
  return b
}

// ============================================================ auth
type Pending = { userId: string; code: string; expires: number; attempts: number; resends: number }
const pending = new Map<string, Pending>()
const genCode = () => String(Math.floor(100000 + Math.random() * 900000))

export async function loginStep1(login: string, password: string) {
  const d = getDb()
  const key = login.trim().toLowerCase()
  const fail = d.loginFails[key]
  if (fail?.until && new Date(fail.until) > new Date()) {
    const mins = Math.ceil((new Date(fail.until).getTime() - Date.now()) / 60000)
    throw new ActionError(`Too many attempts. Try again in ${mins} min.`)
  }
  const u = d.users.find((x) => x.username.toLowerCase() === key || x.email.toLowerCase() === key)
  const ok = u ? (await hashPassword(u.username, password)) === u.passHash : false
  if (!u || !ok) {
    mutate((m) => {
      const f = m.loginFails[key] ?? { count: 0 }
      f.count += 1
      if (f.count >= 5) { f.until = new Date(Date.now() + 5 * 60000).toISOString(); f.count = 0 }
      m.loginFails[key] = f
    })
    throw new ActionError('Wrong username or password.')
  }
  assert(u.active, 'This account is deactivated. Contact your administrator.')
  const mt = d.settings.maintenance
  assert(!mt?.on || isMaster(u), `Rexera CRM is under maintenance${mt?.message ? `: ${mt.message}` : '.'} Please try again later.`)
  mutate((m) => { delete m.loginFails[key] })
  const token = uid('tmp-')
  const code = genCode()
  pending.set(token, { userId: u.id, code, expires: Date.now() + 5 * 60000, attempts: 0, resends: 0 })
  return { token, devCode: code, email: u.email }
}

export function resendCode(token: string) {
  const p = pending.get(token)
  assert(p, 'Session expired. Sign in again.')
  assert(p.resends < 3, 'Resend limit reached. Sign in again.')
  p.code = genCode(); p.expires = Date.now() + 5 * 60000; p.attempts = 0; p.resends += 1
  return p.code
}

export function verifyCode(token: string, code: string): string {
  const p = pending.get(token)
  assert(p, 'Session expired. Sign in again.')
  if (Date.now() > p.expires) { pending.delete(token); throw new ActionError('Code expired. Sign in again.') }
  p.attempts += 1
  if (p.code !== code.trim()) {
    if (p.attempts >= 5) { pending.delete(token); throw new ActionError('Too many wrong codes. Sign in again.') }
    throw new ActionError(`Wrong code. ${5 - p.attempts} attempts left.`)
  }
  pending.delete(token)
  mutate((d) => {
    const u = d.users.find((x) => x.id === p.userId)!
    if (!d.sessions.some((s) => s.userId === u.id && s.date === today())) {
      d.sessions.push({ id: uid('ds-'), userId: u.id, date: today(), loginAt: nowIso() })
    }
    audit(d, u.id, 'SIGN_IN', `${u.name} signed in`)
  })
  return p.userId
}

export async function changePassword(me: User, current: string, next: string) {
  assert((await hashPassword(me.username, current)) === me.passHash, 'Current password is wrong.')
  assert(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/.test(next), 'Use 8–16 characters with upper, lower, number and symbol.')
  const h = await hashPassword(me.username, next)
  mutate((d) => {
    d.users.find((u) => u.id === me.id)!.passHash = h
    audit(d, me.id, 'PASSWORD', 'Changed own password')
  })
}

// ============================================================ day attendance
export function startDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    if (s) { s.logoutAt = undefined; return }
    d.sessions.push({ id: uid('ds-'), userId: me.id, date: today(), loginAt: nowIso() })
  })
}
export function endDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    assert(s, 'Start your day first.')
    s.logoutAt = nowIso()
    audit(d, me.id, 'END_DAY', 'Ended the day')
  })
}

// ============================================================ leads
export function visibleLeads(d: DB, me: User): Lead[] {
  const p = effectivePerms(d, me)
  if (p.has('leads.manage')) return d.leads
  const team = new Set(d.users.filter((u) => u.teamLeadId === me.id).map((u) => u.id))
  return d.leads.filter((l) =>
    l.assignedTo === me.id || (!l.assignedTo && l.createdBy === me.id) ||
    (p.has('leads.assign') && (team.has(l.assignedTo ?? '') || !l.assignedTo)))
}

export type LeadInput = Pick<Lead, 'name' | 'company' | 'phone' | 'email' | 'city' | 'state' | 'service' | 'source' | 'notes'> & { price?: number; followUp?: string; assignedTo?: string }

function checkLead(i: LeadInput) {
  assert(i.name.trim().length >= 2, 'Name is required.')
  assert(isPhone(i.phone), 'Enter a valid 10-digit mobile number.')
  assert(!i.email || isEmail(i.email), 'Enter a valid email.')
  assert(i.price == null || (Number.isFinite(i.price) && i.price >= 0), 'Price must be 0 or more.')
}

export function createLead(me: User, i: LeadInput) {
  need(me, 'leads.own', 'leads.manage')
  checkLead(i)
  return mutate((d) => {
    const phone = normPhone(i.phone)
    const dup = d.leads.find((l) => l.phone === phone)
    assert(!dup, `A lead with this number already exists (${dup?.code}).`)
    const canAssign = has(me, 'leads.assign', 'leads.manage')
    const lead: Lead = {
      ...i, id: uid('lead-'), code: `LD-${d.counters.lead++}`, phone, price: i.price == null ? undefined : round2(i.price),
      status: 'NEW', assignedTo: canAssign && i.assignedTo ? i.assignedTo : me.id, createdBy: me.id, createdAt: nowIso(), calls: [],
    }
    d.leads.unshift(lead)
    if (lead.assignedTo !== me.id) notify(d, [lead.assignedTo], 'New lead assigned to you', `${lead.name} · ${lead.service}`, '/leads', 'action')
    audit(d, me.id, 'LEAD_CREATE', `${lead.code} ${lead.name}`)
    return lead.id
  })
}

export function updateLead(me: User, id: string, patch: Partial<LeadInput & { status: Lead['status'] }>) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === id)
    assert(l && visibleLeads(d, me).some((x) => x.id === id), 'Lead not found.')
    if (patch.phone) {
      patch.phone = normPhone(patch.phone)
      assert(isPhone(patch.phone), 'Enter a valid 10-digit mobile number.')
      assert(!d.leads.some((x) => x.phone === patch.phone && x.id !== id), 'Another lead has this number.')
    }
    if (patch.assignedTo !== undefined && !has(me, 'leads.assign', 'leads.manage')) delete patch.assignedTo
    if ('price' in patch) patch.price = patch.price == null || Number.isNaN(patch.price) ? undefined : round2(patch.price)
    Object.assign(l, patch)
  })
}

export function deleteLeads(me: User, ids: string[]) {
  need(me, 'leads.manage')
  mutate((d) => {
    d.leads = d.leads.filter((l) => !ids.includes(l.id))
    audit(d, me.id, 'LEAD_DELETE', `${ids.length} lead(s)`)
  })
}

export function assignLeads(me: User, ids: string[], userId: string) {
  need(me, 'leads.assign', 'leads.manage')
  mutate((d) => {
    const target = d.users.find((u) => u.id === userId)
    assert(target, 'Pick a sales person.')
    if (!has(me, 'leads.manage')) assert(target.teamLeadId === me.id || target.id === me.id, 'You can assign only to your team.')
    for (const l of d.leads) if (ids.includes(l.id)) l.assignedTo = userId
    notify(d, [userId], `${ids.length} lead(s) assigned to you`, `by ${me.name}`, '/leads', 'action')
    audit(d, me.id, 'LEAD_ASSIGN', `${ids.length} lead(s) → ${target.name}`)
  })
}

export function logCall(me: User, leadId: string, outcome: CallOutcome, note: string, followUp?: string, durationSec = 0) {
  need(me, 'dialer.use', 'leads.manage')
  mutate((d) => {
    const l = d.leads.find((x) => x.id === leadId)
    assert(l, 'Lead not found.')
    l.calls.unshift({ id: uid('call-'), at: nowIso(), by: me.id, outcome, note, durationSec })
    l.status = CALL_OUTCOMES.find((o) => o.id === outcome)!.to
    if (followUp) l.followUp = followUp
    else if (!OPEN_LEAD.includes(l.status)) l.followUp = undefined
    if (note) l.notes = l.notes ? `${l.notes}\n${note}` : note
  })
}

export function importLeads(me: User, rows: Record<string, string>[]) {
  need(me, 'leads.own', 'leads.manage')
  return mutate((d) => {
    let added = 0, skipped = 0
    const errors: string[] = []
    const phones = new Set(d.leads.map((l) => l.phone))
    rows.forEach((r, i) => {
      const phone = normPhone(r.phone ?? r.mobile ?? '')
      const name = r.name ?? r['client name'] ?? ''
      const priceRaw = r.price ?? r.amount ?? ''
      const price = priceRaw ? Number(priceRaw.replace(/[₹,\s]/g, '')) : undefined
      if (!name || !isPhone(phone)) { errors.push(`Row ${i + 2}: name and a valid phone are required`); return }
      if (price !== undefined && !Number.isFinite(price)) { errors.push(`Row ${i + 2}: price is not a number`); return }
      if (phones.has(phone)) { skipped++; return }
      phones.add(phone)
      d.leads.unshift({
        id: uid('lead-'), code: `LD-${d.counters.lead++}`, name, phone, company: r.company ?? '', email: r.email ?? '',
        city: r.city ?? '', state: r.state ?? '', service: r.service ?? '', source: r.source || 'Import', price,
        status: 'NEW', notes: r.notes ?? '', assignedTo: me.id, createdBy: me.id, createdAt: nowIso(), calls: [],
      })
      added++
    })
    audit(d, me.id, 'LEAD_IMPORT', `${added} added, ${skipped} duplicates skipped`)
    return { added, skipped, errors }
  })
}

// ============================================================ bookings (CRM entries)
export function visibleBookings(d: DB, me: User): Booking[] {
  const p = effectivePerms(d, me)
  if (p.has('bookings.all')) return d.bookings
  const team = new Set(d.users.filter((u) => u.teamLeadId === me.id).map((u) => u.id))
  return d.bookings.filter((b) => b.createdBy === me.id || (p.has('bookings.team') && (b.teamLeadId === me.id || team.has(b.createdBy))))
}

export type BookingInput = {
  companyName: string; contactPerson: string; mobile: string; email: string; pan: string; gstin: string
  city: string; state: string; industry: string; serviceId: string; mode: Booking['mode']; successFeePct: number
  totalQuoted: number; priority: Booking['priority']; teamLeadId?: string; leadId?: string; note?: string
  advance: { amount: number; date: string; mode: string; proofName: string }
}

export function findDuplicates(d: DB, i: Partial<BookingInput>, excludeId?: string) {
  const phone = i.mobile ? normPhone(i.mobile) : ''
  return d.bookings.filter((b) => b.id !== excludeId && (
    (phone && normPhone(b.mobile) === phone) ||
    (i.email && b.email.toLowerCase() === i.email.toLowerCase()) ||
    (i.pan && b.pan && b.pan === i.pan.toUpperCase()) ||
    (i.gstin && b.gstin && b.gstin === i.gstin.toUpperCase())))
}

function checkBooking(i: BookingInput) {
  assert(i.companyName.trim().length >= 2, 'Company name is required.')
  assert(i.contactPerson.trim().length >= 2, 'Contact person is required.')
  assert(isPhone(i.mobile), 'Enter a valid 10-digit company mobile.')
  assert(!i.email || isEmail(i.email), 'Enter a valid email.')
  assert(!i.pan || isPan(i.pan), 'PAN must look like ABCDE1234F.')
  assert(!i.gstin || isGstin(i.gstin), 'GSTIN must be 15 characters (e.g. 24ABCDE1234F1Z5).')
  assert(i.serviceId, 'Pick a service.')
  assert(i.totalQuoted > 0, 'Total quoted must be more than 0.')
  assert(i.advance.amount > 0, 'Enter the advance received.')
  assert(i.advance.amount <= i.totalQuoted, 'Advance cannot exceed the total quoted.')
  assert(i.advance.proofName, 'Attach the payment proof.')
}

export function createBooking(me: User, i: BookingInput) {
  need(me, 'bookings.create')
  checkBooking(i)
  return mutate((d) => {
    const svc = d.services.find((s) => s.id === i.serviceId)!
    const isTL = rolesOf(me).includes('teamlead')
    const tl = isTL ? me.id : i.teamLeadId || me.teamLeadId
    assert(tl, 'Pick the team leader this client goes to.')
    const amount = round2(i.advance.amount)
    const gst = round2((amount * svc.gstRate) / 100)
    const at = nowIso()
    const b: Booking = {
      id: uid('bk-'), bookingId: `RX-${new Date().getFullYear()}-${String(d.counters.booking++).padStart(6, '0')}`,
      companyName: i.companyName.trim(), contactPerson: i.contactPerson.trim(), mobile: normPhone(i.mobile), email: i.email.trim(),
      pan: i.pan.toUpperCase(), gstin: i.gstin.toUpperCase(), city: i.city, state: i.state, industry: i.industry,
      serviceId: svc.id, serviceName: svc.name, mode: i.mode, successFeePct: i.successFeePct || 0,
      totalQuoted: round2(i.totalQuoted), gstRate: svc.gstRate, deduction: svc.deduction,
      payments: [{ id: uid('pay-'), part: 1, amount, gst, total: round2(amount + gst), date: i.advance.date, mode: i.advance.mode, proofName: i.advance.proofName, recordedBy: me.id, verified: false }],
      createdBy: me.id, teamLeadId: tl, status: isTL ? 'PENDING_ACCOUNTS' : 'PENDING_TL',
      approvals: isTL ? [{ id: uid('ap-'), level: 'Team Leader', action: 'APPROVED', by: me.id, at, remark: 'Submitted by team leader' }] : [],
      stage: 1, maxStage: 1, stageHistory: [],
      comments: i.note ? [{ id: uid('c-'), by: me.id, at, text: i.note, kind: 'BDE' }] : [],
      documents: [], tasks: [], priority: i.priority, deadline: ymd(addDays(new Date(), 30)), leadId: i.leadId,
      createdAt: at, updatedAt: at,
    }
    d.bookings.unshift(b)
    if (i.leadId) { const l = d.leads.find((x) => x.id === i.leadId); if (l) l.status = 'CONVERTED' }
    if (isTL) notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'New file for accounts', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action')
    else notify(d, [tl], 'CRM entry waiting for you', `${b.bookingId} · ${b.companyName} by ${me.name}`, `/bookings/${b.id}`, 'action')
    audit(d, me.id, 'BOOKING_CREATE', `${b.bookingId} ${b.companyName} · ${svc.name}`)
    return b.id
  })
}

export function canEditBooking(d: DB, me: User, b: Booking) {
  if (isSA(me)) return true
  if (b.status === 'COMPLETED') return false
  if (effectivePerms(d, me).has('bookings.accounts')) return true
  return b.createdBy === me.id && ['PENDING_TL', 'REJECTED'].includes(b.status)
}

export function updateBooking(me: User, id: string, patch: Partial<Omit<BookingInput, 'advance'>>) {
  mutate((d) => {
    const b = findB(d, id)
    assert(canEditBooking(d, me, b), 'This CRM entry is locked for you.')
    if (patch.mobile !== undefined) { assert(isPhone(patch.mobile), 'Enter a valid 10-digit mobile.'); patch.mobile = normPhone(patch.mobile) }
    if (patch.pan) { assert(isPan(patch.pan), 'PAN must look like ABCDE1234F.'); patch.pan = patch.pan.toUpperCase() }
    if (patch.gstin) { assert(isGstin(patch.gstin), 'GSTIN format is invalid.'); patch.gstin = patch.gstin.toUpperCase() }
    if (patch.serviceId && patch.serviceId !== b.serviceId) {
      const svc = d.services.find((s) => s.id === patch.serviceId)!
      b.serviceName = svc.name; b.gstRate = svc.gstRate; b.deduction = svc.deduction
    }
    const { note: _n, leadId: _l, ...rest } = patch
    Object.assign(b, rest)
    b.updatedAt = nowIso()
    audit(d, me.id, 'BOOKING_EDIT', `${b.bookingId} edited`)
  })
}

export type Decision =
  | { kind: 'APPROVE'; remark: string }
  | { kind: 'REJECT'; remark: string }
  | { kind: 'HOLD'; remark: string }
  | { kind: 'RESUME'; remark: string }
  | { kind: 'RESUBMIT'; remark: string }
  | { kind: 'ASSIGN_OPS'; remark: string; opsMemberId: string; maxStage: number; deadline: string }
  | { kind: 'ASSIGN_ADMIN'; remark: string; adminId: string }
  | { kind: 'RETURN_OPS'; remark: string }
  | { kind: 'COMPLETE'; remark: string }

/** Which decisions this user may take on this entry right now. */
export function availableDecisions(d: DB, me: User, b: Booking): Decision['kind'][] {
  const p = effectivePerms(d, me)
  const sa = isSA(me)
  const out: Decision['kind'][] = []
  switch (b.status) {
    case 'PENDING_TL':
      if (p.has('bookings.approve_tl') && (b.teamLeadId === me.id || sa)) out.push('APPROVE', 'REJECT')
      break
    case 'PENDING_ACCOUNTS':
      if (p.has('bookings.accounts')) out.push('APPROVE', 'HOLD', 'REJECT')
      break
    case 'ACCOUNTS_HOLD':
      if (p.has('bookings.accounts')) out.push('APPROVE', 'REJECT')
      break
    case 'PENDING_LEGAL':
      if (p.has('bookings.legal')) out.push('ASSIGN_OPS', 'REJECT')
      break
    case 'IN_OPERATIONS':
      if (p.has('bookings.process') && (b.opsMemberId === me.id || sa)) out.push('ASSIGN_ADMIN', 'HOLD')
      if (p.has('bookings.legal') && !out.includes('ASSIGN_OPS')) out.push('ASSIGN_OPS')
      break
    case 'WITH_ADMIN':
      if (p.has('bookings.admin') && (b.adminId === me.id || sa)) out.push('COMPLETE', 'HOLD', 'RETURN_OPS')
      break
    case 'ON_HOLD':
      if ((p.has('bookings.process') && b.opsMemberId === me.id) || (p.has('bookings.admin') && b.adminId === me.id) || sa) out.push('RESUME')
      break
    case 'REJECTED':
      if (b.createdBy === me.id || sa) out.push('RESUBMIT')
      break
  }
  return out
}

export function decide(me: User, id: string, dec: Decision) {
  mutate((d) => {
    const b = findB(d, id)
    assert(availableDecisions(d, me, b).includes(dec.kind), 'This action is not available right now.')
    const at = nowIso()
    const levelOf: Partial<Record<BookingStatus, string>> = {
      PENDING_TL: 'Team Leader', PENDING_ACCOUNTS: 'Accounts', ACCOUNTS_HOLD: 'Accounts', PENDING_LEGAL: 'Legal',
      IN_OPERATIONS: 'Operations', WITH_ADMIN: 'Admin', ON_HOLD: 'Hold', REJECTED: 'Sales',
    }
    const level = levelOf[b.status] ?? b.status
    if (['REJECT', 'HOLD', 'RETURN_OPS'].includes(dec.kind)) assert(dec.remark.trim().length >= 3, 'A reason is required.')
    const link = `/bookings/${b.id}`
    const label = `${b.bookingId} · ${b.companyName}`
    const toRole = (r: Role) => usersWithRole(d, r).map((u) => u.id)

    switch (dec.kind) {
      case 'APPROVE':
        if (b.status === 'PENDING_TL') {
          b.status = 'PENDING_ACCOUNTS'
          notify(d, toRole('accounts'), 'New file for accounts', label, link, 'action')
        } else {
          b.payments.forEach((x) => (x.verified = true))
          b.status = 'PENDING_LEGAL'
          notify(d, toRole('legal'), 'File waiting for legal review', label, link, 'action')
        }
        notify(d, [b.createdBy], `Approved by ${level}`, label, link, 'success')
        break
      case 'REJECT':
        b.status = 'REJECTED'
        notify(d, [b.createdBy, b.teamLeadId], `Rejected by ${level}`, `${label}: ${dec.remark}`, link, 'warning')
        break
      case 'HOLD':
        if (b.status === 'PENDING_ACCOUNTS') b.status = 'ACCOUNTS_HOLD'
        else { b.holdFrom = b.status; b.status = 'ON_HOLD' }
        b.holdReason = dec.remark
        notify(d, [b.createdBy, b.teamLeadId], `On hold (${level})`, `${label}: ${dec.remark}`, link, 'warning')
        break
      case 'RESUME':
        b.status = b.holdFrom ?? 'IN_OPERATIONS'
        b.holdFrom = undefined; b.holdReason = undefined
        notify(d, [b.createdBy], 'Work resumed', label, link, 'info')
        break
      case 'RESUBMIT':
        b.status = 'PENDING_TL'
        notify(d, [b.teamLeadId], 'CRM entry resubmitted', label, link, 'action')
        break
      case 'ASSIGN_OPS': {
        const ops = d.users.find((u) => u.id === dec.opsMemberId)
        assert(ops && rolesOf(ops).includes('operations'), 'Pick an Operation Team member.')
        assert(dec.maxStage >= 1 && dec.maxStage <= STAGES.length, 'Pick the furthest stage allowed.')
        const first = !b.opsMemberId
        b.opsMemberId = ops.id
        b.maxStage = dec.maxStage
        if (dec.deadline) b.deadline = dec.deadline
        if (b.status === 'PENDING_LEGAL') {
          b.status = 'IN_OPERATIONS'
          if (first || !b.stageHistory.length) { b.stage = 1; b.stageHistory.push({ stage: 1, at, by: me.id, note: 'Assigned by Legal' }) }
        }
        notify(d, [ops.id], 'New client file assigned to you', `${label} · up to stage ${dec.maxStage}`, link, 'action')
        notify(d, [b.createdBy], 'Legal approved · now with Operations', label, link, 'success')
        break
      }
      case 'ASSIGN_ADMIN': {
        const ad = d.users.find((u) => u.id === dec.adminId)
        assert(ad && rolesOf(ad).includes('admin'), 'Pick an Admin.')
        b.adminId = ad.id
        b.status = 'WITH_ADMIN'
        notify(d, [ad.id], 'Operations assigned a file to you', label, link, 'action')
        break
      }
      case 'RETURN_OPS':
        b.status = 'IN_OPERATIONS'
        notify(d, [b.opsMemberId], 'Admin returned a file', `${label}: ${dec.remark}`, link, 'warning')
        break
      case 'COMPLETE':
        b.status = 'COMPLETED'
        b.stage = Math.max(b.stage, 8)
        b.stageHistory.push({ stage: 8, at, by: me.id, note: dec.remark || 'Completed' })
        notify(d, [b.createdBy, b.teamLeadId, b.opsMemberId, ...toRole('superadmin').map((x) => x)], 'Client work completed 🎉', label, link, 'success')
        break
    }
    b.approvals.push({ id: uid('ap-'), level, action: dec.kind === 'APPROVE' ? 'APPROVED' : dec.kind === 'REJECT' ? 'REJECTED' : dec.kind === 'COMPLETE' ? 'COMPLETED' : dec.kind, by: me.id, at, remark: dec.remark })
    b.updatedAt = at
    audit(d, me.id, `BOOKING_${dec.kind}`, `${b.bookingId}: ${dec.remark || '—'}`)
  })
}

export function canMoveStage(d: DB, me: User, b: Booking) {
  const p = effectivePerms(d, me)
  if (isSA(me)) return true
  if (b.status === 'IN_OPERATIONS') return p.has('bookings.process') && b.opsMemberId === me.id
  if (b.status === 'WITH_ADMIN') return p.has('bookings.admin') && b.adminId === me.id
  return false
}

export function moveStage(me: User, id: string, stage: number, note: string) {
  mutate((d) => {
    const b = findB(d, id)
    assert(canMoveStage(d, me, b), 'You cannot move this file right now.')
    assert(stage >= 1 && stage <= STAGES.length, 'Unknown stage.')
    assert(isSA(me) || stage <= b.maxStage, `You may move this file up to stage ${b.maxStage} (${STAGES[b.maxStage - 1]}).`)
    assert(stage >= b.stage || note.trim().length >= 3, 'Moving back needs a reason.')
    b.stage = stage
    b.stageHistory.push({ stage, at: nowIso(), by: me.id, note: note || `Moved to ${STAGES[stage - 1]}` })
    b.updatedAt = nowIso()
    notify(d, [b.createdBy], `Stage: ${STAGES[stage - 1]}`, `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'info')
  })
}

export function setMaxStage(me: User, id: string, max: number) {
  need(me, 'bookings.legal')
  mutate((d) => {
    const b = findB(d, id)
    b.maxStage = Math.max(1, Math.min(STAGES.length, max))
    audit(d, me.id, 'BOOKING_MAX_STAGE', `${b.bookingId} → ${b.maxStage}`)
  })
}

export function addPayment(me: User, id: string, p: { amount: number; date: string; mode: string; proofName: string }) {
  mutate((d) => {
    const b = findB(d, id)
    const pr = effectivePerms(d, me)
    assert(b.createdBy === me.id || b.teamLeadId === me.id || pr.has('bookings.accounts'), 'Only the sales owner or accounts can add payments.')
    assert(p.amount > 0, 'Amount must be more than 0.')
    assert(p.proofName, 'Attach the payment proof.')
    const amount = round2(p.amount)
    const gst = round2((amount * b.gstRate) / 100)
    b.payments.push({ id: uid('pay-'), part: b.payments.length + 1, amount, gst, total: round2(amount + gst), date: p.date, mode: p.mode, proofName: p.proofName, recordedBy: me.id, verified: pr.has('bookings.accounts') })
    b.updatedAt = nowIso()
    if (!pr.has('bookings.accounts')) notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'Balance payment to verify', `${b.bookingId} · ₹${amount}`, `/bookings/${b.id}`, 'action')
    audit(d, me.id, 'PAYMENT_ADD', `${b.bookingId} part ${b.payments.length} ₹${amount}`)
  })
}

export function verifyPayment(me: User, id: string, payId: string, ok: boolean) {
  need(me, 'bookings.accounts')
  mutate((d) => {
    const b = findB(d, id)
    const p = b.payments.find((x) => x.id === payId)
    assert(p, 'Payment not found.')
    if (ok) p.verified = true
    else b.payments = b.payments.filter((x) => x.id !== payId)
    audit(d, me.id, ok ? 'PAYMENT_VERIFY' : 'PAYMENT_REMOVE', `${b.bookingId} part ${p.part}`)
  })
}

export function setDeduction(me: User, id: string, amount: number) {
  need(me, 'bookings.accounts')
  mutate((d) => {
    const b = findB(d, id)
    assert(amount >= 0, 'Deduction must be 0 or more.')
    audit(d, me.id, 'DEDUCTION', `${b.bookingId}: ₹${b.deduction} → ₹${amount}`)
    b.deduction = round2(amount)
  })
}

const commentKind: Record<Role, string> = { superadmin: 'Super Admin', admin: 'Admin', accounts: 'Accounts', legal: 'Legal', operations: 'Operations', teamlead: 'Team Leader', sales: 'BDE', hr: 'HR', it: 'IT', support: 'Customer Support' }
export function addComment(me: User, id: string, text: string) {
  assert(text.trim(), 'Write something first.')
  mutate((d) => {
    const b = findB(d, id)
    assert(visibleBookings(d, me).some((x) => x.id === id), 'Not found.')
    b.comments.push({ id: uid('c-'), by: me.id, at: nowIso(), text: text.trim(), kind: commentKind[me.role] })
    const mentioned = [...text.matchAll(/@([\w.]+)/g)].map((m) => d.users.find((u) => u.username === m[1])?.id)
    notify(d, mentioned, `${me.name} mentioned you`, `${b.bookingId}: ${text.slice(0, 80)}`, `/bookings/${b.id}`, 'action')
    const watchers = [b.createdBy, b.opsMemberId, b.adminId].filter((x) => x !== me.id)
    notify(d, watchers, `New comment on ${b.bookingId}`, `${me.name}: ${text.slice(0, 80)}`, `/bookings/${b.id}`, 'info')
  })
}

export function addDocument(me: User, id: string, doc: Omit<BDoc, 'id' | 'at' | 'by' | 'status'>) {
  mutate((d) => {
    const b = findB(d, id)
    assert(visibleBookings(d, me).some((x) => x.id === id), 'Not found.')
    assert(doc.size <= 5 * 1024 * 1024, 'Files must be 5 MB or smaller.')
    b.documents.push({ ...doc, id: uid('doc-'), at: nowIso(), by: me.id, status: 'PENDING' })
    b.updatedAt = nowIso()
    audit(d, me.id, 'DOC_UPLOAD', `${b.bookingId}: ${doc.name}`)
  })
}
export function setDocStatus(me: User, id: string, docId: string, status: 'VERIFIED' | 'REJECTED') {
  need(me, 'bookings.process', 'bookings.legal', 'bookings.admin')
  mutate((d) => { const doc = findB(d, id).documents.find((x) => x.id === docId); if (doc) doc.status = status })
}
export function deleteDocument(me: User, id: string, docId: string) {
  mutate((d) => {
    const b = findB(d, id)
    const doc = b.documents.find((x) => x.id === docId)
    assert(doc && (doc.by === me.id || isSA(me) || has(me, 'bookings.legal')), 'You cannot delete this file.')
    b.documents = b.documents.filter((x) => x.id !== docId)
    audit(d, me.id, 'DOC_DELETE', `${b.bookingId}: ${doc.name}`)
  })
}

export function addTask(me: User, id: string, title: string, due?: string) {
  assert(title.trim(), 'Task title is required.')
  mutate((d) => { findB(d, id).tasks.push({ id: uid('t-'), title: title.trim(), done: false, due, by: me.id }) })
}
export function toggleTask(_me: User, id: string, taskId: string) {
  mutate((d) => { const t = findB(d, id).tasks.find((x) => x.id === taskId); if (t) t.done = !t.done })
}
export function deleteTask(_me: User, id: string, taskId: string) {
  mutate((d) => { const b = findB(d, id); b.tasks = b.tasks.filter((t) => t.id !== taskId) })
}

export function setPriority(me: User, id: string, priority: Booking['priority'], deadline?: string) {
  need(me, 'bookings.legal', 'bookings.process', 'bookings.approve_tl', 'bookings.accounts')
  mutate((d) => { const b = findB(d, id); b.priority = priority; if (deadline) b.deadline = deadline })
}

/** Team leader moves a client (CRM entry) to another sales person in the team. */
export function reassignOwner(me: User, id: string, salesId: string) {
  need(me, 'team.assign')
  mutate((d) => {
    const b = findB(d, id)
    const to = d.users.find((u) => u.id === salesId)
    assert(to, 'Pick a sales person.')
    if (!isSA(me)) assert(to.teamLeadId === me.id && b.teamLeadId === me.id, 'You can only assign within your team.')
    const from = b.createdBy
    b.createdBy = to.id
    notify(d, [to.id], 'Client assigned to you', `${b.bookingId} · ${b.companyName} by ${me.name}`, `/bookings/${b.id}`, 'action')
    audit(d, me.id, 'CLIENT_ASSIGN', `${b.bookingId}: ${userName(d, from)} → ${to.name}`)
  })
}

/** Sales person sends a client to a (different) team leader. */
export function sendToTeamLead(me: User, id: string, tlId: string) {
  mutate((d) => {
    const b = findB(d, id)
    assert(b.createdBy === me.id || isSA(me), 'Only the owner can do this.')
    assert(['PENDING_TL', 'REJECTED'].includes(b.status), 'Only entries waiting for a team leader can be moved.')
    const tl = d.users.find((u) => u.id === tlId && rolesOf(u).includes('teamlead'))
    assert(tl, 'Pick a team leader.')
    b.teamLeadId = tl.id
    b.status = 'PENDING_TL'
    notify(d, [tl.id], 'Client assigned to you', `${b.bookingId} · ${b.companyName} by ${me.name}`, `/bookings/${b.id}`, 'action')
  })
}

// ============================================================ billing
export function visibleInvoices(d: DB, me: User) {
  const p = effectivePerms(d, me)
  if (p.has('billing.manage')) return d.invoices
  return d.invoices.filter((i) => i.salesPerson === me.id || i.createdBy === me.id)
}

export function createInvoice(me: User, i: { type: Invoice['type']; client: string; gstin: string; state: string; items: InvoiceItem[]; bookingId?: string; salesPerson?: string; due: string }) {
  need(me, 'billing.create', 'billing.manage')
  assert(i.client.trim(), 'Client name is required.')
  assert(!i.gstin || isGstin(i.gstin), 'GSTIN format is invalid.')
  assert(i.items.length && i.items.every((x) => x.desc && x.qty > 0 && x.rate >= 0), 'Each line needs a description, quantity and rate.')
  if (i.type === 'TAX') need(me, 'billing.manage')
  return mutate((d) => {
    const fy = (() => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}` })()
    const inv: Invoice = {
      id: uid('inv-'), number: `${i.type === 'TAX' ? 'RX' : 'PF'}/${fy}/${String(d.counters.invoice++).padStart(4, '0')}`,
      type: i.type, bookingId: i.bookingId, client: i.client.trim(), gstin: i.gstin.toUpperCase(), state: i.state, items: i.items,
      paid: 0, status: 'ISSUED', date: today(), due: i.due, salesPerson: i.salesPerson ?? me.id, createdBy: me.id,
    }
    d.invoices.unshift(inv)
    audit(d, me.id, 'INVOICE_CREATE', inv.number)
    return inv.id
  })
}

export function invoiceFromBooking(me: User, bookingId: string, type: Invoice['type']) {
  const d = getDb()
  const b = d.bookings.find((x) => x.id === bookingId)
  assert(b, 'CRM entry not found.')
  return createInvoice(me, {
    type, client: b.companyName, gstin: b.gstin, state: b.state, bookingId: b.id, salesPerson: b.createdBy,
    due: ymd(addDays(new Date(), 15)), items: [{ desc: b.serviceName, sac: '998311', qty: 1, rate: b.totalQuoted, gstRate: b.gstRate }],
  })
}

export function recordInvoicePayment(me: User, id: string, amount: number, grand: number) {
  need(me, 'billing.manage')
  assert(amount > 0, 'Amount must be more than 0.')
  mutate((d) => {
    const inv = d.invoices.find((x) => x.id === id)
    assert(inv && inv.status !== 'CANCELLED', 'Invoice not found or cancelled.')
    inv.paid = round2(Math.min(grand, inv.paid + amount))
    inv.status = inv.paid >= grand - 0.5 ? 'PAID' : 'PARTIALLY_PAID'
    audit(d, me.id, 'INVOICE_PAYMENT', `${inv.number} ₹${amount}`)
  })
}
export function cancelInvoice(me: User, id: string) {
  need(me, 'billing.manage')
  mutate((d) => {
    const inv = d.invoices.find((x) => x.id === id)
    assert(inv, 'Invoice not found.')
    inv.status = 'CANCELLED'
    audit(d, me.id, 'INVOICE_CANCEL', inv.number)
  })
}

// ============================================================ content
export function upsertScheme(me: User, s: Omit<Scheme, 'id' | 'createdAt' | 'by'> & { id?: string }) {
  need(me, 'schemes.manage')
  assert(s.title.trim(), 'Title is required.')
  mutate((d) => {
    if (s.id) { Object.assign(d.schemes.find((x) => x.id === s.id)!, s); return }
    d.schemes.unshift({ ...s, id: uid('sc-'), createdAt: nowIso(), by: me.id })
    notify(d, usersWithRole(d, 'sales', 'teamlead').map((u) => u.id), 'New scheme published', s.title, '/schemes', 'info')
  })
}
export function deleteScheme(me: User, id: string) {
  need(me, 'schemes.manage')
  mutate((d) => { d.schemes = d.schemes.filter((x) => x.id !== id) })
}
export function upsertPost(me: User, p: Omit<Post, 'id' | 'createdAt' | 'by'> & { id?: string }) {
  need(me, 'content.manage')
  assert(p.title.trim(), 'Title is required.')
  mutate((d) => {
    if (p.id) { Object.assign(d.posts.find((x) => x.id === p.id)!, p); return }
    d.posts.unshift({ ...p, id: uid('po-'), createdAt: nowIso(), by: me.id })
    const label = p.kind === 'FLYER' ? 'flyer' : p.kind === 'POST' ? 'post' : 'sales information'
    notify(d, usersWithRole(d, 'sales', 'teamlead').map((u) => u.id), `New ${label}`, p.title, '/content', 'info')
  })
}
export function deletePost(me: User, id: string) {
  need(me, 'content.manage')
  mutate((d) => { d.posts = d.posts.filter((x) => x.id !== id) })
}

export function publishBroadcast(me: User, b: { title: string; body: string; priority: 'NORMAL' | 'HIGH' | 'URGENT'; audience: Role[] | 'ALL' }) {
  need(me, 'broadcasts.manage')
  assert(b.title.trim() && b.body.trim(), 'Title and message are required.')
  mutate((d) => {
    d.broadcasts.unshift({ ...b, id: uid('br-'), by: me.id, at: nowIso(), acks: [] })
    const to = b.audience === 'ALL' ? d.users.filter((u) => u.active) : usersWithRole(d, ...b.audience)
    notify(d, to.map((u) => u.id).filter((x) => x !== me.id), `📣 ${b.title}`, b.body.slice(0, 100), '/broadcasts', b.priority === 'NORMAL' ? 'info' : 'warning')
    fireAutomation(d, 'broadcast-copy', to.filter((u) => u.id !== me.id), () => ({ title: b.title, message: b.body }))
    audit(d, me.id, 'BROADCAST', b.title)
  })
}
export function ackBroadcast(me: User, id: string) {
  mutate((d) => { const b = d.broadcasts.find((x) => x.id === id); if (b && !b.acks.includes(me.id)) b.acks.push(me.id) })
}

export function upsertEvent(me: User, e: Omit<EventItem, 'id' | 'by'> & { id?: string }) {
  need(me, 'events.manage')
  assert(e.title.trim() && e.date, 'Title and date are required.')
  mutate((d) => {
    if (e.id) { Object.assign(d.events.find((x) => x.id === e.id)!, e); return }
    d.events.push({ ...e, id: uid('ev-'), by: me.id })
  })
}
export function deleteEvent(me: User, id: string) {
  need(me, 'events.manage')
  mutate((d) => { d.events = d.events.filter((x) => x.id !== id) })
}

// ============================================================ leave
export function leaveApprovers(role: Role): Role[] {
  if (role === 'sales') return ['teamlead', 'legal', 'hr', 'superadmin']
  if (role === 'teamlead') return ['hr', 'superadmin']
  if (role === 'hr' || role === 'superadmin') return ['superadmin']
  return ['hr', 'superadmin']
}

export function applyLeave(me: User, l: { type: LeaveType; from: string; to: string; reason: string }) {
  assert(l.from && l.to && l.to >= l.from, 'Pick a valid date range.')
  assert(l.reason.trim().length >= 3, 'Give a short reason.')
  const days = daysBetween(l.from, l.to) + 1
  assert(!(l.type === 'SL' && days > 2 && !/certificate|medical/i.test(l.reason)), 'Sick leave over 2 days needs a medical certificate (mention it in the reason).')
  mutate((d) => {
    assert(!d.leaves.some((x) => x.userId === me.id && x.status !== 'REJECTED' && x.status !== 'CANCELLED' && !(l.to < x.from || l.from > x.to)), 'You already have leave in these dates.')
    const approvers = leaveApprovers(me.role)
    d.leaves.unshift({ id: uid('lv-'), userId: me.id, ...l, days, status: 'PENDING', approvers, createdAt: nowIso() })
    const targets = usersWithRole(d, ...approvers).filter((u) => u.id !== me.id && (!rolesOf(u).includes('teamlead') || u.id === me.teamLeadId || rolesOf(u).some((r) => r !== 'teamlead' && approvers.includes(r))))
    notify(d, targets.map((u) => u.id), 'Leave request', `${me.name}: ${days} day(s) ${l.type}`, '/leave', 'action')
  })
}

export function canDecideLeave(d: DB, me: User, l: { userId: string; approvers: Role[]; status: string }) {
  if (l.status !== 'PENDING') return false
  if (l.userId === me.id && !isSA(me)) return false
  if (isSA(me)) return true
  if (!effectivePerms(d, me).has('leave.approve')) return false
  const mine = rolesOf(me).filter((r) => l.approvers.includes(r))
  if (!mine.length) return false
  if (mine.length === 1 && mine[0] === 'teamlead') return d.users.find((u) => u.id === l.userId)?.teamLeadId === me.id
  return true
}

export function decideLeave(me: User, id: string, approve: boolean, remark: string) {
  mutate((d) => {
    const l = d.leaves.find((x) => x.id === id)
    assert(l && canDecideLeave(d, me, l), 'You cannot decide this request.')
    assert(approve || remark.trim(), 'A reason is required to reject.')
    l.status = approve ? 'APPROVED' : 'REJECTED'
    l.decidedBy = me.id; l.decidedAt = nowIso(); l.remark = remark
    notify(d, [l.userId], `Leave ${approve ? 'approved' : 'rejected'}`, `${l.days} day(s) from ${l.from}${remark ? ' · ' + remark : ''}`, '/leave', approve ? 'success' : 'warning')
    const applicant = d.users.find((u) => u.id === l.userId)
    if (applicant) fireAutomation(d, 'leave-decision', [applicant], () => ({
      status: approve ? 'approved' : 'rejected', leave_type: l.type, leave_days: l.days, decided_by: me.name,
      leave_dates: l.from === l.to ? fmtDate(l.from) : `${fmtDate(l.from)} – ${fmtDate(l.to)}`, remark: remark ? `\nNote: ${remark}` : '',
    }))
    audit(d, me.id, 'LEAVE_' + l.status, `${userName(d, l.userId)} ${l.from}→${l.to}`)
  })
}
export function cancelLeave(me: User, id: string) {
  mutate((d) => {
    const l = d.leaves.find((x) => x.id === id)
    assert(l && l.userId === me.id && l.status === 'PENDING', 'Only your pending requests can be cancelled.')
    l.status = 'CANCELLED'
  })
}

// ============================================================ notifications & messages
export function markRead(me: User, id?: string) {
  mutate((d) => { for (const n of d.notices) if (n.userId === me.id && (!id || n.id === id)) n.read = true })
}
export function sendMessage(me: User, to: string, body: string) {
  need(me, 'messages.use')
  assert(body.trim(), 'Write a message.')
  mutate((d) => {
    d.messages.push({ id: uid('m-'), from: me.id, to, body: body.trim(), at: nowIso(), read: false })
  })
}
export function markThreadRead(me: User, other: string) {
  mutate((d) => { for (const m of d.messages) if (m.to === me.id && m.from === other) m.read = true })
}
export function upsertTemplate(me: User, t: { id?: string; name: string; body: string }) {
  need(me, 'templates.manage')
  assert(t.name.trim() && t.body.trim(), 'Name and text are required.')
  mutate((d) => {
    if (t.id) { Object.assign(d.templates.find((x) => x.id === t.id)!, t); return }
    d.templates.push({ id: uid('tp-'), name: t.name, body: t.body, by: me.id })
  })
}
export function deleteTemplate(me: User, id: string) {
  need(me, 'templates.manage')
  mutate((d) => { d.templates = d.templates.filter((x) => x.id !== id) })
}

// ============================================================ users & access
export type UserInput = Pick<User, 'name' | 'username' | 'email' | 'phone' | 'role' | 'department' | 'designation'> & { teamLeadId?: string; salary?: number }

export async function createUser(me: User, i: UserInput) {
  need(me, 'access.manage', 'employees.manage')
  assert(i.name.trim() && i.username.trim(), 'Name and username are required.')
  assert(isEmail(i.email), 'Enter a valid email.')
  assert(!i.phone || isPhone(i.phone), 'Enter a valid 10-digit phone.')
  assert(i.role !== 'superadmin' || isSA(me), 'Only a Super Admin can create a Super Admin.')
  const d = getDb()
  assert(!d.users.some((u) => u.username.toLowerCase() === i.username.toLowerCase()), 'Username already taken.')
  assert(!d.users.some((u) => u.email.toLowerCase() === i.email.toLowerCase()), 'Email already used.')
  const passHash = await hashPassword(i.username, DEMO_PASSWORD)
  mutate((m) => {
    const created: User = { ...i, id: uid('u-'), email: i.email.trim().toLowerCase(), phone: i.phone ? normPhone(i.phone) : '', extraRoles: [], grants: [], denies: [], joinedOn: today(), active: true, passHash }
    m.users.push(created)
    audit(m, me.id, 'USER_CREATE', `${i.name} (${roleLabel(i.role)})`)
    fireAutomation(m, 'welcome', [created])
  })
}

export function updateUser(me: User, id: string, patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'role' | 'extraRoles' | 'grants' | 'denies' | 'active' | 'teamLeadId' | 'department' | 'designation' | 'salary' | 'target'>>) {
  need(me, 'access.manage', 'employees.manage')
  mutate((d) => {
    const u = d.users.find((x) => x.id === id)
    assert(u, 'User not found.')
    const accessChange = ['role', 'extraRoles', 'grants', 'denies', 'active'].some((k) => k in patch)
    const touchesSA = rolesOf(u).includes('superadmin') || patch.role === 'superadmin' || !!patch.extraRoles?.includes('superadmin')
    assert(!touchesSA || isSA(me), 'Only a Super Admin can change Super Admin accounts or make someone a Super Admin.')
    if (accessChange) {
      assert(has(me, 'access.manage'), 'Only access managers can change roles or access.')
      assert(u.id !== me.id, "You can't change your own access.")
      if (u.role === 'superadmin' && (patch.role && patch.role !== 'superadmin' || patch.active === false)) {
        assert(d.users.filter((x) => x.role === 'superadmin' && x.active && x.id !== u.id).length > 0, 'At least one active Super Admin must remain.')
      }
    }
    Object.assign(u, patch)
    audit(d, me.id, accessChange ? 'ACCESS_CHANGE' : 'USER_EDIT', u.name)
  })
}

export async function resetUserPassword(me: User, id: string) {
  need(me, 'access.manage')
  const u = getDb().users.find((x) => x.id === id)
  assert(u, 'User not found.')
  assert(!rolesOf(u).includes('superadmin') || isSA(me), "Only a Super Admin can reset a Super Admin's password.")
  const h = await hashPassword(u.username, DEMO_PASSWORD)
  mutate((d) => { d.users.find((x) => x.id === id)!.passHash = h; audit(d, me.id, 'PASSWORD_RESET', u.name) })
}

export function setRolePerms(me: User, role: Role, perms: Perm[]) {
  need(me, 'access.manage')
  assert(!MASTER_ROLES.includes(role), `${roleLabel(role)} always has every permission.`)
  mutate((d) => { d.rolePerms[role] = perms; audit(d, me.id, 'ROLE_PERMS', `${roleLabel(role)}: ${perms.length} permissions`) })
}

export function updateProfile(me: User, patch: Partial<Pick<User, 'name' | 'phone' | 'address' | 'photo'>>) {
  if (patch.phone !== undefined) assert(isPhone(patch.phone), 'Phone must be 10 digits.')
  if (patch.address?.pin && patch.address.country === 'India') assert(/^[1-9]\d{5}$/.test(patch.address.pin), 'PIN code must be 6 digits.')
  if (patch.name !== undefined) assert(patch.name.trim().length >= 2, 'Name is required.')
  mutate((d) => {
    const u = d.users.find((x) => x.id === me.id)!
    Object.assign(u, patch, patch.phone ? { phone: normPhone(patch.phone) } : {})
    audit(d, me.id, 'PROFILE', 'Updated own profile')
  })
}

export function updateSettings(me: User, patch: Partial<DB['settings']>) {
  assert(isMaster(me), 'Only Super Admin or IT Support can change settings.')
  mutate((d) => { Object.assign(d.settings, patch); audit(d, me.id, 'SETTINGS', JSON.stringify(patch)) })
}
