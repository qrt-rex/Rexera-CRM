import { useMemo, useState } from 'react'
import { BadgeCheck, Calculator, CheckCircle2, Download, EyeOff, History, IndianRupee, Landmark, Lock, Pencil, RotateCcw, Trophy, Users, Wallet } from 'lucide-react'
import type { PayRow } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import {
  advancePayroll, attendanceFor, calculatePayroll, computeRow, isSalesPerson, manualFor, manualTotal, monthEnded, monthLabel, payrollPeople,
  prevMonth, recentMonths, salaryNet, salesIncentive, setSalary, unlockPayroll,
} from '../../lib/payroll'
import { downloadCsv, fmtDateTime, inr, round2 } from '../../lib/format'
import { Badge, Button, Card, CardHeader, Drawer, EmptyState, Input, Modal, PageHeader, Table, Td, Textarea, Th, useRun, useToast } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

const STATUS_TONE = { CALCULATED: 'blue', APPROVED: 'amber', FINALIZED: 'violet', PAID: 'green' } as const

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Month" className="h-10 rounded-xl border border-line bg-card px-3 text-sm font-semibold">
      {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  )
}

export default function Payroll() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const toast = useToast()
  const [month, setMonth] = useState(prevMonth)
  const [openId, setOpenId] = useState<string | null>(null)
  const [unlock, setUnlock] = useState(false)
  const [reason, setReason] = useState('')
  const [salaryFor, setSalaryFor] = useState<{ userId: string; name: string; amount: string } | null>(null)
  const manage = can('payroll.manage')
  const saved = db.payrollRuns.find((r) => r.month === month)
  const preview = useMemo(() => (saved ? null : payrollPeople(db, month).map((u) => computeRow(db, u, month))), [db, month, saved])
  const rows = saved?.rows ?? preview ?? []
  const open = openId ? rows.find((r) => r.userId === openId) ?? null : null
  const locked = !!saved && ['FINALIZED', 'PAID'].includes(saved.status)
  const incentiveOf = (r: PayRow) => round2(r.incentive + manualTotal(db, r.userId, month))
  const tot = rows.reduce((t, r) => ({
    salary: t.salary + (r.ctc ?? r.gross), gross: t.gross + r.gross, ded: t.ded + r.lopAmount + r.pfEmployee + r.pt, net: t.net + salaryNet(r), inc: t.inc + incentiveOf(r),
  }), { salary: 0, gross: 0, ded: 0, net: 0, inc: 0 })

  const exportRegister = () => downloadCsv(`payroll-${month}.csv`, rows.map((r) => ({
    employee: r.name, designation: r.designation, department: r.department, salary: r.ctc ?? '', basic: r.basic, hra: r.hra ?? '',
    other_allowance: r.otherAllowance ?? '', pf_employer: r.pfEmployer, gross: r.gross, days: r.daysInMonth, paid_days: r.paidDays,
    lop_days: r.lopDays, lop_deduction: r.lopAmount, pf_wages: r.pfWages, pf_employee: r.pfEmployee, professional_tax: r.pt,
    net_salary: salaryNet(r), incentive_hr_only: incentiveOf(r), total_payout: round2(salaryNet(r) + incentiveOf(r)),
  })))
  const exportBank = () => downloadCsv(`bank-salary-${month}.csv`, rows.map((r) => {
    const u = db.users.find((x) => x.id === r.userId)
    return { employee: r.name, email: u?.email ?? '', amount: salaryNet(r).toFixed(2), narration: `Salary ${monthLabel(month)}` }
  }))
  const saveSalary = async () => {
    if (!salaryFor) return
    if (salaryFor.amount.trim() === '') { toast('error', 'Enter the monthly salary.'); return }
    const redone = await run(() => setSalary(me, salaryFor.userId, Number(salaryFor.amount)))
    if (redone === undefined) return
    const months = Array.isArray(redone) ? redone : []
    toast('success', months.length ? `Salary saved · recalculated ${months.map(monthLabel).join(', ')}` : locked ? 'Salary saved · unlock this month to apply it here' : 'Salary saved')
    setSalaryFor(null)
  }

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly salary from attendance, approved leave, PF and professional tax · incentives tracked separately (HR only)" icon={IndianRupee}
        actions={<><MonthPicker value={month} onChange={setMonth} />
          <Button variant="outline" icon={Download} disabled={!rows.length} onClick={exportRegister}>Register</Button>
          {locked && <Button variant="outline" icon={Landmark} onClick={exportBank}>Bank file</Button>}
        </>} />

      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">{monthLabel(month)}
            {saved ? <Badge tone={STATUS_TONE[saved.status]} dot>{saved.status.toLowerCase()}</Badge> : <Badge tone="gray">not calculated</Badge>}
            {locked && <Badge tone="gray"><Lock className="size-3" />locked</Badge>}
            {(saved?.provisional ?? !monthEnded(month)) && <Badge tone="orange">month in progress · provisional</Badge>}
          </p>
          <p className="text-xs text-mute">{saved ? `Calculated ${fmtDateTime(saved.calculatedAt)} by ${userName(db, saved.calculatedBy)}` : 'Preview from live data — nothing is saved until you calculate.'}</p>
        </div>
        {manage && <div className="flex flex-wrap gap-2">
          {!locked && <Button icon={Calculator} onClick={() => run(() => calculatePayroll(me, month), saved ? 'Payroll recalculated' : 'Payroll calculated')}>{saved ? 'Recalculate' : 'Calculate payroll'}</Button>}
          {saved?.status === 'CALCULATED' && <Button variant="success" icon={BadgeCheck} onClick={() => run(() => advancePayroll(me, month, 'APPROVED'), 'Payroll approved')}>Approve</Button>}
          {saved?.status === 'APPROVED' && <Button variant="primary" icon={Lock} disabled={!monthEnded(month)} title={monthEnded(month) ? '' : 'Available after the month ends'} onClick={() => run(() => advancePayroll(me, month, 'FINALIZED'), 'Payroll finalised and locked')}>Finalise & lock</Button>}
          {saved?.status === 'FINALIZED' && <Button variant="success" icon={CheckCircle2} onClick={() => run(() => advancePayroll(me, month, 'PAID'), 'Marked as paid')}>Mark paid</Button>}
          {locked && <Button variant="outline" icon={RotateCcw} onClick={() => { setReason(''); setUnlock(true) }}>Unlock & recalculate</Button>}
        </div>}
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label={`Employees · salary ${inr(tot.salary)}`} value={rows.length} icon={Users} />
        <MiniStat label="Gross (after employer PF)" value={inr(tot.gross)} icon={Wallet} tone="blue" />
        <MiniStat label="Deductions (LOP + employee PF + PT)" value={inr(tot.ded)} icon={IndianRupee} tone="red" />
        <MiniStat label="Net salary payable" value={inr(tot.net)} icon={CheckCircle2} tone="green" />
        <MiniStat label="Incentives · HR only, not on payslip" value={inr(tot.inc)} icon={Trophy} tone="orange" />
      </div>

      <Card className="overflow-hidden">
        {!rows.length ? <EmptyState icon={Users} title="Nobody to pay this month" text="Set monthly salaries with the pencil next to each name, or in Employee Details." /> : (
          <Table>
            <thead><tr>
              <Th>Employee</Th><Th className="text-right">Paid / LOP days</Th><Th className="text-right">Salary</Th><Th className="text-right">Employer PF</Th><Th className="text-right">Gross</Th>
              <Th className="text-right">LOP</Th><Th className="text-right">Employee PF</Th><Th className="text-right">PT</Th><Th className="text-right">Net salary</Th>
              <Th className="text-right"><span className="inline-flex items-center gap-1"><EyeOff className="size-3" />Incentive</span></Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const current = db.users.find((u) => u.id === r.userId)?.salary
                const changed = r.ctc != null && current != null && current !== r.ctc
                return (
                  <tr key={r.userId} className="cursor-pointer hover:bg-card2/60" onClick={() => setOpenId(r.userId)}>
                    <Td><p className="font-semibold">{r.name}</p><p className="text-xs text-mute">{r.designation}</p></Td>
                    <Td className="text-right tabular-nums">{r.paidDays} / <span className={r.lopDays ? 'font-semibold text-bad' : 'text-mute'}>{r.lopDays}</span></Td>
                    <Td className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {r.ctc != null ? inr(r.ctc) : '—'}
                        {manage && <button aria-label={`Change salary of ${r.name}`} title="Change salary" onClick={(e) => { e.stopPropagation(); setSalaryFor({ userId: r.userId, name: r.name, amount: String(current ?? r.ctc ?? '') }) }} className="rounded-md p-1 text-mute hover:bg-card2 hover:text-brand-ink"><Pencil className="size-3.5" /></button>}
                      </span>
                      {changed && <span className="block text-[10px] font-semibold text-warn">now {inr(current!)} · recalculate</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-mute">{r.ctc != null && r.pfEmployer ? `− ${inr(r.pfEmployer)}` : '—'}</Td>
                    <Td className="text-right font-semibold tabular-nums">{inr(r.gross)}</Td>
                    <Td className="text-right tabular-nums text-bad">{r.lopAmount ? `− ${inr(r.lopAmount)}` : '—'}</Td>
                    <Td className="text-right tabular-nums">{r.pfEmployee ? inr(r.pfEmployee) : '—'}</Td>
                    <Td className="text-right tabular-nums">{r.pt ? inr(r.pt) : '—'}</Td>
                    <Td className="text-right font-bold tabular-nums">{inr(salaryNet(r))}</Td>
                    <Td className="text-right tabular-nums text-accent">{incentiveOf(r) ? inr(incentiveOf(r)) : '—'}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-2 text-xs text-mute">Incentives (automatic sales incentive + amounts HR adds in Sales Incentives) are paid separately and never appear on payslips.</p>

      {saved && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="History" icon={History} />
          <ol className="space-y-2 p-5 text-sm">
            {[...saved.history].reverse().map((h, i) => <li key={i}><b>{h.action.toLowerCase()}</b> <span className="text-mute">· {userName(db, h.by)} · {fmtDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}
          </ol>
        </Card>
      )}

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name} subtitle={open && `${open.designation} · ${monthLabel(month)}`}
        footer={open && manage && <Button variant="outline" icon={Pencil} onClick={() => setSalaryFor({ userId: open.userId, name: open.name, amount: String(db.users.find((u) => u.id === open.userId)?.salary ?? open.ctc ?? '') })}>Change salary</Button>}>
        {open && <RowDetail row={open} month={month} />}
      </Drawer>

      <Modal open={unlock} onClose={() => setUnlock(false)} title={`Unlock ${monthLabel(month)}`} size="sm"
        footer={<><Button variant="outline" onClick={() => setUnlock(false)}>Cancel</Button><Button icon={RotateCcw} onClick={async () => { if (await run(() => unlockPayroll(me, month, reason), 'Unlocked and recalculated')) setUnlock(false) }}>Unlock & recalculate</Button></>}>
        <p className="mb-3 text-sm text-mute">The month goes back to “calculated” with today's salaries, attendance and PF settings. You can approve and finalise it again afterwards.{saved?.status === 'PAID' ? ' It is currently marked paid — record why it is being reopened.' : ''}</p>
        <Textarea label="Reason (kept in the history)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Modal>

      <Modal open={!!salaryFor} onClose={() => setSalaryFor(null)} title={`Change salary · ${salaryFor?.name ?? ''}`} size="sm"
        footer={<><Button variant="outline" onClick={() => setSalaryFor(null)}>Cancel</Button><Button onClick={saveSalary}>Save salary</Button></>}>
        <Input label="Monthly salary (₹)" type="number" min={0} value={salaryFor?.amount ?? ''} onChange={(e) => salaryFor && setSalaryFor({ ...salaryFor, amount: e.target.value })} autoFocus
          hint={locked ? 'This month is locked — the new salary applies once you unlock & recalculate it, and to later months.' : 'Every open payroll month is recalculated with the new salary.'} />
      </Modal>
    </div>
  )
}

function RowDetail({ row, month }: { row: PayRow; month: string }) {
  const db = useDb()
  const u = db.users.find((x) => x.id === row.userId)
  const att = u ? attendanceFor(db, u, month) : null
  const inc = u && isSalesPerson(u) ? salesIncentive(db, u, month) : null
  const manual = manualFor(db, row.userId, month)
  const line = (k: string, v: string, cls = '') => <div className="flex justify-between gap-3 py-1.5"><span className="text-mute">{k}</span><span className={`font-semibold tabular-nums ${cls}`}>{v}</span></div>
  return (
    <div className="space-y-5 text-sm">
      {att && (
        <div className="rounded-2xl border border-line p-4">
          <p className="mb-2 font-bold">Attendance</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Present', att.present], ['Half days', att.half], ['Paid leave', att.leave], ['Absent', att.absent], ['LOP leave', att.lopLeave], ['Before joining', att.beforeJoin]].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-card2 p-2"><p className="text-lg font-extrabold">{v}</p><p className="text-[10px] text-mute">{k}</p></div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-line p-4">
        <p className="mb-1 font-bold">Salary breakdown (as on the payslip)</p>
        {row.ctc != null ? <>
          {line('Monthly salary', inr(row.ctc))}
          {line('· Basic', inr(row.basic))}
          {line('· HRA', inr(row.hra ?? 0))}
          {line('· Other allowance', inr(row.otherAllowance ?? 0))}
          {line(`Employer PF (on ${inr(row.pfWages)})`, row.pfEmployer ? `− ${inr(row.pfEmployer)}` : '—', 'text-bad')}
          <div className="border-t border-line">{line('Gross salary', inr(row.gross))}</div>
        </> : line('Monthly gross (older calculation)', inr(row.gross))}
        {line(`Loss of pay (${row.lopDays} of ${row.daysInMonth} days × ${inr(row.gross / row.daysInMonth)})`, row.lopAmount ? `− ${inr(row.lopAmount)}` : '—', 'text-bad')}
        {line(`Employee PF (on ${inr(row.pfWages)})`, row.pfEmployee ? `− ${inr(row.pfEmployee)}` : '—', 'text-bad')}
        {line('Professional tax', row.pt ? `− ${inr(row.pt)}` : '—', 'text-bad')}
        <div className="mt-1 border-t border-line pt-1">{line('Net salary', inr(salaryNet(row)))}</div>
      </div>
      <div className="rounded-2xl border border-dashed border-accent/50 bg-accent-soft/30 p-4">
        <p className="mb-1 flex items-center gap-2 font-bold"><EyeOff className="size-4 text-accent" />Incentives · HR only, not on payslip</p>
        {inc && <>
          {line('Sales collections (before GST)', inr(inc.net))}
          {line(`Automatic incentive${inc.eligible ? '' : ` (not eligible — ${inr(Math.max(0, inc.eligibleAt - inc.net))} to go)`}`, inr(row.incentive))}
        </>}
        {manual.map((m) => line(`Added by ${userName(db, m.addedBy)} · ${m.reason}${m.paidAt ? ' · paid' : ''}`, inr(m.amount)))}
        {!inc && !manual.length && <p className="text-mute">No incentive for this month.</p>}
        {(inc || manual.length > 0) && <div className="border-t border-line">{line('Total incentive', inr(round2(row.incentive + manual.reduce((s, m) => s + m.amount, 0))), 'text-accent')}</div>}
      </div>
    </div>
  )
}
