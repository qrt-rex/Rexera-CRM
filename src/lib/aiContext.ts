import type { DB, User } from './types'
import { breakFor, breakLabel, breakReview, breakUsedMs, canDecideLeave, userName, visibleBookings, visibleLeads } from './actions'
import { effectivePerms, roleLabel } from './rbac'
import { MODULES, canSee } from './modules'
import { dayStatus, monthStart, todaySession, waitingFor } from './metrics'
import { BOOKING_STATUS, OPEN_LEAD, stageLabel } from './workflow'
import { bookingMoney, fmtDate, fmtTime, today } from './format'

/**
 * What Rexy may know about the signed-in person: only data their role can see in the CRM, summarised and capped so the
 * question stays small (fast and cheap). Nothing here is sent anywhere except our own server, which forwards it to the AI.
 */
export function buildAiContext(db: DB, me: User): string {
  const p = effectivePerms(db, me)
  const can = (...x: Parameters<typeof p.has>[0][]) => x.some((y) => p.has(y))
  const t = today(), month = monthStart()
  const ctx: Record<string, unknown> = {}

  ctx.me = { name: me.name, role: roleLabel(me.role), department: me.department, designation: me.designation, email: me.email }
  ctx.now = { date: fmtDate(t), time: fmtTime(new Date().toISOString()), weekday: new Date().toLocaleDateString('en-IN', { weekday: 'long' }) }
  ctx.pages = [{ label: 'My dashboard', path: `/dashboard/${me.role}` }, ...MODULES.filter((m) => canSee(m, can)).map((m) => ({ label: m.label, path: m.path }))]

  // ---- my day
  const s = todaySession(db, me.id)
  const lb = breakReview(s)
  const mine = db.sessions.filter((x) => x.userId === me.id && x.date >= month)
  ctx.myAttendance = {
    today: s ? { started: fmtTime(s.loginAt), ended: s.logoutAt ? fmtTime(s.logoutAt) : 'still working', breakMinutesUsed: Math.round(breakUsedMs(s) / 60000), lateFromBreak: lb.state === 'LATE' || lb.state === 'STILL_AWAY' ? `${lb.lateMinutes} min` : 'no' } : 'day not started yet',
    lunchBreak: breakLabel(breakFor(me, db)),
    thisMonth: { daysLoggedIn: mine.length, lateLogins: mine.filter((x) => { const d = new Date(x.loginAt); return d.getHours() * 60 + d.getMinutes() > 9 * 60 + 30 }).length, lateBreaks: mine.filter((x) => x.lateBreak).length },
  }

  // ---- my leave
  const year = t.slice(0, 4)
  const myLeave = db.leaves.filter((l) => l.userId === me.id && l.from.startsWith(year))
  const used: Record<string, number> = {}
  for (const l of myLeave) if (l.status === 'APPROVED') used[l.type] = (used[l.type] ?? 0) + l.days
  ctx.myLeave = {
    note: 'No leave-balance quota is configured in this CRM; these are leave days taken/approved this year (CL casual, SL sick, EL earned, LOP loss of pay).',
    approvedDaysThisYear: used,
    requests: myLeave.slice(-8).map((l) => ({ type: l.type, from: fmtDate(l.from), to: fmtDate(l.to), days: l.days, status: l.status, reason: l.reason.slice(0, 60) })),
  }
  const toDecide = db.leaves.filter((l) => l.status === 'PENDING' && l.userId !== me.id && canDecideLeave(db, me, l))
  if (toDecide.length) ctx.leaveRequestsWaitingForMe = toDecide.slice(0, 10).map((l) => ({ who: userName(db, l.userId), type: l.type, from: fmtDate(l.from), to: fmtDate(l.to), days: l.days }))

  // ---- my pay (own rows only)
  const pay = db.payrollRuns.filter((r) => r.status === 'FINALIZED' || r.status === 'PAID').sort((a, b) => b.month.localeCompare(a.month))
    .map((r) => ({ r, row: r.rows.find((x) => x.userId === me.id) })).find((x) => x.row)
  if (pay?.row) ctx.myLatestPayslip = { month: pay.r.month, status: pay.r.status, net: pay.row.net, gross: pay.row.gross, basic: pay.row.basic, pfEmployee: pay.row.pfEmployee, professionalTax: pay.row.pt, paidDays: pay.row.paidDays, lopDays: pay.row.lopDays, page: '/payslips' }

  // ---- calendar, inbox
  ctx.upcomingEvents = db.events.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map((e) => ({ title: e.title, date: fmtDate(e.date), time: e.kind === 'HOLIDAY' ? 'all day' : e.time, kind: e.kind.toLowerCase() }))
  const unread = db.notices.filter((n) => n.userId === me.id && !n.read)
  ctx.inbox = { unreadNotifications: unread.length, latest: unread.slice(0, 5).map((n) => n.title), unreadMessages: db.messages.filter((m) => m.to === me.id && !m.read).length }

  // ---- client files (only those visible to me)
  const files = visibleBookings(db, me)
  if (files.length) {
    const byStatus: Record<string, number> = {}
    for (const b of files) byStatus[BOOKING_STATUS[b.status].label] = (byStatus[BOOKING_STATUS[b.status].label] ?? 0) + 1
    const row = (b: (typeof files)[number]) => ({ id: b.id, crmId: b.bookingId, company: b.companyName, service: b.serviceName.slice(0, 60), status: BOOKING_STATUS[b.status].label, stage: b.opsMemberId ? stageLabel(b.stage, b.stageOutcome) : undefined, deadline: b.deadline ? fmtDate(b.deadline) : undefined, salesPerson: userName(db, b.createdBy), paidWithGst: bookingMoney(b).collected })
    ctx.clientFiles = {
      total: files.length, byStatus,
      waitingForMe: waitingFor(db, me).slice(0, 10).map(row),
      overdue: files.filter((b) => !['COMPLETED', 'REJECTED'].includes(b.status) && b.deadline && b.deadline < t).slice(0, 8).map(row),
      assignedToMe: files.filter((b) => (b.opsMemberId === me.id || b.adminId === me.id) && !['COMPLETED', 'REJECTED'].includes(b.status)).slice(0, 10).map(row),
      recent: [...files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(row),
    }
    const tasks = files.flatMap((b) => b.tasks.filter((x) => !x.done && (x.assignee === me.id || b.opsMemberId === me.id || b.adminId === me.id)).map((x) => ({ task: x.title, file: b.companyName, fileId: b.id, due: x.due ? fmtDate(x.due) : undefined, overdue: !!x.due && x.due < t })))
    if (tasks.length) ctx.myOpenTasks = tasks.slice(0, 12)
    if (can('bookings.create')) {
      const own = files.filter((b) => b.createdBy === me.id)
      ctx.mySales = { entries: own.length, collectedThisMonthWithGst: Math.round(own.reduce((n, b) => n + b.payments.filter((x) => x.date >= month).reduce((m, x) => m + x.total, 0), 0)) }
    }
    if (can('bookings.accounts')) ctx.accounts = { paymentsToVerify: files.reduce((n, b) => n + b.payments.filter((x) => !x.verified).length, 0) }
  }

  // ---- leads
  if (can('leads.own', 'leads.manage')) {
    const leads = visibleLeads(db, me).filter((l) => l.assignedTo === me.id || (!l.assignedTo && l.createdBy === me.id) || can('leads.manage'))
    const open = leads.filter((l) => OPEN_LEAD.includes(l.status))
    ctx.leads = {
      open: open.length, converted: leads.filter((l) => l.status === 'CONVERTED').length,
      followUpsDue: open.filter((l) => l.followUp && l.followUp <= t).slice(0, 10).map((l) => ({ name: l.name, company: l.company, followUp: fmtDate(l.followUp!), status: l.status })),
      callsToday: db.leads.reduce((n, l) => n + l.calls.filter((c) => c.by === me.id && c.at.slice(0, 10) === t).length, 0),
    }
  }

  // ---- team (HR / managers)
  if (can('attendance.all')) {
    const active = db.users.filter((u) => u.active)
    const st = active.map((u) => ({ u, s: dayStatus(db, u.id) }))
    ctx.teamToday = {
      headcount: active.length, working: st.filter((x) => x.s === 'WORKING').length, onBreak: st.filter((x) => x.s === 'ON_BREAK').map((x) => x.u.name),
      onLeave: st.filter((x) => x.s === 'ON_LEAVE').map((x) => x.u.name), notStarted: st.filter((x) => x.s === 'NOT_STARTED').map((x) => x.u.name).slice(0, 20),
      lateFromBreak: db.sessions.filter((x) => x.date === t && x.lateBreak).map((x) => `${userName(db, x.userId)} (${x.lateBreak!.lateMinutes} min)`),
    }
  }

  // keep it small: drop the bulkiest lists until it fits
  let out = JSON.stringify(ctx)
  const trim = ['recent', 'upcomingEvents', 'myOpenTasks', 'overdue', 'assignedToMe']
  for (const k of trim) {
    if (out.length <= 12000) break
    const cf = ctx.clientFiles as Record<string, unknown> | undefined
    if (cf && k in cf) delete cf[k]; else delete ctx[k]
    out = JSON.stringify(ctx)
  }
  return out.slice(0, 13500)
}
