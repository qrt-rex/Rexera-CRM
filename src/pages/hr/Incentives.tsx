import { useMemo, useState } from 'react'
import { CheckCircle2, Download, EyeOff, Plus, Target, Trash2, TrendingUp, Trophy, Users } from 'lucide-react'
import type { User } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import {
  addManualIncentive, isSalesPerson, manualTotal, monthLabel, recentMonths, removeManualIncentive, salesIncentive, setManualIncentivePaid, thisMonth,
} from '../../lib/payroll'
import { downloadCsv, fmtDate, fmtDateTime, inr, round2 } from '../../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, Drawer, EmptyState, Input, Modal, PageHeader, Progress, Select, Table, Td, Textarea, Th, useConfirm, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'
import { MonthPicker } from './Payroll'

export default function Incentives() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const manage = can('incentives.manage')
  const [month, setMonth] = useState(thisMonth)
  const [open, setOpen] = useState<User | null>(null)
  const [add, setAdd] = useState<{ userId: string; month: string; amount: string; reason: string } | null>(null)
  const rows = useMemo(() => db.users.filter((u) => u.active && isSalesPerson(u)).map((u) => {
    const inc = salesIncentive(db, u, month)
    const added = manualTotal(db, u.id, month)
    return { u, inc, added, total: round2(inc.total + added) }
  }).sort((a, b) => b.inc.net - a.inc.net), [db, month])
  const manual = db.manualIncentives.filter((m) => m.month === month)
  const autoTotal = rows.reduce((s, r) => s + r.inc.total, 0)
  const manualSum = manual.reduce((s, m) => s + m.amount, 0)
  const r = db.incentiveRules
  const detail = open ? salesIncentive(db, open, month) : null

  const exportCsv = () => downloadCsv(`incentives-${month}.csv`, [
    ...rows.map(({ u, inc, added, total }) => ({ name: u.name, type: 'sales', salary: inc.salary, collections: inc.net, eligible: inc.eligible ? 'yes' : 'no', daily: inc.dailyTotal, weekly: inc.weeklyTotal, monthly: inc.monthly.incentive, automatic: inc.total, added_by_hr: added, total, reason: '' })),
    ...manual.filter((m) => !rows.some((x) => x.u.id === m.userId)).map((m) => ({ name: userName(db, m.userId), type: 'added', salary: '', collections: '', eligible: '', daily: '', weekly: '', monthly: '', automatic: 0, added_by_hr: m.amount, total: m.amount, reason: m.reason })),
  ])

  return (
    <div>
      <PageHeader title="Sales Incentives" subtitle={`HR only — incentives never appear on payslips. Rules v${r.version}: eligible at salary × ${r.eligibilityMultiple}; ${r.dailyPct}% of days ≥ ${inr(r.dailyThreshold)}; ${r.weeklyPct}% of weeks ≥ ${inr(r.weeklyThreshold)}; slab at salary × ${r.monthlyMultiple}`} icon={Trophy}
        actions={<><MonthPicker value={month} onChange={setMonth} />
          <Button variant="outline" icon={Download} onClick={exportCsv}>Export</Button>
          {manage && <Button variant="accent" icon={Plus} onClick={() => setAdd({ userId: '', month, amount: '', reason: '' })}>Add incentive</Button>}
        </>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Sales people eligible" value={`${rows.filter((x) => x.inc.eligible).length} / ${rows.length}`} icon={Target} tone="green" />
        <MiniStat label="Collections (before GST)" value={inr(rows.reduce((s, x) => s + x.inc.net, 0))} icon={TrendingUp} tone="blue" />
        <MiniStat label="Automatic incentive" value={inr(autoTotal)} icon={Trophy} tone="orange" />
        <MiniStat label={`Added by HR · ${manual.length} entr${manual.length === 1 ? 'y' : 'ies'}`} value={inr(manualSum)} icon={Plus} tone="violet" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`Sales team · ${monthLabel(month)}`} icon={Users} />
        {!rows.length ? <EmptyState icon={Users} title="No sales people" /> : (
          <Table>
            <thead><tr><Th>#</Th><Th>Sales person</Th><Th className="w-56">Collections vs eligibility</Th><Th className="text-right">Daily</Th><Th className="text-right">Weekly</Th><Th className="text-right">Monthly slab</Th><Th className="text-right">Automatic</Th><Th className="text-right">Added by HR</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody>{rows.map(({ u, inc, added, total }, i) => (
              <tr key={u.id} className="cursor-pointer hover:bg-card2/60" onClick={() => setOpen(u)}>
                <Td className="font-bold">{i + 1}</Td>
                <Td><span className="flex items-center gap-2"><Avatar name={u.name} photo={u.photo} size={30} /><span><span className="block font-semibold">{u.name}</span><span className="text-xs text-mute">salary {inc.salary ? inr(inc.salary) : 'not set'}</span></span></span></Td>
                <Td>
                  <p className="mb-1 flex justify-between text-xs"><b>{inr(inc.net)}</b><span className="text-mute">of {inr(inc.eligibleAt)}</span></p>
                  <Progress value={inc.eligibleAt ? (inc.net / inc.eligibleAt) * 100 : 0} tone={inc.eligible ? 'green' : 'orange'} />
                </Td>
                <Td className="text-right tabular-nums">{inr(inc.dailyTotal)}</Td>
                <Td className="text-right tabular-nums">{inr(inc.weeklyTotal)}</Td>
                <Td className="text-right tabular-nums">{inc.monthly.pct ? `${inc.monthly.pct}% · ${inr(inc.monthly.incentive)}` : '—'}</Td>
                <Td className="text-right">{inc.eligible ? <span className="tabular-nums">{inr(inc.total)}</span> : <Badge tone="gray">not eligible</Badge>}</Td>
                <Td className="text-right tabular-nums">{added ? inr(added) : '—'}</Td>
                <Td className="text-right font-bold tabular-nums text-ok">{inr(total)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title={`Added incentives · ${monthLabel(month)}`} subtitle="Any employee, added any time after the month · paid separately from salary" icon={EyeOff}
          action={manage && <Button size="sm" icon={Plus} onClick={() => setAdd({ userId: '', month, amount: '', reason: '' })}>Add</Button>} />
        {!manual.length ? <EmptyState icon={Plus} title="Nothing added for this month" text="Use “Add incentive” for spot awards, referrals or late approvals." /> : (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Added</Th><Th>Status</Th><Th className="text-right" /></tr></thead>
            <tbody>{manual.map((m) => (
              <tr key={m.id}>
                <Td className="font-semibold">{userName(db, m.userId)}</Td>
                <Td className="max-w-72 text-sm"><span className="line-clamp-2">{m.reason}</span></Td>
                <Td className="text-right font-bold tabular-nums">{inr(m.amount)}</Td>
                <Td className="text-xs text-mute">{userName(db, m.addedBy)} · {fmtDateTime(m.addedAt)}</Td>
                <Td>{m.paidAt ? <Badge tone="green">paid {fmtDate(m.paidAt)}</Badge> : <Badge tone="amber">to pay</Badge>}</Td>
                <Td className="text-right">{manage && <span className="inline-flex gap-1">
                  <Button size="sm" variant={m.paidAt ? 'ghost' : 'success'} icon={CheckCircle2} onClick={() => run(() => setManualIncentivePaid(me, m.id, !m.paidAt), m.paidAt ? 'Marked unpaid' : 'Marked paid')}>{m.paidAt ? 'Unpaid' : 'Paid'}</Button>
                  {!m.paidAt && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" className="text-bad" onClick={async () => { if (await confirm('Remove this incentive?', `${inr(m.amount)} for ${userName(db, m.userId)}.`, true)) run(() => removeManualIncentive(me, m.id), 'Removed') }} />}
                </span>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-mute">Collections are CRM-entry payments before GST, credited to the entry's sales owner. Daily, weekly and monthly add up; nothing automatic is paid below eligibility. Incentives are shown in Payroll for HR but never on payslips.</p>

      <Modal open={!!add} onClose={() => setAdd(null)} title="Add incentive" subtitle="Visible to HR only — not on the payslip"
        footer={<><Button variant="outline" onClick={() => setAdd(null)}>Cancel</Button><Button icon={Plus} onClick={async () => { if (add && await run(() => addManualIncentive(me, { userId: add.userId, month: add.month, amount: Number(add.amount), reason: add.reason }), 'Incentive added')) { setMonth(add.month); setAdd(null) } }}>Add incentive</Button></>}>
        {add && <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Employee" required value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })} className="sm:col-span-2">
            <option value="">— Select —</option>
            {db.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.designation}</option>)}
          </Select>
          <Select label="For month" value={add.month} onChange={(e) => setAdd({ ...add, month: e.target.value })} hint="This month or any earlier month">
            {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Input label="Amount (₹)" required type="number" min={1} value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} />
          <Textarea label="Reason" required value={add.reason} onChange={(e) => setAdd({ ...add, reason: e.target.value })} className="sm:col-span-2" placeholder="e.g. Spot award for closing the Seed Fund deal" />
        </div>}
      </Modal>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name} subtitle={monthLabel(month)}>
        {detail && open && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[['Collections', inr(detail.net)], ['Eligible at', inr(detail.eligibleAt)], ['Automatic', inr(detail.total)], ['Added by HR', inr(manualTotal(db, open.id, month))]].map(([k, v]) => <div key={k} className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">{k}</p><p className="text-lg font-extrabold">{v}</p></div>)}
            </div>
            <div><p className="mb-2 font-bold">Days with collections</p>
              {!detail.daily.length ? <p className="text-mute">No collections this month.</p> : detail.daily.map((x) => (
                <div key={x.date} className="flex justify-between border-b border-line/60 py-1.5"><span>{fmtDate(x.date)}</span><span className="tabular-nums">{inr(x.amount)} {x.incentive ? <b className="text-ok">+{inr(x.incentive)}</b> : <span className="text-mute">below {inr(db.incentiveRules.dailyThreshold)}</span>}</span></div>
              ))}
            </div>
            <div><p className="mb-2 font-bold">Weeks (Mon–Sun)</p>
              {detail.weekly.map((x) => (
                <div key={x.week} className="flex justify-between border-b border-line/60 py-1.5"><span>Week of {fmtDate(x.week)}</span><span className="tabular-nums">{inr(x.amount)} {x.incentive ? <b className="text-ok">+{inr(x.incentive)}</b> : <span className="text-mute">below {inr(db.incentiveRules.weeklyThreshold)}</span>}</span></div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
      {confirmNode}
    </div>
  )
}
