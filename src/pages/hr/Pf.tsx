import { useState } from 'react'
import { Calculator, Download, Landmark, Lock, Save, ShieldCheck, Users } from 'lucide-react'
import type { PfSettings } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { canEditPf, monthLabel, prevMonth, salaryStructure, savePfSettings, updatePfAccount } from '../../lib/payroll'
import { downloadCsv, inr } from '../../lib/format'
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Table, Td, Th, Toggle, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'
import { MonthPicker } from './Payroll'

/** Live worked example of the current settings for any salary. */
function Example({ s }: { s: PfSettings }) {
  const [ctc, setCtc] = useState(40000)
  const x = salaryStructure(ctc, s)
  const pt = s.ptEnabled && x.gross >= 12000 ? 200 : 0
  const line = (k: string, v: number, cls = '', strong = false) => (
    <div className={`flex justify-between gap-3 py-1 ${strong ? 'border-t border-line pt-2 font-bold' : ''}`}><span className={strong ? '' : 'text-mute'}>{k}</span><span className={`tabular-nums ${cls}`}>{inr(v)}</span></div>
  )
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Worked example" subtitle="With no loss of pay" icon={Calculator} />
      <div className="space-y-1 p-5 text-sm">
        <Input label="Monthly salary (₹)" type="number" min={0} value={ctc || ''} onChange={(e) => setCtc(Number(e.target.value))} className="mb-3" />
        {line(`Basic (${s.basicPct}%)`, x.basic)}
        {line(`HRA (${s.hraPct}% of basic)`, x.hra)}
        {line('Other allowance', x.otherAllowance)}
        {line(`Employer PF (${s.employerPct}%)`, -x.pfEmployer, 'text-bad')}
        {line('Gross salary', x.gross, '', true)}
        {line(`Employee PF (${s.employeePct}%)`, -x.pfEmployee, 'text-bad')}
        {line('Professional tax', -pt, 'text-bad')}
        {line('Net pay', x.gross - x.pfEmployee - pt, 'text-ok', true)}
        <p className="pt-2 text-xs text-mute">Loss of pay = gross ÷ days in the month × LOP days ({inr(x.gross / 30)} a day in a 30-day month).</p>
      </div>
    </Card>
  )
}

export default function Pf() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const manage = can('payroll.manage')
  const hr = canEditPf(me)
  const [month, setMonth] = useState(prevMonth)
  const [s, setS] = useState(db.pfSettings)
  const [uanDraft, setUanDraft] = useState<Record<string, string>>({})
  const payroll = db.payrollRuns.find((r) => r.month === month)
  const rows = (payroll?.rows ?? []).filter((r) => r.pfWages > 0)
  const epsOf = (wages: number) => Math.round((wages * db.pfSettings.epsPct) / 100)
  const totals = rows.reduce((t, r) => ({ wages: t.wages + r.pfWages, ee: t.ee + r.pfEmployee, eps: t.eps + epsOf(r.pfWages), er: t.er + r.pfEmployer }), { wages: 0, ee: 0, eps: 0, er: 0 })

  const exportEcr = () => downloadCsv(`pf-ecr-${month}.csv`, rows.map((r) => {
    const eps = epsOf(r.pfWages)
    return { uan: db.pfAccounts.find((a) => a.userId === r.userId)?.uan ?? '', member_name: r.name, gross_wages: r.gross - r.lopAmount, epf_wages: r.pfWages, eps_wages: r.pfWages, edli_wages: r.pfWages, epf_contribution_ee: r.pfEmployee, eps_contribution_er: eps, epf_eps_diff_er: r.pfEmployer - eps, ncp_days: r.lopDays }
  }))

  return (
    <div>
      <PageHeader title="PF Management" subtitle="Provident fund rules, member UANs and the monthly contribution report" icon={ShieldCheck}
        actions={<><MonthPicker value={month} onChange={setMonth} /><Button variant="outline" icon={Download} disabled={!rows.length} onClick={exportEcr}>ECR file</Button></>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Members this month" value={rows.length} icon={Users} />
        <MiniStat label="PF wages" value={inr(totals.wages)} icon={Landmark} tone="blue" />
        <MiniStat label="Employee share" value={inr(totals.ee)} icon={ShieldCheck} tone="violet" />
        <MiniStat label="Employer share (EPF + EPS)" value={inr(totals.er)} icon={ShieldCheck} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Salary structure & PF" subtitle={hr ? 'Only HR can change these' : 'Read-only — only HR can change these'} icon={hr ? ShieldCheck : Lock} />
            <fieldset disabled={!hr} className="grid gap-4 p-5 disabled:opacity-80">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Basic (% of salary)" type="number" step="0.5" value={s.basicPct} onChange={(e) => setS({ ...s, basicPct: Number(e.target.value) })} />
                <Input label="HRA (% of basic)" type="number" step="0.5" value={s.hraPct} onChange={(e) => setS({ ...s, hraPct: Number(e.target.value) })} />
              </div>
              <label className="flex items-center justify-between gap-3 text-sm font-semibold">PF enabled <Toggle checked={s.enabled} onChange={(v) => hr && setS({ ...s, enabled: v })} label="PF enabled" /></label>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Employee PF %" type="number" step="0.01" value={s.employeePct} onChange={(e) => setS({ ...s, employeePct: Number(e.target.value) })} />
                <Input label="Employer PF %" type="number" step="0.01" value={s.employerPct} onChange={(e) => setS({ ...s, employerPct: Number(e.target.value) })} />
              </div>
              <Input label="of which EPS (pension) %" type="number" step="0.01" value={s.epsPct} onChange={(e) => setS({ ...s, epsPct: Number(e.target.value) })} hint={`EPF part of the employer share = ${(s.employerPct - s.epsPct).toFixed(2)}%`} />
              <label className="flex items-center justify-between gap-3 text-sm font-semibold">Cap PF wages <Toggle checked={s.ceilingEnabled} onChange={(v) => hr && setS({ ...s, ceilingEnabled: v })} label="Cap PF wages" /></label>
              {s.ceilingEnabled && <Input label="PF wage ceiling (₹ / month)" type="number" value={s.wageCeiling} onChange={(e) => setS({ ...s, wageCeiling: Number(e.target.value) })} />}
              <label className="flex items-center justify-between gap-3 text-sm font-semibold">Professional tax ₹200 <Toggle checked={s.ptEnabled} onChange={(v) => hr && setS({ ...s, ptEnabled: v })} label="Professional tax" /></label>
              {hr && <Button type="button" icon={Save} onClick={() => run(() => savePfSettings(me, s), 'Saved — recalculate open payroll months to apply')}>Save settings</Button>}
            </fieldset>
          </Card>
          <Example s={s} />
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={`Contributions · ${monthLabel(month)}`} subtitle={payroll ? `From payroll (${payroll.status.toLowerCase()})` : 'Calculate this month in Payroll first'} icon={Landmark} />
            {!rows.length ? <EmptyState icon={Landmark} title="No PF data for this month" text="PF figures come from the month's calculated payroll." /> : (
              <Table>
                <thead><tr><Th>Member</Th><Th>UAN</Th><Th className="text-right">PF wages</Th><Th className="text-right">EE share</Th><Th className="text-right">ER EPF</Th><Th className="text-right">ER EPS</Th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.userId}>
                    <Td className="font-semibold">{r.name}</Td>
                    <Td className="font-mono text-xs">{db.pfAccounts.find((a) => a.userId === r.userId)?.uan || '—'}</Td>
                    <Td className="text-right tabular-nums">{inr(r.pfWages)}</Td>
                    <Td className="text-right tabular-nums">{inr(r.pfEmployee)}</Td>
                    <Td className="text-right tabular-nums">{inr(r.pfEmployer - epsOf(r.pfWages))}</Td>
                    <Td className="text-right tabular-nums">{inr(epsOf(r.pfWages))}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Members" subtitle="UAN and enrolment per employee" icon={Users} />
            <Table>
              <thead><tr><Th>Employee</Th><Th>UAN (12 digits)</Th><Th>Enrolled</Th></tr></thead>
              <tbody>{db.users.filter((u) => u.active).map((u) => {
                const a = db.pfAccounts.find((x) => x.userId === u.id)
                const draft = uanDraft[u.id] ?? a?.uan ?? ''
                return (
                  <tr key={u.id}>
                    <Td><p className="font-semibold">{u.name}</p><p className="text-xs text-mute">{u.designation}</p></Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <input value={draft} disabled={!manage} inputMode="numeric" maxLength={12} onChange={(e) => setUanDraft({ ...uanDraft, [u.id]: e.target.value.replace(/\D/g, '') })}
                          className="h-9 w-40 rounded-lg border border-line bg-card px-2 font-mono text-sm" aria-label={`UAN for ${u.name}`} />
                        {manage && draft !== (a?.uan ?? '') && <Button size="sm" onClick={async () => { if (await run(() => updatePfAccount(me, u.id, { uan: draft }), 'UAN saved')) setUanDraft((d) => { const n = { ...d }; delete n[u.id]; return n }) }}>Save</Button>}
                      </span>
                    </Td>
                    <Td>{manage ? <Toggle checked={a?.enrolled ?? true} label="Enrolled" onChange={(v) => run(() => updatePfAccount(me, u.id, { enrolled: v }))} /> : <Badge tone={a?.enrolled === false ? 'gray' : 'green'}>{a?.enrolled === false ? 'no' : 'yes'}</Badge>}</Td>
                  </tr>
                )
              })}</tbody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  )
}
