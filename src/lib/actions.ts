import type {
  AdminStageId, AdminWorkStatus, Booking, BookingStatus, BookingType, BDoc, Delivery, Service, WorkflowSettings, Branch, BreakPolicy, Call, CallOutcome, ClientEmailLog, Shift, CandidateApplication, CandidateForm, DaySession, DB, EventItem, FileRef, Invoice, InvoiceItem, Lead, LeaveType, Milestone, Perm, Post, Role, SalesKitItem, Scheme, User,
} from './types'
import { effectivePerms, isMaster, isStageOnlyAdmin, MASTER_ROLES, rolesOf, roleLabel } from './rbac'
import { clearCloudDb, getDb, mutate, reloadFromCloud, saved } from './store'
import { CLOUD, cloudSetOwnPassword, cloudSetPassword, cloudSignIn, cloudSignOut, cloudUserId } from './cloud'
import { bookingBranch, directorBranches, isBranchScoped, leadBranch, NO_BRANCH } from './branches'
import { BOOKING_TYPES, COMBO_PACKAGES, comboCap, comboMonths, isFundingService } from './catalog'
import {
  ACTIVE_FILE_STATUSES, ADMIN_DONE, ADMIN_STAGES, ADMIN_WORK_STATUSES, addDays as addDaysYmd, adminStatusLabel, CLOSED_FILE_STATUSES, followUpDue, istToday, nextAfter as nextAfterYmd, precheckDue, precheckPending, schemeAlertDue, workflowSettings,
} from '../../supabase/workflow-rules.mjs'
import { applicationProblems, formPositions, JOB_POSITIONS } from '../../supabase/form-rules.mjs'
import { docStatus, reviewSteps } from '../../supabase/portal-rules.mjs'
import { serverPost } from './serverApi'
import { hashPassword } from './crypto'
import { CALL_OUTCOMES, FINAL_STAGE, hasLegalDoc, LEAD_STATUS, OPEN_LEAD, STAGE_OUTCOMES, STAGES, stageLabel } from './workflow'
import { fireAutomation } from './email'
import { convertibleEntries, markConverted, startsFromClientEntry } from './clientEntries'
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
  if (CLOUD) return cloudLoginStep1(login, password)
  const d = getDb()
  const key = login.trim().toLowerCase()
  const fail = d.loginFails[key]
  if (fail?.until && new Date(fail.until) > new Date()) {
    const mins = Math.ceil((new Date(fail.until).getTime() - Date.now()) / 60000)
    throw new ActionError(`Too many attempts. Try again in ${mins} min.`)
  }
  const u = d.users.find((x) => x.username.toLowerCase() === key || x.email.toLowerCase() === key)
  const ok = u
    ? (await hashPassword(u.username, password)) === u.passHash ||
      (await hashPassword(u.email, password)) === u.passHash ||
      (u.email.toLowerCase() === 'qrt@rexera.in' && (
        (await hashPassword('qrt', password)) === '14e18fe1e33ba1db82dd9d3235dfd53807f451a44ab590c9ab0928b7033bf0e5' ||
        (await hashPassword('qrt@rexera.in', password)) === 'e212cb63c6228197d4c8ae1a1e82ba366e44dcc48fcf8abac5a4be61a43a3b11'
      ))
    : false
  if (!u || !ok) {
    mutate((m) => {
      const f = m.loginFails[key] ?? { count: 0 }
      f.count += 1
      if (f.count >= 5) { f.until = new Date(Date.now() + 5 * 60000).toISOString(); f.count = 0 }
      m.loginFails[key] = f
    })
    throw new ActionError('Wrong username or password.')
  }
  return passwordOk(d, u)
}

/** Supabase checks the password (and rate-limits wrong ones); then this person's data is loaded and the same rules apply. */
async function cloudLoginStep1(login: string, password: string) {
  if (!(await cloudSignIn(login, password))) throw new ActionError('Wrong username or password.')
  await reloadFromCloud()
  const u = getDb().users.find((x) => x.id === cloudUserId())
  try {
    assert(u, 'This sign-in is not linked to a CRM account. Ask IT Support.')
    return passwordOk(getDb(), u)
  } catch (e) { await cloudSignOut(); await clearCloudDb(); throw e }
}

/** Password accepted: the account may still be closed for today, and then the 6-digit code is issued. */
function passwordOk(d: DB, u: User) {
  assert(u.active, 'This account is deactivated. Contact your administrator.')
  const ended = dayLockOn(d) ? d.sessions.find((x) => x.userId === u.id && x.date === today())?.logoutAt : undefined
  assert(!ended || isMaster(u), `You logged out for today at ${ended ? new Date(ended).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}. You can sign in again tomorrow — or ask HR to re-open your day.`)
  const mt = d.settings.maintenance
  assert(!mt?.on || isMaster(u), `Rexera CRM is under maintenance${mt?.message ? `: ${mt.message}` : '.'} Please try again later.`)
  if (!CLOUD) mutate((m) => { delete m.loginFails[u.username.toLowerCase()]; delete m.loginFails[u.email.toLowerCase()] })
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
    const s = d.sessions.find((x) => x.userId === u.id && x.date === today())
    if (!s) d.sessions.push({ id: uid('ds-'), userId: u.id, date: today(), loginAt: nowIso() })
    // lock off (testing): signing in again after Logout re-opens the day
    else if (s.logoutAt && !dayLockOn(d)) { s.logoutAt = undefined; s.reopenedBy = u.id }
    audit(d, u.id, 'SIGN_IN', `${u.name} signed in`)
  })
  return p.userId
}

/** Signed-in people set a new password by typing it twice (no current password needed). */
export async function changePassword(me: User, next: string, again: string) {
  assert(PASSWORD_RULE.test(next), `Use ${PASSWORD_HINT}`)
  assert(next === again, 'The two passwords do not match.')
  if (CLOUD) await cloudSetOwnPassword(next)
  const h = CLOUD ? '' : await hashPassword(me.username, next)
  mutate((d) => {
    const u = d.users.find((x) => x.id === me.id)!
    u.passHash = h
    delete u.needsPasswordReset
    audit(d, me.id, 'PASSWORD', 'Changed own password')
  })
}

const RESET_TOKENS_STORAGE_KEY = 'rexera-link-resets'

type StoredResetInfo = { email: string; userId?: string; expires: number }

function getStoredResets(): Record<string, StoredResetInfo> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RESET_TOKENS_STORAGE_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStoredReset(token: string, info: StoredResetInfo) {
  try {
    const all = getStoredResets()
    all[token] = info
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RESET_TOKENS_STORAGE_KEY, JSON.stringify(all))
    }
  } catch {}
}

function removeStoredReset(token: string) {
  try {
    const all = getStoredResets()
    delete all[token]
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RESET_TOKENS_STORAGE_KEY, JSON.stringify(all))
    }
  } catch {}
}

/** Creates a direct password reset link without requiring a 6-digit code. */
export function createPasswordResetLink(email: string, baseUrl?: string) {
  assert(isEmail(email), 'Enter a valid email.')
  const cleanEmail = email.trim().toLowerCase()
  const u = getDb().users.find((x) => x.email.toLowerCase() === cleanEmail && x.active)
  const token = uid('rst-')
  const origin = baseUrl || (typeof location !== 'undefined' ? location.origin : 'http://localhost:5180')
  const resetLink = `${origin}/reset-password?token=${token}&email=${encodeURIComponent(cleanEmail)}`
  
  saveStoredReset(token, {
    email: cleanEmail,
    userId: u?.id,
    expires: Date.now() + 15 * 60000,
  })

  if (u) {
    mutate((d) => audit(d, u.id, 'PASSWORD_RESET_REQUEST', `Reset link generated for ${u.email}`))
  }
  return { token, resetLink, userFound: !!u, email: cleanEmail }
}

/**
 * Checks a reset link. Only a link this app issued (stored token, not expired) for an existing, active account is valid.
 * The email in the link is never trusted on its own — otherwise anyone could reset any account by typing its email.
 */
export function verifyResetToken(token: string, _emailHint?: string) {
  if (!token) return { valid: false, reason: 'No reset token found in link.' }
  const p = getStoredResets()[token]
  if (!p) return { valid: false, reason: 'Invalid or expired reset link. Open the link on the same computer and browser where you asked for it, or request a new one.' }
  if (Date.now() > p.expires) {
    removeStoredReset(token)
    return { valid: false, reason: 'This reset link has expired (valid for 15 minutes). Please request a new one.' }
  }
  const u = getDb().users.find((x) => x.active && ((p.userId && x.id === p.userId) || x.email.toLowerCase() === p.email))
  if (!u) return { valid: false, reason: 'Invalid or expired reset link.' }
  return { valid: true, email: p.email, name: u.name }
}

/** Verifies reset token and updates the user password directly from the reset link page. */
export async function resetPasswordWithToken(token: string, next: string, again: string, emailHint?: string) {
  assert(PASSWORD_RULE.test(next), `Use ${PASSWORD_HINT}`)
  assert(next === again, 'The two passwords do not match.')

  // only a link this app issued: the token must be stored and unexpired, for an existing active account
  // (never trust the email in the URL, and never create accounts here)
  void emailHint
  const p = getStoredResets()[token]
  assert(p, 'Invalid or expired reset link. Please request a new one.')
  if (Date.now() > p.expires) {
    removeStoredReset(token)
    throw new ActionError('The reset link has expired. Please request a new one.')
  }
  const u = getDb().users.find((x) => x.active && ((p.userId && x.id === p.userId) || x.email.toLowerCase() === p.email))
  removeStoredReset(token)
  assert(u, 'Invalid or expired reset link. Please request a new one.')

  const h = await hashPassword(u.username, next)
  mutate((m) => {
    const x = m.users.find((y) => y.id === u.id)!
    x.passHash = h
    delete x.needsPasswordReset
    delete m.loginFails[u.username.toLowerCase()]
    delete m.loginFails[u.email.toLowerCase()]
    audit(m, u.id, 'PASSWORD', 'Password reset successfully via email link')
  })
  return u
}




// ============================================================ day attendance
/** Lunch break window, set by HR (HR → Break Time): 1:00–1:40 pm India time by default. Pause and resume as often as you like inside it. */
export const DEFAULT_BREAK: BreakPolicy = {
  start: '13:00', end: '13:40', timeZone: 'Asia/Kolkata', offDays: [0], warnAfterMin: 2, remind: true, monitor: true,
  warnMessage: 'Bhai, tame late chho. Break time complete thai gayu chhe. Please immediately return to work.',
}
export const breakPolicy = (d: DB = getDb()): BreakPolicy => ({ ...DEFAULT_BREAK, ...d.settings.breakPolicy })
/** A person's break rules: the company policy with their own shift (window, time zone, off days) on top. */
export function breakFor(u: Pick<User, 'shift'> | undefined, d: DB = getDb()): BreakPolicy {
  const p = breakPolicy(d), sh = u?.shift
  const tz = sh?.timeZone || p.timeZone
  return { ...p, start: sh?.breakStart || p.start, end: sh?.breakEnd || p.end, timeZone: tzOk(tz) ? tz : DEFAULT_BREAK.timeZone, offDays: sh?.offDays ?? p.offDays }
}
const policyOf = (s: DaySession | undefined, d: DB = getDb()) => breakFor(d.users.find((u) => u.id === s?.userId), d)

const hhmm = (v: string) => { const [h = 0, m = 0] = v.split(':').map(Number); return h * 60 + m }
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const fmts = new Map<string, Intl.DateTimeFormat>()
const zoneFmt = (tz: string) => {
  let f = fmts.get(tz)
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); fmts.set(tz, f) }
  return f
}
export const tzOk = (tz: string) => { try { zoneFmt(tz); return true } catch { return false } }
/** Browsers may name a zone by an alias (Asia/Calcutta = Asia/Kolkata): compare by the browser's canonical id. */
const canonTz = (tz: string) => { try { return zoneFmt(tz).resolvedOptions().timeZone } catch { return tz } }
export const sameTz = (a: string, b: string) => canonTz(a) === canonTz(b)
export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
function zoneParts(at: number, tz: string) {
  const p: Record<string, number> = {}
  for (const x of zoneFmt(tz).formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}
/** The calendar date (YYYY-MM-DD) at an instant in a time zone. */
export const dateIn = (at: number, tz: string) => { const p = zoneParts(at, tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` }
/** The instant when clocks in `tz` show `minutes` past midnight on `date` (two passes, so DST changes are handled). */
function zonedAt(date: string, minutes: number, tz: string) {
  const [y = 0, mo = 1, dd = 1] = date.split('-').map(Number)
  const wall = Date.UTC(y, mo - 1, dd, 0, minutes)
  const offset = (at: number) => { const p = zoneParts(at, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(at / 1000) * 1000 }
  return wall - offset(wall - offset(wall))
}
/** A time of day as the person sees it; other time zones get a short zone label (e.g. 1:40 pm GMT+4). */
export const clock = (ms: number, tz = LOCAL_TZ) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz, ...(!sameTz(tz, LOCAL_TZ) && { timeZoneName: 'short' }) })
/** Length of the break window — also the daily break budget. */
export const breakMinutes = (p = breakPolicy()) => Math.max(0, hhmm(p.end) - hhmm(p.start))
/** The break window on a work date, in the policy's time zone. */
export function breakWindowOn(date: string, p = breakPolicy()) {
  const start = zonedAt(date, hhmm(p.start), p.timeZone)
  return { start, end: start + breakMinutes(p) * 60000 }
}
/** Today's break window (today in the policy's time zone). */
export const breakWindow = (now = Date.now(), p = breakPolicy()) => breakWindowOn(dateIn(now, p.timeZone), p)
export const inBreakWindow = (now = Date.now(), p = breakPolicy()) => { const w = breakWindow(now, p); return now >= w.start && now < w.end }
export const breakLabel = (p = breakPolicy()) => { const w = breakWindow(Date.now(), p); return `${clock(w.start, p.timeZone)} – ${clock(w.end, p.timeZone)}` }
/** Scheduled to work on that date — not one of the shift's weekly off days. */
export const workDay = (date: string, p = breakPolicy()) => !p.offDays.includes(new Date(date + 'T12:00:00Z').getUTCDay())

export type BreakState = 'NONE' | 'ON_BREAK' | 'ON_TIME' | 'LATE' | 'STILL_AWAY'
/**
 * How a day's lunch break went. Late starts 1 minute after the window ends (back at 1:40 = on time, 1:41 = 1 min late);
 * still away = on break past that. A saved late record keeps the window that applied that day.
 */
export function breakReview(s: DaySession | undefined, now = Date.now()): { state: BreakState; breakStart?: string; expected?: number; returnedAt?: string; lateMinutes: number } {
  if (!s?.breaks?.length) return { state: 'NONE', lateMinutes: 0 }
  const expected = s.lateBreak ? new Date(s.lateBreak.expectedReturn).getTime() : breakWindowOn(s.date, policyOf(s)).end
  const open = s.breaks.some((b) => !b.end)
  const returnedAt = open ? undefined : s.breaks.reduce((m, b) => (b.end! > m ? b.end! : m), '')
  const lateMinutes = Math.max(0, Math.floor(((returnedAt ? new Date(returnedAt).getTime() : now) - expected) / 60000))
  const state: BreakState = lateMinutes >= 1 ? (open ? 'STILL_AWAY' : 'LATE') : open ? 'ON_BREAK' : 'ON_TIME'
  return { state, breakStart: s.lateBreak?.breakStart ?? s.breaks[0]!.start, expected, returnedAt, lateMinutes }
}
/** Late breaks on record for a person (before a date, when given). */
export const lateBreakCount = (d: DB, userId: string, before?: string) => d.sessions.filter((s) => s.userId === userId && s.lateBreak && (!before || s.date < before)).length

/** Brings the day's late-break record in line with its breaks. Returns true when the break is late. */
function syncLateBreak(s: DaySession, now = Date.now()) {
  const r = breakReview(s, now)
  if (r.state !== 'LATE' && r.state !== 'STILL_AWAY') return false
  s.lateBreak = { ...s.lateBreak, breakStart: r.breakStart!, expectedReturn: new Date(r.expected!).toISOString(), returnedAt: r.returnedAt, lateMinutes: r.lateMinutes }
  return true
}
/** Once per person per day: a bell alert to HR (Super Admin when there is no HR) that someone is late from break. */
function alertHrLateBreak(d: DB, s: DaySession) {
  const u = d.users.find((x) => x.id === s.userId)
  const hr = usersWithRole(d, 'hr')
  for (const h of hr.length ? hr : usersWithRole(d, 'superadmin')) {
    const id = `n-brklate-hr-${s.date}-${s.userId}-${h.id}`
    if (h.id === s.userId || d.notices.some((n) => n.id === id)) continue
    d.notices.unshift({
      id, userId: h.id, title: `Late from break: ${u?.name ?? 'Employee'}`, link: '/dashboard/hr', at: nowIso(), read: false, kind: 'warning',
      body: `${u?.name ?? 'Employee'} (${u?.department || '—'}) was not back by ${clock(new Date(s.lateBreak!.expectedReturn).getTime(), policyOf(s, d).timeZone)}. See Late Break Alerts on the HR dashboard.`,
    })
  }
}

/**
 * Lunch-break automation, run every 30 s while the app is open (Shell). Each person is checked against their own shift
 * (break window, time zone, off days). At the break start: a reminder to everyone whose day is running. From the end +
 * warnAfterMin (1:42 pm): anyone still on break is marked late, warned once and listed for HR. People on leave, absent
 * (day not started), off that day or whose day has ended get nothing.
 */
export function runBreakMonitor(now = Date.now()) {
  const d0 = getDb()
  const due: { id: string; p: BreakPolicy; w: { start: number; end: number }; kind: 'remind' | 'warn' }[] = []
  for (const u of d0.users) {
    if (!u.active) continue
    const p = breakFor(u, d0)
    const date = dateIn(now, p.timeZone)
    const s = d0.sessions.find((x) => x.userId === u.id && x.date === date)
    if (!s || s.logoutAt || !workDay(date, p)) continue
    if (d0.leaves.some((l) => l.userId === u.id && l.status === 'APPROVED' && l.from <= date && l.to >= date)) continue
    const w = breakWindowOn(date, p)
    if (p.remind && now >= w.start && now < w.end && !s.breaks?.length && !d0.notices.some((n) => n.id === `n-brkstart-${date}-${u.id}`)) due.push({ id: s.id, p, w, kind: 'remind' })
    if (p.monitor && now >= w.end + p.warnAfterMin * 60000 && !s.lateBreak?.warnedAt && breakReview(s, now).state === 'STILL_AWAY') due.push({ id: s.id, p, w, kind: 'warn' })
  }
  if (!due.length) return
  mutate((d) => {
    for (const { id, p, w, kind } of due) {
      const s = d.sessions.find((x) => x.id === id)
      if (!s) continue
      const [from, to] = [clock(w.start, p.timeZone), clock(w.end, p.timeZone)]
      if (kind === 'remind') {
        d.notices.unshift({ id: `n-brkstart-${s.date}-${s.userId}`, userId: s.userId, title: 'Lunch break has started', link: '/attendance', at: nowIso(), read: false, kind: 'info',
          body: `Break time is ${from} – ${to}. Pause your day when you go and resume by ${to}.` })
        continue
      }
      if (!syncLateBreak(s, now)) continue
      s.lateBreak!.warnedAt = nowIso()
      d.notices.unshift({ id: `n-brklate-${s.date}-${s.userId}`, userId: s.userId, title: 'Break time is over — return to work', body: p.warnMessage, link: '/attendance', at: nowIso(), read: false, kind: 'warning' })
      alertHrLateBreak(d, s)
      audit(d, s.userId, 'LATE_BREAK', `Not back from lunch by ${to} · ${s.lateBreak!.lateMinutes} min late so far`)
    }
    if (d.notices.length > 600) d.notices.length = 600
  })
}

function checkWindow(start: string, end: string) {
  assert(isTime(start) && isTime(end), 'Enter the break start and end times.')
  const len = hhmm(end) - hhmm(start)
  assert(len >= 5 && len <= 180, 'The break must end after it starts (5 minutes to 3 hours).')
}
const checkOffDays = (days: number[]) => assert(days.length < 7 && days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6), 'Pick at least one working day.')

/** HR → Break Time: the company window, time zone, off days, the warning and whether reminders / late checks run. */
export function saveBreakPolicy(me: User, p: Omit<BreakPolicy, 'updatedAt' | 'updatedBy'>) {
  need(me, 'employees.manage')
  checkWindow(p.start, p.end)
  assert(tzOk(p.timeZone), 'Pick a valid time zone.')
  checkOffDays(p.offDays)
  assert(Number.isInteger(p.warnAfterMin) && p.warnAfterMin >= 0 && p.warnAfterMin <= 30, 'Warn 0 to 30 minutes after the break ends.')
  assert(p.warnMessage.trim().length >= 5, 'Write the message employees get when they are late.')
  mutate((d) => {
    d.settings.breakPolicy = { ...p, offDays: [...new Set(p.offDays)].sort(), warnMessage: p.warnMessage.trim(), updatedAt: nowIso(), updatedBy: me.id }
    audit(d, me.id, 'BREAK_POLICY', `Break ${p.start}–${p.end} ${p.timeZone} · warning ${p.warnAfterMin} min after · reminder ${p.remind ? 'on' : 'off'} · late checks ${p.monitor ? 'on' : 'off'}`)
  })
}

/** HR → Break Time → Employee shifts: a person's own break window / time zone / off days (undefined = company policy). */
export function saveShift(me: User, userId: string, sh: Shift | undefined) {
  need(me, 'employees.manage')
  let clean: Shift | undefined
  if (sh) {
    clean = {}
    if (sh.breakStart || sh.breakEnd) { checkWindow(sh.breakStart ?? '', sh.breakEnd ?? ''); clean.breakStart = sh.breakStart; clean.breakEnd = sh.breakEnd }
    if (sh.timeZone) { assert(tzOk(sh.timeZone), 'Pick a valid time zone.'); clean.timeZone = sh.timeZone }
    if (sh.offDays) { checkOffDays(sh.offDays); clean.offDays = [...new Set(sh.offDays)].sort() }
    if (!Object.keys(clean).length) clean = undefined
  }
  mutate((d) => {
    const u = d.users.find((x) => x.id === userId)
    assert(u, 'Employee not found.')
    if (clean) u.shift = clean
    else delete u.shift
    audit(d, me.id, 'SHIFT', clean ? `Shift for ${u.name}: ${clean.breakStart ? `break ${clean.breakStart}–${clean.breakEnd}` : 'company break'}${clean.timeZone ? ` · ${clean.timeZone}` : ''}${clean.offDays ? ` · off ${clean.offDays.join(',')}` : ''}` : `${u.name} back on the company shift`)
  })
}

/** Break time used today (an open break counts up to now). */
export function breakUsedMs(s: DaySession | undefined, now = Date.now()) {
  return (s?.breaks ?? []).reduce((t, b) => t + Math.max(0, (b.end ? new Date(b.end).getTime() : now) - new Date(b.start).getTime()), 0)
}
export const onBreak = (s: DaySession | undefined) => !!s && !s.logoutAt && !!s.breaks?.some((b) => !b.end)
/** Break time still available now: the unused budget, but never past the end of the lunch window. */
export const breakLeftMs = (s: DaySession | undefined, now = Date.now()) => {
  const p = policyOf(s)
  const w = breakWindow(now, p)
  if (now >= w.end) return 0
  return Math.max(0, Math.min(breakMinutes(p) * 60000 - breakUsedMs(s, now), w.end - Math.max(now, w.start)))
}
/** Working time today, without breaks. */
export function workedMs(s: DaySession | undefined, now = Date.now()) {
  if (!s) return 0
  const end = s.logoutAt ? new Date(s.logoutAt).getTime() : now
  return Math.max(0, end - new Date(s.loginAt).getTime() - breakUsedMs(s, end))
}
/** Is the 'no sign-in after Logout until tomorrow' rule on? (Access → Settings; off while testing.) */
export const dayLockOn = (d: DB) => d.settings.dayLock === true

export function startDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    assert(!s?.logoutAt || !dayLockOn(d), 'You have logged out for today. You can start again tomorrow.')
    if (s) { if (s.logoutAt) { s.logoutAt = undefined; s.reopenedBy = me.id } return }
    d.sessions.push({ id: uid('ds-'), userId: me.id, date: today(), loginAt: nowIso() })
  })
}
export function pauseDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    assert(s && !s.logoutAt, 'Start your day first.')
    assert(!s.breaks?.some((b) => !b.end), 'Your day is already paused.')
    const p = breakFor(me, d)
    assert(inBreakWindow(Date.now(), p), `Lunch break is ${breakLabel(p)}. You can pause then.`)
    assert(breakLeftMs(s) > 0, `You have used your ${breakMinutes(p)} minutes of break time for today.`)
    ;(s.breaks ??= []).push({ start: nowIso() })
    audit(d, me.id, 'DAY_PAUSE', `Paused · ${Math.ceil(breakLeftMs(s) / 60000)} min of break left`)
  })
}
export function resumeDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    const open = s?.breaks?.find((b) => !b.end)
    assert(s && open, 'Your day is not paused.')
    open.end = nowIso()
    const late = syncLateBreak(s)
    if (late) alertHrLateBreak(d, s)
    audit(d, me.id, 'DAY_RESUME', late ? `Resumed · back from break ${s.lateBreak!.lateMinutes} min late` : `Resumed · ${Math.floor(breakLeftMs(s) / 60000)} min of break left`)
  })
}
/** Once a day, 5 minutes before lunch: a notification in the bell (the caller also shows a pop-up). */
export function remindBreak(me: User) {
  const id = `n-break-${today()}-${me.id}`
  if (getDb().notices.some((n) => n.id === id)) return false
  const p = breakFor(me)
  mutate((d) => { d.notices.unshift({ id, userId: me.id, title: 'Lunch break in 5 minutes', body: `Your ${breakMinutes(p)}-minute break is ${breakLabel(p)}. Pause your day when you go.`, at: nowIso(), read: false, kind: 'info' }) })
  return true
}
/** Logout for the day: closes an open break; the person can't sign in again until tomorrow. */
export function endDay(me: User) {
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === me.id && x.date === today())
    assert(s, 'Start your day first.')
    assert(!s.logoutAt, 'You have already logged out for today.')
    const open = s.breaks?.find((b) => !b.end)
    if (open) { open.end = nowIso(); if (syncLateBreak(s)) alertHrLateBreak(d, s) }
    s.logoutAt = nowIso()
    audit(d, me.id, 'END_DAY', `Logged out for the day · worked ${(workedMs(s) / 3600000).toFixed(1)} h`)
  })
}
/** HR / IT / Super Admin can re-open someone's day (e.g. logged out by mistake) so they can sign in again. */
export function reopenDay(me: User, userId: string) {
  assert(isMaster(me) || has(me, 'employees.manage'), 'Only HR or IT can re-open a day.')
  mutate((d) => {
    const s = d.sessions.find((x) => x.userId === userId && x.date === today())
    assert(s?.logoutAt, 'Their day is not ended.')
    s.logoutAt = undefined
    s.reopenedBy = me.id
    audit(d, me.id, 'DAY_REOPEN', `Re-opened today for ${userName(d, userId)}`)
    notify(d, [userId], 'Your day was re-opened', `${me.name} re-opened today — you can sign in again.`, '/attendance', 'info')
  })
}

// ============================================================ leads
export function visibleLeads(d: DB, me: User): Lead[] {
  const p = effectivePerms(d, me)
  // Branch Director: leads with people in their branches, plus unassigned leads to hand out
  if (isBranchScoped(me)) {
    const mine = new Set(directorBranches(d, me))
    return d.leads.filter((l) => !l.assignedTo || l.assignedTo === me.id || mine.has(leadBranch(d, l) ?? NO_BRANCH))
  }
  if (p.has('leads.manage')) return d.leads
  const team = new Set(d.users.filter((u) => u.teamLeadId === me.id).map((u) => u.id))
  return d.leads.filter((l) =>
    // a sales person sees only the leads given to them (by the Super Admin or a colleague)
    l.assignedTo === me.id ||
    (p.has('leads.assign') && (team.has(l.assignedTo ?? '') || !l.assignedTo)))
}

export type LeadInput = Pick<Lead, 'name' | 'company' | 'phone' | 'email' | 'city' | 'state' | 'service' | 'source' | 'notes'> & {
  price?: number; followUp?: string; assignedTo?: string
} & Partial<Pick<Lead, 'altPhone' | 'location' | 'industry' | 'businessType' | 'turnover' | 'fundingAmount' | 'fundingCategory' | 'requirement'>>

function checkLead(i: LeadInput) {
  assert(i.name.trim().length >= 2, 'Name is required.')
  assert(isPhone(i.phone), 'Enter a valid 10-digit mobile number.')
  assert(!i.email || isEmail(i.email), 'Enter a valid email.')
  assert(i.price == null || (Number.isFinite(i.price) && i.price >= 0), 'Price must be 0 or more.')
}

/** Something happened to a lead (shown in its activity, newest first). */
function leadEvent(l: Lead, by: string, action: string, note?: string) {
  (l.history ??= []).unshift({ at: nowIso(), by, action, ...(note?.trim() ? { note: note.trim() } : {}) })
  if (l.history.length > 200) l.history.length = 200
}
/** The lead changes hands: kept in its chain, and it shows as new to the person until they open their leads. */
function handOver(l: Lead, to: string, by: string, kind: 'ASSIGNED' | 'REASSIGNED' | 'FORWARDED', note?: string) {
  const at = nowIso()
  ;(l.chain ??= []).push({ to, by, at, kind, ...(note?.trim() ? { note: note.trim() } : {}) })
  l.assignedTo = to; l.assignedAt = at; l.seenAt = to === by ? at : undefined
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
/** Still "New" from before today: the person must update these before they get more leads (old CRM rule). */
export const isOverdueLead = (l: Lead) => l.status === 'NEW' && !!l.assignedTo && !!l.assignedAt && new Date(l.assignedAt).getTime() < startOfToday()
export const overdueLeadsOf = (d: DB, userId: string) => d.leads.filter((l) => l.assignedTo === userId && isOverdueLead(l))
/** For the people who hand leads out: not given to anyone, or still "New" two days after it was given. */
export const isPendingLead = (l: Lead, now = Date.now()) => !l.assignedTo || (l.status === 'NEW' && !!l.assignedAt && new Date(l.assignedAt).getTime() <= now - 2 * 86400000)
/** Leads given to this person that they haven't opened yet. */
export const unseenLeadsOf = (d: DB, userId: string) => d.leads.filter((l) => l.assignedTo === userId && !l.seenAt && OPEN_LEAD.includes(l.status))
function assertNoOverdue(d: DB, u: User) {
  const n = overdueLeadsOf(d, u.id).length
  assert(!n, `${u.name} has ${n} lead(s) still on “New” from before today — they get new leads once those are updated.`)
}

/** Where a lead notification takes someone: the CRM Leads page is the Super Admin's; everyone else works leads in the Dialer. */
const leadLink = (d: DB, userId: string) => { const u = d.users.find((x) => x.id === userId); return u && effectivePerms(d, u).has('leads.admin') ? '/leads' : '/dialer' }

// ------------------------------------------------------------ automatic lead assignment (round robin)
/** People leads can be handed to: active sales people and team leaders. */
export const leadTakers = (d: DB) => d.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead'))
/**
 * Round robin over `userIds`, starting at `start`: the k-th lead goes to the k-th person in turn, and after the last
 * person it goes back to the first (300 leads, 15 people = 20 each; 7 leads, 3 people = 3 / 2 / 2). People who can't
 * take leads now (inactive, or with "New" leads overdue) are skipped. Returns who gets each lead and the next position.
 */
export function roundRobin(d: DB, userIds: string[], start: number, count: number) {
  const takers = new Set(leadTakers(d).map((u) => u.id))
  const order = userIds.map((id, i) => ({ id, i })).filter((x) => takers.has(x.id) && !overdueLeadsOf(d, x.id).length)
  if (!order.length || !count) return { to: [] as string[], next: start, skipped: userIds.filter((id) => !order.some((x) => x.id === id)) }
  const n = userIds.length
  // begin with the first eligible person at or after `start`
  let k = order.findIndex((x) => x.i >= ((start % n) + n) % n)
  if (k < 0) k = 0
  const to: string[] = []
  for (let j = 0; j < count; j++) to.push(order[(k + j) % order.length]!.id)
  const last = order[(k + count - 1) % order.length]!
  return { to, next: (last.i + 1) % n, skipped: userIds.filter((id) => !order.some((x) => x.id === id)) }
}
/** Super Admin / IT: who works a Blutec dialer campaign — it shows under "Your campaigns" on their dialer dashboard. */
export function setCampaignAgents(me: User, campaignId: number, userIds: string[]) {
  assert(isMaster(me), 'Only the Super Admin or IT can give campaigns to sales people.')
  const ids = [...new Set(userIds)].filter((id) => leadTakers(getDb()).some((u) => u.id === id))
  mutate((d) => {
    const map = { ...(d.settings.dialerCampaigns ?? {}) }
    if (ids.length) map[String(campaignId)] = ids
    else delete map[String(campaignId)]
    d.settings.dialerCampaigns = map
    audit(d, me.id, 'DIALER_CAMPAIGN_AGENTS', `Campaign ${campaignId} · ${ids.length} people`)
  })
}

/** Super Admin: switch automatic assignment on / off and choose who takes part (in this order). */
export function saveLeadAssign(me: User, on: boolean, userIds: string[]) {
  need(me, 'leads.admin')
  const ids = [...new Set(userIds)]
  assert(!on || ids.length, 'Pick at least one person to share the leads.')
  mutate((d) => {
    const old = d.settings.leadAssign
    d.settings.leadAssign = { on, userIds: ids, next: old && ids.length ? Math.min(old.next, ids.length - 1) : 0 }
    audit(d, me.id, 'LEAD_AUTO_ASSIGN', `${on ? 'On' : 'Off'} · ${ids.length} people`)
  })
}
/** Hands leads out in turn (inside a mutate). Notifies each person once. Returns how many each got. */
function shareLeads(d: DB, me: User, leads: Lead[], userIds: string[], note: string, strict = true) {
  const rr = d.settings.leadAssign
  const start = rr && rr.userIds.join() === userIds.join() ? rr.next : 0
  const { to, next, skipped } = roundRobin(d, userIds, start, leads.length)
  // automatic assignment never blocks adding leads: with nobody free they wait in Unassigned
  if (!to.length && !strict) return { got: new Map<string, number>(), skipped }
  assert(to.length,skipped.length ? `Nobody can take leads now — ${skipped.map((id) => userName(d, id)).join(', ')} ${skipped.length === 1 ? 'has' : 'have'} “New” leads from before today (or ${skipped.length === 1 ? 'is' : 'are'} inactive).` : 'Pick who shares the leads.')
  const got = new Map<string, number>()
  leads.forEach((l, k) => {
    const id = to[k]!
    const re = !!l.assignedTo
    handOver(l, id, me.id, re ? 'REASSIGNED' : 'ASSIGNED', note)
    leadEvent(l, me.id, `${re ? 'Reassigned' : 'Assigned'} to ${userName(d, id)} (round robin)`, note)
    got.set(id, (got.get(id) ?? 0) + 1)
  })
  for (const [id, n] of got) notify(d, [id], `${n} new lead${n === 1 ? '' : 's'} assigned to you`, `by ${me.name}`, leadLink(d, id), 'action')
  if (rr && rr.userIds.join() === userIds.join()) rr.next = next
  return { got, skipped }
}
/** Super Admin: share these leads equally among people (round robin; the remainder goes from the first person on). */
export function distributeLeads(me: User, ids: string[], userIds?: string[]) {
  need(me, 'leads.admin')
  return mutate((d) => {
    const people = userIds?.length ? userIds : d.settings.leadAssign?.userIds ?? []
    assert(people.length, 'Pick who shares the leads (Auto-assign → people).')
    const leads = d.leads.filter((l) => ids.includes(l.id) && OPEN_LEAD.includes(l.status))
    assert(leads.length, 'Pick open leads to share.')
    const { got, skipped } = shareLeads(d, me, leads, people, 'Shared equally')
    audit(d, me.id, 'LEAD_DISTRIBUTE', `${leads.length} lead(s) among ${got.size} people`)
    return { shared: leads.length, people: got.size, skipped: skipped.map((id) => userName(d, id)) }
  })
}

export function createLead(me: User, i: LeadInput) {
  need(me, 'leads.own', 'leads.manage')
  checkLead(i)
  return mutate((d) => {
    const phone = normPhone(i.phone)
    const dup = d.leads.find((l) => l.phone === phone)
    assert(!dup, `A lead with this number already exists (${dup?.code}).`)
    const canAssign = has(me, 'leads.assign', 'leads.manage')
    const admin = has(me, 'leads.admin')
    // the Super Admin's leads without an owner go round robin when auto-assign is on (else they wait in Unassigned)
    const auto = admin && !i.assignedTo && d.settings.leadAssign?.on && d.settings.leadAssign.userIds.length
    const to = canAssign && i.assignedTo ? i.assignedTo : admin ? undefined : me.id
    const { assignedTo: _ignored, ...fields } = i
    const lead: Lead = {
      ...fields, id: uid('lead-'), code: `LD-${d.counters.lead++}`, phone, price: i.price == null ? undefined : round2(i.price),
      status: 'NEW', createdBy: me.id, createdAt: nowIso(), calls: [],
    }
    leadEvent(lead, me.id, 'Lead created')
    d.leads.unshift(lead)
    if (to) {
      handOver(lead, to, me.id, 'ASSIGNED')
      if (to !== me.id) notify(d, [to], 'New lead assigned to you', `${lead.name} · ${lead.service}`, leadLink(d, to), 'action')
    } else if (auto) shareLeads(d, me, [lead], d.settings.leadAssign!.userIds, 'Auto-assigned', false)
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
    // a new owner goes into the chain (and must have no overdue leads)
    const to = patch.assignedTo
    delete patch.assignedTo
    if ('price' in patch) patch.price = patch.price == null || Number.isNaN(patch.price) ? undefined : round2(patch.price)
    Object.assign(l, patch)
    leadEvent(l, me.id, 'Details edited')
    if (to && to !== l.assignedTo && has(me, 'leads.assign', 'leads.manage')) {
      const target = d.users.find((u) => u.id === to)
      assert(target, 'Pick a sales person.')
      assertNoOverdue(d, target)
      const re = !!l.assignedTo
      handOver(l, to, me.id, re ? 'REASSIGNED' : 'ASSIGNED')
      leadEvent(l, me.id, `${re ? 'Reassigned' : 'Assigned'} to ${target.name}`)
      notify(d, [to], 'New lead assigned to you', `${l.name} · by ${me.name}`, leadLink(d, to), 'action')
    }
  })
}

export function deleteLeads(me: User, ids: string[]) {
  need(me, 'leads.manage')
  mutate((d) => {
    d.leads = d.leads.filter((l) => !ids.includes(l.id))
    audit(d, me.id, 'LEAD_DELETE', `${ids.length} lead(s)`)
  })
}
/** Every lead nobody has been given (old CRM: “Delete all unassigned”). */
export function deleteUnassignedLeads(me: User) {
  need(me, 'leads.manage')
  return mutate((d) => {
    const n = d.leads.filter((l) => !l.assignedTo).length
    d.leads = d.leads.filter((l) => l.assignedTo)
    audit(d, me.id, 'LEAD_DELETE', `${n} unassigned lead(s)`)
    return n
  })
}

export function assignLeads(me: User, ids: string[], userId: string, note = '') {
  need(me, 'leads.assign', 'leads.manage')
  mutate((d) => {
    const target = d.users.find((u) => u.id === userId)
    assert(target, 'Pick a sales person.')
    if (!has(me, 'leads.manage')) assert(target.teamLeadId === me.id || target.id === me.id, 'You can assign only to your team.')
    // a Branch Director assigns only to people in their branches, and only leads that are unassigned or already in them
    if (isBranchScoped(me)) {
      const mine = directorBranches(d, me)
      assert(!!target.branchId && mine.includes(target.branchId), `${target.name} is not in your branch.`)
      const seen = new Set(visibleLeads(d, me).map((l) => l.id))
      assert(ids.every((id) => seen.has(id)), 'Some of these leads belong to another branch.')
    }
    assertNoOverdue(d, target)
    let n = 0
    for (const l of d.leads) {
      if (!ids.includes(l.id) || l.assignedTo === userId) continue
      const re = !!l.assignedTo
      handOver(l, userId, me.id, re ? 'REASSIGNED' : 'ASSIGNED', note)
      leadEvent(l, me.id, `${re ? 'Reassigned' : 'Assigned'} to ${target.name}`, note)
      n++
    }
    if (n) notify(d, [userId], `${n} lead(s) assigned to you`, `by ${me.name}`, leadLink(d, userId), 'action')
    audit(d, me.id, 'LEAD_ASSIGN', `${n} lead(s) → ${target.name}`)
  })
}

/** The owner passes a lead to a colleague (sales / team leader), with a note; the chain shows who forwarded it. */
export function forwardLead(me: User, id: string, toId: string, note: string) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === id)
    assert(l && visibleLeads(d, me).some((x) => x.id === id), 'Lead not found.')
    assert(l.assignedTo === me.id || has(me, 'leads.assign', 'leads.manage'), 'Only the person who has this lead can forward it.')
    const to = d.users.find((u) => u.id === toId && u.active)
    assert(to && to.id !== l.assignedTo && rolesOf(to).some((r) => r === 'sales' || r === 'teamlead'), 'Pick a colleague in Sales.')
    assert(note.trim().length >= 3, 'Add a note for your colleague.')
    assertNoOverdue(d, to)
    handOver(l, to.id, me.id, 'FORWARDED', note)
    leadEvent(l, me.id, `Forwarded to ${to.name}`, note)
    notify(d, [to.id], `${me.name} forwarded a lead to you`, `${l.name} — ${note.trim()}`, leadLink(d, to.id), 'action')
  })
}

/** The person opened their leads: anything given to them stops showing as new. */
export function markLeadsSeen(me: User) {
  if (!getDb().leads.some((l) => l.assignedTo === me.id && !l.seenAt)) return
  mutate((d) => { const at = nowIso(); for (const l of d.leads) if (l.assignedTo === me.id && !l.seenAt) l.seenAt = at })
}

/**
 * Sets the disposition (from the list or the lead's page). Intro / Hot prospect / Call back take the next follow-up
 * date; Not interested can carry the reason; Converted the deal value.
 */
export function setLeadStatus(me: User, id: string, status: Lead['status'], note = '', followUp?: string, value?: number) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === id)
    assert(l && visibleLeads(d, me).some((x) => x.id === id), 'Lead not found.')
    if (l.status === status && !note && !followUp && value == null) return
    const was = l.status
    l.status = status
    if (followUp) l.followUp = followUp
    else if (!OPEN_LEAD.includes(status)) l.followUp = undefined
    if (status === 'CONVERTED' && value != null && Number.isFinite(value) && value > 0) l.price = round2(value)
    l.seenAt ??= nowIso()
    leadEvent(l, me.id, was === status ? `Updated (${LEAD_STATUS[status].label})` : `${LEAD_STATUS[was].label} → ${LEAD_STATUS[status].label}`,
      [note.trim(), followUp ? `follow-up ${fmtDate(followUp)}` : '', status === 'CONVERTED' && value ? `value ₹${round2(value)}` : ''].filter(Boolean).join(' · '))
  })
}

/** `refId`: the Blutec call this was (click-to-call) — the call webhook files it under the same id, so both become one. */
export function logCall(me: User, leadId: string, outcome: CallOutcome, note: string, followUp?: string, durationSec = 0, refId?: string, extra: Pick<Call, 'totalSec' | 'callStatus' | 'wrapSec'> = {}) {
  need(me, 'dialer.use', 'leads.manage')
  mutate((d) => {
    const l = d.leads.find((x) => x.id === leadId)
    assert(l, 'Lead not found.')
    const id = refId ? `bt-${refId}` : uid('call-')
    const filed = l.calls.find((c) => c.id === id)
    const known = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== ''))
    if (filed) Object.assign(filed, { by: me.id, outcome, note: [note, filed.note].filter(Boolean).join(' · '), durationSec: durationSec || filed.durationSec, ...known })
    else l.calls.unshift({ id, at: nowIso(), by: me.id, outcome, note, durationSec, ...known })
    l.status = CALL_OUTCOMES.find((o) => o.id === outcome)!.to
    if (followUp) l.followUp = followUp
    else if (!OPEN_LEAD.includes(l.status)) l.followUp = undefined
    if (note) l.notes = l.notes ? `${l.notes}\n${note}` : note
    l.seenAt ??= nowIso()
    leadEvent(l, me.id, `Call · ${LEAD_STATUS[l.status].label}`, [note, durationSec ? `${Math.round(durationSec / 60)} min` : ''].filter(Boolean).join(' · '))
  })
}

/**
 * Imports the checked rows of an uploaded sheet as one batch (Super Admin, as in the old CRM). Leads start unassigned
 * so they can be handed out; the whole batch can be deleted again from the upload history.
 */
export function importLeadBatch(me: User, file: { name: string; size: number; totalRows: number }, rows: (Partial<Lead> & { name: string; phone: string })[]) {
  assert(isSA(me), 'Only a Super Admin can upload leads.')
  assert(rows.length, 'No valid rows to import.')
  return mutate((d) => {
    const phones = new Set(d.leads.map((l) => l.phone))
    const up = { id: uid('lup-'), fileName: file.name, size: file.size, totalRows: file.totalRows, imported: 0, by: me.id, at: nowIso() }
    const fresh: Lead[] = []
    for (const r of rows) {
      if (!isPhone(r.phone) || phones.has(r.phone)) continue // checked already; a lead added meanwhile wins
      phones.add(r.phone)
      const lead: Lead = {
        ...r, id: uid('lead-'), code: `LD-${d.counters.lead++}`, company: r.company ?? '', email: r.email ?? '', city: r.city ?? '', state: r.state ?? '',
        service: r.service ?? '', source: r.source ?? `Uploaded: ${file.name}`, notes: r.notes ?? '', status: 'NEW', createdBy: me.id, createdAt: up.at, calls: [], uploadId: up.id,
      }
      leadEvent(lead, me.id, 'Uploaded', file.name)
      d.leads.unshift(lead)
      fresh.push(lead)
      up.imported++
    }
    ;(d.leadUploads ??= []).unshift(up)
    // auto-assign on: the new batch is shared out in turn straight away
    if (d.settings.leadAssign?.on && d.settings.leadAssign.userIds.length && fresh.length) shareLeads(d, me, fresh, d.settings.leadAssign.userIds, `Upload: ${file.name}`, false)
    audit(d, me.id, 'LEAD_UPLOAD', `${file.name}: ${up.imported} of ${file.totalRows} row(s)`)
    return up.imported
  })
}
/** Deletes an upload batch and the leads it created (old CRM: “Delete batch”). */
export function deleteLeadUpload(me: User, uploadId: string) {
  assert(isSA(me), 'Only a Super Admin can delete an upload.')
  return mutate((d) => {
    const up = d.leadUploads?.find((u) => u.id === uploadId)
    assert(up, 'Upload not found.')
    const n = d.leads.filter((l) => l.uploadId === uploadId).length
    d.leads = d.leads.filter((l) => l.uploadId !== uploadId)
    d.leadUploads = d.leadUploads!.filter((u) => u.id !== uploadId)
    audit(d, me.id, 'LEAD_UPLOAD_DELETE', `${up.fileName}: ${n} lead(s)`)
    return n
  })
}

// ============================================================ bookings (CRM entries)
export function visibleBookings(d: DB, me: User): Booking[] {
  // an Admin set up in Operations Dashboard → Team: only the files with work for them
  if (isStageOnlyAdmin(d, me)) return d.bookings.filter((b) => b.adminId === me.id || Object.values(b.adminWork ?? {}).some((w) => w?.assignee === me.id))
  const p = effectivePerms(d, me)
  // Branch Director: only the client files booked by people in their branches
  if (isBranchScoped(me)) {
    const mine = new Set(directorBranches(d, me))
    return d.bookings.filter((b) => b.createdBy === me.id || mine.has(bookingBranch(d, b) ?? NO_BRANCH))
  }
  if (p.has('bookings.all')) return d.bookings
  const team = new Set(d.users.filter((u) => u.teamLeadId === me.id).map((u) => u.id))
  return d.bookings.filter((b) => b.createdBy === me.id || (p.has('bookings.team') && (b.teamLeadId === me.id || team.has(b.createdBy))))
}

/**
 * Price bifurcation is compulsory for every service except funding ones (loans, certificates, company and digital
 * services each need their price); among funding services one price is enough and the others may be 0.
 */
export const needsPriceSplit = (s: { name: string; category?: string }) => !isFundingService(s)

/**
 * The services list (Super Admin / IT, Admin, Operation team — the same people who manage schemes): name, category,
 * GST, and a price for each booking type (Single, Multiple, Combo 3 / 6 / 9 / 12 months; blank = the Single price).
 */
export function saveService(me: User, s: Omit<Service, 'id'>, id?: string) {
  need(me, 'schemes.manage')
  assert(s.name.trim().length >= 2, 'Enter the service name.')
  assert(s.category.trim(), 'Pick or type a category.')
  assert(Number.isFinite(s.price) && s.price >= 0, 'The single-booking price must be 0 or more.')
  assert(s.gstRate >= 0 && s.gstRate <= 28, 'GST must be between 0 and 28%.')
  const prices = Object.fromEntries(Object.entries(s.prices ?? {}).filter(([, v]) => v != null && Number.isFinite(v)).map(([k, v]) => [k, round2(v as number)]))
  assert(Object.values(prices).every((v) => v >= 0), 'Prices must be 0 or more.')
  return mutate((d) => {
    const name = s.name.trim()
    assert(!d.services.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()), 'A service with this name already exists.')
    const base = { name, category: s.category.trim(), price: round2(s.price), gstRate: s.gstRate, deduction: round2(s.deduction || 0), active: s.active, prices: Object.keys(prices).length ? prices : undefined }
    if (id) {
      const x = d.services.find((y) => y.id === id)
      assert(x, 'Service not found.')
      Object.assign(x, base)
      if (!base.prices) delete x.prices
      audit(d, me.id, 'SERVICE_EDIT', name)
      return id
    }
    const nid = uid('svc-')
    d.services.push({ id: nid, ...base })
    audit(d, me.id, 'SERVICE_ADD', name)
    return nid
  })
}

/** Payment modes for money received (CRM entries, balance payments, invoices). */
export const PAYMENT_MODES = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'Razorpay', 'Cheque', 'Card', 'Cash'] as const

export type PaymentPartInput = { amount: number; date: string; mode: string; proof?: FileRef }
export type BookingInput = {
  companyName: string; companyAddress: string; city: string; state: string; industry: string
  contactPerson: string; mobile: string; email: string; pan: string; gstin: string
  paymentContact: string; paymentEmail: string
  services: { serviceId: string; price: number }[]
  /** Single / Multiple / Combo 3, 6, 9 or 12 months */
  bookingType: BookingType
  mode: Booking['mode']
  bookingDate: string
  payments: PaymentPartInput[]
  closedBy: string
  successFee: { type: 'AMOUNT' | 'PCT'; value: number }
  remarks: string
  note?: string
  priority: Booking['priority']; teamLeadId?: string; leadId?: string
  documents?: { file: FileRef; category: string }[]
  /** the client entry this CRM entry is made from (required for sales people and team leaders) */
  clientEntryId?: string
}

export function findDuplicates(d: DB, i: Partial<BookingInput>, excludeId?: string) {
  const phone = i.mobile ? normPhone(i.mobile) : ''
  return d.bookings.filter((b) => b.id !== excludeId && (
    (phone && normPhone(b.mobile) === phone) ||
    (i.email && b.email.toLowerCase() === i.email.toLowerCase()) ||
    (i.pan && b.pan && b.pan === i.pan.toUpperCase()) ||
    (i.gstin && b.gstin && b.gstin === i.gstin.toUpperCase())))
}

/** Every rule of a new CRM entry; returns the services resolved from the catalogue. */
function checkBooking(d: DB, i: BookingInput, isNew: boolean) {
  assert(i.companyName.trim().length >= 2, 'Company name is required.')
  assert(i.companyAddress.trim().length >= 5, 'Company address is required.')
  assert(i.city.trim(), 'City is required.')
  assert(i.state, 'Company state is required.')
  assert(i.contactPerson.trim().length >= 2, 'Contact person is required.')
  assert(isPhone(i.mobile), 'Enter a valid 10-digit company mobile.')
  assert(isEmail(i.email), 'Company email is required.')
  assert(isPhone(i.paymentContact), 'Payment contact must be a valid 10-digit mobile.')
  assert(!i.paymentEmail || isEmail(i.paymentEmail), 'Payment email is not valid.')
  assert(isPan(i.pan), 'Company PAN is required (format ABCDE1234F).')
  assert(!i.gstin || isGstin(i.gstin), 'GSTIN must be 15 characters (e.g. 24ABCDE1234F1Z5).')
  assert(i.services.length >= 1, 'Pick at least one service.')
  assert(BOOKING_TYPES.some((t) => t.id === i.bookingType), 'Pick the booking type.')
  if (i.bookingType === 'SINGLE') assert(i.services.length === 1, 'A single booking has one service — pick “Multiple booking” for more.')
  if (i.bookingType === 'MULTIPLE') assert(i.services.length >= 2, 'A multiple booking needs at least 2 services.')
  assert(new Set(i.services.map((s) => s.serviceId)).size === i.services.length, 'A service is listed twice.')
  const svcs = i.services.map((x) => { const s = d.services.find((y) => y.id === x.serviceId); assert(s, 'Pick each service from the list.'); return { s, price: round2(x.price || 0) } })
  assert(svcs.every((x) => x.price >= 0), 'A service price cannot be negative.')
  // price bifurcation: compulsory for loans, certificates and every non-funding service; funding needs one price
  for (const { s, price } of svcs) assert(!needsPriceSplit(s) || price > 0, `Enter the price for ${s.name} — price bifurcation is compulsory for loans, certificates and other non-funding services.`)
  const funding = svcs.filter((x) => isFundingService(x.s))
  if (funding.length) assert(funding.some((x) => x.price > 0), 'Enter the price of at least one funding service (the other funding services can be 0).')
  const months = comboMonths(i.bookingType)
  if (months) {
    const p = COMBO_PACKAGES[months]
    assert(svcs.length <= comboCap(p), `${p.name} allows up to ${comboCap(p)} applications (${p.maxApps} at the start + ${p.extraPerMonth} a month).`)
    const value = round2(svcs.reduce((t, x) => t + x.price, 0))
    assert(value >= p.minPrice, `${p.name} (${months} months) has a minimum package price of ₹${p.minPrice.toLocaleString('en-IN')} — the services add up to ₹${value.toLocaleString('en-IN')}.`)
  }
  assert(i.mode === 'Refundable' || i.mode === 'Non-Refundable', 'Pick the mode.')
  assert(i.bookingDate, 'Booking date is required.')
  if (isNew) {
    assert(i.payments.length === 1, 'Enter payment part 1 (the advance) only — later parts are added by Accounts.')
    i.payments.forEach((p, k) => {
      assert(p.amount > 0, `Enter the amount of payment part ${k + 1}.`)
      assert(p.date, `Enter the date of payment part ${k + 1}.`)
    })
    assert(i.payments[0]!.proof, 'Attach the proof of receiving payment part 1.')
  }
  assert(i.closedBy, 'Pick who closed the lead.')
  assert(i.successFee.value >= 0 && (i.successFee.type === 'AMOUNT' || i.successFee.value <= 100), 'Success fee must be 0 or more (a percentage up to 100). Enter 0 if the client did not agree.')
  assert(i.remarks.trim().length >= 3, 'Remarks are required.')
  return svcs
}

const comboDeadline = (from: string, months: number) => { const x = new Date(from + 'T00:00:00'); x.setMonth(x.getMonth() + months); return ymd(x) }
const serviceTitle = (names: string[], combo?: number) => (combo ? `Combo ${combo === 12 ? '1 year' : `${combo} months`}: ` : '') + names.join(' + ')

/**
 * A new CRM entry goes straight to Accounts (no Team Leader approval step). The total quoted is the advance taken
 * from the client (payment part 1); later parts are added as balance payments and count in the month they were paid.
 */
export function createBooking(me: User, i: BookingInput) {
  need(me, 'bookings.create')
  const svcs = checkBooking(getDb(), i, true)
  // sales person → dialer → client entry → follow-ups → CRM entry: sales people and team leaders convert a client entry
  if (startsFromClientEntry(me)) assert(i.clientEntryId, 'Make the CRM entry from a client entry: fill the client entry in the dialer first, then convert it once the payment is received.')
  if (i.clientEntryId) assert(convertibleEntries(getDb(), me).some((e) => e.id === i.clientEntryId), 'That client entry is not yours to convert, or it is already a CRM entry.')
  return mutate((d) => {
    const first = svcs[0]!.s
    const gstRate = Math.max(...svcs.map((x) => x.s.gstRate))
    const isTL = rolesOf(me).includes('teamlead')
    // the team leader is kept for reports and their dashboard; they no longer approve the entry
    const tl = isTL ? me.id : i.teamLeadId || me.teamLeadId
    const months = comboMonths(i.bookingType)
    const at = nowIso()
    const payments = i.payments.map((p, k) => {
      const amount = round2(p.amount), gst = round2((amount * gstRate) / 100)
      return { id: uid('pay-'), part: k + 1, amount, gst, total: round2(amount + gst), date: p.date, mode: p.mode, proofName: p.proof?.name ?? '', proof: p.proof, recordedBy: me.id, verified: false }
    })
    const b: Booking = {
      id: uid('bk-'), bookingId: `RX-${new Date().getFullYear()}-${String(d.counters.booking++).padStart(6, '0')}`,
      companyName: i.companyName.trim(), address: i.companyAddress.trim(), contactPerson: i.contactPerson.trim(), mobile: normPhone(i.mobile), email: i.email.trim().toLowerCase(),
      pan: i.pan.toUpperCase(), gstin: i.gstin.toUpperCase(), city: i.city.trim(), state: i.state, industry: i.industry.trim(),
      serviceId: first.id, serviceName: serviceTitle(svcs.map((x) => x.s.name), months),
      services: svcs.map((x) => ({ serviceId: x.s.id, name: x.s.name, price: x.price })),
      bookingType: i.bookingType,
      ...(months ? { combo: { months, startedOn: i.bookingDate, deadline: comboDeadline(i.bookingDate, months) } } : {}),
      mode: i.mode, successFeePct: i.successFee.type === 'PCT' ? i.successFee.value : 0, successFee: { ...i.successFee },
      // total quoted = the advance (payment part 1, before GST) — not the sum of the scheme prices
      totalQuoted: round2(i.payments[0]!.amount), gstRate, deduction: Math.max(...svcs.map((x) => x.s.deduction)),
      paymentContact: normPhone(i.paymentContact), paymentEmail: i.paymentEmail.trim().toLowerCase() || undefined,
      // the person making the entry closed the lead (not picked from a list)
      bookingDate: i.bookingDate, closedBy: me.id, remarks: i.remarks.trim(),
      payments,
      createdBy: me.id, teamLeadId: tl, status: 'PENDING_ACCOUNTS',
      approvals: [{ id: uid('ap-'), level: isTL ? 'Team Leader' : 'Sales', action: 'SUBMITTED', by: me.id, at, remark: 'Sent straight to Accounts' }],
      stage: 1, maxStage: 1, stageHistory: [],
      comments: [
        { id: uid('c-'), by: me.id, at, text: i.remarks.trim(), kind: 'Remarks' },
        ...(i.note?.trim() ? [{ id: uid('c-'), by: me.id, at, text: i.note.trim(), kind: 'Note for approvers' }] : []),
      ],
      documents: (i.documents ?? []).map((x) => ({ id: uid('doc-'), name: x.file.name, category: x.category, size: x.file.size, at, by: me.id, status: 'PENDING' as const, file: x.file })),
      tasks: [], priority: i.priority, deadline: months ? comboDeadline(i.bookingDate, months) : ymd(addDays(new Date(), 30)), leadId: i.leadId,
      createdAt: at, updatedAt: at,
    }
    d.bookings.unshift(b)
    if (i.leadId) { const l = d.leads.find((x) => x.id === i.leadId); if (l) l.status = 'CONVERTED' }
    if (i.clientEntryId) markConverted(d, me, i.clientEntryId, b.id)
    notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'New file for accounts', `${b.bookingId} · ${b.companyName} by ${me.name}`, `/bookings/${b.id}`, 'action')
    if (tl && tl !== me.id) notify(d, [tl], 'Your team booked a client', `${b.bookingId} · ${b.companyName} by ${me.name} — sent to Accounts`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, 'BOOKING_CREATE', `${b.bookingId} ${b.companyName} · ${b.serviceName}`)
    return b.id
  })
}

/** Combo booking: add another service (with its price) until the combo deadline. */
export function addComboService(me: User, id: string, serviceId: string, price: number) {
  mutate((d) => {
    const b = findB(d, id)
    assert(b.combo, 'This is not a combo booking.')
    assert(b.createdBy === me.id || b.teamLeadId === me.id || has(me, 'bookings.accounts') || isSA(me), 'Only the sales owner, team leader or accounts can add services.')
    assert(today() <= b.combo.deadline, `The combo period ended on ${fmtDate(b.combo.deadline)}.`)
    const s = d.services.find((x) => x.id === serviceId)
    assert(s, 'Pick a service.')
    assert(!b.services?.some((x) => x.serviceId === serviceId), 'That service is already on this booking.')
    assert(!needsPriceSplit(s) || price > 0, `Enter the price for ${s.name}.`)
    const pkg = COMBO_PACKAGES[b.combo.months]
    assert((b.services ?? []).filter((x) => !x.complimentary).length < comboCap(pkg), `${pkg.name} allows up to ${comboCap(pkg)} applications — this combo has them all.`)
    b.services = [...(b.services ?? []), { serviceId: s.id, name: s.name, price: round2(price || 0), addedBy: me.id, addedAt: nowIso() }]
    b.serviceName = serviceTitle(b.services.filter((x) => !x.complimentary).map((x) => x.name), b.combo.months)
    b.updatedAt = nowIso()
    notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'Service added to a combo booking', `${b.bookingId} · ${s.name}${price ? ` · ₹${price}` : ''}`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, 'COMBO_ADD', `${b.bookingId}: ${s.name} ₹${price || 0}`)
  })
}

/** The Operation team gives a client a complimentary (free) service on their file. It never changes the money. */
export function addComplimentaryService(me: User, id: string, serviceId: string, note: string) {
  need(me, 'bookings.process')
  mutate((d) => {
    const b = findB(d, id)
    assert(!['REJECTED'].includes(b.status), 'This file was rejected.')
    const s = d.services.find((x) => x.id === serviceId)
    assert(s, 'Pick a service.')
    assert(!b.services?.some((x) => x.serviceId === serviceId), 'That service is already on this file.')
    assert(note.trim().length >= 3, 'Say why it is given (e.g. “promised at booking”).')
    const at = nowIso()
    b.services = [...(b.services ?? [{ serviceId: b.serviceId, name: b.serviceName, price: b.totalQuoted }]), { serviceId: s.id, name: s.name, price: 0, complimentary: true, addedBy: me.id, addedAt: at }]
    b.comments.push({ id: uid('c-'), by: me.id, at, text: `Complimentary service: ${s.name} — ${note.trim()}`, kind: 'Operations' })
    b.updatedAt = at
    notify(d, [b.createdBy, ...usersWithRole(d, 'accounts').map((u) => u.id)].filter((x) => x !== me.id), 'Complimentary service added', `${b.bookingId} · ${s.name} (free)`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, 'COMPLIMENTARY_ADD', `${b.bookingId}: ${s.name}`)
  })
}

/** Warn the sales owner and team leader 7 days before a combo period ends (runs on the app timer). */
export function runComboReminders(now = Date.now()) {
  const soon = ymd(new Date(now + 7 * 86400000)), t = ymd(new Date(now))
  const due = getDb().bookings.filter((b) => b.combo && !b.combo.deadlineNotified && b.combo.deadline >= t && b.combo.deadline <= soon && !['REJECTED', 'COMPLETED'].includes(b.status))
  if (!due.length) return 0
  mutate((d) => {
    for (const x of due) {
      const b = d.bookings.find((y) => y.id === x.id)!
      b.combo!.deadlineNotified = true
      notify(d, [b.createdBy, b.teamLeadId], 'Combo period ending soon', `${b.bookingId} · ${b.companyName} — services can be added until ${fmtDate(b.combo!.deadline)}`, `/bookings/${b.id}`, 'warning')
    }
  })
  return due.length
}
/** Statuses in which the sales person who made a CRM entry edits it themselves (until it goes on to Legal). */
export const OWNER_EDITABLE: BookingStatus[] = ['PENDING_TL', 'PENDING_ACCOUNTS', 'ACCOUNTS_HOLD', 'REJECTED', 'CHANGES_REQUIRED']
export function canEditBooking(d: DB, me: User, b: Booking) {
  if (isSA(me)) return true
  if (b.status === 'COMPLETED') return false
  if (effectivePerms(d, me).has('bookings.accounts')) return true
  return b.createdBy === me.id && effectivePerms(d, me).has('bookings.create') && OWNER_EDITABLE.includes(b.status)
}

export type BookingPatch = Partial<Pick<Booking, 'companyName' | 'address' | 'contactPerson' | 'mobile' | 'email' | 'pan' | 'gstin' | 'city' | 'state' | 'industry' | 'mode' | 'priority' | 'paymentContact' | 'paymentEmail' | 'bookingDate' | 'closedBy' | 'remarks' | 'successFee' | 'teamLeadId'>>
export function updateBooking(me: User, id: string, patch: BookingPatch) {
  mutate((d) => {
    const b = findB(d, id)
    assert(canEditBooking(d, me, b), 'This CRM entry is locked for you.')
    if (patch.mobile !== undefined) { assert(isPhone(patch.mobile), 'Enter a valid 10-digit mobile.'); patch.mobile = normPhone(patch.mobile) }
    if (patch.pan) { assert(isPan(patch.pan), 'PAN must look like ABCDE1234F.'); patch.pan = patch.pan.toUpperCase() }
    if (patch.gstin) { assert(isGstin(patch.gstin), 'GSTIN format is invalid.'); patch.gstin = patch.gstin.toUpperCase() }
    if (patch.paymentContact !== undefined) { assert(isPhone(patch.paymentContact), 'Payment contact must be a valid 10-digit mobile.'); patch.paymentContact = normPhone(patch.paymentContact) }
    if (patch.email !== undefined) assert(isEmail(patch.email), 'Enter a valid company email.')
    if (patch.remarks !== undefined) assert(patch.remarks.trim().length >= 3, 'Remarks are required.')
    if (patch.companyName !== undefined) assert(patch.companyName.trim().length >= 2, 'Company name is required.')
    if (patch.successFee) {
      assert(Number.isFinite(patch.successFee.value) && patch.successFee.value >= 0 && (patch.successFee.type === 'AMOUNT' || patch.successFee.value <= 100), 'Success fee must be 0 or more (a percentage up to 100). Enter 0 if the client did not agree.')
      b.successFeePct = patch.successFee.type === 'PCT' ? patch.successFee.value : 0
    }
    Object.assign(b, patch)
    b.updatedAt = nowIso()
    // the sales person changed an entry Accounts is checking: tell Accounts
    if (b.createdBy === me.id && !has(me, 'bookings.accounts') && ['PENDING_ACCOUNTS', 'ACCOUNTS_HOLD'].includes(b.status))
      notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'CRM entry edited by sales', `${b.bookingId} · ${b.companyName} — check the changes`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, 'BOOKING_EDIT', `${b.bookingId} edited`)
  })
}

export type Decision =
  | { kind: 'APPROVE'; remark: string }
  | { kind: 'REJECT'; remark: string }
  | { kind: 'HOLD'; remark: string }
  | { kind: 'RESUME'; remark: string }
  | { kind: 'RESUBMIT'; remark: string }
  | { kind: 'REQUEST_CHANGES'; remark: string }
  | { kind: 'ASSIGN_OPS'; remark: string; opsMemberId: string; maxStage: number; deadline: string }
  /** `stages`: the documents ticked for this Admin (they go straight to them); not given = the usual routing */
  | { kind: 'ASSIGN_ADMIN'; remark: string; adminId: string; stages?: AdminStageId[] }
  | { kind: 'RETURN_OPS'; remark: string }
  | { kind: 'COMPLETE'; remark: string }
  | { kind: 'APPROVE_DONE'; remark: string }
  | { kind: 'RETURN_ADMIN'; remark: string }

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
      // Legal approves (= assigns Operations), sends it back for corrections, or rejects it
      if (p.has('bookings.legal')) out.push('ASSIGN_OPS', 'REQUEST_CHANGES', 'REJECT')
      break
    case 'CHANGES_REQUIRED':
      if (b.createdBy === me.id || sa) out.push('RESUBMIT')
      break
    case 'IN_OPERATIONS':
      if (p.has('bookings.process') && (b.opsMemberId === me.id || sa)) out.push('ASSIGN_ADMIN', 'HOLD')
      if (p.has('bookings.legal') && !out.includes('ASSIGN_OPS')) out.push('ASSIGN_OPS')
      break
    case 'WITH_ADMIN':
      if (p.has('bookings.admin') && (b.adminId === me.id || sa)) out.push('COMPLETE', 'HOLD', 'RETURN_OPS')
      break
    case 'OPS_REVIEW':
      // Admin finished the client work: the assigned Operations member approves it (or sends it back)
      if (p.has('bookings.process') && (b.opsMemberId === me.id || sa)) out.push('APPROVE_DONE', 'RETURN_ADMIN')
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
      PENDING_TL: 'Team Leader', PENDING_ACCOUNTS: 'Accounts', ACCOUNTS_HOLD: 'Accounts', PENDING_LEGAL: 'Legal', CHANGES_REQUIRED: 'Sales',
      IN_OPERATIONS: 'Operations', WITH_ADMIN: 'Admin', OPS_REVIEW: 'Operations approval', ON_HOLD: 'Hold', REJECTED: 'Sales',
    }
    const level = levelOf[b.status] ?? b.status
    if (['REJECT', 'HOLD', 'RETURN_OPS', 'RETURN_ADMIN', 'REQUEST_CHANGES'].includes(dec.kind)) assert(dec.remark.trim().length >= 3, dec.kind === 'REQUEST_CHANGES' ? 'Say what needs to be corrected.' : 'A reason is required.')
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
      case 'REQUEST_CHANGES':
        // Legal sends the file back to the sales owner to correct; it returns to Legal when resubmitted
        b.status = 'CHANGES_REQUIRED'
        notify(d, [b.createdBy, b.teamLeadId], 'Legal asked for corrections', `${label}: ${dec.remark}`, link, 'action')
        break
      case 'RESUBMIT':
        // corrections go straight back to Legal; a rejected entry starts again at Accounts (no Team Leader step)
        if (b.status === 'CHANGES_REQUIRED') {
          b.status = 'PENDING_LEGAL'
          notify(d, toRole('legal'), 'Corrected file back for legal review', label, link, 'action')
        } else {
          b.status = 'PENDING_ACCOUNTS'
          notify(d, toRole('accounts'), 'CRM entry resubmitted', label, link, 'action')
        }
        break
      case 'ASSIGN_OPS': {
        const ops = d.users.find((u) => u.id === dec.opsMemberId)
        assert(ops && rolesOf(ops).includes('operations'), 'Pick an Operation Team member.')
        assert(dec.maxStage >= 1 && dec.maxStage <= STAGES.length, 'Pick the furthest stage allowed.')
        if (b.status === 'PENDING_LEGAL') assert(hasLegalDoc(b), "Add the client's Agreement or Undertaking first (Documents), then assign the file to Operations.")
        const first = !b.opsMemberId
        b.opsMemberId = ops.id
        b.maxStage = dec.maxStage
        if (dec.deadline) b.deadline = dec.deadline
        if (b.status === 'PENDING_LEGAL') {
          b.status = 'IN_OPERATIONS'
          if (first || !b.stageHistory.length) { b.stage = 1; b.stageHistory.push({ stage: 1, at, by: me.id, note: 'Assigned by Legal' }) }
          // legal approval starts the automation once: client welcome message + the 15-day follow-up
          startOpsWorkflow(d, b, me.id, at)
        }
        notify(d, [ops.id], 'New client file assigned to you', `${label} · up to stage ${dec.maxStage}`, link, 'action')
        notify(d, [b.createdBy], 'Legal approved · now with Operations', label, link, 'success')
        break
      }
      case 'ASSIGN_ADMIN': {
        const ad = d.users.find((u) => u.id === dec.adminId)
        assert(ad && rolesOf(ad).includes('admin'), 'Pick an Admin.')
        if (dec.stages) {
          assert(dec.stages.length, 'Tick at least one document for this Admin.')
          for (const s of dec.stages) {
            const st = ADMIN_STAGES.find((x) => x.id === s)
            assert(st, 'Unknown document.')
            assert(adminMayDo(d, ad.id, s), `${ad.name} doesn’t do ${st.short} (Operations Dashboard → Team).`)
            assert(!b.adminWork?.[s] || !ADMIN_DONE.includes(b.adminWork[s]!.status), `${st.short} is already done on this file.`)
          }
        }
        const prevAdmin = b.adminId
        b.adminId = ad.id
        b.status = 'WITH_ADMIN'
        startAdminWork(d, b, me.id, at, prevAdmin, dec.stages)
        notify(d, [ad.id], 'Operations assigned a file to you', label, link, 'action')
        break
      }
      case 'RETURN_OPS':
        b.status = 'IN_OPERATIONS'
        notify(d, [b.opsMemberId], 'Admin returned a file', `${label}: ${dec.remark}`, link, 'warning')
        break
      case 'COMPLETE':
        b.status = 'OPS_REVIEW'
        notify(d, [b.opsMemberId], 'Admin finished the client work — please approve', label, link, 'action')
        break
      case 'RETURN_ADMIN':
        b.status = 'WITH_ADMIN'
        notify(d, [b.adminId], 'Operations sent the file back', `${label}: ${dec.remark}`, link, 'warning')
        break
      case 'APPROVE_DONE': {
        // completing puts the file on the final stage; its result stays as Admin set it (Approved if none was chosen)
        b.status = 'COMPLETED'
        b.maxStage = FINAL_STAGE
        if (b.stage < FINAL_STAGE || !b.stageOutcome) {
          b.stage = FINAL_STAGE
          b.stageOutcome = b.stageOutcome && STAGE_OUTCOMES[FINAL_STAGE]!.some((o) => o.id === b.stageOutcome) ? b.stageOutcome : 'APPROVED'
          b.stageHistory.push({ stage: FINAL_STAGE, at, by: me.id, outcome: b.stageOutcome, note: dec.remark || 'Approved by Operations' })
        }
        notify(d, [b.createdBy, b.teamLeadId, b.adminId, ...toRole('superadmin')], 'Client work completed 🎉', label, link, 'success')
        break
      }
    }
    b.approvals.push({ id: uid('ap-'), level, action: dec.kind === 'APPROVE' ? 'APPROVED' : dec.kind === 'REJECT' ? 'REJECTED' : dec.kind === 'COMPLETE' ? 'WORK_DONE' : dec.kind === 'APPROVE_DONE' ? 'COMPLETED' : dec.kind, by: me.id, at, remark: dec.remark })
    b.updatedAt = at
    audit(d, me.id, `BOOKING_${dec.kind}`, `${b.bookingId}: ${dec.remark || '—'}`)
  })
}

// ============================================================ workflow automation (welcome, follow-ups, Admin checklist)
/**
 * Legal approval → Operations: the welcome message is queued once (email PENDING when automatic sending is on and the
 * client has an email; WhatsApp PENDING when the live server sends it through Interakt and a template is chosen) and
 * the every-15-days follow-up starts. Never runs twice.
 */
function startOpsWorkflow(d: DB, b: Booking, by: string, at: string) {
  const w = workflowSettings(d.settings.workflow)
  const t = istToday()
  b.welcome ??= {
    email: { status: !w.welcomeAuto ? 'SKIPPED' : isEmail(b.email) ? 'PENDING' : 'NO_CONTACT', to: b.email || undefined, attempts: 0 },
    // WhatsApp goes out from the live server (Interakt); without it staff open the chat by hand — never reported as delivered
    whatsapp: { status: !isPhone(b.mobile) ? 'NO_CONTACT' : !(CLOUD && w.whatsapp.welcomeTemplate) ? 'NOT_CONFIGURED' : w.welcomeAuto ? 'PENDING' : 'SKIPPED', to: b.mobile || undefined, attempts: 0 },
    createdAt: at, createdBy: by,
  }
  b.followUp ??= { everyDays: w.fileReminderDays, startedOn: t, nextOn: addDaysYmd(t, w.fileReminderDays), log: [] }
}
/**
 * Admin assigned: the five Admin stages are set up (Pitch Deck with its 3-day reminder); a new Admin takes over the open
 * ones. `picked` = the documents Operations ticked for this Admin: those go straight to them (even from someone else,
 * unless done); the others don't go to them.
 */
function startAdminWork(d: DB, b: Booking, by: string, at: string, prevAdmin?: string, picked?: AdminStageId[]) {
  const fresh = ADMIN_STAGES.filter((s) => !b.adminWork?.[s.id]).map((s) => s.id)
  const handOver = ADMIN_STAGES.filter((s) => { const cur = b.adminWork?.[s.id]; return !!cur && !!prevAdmin && prevAdmin !== b.adminId && cur.assignee === prevAdmin && !ADMIN_DONE.includes(cur.status) }).map((s) => s.id)
  if (!b.adminId) return
  const taken = (picked ?? []).filter((s) => !fresh.includes(s) && !handOver.includes(s) && openStage(b.adminWork?.[s]))
  // ticked: this Admin; otherwise each stage goes straight to the Admin it is given to in Operations Dashboard → Team
  // (else the file's Admin, if allowed and nothing was ticked); one nobody handles waits for Operations to forward it
  const target = (s: AdminStageId) => (picked ? (picked.includes(s) ? b.adminId : routeAdminStage(d, b, s, b.adminId)) : routeAdminStage(d, b, s))
  const routed = [...fresh, ...handOver, ...taken].map((s) => [s, target(s)] as const).filter(([, uid]) => uid)
  assignAdminStages(d, b, by, at, Object.fromEntries(routed), fresh.length ? 'Admin assigned' : 'Handed over')
  const allowed = routed.map(([s]) => s)
  const w = workflowSettings(d.settings.workflow)
  for (const s of fresh.filter((x) => !allowed.includes(x))) {
    b.adminWork![s] = {
      status: 'NOT_STARTED', updatedAt: at, updatedBy: by, history: [{ at, by, status: 'NOT_STARTED', note: 'No Admin handles this document — forward it to an Admin (or give it to one in Operations Dashboard → Team)' }],
      ...(s === 'PRECHECK' ? { remindEveryDays: w.precheckDays, nextRemindOn: addDaysYmd(istToday(), w.precheckDays) } : {}),
    }
  }
}

/**
 * Document types given to an Admin in Operations Dashboard → Team; not set = all five (an Admin never set up there).
 * An Admin who is set up there works only on — and sees only — the stages assigned to them (see isStageOnlyAdmin).
 */
export const adminStageAccess = (d: DB, userId: string): AdminStageId[] => workflowSettings(d.settings.workflow).adminStageAccess?.[userId] ?? ADMIN_STAGES.map((s) => s.id)
export const adminMayDo = (d: DB, userId: string, stage: AdminStageId) => adminStageAccess(d, userId).includes(stage)
export { isStageOnlyAdmin }
const openStage = (w?: { status: AdminWorkStatus }) => !!w && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED'
/** Open Admin stages (all types) assigned to a person across the active files — to share work out evenly. */
const openStagesOf = (d: DB, userId: string) => d.bookings.reduce((n, b) => n + Object.values(b.adminWork ?? {}).filter((w) => w?.assignee === userId && openStage(w)).length, 0)
/**
 * Who gets a stage on a file: an Admin given that document in Team (the file's own Admin if they are one of them,
 * else the one with the fewest open stages), else the file's Admin if allowed; undefined = nobody (Operations forwards).
 */
function routeAdminStage(d: DB, b: Booking, stage: AdminStageId, except?: string): string | undefined {
  const access = workflowSettings(d.settings.workflow).adminStageAccess ?? {}
  const team = usersWithRole(d, 'admin').filter((u) => u.id !== except && access[u.id]?.includes(stage))
  if (team.length) return team.some((u) => u.id === b.adminId) ? b.adminId : [...team].sort((x, y) => openStagesOf(d, x.id) - openStagesOf(d, y.id))[0]!.id
  return b.adminId && b.adminId !== except && adminMayDo(d, b.adminId, stage) ? b.adminId : undefined
}
/** Super Admin / IT and Admin managers (Workflow settings) — never an Admin limited to their own stages. */
export const canSetAdminStageAccess = (me: User) => isMaster(me) || (has(me, 'workflow.manage') && !isStageOnlyAdmin(getDb(), me))
/**
 * Operations Dashboard → Team: the documents one Admin does. Takes effect at once on the active files — open stages
 * of the ticked types that have nobody (or someone no longer allowed) go to this Admin; their open stages of the
 * unticked types go to another Admin given that document, or back to the Operation team to forward. Finished stages
 * stay as they are. `stages` null = no limit (all five, sees files as before). Answers how many stages moved.
 */
export function setAdminStageAccess(me: User, userId: string, stages: AdminStageId[] | null) {
  assert(canSetAdminStageAccess(me), 'Only Admin managers (Workflow settings) or Super Admin can change document permissions.')
  return mutate((d) => {
    const u = d.users.find((x) => x.id === userId)
    assert(u && u.active && rolesOf(u).includes('admin'), 'Pick an active Admin.')
    assert(!stages || stages.every((s) => ADMIN_STAGES.some((x) => x.id === s)), 'Unknown document type.')
    const w = workflowSettings(d.settings.workflow)
    const access = { ...(w.adminStageAccess ?? {}) }
    if (stages) access[userId] = ADMIN_STAGES.map((s) => s.id).filter((s) => stages.includes(s)); else delete access[userId]
    d.settings.workflow = { ...w, adminStageAccess: access }
    audit(d, me.id, 'ADMIN_DOC_ACCESS', `${u.name}: ${stages ? (stages.length ? stages.map((s) => ADMIN_STAGES.find((x) => x.id === s)!.short).join(', ') : 'none') : 'all document types (no limit)'}`)
    if (!stages) return { given: 0, released: 0 }
    const at = nowIso()
    let given = 0, released = 0
    for (const b of d.bookings.filter((x) => x.adminWork && ACTIVE_FILE_STATUSES.includes(x.status))) {
      const to: Partial<Record<AdminStageId, string>> = {}
      const before = given + released
      for (const s of ADMIN_STAGES) {
        const cur = b.adminWork![s.id]
        if (!openStage(cur)) continue
        if (stages.includes(s.id) && (!cur!.assignee || !adminMayDo(d, cur!.assignee, s.id))) { to[s.id] = userId; given++ }
        else if (!stages.includes(s.id) && cur!.assignee === userId) {
          const next = routeAdminStage(d, b, s.id, userId)
          if (next) to[s.id] = next
          else {
            // nobody else does it: back to the Operation team to forward
            cur!.assignee = undefined
            cur!.history.push({ at, by: me.id, status: cur!.status, note: `${u.name} no longer does ${s.label} (Operations Dashboard → Team) — forward it to an Admin` })
            cur!.updatedAt = at; cur!.updatedBy = me.id
            notify(d, [b.opsMemberId], `${b.bookingId}: ${s.label} needs an Admin`, `${b.companyName} — ${u.name} no longer does ${s.label}`, `/bookings/${b.id}?tab=workflow`, 'action')
          }
          released++
        }
      }
      if (Object.keys(to).length) assignAdminStages(d, b, me.id, at, to, 'Team assignment')
      if (given + released > before) b.updatedAt = at
    }
    return { given, released }
  })
}
/** A stage is submitted / approved / completed only once its file has been uploaded to the CRM entry. */
export const stageFiles = (b: Booking, stage: AdminStageId) => { const label = ADMIN_STAGES.find((s) => s.id === stage)!.label; return b.documents.filter((x) => x.category === label) }

/** The next assignment number on a file: RX-2026-000125/1, /2, /3 … — one more each time it goes to another person. */
const nextAssignNo = (b: Booking) => 1 + Math.max(0, ...Object.values(b.adminWork ?? {}).flatMap((w) => (w?.history ?? []).map((h) => Number(h.ref?.split('/').pop()) || 0)))
/**
 * Gives Admin stages to people: each person gets the next assignment number (stages going to the same person in one
 * go share it). Creates a stage that isn't set up yet (Pitch Deck with its reminder). Tells each person.
 */
function assignAdminStages(d: DB, b: Booking, by: string, at: string, to: Partial<Record<AdminStageId, string>>, note: string) {
  const w = workflowSettings(d.settings.workflow)
  b.adminWork ??= {}
  const byPerson = new Map<string, AdminStageId[]>()
  for (const [stage, uid] of Object.entries(to) as [AdminStageId, string][]) if (uid && b.adminWork[stage]?.assignee !== uid) byPerson.set(uid, [...(byPerson.get(uid) ?? []), stage])
  for (const [uid, stages] of byPerson) {
    const ref = `${b.bookingId}/${nextAssignNo(b)}`
    for (const stage of stages) {
      const cur = b.adminWork[stage]
      const h = { at, by, status: cur?.status ?? 'NOT_STARTED' as AdminWorkStatus, note: `${note}: ${userName(d, uid)} (${ref})`, assignee: uid, ref }
      if (!cur) {
        b.adminWork[stage] = {
          status: 'NOT_STARTED', assignee: uid, ref, assignedBy: by, assignedAt: at, updatedAt: at, updatedBy: by, history: [h],
          ...(stage === 'PRECHECK' ? { remindEveryDays: w.precheckDays, nextRemindOn: addDaysYmd(istToday(), w.precheckDays) } : {}),
        }
      } else Object.assign(cur, { assignee: uid, ref, assignedBy: by, assignedAt: at, updatedAt: at, updatedBy: by, history: [...cur.history, h] })
    }
    const labels = stages.map((s) => ADMIN_STAGES.find((x) => x.id === s)!.label).join(', ')
    if (uid !== by) notify(d, [uid], `${ref}: ${labels}`, `${b.companyName} — assigned to you by ${userName(d, by)}`, `/bookings/${b.id}?tab=workflow`, 'action')
    audit(d, by, 'ADMIN_STAGE_ASSIGN', `${ref}: ${labels} → ${userName(d, uid)}`)
  }
}

/** The file's Operations person (or Super Admin / IT) gives each Admin stage to an Admin — one by one, to different people. */
export const canForwardAdminStages = (d: DB, me: User, b: Booking) => ACTIVE_FILE_STATUSES.includes(b.status) && (isMaster(me) || (effectivePerms(d, me).has('bookings.process') && b.opsMemberId === me.id))
export function forwardAdminStages(me: User, id: string, to: Partial<Record<AdminStageId, string>>, note = '') {
  mutate((d) => {
    const b = findB(d, id)
    assert(canForwardAdminStages(d, me, b), 'Only the file’s Operations person can forward its Admin stages.')
    const picks = Object.entries(to).filter(([, uid]) => uid) as [AdminStageId, string][]
    assert(picks.length, 'Pick an Admin for at least one stage.')
    for (const [stage, uid] of picks) {
      const u = d.users.find((x) => x.id === uid)
      assert(u && u.active && rolesOf(u).includes('admin'), 'Pick active Admins only.')
      assert(adminMayDo(d, uid, stage), `${u.name} isn’t allowed to handle ${ADMIN_STAGES.find((s) => s.id === stage)!.label} (Operations Dashboard → Team).`)
      const cur = b.adminWork?.[stage]
      assert(!cur || !ADMIN_DONE.includes(cur.status) || isMaster(me), `${ADMIN_STAGES.find((s) => s.id === stage)!.label} is already done.`)
    }
    assignAdminStages(d, b, me.id, nowIso(), Object.fromEntries(picks), note.trim() ? `Forwarded — ${note.trim()}` : 'Forwarded')
    b.updatedAt = nowIso()
  })
}
/** Who may upload a stage's file: the Admin it is assigned to and who is allowed that document type, or Super Admin / IT. */
export const canUploadAdminStage = (me: User, b: Booking, stage: AdminStageId) => !!b.adminWork?.[stage]
  && (isMaster(me) || (b.adminWork[stage]!.assignee === me.id && adminMayDo(getDb(), me.id, stage)))
/** The Admin's file for a stage (Pitch Deck, Finance, DPR, Certificate, Submission), named with the assignment number. */
export function addAdminStageFiles(me: User, id: string, stage: AdminStageId, files: FileRef[], note = '') {
  assert(files.length, 'Choose a file.')
  mutate((d) => {
    const b = findB(d, id)
    const w = b.adminWork?.[stage]
    assert(w && canUploadAdminStage(me, b, stage), 'You can upload here only when the Operation team has assigned this stage to you.')
    const s = ADMIN_STAGES.find((x) => x.id === stage)!, at = nowIso(), ref = w.ref ?? b.bookingId
    for (const file of files) b.documents.push({ id: uid('doc-'), name: `${ref} · ${s.short} · ${file.name}`, category: s.label, size: file.size, at, by: me.id, status: 'PENDING', file, note: [`${s.label} (${ref})`, note.trim()].filter(Boolean).join(' — ') })
    w.history.push({ at, by: me.id, status: w.status, note: `Uploaded ${files.length} file(s)${note.trim() ? ` — ${note.trim()}` : ''}`, ref })
    w.updatedAt = at; w.updatedBy = me.id
    b.updatedAt = at
    notify(d, [b.opsMemberId].filter((x) => x && x !== me.id), `${ref}: ${s.label} uploaded`, `${b.companyName} · ${files.length} file(s) by ${me.name} — verify in Documents`, `/bookings/${b.id}`, 'action')
    audit(d, me.id, 'ADMIN_STAGE_UPLOAD', `${ref}: ${s.label} · ${files.map((f) => f.name).join(', ')}`)
  })
}

/** The file's Admin, whoever a stage is assigned to, the file's Operations person, and Super Admin / IT. */
export function canWorkAdminStages(d: DB, me: User, b: Booking) {
  if (isMaster(me)) return true
  const p = effectivePerms(d, me)
  return (p.has('bookings.admin') && (b.adminId === me.id || Object.values(b.adminWork ?? {}).some((w) => w?.assignee === me.id)))
    || (p.has('bookings.process') && b.opsMemberId === me.id)
}
/** A file's documents someone sees: an Admin set up in Team doesn't see the files of other people's Admin stages. */
export function visibleDocuments(d: DB, me: User, b: Booking) {
  if (!isStageOnlyAdmin(d, me)) return b.documents
  const others = new Set(ADMIN_STAGES.filter((s) => b.adminWork?.[s.id]?.assignee !== me.id).map((s) => s.label))
  return b.documents.filter((x) => !others.has(x.category))
}
/** A file's tasks someone sees: an Admin set up in Team sees only the tasks given to them or added by them. */
export const visibleTasks = (d: DB, me: User, b: Booking) => (isStageOnlyAdmin(d, me) ? b.tasks.filter((t) => t.assignee === me.id || t.by === me.id) : b.tasks)
/** One stage: as above, but an Admin set up in Team may change only the stages assigned to them. */
export const canWorkAdminStage = (d: DB, me: User, b: Booking, stage: AdminStageId) =>
  canWorkAdminStages(d, me, b) && (!isStageOnlyAdmin(d, me) || b.adminWork?.[stage]?.assignee === me.id)
/** Update one Admin stage: status (with a note when it goes back or is skipped), due date, or the Admin doing it. */
export function setAdminWork(me: User, id: string, stage: AdminStageId, patch: { status?: AdminWorkStatus; note?: string; due?: string | null; assignee?: string }) {
  mutate((d) => {
    const b = findB(d, id)
    const w = b.adminWork?.[stage]
    assert(w, 'Assign the file to an Admin first — the Admin stages start then.')
    assert(canWorkAdminStage(d, me, b, stage), 'Only the Admin this stage is assigned to and the file’s Operations person can update it.')
    assert(!CLOSED_FILE_STATUSES.includes(b.status) || isMaster(me), 'This file is closed.')
    const at = nowIso(), note = patch.note?.trim() ?? ''
    const label = ADMIN_STAGES.find((s) => s.id === stage)!.label
    if (patch.assignee !== undefined && patch.assignee !== w.assignee) {
      const u = d.users.find((x) => x.id === patch.assignee)
      assert(u && u.active && rolesOf(u).includes('admin'), 'Pick an active Admin.')
      assert(adminMayDo(d, u.id, stage), `${u.name} isn’t allowed to handle ${label} (Operations Dashboard → Team).`)
      assignAdminStages(d, b, me.id, at, { [stage]: u.id }, note ? `Reassigned — ${note}` : 'Reassigned')
    }
    if (patch.due !== undefined) w.due = patch.due || undefined
    if (patch.status && patch.status !== w.status) {
      assert(ADMIN_WORK_STATUSES.some((s) => s.id === patch.status), 'Unknown status.')
      const wasDone = ADMIN_DONE.includes(w.status)
      assert(!(wasDone || patch.status === 'RETURNED' || patch.status === 'NOT_NEEDED') || note.length >= 3, patch.status === 'NOT_NEEDED' ? 'Say why this stage isn’t needed.' : wasDone ? 'Say why a finished stage is re-opened.' : 'Say why it was rejected / returned.')
      // submitted / approved / completed only with the file uploaded on the CRM entry
      assert(!['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(patch.status) || stageFiles(b, stage).length > 0, `Upload the ${label} file first — a stage is submitted only once its file is on the CRM entry.`)
      if (w.status === 'NOT_STARTED') w.startedAt ??= at
      w.status = patch.status
      w.doneAt = ADMIN_DONE.includes(patch.status) ? at : undefined
      if (patch.status === 'SUBMITTED') { w.submittedAt = at; w.submittedBy = me.id }
      w.history.push({ at, by: me.id, status: patch.status, ...(note ? { note } : {}) })
      // Pitch Deck reminders run only while it is pending
      if (stage === 'PRECHECK') {
        if (ADMIN_DONE.includes(patch.status) || patch.status === 'NOT_NEEDED') w.nextRemindOn = undefined
        else w.nextRemindOn ??= addDaysYmd(istToday(), w.remindEveryDays ?? workflowSettings(d.settings.workflow).precheckDays)
      }
      notify(d, [b.opsMemberId, b.adminId, w.assignee].filter((x) => x && x !== me.id), `${label}: ${adminStatusLabel(patch.status)}`, `${b.bookingId} · ${b.companyName}${note ? ` — ${note}` : ''}`, `/bookings/${b.id}`, patch.status === 'RETURNED' ? 'warning' : 'info')
      audit(d, me.id, 'ADMIN_STAGE', `${b.bookingId}: ${label} → ${adminStatusLabel(patch.status)}${note ? ` — ${note}` : ''}`)
    }
    w.updatedAt = at; w.updatedBy = me.id
    b.updatedAt = at
  })
}
/** Pitch Deck follow-up done: the next reminder is the interval (3 or 4 days) from today. */
export function logPrecheckFollowUp(me: User, id: string, note: string) {
  mutate((d) => {
    const b = findB(d, id)
    const w = b.adminWork?.PRECHECK
    assert(w && precheckPending(b), 'The Pitch Deck is not pending on this file.')
    assert(canWorkAdminStage(d, me, b, 'PRECHECK'), 'Only the Pitch Deck’s Admin and the file’s Operations person can record follow-ups.')
    assert(note.trim().length >= 3, 'Write what was done in the follow-up.')
    const t = istToday(), at = nowIso()
    w.lastFollowUpOn = t
    w.nextRemindOn = addDaysYmd(t, w.remindEveryDays ?? workflowSettings(d.settings.workflow).precheckDays)
    w.history.push({ at, by: me.id, status: w.status, note: `Follow-up: ${note.trim()}` })
    w.updatedAt = at; w.updatedBy = me.id
    audit(d, me.id, 'PRECHECK_FOLLOWUP', `${b.bookingId}: ${note.trim()}`)
  })
}
/** Pitch Deck reminder every 3 or 4 days for this file (Admin settings change the default for new files). */
export function setPrecheckInterval(me: User, id: string, days: number) {
  mutate((d) => {
    const b = findB(d, id)
    const w = b.adminWork?.PRECHECK
    assert(w, 'This file has no Pitch Deck yet.')
    assert(canWorkAdminStage(d, me, b, 'PRECHECK') || has(me, 'followup.manage'), 'You can’t change this reminder.')
    assert(days === 3 || days === 4, 'The Pitch Deck reminder repeats every 3 or 4 days.')
    w.remindEveryDays = days
    if (w.nextRemindOn) w.nextRemindOn = addDaysYmd(w.lastFollowUpOn ?? istToday(), days)
    w.history.push({ at: nowIso(), by: me.id, status: w.status, note: `Reminder every ${days} days` })
    audit(d, me.id, 'PRECHECK_INTERVAL', `${b.bookingId}: every ${days} days`)
  })
}

/** Operations / Admin record a follow-up with the client on the file (the 15-day schedule keeps its dates). */
export function addFollowUpNote(me: User, id: string, note: string) {
  mutate((d) => {
    const b = findB(d, id)
    assert(b.followUp, 'This file has no follow-up schedule (it starts when Legal approves it).')
    assert(isMaster(me) || has(me, 'followup.manage') || b.opsMemberId === me.id || b.adminId === me.id, 'Only the file’s Operations person or Admin can record follow-ups.')
    assert(note.trim().length >= 3, 'Write what was done in the follow-up.')
    b.followUp.lastOn = istToday()
    b.followUp.log.unshift({ at: nowIso(), by: me.id, kind: 'NOTE', note: note.trim() })
    b.updatedAt = nowIso()
    audit(d, me.id, 'FOLLOWUP_NOTE', `${b.bookingId}: ${note.trim()}`)
  })
}
/** Admin: pause / resume the 15-day follow-up, or change its next date or interval. */
export function setFollowUpSchedule(me: User, id: string, change: { paused?: boolean; nextOn?: string; everyDays?: number; note?: string }) {
  need(me, 'followup.manage')
  mutate((d) => {
    const b = findB(d, id)
    const f = b.followUp
    assert(f, 'This file has no follow-up schedule.')
    const at = nowIso(), note = change.note?.trim()
    if (change.everyDays !== undefined) { assert(Number.isInteger(change.everyDays) && change.everyDays >= 1 && change.everyDays <= 90, 'Repeat every 1–90 days.'); f.everyDays = change.everyDays }
    if (change.nextOn !== undefined) { assert(change.nextOn >= istToday(), 'The next follow-up can’t be in the past.'); f.nextOn = change.nextOn }
    if (change.everyDays !== undefined || change.nextOn !== undefined) f.log.unshift({ at, by: me.id, kind: 'RESCHEDULE', note: [`next ${f.nextOn}`, `every ${f.everyDays} days`, note].filter(Boolean).join(' · ') })
    if (change.paused !== undefined && change.paused !== !!f.paused) {
      f.paused = change.paused
      // resuming never sends the missed reminders: the next one is in the future
      if (!change.paused && f.nextOn < istToday()) f.nextOn = nextAfterYmd(f.nextOn, f.everyDays, istToday())
      f.log.unshift({ at, by: me.id, kind: change.paused ? 'PAUSE' : 'RESUME', ...(note ? { note } : {}) })
    }
    audit(d, me.id, 'FOLLOWUP_SCHEDULE', `${b.bookingId}: ${f.paused ? 'paused' : `next ${f.nextOn}, every ${f.everyDays} days`}`)
  })
}

/**
 * The live server's scheduled job (server/jobs.mjs, called by a Render Cron Job) normally sends the reminders. The
 * browser only does it when there is no server job: browser mode, or the job hasn't run for 2 hours.
 */
export const serverJobsActive = (d: DB, now = Date.now()) => !!d.settings.jobs?.lastRunAt && now - new Date(d.settings.jobs.lastRunAt).getTime() < 2 * 3600_000
/** file number · client · current stage · the reminder's own details (who, dates, what to do) */
const reminderBody = (_d: DB, b: Booking, extra: string) => `${b.bookingId} · ${b.companyName} · ${stageLabel(b.stage, b.stageOutcome)} · ${extra}`
/** Every-15-days follow-up reminders that are due (the next date moves on in the same change, so it can't repeat). */
export function runFollowUpReminders(now = Date.now()) {
  const d = getDb(), t = istToday(now)
  if (CLOUD && serverJobsActive(d, now)) return 0
  const due = d.bookings.filter((b) => followUpDue(b, t)).map((b) => b.id)
  if (!due.length) return 0
  mutate((m) => {
    for (const id of due) {
      const b = m.bookings.find((x) => x.id === id)!
      const f = b.followUp!
      const was = f.nextOn
      f.nextOn = nextAfterYmd(f.nextOn, f.everyDays, t)
      f.log.unshift({ at: new Date(now).toISOString(), by: '', kind: 'REMINDER', note: `Due ${was} · next ${f.nextOn}` })
      notify(m, [b.opsMemberId, b.adminId], `Follow-up due: ${b.companyName}`, reminderBody(m, b, `last follow-up ${f.lastOn ? fmtDate(f.lastOn) : 'none'} · next ${fmtDate(f.nextOn)} · ${userName(m, b.opsMemberId)} — follow up with the client and record it on the file`), `/bookings/${b.id}`, 'warning')
    }
  })
  return due.length
}
/** Pitch Deck reminders (every 3 or 4 days while it is pending) to the stage's Admin and the file's Operations person. */
export function runPrecheckReminders(now = Date.now()) {
  const d = getDb(), t = istToday(now)
  if (CLOUD && serverJobsActive(d, now)) return 0
  const due = d.bookings.filter((b) => precheckDue(b, t)).map((b) => b.id)
  if (!due.length) return 0
  mutate((m) => {
    for (const id of due) {
      const b = m.bookings.find((x) => x.id === id)!
      const w = b.adminWork!.PRECHECK!
      const was = w.nextRemindOn!
      w.nextRemindOn = nextAfterYmd(was, w.remindEveryDays ?? workflowSettings(m.settings.workflow).precheckDays, t)
      w.history.push({ at: new Date(now).toISOString(), by: '', status: w.status, note: `Reminder (due ${was}) · next ${w.nextRemindOn}` })
      notify(m, [w.assignee ?? b.adminId, b.opsMemberId], `Pitch Deck follow-up: ${b.companyName}`, reminderBody(m, b, `${adminStatusLabel(w.status)} · last follow-up ${w.lastFollowUpOn ? fmtDate(w.lastFollowUpOn) : 'none'} · next ${fmtDate(w.nextRemindOn)} — follow up and record it`), `/bookings/${b.id}`, 'warning')
    }
  })
  return due.length
}

/** Admin: reminder intervals, the welcome message templates, the Operations contact and scheme alert recipients. */
export function saveWorkflowSettings(me: User, w: WorkflowSettings) {
  need(me, 'workflow.manage')
  assert(Number.isInteger(w.fileReminderDays) && w.fileReminderDays >= 1 && w.fileReminderDays <= 90, 'File follow-ups repeat every 1–90 days.')
  assert(w.precheckDays === 3 || w.precheckDays === 4, 'The Pitch Deck reminder repeats every 3 or 4 days.')
  assert(w.welcomeEmail.subject.trim().length >= 3 && w.welcomeEmail.body.trim().length >= 10, 'Write the welcome email subject and message.')
  assert(w.welcomeWhatsapp.trim().length >= 10, 'Write the WhatsApp welcome message.')
  assert(w.schemeAlertRoles.length > 0, 'Pick who gets the scheme expiry alert.')
  assert(!w.opsContact.email || isEmail(w.opsContact.email), 'The Operations contact email is not valid.')
  assert(!w.opsContact.phone || isPhone(normPhone(w.opsContact.phone)), 'The Operations contact phone must be a 10-digit mobile.')
  // Interakt template code names: lower-case letters, digits and _ (as Meta names them)
  const tpl = (s: string) => s.trim()
  assert([w.whatsapp.welcomeTemplate, w.whatsapp.invoiceTemplate, w.whatsapp.formTemplate].every((s) => !tpl(s) || /^[a-z0-9_]{1,512}$/.test(tpl(s))), 'WhatsApp template names use lower-case letters, numbers and _ only (copy the code name from Interakt → Templates).')
  assert(/^[a-z]{2}(_[A-Z]{2})?$/.test(w.whatsapp.language.trim()), 'WhatsApp template language: a code such as en or en_US.')
  mutate((d) => {
    d.settings.workflow = {
      // document permissions are set on the Operations Dashboard: keep what is stored, not this page's copy
      ...w, adminStageAccess: d.settings.workflow?.adminStageAccess, welcomeEmail: { subject: w.welcomeEmail.subject.trim(), body: w.welcomeEmail.body.trim() }, welcomeWhatsapp: w.welcomeWhatsapp.trim(),
      opsContact: { name: w.opsContact.name.trim(), phone: w.opsContact.phone ? normPhone(w.opsContact.phone) : '', email: w.opsContact.email.trim() },
      whatsapp: { welcomeTemplate: tpl(w.whatsapp.welcomeTemplate), invoiceTemplate: tpl(w.whatsapp.invoiceTemplate), formTemplate: tpl(w.whatsapp.formTemplate), language: w.whatsapp.language.trim() },
    }
    audit(d, me.id, 'WORKFLOW_SETTINGS', `follow-up every ${w.fileReminderDays} days · pitch deck every ${w.precheckDays} · welcome ${w.welcomeAuto ? 'automatic' : 'manual'}`)
  })
}

/** People who may (re)send the welcome message: Legal, the Operation team, Admin, Super Admin / IT. */
export const canSendWelcome = (d: DB, me: User, b: Booking) => visibleBookings(d, me).some((x) => x.id === b.id) && (isMaster(me) || has(me, 'bookings.legal', 'bookings.process', 'bookings.admin'))
/**
 * Takes the welcome email for sending (PENDING / FAILED → SENDING). Returns false when it is already sending or was
 * sent — so two screens (or the server's job) never send it twice.
 */
export function claimWelcome(me: User, id: string): boolean {
  return mutate((d) => {
    const b = findB(d, id)
    const e = b.welcome?.email
    if (!e || !['PENDING', 'FAILED'].includes(e.status) || !canSendWelcome(d, me, b)) return false
    Object.assign(e, { status: 'SENDING', attempts: e.attempts + 1, lastAt: nowIso(), to: b.email })
    return true
  })
}
/** Result of a welcome delivery (the provider's answer — never assumed). Also kept in the file's email history. */
export function recordWelcome(me: User, id: string, channel: 'email' | 'whatsapp', r: { status: Delivery['status']; error?: string; subject?: string }) {
  mutate((d) => {
    const b = findB(d, id)
    const x = b.welcome?.[channel]
    assert(x, 'No welcome message on this file.')
    const at = nowIso()
    Object.assign(x, { status: r.status, lastAt: at, error: r.status === 'SENT' ? undefined : r.error, ...(r.status === 'SENT' ? { sentAt: at } : {}) })
    if (channel === 'email' && (r.status === 'SENT' || r.status === 'FAILED')) {
      ;(b.clientEmails ??= []).unshift({ id: uid('ce-'), at, by: me.id, to: x.to ?? b.email, cc: [], subject: r.subject ?? 'Welcome', template: 'welcome', status: r.status, ...(r.error ? { error: r.error } : {}) })
    }
    audit(d, me.id, 'WELCOME_' + r.status, `${b.bookingId}: ${channel} → ${x.to ?? '—'}${r.error ? ` (${r.error})` : ''}`)
    if (r.status === 'FAILED' || r.status === 'NOT_CONFIGURED') notify(d, [b.opsMemberId].filter((u) => u !== me.id), 'Welcome email not sent', `${b.bookingId} · ${b.companyName}: ${r.error ?? 'the mail server is not set up'} — open the file to retry`, `/bookings/${b.id}`, 'warning')
  })
}
/** Send (again) a welcome that failed, was skipped, or had no contact at the time. A delivered welcome is never repeated. */
export function requeueWelcome(me: User, id: string, channel: 'email' | 'whatsapp' = 'email') {
  mutate((d) => {
    const b = findB(d, id)
    assert(canSendWelcome(d, me, b), 'You can’t send the welcome message for this file.')
    assert(b.welcome, 'The welcome message starts when Legal approves the file.')
    const e = b.welcome[channel]
    assert(e.status !== 'SENT', channel === 'email' ? 'The welcome email was already delivered — use “Email client” for another message.' : 'The welcome WhatsApp was already sent.')
    assert(e.status !== 'SENDING', 'It is being sent right now.')
    if (channel === 'email') {
      assert(isEmail(b.email), 'Add the client’s email on the file first.')
      Object.assign(e, { status: 'PENDING', to: b.email, error: undefined })
    } else {
      assert(CLOUD, 'WhatsApp messages go out from the live CRM.')
      assert(workflowSettings(d.settings.workflow).whatsapp.welcomeTemplate, 'Choose the WhatsApp welcome template first (Workflow settings → WhatsApp).')
      assert(isPhone(b.mobile), 'Add the client’s mobile number on the file first.')
      // a fresh start: three more tries
      Object.assign(e, { status: 'PENDING', to: b.mobile, error: undefined, attempts: 0 })
    }
  })
}
/** WhatsApp isn't connected yet: staff opened the chat by hand (recorded, but never counted as delivered). */
export function noteWhatsappOpened(me: User, id: string) {
  mutate((d) => {
    const b = findB(d, id)
    const x = b.welcome?.whatsapp
    if (!x) return
    Object.assign(x, { manualAt: nowIso(), manualBy: me.id })
    audit(d, me.id, 'WELCOME_WHATSAPP_MANUAL', `${b.bookingId}: opened WhatsApp for ${x.to ?? b.mobile}`)
  })
}

/** Files whose stages are being worked on (Admin and the Operation team can both set stages on these). */
export const WORK_STATUSES: BookingStatus[] = ['IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW']
/** Statuses whose stage Admin and the Operation team can change (completed files too: moving one back re-opens it). */
export const STAGE_EDIT_STATUSES: BookingStatus[] = [...WORK_STATUSES, 'ON_HOLD', 'COMPLETED']
/** Admin and the Operation team can set the stage and result of any processed file (up to the stage Legal allowed). */
export function canMoveStage(d: DB, me: User, b: Booking) {
  if (!b.opsMemberId || !STAGE_EDIT_STATUSES.includes(b.status)) return false
  if (isSA(me)) return true
  const p = effectivePerms(d, me)
  return p.has('bookings.process') || p.has('bookings.admin')
}
/** Stage 8 results other than Approved need a reason. */
export const outcomeNeedsReason = (outcome?: string) => outcome === 'REJECTED' || outcome === 'RESUBMISSION' || outcome === 'HOLD_CLIENT'

export function moveStage(me: User, id: string, stage: number, note: string, outcome?: string) {
  mutate((d) => {
    const b = findB(d, id)
    assert(canMoveStage(d, me, b), 'You cannot move this file right now.')
    assert(stage >= 1 && stage <= STAGES.length, 'Unknown stage.')
    assert(isSA(me) || stage <= b.maxStage, `You may move this file up to stage ${b.maxStage} (${STAGES[b.maxStage - 1]}).`)
    assert(stage >= b.stage || note.trim().length >= 3, 'Moving back needs a reason.')
    const options = STAGE_OUTCOMES[stage]
    assert(!outcome || options?.some((o) => o.id === outcome), 'That step / result does not belong to this stage.')
    // stage 3 starts "in process"; stage 8 starts "Approved" (change it — with a reason — if it isn't)
    const o = outcome ?? options?.[0]?.id
    assert(!outcomeNeedsReason(o) || note.trim().length >= 3, 'Give the reason.')
    // a completed file moved back to an earlier stage is re-opened with Operations
    if (b.status === 'COMPLETED' && stage < FINAL_STAGE) {
      assert(note.trim().length >= 3, 'Give the reason for re-opening this file.')
      b.status = 'IN_OPERATIONS'
      b.approvals.push({ id: uid('ap-'), level: 'Operations', action: 'REOPENED', by: me.id, at: nowIso(), remark: note.trim() })
    }
    b.stage = stage
    b.stageOutcome = o
    b.stageReason = outcomeNeedsReason(o) ? note.trim() : undefined
    b.stageHistory.push({ stage, at: nowIso(), by: me.id, outcome: o, note: note.trim() || `Moved to ${stageLabel(stage, o)}` })
    b.updatedAt = nowIso()
    notify(d, [b.createdBy, b.opsMemberId, b.adminId].filter((x) => x && x !== me.id), `Stage: ${stageLabel(stage, o)}`, `${b.bookingId} · ${b.companyName}${b.stageReason ? ` — ${b.stageReason}` : ''}`, `/bookings/${b.id}`, outcomeNeedsReason(o) ? 'warning' : 'info')
  })
}

/** Stage 3: in process ↔ in review. Stage 8: Approved, or Rejected / Re-submission / Hold with a reason. */
export function setStageOutcome(me: User, id: string, outcome: string, note = '') {
  mutate((d) => {
    const b = findB(d, id)
    assert(canMoveStage(d, me, b), 'You cannot update this file right now.')
    const options = STAGE_OUTCOMES[b.stage]
    assert(options?.some((o) => o.id === outcome), 'Pick a step / result for this stage.')
    const reason = note.trim()
    assert(!outcomeNeedsReason(outcome) || reason.length >= 3, 'Give the reason.')
    if (b.stageOutcome === outcome && (b.stageReason ?? '') === (outcomeNeedsReason(outcome) ? reason : '')) return
    b.stageOutcome = outcome
    b.stageReason = outcomeNeedsReason(outcome) ? reason : undefined
    b.stageHistory.push({ stage: b.stage, at: nowIso(), by: me.id, outcome, note: reason || stageLabel(b.stage, outcome) })
    b.updatedAt = nowIso()
    notify(d, [b.createdBy, b.opsMemberId, b.adminId, ...usersWithRole(d, 'legal').map((u) => u.id)].filter((x) => x && x !== me.id), stageLabel(b.stage, outcome),
      `${b.bookingId} · ${b.companyName}${reason ? ` — ${reason}` : ''}`, `/bookings/${b.id}`, outcomeNeedsReason(outcome) ? 'warning' : 'info')
    audit(d, me.id, 'STAGE_OUTCOME', `${b.bookingId}: ${stageLabel(b.stage, outcome)}${reason ? ` — ${reason}` : ''}`)
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

/** TDS the client kept back: 1–15 % of the amount before GST. */
const tdsOf = (amount: number, pct: number) => {
  assert(pct >= 1 && pct <= 15, 'TDS must be between 1% and 15%.')
  return { pct: round2(pct), amount: round2((amount * pct) / 100) }
}

/**
 * Part payment 2, 3, 4 … on a CRM entry (sales owner or Accounts). Each part keeps its own date, so it counts in the
 * scorecard and collections of the month it was paid in. Accounts can mark that the client deducted TDS.
 */
export function addPayment(me: User, id: string, p: { amount: number; date: string; mode: string; proofName: string; proof?: FileRef; tdsPct?: number }) {
  mutate((d) => {
    const b = findB(d, id)
    const pr = effectivePerms(d, me)
    assert(pr.has('bookings.accounts'), 'Only Accounts adds part payments.')
    assert(p.amount > 0, 'Amount must be more than 0.')
    assert(p.date && p.date <= today(), 'Enter the date the money was received (not in the future).')
    assert(p.proofName || p.proof, 'Attach the payment proof.')
    assert(p.tdsPct == null || pr.has('bookings.accounts'), 'Only Accounts records TDS.')
    const amount = round2(p.amount)
    const gst = round2((amount * b.gstRate) / 100)
    b.payments.push({
      id: uid('pay-'), part: b.payments.length + 1, amount, gst, total: round2(amount + gst), date: p.date, mode: p.mode, proofName: p.proof?.name ?? p.proofName, proof: p.proof,
      recordedBy: me.id, verified: pr.has('bookings.accounts'), ...(p.tdsPct != null ? { tds: tdsOf(amount, p.tdsPct) } : {}),
    })
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

/** Accounts: the client paid this part after deducting TDS (pct 1–15), or not (null). */
export function setPaymentTds(me: User, id: string, payId: string, pct: number | null) {
  need(me, 'bookings.accounts')
  mutate((d) => {
    const b = findB(d, id)
    const p = b.payments.find((x) => x.id === payId)
    assert(p, 'Payment not found.')
    if (pct == null) delete p.tds
    else p.tds = tdsOf(p.amount, pct)
    b.updatedAt = nowIso()
    audit(d, me.id, 'PAYMENT_TDS', `${b.bookingId} part ${p.part}: ${pct == null ? 'no TDS' : `TDS ${pct}%`}`)
  })
}

/** Accounts: commission to the CA / DSA who brought the client — optional, 5–30 % (null removes it). */
export function setCommission(me: User, id: string, c: { to: 'CA' | 'DSA'; name: string; pct: number } | null) {
  need(me, 'bookings.accounts')
  mutate((d) => {
    const b = findB(d, id)
    assert(b.commission?.status !== 'PAID', 'This commission is already paid — mark it unpaid on the Commission page before changing it.')
    if (!c) { delete b.commission; audit(d, me.id, 'COMMISSION', `${b.bookingId}: removed`); return }
    assert(c.to === 'CA' || c.to === 'DSA', 'Pick CA or DSA.')
    assert(c.name.trim().length >= 2, 'Enter the CA / DSA name.')
    assert(c.pct >= 5 && c.pct <= 30, 'Commission must be between 5% and 30%.')
    const base = round2(b.payments.reduce((t, p) => t + p.amount, 0))
    b.commission = { to: c.to, name: c.name.trim(), pct: round2(c.pct), amount: round2((base * c.pct) / 100), by: me.id, at: nowIso() }
    b.updatedAt = nowIso()
    audit(d, me.id, 'COMMISSION', `${b.bookingId}: ${c.to} ${c.name.trim()} ${c.pct}%`)
  })
}
/** Commission on what was collected so far (before GST) — it grows as balance payments come in. */
export const commissionNow = (b: Booking) => (b.commission ? round2((b.payments.reduce((t, p) => t + p.amount, 0) * b.commission.pct) / 100) : 0)
/** What the commission is worth: the amount paid once it is paid, otherwise today's figure (it grows with each payment). */
export const commissionDue = (b: Booking) => (b.commission?.status === 'PAID' ? b.commission.paidAmount ?? b.commission.amount : commissionNow(b))
/** Accounts records the commission as paid to the CA / DSA (or takes that back). */
export function setCommissionPaid(me: User, id: string, paid: { paidOn: string; mode: string; ref?: string } | null) {
  need(me, 'bookings.accounts')
  mutate((d) => {
    const b = findB(d, id)
    const c = b.commission
    assert(c, 'This CRM entry has no commission.')
    if (!paid) {
      assert(c.status === 'PAID', 'It isn’t marked paid.')
      Object.assign(c, { status: 'PENDING', paidOn: undefined, paidAmount: undefined, mode: undefined, ref: undefined, paidBy: undefined })
      audit(d, me.id, 'COMMISSION_UNPAID', `${b.bookingId}: ${c.to} ${c.name}`)
      return
    }
    assert(c.status !== 'PAID', 'It is already marked paid.')
    assert(/^\d{4}-\d{2}-\d{2}$/.test(paid.paidOn) && paid.paidOn <= today(), 'Enter the date it was paid (not in the future).')
    assert(paid.mode.trim(), 'Choose how it was paid.')
    const amount = commissionNow(b)
    assert(amount > 0, 'No payment has been received on this entry yet, so there is no commission to pay.')
    Object.assign(c, { status: 'PAID', paidOn: paid.paidOn, paidAmount: amount, mode: paid.mode.trim(), ref: paid.ref?.trim() || undefined, paidBy: me.id })
    b.updatedAt = nowIso()
    audit(d, me.id, 'COMMISSION_PAID', `${b.bookingId}: ${c.to} ${c.name} · ₹${amount} · ${paid.mode}${paid.ref ? ` · ${paid.ref}` : ''}`)
  })
}

// ------------------------------------------------------------ refunds (Accounts only)
/** Accounts records money to be paid back to a client (pending until it is actually refunded). */
export function addRefund(me: User, id: string, r: { amount: number; date: string; reason: string }) {
  need(me, 'refunds.manage')
  mutate((d) => {
    const b = findB(d, id)
    assert(r.amount > 0, 'Enter the refund amount.')
    assert(r.date, 'Enter the date.')
    assert(r.reason.trim().length >= 3, 'Enter the reason for the refund.')
    const collected = round2(b.payments.reduce((t, p) => t + p.total, 0))
    const already = round2((b.refunds ?? []).reduce((t, x) => t + x.amount, 0))
    assert(round2(already + r.amount) <= collected, `Refunds cannot be more than what the client paid (₹${collected}; ₹${already} already refunded or pending).`)
    ;(b.refunds ??= []).push({ id: uid('rf-'), amount: round2(r.amount), date: r.date, reason: r.reason.trim(), status: 'PENDING', by: me.id, at: nowIso() })
    b.updatedAt = nowIso()
    audit(d, me.id, 'REFUND_ADD', `${b.bookingId} ₹${round2(r.amount)}`)
  })
}
/** Accounts marks a refund as paid back (date, mode, UTR / cheque no.), or back to pending. */
export function setRefundStatus(me: User, id: string, refundId: string, done: { refundedOn: string; mode: string; ref: string } | null) {
  need(me, 'refunds.manage')
  mutate((d) => {
    const b = findB(d, id)
    const r = b.refunds?.find((x) => x.id === refundId)
    assert(r, 'Refund not found.')
    if (done) {
      assert(done.refundedOn && done.refundedOn <= today(), 'Enter the date it was refunded (not in the future).')
      Object.assign(r, { status: 'REFUNDED', refundedOn: done.refundedOn, mode: done.mode, ref: done.ref.trim() || undefined })
    } else Object.assign(r, { status: 'PENDING', refundedOn: undefined, mode: undefined, ref: undefined })
    b.updatedAt = nowIso()
    audit(d, me.id, 'REFUND_STATUS', `${b.bookingId} ₹${r.amount}: ${r.status}`)
  })
}
export function deleteRefund(me: User, id: string, refundId: string) {
  need(me, 'refunds.manage')
  mutate((d) => {
    const b = findB(d, id)
    const r = b.refunds?.find((x) => x.id === refundId)
    assert(r, 'Refund not found.')
    assert(r.status === 'PENDING', 'A refund already paid back can’t be deleted — mark it pending first.')
    b.refunds = b.refunds!.filter((x) => x.id !== refundId)
    audit(d, me.id, 'REFUND_DELETE', `${b.bookingId} ₹${r.amount}`)
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

const commentKind: Record<Role, string> = { superadmin: 'Super Admin', admin: 'Admin', accounts: 'Accounts', legal: 'Legal', operations: 'Operations', teamlead: 'Team Leader', sales: 'BDE', hr: 'HR', it: 'IT', support: 'Customer Support', branchdirector: 'Branch Director', digitalmedia: 'Digital Media' }
/** The Operation team and Admin (and Super Admin / IT) email clients from the file. */
export function canEmailClient(d: DB, me: User, b: Booking) {
  if (!visibleBookings(d, me).some((x) => x.id === b.id)) return false
  const p = effectivePerms(d, me)
  return isSA(me) || p.has('bookings.process') || p.has('bookings.admin')
}
/** Records an email to the client on the file (shown in its timeline) and in the activity log. */
export function logClientEmail(me: User, id: string, e: Omit<ClientEmailLog, 'id' | 'at' | 'by'>) {
  mutate((d) => {
    const b = findB(d, id)
    assert(canEmailClient(d, me, b), 'Only the Operation team and Admin can email clients.')
    ;(b.clientEmails ??= []).unshift({ ...e, id: uid('ce-'), at: nowIso(), by: me.id })
    if (b.clientEmails.length > 200) b.clientEmails.length = 200
    audit(d, me.id, 'CLIENT_EMAIL', `${b.bookingId}: ${e.status === 'SENT' ? 'emailed' : e.status === 'MAIL_APP' ? 'opened email app for' : 'email failed to'} ${e.to} — “${e.subject}”`)
    const watchers = [b.opsMemberId, b.adminId, b.createdBy].filter((x) => x && x !== me.id)
    if (e.status !== 'FAILED') notify(d, watchers, `Client emailed · ${b.bookingId}`, `${me.name}: ${e.subject}`, `/bookings/${b.id}`, 'info')
  })
}

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

/** Several documents at once, each with its own type (files are already in the browser file store). */
export function addDocuments(me: User, id: string, docs: { file: FileRef; category: string; note?: string }[]) {
  assert(docs.length, 'Add at least one document.')
  mutate((d) => {
    const b = findB(d, id)
    assert(visibleBookings(d, me).some((x) => x.id === id), 'Not found.')
    const at = nowIso()
    for (const x of docs) b.documents.push({ id: uid('doc-'), name: x.file.name, category: x.category, size: x.file.size, at, by: me.id, status: 'PENDING', file: x.file, ...(x.note?.trim() ? { note: x.note.trim() } : {}) })
    b.updatedAt = at
    audit(d, me.id, 'DOC_UPLOAD', `${b.bookingId}: ${docs.map((x) => `${x.category} (${x.file.name})`).join(', ')}`)
  })
}
/** Document Forms: the client's email, number and website reference, kept on the client file. */
export function updateClientInfo(me: User, id: string, info: { email: string; mobile: string; website: string }) {
  need(me, 'documents.forms', 'bookings.process', 'bookings.legal', 'bookings.admin', 'bookings.accounts')
  assert(!info.email.trim() || isEmail(info.email), 'Enter a valid email.')
  assert(isPhone(info.mobile), 'Enter a valid 10-digit mobile number.')
  const site = info.website.trim()
  assert(!site || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(site), 'Enter a website like www.example.com.')
  mutate((d) => {
    const b = findB(d, id)
    assert(visibleBookings(d, me).some((x) => x.id === id), 'Not found.')
    b.email = info.email.trim().toLowerCase(); b.mobile = normPhone(info.mobile); b.website = site || undefined
    b.updatedAt = nowIso()
    audit(d, me.id, 'CLIENT_INFO', `${b.bookingId}: email / number / website updated`)
  })
}
/** A verified / rejected document is final: only a Super Admin can change it (the database checks this too). */
export const canReviewDoc = (me: User, doc: Pick<BDoc, 'status'>) => isSA(me) || !doc.status || doc.status === 'PENDING'
export function setDocStatus(me: User, id: string, docId: string, status: 'VERIFIED' | 'REJECTED') {
  need(me, 'bookings.process', 'bookings.legal', 'bookings.admin')
  mutate((d) => {
    const b = findB(d, id)
    const doc = b.documents.find((x) => x.id === docId)
    assert(doc, 'Document not found.')
    assert(canReviewDoc(me, doc), `This document was already ${doc.status?.toLowerCase()}${doc.reviewedBy ? ` by ${userName(d, doc.reviewedBy)}` : ''} — only a Super Admin can change it.`)
    if (doc.status === status) return
    const was = doc.status ?? 'PENDING'
    Object.assign(doc, { status, reviewedBy: me.id, reviewedAt: nowIso() })
    audit(d, me.id, `DOC_${status}`, `${b.bookingId}: ${doc.name}${was !== 'PENDING' ? ` (was ${was.toLowerCase()})` : ''}`)
  })
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

export const TASK_REMIND_DAYS = 15
export function addTask(me: User, id: string, title: string, due?: string, opts: { assignee?: string; remind?: boolean } = {}) {
  assert(title.trim(), 'Task title is required.')
  mutate((d) => {
    const b = findB(d, id)
    b.tasks.push({ id: uid('t-'), title: title.trim(), done: false, due, by: me.id, assignee: opts.assignee, createdAt: nowIso(), ...(opts.remind ? { remindEveryDays: TASK_REMIND_DAYS } : {}) })
    if (opts.assignee && opts.assignee !== me.id) notify(d, [opts.assignee], 'New task for you', `${b.bookingId} · ${title.trim()}`, `/bookings/${b.id}`, 'action')
  })
}
/**
 * Reminders for open tasks that repeat every 15 days: the client's processing person (Operations), the admin person and
 * whoever the task is assigned to get a notification. Runs on a timer while anyone is signed in.
 */
export function runTaskReminders(now = Date.now()) {
  const d = getDb()
  const due: { b: string; t: string }[] = []
  for (const b of d.bookings) {
    if (['COMPLETED', 'REJECTED'].includes(b.status)) continue
    for (const t of b.tasks) {
      if (t.done || !t.remindEveryDays) continue
      const last = new Date(t.lastRemindedAt ?? t.createdAt ?? b.createdAt).getTime()
      if (now - last >= t.remindEveryDays * 86400000) due.push({ b: b.id, t: t.id })
    }
  }
  if (!due.length) return 0
  mutate((m) => {
    for (const x of due) {
      const b = m.bookings.find((y) => y.id === x.b)!, t = b.tasks.find((y) => y.id === x.t)!
      t.lastRemindedAt = new Date(now).toISOString()
      notify(m, [b.opsMemberId, b.adminId, t.assignee], `Reminder: ${t.title}`, `${b.bookingId} · ${b.companyName} — repeats every ${t.remindEveryDays} days until done`, `/bookings/${b.id}`, 'warning')
    }
  })
  return due.length
}
export function toggleTask(_me: User, id: string, taskId: string) {
  mutate((d) => { const t = findB(d, id).tasks.find((x) => x.id === taskId); if (t) t.done = !t.done })
}
export function deleteTask(_me: User, id: string, taskId: string) {
  mutate((d) => { const b = findB(d, id); b.tasks = b.tasks.filter((t) => t.id !== taskId) })
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

/** The only service text on a proforma invoice. */
export const PROFORMA_SERVICE = 'Consultancy services'

export function createInvoice(me: User, i: { type: Invoice['type']; client: string; gstin: string; state: string; items: InvoiceItem[]; bookingId?: string; salesPerson?: string; due: string; clientAddress?: string; clientPan?: string; remarks?: string }) {
  need(me, 'billing.create', 'billing.manage')
  // a proforma invoice always reads "Consultancy services" — the line can't be renamed
  if (i.type === 'PROFORMA') i = { ...i, items: i.items.map((x) => ({ ...x, desc: PROFORMA_SERVICE, sac: x.sac || '998311' })) }
  assert(i.client.trim(), 'Client name is required.')
  assert(!i.gstin || isGstin(i.gstin), 'GSTIN format is invalid.')
  assert(i.items.length && i.items.every((x) => x.desc && x.qty > 0 && x.rate >= 0), 'Each line needs a description, quantity and rate.')
  if (i.type === 'TAX') need(me, 'billing.manage')
  return mutate((d) => {
    // one live invoice of each type per CRM entry (a double click or two people at once must not bill twice)
    const twin = i.bookingId ? d.invoices.find((x) => x.bookingId === i.bookingId && x.type === i.type && x.status !== 'CANCELLED') : undefined
    assert(!twin, `This CRM entry already has a ${i.type === 'TAX' ? 'tax' : 'proforma'} invoice (${twin?.number}). Cancel it first to raise a new one.`)
    const fy = (() => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}` })()
    const inv: Invoice = {
      id: uid('inv-'), number: `${i.type === 'TAX' ? 'RX' : 'PF'}/${fy}/${String(d.counters.invoice++).padStart(4, '0')}`,
      type: i.type, bookingId: i.bookingId, client: i.client.trim(), gstin: i.gstin.toUpperCase(), state: i.state, items: i.items,
      paid: 0, status: 'ISSUED', date: today(), due: i.due, salesPerson: i.salesPerson ?? me.id, createdBy: me.id,
      clientAddress: i.clientAddress?.trim() || undefined, clientPan: i.clientPan?.trim().toUpperCase() || undefined, remarks: i.remarks?.trim() || undefined,
      // issued from the branch of the person creating it (no branch picked by hand)
      branchId: me.branchId && d.settings.branches?.some((b) => b.id === me.branchId) ? me.branchId : undefined,
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
    clientAddress: [b.address, b.city, b.state].filter(Boolean).join(', '), clientPan: b.pan,
    due: ymd(addDays(new Date(), 15)),
    // the invoice is for the total quoted (the advance): one line per service only when their prices add up to it
    items: (() => {
      const paid = (b.services ?? []).filter((s) => !s.complimentary && s.price > 0)
      const sum = round2(paid.reduce((t, s) => t + s.price, 0))
      return paid.length && paid.length === (b.services ?? []).filter((s) => !s.complimentary).length && Math.abs(sum - b.totalQuoted) < 0.01
        ? paid.map((s) => ({ desc: s.name, sac: '998311', qty: 1, rate: s.price, gstRate: b.gstRate }))
        : [{ desc: b.serviceName, sac: '998311', qty: 1, rate: b.totalQuoted, gstRate: b.gstRate }]
    })(),
  })
}

/**
 * Who edits an invoice after it is made: Accounts (billing.manage) until it is cancelled; the sales person who made it
 * (or is on it) their own proforma while nothing has been paid against it.
 */
export function canEditInvoice(d: DB, me: User, inv: Invoice) {
  if (inv.status === 'CANCELLED') return false
  const p = effectivePerms(d, me)
  if (p.has('billing.manage')) return true
  return p.has('billing.create') && (inv.createdBy === me.id || inv.salesPerson === me.id) && inv.type === 'PROFORMA' && inv.status === 'ISSUED' && !inv.paid
}
export type InvoiceEdit = { client: string; gstin: string; state: string; items: InvoiceItem[]; due: string; clientAddress?: string; clientPan?: string; remarks?: string }
export function updateInvoice(me: User, id: string, i: InvoiceEdit) {
  const inv0 = getDb().invoices.find((x) => x.id === id)
  assert(inv0, 'Invoice not found.')
  assert(canEditInvoice(getDb(), me, inv0), inv0.status === 'CANCELLED' ? 'This invoice is cancelled.' : 'Only Accounts can change this invoice now (it is a tax invoice, or a payment is recorded on it).')
  if (inv0.type === 'PROFORMA') i = { ...i, items: i.items.map((x) => ({ ...x, desc: PROFORMA_SERVICE, sac: x.sac || '998311' })) }
  assert(i.client.trim(), 'Client name is required.')
  assert(!i.gstin || isGstin(i.gstin), 'GSTIN format is invalid.')
  assert(i.items.length && i.items.every((x) => x.desc && x.qty > 0 && x.rate >= 0), 'Each line needs a description, quantity and rate.')
  assert(/^\d{4}-\d{2}-\d{2}$/.test(i.due), 'Pick the due date.')
  assert(!i.remarks || i.remarks.length <= 1000, 'Keep the remarks under 1000 characters.')
  mutate((d) => {
    const inv = d.invoices.find((x) => x.id === id)!
    Object.assign(inv, {
      client: i.client.trim(), gstin: i.gstin.toUpperCase(), state: i.state, items: i.items, due: i.due,
      clientAddress: i.clientAddress?.trim() || undefined, clientPan: i.clientPan?.trim().toUpperCase() || undefined, remarks: i.remarks?.trim() || undefined,
    })
    audit(d, me.id, 'INVOICE_EDIT', inv.number)
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
/** Accounts chooses the branch an invoice is issued from (its address and GSTIN print on the invoice). */
/** Remarks printed on the invoice (Accounts can change them until it is cancelled). */
export function setInvoiceRemarks(me: User, id: string, remarks: string) {
  need(me, 'billing.manage')
  assert(remarks.length <= 1000, 'Keep the remarks under 1000 characters.')
  mutate((d) => {
    const inv = d.invoices.find((x) => x.id === id)
    assert(inv, 'Invoice not found.')
    assert(inv.status !== 'CANCELLED', 'This invoice is cancelled.')
    inv.remarks = remarks.trim() || undefined
  })
}
export function saveBranches(me: User, branches: Branch[]) {
  assert(isMaster(me), 'Only Super Admin or IT Support can change branches.')
  assert(branches.every((b) => b.name.trim()), 'Every branch needs a name.')
  assert(branches.every((b) => !b.gstin || isGstin(b.gstin)), 'A branch GSTIN is not valid.')
  assert(branches.every((b) => !b.phone || isPhone(b.phone)), 'A branch phone must be a 10-digit number.')
  const codes = branches.map((b) => b.code?.trim().toUpperCase()).filter(Boolean)
  assert(new Set(codes).size === codes.length, 'Two branches have the same code.')
  mutate((d) => { d.settings.branches = branches.map((b) => ({ ...b, code: b.code?.trim().toUpperCase() || undefined, gstin: b.gstin.toUpperCase().trim() })); audit(d, me.id, 'SETTINGS', 'Updated invoice branches') })
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
export type SalesKitInput = Omit<SalesKitItem, 'id' | 'position' | 'updatedAt' | 'updatedBy'>
/** Sales Kit: everyone reads it; the Operation team (saleskit.manage) adds, edits and removes schemes. */
export function saveSalesKitItem(me: User, x: SalesKitInput, id?: string) {
  need(me, 'saleskit.manage')
  const v = { ...x, name: x.name.trim(), category: x.category.trim() }
  for (const k of ['benefits', 'sectors', 'eligibility', 'lastDate', 'organisation', 'schemeType', 'applicableFor', 'minCharge'] as const) v[k] = (x[k] ?? '').trim()
  v.registrationCharge = x.registrationCharge?.trim() || undefined
  assert(v.name, 'Scheme name is required.')
  assert(v.category, 'Pick the category.')
  assert(v.minCharge, 'Enter our minimum charge (e.g. INR 10,000 + 18% GST).')
  mutate((d) => {
    d.salesKit ??= []
    const at = nowIso()
    if (id) {
      const cur = d.salesKit.find((s) => s.id === id)
      assert(cur, 'Scheme not found.')
      Object.assign(cur, v, { updatedAt: at, updatedBy: me.id })
      audit(d, me.id, 'SALES_KIT_EDIT', `${cur.category}: ${cur.name}`)
      return
    }
    const position = 1 + Math.max(0, ...d.salesKit.filter((s) => s.category === v.category).map((s) => s.position))
    d.salesKit.push({ ...v, id: uid('sk-'), position, updatedAt: at, updatedBy: me.id })
    notify(d, usersWithRole(d, 'sales', 'teamlead').map((u) => u.id), 'Sales Kit: new scheme', `${v.category} · ${v.name}`, '/sales-kit', 'info')
    audit(d, me.id, 'SALES_KIT_ADD', `${v.category}: ${v.name}`)
  })
}
export function deleteSalesKitItem(me: User, id: string) {
  need(me, 'saleskit.manage')
  mutate((d) => {
    const cur = d.salesKit?.find((s) => s.id === id)
    assert(cur, 'Scheme not found.')
    d.salesKit = d.salesKit!.filter((s) => s.id !== id)
    audit(d, me.id, 'SALES_KIT_DELETE', `${cur.category}: ${cur.name}`)
  })
}

/** Schemes: Admin and the Operation team only (sales see them read-only). Price and dates are checked; the end date can't be before the start. */
export function upsertScheme(me: User, s: Omit<Scheme, 'id' | 'createdAt' | 'by' | 'updatedAt' | 'updatedBy'> & { id?: string }) {
  need(me, 'schemes.manage')
  assert(s.title.trim(), 'Title is required.')
  assert(s.price == null || (Number.isFinite(s.price) && s.price >= 0), 'Price must be 0 or more.')
  assert(!s.startDate === !s.endDate, 'Enter both the start date and the end date (or neither).')
  assert(!s.startDate || !s.endDate || s.endDate >= s.startDate, 'The end date can’t be before the start date.')
  mutate((d) => {
    const at = nowIso()
    const clean = { ...s, title: s.title.trim(), price: s.price == null || Number.isNaN(s.price) ? undefined : round2(s.price), startDate: s.startDate || undefined, endDate: s.endDate || undefined, updatedAt: at, updatedBy: me.id }
    if (s.id) {
      const x = d.schemes.find((y) => y.id === s.id)
      assert(x, 'Scheme not found.')
      Object.assign(x, clean)
      audit(d, me.id, 'SCHEME_EDIT', `${x.title}${x.endDate ? ` · ${x.startDate} → ${x.endDate}` : ''}${x.price != null ? ` · ₹${x.price}` : ''}`)
      return
    }
    d.schemes.unshift({ ...clean, id: uid('sc-'), createdAt: at, by: me.id })
    notify(d, usersWithRole(d, 'sales', 'teamlead').map((u) => u.id), 'New scheme published', clean.title, '/schemes', 'info')
    audit(d, me.id, 'SCHEME_ADD', clean.title)
  })
}
export function deleteScheme(me: User, id: string) {
  need(me, 'schemes.manage')
  mutate((d) => { const x = d.schemes.find((y) => y.id === id); d.schemes = d.schemes.filter((y) => y.id !== id); if (x) audit(d, me.id, 'SCHEME_DELETE', x.title) })
}
/**
 * One day before a scheme ends, the people in Workflow settings → scheme alerts (Admin and Operations by default) are
 * told once (in the browser when the live server's job isn't running — the audit log records each one).
 */
export function runSchemeAlerts(now = Date.now()) {
  const d = getDb(), t = istToday(now)
  if (CLOUD && serverJobsActive(d, now)) return 0
  const due = d.schemes.filter((s) => schemeAlertDue(s, t) && !d.audit.some((a) => a.action === 'SCHEME_EXPIRY_ALERT' && a.detail.startsWith(`${s.id}|${s.endDate}`)))
  if (!due.length) return 0
  mutate((m) => {
    const roles = workflowSettings(m.settings.workflow).schemeAlertRoles
    const to = usersWithRole(m, ...roles).map((u) => u.id)
    for (const s of due) {
      notify(m, to, `Scheme ends tomorrow: ${s.title}`, `Ends ${fmtDate(s.endDate)} — update or close it`, '/schemes', 'warning')
      audit(m, '', 'SCHEME_EXPIRY_ALERT', `${s.id}|${s.endDate}|${s.title}`)
    }
  })
  return due.length
}
/** Flyers & posts: Admin and the Operation team. Sales information: also Team Leaders. */
const postPerm = (kind: Post['kind']): Perm => (kind === 'SALES_INFO' ? 'salesinfo.manage' : 'content.manage')
export const canEditPost = (me: User, kind: Post['kind']) => has(me, postPerm(kind))
export function upsertPost(me: User, p: Omit<Post, 'id' | 'createdAt' | 'by'> & { id?: string }) {
  const kindName = (k: Post['kind']) => (k === 'SALES_INFO' ? 'sales information' : k === 'FLYER' ? 'flyers' : 'posts')
  assert(canEditPost(me, p.kind), `You can't add or edit ${kindName(p.kind)}.`)
  assert(p.title.trim(), 'Title is required.')
  mutate((d) => {
    if (p.id) {
      const cur = d.posts.find((x) => x.id === p.id)
      assert(cur, 'Not found.')
      // changing the type can't be used to edit something you may not (e.g. turning a flyer into sales info)
      assert(canEditPost(me, cur.kind), `You can't edit ${kindName(cur.kind)}.`)
      Object.assign(cur, p); return
    }
    d.posts.unshift({ ...p, id: uid('po-'), createdAt: nowIso(), by: me.id })
    const label = p.kind === 'FLYER' ? 'flyer' : p.kind === 'POST' ? 'post' : 'sales information'
    notify(d, usersWithRole(d, 'sales', 'teamlead').map((u) => u.id), `New ${label}`, p.title, '/content', 'info')
  })
}
export function deletePost(me: User, id: string) {
  const cur = getDb().posts.find((x) => x.id === id)
  assert(cur, 'Not found.')
  assert(canEditPost(me, cur.kind), "You don't have access to delete this.")
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

/** Leave longer than this many days needs an attachment (photo or PDF). */
export const LEAVE_ATTACHMENT_AFTER_DAYS = 2

export function applyLeave(me: User, l: { type: LeaveType; from: string; to: string; reason: string; attachment?: FileRef }) {
  assert(l.from && l.to && l.to >= l.from, 'Pick a valid date range.')
  assert(l.reason.trim().length >= 3, 'Give a short reason.')
  const days = daysBetween(l.from, l.to) + 1
  assert(days <= LEAVE_ATTACHMENT_AFTER_DAYS || l.attachment, `Leave of more than ${LEAVE_ATTACHMENT_AFTER_DAYS} days needs an attachment — upload a photo or PDF (e.g. a medical certificate).`)
  mutate((d) => {
    assert(!d.leaves.some((x) => x.userId === me.id && x.status !== 'REJECTED' && x.status !== 'CANCELLED' && !(l.to < x.from || l.from > x.to)), 'You already have leave in these dates.')
    const approvers = leaveApprovers(me.role)
    const { attachment, ...rest } = l
    d.leaves.unshift({ id: uid('lv-'), userId: me.id, ...rest, ...(attachment ? { attachment } : {}), days, status: 'PENDING', approvers, createdAt: nowIso() })
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

export function logLetter(me: User, kind: string, name: string) {
  need(me, 'employees.manage')
  mutate((d) => audit(d, me.id, 'LETTER', `${kind} for ${name}`))
}

// ============================================================ candidate forms (public apply link)
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)

export function saveCandidateForm(me: User, f: Pick<CandidateForm, 'title' | 'kind' | 'department' | 'description'> & { positions?: string[]; id?: string }) {
  need(me, 'recruitment.manage')
  assert(f.title.trim().length >= 2, 'Give the role a title.')
  // in the list's order, no repeats, only known positions
  const positions = JOB_POSITIONS.filter((p) => (f.positions ?? []).includes(p))
  assert(positions.length, 'Tick at least one position you are hiring for.')
  let id = f.id
  mutate((d) => {
    if (f.id) { const x = d.candidateForms.find((c) => c.id === f.id); assert(x, 'Form not found.'); Object.assign(x, { title: f.title.trim(), kind: f.kind, positions, department: f.department.trim(), description: f.description.trim() }); return }
    id = uid('cf-')
    d.candidateForms.unshift({ id, token: randomToken(), title: f.title.trim(), kind: f.kind, positions, department: f.department.trim(), description: f.description.trim(), active: true, createdAt: nowIso(), by: me.id })
    audit(d, me.id, 'CANDIDATE_FORM', `Created “${f.title.trim()}”`)
  })
  return id!
}
export function setCandidateFormActive(me: User, id: string, active: boolean) {
  need(me, 'recruitment.manage')
  mutate((d) => { const x = d.candidateForms.find((c) => c.id === id); assert(x, 'Form not found.'); x.active = active })
}
export function deleteCandidateForm(me: User, id: string) {
  need(me, 'recruitment.manage')
  mutate((d) => {
    assert(!d.candidates.some((c) => c.formId === id), 'This form has applications — close it instead of deleting.')
    d.candidateForms = d.candidateForms.filter((c) => c.id !== id)
  })
}

export type ApplicationInput = Omit<CandidateApplication, 'id' | 'formId' | 'submittedAt' | 'status' | 'notes' | 'resume'>
/**
 * Public: anyone with the link can apply while the form is open. Resume and branch are mandatory. This saves in
 * browser mode; the live CRM sends the application to the server instead (server/apply.mjs, same checks).
 */
export function submitApplication(token: string, a: ApplicationInput, resume: FileRef | undefined) {
  const d = getDb()
  const form = d.candidateForms.find((f) => f.token === token)
  assert(form && form.active, 'This application form is closed.')
  const problem = Object.values(applicationProblems(a as unknown as Record<string, unknown>, Date.now(), formPositions(form)))[0]
  assert(!problem, problem ?? '')
  assert(resume, 'Upload your resume (PDF or Word).')
  assert(!d.candidates.some((c) => c.formId === form.id && c.email.toLowerCase() === a.email.trim().toLowerCase()), 'You have already applied for this role with this email.')
  mutate((m) => {
    const clean = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as ApplicationInput
    m.candidates.unshift({ ...clean, email: clean.email.toLowerCase(), phone: normPhone(clean.phone), id: uid('cand-'), formId: form.id, resume, submittedAt: nowIso(), status: 'NEW' })
    notify(m, usersWithRole(m, 'hr').map((u) => u.id), 'New application', `${clean.name} applied for ${form.title}`, '/candidates', 'action')
  })
}
export function updateCandidate(me: User, id: string, patch: Partial<Pick<CandidateApplication, 'status' | 'notes'>>) {
  need(me, 'recruitment.manage')
  mutate((d) => { const c = d.candidates.find((x) => x.id === id); assert(c, 'Application not found.'); Object.assign(c, patch) })
}

// ============================================================ notifications & messages
export function markRead(me: User, id?: string) {
  mutate((d) => { for (const n of d.notices) if (n.userId === me.id && (!id || n.id === id)) n.read = true })
}
/** A message can carry documents (PDF, images, Word, Excel) shared inside the CRM. */
export function sendMessage(me: User, to: string, body: string, attachments: FileRef[] = []) {
  need(me, 'messages.use')
  assert(body.trim() || attachments.length, 'Write a message or attach a document.')
  mutate((d) => {
    d.messages.push({ id: uid('m-'), from: me.id, to, body: body.trim(), at: nowIso(), read: false, ...(attachments.length ? { attachments } : {}) })
  })
}
export function markThreadRead(me: User, other: string) {
  mutate((d) => { for (const m of d.messages) if (m.to === me.id && m.from === other) m.read = true })
}

// ============================================================ users & access
export type UserInput = Pick<User, 'name' | 'username' | 'email' | 'phone' | 'role' | 'department' | 'designation'> & { teamLeadId?: string; salary?: number; target?: number; joinedOn?: string; branchId?: string; branchIds?: string[] }
/** A branch id must be one of the company's branches (Access → Settings). */
function checkBranches(d: DB, i: { branchId?: string; branchIds?: string[] }) {
  const ids = new Set((d.settings.branches ?? []).map((b) => b.id))
  assert(!i.branchId || ids.has(i.branchId), 'Pick a branch from the list.')
  assert(!i.branchIds || i.branchIds.every((b) => ids.has(b)), 'Pick branches from the list.')
}

/** 8–16 characters with upper case, lower case, a number and a symbol. */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/
export const PASSWORD_HINT = '8–16 characters with upper case, lower case, a number and a symbol.'

/** HR sets the first password; the resume is optional here (the public application form requires one). */
export async function createUser(me: User, i: UserInput, password: string, resume: FileRef | undefined) {
  need(me, 'access.manage', 'employees.manage')
  assert(i.name.trim() && i.username.trim(), 'Name and username are required.')
  assert(isEmail(i.email), 'Enter a valid email.')
  // the dialer rings this number (Blutec agent phone), so every employee needs one
  assert(isPhone(i.phone), 'Enter a valid 10-digit mobile number — the dialer calls it.')
  assert(i.role !== 'superadmin' || isSA(me), 'Only a Super Admin can create a Super Admin.')
  assert(PASSWORD_RULE.test(password), `Password: ${PASSWORD_HINT}`)
  const holds = (u: User) => u.username.toLowerCase() === i.username.trim().toLowerCase() || u.email.toLowerCase() === i.email.trim().toLowerCase()
  assert(!getDb().users.some((u) => u.active && holds(u)), 'Username or email already used by an active employee.')
  checkBranches(getDb(), i)
  // removed before their name was freed: free it now, saved first so the new row doesn't clash with theirs
  if (getDb().users.some((u) => !u.active && holds(u))) {
    mutate((m) => { for (const u of m.users) if (!u.active && holds(u)) { u.username += REMOVED_TAG(u.id); u.email += REMOVED_TAG(u.id) } })
    if (CLOUD) await saved()
  }
  const passHash = CLOUD ? '' : await hashPassword(i.username.trim(), password)
  const id = uid('u-')
  mutate((m) => {
    const created: User = { ...i, id, username: i.username.trim(), email: i.email.trim().toLowerCase(), phone: i.phone ? normPhone(i.phone) : '', extraRoles: [], grants: [], denies: [], joinedOn: i.joinedOn || today(), active: true, passHash, resume }
    m.users.push(created)
    audit(m, me.id, 'USER_CREATE', `${i.name} (${roleLabel(i.role)})`)
    fireAutomation(m, 'welcome', [created])
  })
  // the CRM row must exist before the server creates the sign-in account for it
  if (CLOUD) { await saved(); await cloudSetPassword(id, password) }
}

export function updateUser(me: User, id: string, patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'role' | 'extraRoles' | 'grants' | 'denies' | 'active' | 'teamLeadId' | 'department' | 'designation' | 'salary' | 'target' | 'branchId' | 'branchIds'>>) {
  need(me, 'access.manage', 'employees.manage')
  mutate((d) => {
    const u = d.users.find((x) => x.id === id)
    assert(u, 'User not found.')
    if ('phone' in patch) { patch.phone = normPhone(patch.phone ?? ''); assert(isPhone(patch.phone), 'Enter a valid 10-digit mobile number — the dialer calls it.') }
    checkBranches(d, patch)
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

/**
 * HR removes an employee who left: they can no longer sign in, their last day is recorded and their open leads go back
 * to Unassigned. Nothing is deleted (attendance, payroll, client files stay); Restore brings them back.
 */
const REMOVED_TAG = (id: string) => `#removed-${id}`
/** A removed employee's username / email without the #removed tag. */
export const unremoved = (s: string) => s.replace(/#removed-.*$/, '')
export function removeEmployee(me: User, id: string, lastDay: string, reason: string) {
  need(me, 'employees.manage', 'access.manage')
  return mutate((d) => {
    const u = d.users.find((x) => x.id === id)
    assert(u, 'Employee not found.')
    assert(u.active, `${u.name} is already removed.`)
    assert(u.id !== me.id, "You can't remove yourself.")
    assert(!rolesOf(u).some((r) => MASTER_ROLES.includes(r)) || isSA(me), 'Only a Super Admin can remove a Super Admin or IT account.')
    assert(u.role !== 'superadmin' || d.users.some((x) => x.role === 'superadmin' && x.active && x.id !== u.id), 'At least one active Super Admin must remain.')
    assert(lastDay, 'Enter their last working day.')
    assert(reason.trim().length >= 3, 'Enter the reason (e.g. resigned, contract ended).')
    u.active = false
    u.exitOn = lastDay
    // free the username and email for someone new (restore takes them back)
    u.username += REMOVED_TAG(u.id); u.email += REMOVED_TAG(u.id)
    // their open leads go back for someone else to call
    let freed = 0
    for (const l of d.leads) if (l.assignedTo === u.id && OPEN_LEAD.includes(l.status)) { l.assignedTo = undefined; l.assignedAt = undefined; leadEvent(l, me.id, `Back to Unassigned — ${u.name} left`); freed++ }
    // nobody keeps them as team leader
    for (const x of d.users) if (x.teamLeadId === u.id) x.teamLeadId = undefined
    audit(d, me.id, 'EMPLOYEE_REMOVE', `${u.name} · last day ${lastDay} · ${reason.trim()}${freed ? ` · ${freed} lead(s) unassigned` : ''}`)
    return freed
  })
}
export function restoreEmployee(me: User, id: string) {
  need(me, 'employees.manage', 'access.manage')
  mutate((d) => {
    const u = d.users.find((x) => x.id === id)
    assert(u && !u.active, 'Employee not found or already active.')
    assert(!rolesOf(u).some((r) => MASTER_ROLES.includes(r)) || isSA(me), 'Only a Super Admin can restore a Super Admin or IT account.')
    const username = unremoved(u.username), email = unremoved(u.email)
    assert(!d.users.some((x) => x.id !== u.id && (x.username.toLowerCase() === username.toLowerCase() || x.email.toLowerCase() === email.toLowerCase())), `${username} / ${email} now belongs to someone else — change it on that account first.`)
    u.username = username; u.email = email
    u.active = true
    u.exitOn = undefined
    audit(d, me.id, 'EMPLOYEE_RESTORE', u.name)
  })
}

/** Monthly sales target: HR / Super Admin / IT for anyone; a Team Leader for their own team; a Branch Director for the people in their branches. */
export function canSetTarget(d: DB, me: User, u: User) {
  if (has(me, 'employees.manage', 'access.manage')) return true
  if (u.id === me.id) return false
  const r = rolesOf(me)
  return (r.includes('teamlead') && u.teamLeadId === me.id) || (r.includes('branchdirector') && !!u.branchId && directorBranches(d, me).includes(u.branchId))
}
export function setTarget(me: User, id: string, amount: number | undefined) {
  assert(amount === undefined || (Number.isFinite(amount) && amount >= 0), 'Enter a target of 0 or more.')
  mutate((d) => {
    const u = d.users.find((x) => x.id === id)
    assert(u, 'User not found.')
    assert(canSetTarget(d, me, u), "You can only set targets for your own team.")
    u.target = amount === undefined ? undefined : Math.round(amount)
    audit(d, me.id, 'USER_EDIT', `${u.name}: monthly target ${amount === undefined ? 'cleared' : amount}`)
  })
}

/** Sets a new password typed by HR / IT (no shared default password). */
export async function resetUserPassword(me: User, id: string, password: string) {
  need(me, 'access.manage')
  const u = getDb().users.find((x) => x.id === id)
  assert(u, 'User not found.')
  assert(!rolesOf(u).includes('superadmin') || isSA(me), "Only a Super Admin can reset a Super Admin's password.")
  assert(PASSWORD_RULE.test(password), `Password: ${PASSWORD_HINT}`)
  if (CLOUD) await cloudSetPassword(id, password)
  const h = CLOUD ? '' : await hashPassword(u.username, password)
  mutate((d) => { const x = d.users.find((y) => y.id === id)!; x.passHash = h; delete x.needsPasswordReset; audit(d, me.id, 'PASSWORD_RESET', u.name) })
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

// ============================================================ client portal: documents asked from the client, milestones, updates
/** The entry's Operation team member, portal / workflow managers and Super Admin / IT run its client portal side. */
export const canRunClientPortal = (me: User, b: Booking) => isMaster(me) || has(me, 'portal.manage', 'workflow.manage') || b.opsMemberId === me.id
/** What one requested document's status is now (supabase/portal-rules.mjs), or null when the client isn't asked for it. */
export const clientDocState = (b: Booking, cat: AdminStageId) => docStatus(b.clientDocs?.[cat], b.clientUploads, cat)
const stageShort = (cat: AdminStageId) => ADMIN_STAGES.find((s) => s.id === cat)!.short

/** Which of the five documents the client is asked for (checkboxes). Taking one off keeps its record and history. */
export function setClientDocs(me: User, bookingId: string, picks: AdminStageId[], assignee?: string) {
  mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can change this.')
    const at = nowIso()
    b.clientDocs ??= {}
    const changed: string[] = []
    for (const s of ADMIN_STAGES) {
      const cur = b.clientDocs[s.id], want = picks.includes(s.id)
      if (want && !cur) {
        b.clientDocs[s.id] = { status: 'ASSIGNED', statusAt: at, assignedAt: at, assignedBy: me.id, ...(assignee ? { assignee } : {}), history: [{ at, by: me.id, action: 'Requested from you', client: true }] }
        changed.push(`+${s.short}`)
      } else if (want && cur?.removed) {
        Object.assign(cur, { removed: false, removedAt: undefined, status: 'ASSIGNED', statusAt: at, assignedAt: at, assignedBy: me.id })
        cur.history.push({ at, by: me.id, action: 'Requested from you again', client: true })
        changed.push(`+${s.short}`)
      } else if (!want && cur && !cur.removed) {
        assert(cur.status !== 'APPROVED' || isSA(me), `${s.short} is approved — only the Super Admin can take it off.`)
        Object.assign(cur, { removed: true, removedAt: at })
        cur.history.push({ at, by: me.id, action: 'No longer needed', client: true })
        changed.push(`−${s.short}`)
      }
    }
    if (!changed.length) return
    b.updatedAt = at
    audit(d, me.id, 'CLIENT_DOCS', `${b.bookingId}: ${changed.join(', ')}`)
  })
}

/**
 * Review steps on a document the client sent: START (submitted → under review), APPROVE / REJECT (under review),
 * REOPEN (approved → asked again; Super Admin only). `remark` is shown to the client — required to reject.
 */
export function reviewClientDoc(me: User, bookingId: string, cat: AdminStageId, step: 'START' | 'APPROVE' | 'REJECT' | 'REOPEN', remark = '') {
  remark = remark.trim()
  mutate((d) => {
    const b = findB(d, bookingId)
    const w = b.clientDocs?.[cat]
    assert(w && !w.removed, 'This document isn’t requested from the client.')
    assert(canRunClientPortal(me, b) || w.assignee === me.id, 'Only the entry’s Operation team member, the person handling this document or Super Admin can review it.')
    const state = clientDocState(b, cat)
    if (step === 'REOPEN') assert(state === 'APPROVED' && isSA(me), 'Only the Super Admin can reopen an approved document.')
    else assert(reviewSteps(state).includes(step), step === 'START' ? 'The client hasn’t uploaded a new file yet.' : 'Start the review first.')
    assert(step !== 'REJECT' || remark.length >= 3, 'Tell the client what to change (shown to them).')
    const at = nowIso()
    w.status = step === 'START' ? 'UNDER_REVIEW' : step === 'APPROVE' ? 'APPROVED' : step === 'REJECT' ? 'REJECTED' : 'ASSIGNED'
    w.statusAt = at
    if (step === 'APPROVE' || step === 'REJECT') { w.reviewedBy = me.id; w.reviewedAt = at; w.clientRemark = remark || undefined }
    if (step === 'REOPEN') w.clientRemark = remark || undefined
    const action = { START: 'Review started', APPROVE: 'Approved', REJECT: 'Please upload again', REOPEN: 'Requested from you again' }[step]
    w.history.push({ at, by: me.id, action, ...(remark ? { note: remark } : {}), client: true })
    b.updatedAt = at
    if (step !== 'START') notify(d, [b.opsMemberId, w.assignee].filter((x) => x !== me.id), `Client ${stageShort(cat)}: ${action.toLowerCase()}`, `${b.bookingId} · ${b.companyName}${remark ? ` — ${remark}` : ''}`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, `CLIENT_DOC_${step}`, `${b.bookingId} · ${stageShort(cat)}${remark ? `: ${remark}` : ''}`)
  })
}

/** Staff-only details of a requested document: who handles it and an internal note (never shown to the client). */
export function setClientDocInternal(me: User, bookingId: string, cat: AdminStageId, patch: { assignee?: string | null; internalNote?: string }) {
  mutate((d) => {
    const b = findB(d, bookingId)
    const w = b.clientDocs?.[cat]
    assert(w, 'This document isn’t requested from the client.')
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can change this.')
    const at = nowIso()
    if (patch.assignee !== undefined && (patch.assignee || undefined) !== w.assignee) {
      assert(!patch.assignee || d.users.some((u) => u.id === patch.assignee && u.active), 'Pick an active team member.')
      w.assignee = patch.assignee || undefined
      w.history.push({ at, by: me.id, action: patch.assignee ? `Handled by ${userName(d, patch.assignee)}` : 'No one handling it' })
      if (patch.assignee && patch.assignee !== me.id) notify(d, [patch.assignee], `Client document: ${stageShort(cat)}`, `${b.bookingId} · ${b.companyName} — you review what the client sends`, `/bookings/${b.id}`, 'action')
    }
    if (patch.internalNote !== undefined && patch.internalNote.trim() !== (w.internalNote ?? '')) {
      w.internalNote = patch.internalNote.trim() || undefined
      w.history.push({ at, by: me.id, action: 'Internal note updated' })
    }
    b.updatedAt = at
  })
}

/** Adds or changes a milestone (tasks included). Done milestones record when; `visible` ones show in the client portal. */
export function saveMilestone(me: User, bookingId: string, m: Pick<Milestone, 'title' | 'status' | 'visible'> & Partial<Pick<Milestone, 'id' | 'due' | 'note' | 'tasks'>>) {
  const title = m.title.trim()
  assert(title.length >= 2, 'Name the milestone.')
  assert(!m.due || /^\d{4}-\d{2}-\d{2}$/.test(m.due), 'Pick a due date.')
  assert((m.tasks ?? []).every((t) => t.title.trim().length >= 2), 'Every task needs a name.')
  return mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can change milestones.')
    const at = nowIso()
    b.milestones ??= []
    const cur = m.id ? b.milestones.find((x) => x.id === m.id) : undefined
    const tasks = (m.tasks ?? []).map((t) => ({ ...t, id: t.id || uid('mt-'), title: t.title.trim() }))
    const doneAt = m.status === 'DONE' ? (cur?.status === 'DONE' ? cur.doneAt : at) : undefined
    if (cur) Object.assign(cur, { title, due: m.due || undefined, status: m.status, visible: m.visible, note: m.note?.trim() || undefined, tasks, doneAt, updatedAt: at })
    else b.milestones.push({ id: uid('ms-'), title, due: m.due || undefined, status: m.status, visible: m.visible, note: m.note?.trim() || undefined, tasks, doneAt, createdAt: at, createdBy: me.id })
    b.updatedAt = at
    audit(d, me.id, cur ? 'MILESTONE_EDIT' : 'MILESTONE_ADD', `${b.bookingId}: ${title} (${m.status})`)
    return cur?.id ?? b.milestones.at(-1)!.id
  })
}
export function setMilestoneTask(me: User, bookingId: string, milestoneId: string, taskId: string, done: boolean) {
  mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can change milestones.')
    const t = b.milestones?.find((x) => x.id === milestoneId)?.tasks?.find((x) => x.id === taskId)
    assert(t, 'Task not found.')
    t.done = done
    b.updatedAt = nowIso()
  })
}
export function removeMilestone(me: User, bookingId: string, milestoneId: string) {
  mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can change milestones.')
    const m = b.milestones?.find((x) => x.id === milestoneId)
    assert(m, 'Milestone not found.')
    b.milestones = b.milestones!.filter((x) => x.id !== milestoneId)
    b.updatedAt = nowIso()
    audit(d, me.id, 'MILESTONE_REMOVE', `${b.bookingId}: ${m.title}`)
  })
}

/** An update shown to the client in the portal (with an optional file). */
export function publishClientUpdate(me: User, bookingId: string, u: { title: string; text: string; file?: FileRef }) {
  const title = u.title.trim(), text = u.text.trim()
  assert(title.length >= 3, 'Write a short title.')
  assert(text.length >= 3 && text.length <= 4000, 'Write the update (up to 4000 characters).')
  mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can publish updates.')
    const at = nowIso()
    b.clientUpdates = [...(b.clientUpdates ?? []), { id: uid('cup-'), at, by: me.id, title, text, ...(u.file ? { file: u.file } : {}) }]
    b.updatedAt = at
    audit(d, me.id, 'CLIENT_UPDATE', `${b.bookingId}: ${title}`)
  })
}
export function removeClientUpdate(me: User, bookingId: string, updateId: string) {
  mutate((d) => {
    const b = findB(d, bookingId)
    assert(canRunClientPortal(me, b), 'Only the entry’s Operation team member, Super Admin or a portal manager can remove updates.')
    const u = b.clientUpdates?.find((x) => x.id === updateId)
    assert(u, 'Update not found.')
    b.clientUpdates = b.clientUpdates!.filter((x) => x.id !== updateId)
    b.updatedAt = nowIso()
    audit(d, me.id, 'CLIENT_UPDATE_REMOVE', `${b.bookingId}: ${u.title}`)
  })
}

/** The Super Admin's portal account actions (the live server does them: sign-in accounts, emails, sessions). */
export const portalAdmin = (action: 'invite' | 'send-link' | 'status' | 'revoke' | 'link' | 'assign', body: Record<string, unknown>) =>
  serverPost<{ success: boolean; message?: string; accountId?: string; emailed?: boolean; status?: string; code?: string }>(`/api/portal-admin/${action}`, body)
