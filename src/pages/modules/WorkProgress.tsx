import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileSpreadsheet, TrendingUp } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName, usersWithRole, visibleBookings } from '../../lib/actions'
import { BOOKING_STATUS, STAGES } from '../../lib/workflow'
import { addDays, downloadCsv, fmtDate, fmtDateTime, today, ymd } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Avatar, Button, Card, CardHeader, Input, Table, Tabs, Td, Th, useRun } from '../../components/ui'

type Period = 'week' | 'month' | 'year' | 'custom'

function rangeOf(p: Period, from: string, to: string): [string, string] {
  const now = new Date()
  if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [ymd(d), today()] }
  if (p === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), today()]
  if (p === 'year') return [ymd(new Date(now.getFullYear(), 0, 1)), today()]
  return [from || ymd(addDays(now, -30)), to || today()]
}

/** What each admin / operations member processed in a period — downloadable for any week, month, year or date range. */
export function WorkProgress() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [period, setPeriod] = useState<Period>('month')
  const [from, setFrom] = useState(ymd(addDays(new Date(), -30)))
  const [to, setTo] = useState(today())
  const [start, end] = rangeOf(period, from, to)
  const inRange = (iso?: string) => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end
  const files = useMemo(() => visibleBookings(db, me).filter((b) => b.opsMemberId), [db, me])

  const people = useMemo(() => {
    const staff = [...usersWithRole(db, 'admin'), ...usersWithRole(db, 'operations')]
    return staff.map((u) => {
      const mine = files.filter((b) => b.opsMemberId === u.id || b.adminId === u.id)
      const active = mine.filter((b) => !['COMPLETED', 'REJECTED'].includes(b.status))
      const moves = mine.flatMap((b) => b.stageHistory.filter((h) => inRange(h.at) && (h.by === u.id || (!h.by && b.opsMemberId === u.id))))
      const done = mine.filter((b) => b.status === 'COMPLETED' && b.approvals.some((a) => ['COMPLETED', 'APPROVE_DONE'].includes(a.action) && inRange(a.at)))
      const sent = mine.filter((b) => b.approvals.some((a) => a.action === 'WORK_DONE' && a.by === u.id && inRange(a.at)))
      return {
        u, files: mine.length, active: active.length, moves: moves.length, completed: done.length, sentForApproval: sent.length,
        onHold: mine.filter((b) => b.status === 'ON_HOLD').length,
        avgStage: active.length ? Math.round((active.reduce((s, b) => s + b.stage, 0) / active.length) * 10) / 10 : 0,
        openTasks: mine.reduce((s, b) => s + b.tasks.filter((t) => !t.done).length, 0),
      }
    }).filter((r) => r.files > 0).sort((a, b) => b.moves - a.moves || b.completed - a.completed)
  }, [db, files, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  const detail = useMemo(() => files.map((b) => ({
    b, moves: b.stageHistory.filter((h) => inRange(h.at)).length, last: [...b.stageHistory].sort((x, y) => y.at.localeCompare(x.at))[0],
  })).filter((r) => r.moves > 0 || inRange(r.b.updatedAt)).sort((x, y) => y.moves - x.moves), [files, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  const summaryRows = () => people.map((r) => ({ person: r.u.name, role: roleLabel(r.u.role), files: r.files, active: r.active, stage_moves: r.moves, sent_for_approval: r.sentForApproval, completed: r.completed, on_hold: r.onHold, average_stage: r.avgStage, open_tasks: r.openTasks }))
  const detailRows = () => detail.map(({ b, moves, last }) => ({ booking: b.bookingId, company: b.companyName, service: b.serviceName, operations: userName(db, b.opsMemberId), admin: userName(db, b.adminId), status: BOOKING_STATUS[b.status].label, stage: `${b.stage}. ${STAGES[b.stage - 1]}`, stage_moves_in_period: moves, last_move: last ? fmtDateTime(last.at) : '', updated: fmtDateTime(b.updatedAt) }))
  const name = `work-progress-${start}-to-${end}`
  const excel = () => run(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows()), 'By person')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows()), 'By client file')
    XLSX.writeFile(wb, `${name}.xlsx`)
  }, 'Excel downloaded')

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Tabs value={period} onChange={setPeriod} tabs={[{ id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'year', label: 'This year' }, { id: 'custom', label: 'Date range' }]} />
        {period === 'custom' && <>
          <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
        </>}
        <span className="text-sm text-mute">{fmtDate(start)} – {fmtDate(end)}</span>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`${name}.csv`, summaryRows())}>CSV</Button>
          <Button icon={FileSpreadsheet} onClick={excel}>Excel</Button>
        </span>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Progress by person" subtitle="Admin and Operation team members" icon={TrendingUp} />
        {!people.length ? <p className="p-6 text-center text-sm text-mute">No admin or operations work yet.</p> : (
          <Table>
            <thead><tr><Th>Person</Th><Th className="text-right">Files</Th><Th className="text-right">Active</Th><Th className="text-right">Stage moves</Th><Th className="text-right">Sent for approval</Th><Th className="text-right">Completed</Th><Th className="text-right">On hold</Th><Th className="text-right">Avg stage</Th><Th className="text-right">Open tasks</Th></tr></thead>
            <tbody>
              {people.map((r) => (
                <tr key={r.u.id}>
                  <Td><span className="flex items-center gap-2"><Avatar name={r.u.name} photo={r.u.photo} size={28} /><span><span className="block text-sm font-semibold">{r.u.name}</span><span className="text-xs text-mute">{roleLabel(r.u.role)}</span></span></span></Td>
                  <Td className="text-right tabular-nums">{r.files}</Td><Td className="text-right tabular-nums">{r.active}</Td>
                  <Td className="text-right font-bold tabular-nums">{r.moves}</Td><Td className="text-right tabular-nums">{r.sentForApproval}</Td>
                  <Td className="text-right font-bold tabular-nums text-ok">{r.completed}</Td><Td className="text-right tabular-nums">{r.onHold}</Td>
                  <Td className="text-right tabular-nums">{r.avgStage || '—'}</Td><Td className="text-right tabular-nums">{r.openTasks}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Client files worked on" subtitle={`${detail.length} file(s) moved or updated in this period`} icon={TrendingUp}
          action={<Button size="sm" variant="ghost" icon={Download} onClick={() => downloadCsv(`${name}-files.csv`, detailRows())}>CSV</Button>} />
        <Table className="max-h-[60vh] overflow-y-auto">
          <thead><tr><Th>Client</Th><Th>Operations</Th><Th>Admin</Th><Th>Stage</Th><Th className="text-right">Moves</Th><Th>Last move</Th></tr></thead>
          <tbody>
            {detail.slice(0, 200).map(({ b, moves, last }) => (
              <tr key={b.id}>
                <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.bookingId} · {BOOKING_STATUS[b.status].label}</p></Td>
                <Td className="text-xs">{userName(db, b.opsMemberId)}</Td><Td className="text-xs">{userName(db, b.adminId)}</Td>
                <Td className="text-xs">{b.stage}. {STAGES[b.stage - 1]}</Td><Td className="text-right font-bold tabular-nums">{moves}</Td>
                <Td className="text-xs text-mute">{last ? fmtDateTime(last.at) : '—'}</Td>
              </tr>
            ))}
            {!detail.length && <tr><Td colSpan={6} className="text-center text-sm text-mute">Nothing in this period.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
