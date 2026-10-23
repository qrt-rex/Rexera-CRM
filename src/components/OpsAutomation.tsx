import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, BellRing, CalendarClock, FileSignature, MailWarning, Sparkles } from 'lucide-react'
import type { AdminStageId, Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { userName, visibleBookings } from '../lib/actions'
import { ACTIVE_FILE_STATUSES, ADMIN_DONE, ADMIN_STAGES, ADMIN_WORK_STATUSES, addDays, adminProgress, adminStatusLabel, istToday, precheckPending, schemeDaysLeft, schemeState } from '../../supabase/workflow-rules.mjs'
import { fmtDate } from '../lib/format'
import { Badge, Card, CardHeader, cx, EmptyState, Modal, Progress, Table, Td, Th } from './ui'

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : null)

/** What needs attention now: welcome messages not delivered, follow-ups and Pitch Deck reminders due, schemes ending, new form responses. */
export function AutomationAlerts() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const t = istToday(), soon = addDays(t, 3)
  const files = useMemo(() => visibleBookings(db, me).filter((b) => ACTIVE_FILE_STATUSES.includes(b.status)), [db, me])
  const welcome = files.filter((b) => b.welcome && ['FAILED', 'NOT_CONFIGURED', 'NO_CONTACT', 'PENDING', 'SKIPPED'].includes(b.welcome.email.status))
  const follow = files.filter((b) => b.followUp && !b.followUp.paused && b.followUp.nextOn <= soon).sort((a, b) => a.followUp!.nextOn.localeCompare(b.followUp!.nextOn))
  const precheck = files.filter((b) => precheckPending(b) && b.adminWork!.PRECHECK!.nextRemindOn && b.adminWork!.PRECHECK!.nextRemindOn <= soon).sort((a, b) => a.adminWork!.PRECHECK!.nextRemindOn!.localeCompare(b.adminWork!.PRECHECK!.nextRemindOn!))
  const schemes = db.schemes.filter((s) => schemeState(s, t) === 'ACTIVE' && (schemeDaysLeft(s, t) ?? 99) <= 7).sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''))
  const responses = can('forms.manage') ? (db.formSubmissions ?? []).filter((s) => s.status === 'NEW').length : 0
  const due = (d: string) => <span className={cx('text-xs font-bold', d < t ? 'text-bad' : d === t ? 'text-warn' : 'text-mute')}>{d < t ? `overdue · ${fmtDate(d)}` : d === t ? 'today' : fmtDate(d)}</span>
  const Row = ({ b, right, sub }: { b: Booking; right: React.ReactNode; sub: string }) => (
    <li className="flex items-center gap-3 px-4 py-2 text-sm"><Link to={`/bookings/${b.id}`} className="min-w-0 flex-1 hover:underline"><b className="block truncate">{b.companyName}</b><span className="block truncate text-[11px] text-mute">{b.bookingId} · {sub}</span></Link>{right}</li>
  )
  const Box = ({ title, icon, n, children, empty }: { title: string; icon: typeof BellRing; n: number; children: React.ReactNode; empty: string }) => (
    <Card className="overflow-hidden">
      <CardHeader title={title} icon={icon} action={<Badge tone={n ? 'orange' : 'green'}>{n}</Badge>} />
      {n ? <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">{children}</ul> : <p className="px-4 py-3 text-sm text-mute">{empty}</p>}
    </Card>
  )
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Box title="Follow-ups (15-day)" icon={CalendarClock} n={follow.length} empty="No follow-ups due in the next 3 days.">
        {follow.map((b) => <Row key={b.id} b={b} sub={`${userName(db, b.opsMemberId)} · last ${b.followUp!.lastOn ? fmtDate(b.followUp!.lastOn) : '—'}`} right={due(b.followUp!.nextOn)} />)}
      </Box>
      <Box title="Pitch Deck reminders" icon={BellRing} n={precheck.length} empty="No Pitch Deck follow-ups due.">
        {precheck.map((b) => <Row key={b.id} b={b} sub={`${userName(db, b.adminWork!.PRECHECK!.assignee ?? b.adminId)} · ${adminStatusLabel(b.adminWork!.PRECHECK!.status)}`} right={due(b.adminWork!.PRECHECK!.nextRemindOn!)} />)}
      </Box>
      <Box title="Client welcome not delivered" icon={MailWarning} n={welcome.length} empty="Every welcome message was delivered.">
        {welcome.map((b) => <Row key={b.id} b={b} sub={b.welcome!.email.error ?? b.welcome!.email.status.toLowerCase().replace('_', ' ')} right={<Badge tone={b.welcome!.email.status === 'PENDING' ? 'blue' : 'red'}>{b.welcome!.email.status === 'PENDING' ? 'queued' : 'retry'}</Badge>} />)}
      </Box>
      <Card className="overflow-hidden">
        <CardHeader title="Schemes & forms" icon={Sparkles} />
        <ul className="divide-y divide-line/70 text-sm">
          {schemes.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2"><Link to="/schemes" className="truncate font-semibold hover:underline">{s.title}</Link><span className={cx('text-xs font-bold', (schemeDaysLeft(s, t) ?? 9) <= 1 ? 'text-bad' : 'text-warn')}>ends {fmtDate(s.endDate)}</span></li>)}
          {!schemes.length && <li className="px-4 py-2 text-mute">No scheme ends in the next 7 days.</li>}
          {can('forms.manage') && <li className="px-4 py-2"><Link to="/forms?tab=responses" className="flex items-center justify-between font-semibold hover:underline"><span className="flex items-center gap-2"><FileSignature className="size-4" />New form responses</span><Badge tone={responses ? 'orange' : 'gray'}>{responses}</Badge></Link></li>}
        </ul>
      </Card>
    </div>
  )
}

/**
 * Admin Progress Overview: for each Admin employee, every stage's done / total (and %) with overdue counts. Done =
 * Approved or Completed; "Not needed" stages and rejected files are left out. Click a figure to see the cases.
 */
export function AdminProgressOverview() {
  const db = useDb()
  const me = useMe()
  const t = istToday()
  const [who, setWho] = useState('')
  const [drill, setDrill] = useState<{ userId: string; stage?: AdminStageId } | null>(null)
  const files = useMemo(() => visibleBookings(db, me), [db, me])
  const rows = useMemo(() => adminProgress(files, t).filter((r) => !who || r.userId === who).sort((a, b) => userName(db, a.userId).localeCompare(userName(db, b.userId))), [files, t, who, db])
  const all = adminProgress(files, t)
  const cases = drill ? files.filter((b) => {
    if (!b.adminWork || b.status === 'REJECTED') return false
    return (drill.stage ? [drill.stage] : ADMIN_STAGES.map((s) => s.id)).some((sid) => { const w = b.adminWork![sid]; return w && w.status !== 'NOT_NEEDED' && (w.assignee || b.adminId || '') === drill.userId })
  }) : []
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Admin Progress Overview" subtitle="Done / assigned per stage (done = approved or completed; not-needed stages and rejected files left out) · click a figure for the cases" icon={BarChart3}
        action={<select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Admin employee" className="h-9 rounded-xl border border-line bg-card px-3 text-sm">
          <option value="">All Admin employees</option>{all.map((r) => <option key={r.userId} value={r.userId}>{userName(db, r.userId)}</option>)}
        </select>} />
      {!rows.length ? <EmptyState icon={BarChart3} title="No Admin work yet" text="Stages appear once Operations assigns files to Admin." /> : (
        <Table>
          <thead><tr><Th>Admin employee</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="w-44">Overall</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <Td className="font-semibold">{r.userId ? userName(db, r.userId) : 'Not assigned'}<span className="block text-[11px] font-normal text-mute">{r.overdue ? <span className="text-bad">{r.overdue} overdue</span> : 'nothing overdue'}</span></Td>
                {ADMIN_STAGES.map((s) => {
                  const c = r.stages[s.id], p = pct(c.done, c.total)
                  const open = c.total - c.done
                  return (
                    <Td key={s.id} className="text-center">
                      {c.total ? <button onClick={() => setDrill({ userId: r.userId, stage: s.id })} className="w-full rounded-lg px-1 py-1 hover:bg-card2" title={ADMIN_WORK_STATUSES.filter((x) => c.byStatus[x.id]).map((x) => `${x.label}: ${c.byStatus[x.id]}`).join('\n')}>
                        <b className="tabular-nums">{c.done}/{c.total}</b><span className="block text-[11px] text-mute">{p}%{open ? ` · ${open} open` : ''}</span>
                        {c.overdue > 0 && <span className="block text-[11px] font-bold text-bad">{c.overdue} overdue</span>}
                      </button> : <span className="text-xs text-mute">—</span>}
                    </Td>
                  )
                })}
                <Td><button onClick={() => setDrill({ userId: r.userId })} className="w-full text-left"><div className="mb-0.5 flex justify-between text-[11px]"><span className="text-mute">{r.done}/{r.total}</span><b>{r.pct ?? 0}%</b></div><Progress value={r.pct ?? 0} tone={(r.pct ?? 0) >= 80 ? 'green' : 'orange'} /></button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={!!drill} onClose={() => setDrill(null)} size="lg" title={drill ? `${userName(db, drill.userId)} · ${drill.stage ? ADMIN_STAGES.find((s) => s.id === drill.stage)!.label : 'all stages'}` : ''} subtitle={`${cases.length} case(s)`}>
        {drill && <ul className="divide-y divide-line/70">
          {cases.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <Link to={`/bookings/${b.id}`} className="min-w-0 flex-1 hover:underline"><b>{b.companyName}</b><span className="block text-[11px] text-mute">{b.bookingId} · {b.serviceName}</span></Link>
              {(drill.stage ? [drill.stage] : ADMIN_STAGES.map((s) => s.id)).map((sid) => {
                const w = b.adminWork![sid]
                if (!w || w.status === 'NOT_NEEDED') return null
                const late = !!w.due && w.due < t && !ADMIN_DONE.includes(w.status)
                return <Badge key={sid} tone={late ? 'red' : ADMIN_WORK_STATUSES.find((x) => x.id === w.status)!.tone}>{!drill.stage && `${ADMIN_STAGES.find((s) => s.id === sid)!.short}: `}{adminStatusLabel(w.status)}{late ? ' · overdue' : ''}</Badge>
              })}
            </li>
          ))}
        </ul>}
      </Modal>
    </Card>
  )
}
