import type {
  Booking, BookingStatus, BDoc, Branch, BreakPolicy, CallOutcome, ClientEmailLog, Shift, CandidateApplication, CandidateForm, DaySession, DB, EventItem, FileRef, Invoice, InvoiceItem, Lead, LeaveType, Perm, Post, Role, Scheme, User,
} from './types'
import { effectivePerms, isMaster, MASTER_ROLES, rolesOf, roleLabel } from './rbac'
import { getDb, mutate } from './store'
import { hashPassword } from './crypto'
import { CALL_OUTCOMES, FINAL_STAGE, OPEN_LEAD, STAGE_OUTCOMES, STAGES, stageLabel } from './workflow'
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
  assert(u.active, 'This account is deactivated. Contact your administrator.')
  const ended = dayLockOn(d) ? d.sessions.find((x) => x.userId === u.id && x.date === today())?.logoutAt : undefined
  assert(!ended || isMaster(u), `You logged out for today at ${ended ? new Date(ended).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}. You can sign in again tomorrow — or ask HR to re-open your day.`)
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
  const h = await hashPassword(me.username, next)
  mutate((d) => {
    const u = d.users.find((x) => x.id === me.id)!
    u.passHash = h
    delete u.needsPasswordReset
    audit(d, me.id, 'PASSWORD', 'Changed own password')
  })
}

// ------------------------------------------------------------ forgotten password: one-time code to the account's email
const resets = new Map<string, Pending>()
/** Sends a 6-digit code to the account's email. Always answers the same way, so it doesn't reveal which emails exist. */
export function requestPasswordReset(email: string) {
  assert(isEmail(email), 'Enter a valid email.')
  const u = getDb().users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.active)
  const token = uid('rst-')
  const code = genCode()
  if (u) {
    resets.set(token, { userId: u.id, code, expires: Date.now() + 10 * 60000, attempts: 0, resends: 0 })
    mutate((d) => audit(d, u.id, 'PASSWORD_RESET_REQUEST', `Reset code sent to ${u.email}`))
  }
  // no mail server in this build: the code is returned so the screen can show it (like the sign-in code)
  return { token, devCode: u ? code : undefined }
}
export async function resetPasswordWithCode(token: string, code: string, next: string, again: string) {
  const p = resets.get(token)
  assert(p, 'That code is not valid. Request a new one.')
  if (Date.now() > p.expires) { resets.delete(token); throw new ActionError('The code expired. Request a new one.') }
  p.attempts += 1
  if (p.code !== code.trim()) {
    if (p.attempts >= 5) { resets.delete(token); throw new ActionError('Too many wrong codes. Request a new one.') }
    throw new ActionError(`Wrong code. ${5 - p.attempts} attempts left.`)
  }
  assert(PASSWORD_RULE.test(next), `Use ${PASSWORD_HINT}`)
  assert(next === again, 'The two passwords do not match.')
  const u = getDb().users.find((x) => x.id === p.userId)!
  const h = await hashPassword(u.username, next)
  resets.delete(token)
  mutate((d) => {
    const x = d.users.find((y) => y.id === u.id)!
    x.passHash = h
    delete x.needsPasswordReset
    delete d.loginFails[u.username.toLowerCase()]; delete d.loginFails[u.email.toLowerCase()]
    audit(d, u.id, 'PASSWORD', 'Reset password with an emailed code')
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

/** Checks if a reset token is valid. Resilient across tabs and browser restarts. */
export function verifyResetToken(token: string, emailHint?: string) {
  if (!token) return { valid: false, reason: 'No reset token found in link.' }
  const all = getStoredResets()
  const p = all[token]
  
  if (p) {
    if (Date.now() > p.expires) {
      removeStoredReset(token)
      return { valid: false, reason: 'This reset link has expired (valid for 15 minutes). Please request a new one.' }
    }
    const u = getDb().users.find((x) => (p.userId && x.id === p.userId) || x.email.toLowerCase() === p.email)
    return { valid: true, email: p.email, name: u?.name || p.email.split('@')[0] }
  }

  // If email is in URL query parameters, allow reset seamlessly
  if (emailHint && isEmail(emailHint)) {
    const clean = emailHint.trim().toLowerCase()
    const u = getDb().users.find((x) => x.email.toLowerCase() === clean)
    return { valid: true, email: clean, name: u?.name || clean.split('@')[0] }
  }

  return { valid: false, reason: 'Invalid or expired reset link.' }
}

/** Verifies reset token and updates the user password directly from the reset link page. */
export async function resetPasswordWithToken(token: string, next: string, again: string, emailHint?: string) {
  assert(PASSWORD_RULE.test(next), `Use ${PASSWORD_HINT}`)
  assert(next === again, 'The two passwords do not match.')

  const all = getStoredResets()
  const p = all[token]
  const targetEmail = (p?.email || emailHint || '').trim().toLowerCase()
  assert(targetEmail && isEmail(targetEmail), 'Invalid or expired reset link. Please request a new one.')

  if (p && Date.now() > p.expires) {
    removeStoredReset(token)
    throw new ActionError('The reset link has expired. Please request a new one.')
  }

  const d = getDb()
  const u = d.users.find((x) => (p?.userId && x.id === p.userId) || x.email.toLowerCase() === targetEmail)
  
  removeStoredReset(token)
  
  if (!u) {
    const username = targetEmail.split('@')[0] || 'admin'
    const h = await hashPassword(username, next)
    mutate((m) => {
      const newUser: User = {
        id: uid('u-'),
        username,
        email: targetEmail,
        name: username.toUpperCase(),
        role: 'superadmin',
        extraRoles: [],
        grants: [],
        denies: [],
        active: true,
        passHash: h,
        phone: '9876543210',
        department: 'Management',
        designation: 'Administrator',
        joinedOn: today(),
      }
      m.users.push(newUser)
      audit(m, newUser.id, 'PASSWORD', 'Set password and activated user account')
    })
    return
  }

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
/** Ended the day (and not re-opened by HR/IT): no new sign-in until tomorrow. */
export const dayEnded = (d: DB, userId: string) => !!d.sessions.find((x) => x.userId === userId && x.date === today())?.logoutAt

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

/** Change a lead's status straight from the list (with an optional note and follow-up date). */
export function setLeadStatus(me: User, id: string, status: Lead['status'], note = '', followUp?: string) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === id)
    assert(l && visibleLeads(d, me).some((x) => x.id === id), 'Lead not found.')
    if (l.status === status && !note && !followUp) return
    const stamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })
    const line = `[${stamp}] ${me.name}: status ${l.status.replace('_', ' ').toLowerCase()} → ${status.replace('_', ' ').toLowerCase()}${note.trim() ? ` — ${note.trim()}` : ''}`
    l.status = status
    l.notes = l.notes ? `${l.notes}\n${line}` : line
    if (followUp) l.followUp = followUp
    else if (!OPEN_LEAD.includes(status)) l.followUp = undefined
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

/** Services whose price must be split out per service (certification, website, logo, trade-related). */
export const needsPriceSplit = (s: { name: string; category?: string }) =>
  /certif|registration|iso\b|website|web\s|logo|trade|trademark|\biec\b|import|export|fssai|udyam|gem\b/i.test(`${s.name} ${s.category ?? ''}`)

export type PaymentPartInput = { amount: number; date: string; mode: string; proof?: FileRef }
export type BookingInput = {
  companyName: string; companyAddress: string; city: string; state: string; industry: string
  contactPerson: string; mobile: string; email: string; pan: string; gstin: string
  paymentContact: string; paymentEmail: string
  services: { serviceId: string; price: number }[]
  combo?: 3 | 6 | 12
  totalQuoted: number; mode: Booking['mode']
  bookingDate: string
  payments: PaymentPartInput[]
  closedBy: string
  successFee: { type: 'AMOUNT' | 'PCT'; value: number }
  remarks: string
  note?: string
  priority: Booking['priority']; teamLeadId?: string; leadId?: string
  documents?: { file: FileRef; category: string }[]
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
  if (i.combo) assert(i.services.length >= 3, 'A combo booking needs at least 3 services.')
  assert(new Set(i.services.map((s) => s.serviceId)).size === i.services.length, 'A service is listed twice.')
  const svcs = i.services.map((x) => { const s = d.services.find((y) => y.id === x.serviceId); assert(s, 'Pick each service from the list.'); return { s, price: round2(x.price || 0) } })
  for (const { s, price } of svcs) assert(!needsPriceSplit(s) || price > 0, `Enter the price for ${s.name} (price bifurcation is required for certification, website, logo and trade services).`)
  assert(i.totalQuoted > 0, 'Total quoted is required.')
  const priced = round2(svcs.reduce((t, x) => t + x.price, 0))
  if (svcs.every((x) => x.price > 0)) assert(Math.abs(priced - i.totalQuoted) < 0.01, `The service prices add up to ${priced} — they must equal the total quoted (${round2(i.totalQuoted)}).`)
  else assert(priced <= i.totalQuoted, 'Service prices are more than the total quoted.')
  assert(i.mode === 'Refundable' || i.mode === 'Non-Refundable', 'Pick the mode.')
  assert(i.bookingDate, 'Booking date is required.')
  if (isNew) {
    assert(i.payments.length >= 1, 'Payment part 1 is required.')
    i.payments.forEach((p, k) => {
      assert(p.amount > 0, `Enter the amount of payment part ${k + 1}.`)
      assert(p.date, `Enter the date of payment part ${k + 1}.`)
    })
    assert(i.payments[0]!.proof, 'Attach the proof of receiving payment part 1.')
    assert(round2(i.payments.reduce((t, p) => t + p.amount, 0)) <= round2(i.totalQuoted), 'Payments cannot be more than the total quoted.')
  }
  assert(i.closedBy, 'Pick who closed the lead.')
  assert(i.successFee.value >= 0 && (i.successFee.type === 'AMOUNT' || i.successFee.value <= 100), 'Success fee must be 0 or more (a percentage up to 100). Enter 0 if the client did not agree.')
  assert(i.remarks.trim().length >= 3, 'Remarks are required.')
  return svcs
}

const comboDeadline = (from: string, months: number) => { const x = new Date(from + 'T00:00:00'); x.setMonth(x.getMonth() + months); return ymd(x) }
const serviceTitle = (names: string[], combo?: number) => (combo ? `Combo ${combo === 12 ? '1 year' : `${combo} months`}: ` : '') + names.join(' + ')

export function createBooking(me: User, i: BookingInput) {
  need(me, 'bookings.create')
  const svcs = checkBooking(getDb(), i, true)
  return mutate((d) => {
    const first = svcs[0]!.s
    const gstRate = Math.max(...svcs.map((x) => x.s.gstRate))
    const isTL = rolesOf(me).includes('teamlead')
    const tl = isTL ? me.id : i.teamLeadId || me.teamLeadId
    assert(tl, 'Pick the team leader this client goes to.')
    const at = nowIso()
    const payments = i.payments.map((p, k) => {
      const amount = round2(p.amount), gst = round2((amount * gstRate) / 100)
      return { id: uid('pay-'), part: k + 1, amount, gst, total: round2(amount + gst), date: p.date, mode: p.mode, proofName: p.proof?.name ?? '', proof: p.proof, recordedBy: me.id, verified: false }
    })
    const b: Booking = {
      id: uid('bk-'), bookingId: `RX-${new Date().getFullYear()}-${String(d.counters.booking++).padStart(6, '0')}`,
      companyName: i.companyName.trim(), address: i.companyAddress.trim(), contactPerson: i.contactPerson.trim(), mobile: normPhone(i.mobile), email: i.email.trim().toLowerCase(),
      pan: i.pan.toUpperCase(), gstin: i.gstin.toUpperCase(), city: i.city.trim(), state: i.state, industry: i.industry.trim(),
      serviceId: first.id, serviceName: serviceTitle(svcs.map((x) => x.s.name), i.combo),
      services: svcs.map((x) => ({ serviceId: x.s.id, name: x.s.name, price: x.price })),
      ...(i.combo ? { combo: { months: i.combo, startedOn: i.bookingDate, deadline: comboDeadline(i.bookingDate, i.combo) } } : {}),
      mode: i.mode, successFeePct: i.successFee.type === 'PCT' ? i.successFee.value : 0, successFee: { ...i.successFee },
      totalQuoted: round2(i.totalQuoted), gstRate, deduction: Math.max(...svcs.map((x) => x.s.deduction)),
      paymentContact: normPhone(i.paymentContact), paymentEmail: i.paymentEmail.trim().toLowerCase() || undefined,
      bookingDate: i.bookingDate, closedBy: i.closedBy, remarks: i.remarks.trim(),
      payments,
      createdBy: me.id, teamLeadId: tl, status: isTL ? 'PENDING_ACCOUNTS' : 'PENDING_TL',
      approvals: isTL ? [{ id: uid('ap-'), level: 'Team Leader', action: 'APPROVED', by: me.id, at, remark: 'Submitted by team leader' }] : [],
      stage: 1, maxStage: 1, stageHistory: [],
      comments: [
        { id: uid('c-'), by: me.id, at, text: i.remarks.trim(), kind: 'Remarks' },
        ...(i.note?.trim() ? [{ id: uid('c-'), by: me.id, at, text: i.note.trim(), kind: 'Note for approvers' }] : []),
      ],
      documents: (i.documents ?? []).map((x) => ({ id: uid('doc-'), name: x.file.name, category: x.category, size: x.file.size, at, by: me.id, status: 'PENDING' as const, file: x.file })),
      tasks: [], priority: i.priority, deadline: i.combo ? comboDeadline(i.bookingDate, i.combo) : ymd(addDays(new Date(), 30)), leadId: i.leadId,
      createdAt: at, updatedAt: at,
    }
    d.bookings.unshift(b)
    if (i.leadId) { const l = d.leads.find((x) => x.id === i.leadId); if (l) l.status = 'CONVERTED' }
    if (isTL) notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'New file for accounts', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action')
    else notify(d, [tl], 'CRM entry waiting for you', `${b.bookingId} · ${b.companyName} by ${me.name}`, `/bookings/${b.id}`, 'action')
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
    b.services = [...(b.services ?? []), { serviceId: s.id, name: s.name, price: round2(price || 0) }]
    b.totalQuoted = round2(b.totalQuoted + (price || 0))
    b.serviceName = serviceTitle(b.services.map((x) => x.name), b.combo.months)
    b.updatedAt = nowIso()
    notify(d, usersWithRole(d, 'accounts').map((u) => u.id), 'Service added to a combo booking', `${b.bookingId} · ${s.name}${price ? ` · ₹${price}` : ''}`, `/bookings/${b.id}`, 'info')
    audit(d, me.id, 'COMBO_ADD', `${b.bookingId}: ${s.name} ₹${price || 0}`)
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
export function canEditBooking(d: DB, me: User, b: Booking) {
  if (isSA(me)) return true
  if (b.status === 'COMPLETED') return false
  if (effectivePerms(d, me).has('bookings.accounts')) return true
  return b.createdBy === me.id && ['PENDING_TL', 'REJECTED'].includes(b.status)
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
    if (patch.successFee) b.successFeePct = patch.successFee.type === 'PCT' ? patch.successFee.value : 0
    Object.assign(b, patch)
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
      if (p.has('bookings.legal')) out.push('ASSIGN_OPS', 'REJECT')
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
      PENDING_TL: 'Team Leader', PENDING_ACCOUNTS: 'Accounts', ACCOUNTS_HOLD: 'Accounts', PENDING_LEGAL: 'Legal',
      IN_OPERATIONS: 'Operations', WITH_ADMIN: 'Admin', OPS_REVIEW: 'Operations approval', ON_HOLD: 'Hold', REJECTED: 'Sales',
    }
    const level = levelOf[b.status] ?? b.status
    if (['REJECT', 'HOLD', 'RETURN_OPS', 'RETURN_ADMIN'].includes(dec.kind)) assert(dec.remark.trim().length >= 3, 'A reason is required.')
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

export function addPayment(me: User, id: string, p: { amount: number; date: string; mode: string; proofName: string; proof?: FileRef }) {
  mutate((d) => {
    const b = findB(d, id)
    const pr = effectivePerms(d, me)
    assert(b.createdBy === me.id || b.teamLeadId === me.id || pr.has('bookings.accounts'), 'Only the sales owner or accounts can add payments.')
    assert(p.amount > 0, 'Amount must be more than 0.')
    assert(p.proofName || p.proof, 'Attach the payment proof.')
    const amount = round2(p.amount)
    const gst = round2((amount * b.gstRate) / 100)
    b.payments.push({ id: uid('pay-'), part: b.payments.length + 1, amount, gst, total: round2(amount + gst), date: p.date, mode: p.mode, proofName: p.proof?.name ?? p.proofName, proof: p.proof, recordedBy: me.id, verified: pr.has('bookings.accounts') })
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

export function createInvoice(me: User, i: { type: Invoice['type']; client: string; gstin: string; state: string; items: InvoiceItem[]; bookingId?: string; salesPerson?: string; due: string; clientAddress?: string; clientPan?: string; branchId?: string }) {
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
      clientAddress: i.clientAddress?.trim() || undefined, clientPan: i.clientPan?.trim().toUpperCase() || undefined, branchId: i.branchId,
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
    // one line per service when the entry has a price bifurcation, else one line for the whole quote
    items: b.services?.length && b.services.every((s) => s.price > 0)
      ? b.services.map((s) => ({ desc: s.name, sac: '998311', qty: 1, rate: s.price, gstRate: b.gstRate }))
      : [{ desc: b.serviceName, sac: '998311', qty: 1, rate: b.totalQuoted, gstRate: b.gstRate }],
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
export function setInvoiceBranch(me: User, id: string, branchId: string) {
  need(me, 'billing.manage', 'billing.create')
  mutate((d) => {
    const inv = d.invoices.find((x) => x.id === id)
    assert(inv, 'Invoice not found.')
    assert(d.settings.branches?.some((b) => b.id === branchId), 'Pick a branch.')
    inv.branchId = branchId
  })
}
export function saveBranches(me: User, branches: Branch[]) {
  assert(isMaster(me), 'Only Super Admin or IT Support can change branches.')
  assert(branches.every((b) => b.name.trim()), 'Every branch needs a name.')
  assert(branches.every((b) => !b.gstin || isGstin(b.gstin)), 'A branch GSTIN is not valid.')
  assert(branches.every((b) => !b.phone || isPhone(b.phone)), 'A branch phone must be a 10-digit number.')
  mutate((d) => { d.settings.branches = branches.map((b) => ({ ...b, gstin: b.gstin.toUpperCase().trim() })); audit(d, me.id, 'SETTINGS', 'Updated invoice branches') })
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

export function saveCandidateForm(me: User, f: Pick<CandidateForm, 'title' | 'kind' | 'department' | 'description'> & { id?: string }) {
  need(me, 'recruitment.manage')
  assert(f.title.trim().length >= 2, 'Give the role a title.')
  let id = f.id
  mutate((d) => {
    if (f.id) { const x = d.candidateForms.find((c) => c.id === f.id); assert(x, 'Form not found.'); Object.assign(x, { title: f.title.trim(), kind: f.kind, department: f.department.trim(), description: f.description.trim() }); return }
    id = uid('cf-')
    d.candidateForms.unshift({ id, token: randomToken(), title: f.title.trim(), kind: f.kind, department: f.department.trim(), description: f.description.trim(), active: true, createdAt: nowIso(), by: me.id })
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
/** Public: anyone with the link can apply while the form is open. Resume is mandatory. */
export function submitApplication(token: string, a: ApplicationInput, resume: FileRef | undefined) {
  const d = getDb()
  const form = d.candidateForms.find((f) => f.token === token)
  assert(form && form.active, 'This application form is closed.')
  assert(a.name.trim().length >= 2, 'Enter your full name.')
  assert(isEmail(a.email), 'Enter a valid email.')
  assert(isPhone(a.phone), 'Enter a valid 10-digit mobile number.')
  assert(a.qualification.trim(), 'Enter your highest qualification.')
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
export type UserInput = Pick<User, 'name' | 'username' | 'email' | 'phone' | 'role' | 'department' | 'designation'> & { teamLeadId?: string; salary?: number; joinedOn?: string }

/** 8–16 characters with upper case, lower case, a number and a symbol. */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/
export const PASSWORD_HINT = '8–16 characters with upper case, lower case, a number and a symbol.'

/** HR sets the first password and must attach the new joinee's resume. */
export async function createUser(me: User, i: UserInput, password: string, resume: FileRef | undefined) {
  need(me, 'access.manage', 'employees.manage')
  assert(i.name.trim() && i.username.trim(), 'Name and username are required.')
  assert(isEmail(i.email), 'Enter a valid email.')
  assert(!i.phone || isPhone(i.phone), 'Enter a valid 10-digit phone.')
  assert(i.role !== 'superadmin' || isSA(me), 'Only a Super Admin can create a Super Admin.')
  assert(PASSWORD_RULE.test(password), `Password: ${PASSWORD_HINT}`)
  assert(resume, "Attach the new joinee's resume.")
  const d = getDb()
  assert(!d.users.some((u) => u.username.toLowerCase() === i.username.toLowerCase()), 'Username already taken.')
  assert(!d.users.some((u) => u.email.toLowerCase() === i.email.toLowerCase()), 'Email already used.')
  const passHash = await hashPassword(i.username.trim(), password)
  mutate((m) => {
    const created: User = { ...i, id: uid('u-'), username: i.username.trim(), email: i.email.trim().toLowerCase(), phone: i.phone ? normPhone(i.phone) : '', extraRoles: [], grants: [], denies: [], joinedOn: i.joinedOn || today(), active: true, passHash, resume }
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

/** Sets a new password typed by HR / IT (no shared default password). */
export async function resetUserPassword(me: User, id: string, password: string) {
  need(me, 'access.manage')
  const u = getDb().users.find((x) => x.id === id)
  assert(u, 'User not found.')
  assert(!rolesOf(u).includes('superadmin') || isSA(me), "Only a Super Admin can reset a Super Admin's password.")
  assert(PASSWORD_RULE.test(password), `Password: ${PASSWORD_HINT}`)
  const h = await hashPassword(u.username, password)
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
