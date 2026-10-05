import { useMemo, useState } from 'react'
import { BarChart3, Download, Trophy } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { collections, dayStatus } from '../../lib/metrics'
import { rolesOf } from '../../lib/rbac'
import { addDays, downloadCsv, inr, inrShort, today, ymd } from '../../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, Input, PageHeader, Progress, Table, Td, Th } from '../../components/ui'
import { HBars } from '../../components/charts'

export default function TeamProgress() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)))
  const [to, setTo] = useState(today())
  const team = db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead') && (can('reports.view') && me.role !== 'teamlead' ? true : u.teamLeadId === me.id || u.id === me.id))
  const rows = useMemo(() => team.map((u) => {
    const calls = db.leads.flatMap((l) => l.calls).filter((c) => c.by === u.id && c.at.slice(0, 10) >= from && c.at.slice(0, 10) <= to)
    const leads = db.leads.filter((l) => l.assignedTo === u.id)
    const bookings = db.bookings.filter((b) => b.createdBy === u.id && b.createdAt.slice(0, 10) >= from && b.createdAt.slice(0, 10) <= to)
    const coll = collections(db, [u.id], from, to)
    const target = u.target ?? 300000
    return { u, calls: calls.length, talk: Math.round(calls.reduce((s, c) => s + c.durationSec, 0) / 60), interested: leads.filter((l) => l.status === 'INTERESTED').length, converted: leads.filter((l) => l.status === 'CONVERTED').length, bookings: bookings.length, coll, target, pct: Math.min(100, Math.round((coll / target) * 100)) }
  }).sort((a, b) => b.coll - a.coll), [team, db, from, to])

  return (
    <div>
      <PageHeader title="Sales Team Progress" subtitle="Calls, conversions and collections per person" icon={BarChart3}
        actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`team-progress-${from}-${to}.csv`, rows.map((r) => ({ name: r.u.name, calls: r.calls, talk_minutes: r.talk, interested: r.interested, converted: r.converted, crm_entries: r.bookings, collected: r.coll, target: r.target, achieved_pct: r.pct })))}>CSV</Button>
        </>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th>#</Th><Th>Person</Th><Th className="text-right">Calls</Th><Th className="text-right">Talk</Th><Th className="text-right">Interested</Th><Th className="text-right">Converted</Th><Th className="text-right">CRM entries</Th><Th className="w-48">Collected vs target</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.u.id}>
                  <Td className="font-bold">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</Td>
                  <Td><span className="flex items-center gap-2"><Avatar name={r.u.name} photo={r.u.photo} size={30} /><span><span className="block text-sm font-semibold">{r.u.name}</span><Badge tone={dayStatus(db, r.u.id) === 'WORKING' ? 'green' : 'gray'}>{dayStatus(db, r.u.id).replace('_', ' ').toLowerCase()}</Badge></span></span></Td>
                  <Td className="text-right tabular-nums">{r.calls}</Td><Td className="text-right tabular-nums text-mute">{r.talk}m</Td>
                  <Td className="text-right tabular-nums">{r.interested}</Td><Td className="text-right tabular-nums">{r.converted}</Td><Td className="text-right tabular-nums">{r.bookings}</Td>
                  <Td><p className="mb-1 flex justify-between text-xs"><b>{inr(r.coll)}</b><span className="text-mute">{r.pct}%</span></p><Progress value={r.pct} tone={r.pct >= 100 ? 'green' : 'orange'} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card className="overflow-hidden"><CardHeader title="Collection leaderboard" icon={Trophy} /><div className="p-5"><HBars data={rows.map((r) => ({ label: r.u.name, value: r.coll }))} format={inrShort} /></div></Card>
      </div>
    </div>
  )
}
