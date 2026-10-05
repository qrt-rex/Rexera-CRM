import { useMemo, useState } from 'react'
import { ArrowLeft, FileText, Printer, Receipt } from 'lucide-react'
import type { PayRow, PayrollRun } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { monthLabel, salaryNet } from '../../lib/payroll'
import { inr, rupeesInWords } from '../../lib/format'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Td, Th } from '../../components/ui'
import { Logo } from '../../components/Logo'

export default function Payslips() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const all = can('payroll.view')
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const [open, setOpen] = useState<{ run: PayrollRun; row: PayRow } | null>(null)
  const issued = db.payrollRuns.filter((r) => r.status === 'FINALIZED' || r.status === 'PAID')
  const list = useMemo(() => issued
    .filter((r) => !month || r.month === month)
    .flatMap((run) => run.rows.filter((row) => (all || row.userId === me.id) && (!q || row.name.toLowerCase().includes(q.toLowerCase()))).map((row) => ({ run, row })))
    .sort((a, b) => b.run.month.localeCompare(a.run.month) || a.row.name.localeCompare(b.row.name)), [issued, month, all, me.id, q])

  if (open) return <PayslipView run={open.run} row={open.row} onBack={() => setOpen(null)} />

  return (
    <div>
      <PageHeader title="Payslips" subtitle={all ? 'Payslips for every finalised payroll month' : 'Your payslips'} icon={Receipt} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          {all && <SearchBox value={q} onChange={setQ} placeholder="Search employee…" className="min-w-52 flex-1" />}
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            <option value="">All months</option>{issued.map((r) => <option key={r.id} value={r.month}>{monthLabel(r.month)}</option>)}
          </select>
        </div>
        {!list.length ? <EmptyState icon={FileText} title="No payslips yet" text="Payslips appear once a month's payroll is finalised in Payroll." /> : (
          <Table>
            <thead><tr><Th>Month</Th><Th>Employee</Th><Th className="text-right">Gross</Th><Th className="text-right">Net pay</Th><Th>Status</Th><Th className="text-right" /></tr></thead>
            <tbody>
              {list.map(({ run, row }) => (
                <tr key={run.id + row.userId} className="hover:bg-card2/60">
                  <Td className="font-semibold">{monthLabel(run.month)}</Td>
                  <Td><p className="font-semibold">{row.name}</p><p className="text-xs text-mute">{row.designation}</p></Td>
                  <Td className="text-right tabular-nums">{inr(row.gross)}</Td>
                  <Td className="text-right font-bold tabular-nums">{inr(salaryNet(row))}</Td>
                  <Td><Badge tone={run.status === 'PAID' ? 'green' : 'violet'}>{run.status === 'PAID' ? 'paid' : 'finalised'}</Badge></Td>
                  <Td className="text-right"><Button size="sm" variant="soft" icon={FileText} onClick={() => setOpen({ run, row })}>View</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function PayslipView({ run, row, onBack }: { run: PayrollRun; row: PayRow; onBack: () => void }) {
  const db = useDb()
  const u = db.users.find((x) => x.id === row.userId)
  const uan = db.pfAccounts.find((a) => a.userId === row.userId)?.uan
  // incentives are tracked by HR separately and never shown on the payslip
  const lop: [string, number][] = row.lopAmount ? [[`Loss of pay (${row.lopDays} days)`, row.lopAmount]] : []
  const structured = row.ctc != null
  const net = salaryNet(row)
  const earnings: [string, number][] = structured
    ? [['Basic', row.basic], ['HRA', row.hra ?? 0], ['Other allowance', row.otherAllowance ?? 0]]
    : [['Basic (50%)', row.basic], ['Allowances', round(row.gross - row.lopAmount - row.basic)]]
  const deductions: [string, number][] = structured
    ? [['Employer PF', row.pfEmployer], ['Employee PF', row.pfEmployee], ['Professional tax', row.pt], ...lop]
    : [['Provident fund', row.pfEmployee], ['Professional tax', row.pt]]
  const totalE = earnings.reduce((s, [, v]) => s + v, 0)
  const totalD = deductions.reduce((s, [, v]) => s + v, 0)
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center gap-2">
        <button onClick={onBack} className="mr-auto flex items-center gap-1.5 text-sm text-mute hover:text-ink"><ArrowLeft className="size-4" />All payslips</button>
        <Button icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
      </div>
      <Card className="print-area overflow-hidden bg-white text-[#111827]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-[#F47B20] p-7">
          <div><Logo fixed /><p className="mt-2 text-sm font-semibold">{db.settings.companyName}</p></div>
          <div className="text-right"><p className="text-xl font-extrabold text-[#2E3A8C]">PAYSLIP</p><p className="text-sm">{monthLabel(run.month)}</p></div>
        </div>
        <div className="grid gap-x-8 gap-y-1.5 p-7 text-sm sm:grid-cols-2">
          {[['Employee', row.name], ['Designation', row.designation], ['Department', row.department], ['Email', u?.email ?? '—'], ['UAN', uan || '—'], ['Paid days', `${row.paidDays} of ${row.daysInMonth} (LOP ${row.lopDays})`]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-[#E3E6EB] py-1"><span className="text-[#6B7280]">{k}</span><span className="font-semibold">{v}</span></div>
          ))}
        </div>
        <div className="grid gap-6 px-7 sm:grid-cols-2">
          {[['Earnings', earnings, totalE], ['Deductions', deductions, totalD]].map(([title, items, total]) => (
            <div key={title as string}>
              <p className="mb-2 rounded-lg bg-[#ECEEFB] px-3 py-1.5 text-xs font-bold uppercase text-[#2E3A8C]">{title as string}</p>
              {(items as [string, number][]).map(([k, v]) => <div key={k} className="flex justify-between px-3 py-1.5 text-sm"><span>{k}</span><span className="tabular-nums">{inr(v)}</span></div>)}
              <div className="mt-1 flex justify-between border-t border-[#E3E6EB] px-3 py-1.5 text-sm font-bold"><span>Total</span><span className="tabular-nums">{inr(total as number)}</span></div>
            </div>
          ))}
        </div>
        <div className="m-7 rounded-2xl bg-[#2E3A8C] p-5 text-white">
          <p className="text-xs uppercase tracking-wider text-white/70">Net pay</p>
          <p className="text-3xl font-extrabold">{inr(net)}</p>
          <p className="text-xs text-white/80">{rupeesInWords(net)}</p>
        </div>
        <p className="px-7 pb-6 text-[11px] text-[#6B7280]">
          {structured ? `Monthly salary ${inr(row.ctc!)} · gross salary (after employer PF) ${inr(row.gross)} · loss of pay = gross ÷ ${row.daysInMonth} days × LOP days.` : `Monthly gross ${inr(row.gross)} · loss of pay ${inr(row.lopAmount)} · employer PF ${inr(row.pfEmployer)}.`} This is a computer-generated payslip.
        </p>
      </Card>
    </div>
  )
}
const round = (n: number) => Math.round(n * 100) / 100
