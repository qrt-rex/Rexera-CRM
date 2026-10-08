import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlarmClock, Award, BarChart3, CalendarCheck2, CalendarDays, CalendarPlus, ChevronRight, ClipboardCheck, ClipboardList, FileText, FilePen as FileSignature, FolderOpen, GraduationCap, Mail, Megaphone, PieChart,
  UserCheck, UserMinus, UserPlus, Users, type LucideIcon,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth } from '../../lib/auth'
import { breakFor, breakLabel, breakPolicy, breakReview, clock, dateIn, lateBreakCount, userName, visibleBookings, workDay, type BreakState } from '../../lib/actions'
import { useMe } from '../../lib/auth'
import { addDays, fmtDate, today, ymd } from '../../lib/format'
import { Avatar, Badge, cx, Table, Td, Th } from '../../components/ui'
import { Bao, Cloud, Kabir, Meera, MiniLaptop, PaperPlane, Plant, Rexy, Twinkle } from '../../components/hr/Mascots'
import { LoginLogoutCard, useNow } from './widgets'

// ------------------------------------------------------------------ helpers
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function useCountUp(value: number, ms = 1000) {
  const [n, setN] = useState(() => (reduced() ? value : 0))
  useEffect(() => {
    if (reduced()) { setN(value); return }
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return n
}

const PASTEL = {
  blue: { card: 'from-sky-100 to-blue-50 dark:from-sky-500/15 dark:to-blue-500/5 border-sky-200/70 dark:border-sky-400/20', chip: 'bg-white/80 text-blue-600 dark:bg-white/10 dark:text-sky-300', tile: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  green: { card: 'from-emerald-100 to-green-50 dark:from-emerald-500/15 dark:to-green-500/5 border-emerald-200/70 dark:border-emerald-400/20', chip: 'bg-white/80 text-emerald-600 dark:bg-white/10 dark:text-emerald-300', tile: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  pink: { card: 'from-pink-100 to-rose-50 dark:from-pink-500/15 dark:to-rose-500/5 border-pink-200/70 dark:border-pink-400/20', chip: 'bg-white/80 text-pink-600 dark:bg-white/10 dark:text-pink-300', tile: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300' },
  violet: { card: 'from-violet-100 to-purple-50 dark:from-violet-500/15 dark:to-purple-500/5 border-violet-200/70 dark:border-violet-400/20', chip: 'bg-white/80 text-violet-600 dark:bg-white/10 dark:text-violet-300', tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  amber: { card: '', chip: '', tile: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  sky: { card: '', chip: '', tile: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300' },
  emerald: { card: '', chip: '', tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
  rose: { card: '', chip: '', tile: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
}
type Pastel = keyof typeof PASTEL

function Panel({ title, icon: Icon, action, children, className, chip }: { title: string; icon: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; chip?: string }) {
  return (
    <section className={cx('relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card anim-fade-up', className)}>
      <header className="flex items-center gap-3 px-5 pb-2 pt-4">
        <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand-ink"><Icon className="size-[18px]" /></span>
        <h2 className="flex-1 text-[15px] font-bold">{title}</h2>
        {chip && <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{chip}</span>}
        {action}
      </header>
      {children}
    </section>
  )
}
const ViewAll = ({ to, label = 'View All' }: { to: string; label?: string }) => <Link to={to} className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-ink hover:underline">{label}<ChevronRight className="size-3.5" /></Link>
const Empty = ({ text }: { text: string }) => <p className="px-5 py-8 text-center text-sm text-mute">{text}</p>

// ------------------------------------------------------------------ page
export function HrDashboard() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const t = today()
  const h = new Date().getHours()
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'

  const data = useMemo(() => {
    const active = db.users.filter((u) => u.active)
    const sessionsToday = db.sessions.filter((s) => s.date === t && active.some((u) => u.id === s.userId))
    const minutes = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
    const late = sessionsToday.filter((s) => minutes(s.loginAt) > 9 * 60 + 30).length
    const half = sessionsToday.filter((s) => s.logoutAt && (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 3600000 < 5).length
    const onLeave = db.leaves.filter((l) => l.status === 'APPROVED' && l.from <= t && l.to >= t).length
    const pending = db.leaves.filter((l) => l.status === 'PENDING').length
    const monthStart = t.slice(0, 8) + '01'
    const joinees = active.filter((u) => u.joinedOn >= monthStart)
    const departments = new Set(active.map((u) => u.department)).size

    // this week, Monday → Saturday
    const now = new Date()
    const monday = addDays(now, -((now.getDay() + 6) % 7))
    const week = Array.from({ length: 6 }, (_, i) => {
      const d = ymd(addDays(monday, i))
      const future = d > t
      const present = future ? 0 : new Set(db.sessions.filter((s) => s.date === d).map((s) => s.userId)).size
      const leave = future ? 0 : db.leaves.filter((l) => l.status === 'APPROVED' && l.from <= d && l.to >= d).length
      return { d, label: addDays(monday, i).toLocaleDateString('en-IN', { weekday: 'short' }), present, leave, absent: future ? 0 : Math.max(0, active.length - present - leave), future, isToday: d === t }
    })

    const byDept = new Map<string, number>()
    for (const u of active) byDept.set(u.department, (byDept.get(u.department) ?? 0) + 1)
    const sorted = [...byDept.entries()].sort((a, b) => b[1] - a[1])
    const dist = sorted.slice(0, 6).map(([label, value]) => ({ label, value }))
    const others = sorted.slice(6).reduce((s, [, v]) => s + v, 0)
    if (others) dist.push({ label: 'Others', value: others })

    return {
      active, present: sessionsToday.length, late, half, onLeave, pending, joinees, departments, week, dist,
      leaves: [...db.leaves].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
      events: db.events.filter((e) => e.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 4),
      recent: [...active].sort((a, b) => b.joinedOn.localeCompare(a.joinedOn)).slice(0, 4),
      docs: visibleBookings(db, me).flatMap((b) => b.documents.map((d) => ({ ...d, client: b.companyName, bookingId: b.id }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
    }
  }, [db, me, t])

  const canPeople = can('employees.view', 'employees.manage')
  const canAttendance = can('attendance.all')
  const canLeave = can('leave.approve')
  const canDocs = can('documents.forms')

  return (
    <div className="space-y-6">
      {/* 1. greeting banner */}
      <section className="relative overflow-hidden rounded-3xl border border-sky-200/60 bg-gradient-to-br from-sky-100 via-indigo-50 to-violet-100 px-6 pt-6 dark:border-white/10 dark:from-sky-950 dark:via-indigo-950 dark:to-violet-950 sm:px-8">
        <Cloud className="m-drift pointer-events-none absolute left-[38%] top-4 w-16 text-white/90 dark:text-white/10" />
        <Cloud className="m-drift pointer-events-none absolute right-[30%] top-10 hidden w-12 text-white/80 dark:text-white/10 md:block" style={{ animationDelay: '-3s' }} />
        <PaperPlane className="m-plane pointer-events-none absolute left-[52%] top-6 hidden w-9 md:block" />
        <Twinkle className="pointer-events-none absolute left-[44%] bottom-8 w-3 text-amber-400" />
        <Twinkle heart className="pointer-events-none absolute left-[30%] top-6 w-3.5 text-pink-400" style={{ animationDelay: '-.8s' }} />
        <Twinkle className="pointer-events-none absolute right-6 top-6 w-3 text-violet-400" style={{ animationDelay: '-1.4s' }} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="pb-6 lg:max-w-md lg:pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700/80 dark:text-sky-300/80">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="mt-2 text-2xl font-extrabold leading-tight text-[#1B2559] dark:text-white sm:text-3xl">
              Good {part}, HR Team! <span className="m-hand" aria-hidden="true">👋</span>
            </h1>
            <p className="mt-2 text-sm text-[#1B2559]/75 dark:text-white/75">Let's build a happy and productive workplace together.</p>
          </div>
          {/* scene */}
          <div className="relative mx-auto h-44 w-full max-w-[460px] shrink-0 sm:h-48 lg:ml-auto lg:mr-0" aria-hidden="true">
            <div className="absolute right-0 top-0 z-10 max-w-[190px] rounded-2xl border-[3px] border-[#1B2559] bg-white px-3 py-2 text-xs font-extrabold leading-snug text-[#1B2559] shadow-[4px_4px_0_#1B2559] dark:border-white dark:bg-[#1B2559] dark:text-white dark:shadow-[4px_4px_0_#fff]">
              People Culture Growth Together! <span className="text-pink-500">♥</span>
            </div>
            <MiniLaptop className="absolute bottom-0 left-0 w-24 sm:w-28" />
            <div className="m-peek absolute bottom-0 left-[26%] h-36 w-36 sm:h-40 sm:w-40" style={{ animationDelay: '.2s' }}>
              <div className="m-bob h-full w-full"><Kabir pose="chin" className="h-full w-full" /></div>
            </div>
            <div className="m-peek absolute -bottom-3 right-[22%] h-20 w-24 overflow-hidden sm:h-24 sm:w-28" style={{ animationDelay: '.6s' }}>
              <Bao pose="peek" className="h-full w-full" />
            </div>
            <Plant className="absolute bottom-0 right-0 w-12 sm:w-14" />
          </div>
        </div>
      </section>

      {/* 2. KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi to="/employees" tone="blue" icon={Users} label="Total Employees" value={data.active.length} hint={`Across ${data.departments} departments · no interns on record`} delay={0}
          mascot={<Rexy pose="wave" className="h-full w-full" />} />
        <Kpi to="/attendance" tone="green" icon={UserCheck} label="Present Today" value={data.present} delay={80}
          hint={`${data.late} late · ${data.half} half-day`} ring={(data.present / Math.max(1, data.active.length)) * 100}
          mascot={<Kabir pose="stand" className="h-full w-full" />} />
        <Kpi to="/leave" tone="pink" icon={UserMinus} label="On Leave" value={data.onLeave} hint={`${data.pending} request${data.pending === 1 ? '' : 's'} pending`} delay={160}
          mascot={<Bao className="h-full w-full" />} />
        <Kpi to="/employees" tone="violet" icon={UserPlus} label="New Joinees This Month" value={data.joinees.length} delay={240}
          hint={data.joinees.length ? data.joinees.map((u) => u.name.split(' ')[0]).slice(0, 3).join(', ') : 'Nobody has joined yet this month'}
          mascot={<Meera className="h-full w-full" />} />
      </div>

      {canAttendance && <LateBreakAlerts />}

      {/* 3. middle row */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {canAttendance && <AttendanceOverview week={data.week} />}
        {canLeave && (
          <Panel title="Leave Requests" icon={CalendarCheck2} action={<ViewAll to="/leave" />}>
            {!data.leaves.length ? <Empty text="No leave requests yet." /> : (
              <ul className="divide-y divide-line/70 px-2 pb-2">
                {data.leaves.map((l) => {
                  const u = db.users.find((x) => x.id === l.userId)
                  return (
                    <li key={l.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-card2">
                      <Avatar name={u?.name ?? '?'} photo={u?.photo} size={38} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{u?.name ?? 'Unknown'}</p>
                        <p className="truncate text-xs text-mute">{l.type} · {l.days} day{l.days === 1 ? '' : 's'} · {new Date(l.from + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                      </div>
                      <Badge tone={l.status === 'APPROVED' ? 'green' : l.status === 'PENDING' ? 'amber' : l.status === 'REJECTED' ? 'red' : 'gray'}>{l.status[0] + l.status.slice(1).toLowerCase()}</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        )}
        <Panel title="Upcoming Events" icon={CalendarDays} action={<ViewAll to="/events" />} className="lg:col-span-2 xl:col-span-1">
          <div className="m-peek-x pointer-events-none absolute right-0 top-1/2 hidden h-16 w-20 sm:block" style={{ transform: 'translateX(28%)' }} aria-hidden="true">
            <div className="h-full w-full -rotate-12"><Rexy pose="peek" className="h-full w-full" /></div>
          </div>
          {!data.events.length ? <Empty text="No upcoming events." /> : (
            <ul className="space-y-2 px-4 pb-4 pr-16">
              {data.events.map((e, i) => {
                const d = new Date(e.date + 'T00:00:00')
                const tones: Pastel[] = ['sky', 'pink', 'amber', 'violet']
                return (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-card2">
                    <span className={cx('grid w-12 shrink-0 rounded-xl py-1.5 text-center leading-tight', PASTEL[tones[i % 4]!].tile)}>
                      <span className="text-lg font-extrabold">{d.getDate()}</span>
                      <span className="text-[10px] font-bold uppercase">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{e.title}</span>
                      <span className="block truncate text-xs text-mute">{e.kind === 'HOLIDAY' ? 'All day' : new Date(`2000-01-01T${e.time}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {e.kind.toLowerCase()}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* 4. quick actions + login card */}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <QuickActions />
        <LoginLogoutCard />
      </div>

      {/* 5. bottom row */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {canPeople && <Distribution dist={data.dist} total={data.active.length} />}
        {canPeople && (
          <Panel title="Recent Joinees" icon={UserPlus} action={<ViewAll to="/employees" />}>
            {!data.recent.length ? <Empty text="No employees yet." /> : (
              <ul className="divide-y divide-line/70 px-2 pb-2">
                {data.recent.map((u) => (
                  <li key={u.id}>
                    <Link to={`/employees?open=${u.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-card2">
                      <Avatar name={u.name} photo={u.photo} size={38} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-xs text-mute">{u.designation}</span></span>
                      <span className="text-xs font-medium text-mute">{fmtDate(u.joinedOn)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        {canDocs && (
          <Panel title="Important Documents" icon={FileText} action={<ViewAll to="/documents" />}>
            {!data.docs.length ? <Empty text="No documents yet." /> : (
              <ul className="space-y-1 px-3 pb-28">
                {data.docs.map((d) => {
                  const ext = (d.name.split('.').pop() ?? '').toUpperCase()
                  const tone = ext === 'PDF' ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300' : /DOCX?/.test(ext) ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' : /XLSX?|CSV/.test(ext) ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'
                  return (
                    <li key={d.id}>
                      <Link to={`/bookings/${d.bookingId}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-card2">
                        <span className={cx('grid h-9 w-11 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold', tone)}>{ext || 'FILE'}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{d.name}</span><span className="block truncate text-xs text-mute">{d.client} · {userName(db, d.by)}</span></span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="pointer-events-none absolute bottom-1 right-3 h-28 w-24" aria-hidden="true"><Rexy pose="sign" className="h-full w-full" /></div>
          </Panel>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ KPI card
function Kpi({ to, tone, icon: Icon, label, value, hint, mascot, delay, ring }: {
  to: string; tone: Pastel; icon: LucideIcon; label: string; value: number; hint: string; mascot: ReactNode; delay: number; ring?: number
}) {
  const n = useCountUp(value)
  const p = PASTEL[tone]
  return (
    <Link to={to} className={cx('group relative block min-h-40 overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-card transition hover:-translate-y-1 hover:shadow-pop anim-fade-up', p.card)}
      style={{ animationDelay: `${delay}ms` }}>
      <span className={cx('grid size-11 place-items-center rounded-xl shadow-sm', p.chip)}><Icon className="size-5" /></span>
      <p className="mt-3 text-sm font-semibold text-ink/75">{label}</p>
      <div className="mt-0.5 flex items-center gap-3">
        <p className="text-4xl font-extrabold tabular-nums tracking-tight">{n}</p>
        {ring !== undefined && <MiniRing value={ring} />}
      </div>
      <p className="mt-1 max-w-[62%] text-xs text-mute">{hint}</p>
      <div className="m-rise pointer-events-none absolute -bottom-1 right-2 h-24 w-20 sm:h-28 sm:w-24" style={{ animationDelay: `${delay + 350}ms` }}>
        <div className="h-full w-full origin-bottom transition-transform duration-300 group-hover:rotate-6">{mascot}</div>
      </div>
    </Link>
  )
}

function MiniRing({ value }: { value: number }) {
  const r = 15, c = 2 * Math.PI * r
  return (
    <span className="relative grid size-11 place-items-center" title={`${Math.round(value)}% of employees`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-white/80 dark:text-white/10" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="#0E9F6E" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} className="m-draw" style={{ animationDuration: '1.1s' }} />
      </svg>
      <span className="text-[10px] font-extrabold">{Math.round(value)}%</span>
    </span>
  )
}

// ------------------------------------------------------------------ late break alerts
const BREAK_BADGE: Record<BreakState, { label: string; tone: 'green' | 'red' | 'amber' | 'gray' }> = {
  STILL_AWAY: { label: 'Still Away', tone: 'red' }, LATE: { label: 'Late', tone: 'amber' }, ON_BREAK: { label: 'On break', tone: 'gray' },
  ON_TIME: { label: 'On Time', tone: 'green' }, NONE: { label: '—', tone: 'gray' },
}
const BREAK_ORDER: BreakState[] = ['STILL_AWAY', 'LATE', 'ON_BREAK', 'ON_TIME', 'NONE']

function LateBreakAlerts() {
  const db = useDb()
  const now = useNow(true, 30000)
  const [all, setAll] = useState(false)
  // each person's "today" and times follow their own shift time zone
  const rows = useMemo(() => db.users
    .filter((u) => u.active)
    .flatMap((u) => {
      const p = breakFor(u, db), tz = p.timeZone, date = dateIn(now, tz)
      // not scheduled (off day) or on approved leave: no late-break alert
      if (!workDay(date, p) || db.leaves.some((l) => l.userId === u.id && l.status === 'APPROVED' && l.from <= date && l.to >= date)) return []
      const s = db.sessions.find((x) => x.userId === u.id && x.date === date)
      return s?.breaks?.length ? [{ s, u, tz, r: breakReview(s, now), before: lateBreakCount(db, u.id, s.date) }] : []
    })
    .sort((a, b) => BREAK_ORDER.indexOf(a.r.state) - BREAK_ORDER.indexOf(b.r.state) || b.r.lateMinutes - a.r.lateMinutes), [db, now])
  const at = (iso: string | undefined, tz: string) => (iso ? clock(new Date(iso).getTime(), tz) : '—')
  const late = rows.filter((x) => x.r.state === 'LATE' || x.r.state === 'STILL_AWAY')
  const away = late.filter((x) => x.r.state === 'STILL_AWAY').length
  const shown = all ? rows : late
  return (
    <Panel title="Late Break Alerts — Today" icon={AlarmClock} chip={late.length ? `${late.length} late${away ? ` · ${away} away` : ''}` : undefined}
      action={<span className="flex items-center gap-3">
        {rows.length > late.length && <button className="text-xs font-bold text-brand-ink hover:underline" onClick={() => setAll(!all)}>{all ? 'Late only' : `Show all ${rows.length}`}</button>}
        <ViewAll to="/break-settings" label="Settings" />
      </span>}>
      {!shown.length ? <Empty text={rows.length ? 'Everyone came back from break on time today.' : `No breaks taken yet today (break ${breakLabel(breakPolicy(db))}).`} /> : (
        <Table className="pb-2">
          <thead><tr><Th>Employee</Th><Th>Break</Th><Th>Expected return</Th><Th>Actual return</Th><Th>Late by</Th><Th>Status</Th><Th className="text-right">Earlier late breaks</Th></tr></thead>
          <tbody>
            {shown.map(({ s, u, tz, r, before }) => (
              <tr key={s.id} className={cx(r.state === 'STILL_AWAY' && 'bg-bad-soft/40')}>
                <Td><span className="flex items-center gap-2.5"><Avatar name={u.name} photo={u.photo} size={32} /><span className="min-w-0"><span className="block truncate font-semibold">{u.name}</span><span className="block truncate text-xs text-mute">{u.department || '—'}{u.shift ? ' · own shift' : ''}</span></span></span></Td>
                <Td className="tabular-nums">{at(r.breakStart, tz)}</Td>
                <Td className="tabular-nums">{r.expected ? clock(r.expected, tz) : '—'}</Td>
                <Td className="tabular-nums">{at(r.returnedAt, tz)}</Td>
                <Td className={cx('font-bold tabular-nums', r.lateMinutes ? 'text-bad' : 'text-mute')}>{r.state === 'STILL_AWAY' ? `${r.lateMinutes}+ min` : r.lateMinutes ? `${r.lateMinutes} min` : '—'}</Td>
                <Td><Badge tone={BREAK_BADGE[r.state].tone} dot={r.state === 'STILL_AWAY'}>{BREAK_BADGE[r.state].label}</Badge>{s.lateBreak?.warnedAt && <span className="mt-0.5 block text-[10px] text-mute">warned {at(s.lateBreak.warnedAt, tz)}</span>}</Td>
                <Td className="text-right font-bold tabular-nums">{before}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------ attendance overview
function AttendanceOverview({ week }: { week: { d: string; label: string; present: number; leave: number; absent: number; future: boolean; isToday: boolean }[] }) {
  const max = Math.max(1, ...week.map((w) => w.present + w.leave + w.absent))
  const H = 150
  return (
    <Panel title="Attendance Overview" icon={BarChart3} chip="This Week" action={<ViewAll to="/attendance" />}>
      <div className="flex items-end gap-2 px-5 pt-4 sm:gap-3" style={{ height: H + 48 }}>
        {week.map((w, i) => {
          const total = w.present + w.leave + w.absent
          const seg = (v: number) => (v / max) * H
          return (
            <div key={w.d} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] font-bold tabular-nums">{w.future ? '' : total}</span>
              <div className="m-grow flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-lg" style={{ height: Math.max(4, seg(total)), animationDelay: `${i * 120}ms` } as CSSProperties}
                title={w.future ? 'Upcoming' : `Present ${w.present} · Leave ${w.leave} · Absent ${w.absent}`}>
                {w.future ? <div className="h-full bg-line/60" /> : <>
                  <div className="bg-emerald-500" style={{ height: seg(w.present) }} />
                  <div className="bg-pink-400" style={{ height: seg(w.leave) }} />
                  <div className="bg-slate-300 dark:bg-slate-600" style={{ height: seg(w.absent) }} />
                </>}
              </div>
              <span className={cx('rounded-full px-1.5 text-[11px]', w.isToday ? 'bg-accent font-bold text-white' : 'text-mute')}>{w.label}</span>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-4 px-5 pb-5 pt-3 pr-36 text-xs text-mute">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-emerald-500" />Present</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-pink-400" />Leave</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" />Absent</span>
      </div>
      <div className="pointer-events-none absolute bottom-1 right-2 h-16 w-28" aria-hidden="true"><Kabir pose="laptop" className="h-full w-full" /></div>
    </Panel>
  )
}

// ------------------------------------------------------------------ distribution donut
const DONUT = ['#2E3A8C', '#F47B20', '#0E9F6E', '#DB2777', '#7C3AED', '#0891B2', '#94A3B8']
function Distribution({ dist, total }: { dist: { label: string; value: number }[]; total: number }) {
  const r = 40, c = 2 * Math.PI * r
  let off = 0
  return (
    <Panel title="Employee Distribution" icon={PieChart}>
      {!total ? <Empty text="No employees yet." /> : (
        <div className="flex flex-wrap items-center gap-5 px-5 pb-24 pt-2">
          <div className="relative size-40 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${total} employees by department`}>
              <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="13" />
              {dist.map((d, i) => {
                const len = (d.value / total) * c
                const el = <circle key={d.label} cx="50" cy="50" r={r} fill="none" stroke={DONUT[i % DONUT.length]} strokeWidth="13"
                  strokeDasharray={`${Math.max(0, len - 1.2)} ${c}`} strokeDashoffset={-off} className="m-draw" style={{ animationDelay: `${i * 160}ms` }} />
                off += len
                return el
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center leading-tight">
              <span><span className="block text-2xl font-extrabold">{total}</span><span className="text-[11px] text-mute">Employees</span></span>
            </div>
          </div>
          <ul className="min-w-40 flex-1 space-y-1.5 text-xs">
            {dist.map((d, i) => (
              <li key={d.label} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: DONUT[i % DONUT.length] }} />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="font-bold tabular-nums">{d.value}</span>
                <span className="w-9 text-right tabular-nums text-mute">{Math.round((d.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1 right-2 h-24 w-24" aria-hidden="true"><Bao pose="laptop" className="h-full w-full" /></div>
    </Panel>
  )
}

// ------------------------------------------------------------------ quick actions
function QuickActions() {
  const { can } = useAuth()
  const items: { to: string; label: string; icon: LucideIcon; tone: Pastel; show: boolean }[] = [
    { to: '/employees?new=1', label: 'Add Employee', icon: UserPlus, tone: 'blue', show: can('employees.manage', 'access.manage') },
    { to: '/letters?type=joining', label: 'Joining Letter', icon: FileSignature, tone: 'violet', show: can('employees.manage') },
    { to: '/letters?type=internship', label: 'Internship Letter', icon: GraduationCap, tone: 'sky', show: can('employees.manage') },
    { to: '/letters?type=experience', label: 'Experience Letter', icon: Award, tone: 'emerald', show: can('employees.manage') },
    { to: '/candidates', label: 'Candidate Form', icon: ClipboardList, tone: 'amber', show: can('recruitment.manage') },
    { to: '/attendance', label: 'Mark Attendance', icon: UserCheck, tone: 'green', show: true },
    { to: '/leave?new=1', label: 'Apply Leave', icon: CalendarPlus, tone: 'pink', show: true },
    { to: '/leave', label: 'Approve Leave', icon: ClipboardCheck, tone: 'amber', show: can('leave.approve') },
    { to: '/broadcasts', label: 'Create Announcement', icon: Megaphone, tone: 'violet', show: can('broadcasts.manage') },
    { to: '/email-center', label: 'Send Email', icon: Mail, tone: 'rose', show: can('email.send') },
    { to: '/documents', label: 'Manage Documents', icon: FolderOpen, tone: 'emerald', show: can('documents.forms') },
    { to: '/reports?tab=cards', label: 'View Reports', icon: BarChart3, tone: 'sky', show: can('reports.view') },
  ]
  const shown = items.filter((i) => i.show)
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-card anim-fade-up">
      <h2 className="mb-4 text-[15px] font-bold">Quick Actions</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3">
        {shown.map((a) => (
          <Link key={a.label} to={a.to} className={cx('m-wiggle-hover flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center text-xs font-bold transition hover:-translate-y-0.5 hover:shadow-card', PASTEL[a.tone].tile)}>
            <a.icon className="m-wiggle-target size-6" />
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  )
}
