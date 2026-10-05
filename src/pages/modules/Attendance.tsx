import { useMemo, useState } from 'react'
import { CalendarRange, Coffee, Download, LogOut, UserCheck, UserX, Users } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { dayStatus, presentToday } from '../../lib/metrics'
import { addDays, downloadCsv, fmtDate, fmtTime, today, ymd } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Avatar, Badge, Button, Card, CardHeader, cx, PageHeader, SearchBox, Table, Tabs, Td, Th } from '../../components/ui'
import { LoginLogoutCard, MiniStat } from '../dashboards/widgets'

const STATUS = {
  WORKING: { label: 'Working', tone: 'green' as const }, DAY_ENDED: { label: 'Day ended', tone: 'gray' as const },
  ON_LEAVE: { label: 'On leave', tone: 'amber' as const }, NOT_STARTED: { label: 'Not started', tone: 'red' as const },
}

export default function Attendance() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const all = can('attendance.all')
  const [tab, setTab] = useState<'live' | 'history'>(all ? 'live' : 'history')
  const [q, setQ] = useState('')
  const [days, setDays] = useState(14)
  const users = db.users.filter((u) => u.active && (all || u.id === me.id) && (!q || u.name.toLowerCase().includes(q.toLowerCase())))
  const att = presentToday(db)
  const counts = useMemo(() => {
    const c = { WORKING: 0, DAY_ENDED: 0, ON_LEAVE: 0, NOT_STARTED: 0 }
    for (const u of db.users.filter((x) => x.active)) c[dayStatus(db, u.id)]++
    return c
  }, [db])
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => ymd(addDays(new Date(), -i))), [days])

  const cell = (uid: string, d: string) => {
    const s = db.sessions.find((x) => x.userId === uid && x.date === d)
    const sunday = new Date(d + 'T00:00:00').getDay() === 0
    const leave = db.leaves.some((l) => l.userId === uid && l.status === 'APPROVED' && l.from <= d && l.to >= d)
    if (s) {
      const late = new Date(s.loginAt).getHours() * 60 + new Date(s.loginAt).getMinutes() > 9 * 60 + 30
      const half = s.logoutAt ? (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 3600000 < 5 : d < today()
      return { code: half ? 'H' : late ? 'L' : 'P', cls: half ? 'bg-warn-soft text-warn' : late ? 'bg-info-soft text-info' : 'bg-ok-soft text-ok', title: `${fmtTime(s.loginAt)} – ${fmtTime(s.logoutAt)}` }
    }
    if (leave) return { code: 'LV', cls: 'bg-violet-500/12 text-violet-600', title: 'Leave' }
    if (sunday) return { code: '—', cls: 'text-mute', title: 'Sunday' }
    if (d === today()) return { code: '·', cls: 'text-mute', title: 'Not started' }
    return { code: 'A', cls: 'bg-bad-soft text-bad', title: 'Absent' }
  }

  return (
    <div>
      <PageHeader title="Attendance Board" subtitle={all ? 'Live day status of everyone, and history' : 'Your attendance (only HR, Admin roles see others)'} icon={UserCheck}
        actions={<>
          {all && <Tabs value={tab} onChange={setTab} tabs={[{ id: 'live', label: 'Live today' }, { id: 'history', label: 'History' }]} />}
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`attendance-${today()}.csv`, db.sessions.filter((s) => users.some((u) => u.id === s.userId) && dates.includes(s.date)).map((s) => ({ date: s.date, name: db.users.find((u) => u.id === s.userId)?.name, login: fmtTime(s.loginAt), logout: fmtTime(s.logoutAt) })))}>Export</Button>
        </>} />
      {all && <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label="Present today" value={`${att.present}/${att.total}`} icon={Users} />
        <MiniStat label="Working now" value={counts.WORKING} icon={UserCheck} tone="green" />
        <MiniStat label="Day ended" value={counts.DAY_ENDED} icon={LogOut} tone="gray" />
        <MiniStat label="On leave" value={counts.ON_LEAVE} icon={Coffee} tone="amber" />
        <MiniStat label="Not started" value={counts.NOT_STARTED} icon={UserX} tone="red" />
      </div>}

      {tab === 'live' && all ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line p-4"><SearchBox value={q} onChange={setQ} className="max-w-sm" /></div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {users.map((u) => {
              const st = dayStatus(db, u.id)
              const s = db.sessions.find((x) => x.userId === u.id && x.date === today())
              return (
                <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                  <div className="relative"><Avatar name={u.name} photo={u.photo} size={44} /><span className={cx('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-card', st === 'WORKING' ? 'bg-ok' : st === 'ON_LEAVE' ? 'bg-warn' : st === 'DAY_ENDED' ? 'bg-mute' : 'bg-bad')} /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{u.name}</p><p className="truncate text-xs text-mute">{roleLabel(u.role)} · {s ? `${fmtTime(s.loginAt)} – ${s.logoutAt ? fmtTime(s.logoutAt) : 'now'}` : '—'}</p></div>
                  <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
                </div>
              )
            })}
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
          <Card className="overflow-hidden">
            <CardHeader title="Daily register" subtitle="P present · L late · H half day · A absent · LV leave" icon={CalendarRange}
              action={<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-card px-2 text-sm" aria-label="Range"><option value={7}>7 days</option><option value={14}>14 days</option><option value={21}>21 days</option></select>} />
            {all && <div className="border-b border-line p-3"><SearchBox value={q} onChange={setQ} className="max-w-sm" /></div>}
            <Table>
              <thead><tr><Th className="sticky left-0 z-10 bg-card2">Employee</Th>{dates.slice().reverse().map((d) => <Th key={d} className="px-1 text-center">{new Date(d + 'T00:00:00').getDate()}<span className="block text-[9px] font-normal">{new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'narrow' })}</span></Th>)}<Th className="text-center">P</Th></tr></thead>
              <tbody>
                {users.map((u) => {
                  const cells = dates.slice().reverse().map((d) => ({ d, ...cell(u.id, d) }))
                  return (
                    <tr key={u.id}>
                      <Td className="sticky left-0 z-10 bg-card"><span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={u.name} photo={u.photo} size={26} /><span className="text-sm font-semibold">{u.name}</span></span></Td>
                      {cells.map((c) => <Td key={c.d} className="px-1 text-center"><span title={`${fmtDate(c.d)} · ${c.title}`} className={cx('inline-grid h-6 min-w-6 place-items-center rounded-md text-[10px] font-bold', c.cls)}>{c.code}</span></Td>)}
                      <Td className="text-center font-bold">{cells.filter((c) => ['P', 'L'].includes(c.code)).length}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </Card>
          <LoginLogoutCard className="self-start" />
        </div>
      )}
    </div>
  )
}
