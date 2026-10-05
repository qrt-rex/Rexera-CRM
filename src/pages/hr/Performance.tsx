import { useMemo, useState } from 'react'
import { Download, Gauge, LayoutGrid, List, Printer } from 'lucide-react'
import { useDb } from '../../lib/store'
import { attendanceFor, isSalesPerson, monthDays, monthLabel, thisMonth } from '../../lib/payroll'
import { downloadCsv, inr, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Avatar, Badge, Button, Card, PageHeader, Progress, SearchBox, Table, Tabs, Td, Th } from '../../components/ui'
import { MonthPicker } from './Payroll'

const grade = (s: number) => (s >= 90 ? 'A+' : s >= 75 ? 'A' : s >= 60 ? 'B' : s >= 40 ? 'C' : 'D')
const gradeTone = (g: string) => (g.startsWith('A') ? 'green' : g === 'B' ? 'blue' : g === 'C' ? 'amber' : 'red') as 'green' | 'blue' | 'amber' | 'red'

export default function Performance() {
  const db = useDb()
  const [month, setMonth] = useState(thisMonth)
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const days = monthDays(month)
    const t = today()
    return db.users.filter((u) => u.active).map((u) => {
      const att = attendanceFor(db, u, month)
      const tracked = att.present + att.half + att.leave + att.lopLeave + att.absent
      const attendancePct = tracked ? Math.round(((att.present + att.half * 0.5 + att.leave) / tracked) * 100) : 100
      const leaveDays = db.leaves.filter((l) => l.userId === u.id && l.status === 'APPROVED').reduce((s, l) => s + days.filter((d) => d >= l.from && d <= l.to && d <= t).length, 0)
      const calls = db.leads.reduce((s, l) => s + l.calls.filter((c) => c.by === u.id && c.at.startsWith(month)).length, 0)
      const entries = db.bookings.filter((b) => b.createdBy === u.id && b.createdAt.startsWith(month)).length
      const collected = db.bookings.filter((b) => b.createdBy === u.id).reduce((s, b) => s + b.payments.filter((p) => p.date.startsWith(month)).reduce((x, p) => x + p.amount, 0), 0)
      const stageMoves = db.bookings.reduce((s, b) => s + b.stageHistory.filter((h) => h.by === u.id && h.at.startsWith(month)).length, 0)
      const activity = db.audit.filter((a) => a.by === u.id && a.at.startsWith(month)).length
      const sales = isSalesPerson(u)
      const target = u.target ?? 0
      const targetPct = sales && target ? Math.min(100, Math.round((collected / target) * 100)) : null
      // sales: 40% attendance + 60% target achievement; everyone else: attendance
      const score = targetPct !== null ? Math.round(attendancePct * 0.4 + targetPct * 0.6) : attendancePct
      return { u, att, attendancePct, leaveDays, calls, entries, collected, stageMoves, activity, sales, target, targetPct, score, g: grade(score) }
    }).sort((a, b) => b.score - a.score)
  }, [db, month])
  const list = rows.filter((r) => !q || `${r.u.name} ${r.u.department} ${r.u.designation}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <PageHeader title="Performance" subtitle="Report cards from attendance, leave, calls, collections and file work" icon={Gauge}
        actions={<><MonthPicker value={month} onChange={setMonth} />
          <Tabs value={view} onChange={setView} tabs={[{ id: 'table', label: 'Table', icon: List }, { id: 'cards', label: 'Report cards', icon: LayoutGrid }]} />
          {view === 'cards' && <Button variant="outline" icon={Printer} onClick={() => window.print()}>Print</Button>}
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`performance-${month}.csv`, rows.map((r) => ({ name: r.u.name, role: roleLabel(r.u.role), department: r.u.department, attendance_pct: r.attendancePct, present: r.att.present, half_days: r.att.half, absent: r.att.absent, leave_days: r.leaveDays, calls: r.calls, crm_entries: r.entries, collected_before_gst: r.collected, target: r.target || '', target_pct: r.targetPct ?? '', stage_moves: r.stageMoves, actions_logged: r.activity, score: r.score, grade: r.g })))}>Export</Button>
        </>} />
      <SearchBox value={q} onChange={setQ} placeholder="Search people…" className="no-print mb-4 max-w-sm" />

      {view === 'table' ? (
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th>Employee</Th><Th className="w-40">Attendance</Th><Th className="text-right">Leave</Th><Th className="text-right">Calls</Th><Th className="text-right">CRM entries</Th><Th className="w-44">Collections vs target</Th><Th className="text-right">Stage moves</Th><Th className="text-right">Score</Th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.u.id}>
                <Td><span className="flex items-center gap-2"><Avatar name={r.u.name} photo={r.u.photo} size={30} /><span><span className="block font-semibold">{r.u.name}</span><span className="text-xs text-mute">{roleLabel(r.u.role)}</span></span></span></Td>
                <Td><p className="mb-1 text-xs"><b>{r.attendancePct}%</b> <span className="text-mute">· {r.att.absent} absent · {r.att.half} half</span></p><Progress value={r.attendancePct} tone={r.attendancePct >= 90 ? 'green' : 'orange'} /></Td>
                <Td className="text-right tabular-nums">{r.leaveDays}</Td>
                <Td className="text-right tabular-nums">{r.sales ? r.calls : '—'}</Td>
                <Td className="text-right tabular-nums">{r.sales ? r.entries : '—'}</Td>
                <Td>{r.targetPct !== null ? <><p className="mb-1 text-xs"><b>{inr(r.collected)}</b> <span className="text-mute">· {r.targetPct}%</span></p><Progress value={r.targetPct} tone="navy" /></> : <span className="text-mute">—</span>}</Td>
                <Td className="text-right tabular-nums">{r.stageMoves || '—'}</Td>
                <Td className="text-right"><Badge tone={gradeTone(r.g)}>{r.g} · {r.score}</Badge></Td>
              </tr>
            ))}</tbody>
          </Table>
          <p className="border-t border-line px-5 py-3 text-xs text-mute">Score: sales people 40% attendance + 60% of monthly target; everyone else attendance. Attendance counts tracked working days only. Grades A+ ≥ 90 · A ≥ 75 · B ≥ 60 · C ≥ 40.</p>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <Card key={r.u.id} className="print-area p-5">
              <div className="flex items-center gap-3">
                <Avatar name={r.u.name} photo={r.u.photo} size={48} />
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{r.u.name}</p><p className="truncate text-xs text-mute">{r.u.designation} · {monthLabel(month)}</p></div>
                <span className="grid size-12 place-items-center rounded-2xl bg-brand text-lg font-extrabold text-white">{r.g}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[['Attendance', `${r.attendancePct}%`], ['Leave days', r.leaveDays], r.sales ? ['Calls', r.calls] : ['Stage moves', r.stageMoves]].map(([k, v]) => (
                  <div key={k as string} className="rounded-xl bg-card2 p-2"><p className="text-lg font-extrabold">{v}</p><p className="text-[10px] text-mute">{k}</p></div>
                ))}
              </div>
              {r.targetPct !== null && <div className="mt-4"><p className="mb-1 flex justify-between text-xs"><span>{inr(r.collected)} of {inr(r.target)}</span><b>{r.targetPct}%</b></p><Progress value={r.targetPct} tone={r.targetPct >= 100 ? 'green' : 'orange'} /></div>}
              <p className="mt-3 text-xs text-mute">Score {r.score} / 100</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
