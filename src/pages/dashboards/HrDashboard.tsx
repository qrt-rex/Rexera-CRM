import { CalendarCheck2, Check, Megaphone, PartyPopper, UserCheck, UserMinus, UserPlus, Users, UsersRound, X, ScrollText, MessageSquare } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { canDecideLeave, decideLeave, userName } from '../../lib/actions'
import { attendanceWeek, presentToday } from '../../lib/metrics'
import { addDays, fmtDate, today, ymd } from '../../lib/format'
import { ROLES } from '../../lib/rbac'
import { Badge, Button, EmptyState, Stat, useRun } from '../../components/ui'
import { Donut, Ring } from '../../components/charts'
import { Greeting, LoginLogoutCard, Section, Tile, TileGrid, UpcomingEvents, ViewAll } from './widgets'

export function HrDashboard() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const att = presentToday(db)
  const t = today()
  const onLeave = db.leaves.filter((l) => l.status === 'APPROVED' && l.from <= t && l.to >= t).length
  const monthAgo = ymd(addDays(new Date(), -30))
  const joinees = db.users.filter((u) => u.joinedOn >= monthAgo)
  const pending = db.leaves.filter((l) => canDecideLeave(db, me, l))
  const week = attendanceWeek(db)
  const max = Math.max(1, ...week.map((w) => w.present + w.leave + w.absent))
  const dist = ROLES.map((r) => ({ label: r.label, value: db.users.filter((u) => u.role === r.id && u.active).length, color: r.color })).filter((x) => x.value)

  return (
    <div>
      <Greeting subtitle="HR · People, culture, growth — together!" right={<span className="text-5xl anim-float">🌤️</span>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total employees" value={db.users.filter((u) => u.active).length} icon={Users} tone="navy" />
        <div className="rounded-2xl border border-line bg-card p-4 shadow-card"><div className="flex items-center gap-3"><Ring value={(att.present / Math.max(1, att.total)) * 100} size={56} stroke={7} /><div><p className="text-xs font-semibold text-mute">Present today</p><p className="text-2xl font-extrabold">{att.present}<span className="text-sm text-mute"> / {att.total}</span></p></div></div></div>
        <Stat label="On leave today" value={onLeave} icon={UserMinus} tone="amber" />
        <Stat label="New joinees (30 days)" value={joinees.length} icon={UserPlus} tone="green" />
      </div>
      <TileGrid cols={4}>
        <Tile to="/employees" icon={UsersRound} label="Employees" tone="cyan" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance" tone="green" />
        <Tile to="/leave" icon={CalendarCheck2} label="Leave approvals" tone="violet" badge={pending.length} />
        <Tile to="/broadcasts" icon={Megaphone} label="Broadcasts" tone="red" />
        <Tile to="/events" icon={PartyPopper} label="Events" tone="pink" />
        <Tile to="/messages?tab=templates" icon={MessageSquare} label="Templates" tone="blue" />
        <Tile to="/audit" icon={ScrollText} label="Activity log" tone="gray" />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Attendance overview" subtitle="This week" icon={UserCheck} className="xl:col-span-2" action={<ViewAll to="/attendance" />}>
          <div className="flex h-56 items-end gap-3 p-5">
            {week.map((w) => (
              <div key={w.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-lg" style={{ height: 170 }}>
                  <div className="bg-ok transition-all duration-700" style={{ height: `${(w.present / max) * 100}%` }} title={`Present ${w.present}`} />
                  <div className="bg-warn" style={{ height: `${(w.leave / max) * 100}%` }} title={`Leave ${w.leave}`} />
                  <div className="bg-bad/70" style={{ height: `${(w.absent / max) * 100}%` }} title={`Absent ${w.absent}`} />
                </div>
                <span className="text-[11px] text-mute">{w.label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 px-5 pb-4 text-xs text-mute"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ok" />Present</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-warn" />Leave</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-bad/70" />Absent</span></div>
        </Section>
        <Section title="Employee distribution" icon={Users}><div className="p-5"><Donut data={dist} /></div></Section>
        <Section title="Leave requests" icon={CalendarCheck2} className="xl:col-span-2" action={<ViewAll to="/leave" />}>
          {!pending.length ? <EmptyState icon={Check} title="No pending requests" /> : (
            <ul className="divide-y divide-line/70">
              {pending.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{userName(db, l.userId)} <Badge tone="violet">{l.type}</Badge></p><p className="text-xs text-mute">{fmtDate(l.from)} → {fmtDate(l.to)} · {l.days} day(s) · {l.reason}</p></div>
                  <Button size="sm" variant="success" icon={Check} onClick={() => run(() => decideLeave(me, l.id, true, ''), 'Leave approved')}>Approve</Button>
                  <Button size="sm" variant="outline" icon={X} onClick={() => { const r = prompt('Reason for rejecting'); if (r) run(() => decideLeave(me, l.id, false, r), 'Leave rejected') }}>Reject</Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-6"><LoginLogoutCard /><UpcomingEvents limit={3} /></div>
      </div>
    </div>
  )
}
