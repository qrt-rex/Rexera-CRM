import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CircleX, Download } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { monthLabel, salaryNet, setSalaryPaid } from '../../lib/payroll'
import { downloadCsv, fmtDate, inr, today } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, SearchBox, Table, Tabs, Td, Th, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

const ALL = 'all'

/** HR: whose salary is paid for a month (or across all months) — search by name, mark paid / not paid. */
export default function SalaryStatus() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const runs = useMemo(() => [...db.payrollRuns].sort((a, b) => b.month.localeCompare(a.month)), [db.payrollRuns])
  // latest locked month first (that's the one being paid out)
  const [month, setMonth] = useState(() => runs.find((r) => ['FINALIZED', 'PAID'].includes(r.status))?.month ?? runs[0]?.month ?? ALL)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'paid' | 'unpaid'>('all')
  const [mark, setMark] = useState<{ month: string; userId: string; name: string; paidOn: string; ref: string } | null>(null)

  const rows = useMemo(() => (month === ALL ? runs : runs.filter((r) => r.month === month))
    .flatMap((r) => r.rows.map((x) => ({ run: r, row: x, paid: !!x.paidOn }))), [runs, month])
  const s = q.trim().toLowerCase()
  const list = rows.filter(({ row, paid }) => (tab === 'all' || (tab === 'paid') === paid) &&
    (!s || `${row.name} ${row.designation} ${row.department} ${db.users.find((u) => u.id === row.userId)?.username ?? ''}`.toLowerCase().includes(s)))
  const paidSum = rows.filter((r) => r.paid).reduce((t, r) => t + salaryNet(r.row), 0)
  const dueSum = rows.filter((r) => !r.paid).reduce((t, r) => t + salaryNet(r.row), 0)
  const cur = month === ALL ? undefined : runs.find((r) => r.month === month)
  const locked = (status: string) => ['FINALIZED', 'PAID'].includes(status)

  return (
    <div>
      <PageHeader title="Salary Paid / Not Paid" subtitle="Search anyone's salary status by month · mark salaries paid once the month is finalised in Payroll" icon={BadgeCheck}
        actions={<Button variant="outline" icon={Download} onClick={() => downloadCsv(`salary-status-${month}.csv`, list.map(({ run: r, row }) => ({
          month: r.month, name: row.name, designation: row.designation, department: row.department, net_salary: salaryNet(row),
          status: row.paidOn ? 'Paid' : 'Not paid', paid_on: row.paidOn ?? '', reference: row.paidRef ?? '', marked_by: row.paidBy ? userName(db, row.paidBy) : '',
        })))}>Export</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Paid" value={`${rows.filter((r) => r.paid).length} · ${inr(paidSum)}`} icon={BadgeCheck} tone="green" />
        <MiniStat label="Not paid" value={`${rows.filter((r) => !r.paid).length} · ${inr(dueSum)}`} icon={CircleX} tone="red" />
        <MiniStat label={month === ALL ? 'Months' : 'Payroll status'} value={month === ALL ? runs.length : cur ? cur.status.toLowerCase() : '—'} icon={BadgeCheck} />
      </div>
      {cur && !locked(cur.status) && (
        <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          The payroll for {monthLabel(cur.month)} is still <b>{cur.status.toLowerCase()}</b> — finalise it in <Link to="/payroll" className="font-semibold underline">Payroll</Link> before marking salaries paid.
        </p>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="h-10 rounded-xl border border-line bg-card px-3 text-sm font-semibold">
            <option value={ALL}>All months</option>
            {runs.map((r) => <option key={r.id} value={r.month}>{monthLabel(r.month)} · {r.status.toLowerCase()}</option>)}
          </select>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All', count: rows.length }, { id: 'paid', label: 'Paid', count: rows.filter((r) => r.paid).length }, { id: 'unpaid', label: 'Not paid', count: rows.filter((r) => !r.paid).length }]} />
          <SearchBox value={q} onChange={setQ} placeholder="Search employee, designation, department…" className="min-w-52 flex-1" />
        </div>
        {!runs.length ? <EmptyState icon={BadgeCheck} title="No payroll yet" text="Calculate a month in Payroll; its salaries show here." /> : !list.length ? <EmptyState icon={BadgeCheck} title="Nobody matches" /> : (
          <Table>
            <thead><tr><Th>Employee</Th>{month === ALL && <Th>Month</Th>}<Th className="text-right">Net salary</Th><Th>Status</Th>{can('payroll.manage') && <Th />}</tr></thead>
            <tbody>
              {list.map(({ run: r, row }) => (
                <tr key={`${r.id}-${row.userId}`} className="hover:bg-card2/60">
                  <Td><span className="block font-semibold">{row.name}</span><span className="text-[11px] text-mute">{[row.designation, row.department].filter(Boolean).join(' · ')}</span></Td>
                  {month === ALL && <Td className="text-xs">{monthLabel(r.month)}</Td>}
                  <Td className="text-right font-semibold tabular-nums">{inr(salaryNet(row))}</Td>
                  <Td>{row.paidOn
                    ? <span><Badge tone="green">Paid</Badge><span className="block text-[11px] text-mute">{fmtDate(row.paidOn)}{row.paidRef ? ` · ${row.paidRef}` : ''}{row.paidBy ? ` · by ${userName(db, row.paidBy)}` : ''}</span></span>
                    : <Badge tone="red">Not paid</Badge>}</Td>
                  {can('payroll.manage') && (
                    <Td className="text-right">{locked(r.status) && (row.paidOn
                      ? <Button size="sm" variant="ghost" onClick={() => run(() => setSalaryPaid(me, r.month, row.userId, null), `${row.name}: marked not paid`)}>Mark not paid</Button>
                      : <Button size="sm" variant="success" icon={BadgeCheck} onClick={() => setMark({ month: r.month, userId: row.userId, name: row.name, paidOn: today(), ref: '' })}>Mark paid</Button>)}</Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={!!mark} onClose={() => setMark(null)} title={mark ? `${mark.name} · ${monthLabel(mark.month)}` : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setMark(null)}>Cancel</Button><Button icon={BadgeCheck} onClick={async () => { if (mark && await run(() => setSalaryPaid(me, mark.month, mark.userId, { paidOn: mark.paidOn, ref: mark.ref }), `${mark.name}: salary paid`)) setMark(null) }}>Mark paid</Button></>}>
        {mark && <div className="grid gap-3">
          <Input label="Paid on" type="date" max={today()} value={mark.paidOn} onChange={(e) => setMark({ ...mark, paidOn: e.target.value })} />
          <Input label="UTR / cheque no. (optional)" value={mark.ref} onChange={(e) => setMark({ ...mark, ref: e.target.value })} />
        </div>}
      </Modal>
    </div>
  )
}
