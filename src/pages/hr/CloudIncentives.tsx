import { useCallback, useEffect, useMemo, useState } from 'react'
import { Briefcase, Cloud, Download, Flag, KeyRound, RefreshCw, Target, TrendingUp, Trophy, Users } from 'lucide-react'
import { fetchIncentiveReport, reportsKey, ReportError, type CloudIncentiveReport, type CloudIncentiveRow, type CloudTarget } from '../../lib/cloudReports'
import { monthLabel } from '../../lib/payroll'
import { downloadCsv, fmtDate, fmtDateTime, inr } from '../../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, Drawer, EmptyState, Input, PageHeader, Progress, Table, Tabs, Td, Th } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

/** One line on the screen: a CRM person (with or without a target) or a scorecard person who isn't in the CRM yet. */
interface Line { key: string; name: string; email: string; row?: CloudIncentiveRow; target?: CloudTarget }
const collectedOf = (l: Line) => l.row?.collected ?? 0
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
/** deals can be halves (shared by submitter and lead closer) */
const deals = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 })

/** Sales incentives calculated in Supabase (public.sales_incentive_report) — what each person closed and collected, against their target. */
export default function CloudIncentives() {
  const [month, setMonth] = useState('')
  const [report, setReport] = useState<CloudIncentiveReport | null>(null)
  const [error, setError] = useState<ReportError | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<Line | null>(null)
  const [team, setTeam] = useState('')
  const [key, setKey] = useState(reportsKey.get)

  const load = useCallback(async (m?: string) => {
    setLoading(true); setError(null)
    try { const r = await fetchIncentiveReport(m); setReport(r); setMonth(r.month) }
    catch (e) { setError(e instanceof ReportError ? e : new ReportError('Report failed.')) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const r = report?.rules
  const months = report ? [...new Set([report.month, ...report.months])].sort().reverse() : []
  const teams = useMemo(() => [...new Set((report?.targets ?? []).map((t) => t.team))], [report])
  const all = useMemo<Line[]>(() => {
    if (!report) return []
    const byUser = new Map(report.targets.filter((t) => t.user_id).map((t) => [t.user_id!, t]))
    const lines: Line[] = report.rows.map((row) => ({ key: row.user_id, name: row.name, email: row.email, row, target: byUser.get(row.user_id) }))
    for (const t of report.targets) if (!t.user_id || !report.rows.some((x) => x.user_id === t.user_id)) lines.push({ key: `t-${t.name}`, name: t.name, email: '', target: t })
    return lines.sort((a, b) => collectedOf(b) - collectedOf(a) || (b.target?.target ?? 0) - (a.target?.target ?? 0))
  }, [report])
  const lines = team === '-' ? all.filter((l) => !l.target) : team ? all.filter((l) => l.target?.team === team) : all
  const sum = (f: (l: Line) => number) => lines.reduce((s, l) => s + f(l), 0)
  const targetSum = sum((l) => l.target?.target ?? 0)
  const targetCollected = sum((l) => (l.target ? collectedOf(l) : 0))
  const noSalary = lines.filter((l) => l.row && !l.row.salary).length

  const exportCsv = () => downloadCsv(`incentives-supabase-${month}${team ? `-${team}` : ''}.csv`, lines.map(({ name, email, row: x, target: t }) => ({
    team: t?.team ?? '', name, email, target: t?.target ?? '', collected_before_gst: x?.collected ?? 0, achieved_pct: t ? pct(x?.collected ?? 0, t.target) : '',
    scorecard_collection: t?.reported_collection ?? '', deals_closed: x?.deals_closed ?? 0, quoted: x?.quoted ?? 0, payments: x?.payments ?? 0,
    collected_with_gst: x?.collected_with_gst ?? 0, salary: x?.salary ?? '', eligible_at: x?.eligible_at ?? '', eligible: x?.eligible ? 'yes' : 'no',
    daily: x?.daily_incentive ?? 0, weekly: x?.weekly_incentive ?? 0, monthly_pct: x?.monthly_pct ?? 0, monthly: x?.monthly_incentive ?? 0,
    shared_50_50: x?.shared_collected ?? 0, automatic: x?.auto_incentive ?? 0, added_by_hr: x?.manual_incentive ?? 0, total: x?.total_incentive ?? 0,
  })))

  return (
    <div>
      <PageHeader title="Sales Incentives · Supabase" icon={Cloud}
        subtitle={r ? `Calculated in Supabase with rules v${r.version}: eligible at salary × ${r.eligibilityMultiple}; ${r.dailyPct}% of days ≥ ${inr(r.dailyThreshold)}; ${r.weeklyPct}% of weeks ≥ ${inr(r.weeklyThreshold)}; slab at salary × ${r.monthlyMultiple}` : 'Calculated in Supabase from CRM entries, payments, salaries and incentive rules'}
        actions={<>
          {!!months.length && (
            <select value={month} onChange={(e) => void load(e.target.value)} aria-label="Month" className="h-10 rounded-xl border border-line bg-card px-3 text-sm font-semibold">
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
          <Button variant="outline" icon={RefreshCw} loading={loading} onClick={() => void load(month || undefined)}>Refresh</Button>
          <Button variant="outline" icon={Download} onClick={exportCsv} disabled={!lines.length}>Export</Button>
        </>} />

      {error && (
        <Card className="mb-5 border-bad/40 p-5">
          <p className="font-bold text-bad">Couldn't load the report from Supabase</p>
          <p className="mt-1 text-sm text-mute">{error.message}</p>
          {error.code === 'NO_KEY' && (
            <form className="mt-4 flex max-w-md items-end gap-2" onSubmit={(e) => { e.preventDefault(); reportsKey.set(key); void load(month || undefined) }}>
              <Input label="Reports access key" type="password" value={key} onChange={(e) => setKey(e.target.value)} className="flex-1" />
              <Button icon={KeyRound} type="submit">Save</Button>
            </form>
          )}
        </Card>
      )}

      {report && (
        <>
          {teams.length > 0 && (
            <Tabs className="mb-4 w-fit max-w-full" value={team} onChange={setTeam} tabs={[
              { id: '', label: 'Everyone', count: all.length },
              ...teams.map((t) => ({ id: t, label: t, count: all.filter((l) => l.target?.team === t).length })),
              { id: '-', label: 'No target', count: all.filter((l) => !l.target).length },
            ]} />
          )}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniStat label="Deals closed" value={deals(sum((l) => l.row?.deals_closed ?? 0))} icon={Briefcase} tone="violet" />
            <MiniStat label="Collections (before GST)" value={inr(sum(collectedOf))} icon={TrendingUp} tone="blue" />
            <MiniStat label={targetSum ? `Target achieved · ${pct(targetCollected, targetSum)}%` : 'Target'} value={targetSum ? `${inr(targetCollected)} / ${inr(targetSum)}` : 'not set'} icon={Flag} tone="green" />
            <MiniStat label={`Incentive · ${lines.filter((l) => l.row?.eligible).length} eligible`} value={inr(sum((l) => l.row?.total_incentive ?? 0))} icon={Trophy} tone="orange" />
          </div>
          {!report.targetsReady && <p className="mb-4 rounded-xl bg-info-soft px-4 py-2.5 text-sm text-info">Targets aren't in Supabase yet — run <code>supabase/migrations/20261012030000_sales_targets.sql</code> in the SQL Editor.</p>}
          {noSalary > 0 && (
            <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
              <b>{noSalary}</b> people here have no salary in Supabase (<code>app_users.salary</code>). Eligibility is salary × {r?.eligibilityMultiple ?? 3}, so they show as not eligible until a salary is set.
            </p>
          )}

          <Card className="overflow-hidden">
            <CardHeader title={`${team === '-' ? 'Without a target' : team || 'Sales team'} · ${monthLabel(report.month)}`} subtitle={`Live from ${report.project} · ${fmtDateTime(report.at)}`} icon={Users} />
            {!lines.length ? <EmptyState icon={Users} title="Nobody here this month" text="Pick another month or team." /> : (
              <Table>
                <thead><tr>
                  <Th>#</Th><Th>Sales person</Th><Th className="text-right">Deals</Th><Th className="w-52">Collected (CRM) vs target</Th><Th className="text-right">Scorecard</Th>
                  <Th className="text-right">Daily</Th><Th className="text-right">Weekly</Th><Th className="text-right">Monthly slab</Th><Th className="text-right">Total</Th>
                </tr></thead>
                <tbody>{lines.map((l, i) => {
                  const x = l.row, t = l.target, got = collectedOf(l)
                  return (
                    <tr key={l.key} className="cursor-pointer hover:bg-card2/60" onClick={() => setOpen(l)}>
                      <Td className="font-bold">{i + 1}</Td>
                      <Td><span className="flex items-center gap-2"><Avatar name={l.name} size={30} /><span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold">{l.name}{t && <Badge tone="blue">{t.team}</Badge>}</span>
                        <span className="block truncate text-xs text-mute">{x ? `${l.email} · salary ${x.salary ? inr(x.salary) : 'not set'}` : 'not in the CRM yet'}</span>
                      </span></span></Td>
                      <Td className="text-right font-bold tabular-nums">{deals(x?.deals_closed ?? 0)}</Td>
                      <Td>
                        <p className="mb-1 flex justify-between text-xs"><b>{inr(got)}</b><span className="text-mute">{t ? `${pct(got, t.target)}% of ${inr(t.target)}` : 'no target'}</span></p>
                        <Progress value={t ? pct(got, t.target) : 0} tone={t && got >= t.target ? 'green' : 'orange'} />
                      </Td>
                      <Td className="text-right tabular-nums">{t?.reported_collection != null ? (
                        <span title="Collection on the team scorecard">{inr(t.reported_collection)}
                          <span className={`block text-xs ${Math.abs(got - t.reported_collection) <= 1 ? 'text-ok' : 'text-warn'}`}>{Math.abs(got - t.reported_collection) <= 1 ? 'matches' : `CRM ${got > t.reported_collection ? '+' : '−'}${inr(Math.abs(Math.round(got - t.reported_collection)))}`}</span>
                        </span>) : '—'}</Td>
                      <Td className="text-right tabular-nums">{inr(x?.daily_incentive ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{inr(x?.weekly_incentive ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{x?.monthly_pct ? `${x.monthly_pct}% · ${inr(x.monthly_incentive)}` : '—'}</Td>
                      <Td className="text-right">{x && (x.eligible || x.manual_incentive) ? <b className="tabular-nums text-ok">{inr(x.total_incentive)}</b> : <Badge tone="gray">not eligible</Badge>}</Td>
                    </tr>
                  )
                })}</tbody>
              </Table>
            )}
          </Card>
          <p className="mt-3 text-xs text-mute">Collected = every payment received in the month, before GST, credited like the old CRM's scorecards: 50% each to the person who submitted the CRM entry and the person who closed the lead, or 100% when it is the same person. The incentive is calculated from this. Scorecard = the collection on the team's own scorecard, shown for comparison. Deals = CRM entries by booking date, split the same way (rejected excluded; each part of a combo booking counts). Daily and weekly incentives are shown as earned; they are paid only once the person is eligible.</p>
        </>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name} subtitle={report ? `${open?.target ? `${open.target.team} · ` : ''}${monthLabel(report.month)}` : ''}>
        {open && (() => {
          const x = open.row, t = open.target
          const cards: [string, string][] = [
            ['Target', t ? inr(t.target) : 'not set'], ['Achieved (CRM)', t ? `${inr(x?.collected ?? 0)} · ${pct(x?.collected ?? 0, t.target)}%` : inr(x?.collected ?? 0)],
            ['Scorecard collection', t?.reported_collection != null ? inr(t.reported_collection) : '—'], ['Collected with GST', inr(x?.collected_with_gst ?? 0)],
            ['Deals closed', deals(x?.deals_closed ?? 0)], ['Quoted', inr(x?.quoted ?? 0)],
            ['Shared 50/50 with a colleague', inr(x?.shared_collected ?? 0)], ['Payments received', String(x?.payments ?? 0)],
            ['Salary', x?.salary ? inr(x.salary) : 'not set'], ['Eligible at', inr(x?.eligible_at ?? 0)],
            ['Automatic incentive', inr(x?.auto_incentive ?? 0)], ['Total incl. HR additions', inr(x?.total_incentive ?? 0)],
          ]
          return (
            <div className="space-y-5 text-sm">
              {!x && <p className="rounded-xl bg-warn-soft px-3 py-2 text-warn">On the {t?.team} scorecard but not a CRM user — no deals or payments are recorded for this name.</p>}
              <div className="grid grid-cols-2 gap-3">
                {cards.map(([k, v]) => <div key={k} className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">{k}</p><p className="text-lg font-extrabold">{v}</p></div>)}
              </div>
              {x && <>
                <div><p className="mb-2 font-bold">Days with collections</p>
                  {!x.days.length ? <p className="text-mute">No collections this month.</p> : x.days.map((d) => (
                    <div key={d.date} className="flex justify-between border-b border-line/60 py-1.5"><span>{fmtDate(d.date)}</span><span className="tabular-nums">{inr(d.amount)} {d.incentive ? <b className="text-ok">+{inr(d.incentive)}</b> : <span className="text-mute">below {inr(r?.dailyThreshold ?? 0)}</span>}</span></div>
                  ))}
                </div>
                <div><p className="mb-2 font-bold">Weeks (Mon–Sun)</p>
                  {x.weeks.map((w) => (
                    <div key={w.week} className="flex justify-between border-b border-line/60 py-1.5"><span>Week of {fmtDate(w.week)}</span><span className="tabular-nums">{inr(w.amount)} {w.incentive ? <b className="text-ok">+{inr(w.incentive)}</b> : <span className="text-mute">below {inr(r?.weeklyThreshold ?? 0)}</span>}</span></div>
                  ))}
                </div>
              </>}
            </div>
          )
        })()}
      </Drawer>
    </div>
  )
}
