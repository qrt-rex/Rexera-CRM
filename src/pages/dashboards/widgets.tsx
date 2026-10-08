import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronRight, Clock, Eye, LogIn, LogOut, Pause, Play, Square, type LucideIcon } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { breakFor, breakLabel, breakLeftMs, breakMinutes, breakReview, breakUsedMs, breakWindow, clock, dayLockOn, endDay, inBreakWindow, remindBreak, onBreak, pauseDay, resumeDay, startDay, userName, workedMs } from '../../lib/actions'
import { todaySession } from '../../lib/metrics'
import { ago, fmtDate, fmtTime, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import type { Tone } from '../../lib/workflow'
import { Badge, Button, Card, CardHeader, cx, EmptyState, useConfirm, useRun, useToast } from '../../components/ui'

const chip: Record<Tone, string> = {
  navy: 'bg-brand-soft text-brand-ink', orange: 'bg-accent-soft text-accent', green: 'bg-ok-soft text-ok', red: 'bg-bad-soft text-bad',
  amber: 'bg-warn-soft text-warn', blue: 'bg-info-soft text-info', violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  gray: 'bg-card2 text-mute', cyan: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300', pink: 'bg-pink-500/12 text-pink-600 dark:text-pink-300',
}

export function Greeting({ subtitle, right }: { subtitle?: string; right?: ReactNode }) {
  const me = useMe()
  const h = new Date().getHours()
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[#2E3A8C] via-[#33408F] to-[#4453b5] p-6 text-white shadow-lg shadow-brand/20 anim-fade-up sm:p-7">
      <div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-20 right-40 size-48 rounded-full bg-[#F47B20]/25 blur-2xl" />
      <div className="relative flex flex-wrap items-center gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">{hello}, {me.name.split(' ')[0]} 👋</h2>
          <p className="mt-1 text-sm text-white/80">{subtitle ?? `${roleLabel(me.role)} · ${me.department}`}</p>
        </div>
        {right}
      </div>
    </div>
  )
}

export function Tile({ to, onClick, icon: Icon, label, desc, tone = 'navy', badge, viewOnly, highlight, className }: {
  to?: string; onClick?: () => void; icon: LucideIcon; label: string; desc?: string; tone?: Tone; badge?: number | string; viewOnly?: boolean; highlight?: boolean; className?: string
}) {
  const inner = (
    <>
      <span className={cx('grid size-12 shrink-0 place-items-center rounded-2xl transition group-hover:scale-105', highlight ? 'bg-accent text-white' : chip[tone])}><Icon className="size-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-bold">{label}</span>
          {viewOnly && <span title="View only" className="inline-flex items-center gap-1 rounded-full bg-card2 px-1.5 py-0.5 text-[10px] font-semibold text-mute"><Eye className="size-3" />view</span>}
        </span>
        {desc && <span className="block truncate text-xs text-mute">{desc}</span>}
      </span>
      {badge !== undefined && badge !== 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-2 text-[11px] font-bold text-white">{badge}</span>}
      <ChevronRight className="size-5 shrink-0 text-mute transition group-hover:translate-x-0.5 group-hover:text-ink" />
    </>
  )
  // every tile looks the same (no heavy outline); a highlighted tile only gets the orange icon
  const cls = cx('group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop', className)
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button onClick={onClick} className={cls}>{inner}</button>
}

export function TileGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' }[cols]
  return <div className={cx('grid gap-4', c)}>{children}</div>
}

/** Re-renders every `ms` while `active` (for live timers). */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return active ? now : Date.now()
}
export const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function LoginLogoutCard({ className }: { className?: string }) {
  const db = useDb()
  const me = useMe()
  const { signOut } = useAuth()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const s = todaySession(db, me.id)
  const paused = onBreak(s)
  const now = useNow(!!s && !s.logoutAt, paused ? 1000 : 30000)
  const left = breakLeftMs(s, now)
  const used = breakUsedMs(s, now)
  const hours = workedMs(s, now) / 3600000
  const bp = breakFor(me, db)
  const bmin = breakMinutes(bp)
  const logout = async () => {
    const lock = dayLockOn(db)
    if (!(await confirm('End your day?', `${lock ? "You won't be able to sign in again until tomorrow. " : ''}Worked ${hours.toFixed(1)} h today${used ? `, break ${mmss(used)}` : ''}.`, true))) return
    if (await run(() => endDay(me), 'Logged out for today. See you tomorrow!')) signOut()
  }
  return (
    <Card className={cx('p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Clock className="size-[18px] text-info" />
        <h3 className="flex-1 text-sm font-bold">Login – Logout Time</h3>
        {s && !s.logoutAt && !paused && <Badge tone="green" dot>Working · {hours.toFixed(1)} h</Badge>}
        {paused && <Badge tone="amber" dot>On break · {mmss(left)} left</Badge>}
        {s?.logoutAt && <Badge tone="gray">Day ended</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-card2 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-mute"><LogIn className="size-4 text-ok" />Login Time</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums">{fmtTime(s?.loginAt)}</p>
          <p className="text-[11px] text-mute">{fmtDate(today())}</p>
        </div>
        <div className="rounded-xl bg-card2 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-mute"><LogOut className="size-4 text-bad" />Logout Time</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums">{fmtTime(s?.logoutAt)}</p>
          <p className="text-[11px] text-mute">{s?.logoutAt ? fmtDate(s.logoutAt) : 'Not yet logout'}</p>
        </div>
      </div>
      {s && !s.logoutAt && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] font-semibold text-mute"><span>Lunch break · {breakLabel(bp)}</span><span className="tabular-nums">{mmss(used)} / {bmin}:00</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-card2"><div className={cx('h-full rounded-full transition-all', left > 0 ? 'bg-warn' : 'bg-bad')} style={{ width: `${Math.min(100, (used / Math.max(1, bmin * 60000)) * 100)}%` }} /></div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!s ? <Button size="sm" variant="success" icon={Play} className="col-span-2" onClick={() => run(() => startDay(me), 'Day started')}>Start my day</Button>
          : s.logoutAt ? (dayLockOn(db)
            ? <p className="col-span-2 rounded-xl bg-card2 px-3 py-2 text-center text-xs text-mute">You logged out for today. You can sign in again tomorrow.</p>
            : <Button size="sm" variant="success" icon={Play} className="col-span-2" title="The after-logout lock is off (testing)" onClick={() => run(() => startDay(me), 'Day started again')}>Start again</Button>)
          : <>
            {paused
              ? <Button size="sm" variant="success" icon={Play} onClick={() => run(() => resumeDay(me), 'Welcome back — day resumed')}>Resume</Button>
              : <Button size="sm" variant="soft" icon={Pause} disabled={!inBreakWindow(now, bp) || left <= 0} title={`Lunch break: ${breakLabel(bp)}`} onClick={() => run(() => pauseDay(me), `Day paused · ${mmss(left)} of break left`)}>{inBreakWindow(now, bp) ? (left <= 0 ? 'Break used' : 'Pause') : `Break ${breakLabel(bp)}`}</Button>}
            <Button size="sm" variant="outline" icon={Square} onClick={logout}>End my day</Button>
          </>}
      </div>
      {confirmNode}
    </Card>
  )
}

/** 5 minutes before lunch: a pop-up and a bell notification, once a day, for anyone whose day is running. */
export function BreakReminder() {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const s = todaySession(db, me.id)
  const working = !!s && !s.logoutAt
  const now = useNow(working, 20000)
  const bp = breakFor(me, db)
  const w = breakWindow(now, bp)
  useEffect(() => {
    if (working && now >= w.start - 5 * 60000 && now < w.start && remindBreak(me)) toast('info', `Lunch break starts at ${clock(w.start, bp.timeZone)} — in about 5 minutes`)
  }, [working, now, w.start, bp.timeZone, me, toast])
  return null
}

/** Shown on every page while the person is on a break. */
export function BreakBanner() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const s = todaySession(db, me.id)
  const paused = onBreak(s)
  const now = useNow(paused)
  if (!paused) return null
  const left = breakLeftMs(s, now)
  const late = breakReview(s, now)
  return (
    <div role={late.state === 'STILL_AWAY' ? 'alert' : 'status'} className={cx('mb-5 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm', left > 0 ? 'border-warn/40 bg-warn-soft text-warn' : 'border-bad/40 bg-bad-soft text-bad')}>
      <Pause className="size-4" />
      <b>{late.state === 'STILL_AWAY' ? `Late from break · ${late.lateMinutes} min` : 'Your day is paused'}</b>
      <span className="text-ink/70">{left > 0 ? `${mmss(left)} of lunch break left (${breakLabel(breakFor(me, db))})` : late.state === 'STILL_AWAY' ? breakFor(me, db).warnMessage : 'Lunch break ended — please resume your day'}</span>
      <Button size="sm" variant="success" icon={Play} className="ml-auto" onClick={() => run(() => resumeDay(me), 'Welcome back — day resumed')}>Resume my day</Button>
    </div>
  )
}

export function Section({ title, subtitle, icon, action, children, className }: { title: string; subtitle?: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('overflow-hidden anim-fade-up', className)}>
      <CardHeader title={title} subtitle={subtitle} icon={icon} action={action} />
      {children}
    </Card>
  )
}

export function ViewAll({ to, label = 'View all' }: { to: string; label?: string }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-xs font-bold text-brand-ink hover:underline">{label}<ArrowRight className="size-3.5" /></Link>
}

export function UpcomingEvents({ limit = 4 }: { limit?: number }) {
  const db = useDb()
  const list = useMemo(() => db.events.filter((e) => e.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, limit), [db.events, limit])
  const tone: Record<string, Tone> = { MEETING: 'navy', TRAINING: 'blue', HOLIDAY: 'red', DEADLINE: 'amber', CELEBRATION: 'orange' }
  return (
    <Section title="Upcoming events" icon={CalendarDays} action={<ViewAll to="/events" />}>
      {!list.length ? <EmptyState icon={CalendarDays} title="Nothing scheduled" /> : (
        <ul className="divide-y divide-line/70">
          {list.map((e) => {
            const d = new Date(e.date + 'T00:00:00')
            return (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid w-11 shrink-0 rounded-xl bg-card2 py-1 text-center leading-tight">
                  <span className="text-[10px] font-bold uppercase text-accent">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                  <span className="text-lg font-extrabold">{d.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.title}</span>
                  <span className="block truncate text-xs text-mute">{e.kind === 'HOLIDAY' ? 'All day' : e.time} · {e.description}</span>
                </span>
                <Badge tone={tone[e.kind]}>{e.kind.toLowerCase()}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

export function RecentActivity({ limit = 6, userIds }: { limit?: number; userIds?: string[] }) {
  const db = useDb()
  const list = db.audit.filter((a) => !userIds || userIds.includes(a.by)).slice(0, limit)
  return (
    <Section title="Recent activity" icon={Clock} action={<ViewAll to="/audit" />}>
      <ul className="divide-y divide-line/70">
        {list.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0 flex-1"><b>{userName(db, a.by)}</b> <span className="text-mute">{a.detail}</span></span>
            <span className="shrink-0 text-[11px] text-mute">{ago(a.at)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function MiniStat({ label, value, tone = 'navy', icon: Icon }: { label: string; value: ReactNode; tone?: Tone; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-card">
      <span className={cx('grid size-10 place-items-center rounded-xl', chip[tone])}><Icon className="size-5" /></span>
      <div className="min-w-0"><p className="truncate text-[11px] font-semibold text-mute">{label}</p><p className="text-lg font-extrabold tabular-nums">{value}</p></div>
    </div>
  )
}
