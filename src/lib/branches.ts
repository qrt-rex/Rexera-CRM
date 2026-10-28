import type { Booking, DB, Invoice, Lead, User } from './types'
import { rolesOf, isMaster } from './rbac'
import { OPEN_LEAD } from './workflow'
import { bookingMoney, today, ymd } from './format'

/**
 * Branches, who works where, and branch / sales-person progress. Each branch (AMD-A, AMD-Y, Vadodara …) has its own
 * dashboard: a Branch Director sees only the branches they run; Super Admin / IT see every branch.
 */
export const NO_BRANCH = '__none__'
export const branchList = (db: DB) => db.settings.branches ?? []
export const branchName = (db: DB, id?: string) => (id && id !== NO_BRANCH ? branchList(db).find((b) => b.id === id)?.name ?? 'Unknown branch' : 'No branch set')
/** Short code (AMD-A) — falls back to the name. */
export const branchCode = (db: DB, id?: string) => {
  const b = id && id !== NO_BRANCH ? branchList(db).find((x) => x.id === id) : undefined
  return b ? b.code?.trim() || b.name : 'No branch'
}
/** "AMD-A · Ahmedabad (A)" */
export const branchLabel = (db: DB, id?: string) => {
  const b = id && id !== NO_BRANCH ? branchList(db).find((x) => x.id === id) : undefined
  return b ? (b.code?.trim() && b.code.trim() !== b.name ? `${b.code.trim()} · ${b.name}` : b.name) : branchName(db, id)
}
/**
 * The branch an invoice is issued from: the one saved on it (the creator's branch when it was made), else the
 * creator's branch now — never picked by hand. Its address, GSTIN and bank print on the invoice.
 */
export const invoiceBranch = (db: DB, inv: Pick<Invoice, 'branchId' | 'createdBy'>) => {
  const id = inv.branchId ?? db.users.find((u) => u.id === inv.createdBy)?.branchId
  return id ? branchList(db).find((b) => b.id === id) : undefined
}
const monthStart = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)) }

/**
 * The branches someone can see. Super Admin / IT: every branch. A Branch Director: the branches HR ticked for them,
 * else the branch they work in — never every branch by default, so a director only ever sees their own branch.
 */
export function directorBranches(db: DB, me: User): string[] {
  const all = branchList(db).map((b) => b.id)
  if (isMaster(me)) return all
  const mine = me.branchIds?.length ? me.branchIds : me.branchId ? [me.branchId] : []
  return mine.filter((id) => all.includes(id))
}
/** Only Super Admin / IT also see people who have no branch yet (so nobody is missed). */
export const seesUnbranched = (me: User) => isMaster(me)
/** Branch Directors are scoped to their branches everywhere (leads, CRM entries); people with wider roles are not. */
export const isBranchScoped = (me: User) => me.role === 'branchdirector' && !isMaster(me)

export const isSalesPerson = (u: User) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead')
export const salesTeam = (db: DB, branches: string[], unbranched: boolean) =>
  db.users.filter((u) => isSalesPerson(u) && (u.branchId ? branches.includes(u.branchId) : unbranched))
/** Everyone who works in these branches (every role). */
export const branchStaff = (db: DB, branches: string[], unbranched = false) =>
  db.users.filter((u) => u.active && (u.branchId ? branches.includes(u.branchId) : unbranched))
/** Branch Directors who run this branch. */
export const directorsOf = (db: DB, id: string) =>
  db.users.filter((u) => u.active && u.role === 'branchdirector' && (u.branchIds?.length ? u.branchIds.includes(id) : u.branchId === id))

/** A client file belongs to the branch of the sales person who booked it (or their team leader). */
export function bookingBranch(db: DB, b: Booking) {
  const by = db.users.find((u) => u.id === b.createdBy)
  return by?.branchId ?? db.users.find((u) => u.id === b.teamLeadId)?.branchId
}
export const branchBookings = (db: DB, branches: string[]) => db.bookings.filter((b) => branches.includes(bookingBranch(db, b) ?? NO_BRANCH))
/** The branch a lead belongs to: the branch of the person it is assigned to. */
export const leadBranch = (db: DB, l: Lead) => (l.assignedTo ? db.users.find((u) => u.id === l.assignedTo)?.branchId : undefined)

export interface Progress {
  callsToday: number; callsMonth: number; openLeads: number; followUpsDue: number
  bookingsMonth: number; collectedMonth: number; outstanding: number; target: number; achievedPct: number | null
}
/** Progress for a group of sales people (one person, a branch, or everyone in scope). Money includes GST. */
export function progressFor(db: DB, people: User[]): Progress {
  const ids = new Set(people.map((u) => u.id))
  const t = today(), month = monthStart()
  let callsToday = 0, callsMonth = 0, openLeads = 0, followUpsDue = 0
  for (const l of db.leads) {
    for (const c of l.calls) if (ids.has(c.by)) { const d = ymd(c.at); if (d === t) callsToday++; if (d >= month) callsMonth++ }
    if (l.assignedTo && ids.has(l.assignedTo) && OPEN_LEAD.includes(l.status)) { openLeads++; if (l.followUp && l.followUp <= t) followUpsDue++ }
  }
  let bookingsMonth = 0, collectedMonth = 0, outstanding = 0
  for (const b of db.bookings) {
    if (!ids.has(b.createdBy) || b.status === 'REJECTED') continue
    if ((b.bookingDate ?? ymd(b.createdAt)) >= month) bookingsMonth++
    for (const p of b.payments) if (p.date >= month && p.date <= t) collectedMonth += p.total
    outstanding += bookingMoney(b).outstanding
  }
  const target = people.reduce((s, u) => s + (u.target ?? 0), 0)
  return {
    callsToday, callsMonth, openLeads, followUpsDue, bookingsMonth,
    collectedMonth: Math.round(collectedMonth), outstanding: Math.round(outstanding), target,
    achievedPct: target ? Math.round((collectedMonth / target) * 100) : null,
  }
}

/** Collections (with GST) per month for a group, last `months` months. */
export function collectionsTrend(db: DB, people: User[], months = 6) {
  const ids = new Set(people.map((u) => u.id))
  const now = new Date()
  return Array.from({ length: months }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - k), 1)
    const from = ymd(d), to = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    let v = 0
    for (const b of db.bookings) if (ids.has(b.createdBy)) for (const p of b.payments) if (p.date >= from && p.date <= to) v += p.total
    return { label: d.toLocaleDateString('en-IN', { month: 'short' }), value: Math.round(v) }
  })
}

/** Leads a director can hand out: not assigned yet, or assigned to someone in their branches. */
export function assignableLeads(db: DB, team: User[], mode: 'unassigned' | 'team') {
  const ids = new Set(team.map((u) => u.id))
  return db.leads.filter((l: Lead) => OPEN_LEAD.includes(l.status) && (mode === 'unassigned' ? !l.assignedTo : !!l.assignedTo && ids.has(l.assignedTo)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
