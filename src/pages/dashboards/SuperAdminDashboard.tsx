import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, Bell, Briefcase, CalendarDays, ChevronRight, Download, Eye, FileBarChart, FileText, Home, IndianRupee, KeyRound,
  LayoutDashboard, Megaphone, MessageSquare, MessagesSquare, PieChart, Settings, Sparkles, TrendingUp, UserCheck, UserCog, UserPlus,
  Users, UsersRound, Images, Workflow, Trophy,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { collections, invoiceSummary, monthStart, presentToday, revenueByMonth, todaySession } from '../../lib/metrics'
import { BOOKING_STATUS } from '../../lib/workflow'
import { fmtDate, fmtTime, inr, inrShort, today } from '../../lib/format'
import { ROLES, rolesOf } from '../../lib/rbac'
import { Avatar, Card, cx, Progress } from '../../components/ui'
import { Bars, Donut, HBars } from '../../components/charts'
import { useUnread } from '../../layout/Shell'
import { RecentActivity, Section, Tile } from './widgets'

export function SuperAdminDashboard() {
  const db = useDb()
  const me = useMe()
  const unread = useUnread()
  const s = todaySession(db, me.id)
  const att = presentToday(db)
  const inv = invoiceSummary(db)
  const rev = revenueByMonth(db)
  const thisMonth = rev[rev.length - 1]?.value ?? 0
  const lastMonth = rev[rev.length - 2]?.value ?? 0
  const growth = lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0
  const todays = db.events.filter((e) => e.date === today())
  const pipeline = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of db.bookings) m.set(b.status, (m.get(b.status) ?? 0) + 1)
    const colors: Record<string, string> = { pink: '#DB2777', amber: '#B45309', orange: '#F47B20', violet: '#7C3AED', cyan: '#0891B2', blue: '#2563EB', green: '#0E9F6E', red: '#DC2626' }
    return [...m.entries()].map(([k, v]) => { const st = BOOKING_STATUS[k as keyof typeof BOOKING_STATUS]; return { label: st.label, value: v, color: colors[st.tone] } })
  }, [db.bookings])
  const performers = useMemo(() => db.users.filter((u) => rolesOf(u).some((r) => r === 'sales' || r === 'teamlead'))
    .map((u) => ({ label: u.name, value: collections(db, [u.id], monthStart()) })).sort((a, b) => b.value - a.value).slice(0, 5), [db])

  const tiles = [
    { to: '/leads', icon: Users, label: 'Leads', desc: 'Manage all leads', tone: 'navy' as const },
    { to: '/events', icon: CalendarDays, label: 'All Event', desc: 'Create / view / edit events', tone: 'violet' as const },
    { to: '/schemes', icon: FileText, label: 'Schemes', desc: 'Option / add schemes', tone: 'green' as const },
    { to: '/employees', icon: UserCog, label: 'Employee Details', desc: 'View / edit employee', tone: 'red' as const },
    { to: '/content', icon: Images, label: 'Flyer & Post', desc: 'Create / edit / view posts', tone: 'amber' as const },
    { to: '/access?tab=users', icon: UsersRound, label: 'Employee Accounts', desc: 'Logins, roles, teams', tone: 'cyan' as const },
    { to: '/bookings', icon: Briefcase, label: 'Client Details / Funding Work', desc: 'Client funding work & process', tone: 'cyan' as const },
    { to: '/team', icon: BarChart3, label: 'Sales View Process', desc: 'Sales process & tracking', tone: 'pink' as const },
    { to: '/attendance', icon: Eye, label: 'HR View Process', desc: 'Attendance, leave & people', tone: 'violet' as const },
    { to: '/access', icon: KeyRound, label: 'Access Manage', desc: 'Role & permission management', tone: 'green' as const },
    { to: '/messages?tab=templates', icon: MessageSquare, label: 'Create a Template Message', desc: 'Manage template messages', tone: 'blue' as const },
    { to: '/broadcasts', icon: Megaphone, label: 'New Update by Company', desc: 'Create & view updates', tone: 'orange' as const },
    { to: '/work', icon: Workflow, label: 'Admin Process', desc: 'Client work processing', tone: 'violet' as const },
    { to: '/reports?tab=cards', icon: FileBarChart, label: 'Report Card Generate', desc: 'Reports card & analysis', tone: 'navy' as const },
    { to: '/messages', icon: MessagesSquare, label: 'Message to Message', desc: 'Internal messaging system', tone: 'red' as const },
    { to: '/access?tab=roles', icon: Settings, label: 'All Role Setting', desc: 'Roles, permissions & settings', tone: 'navy' as const },
  ]

  return (
    <div>
      {/* top row */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex divide-x divide-line p-4">
          <div className="flex-1 pr-3"><p className="text-[11px] font-semibold text-mute">Login Time</p><p className="text-xl font-extrabold">{fmtTime(s?.loginAt)}</p><p className="text-[11px] text-mute">{fmtDate(today())}</p></div>
          <div className="flex-1 pl-3"><p className="text-[11px] font-semibold text-mute">Logout Time</p><p className="text-xl font-extrabold">{fmtTime(s?.logoutAt)}</p><p className="text-[11px] text-mute">{s?.logoutAt ? 'Day ended' : 'Not yet logout'}</p></div>
        </Card>
        <Link to="/events"><Card className="flex h-full items-center gap-3 p-4 transition hover:shadow-pop">
          <span className="grid size-11 place-items-center rounded-xl bg-info-soft text-info"><CalendarDays className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-mute">Calendar</p><p className="font-extrabold">{fmtDate(today())}</p><p className="truncate text-[11px] text-mute">{todays.length ? todays.map((e) => e.title).join(', ') : "No events today"}</p></div>
          <span className="rounded-lg bg-info-soft px-2 py-1 text-[11px] font-bold text-info">View</span>
        </Card></Link>
        <Link to="/billing"><Card className="flex h-full items-center gap-3 p-4 transition hover:shadow-pop">
          <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><IndianRupee className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-mute">Invoice / Bill</p><p className="text-xl font-extrabold">{inr(inv.billed)}</p><p className="text-[11px] text-mute">Collected {inrShort(inv.collected)}</p></div>
          <span className={cx('text-xs font-bold', growth >= 0 ? 'text-ok' : 'text-bad')}>{growth >= 0 ? '↑' : '↓'} {Math.abs(growth)}%</span>
        </Card></Link>
        <Link to="/attendance"><Card className="h-full p-4 transition hover:shadow-pop">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300"><UserCheck className="size-5" /></span>
            <div><p className="text-[11px] font-semibold text-mute">Attendance Board · present today</p><p className="text-xl font-extrabold">{att.present} / {att.total}</p></div></div>
          <div className="mt-2 flex items-center gap-2"><Progress value={(att.present / Math.max(1, att.total)) * 100} tone="green" /><span className="text-[11px] font-bold">{Math.round((att.present / Math.max(1, att.total)) * 100)}%</span></div>
        </Card></Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {tiles.map((t) => <Tile key={t.label} {...t} />)}
        </div>
        <aside className="space-y-4">
          <Card className="overflow-hidden">
            <p className="flex items-center gap-2 border-b border-line px-4 py-3 font-bold"><PieChart className="size-5 text-brand-ink" />Reports</p>
            {[['Export Data', Download, '/reports?tab=export'], ['Service Reports', FileText, '/reports?tab=services'], ['Company Report', Briefcase, '/reports'], ['Dashboard Report', LayoutDashboard, '/reports?tab=cards'], ['Profit Reports', TrendingUp, '/reports?tab=revenue']].map(([l, I, to]) => {
              const Icon = I as typeof Home
              return <Link key={l as string} to={to as string} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-sm last:border-0 hover:bg-card2"><Icon className="size-4 text-mute" /><span className="flex-1">{l as string}</span><ChevronRight className="size-4 text-mute" /></Link>
            })}
          </Card>
          <Card className="overflow-hidden">
            <p className="border-b border-line bg-brand-soft px-4 py-3 font-bold text-brand-ink">All dashboards</p>
            {ROLES.map((r) => (
              <Link key={r.id} to={`/dashboard/${r.id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-card2">
                <span className="size-2.5 rounded-full" style={{ background: r.color }} />{r.label}
              </Link>
            ))}
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/settings"><Card className="grid place-items-center gap-1 p-4 text-center transition hover:shadow-pop"><Avatar name={me.name} photo={me.photo} size={48} /><p className="text-xs font-bold">Profile</p><p className="text-[10px] text-mute">With DP</p></Card></Link>
            <Link to="/notifications"><Card className="relative grid place-items-center gap-1 p-4 text-center transition hover:shadow-pop">
              <span className="relative grid size-12 place-items-center rounded-full bg-brand-soft text-brand-ink"><Bell className="size-6" />{unread.notices.length > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-bad text-[10px] font-bold text-white">{unread.notices.length}</span>}</span>
              <p className="text-xs font-bold">Notification</p></Card></Link>
          </div>
        </aside>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Collections · last 6 months" icon={TrendingUp} className="xl:col-span-2">
          <div className="p-5"><Bars data={rev} format={inrShort} highlightLast height={210} /></div>
        </Section>
        <Section title="Client files by status" icon={Sparkles}><div className="p-5"><Donut data={pipeline} label="Files by status" /></div></Section>
        <Section title="Top performers this month" icon={Trophy}><div className="p-5"><HBars data={performers} format={inrShort} /></div></Section>
        <div className="xl:col-span-2"><RecentActivity limit={7} /></div>
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-mute"><UserPlus className="size-3.5" />Tip: open any role’s dashboard from “All dashboards” to see exactly what that team sees.</p>
    </div>
  )
}
