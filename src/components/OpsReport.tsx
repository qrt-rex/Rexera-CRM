import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Gauge } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { userName, usersWithRole, visibleBookings } from '../lib/actions'
import { ACTIVE_FILE_STATUSES, ADMIN_DONE, ADMIN_STAGES, addDays, daysBetween, istToday, schemeDaysLeft, schemeState } from '../../supabase/workflow-rules.mjs'
import { downloadCsv, fmtDate, fmtDateTime } from '../lib/format'
import { Badge, Card, CardHeader, cx, Input, Modal, Table, Tabs, Td, Th } from './ui'
import { Bars } from './charts'

type Period = 'week' | 'month' | 'year' | 'custom'
/** India date of a timestamp (reports use India days: an event at 11 pm IST belongs to that day). */
const day = (iso?: string) => (iso ? istToday(new Date(iso).getTime()) : '')
const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to

function range(p: Period, from: string, to: string, t: string) {
  if (p === 'custom') return { from, to }
  if (p === 'week') { const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; const s = addDays(t, -dow); return { from: s, to: addDays(s, 6) } }
  if (p === 'month') { const s = `${t.slice(0, 8)}01`; const [y, m] = t.split('-').map(Number); return { from: s, to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) } }
  const y = Number(t.slice(0, 4)), fy = Number(t.slice(5, 7)) >= 4 ? y : y - 1 // Indian financial year
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31` }
}
const previous = (r: { from: string; to: string }) => { const n = daysBetween(r.from, r.to) + 1; return { from: addDays(r.from, -n), to: addDays(r.from, -1) } }

interface Event { kind: string; at: string; b: Booking; by?: string; detail?: string }
/** Everything that happened, from the records themselves (approvals, welcome, reminders, Admin stages, completions). */
function events(files: Booking[]): Event[] {
  const out: Event[] = []
  for (const b of files) {
    out.push({ kind: 'received', at: b.createdAt, b, by: b.createdBy })
    for (const a of b.approvals) {
      if (a.level === 'Legal' && a.action === 'ASSIGN_OPS') out.push({ kind: 'legalApproved', at: a.at, b, by: a.by })
      if (a.level === 'Legal' && a.action === 'REJECTED') out.push({ kind: 'legalRejected', at: a.at, b, by: a.by, detail: a.remark })
      if (a.level === 'Legal' && a.action === 'REQUEST_CHANGES') out.push({ kind: 'legalChanges', at: a.at, b, by: a.by, detail: a.remark })
      if (a.action === 'COMPLETED') out.push({ kind: 'completed', at: a.at, b, by: a.by })
    }
    if (b.welcome?.email.sentAt) out.push({ kind: 'welcomeSent', at: b.welcome.email.sentAt, b })
    for (const e of b.clientEmails ?? []) if (e.template === 'welcome' && e.status === 'FAILED') out.push({ kind: 'welcomeFailed', at: e.at, b, detail: e.error })
    if (b.welcome?.whatsapp.manualAt) out.push({ kind: 'whatsappManual', at: b.welcome.whatsapp.manualAt, b, by: b.welcome.whatsapp.manualBy })
    for (const l of b.followUp?.log ?? []) {
      if (l.kind === 'REMINDER') out.push({ kind: 'reminder', at: l.at, b, detail: '15-day follow-up' })
      if (l.kind === 'NOTE') out.push({ kind: 'followUpDone', at: l.at, b, by: l.by, detail: l.note })
    }
    for (const s of ADMIN_STAGES) {
      const w = b.adminWork?.[s.id]
      if (!w) continue
      if (w.doneAt) out.push({ kind: `done:${s.id}`, at: w.doneAt, b, by: w.assignee ?? b.adminId, detail: w.startedAt ? `${daysBetween(day(w.startedAt), day(w.doneAt))} days` : undefined })
      if (s.id === 'PRECHECK') for (const h of w.history) if (/^Reminder/.test(h.note ?? '')) out.push({ kind: 'reminder', at: h.at, b, detail: 'Pre-Check Deck' })
    }
  }
  return out
}

const KPIS: { kind: string; label: string }[] = [
  { kind: 'received', label: 'New files received' }, { kind: 'legalApproved', label: 'Legal approved → Operations' }, { kind: 'legalChanges', label: 'Legal: changes required' },
  { kind: 'legalRejected', label: 'Legal rejections' }, { kind: 'welcomeSent', label: 'Welcome emails delivered' }, { kind: 'welcomeFailed', label: 'Welcome emails failed' },
  { kind: 'whatsappManual', label: 'WhatsApp opened by staff (not confirmed)' }, { kind: 'reminder', label: 'Reminders sent' }, { kind: 'followUpDone', label: 'Follow-ups recorded' },
  ...ADMIN_STAGES.map((s) => ({ kind: `done:${s.id}`, label: `${s.short} completed` })), { kind: 'completed', label: 'Cases completed' },
]

/** Operations & Admin report: events in the period (vs the one before), cases as they stand now, and who did what. */
export function OpsReport() {
  const db = useDb()
  const me = useMe()
  const t = istToday()
  const [period, setPeriod] = useState<Period>('month')
  const [cf, setCf] = useState(addDays(t, -29))
  const [ct, setCt] = useState(t)
  const [who, setWho] = useState('')
  const [drill, setDrill] = useState<{ title: string; rows: Event[] } | null>(null)
  const r = range(period, cf, ct, t), p = previous(r)
  const files = useMemo(() => visibleBookings(db, me), [db, me])
  const all = useMemo(() => events(files), [files])
  const mine = (e: Event) => !who || e.by === who || e.b.opsMemberId === who || e.b.adminId === who
  const cur = all.filter((e) => inRange(day(e.at), r.from, r.to) && mine(e)), prev = all.filter((e) => inRange(day(e.at), p.from, p.to) && mine(e))
  const count = (list: Event[], kind: string) => list.filter((e) => e.kind === kind)
  // cases as they stand now (not events)
  const active = files.filter((b) => ACTIVE_FILE_STATUSES.includes(b.status) && (!who || b.opsMemberId === who || b.adminId === who))
  const now = [
    { label: 'Active cases', rows: active },
    { label: 'Follow-ups overdue', rows: active.filter((b) => b.followUp && !b.followUp.paused && b.followUp.nextOn < t) },
    { label: 'Awaiting client documents', rows: active.filter((b) => Object.values(b.adminWork ?? {}).some((w) => w?.status === 'PENDING_DOCUMENTS') || b.stageOutcome === 'HOLD_CLIENT') },
    { label: 'Documents waiting for checks', rows: active.filter((b) => b.documents.some((d) => (d.status ?? 'PENDING') === 'PENDING')) },
    { label: 'Admin stages overdue', rows: active.filter((b) => Object.values(b.adminWork ?? {}).some((w) => w && w.due && w.due < t && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED')) },
  ]
  const expiring = db.schemes.filter((s) => schemeState(s, t) === 'ACTIVE' && (schemeDaysLeft(s, t) ?? 99) <= 7)
  // per person, in the period
  const people = [...usersWithRole(db, 'operations'), ...usersWithRole(db, 'admin')].filter((u) => !who || u.id === who)
  const per = people.map((u) => ({
    u, approvedIn: cur.filter((e) => e.kind === 'legalApproved' && e.b.opsMemberId === u.id).length,
    followUps: cur.filter((e) => e.kind === 'followUpDone' && e.by === u.id).length,
    stages: cur.filter((e) => e.kind.startsWith('done:') && e.by === u.id).length,
    completed: cur.filter((e) => e.kind === 'completed' && (e.b.opsMemberId === u.id || e.b.adminId === u.id)).length,
  })).filter((x) => x.approvedIn || x.followUps || x.stages || x.completed)
  // stage processing time (days from start to done) for stages finished in the period
  const times = ADMIN_STAGES.map((s) => {
    const d = cur.filter((e) => e.kind === `done:${s.id}` && e.detail).map((e) => Number(e.detail!.split(' ')[0]))
    return { s, n: d.length, avg: d.length ? Math.round((d.reduce((a, x) => a + x, 0) / d.length) * 10) / 10 : null }
  })
  // chart: completions by week / month in the period
  const buckets = (() => {
    const n = daysBetween(r.from, r.to) + 1, step = n <= 31 ? 7 : 30, out: { label: string; value: number }[] = []
    for (let s = r.from; s <= r.to; s = addDays(s, step)) { const e = addDays(s, step - 1) < r.to ? addDays(s, step - 1) : r.to; out.push({ label: fmtDate(s).slice(0, 6), value: cur.filter((x) => (x.kind === 'completed' || x.kind.startsWith('done:')) && inRange(day(x.at), s, e)).length }) }
    return out
  })()
  const csv = () => downloadCsv(`ops-report-${r.from}-to-${r.to}.csv`, cur.map((e) => ({ date: day(e.at), event: KPIS.find((k) => k.kind === e.kind)?.label ?? e.kind, file: e.b.bookingId, client: e.b.companyName, by: e.by ? userName(db, e.by) : '', detail: e.detail ?? '' })))

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Tabs value={period} onChange={setPeriod} tabs={[{ id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'year', label: 'This year (FY)' }, { id: 'custom', label: 'Date range' }]} />
        {period === 'custom' && <><Input label="From" type="date" value={cf} max={ct} onChange={(e) => setCf(e.target.value)} /><Input label="To" type="date" value={ct} min={cf} onChange={(e) => setCt(e.target.value)} /></>}
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Employee" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
          <option value="">Everyone</option>{[...usersWithRole(db, 'operations'), ...usersWithRole(db, 'admin')].map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <span className="text-sm text-mute">{fmtDate(r.from)} – {fmtDate(r.to)} · compared with {fmtDate(p.from)} – {fmtDate(p.to)} · India time · made {fmtDateTime(new Date().toISOString())}</span>
        <button onClick={csv} className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-card2"><Download className="size-4" />CSV</button>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPIS.map((k) => {
          const a = count(cur, k.kind), b = count(prev, k.kind).length, diff = a.length - b
          return (
            <button key={k.kind} onClick={() => setDrill({ title: k.label, rows: a })} className="rounded-2xl border border-line bg-card p-4 text-left shadow-card transition hover:shadow-pop">
              <p className="text-[11px] font-semibold text-mute">{k.label}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">{a.length}</p>
              <p className={cx('text-[11px] font-semibold', diff > 0 ? 'text-ok' : diff < 0 ? 'text-bad' : 'text-mute')}>{diff > 0 ? '+' : ''}{diff} vs previous ({b})</p>
            </button>
          )
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Cases now" subtitle="Where things stand today (not limited to the period)" icon={Gauge} />
          <ul className="divide-y divide-line/70 text-sm">
            {now.map((x) => <li key={x.label}><button onClick={() => setDrill({ title: x.label, rows: x.rows.map((b) => ({ kind: 'now', at: b.updatedAt, b })) })} className="flex w-full justify-between px-5 py-2.5 hover:bg-card2"><span>{x.label}</span><b className="tabular-nums">{x.rows.length}</b></button></li>)}
            <li className="flex justify-between px-5 py-2.5"><span>Schemes ending within 7 days</span><b className="tabular-nums">{expiring.length}</b></li>
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Completions over the period" subtitle="Admin stages done + cases completed" icon={Gauge} />
          <div className="p-5"><Bars data={buckets} height={180} /></div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Stage processing time" subtitle="Average days from start to done, for stages finished in the period" icon={Gauge} />
          <Table><thead><tr><Th>Stage</Th><Th className="text-right">Finished</Th><Th className="text-right">Average days</Th></tr></thead>
            <tbody>{times.map((x) => <tr key={x.s.id}><Td>{x.s.label}</Td><Td className="text-right tabular-nums">{x.n}</Td><Td className="text-right tabular-nums">{x.avg ?? '—'}</Td></tr>)}</tbody></Table>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Employee productivity" subtitle="In the period" icon={Gauge} />
          <Table><thead><tr><Th>Employee</Th><Th className="text-right">Files received from Legal</Th><Th className="text-right">Follow-ups</Th><Th className="text-right">Admin stages done</Th><Th className="text-right">Completed</Th></tr></thead>
            <tbody>
              {per.map((x) => <tr key={x.u.id}><Td className="font-semibold">{x.u.name}</Td><Td className="text-right tabular-nums">{x.approvedIn}</Td><Td className="text-right tabular-nums">{x.followUps}</Td><Td className="text-right tabular-nums">{x.stages}</Td><Td className="text-right tabular-nums">{x.completed}</Td></tr>)}
              {!per.length && <tr><Td colSpan={5} className="text-center text-mute">Nothing recorded in this period.</Td></tr>}
            </tbody></Table>
        </Card>
      </div>

      <Modal open={!!drill} onClose={() => setDrill(null)} size="lg" title={drill?.title ?? ''} subtitle={`${drill?.rows.length ?? 0} record(s)`}>
        {drill && <ul className="divide-y divide-line/70">
          {drill.rows.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link to={`/bookings/${e.b.id}`} className="min-w-0 flex-1 hover:underline"><b>{e.b.companyName}</b><span className="block text-[11px] text-mute">{e.b.bookingId}{e.by ? ` · ${userName(db, e.by)}` : ''}{e.detail ? ` · ${e.detail}` : ''}</span></Link>
              <Badge tone="gray">{fmtDate(day(e.at))}</Badge>
            </li>
          ))}
          {!drill.rows.length && <li className="py-3 text-sm text-mute">Nothing here.</li>}
        </ul>}
      </Modal>
    </div>
  )
}
