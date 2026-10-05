import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronRight, Clock, Eye, LogIn, LogOut, Play, Square, type LucideIcon } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { endDay, startDay, userName } from '../../lib/actions'
import { todaySession } from '../../lib/metrics'
import { ago, fmtDate, fmtTime, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import type { Tone } from '../../lib/workflow'
import { Badge, Button, Card, CardHeader, cx, EmptyState, useRun } from '../../components/ui'

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
      <span className={cx('grid size-12 shrink-0 place-items-center rounded-2xl transition group-hover:scale-105', highlight ? 'bg-accent text-white anim-ring' : chip[tone])}><Icon className="size-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cx('truncate font-bold', highlight ? 'text-lg' : 'text-[15px]')}>{label}</span>
          {viewOnly && <span title="View only" className="inline-flex items-center gap-1 rounded-full bg-card2 px-1.5 py-0.5 text-[10px] font-semibold text-mute"><Eye className="size-3" />view</span>}
        </span>
        {desc && <span className="block truncate text-xs text-mute">{desc}</span>}
      </span>
      {badge !== undefined && badge !== 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-2 text-[11px] font-bold text-white">{badge}</span>}
      <ChevronRight className="size-5 shrink-0 text-mute transition group-hover:translate-x-0.5 group-hover:text-ink" />
    </>
  )
  const cls = cx('group flex items-center gap-4 rounded-2xl border bg-card p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop',
    highlight ? 'border-2 border-ink shadow-[5px_5px_0_var(--ink)] hover:shadow-[7px_7px_0_var(--ink)] dark:border-accent dark:shadow-none' : 'border-line', className)
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button onClick={onClick} className={cls}>{inner}</button>
}

export function TileGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' }[cols]
  return <div className={cx('grid gap-4', c)}>{children}</div>
}

export function LoginLogoutCard({ className }: { className?: string }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const s = todaySession(db, me.id)
  const hours = s ? ((s.logoutAt ? new Date(s.logoutAt).getTime() : Date.now()) - new Date(s.loginAt).getTime()) / 3600000 : 0
  return (
    <Card className={cx('p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Clock className="size-[18px] text-info" />
        <h3 className="flex-1 text-sm font-bold">Login – Logout Time</h3>
        {s && !s.logoutAt && <Badge tone="green" dot>Working · {hours.toFixed(1)} h</Badge>}
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
      <div className="mt-3">
        {!s || s.logoutAt
          ? <Button size="sm" variant="success" icon={Play} className="w-full" onClick={() => run(() => startDay(me), s ? 'Day resumed' : 'Day started')}>{s ? 'Resume my day' : 'Start my day'}</Button>
          : <Button size="sm" variant="outline" icon={Square} className="w-full" onClick={() => run(() => endDay(me), 'Day ended. See you tomorrow!')}>End my day</Button>}
      </div>
    </Card>
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
