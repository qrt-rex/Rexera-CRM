import type { DB, IncentiveRules, PayRow, PayrollRun, PfAccount, PfSettings, User } from './types'
import { effectivePerms, rolesOf } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { fireAutomation } from './email'
import { nowIso, round2, today, uid, ymd } from './format'

// ------------------------------------------------------------------ months
export const thisMonth = () => today().slice(0, 7)
export const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7) }
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const n = new Date(y, m, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
export const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
export const monthEnded = (m: string) => monthDays(m).at(-1)! < today()
export function recentMonths(n = 12) {
  const out: string[] = []
  const d = new Date(); d.setDate(1)
  for (let i = 0; i < n; i++) { out.push(ymd(d).slice(0, 7)); d.setMonth(d.getMonth() - 1) }
  return out
}

// ------------------------------------------------------------------ attendance → paid days
export interface MonthAttendance { workingDays: number; present: number; half: number; leave: number; lopLeave: number; absent: number; beforeJoin: number; paidDays: number; lopDays: number }

/**
 * Rules: Sundays are paid · days before the joining date are loss of pay · a day started but not ended (or
 * shorter than 5 h) is a half day · approved CL/SL/EL is paid, LOP leave is not · a working day with no
 * punch and no leave is absent · days after today, and days before attendance tracking began, are paid.
 */
export function attendanceFor(db: DB, u: User, month: string): MonthAttendance {
  const t = today()
  const tracking = db.sessions.reduce((min, s) => (s.date < min ? s.date : min), '9999-12-31')
  const r: MonthAttendance = { workingDays: 0, present: 0, half: 0, leave: 0, lopLeave: 0, absent: 0, beforeJoin: 0, paidDays: 0, lopDays: 0 }
  for (const d of monthDays(month)) {
    const sunday = new Date(d + 'T00:00:00').getDay() === 0
    if (!sunday) r.workingDays++
    if (d < u.joinedOn) { r.lopDays++; r.beforeJoin++; continue }
    if (sunday || d > t || d < tracking) { r.paidDays++; continue }
    const s = db.sessions.find((x) => x.userId === u.id && x.date === d)
    if (s) {
      const hours = s.logoutAt ? (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 3600000 : d === t ? 9 : 0
      if (hours >= 5) { r.paidDays++; r.present++ } else { r.paidDays += 0.5; r.lopDays += 0.5; r.half++ }
      continue
    }
    const lv = db.leaves.find((l) => l.userId === u.id && l.status === 'APPROVED' && l.from <= d && l.to >= d)
    if (!lv && d === t) { r.paidDays++; continue } // today isn't over yet
    if (lv) {
      if (lv.type === 'LOP') { r.lopDays++; r.lopLeave++ } else { r.paidDays++; r.leave++ }
      continue
    }
    r.lopDays++; r.absent++
  }
  return r
}

// ------------------------------------------------------------------ sales incentive
export interface IncentiveBreakdown {
  salary: number; net: number; eligibleAt: number; eligible: boolean; monthlyAt: number
  daily: { date: string; amount: number; incentive: number }[]
  weekly: { week: string; amount: number; incentive: number }[]
  monthly: { pct: number; incentive: number }
  dailyTotal: number; weeklyTotal: number; total: number
}
const mondayOf = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x) }

/** Collections are payment amounts before GST, credited to the CRM entry's sales owner. */
export function salesIncentive(db: DB, u: User, month: string, rules: IncentiveRules = db.incentiveRules): IncentiveBreakdown {
  const salary = u.salary ?? 0
  const byDay = new Map<string, number>()
  for (const b of db.bookings) if (b.createdBy === u.id) for (const p of b.payments) if (p.date.startsWith(month)) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.amount)
  const net = round2([...byDay.values()].reduce((s, v) => s + v, 0))
  const byWeek = new Map<string, number>()
  for (const [d, v] of byDay) byWeek.set(mondayOf(d), (byWeek.get(mondayOf(d)) ?? 0) + v)
  const daily = [...byDay.entries()].sort().map(([date, amount]) => ({ date, amount, incentive: amount >= rules.dailyThreshold ? round2((amount * rules.dailyPct) / 100) : 0 }))
  const weekly = [...byWeek.entries()].sort().map(([week, amount]) => ({ week, amount, incentive: amount >= rules.weeklyThreshold ? round2((amount * rules.weeklyPct) / 100) : 0 }))
  const eligibleAt = salary * rules.eligibilityMultiple
  const monthlyAt = salary * rules.monthlyMultiple
  const eligible = salary > 0 && net >= eligibleAt
  const slab = net >= monthlyAt && salary > 0 ? rules.slabs.find((s) => s.upTo == null || net < s.upTo) : undefined
  const monthly = { pct: slab?.pct ?? 0, incentive: slab ? round2((net * slab.pct) / 100) : 0 }
  const dailyTotal = round2(daily.reduce((s, x) => s + x.incentive, 0))
  const weeklyTotal = round2(weekly.reduce((s, x) => s + x.incentive, 0))
  return { salary, net, eligibleAt, eligible, monthlyAt, daily, weekly, monthly, dailyTotal, weeklyTotal, total: eligible ? round2(dailyTotal + weeklyTotal + monthly.incentive) : 0 }
}
export const isSalesPerson = (u: User) => rolesOf(u).some((r) => r === 'sales' || r === 'teamlead')

// ------------------------------------------------------------------ payroll
/** Wages PF is calculated on: the basic, raised to the lower limit and capped at the upper limit when those are on. */
export function pfWagesFor(basic: number, pf: PfSettings) {
  let w = basic
  if (pf.floorEnabled && (pf.wageFloor ?? 0) > 0) w = Math.max(w, pf.wageFloor!)
  if (pf.ceilingEnabled) w = Math.min(w, pf.wageCeiling)
  return round2(w)
}

/** Salary split for a monthly salary (CTC), before LOP. */
export function salaryStructure(ctc: number, pf: PfSettings, enrolled = true) {
  const basic = round2((ctc * pf.basicPct) / 100)
  const hra = round2((basic * pf.hraPct) / 100)
  const otherAllowance = round2(ctc - basic - hra)
  const pfWages = pf.enabled && enrolled ? pfWagesFor(basic, pf) : 0
  const pfEmployer = Math.round((pfWages * pf.employerPct) / 100)
  const pfEmployee = Math.round((pfWages * pf.employeePct) / 100)
  const gross = round2(ctc - pfEmployer)
  return { basic, hra, otherAllowance, pfWages, pfEmployer, pfEmployee, gross }
}

/**
 * Salary 40,000 → Basic 20,000 (50%) · HRA 8,000 (40% of basic) · Other 12,000 · employer PF 2,400 (12% of basic)
 * → Gross 37,600 · employee PF 2,400 · PT 200 → Net 35,000. LOP = gross ÷ days in month × LOP days.
 */
export function computeRow(db: DB, u: User, month: string): PayRow {
  const days = monthDays(month).length
  const ctc = u.salary ?? 0
  const att = attendanceFor(db, u, month)
  const acct = db.pfAccounts.find((a) => a.userId === u.id)
  const s = salaryStructure(ctc, db.pfSettings, acct?.enrolled ?? true)
  const lopAmount = round2((s.gross / days) * att.lopDays)
  const earned = round2(s.gross - lopAmount)
  const pt = db.pfSettings.ptEnabled && earned >= 12000 ? 200 : 0
  const incentive = isSalesPerson(u) ? salesIncentive(db, u, month).total : 0
  return {
    userId: u.id, name: u.name, designation: u.designation, department: u.department,
    ctc, hra: s.hra, otherAllowance: s.otherAllowance, gross: s.gross, daysInMonth: days,
    paidDays: att.paidDays, lopDays: att.lopDays, lopAmount, basic: s.basic, pfWages: s.pfWages,
    pfEmployee: s.pfEmployee, pfEmployer: s.pfEmployer, pt, incentive,
    net: round2(earned - s.pfEmployee - pt),
  }
}

/** Net salary as shown on the payslip (older saved rows folded the incentive into net). */
export const salaryNet = (r: PayRow) => (r.ctc != null ? r.net : round2(r.net - r.incentive))

/** Incentives HR added for this person and month (paid separately, never on the payslip). */
export const manualFor = (db: DB, userId: string, month: string) => db.manualIncentives.filter((m) => m.userId === userId && m.month === month)
export const manualTotal = (db: DB, userId: string, month: string) => round2(manualFor(db, userId, month).reduce((s, m) => s + m.amount, 0))
export function payrollPeople(db: DB, month: string) {
  const end = monthDays(month).at(-1)!
  return db.users.filter((u) => u.active && (u.salary ?? 0) > 0 && u.joinedOn <= end)
}

function need(perm: 'payroll.manage' | 'incentives.manage', me: User) {
  if (!effectivePerms(getDb(), me).has(perm)) throw new ActionError("You don't have access to do that.")
}
function runFor(d: DB, month: string) { return d.payrollRuns.find((r) => r.month === month) }
const log = (d: DB, by: string, action: string, detail: string) => d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail })

export function calculatePayroll(me: User, month: string) {
  need('payroll.manage', me)
  mutate((d) => {
    const existing = runFor(d, month)
    if (existing && ['FINALIZED', 'PAID'].includes(existing.status)) throw new ActionError('This payroll is locked. Unlock it (with a reason) to recalculate.')
    const rows = payrollPeople(d, month).map((u) => computeRow(d, u, month))
    if (!rows.length) throw new ActionError('Nobody has a salary set for this month. Add salaries in Employee Details.')
    const entry = { at: nowIso(), by: me.id, action: existing ? 'RECALCULATED' : 'CALCULATED', note: `${rows.length} employees` }
    if (existing) Object.assign(existing, { rows, status: 'CALCULATED', provisional: !monthEnded(month), calculatedAt: entry.at, calculatedBy: me.id, history: [...existing.history, entry] })
    else d.payrollRuns.unshift({ id: uid('pr-'), month, status: 'CALCULATED', provisional: !monthEnded(month), rows, calculatedAt: entry.at, calculatedBy: me.id, history: [entry] } satisfies PayrollRun)
    log(d, me.id, 'PAYROLL_' + entry.action, `${monthLabel(month)}: ${rows.length} employees`)
  })
}

export function advancePayroll(me: User, month: string, to: 'APPROVED' | 'FINALIZED' | 'PAID', note = '') {
  need('payroll.manage', me)
  mutate((d) => {
    const run = runFor(d, month)
    if (!run) throw new ActionError('Calculate the payroll first.')
    const from = { APPROVED: 'CALCULATED', FINALIZED: 'APPROVED', PAID: 'FINALIZED' }[to]
    if (run.status !== from) throw new ActionError(`Payroll must be ${from.toLowerCase()} first.`)
    if (to === 'FINALIZED' && !monthEnded(month)) throw new ActionError('A month can be finalised only after it ends.')
    run.status = to
    run.history.push({ at: nowIso(), by: me.id, action: to, note })
    log(d, me.id, 'PAYROLL_' + to, monthLabel(month))
    if (to === 'FINALIZED') {
      const ids = new Set(run.rows.map((r) => r.userId))
      fireAutomation(d, 'payslip-ready', d.users.filter((u) => ids.has(u.id)), () => ({ month: monthLabel(month) }))
    }
  })
}

/** Reopens a finalised or paid month (reason recorded) and, by default, recalculates it straight away. */
export function unlockPayroll(me: User, month: string, reason: string, recalculate = true) {
  need('payroll.manage', me)
  if (reason.trim().length < 5) throw new ActionError('Give a reason (at least 5 characters).')
  mutate((d) => {
    const run = runFor(d, month)
    if (!run || !['FINALIZED', 'PAID'].includes(run.status)) throw new ActionError('This month is not locked.')
    const was = run.status
    run.status = 'CALCULATED'
    run.history.push({ at: nowIso(), by: me.id, action: 'UNLOCKED', note: `${reason.trim()} (was ${was.toLowerCase()})` })
    if (recalculate) {
      run.rows = payrollPeople(d, month).map((u) => computeRow(d, u, month))
      run.provisional = !monthEnded(month)
      run.calculatedAt = nowIso(); run.calculatedBy = me.id
      run.history.push({ at: run.calculatedAt, by: me.id, action: 'RECALCULATED', note: `${run.rows.length} employees` })
    }
    log(d, me.id, 'PAYROLL_UNLOCK', `${monthLabel(month)} (was ${was.toLowerCase()}): ${reason.trim()}`)
  })
}

/** HR changes an employee's monthly salary; every open (not locked) payroll month is recalculated. */
export function setSalary(me: User, userId: string, salary: number) {
  need('payroll.manage', me)
  if (!(Number.isFinite(salary) && salary >= 0)) throw new ActionError('Salary must be 0 or more.')
  return mutate((d) => {
    const u = d.users.find((x) => x.id === userId)
    if (!u) throw new ActionError('Employee not found.')
    const old = u.salary ?? 0
    u.salary = round2(salary)
    const redone: string[] = []
    for (const run of d.payrollRuns) {
      if (!['CALCULATED', 'APPROVED'].includes(run.status)) continue
      run.rows = payrollPeople(d, run.month).map((x) => computeRow(d, x, run.month))
      run.status = 'CALCULATED'
      run.calculatedAt = nowIso(); run.calculatedBy = me.id
      run.history.push({ at: run.calculatedAt, by: me.id, action: 'RECALCULATED', note: `Salary of ${u.name}: ₹${old} → ₹${u.salary}` })
      redone.push(run.month)
    }
    log(d, me.id, 'SALARY_CHANGE', `${u.name}: ₹${old} → ₹${u.salary}`)
    return redone
  })
}

export function addManualIncentive(me: User, i: { userId: string; month: string; amount: number; reason: string }) {
  need('incentives.manage', me)
  if (!/^\d{4}-\d{2}$/.test(i.month) || i.month > thisMonth()) throw new ActionError('Pick this month or an earlier one.')
  if (!(i.amount > 0)) throw new ActionError('Amount must be more than 0.')
  if (i.reason.trim().length < 3) throw new ActionError('Give a short reason.')
  mutate((d) => {
    const u = d.users.find((x) => x.id === i.userId)
    if (!u) throw new ActionError('Pick an employee.')
    d.manualIncentives.unshift({ id: uid('mi-'), userId: u.id, month: i.month, amount: round2(i.amount), reason: i.reason.trim(), addedBy: me.id, addedAt: nowIso() })
    log(d, me.id, 'INCENTIVE_ADD', `${u.name} · ${monthLabel(i.month)} · ₹${round2(i.amount)}`)
  })
}
export function setManualIncentivePaid(me: User, id: string, paid: boolean) {
  need('incentives.manage', me)
  mutate((d) => {
    const m = d.manualIncentives.find((x) => x.id === id)
    if (!m) throw new ActionError('Incentive not found.')
    m.paidAt = paid ? nowIso() : undefined
    log(d, me.id, paid ? 'INCENTIVE_PAID' : 'INCENTIVE_UNPAID', `${d.users.find((u) => u.id === m.userId)?.name} · ₹${m.amount}`)
  })
}
export function removeManualIncentive(me: User, id: string) {
  need('incentives.manage', me)
  mutate((d) => {
    const m = d.manualIncentives.find((x) => x.id === id)
    if (!m) throw new ActionError('Incentive not found.')
    if (m.paidAt) throw new ActionError('A paid incentive cannot be removed. Mark it unpaid first.')
    d.manualIncentives = d.manualIncentives.filter((x) => x.id !== id)
    log(d, me.id, 'INCENTIVE_REMOVE', `${d.users.find((u) => u.id === m.userId)?.name} · ₹${m.amount}`)
  })
}

/** PF % and the salary structure are HR's decision only (not Super Admin, not payroll access alone). */
export const canEditPf = (u: User) => rolesOf(u).includes('hr')

export function savePfSettings(me: User, s: PfSettings) {
  if (!canEditPf(me)) throw new ActionError('Only HR can change PF and salary-structure settings.')
  for (const p of [s.employeePct, s.employerPct, s.epsPct]) if (!(p >= 0 && p <= 20)) throw new ActionError('PF percentages must be between 0 and 20.')
  if (!(s.basicPct > 0 && s.basicPct <= 100)) throw new ActionError('Basic must be between 1% and 100% of salary.')
  if (!(s.hraPct >= 0) || s.basicPct * (1 + s.hraPct / 100) > 100) throw new ActionError('Basic + HRA cannot be more than the salary.')
  if (s.epsPct > s.employerPct) throw new ActionError('EPS cannot be more than the employer share.')
  if (!(s.wageCeiling > 0)) throw new ActionError('Upper limit must be more than 0.')
  if (s.floorEnabled && !((s.wageFloor ?? 0) > 0)) throw new ActionError('Lower limit must be more than 0.')
  if (s.floorEnabled && s.ceilingEnabled && (s.wageFloor ?? 0) > s.wageCeiling) throw new ActionError('Lower limit cannot be more than the upper limit.')
  mutate((d) => {
    d.pfSettings = { ...s }
    log(d, me.id, 'PF_SETTINGS', `Basic ${s.basicPct}% · HRA ${s.hraPct}% of basic · PF EE ${s.employeePct}% / ER ${s.employerPct}%${s.floorEnabled ? ` · lower limit ₹${s.wageFloor}` : ''}${s.ceilingEnabled ? ` · upper limit ₹${s.wageCeiling}` : ''}`)
  })
}

export function updatePfAccount(me: User, userId: string, patch: Partial<Omit<PfAccount, 'userId'>>) {
  need('payroll.manage', me)
  if (patch.uan !== undefined && patch.uan && !/^\d{12}$/.test(patch.uan)) throw new ActionError('UAN must be 12 digits.')
  mutate((d) => {
    const a = d.pfAccounts.find((x) => x.userId === userId)
    if (a) Object.assign(a, patch)
    else d.pfAccounts.push({ userId, uan: patch.uan ?? '', enrolled: patch.enrolled ?? true })
  })
}

export function saveIncentiveRules(me: User, r: Omit<IncentiveRules, 'version' | 'updatedAt' | 'updatedBy'>) {
  need('incentives.manage', me)
  const nums = [r.eligibilityMultiple, r.dailyThreshold, r.dailyPct, r.weeklyThreshold, r.weeklyPct, r.monthlyMultiple]
  if (nums.some((n) => !(Number.isFinite(n) && n >= 0))) throw new ActionError('All values must be 0 or more.')
  if (!r.slabs.length || r.slabs.at(-1)!.upTo !== null) throw new ActionError('The last slab must have no upper limit.')
  for (let i = 1; i < r.slabs.length - 1; i++) if ((r.slabs[i]!.upTo ?? 0) <= (r.slabs[i - 1]!.upTo ?? 0)) throw new ActionError('Slab limits must increase.')
  if (r.slabs.some((s) => !(s.pct >= 0 && s.pct <= 100))) throw new ActionError('Slab % must be between 0 and 100.')
  mutate((d) => {
    d.incentiveHistory.unshift(d.incentiveRules)
    d.incentiveRules = { ...r, slabs: r.slabs.map((s) => ({ ...s })), version: d.incentiveRules.version + 1, updatedAt: nowIso(), updatedBy: me.id }
    log(d, me.id, 'INCENTIVE_RULES', `Saved version ${d.incentiveRules.version}`)
  })
}
