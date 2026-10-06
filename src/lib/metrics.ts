import type { DB, User } from './types'
import { availableDecisions, visibleBookings, visibleLeads } from './actions'
import { OPEN_LEAD } from './workflow'
import { addDays, bookingMoney, invoiceTotals, today, ymd } from './format'

export const monthStart = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)) }

export function todaySession(db: DB, userId: string) {
  return db.sessions.find((s) => s.userId === userId && s.date === today())
}

export function dayStatus(db: DB, userId: string): 'WORKING' | 'ON_BREAK' | 'DAY_ENDED' | 'ON_LEAVE' | 'NOT_STARTED' {
  const s = todaySession(db, userId)
  if (s) return s.logoutAt ? 'DAY_ENDED' : s.breaks?.some((b) => !b.end) ? 'ON_BREAK' : 'WORKING'
  const t = today()
  if (db.leaves.some((l) => l.userId === userId && l.status === 'APPROVED' && l.from <= t && l.to >= t)) return 'ON_LEAVE'
  return 'NOT_STARTED'
}

export function presentToday(db: DB) {
  const active = db.users.filter((u) => u.active)
  const present = active.filter((u) => todaySession(db, u.id)).length
  return { present, total: active.length }
}

/** Collections (with GST) credited to a sales person from a date. */
export function collections(db: DB, userIds: string[], from: string, to = '9999-12-31') {
  let sum = 0
  for (const b of db.bookings) if (userIds.includes(b.createdBy)) for (const p of b.payments) if (p.date >= from && p.date <= to) sum += p.total
  return Math.round(sum)
}

/**
 * Files at the signed-in person's step. Being *able* to act (Super Admin overrides, Legal re-assigning a file already
 * with Operations) doesn't make a file wait for you when someone else is assigned to it.
 */
export function waitingFor(db: DB, me: User) {
  return visibleBookings(db, me).filter((b) => {
    const d = availableDecisions(db, me, b)
    if (!d.length) return false
    if (b.status === 'IN_OPERATIONS' && (b.opsMemberId ? b.opsMemberId !== me.id : false)) return false
    if (b.status === 'WITH_ADMIN' && b.adminId && b.adminId !== me.id) return false
    if (b.status === 'PENDING_TL' && b.teamLeadId && b.teamLeadId !== me.id) return false
    return true
  })
}

export function salesNumbers(db: DB, me: User) {
  const mine = visibleLeads(db, me).filter((l) => l.assignedTo === me.id || (!l.assignedTo && l.createdBy === me.id))
  const t = today()
  return {
    toCall: mine.filter((l) => OPEN_LEAD.includes(l.status)).length,
    followUps: mine.filter((l) => OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t).length,
    callsToday: db.leads.reduce((n, l) => n + l.calls.filter((c) => c.by === me.id && c.at.slice(0, 10) === t).length, 0),
    converted: mine.filter((l) => l.status === 'CONVERTED').length,
  }
}

export function revenueByMonth(db: DB, months = 6) {
  const out: { label: string; value: number }[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const from = ymd(d), to = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    let v = 0
    for (const b of db.bookings) for (const p of b.payments) if (p.date >= from && p.date <= to) v += p.total
    out.push({ label: d.toLocaleDateString('en-IN', { month: 'short' }), value: Math.round(v) })
  }
  return out
}

export function invoiceSummary(db: DB) {
  let billed = 0, collected = 0
  for (const inv of db.invoices) {
    if (inv.status === 'CANCELLED' || inv.type !== 'TAX') continue
    billed += invoiceTotals(inv, db.settings.supplierState).grand
    collected += inv.paid
  }
  return { billed: Math.round(billed), collected: Math.round(collected) }
}

export function pipelineTotals(db: DB, list = db.bookings) {
  let quoted = 0, collected = 0, outstanding = 0
  for (const b of list) {
    if (b.status === 'REJECTED') continue
    const m = bookingMoney(b)
    quoted += m.quotedWithGst; collected += m.collected; outstanding += m.outstanding
  }
  return { quoted: Math.round(quoted), collected: Math.round(collected), outstanding: Math.round(outstanding) }
}

export function attendanceWeek(db: DB) {
  const out: { label: string; present: number; leave: number; absent: number }[] = []
  const total = db.users.filter((u) => u.active).length
  for (let i = 6; i >= 0; i--) {
    const d = addDays(new Date(), -i)
    const k = ymd(d)
    if (d.getDay() === 0) continue
    const present = new Set(db.sessions.filter((s) => s.date === k).map((s) => s.userId)).size
    const leave = db.leaves.filter((l) => l.status === 'APPROVED' && l.from <= k && l.to >= k).length
    out.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), present, leave, absent: Math.max(0, total - present - leave) })
  }
  return out
}
