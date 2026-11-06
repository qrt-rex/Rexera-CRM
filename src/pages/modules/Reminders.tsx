import { useMemo, useState } from 'react'
import { isFileAdmin } from '../../lib/fileAdmins'
import { Link, useSearchParams } from 'react-router-dom'
import { AlarmClock, BellRing, CalendarClock, FileWarning, History, Pause, Play, Users } from 'lucide-react'
import type { AdminStageId, AdminWorkStatus, Booking } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { canWorkAdminStage, clientDocState, setAdminWork, setFileDeadline, setFollowUpSchedule, userName, visibleBookings } from '../../lib/actions'
import { ACTIVE_FILE_STATUSES, ADMIN_STAGES, adminStatusLabel, DUE_SOON_DAYS, fileDeadlines, istToday, type DeadlineState } from '../../../supabase/workflow-rules.mjs'
import { isMaster, rolesOf } from '../../lib/rbac'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, SearchBox, Table, Tabs, Td, Th, usePaged, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

type Tab = 'deadlines' | 'followups' | 'docs' | 'team' | 'history'
const STATE: Record<DeadlineState, { label: string; tone: 'red' | 'amber' | 'blue' | 'gray' }> = {
  OVERDUE: { label: 'Overdue', tone: 'red' }, TODAY: { label: 'Due today', tone: 'amber' }, SOON: { label: `Due in ${DUE_SOON_DAYS} days`, tone: 'amber' }, LATER: { label: 'Upcoming', tone: 'blue' },
}
/** Pending · In progress · Completed — what an Admin stage's status means for its deadline */
const progressOf = (s?: AdminWorkStatus) => (!s || s === 'NOT_STARTED' ? 'Pending' : ['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(s) ? 'Completed' : 'In progress')
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
const left = (due: string, t: string) => { const n = days(t, due); return n === 0 ? 'today' : n > 0 ? `${n} day${n === 1 ? '' : 's'} left` : `${-n} day${n === -1 ? '' : 's'} late` }

/**
 * Reminders: every open deadline (client deadlines and Admin stage due dates), the follow-up schedules, documents still
 * awaited from clients, who has what, and the reminder history. The Operation team and Admin edit deadlines and schedules
 * here; alerts go out by themselves — two days before, then every day while overdue.
 */
export default function Reminders() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const tab = (['deadlines', 'followups', 'docs', 'team', 'history'].includes(params.get('tab') ?? '') ? params.get('tab') : 'deadlines') as Tab
  const [q, setQ] = useState('')
  const [show, setShow] = useState<'open' | DeadlineState>('open')
  const t = istToday()
  const files = useMemo(() => visibleBookings(db, me).filter((b) => ACTIVE_FILE_STATUSES.includes(b.status)), [db, me])
  const ql = q.trim().toLowerCase()
  const match = (b: Booking) => !ql || `${b.bookingId} ${b.companyName} ${userName(db, b.opsMemberId)} ${userName(db, b.adminId)}`.toLowerCase().includes(ql)
  const deadlines = files.flatMap((b) => fileDeadlines(b, t).map((x) => ({ b, x }))).sort((a, c) => a.x.due.localeCompare(c.x.due))
  const count = (s: DeadlineState) => deadlines.filter(({ x }) => x.state === s).length
  const shown = deadlines.filter(({ b, x }) => match(b) && (show === 'open' || x.state === show))
  const docs = files.flatMap((b) => ADMIN_STAGES.filter((s) => ['PENDING_UPLOAD', 'RESUBMISSION'].includes(clientDocState(b, s.id) ?? '')).map((s) => ({ b, s, since: b.clientDocs?.[s.id]?.statusAt })))
  const followUps = files.filter((b) => b.followUp).sort((a, c) => (a.followUp!.nextOn).localeCompare(c.followUp!.nextOn))
  const mayEditFile = (b: Booking) => isMaster(me) || rolesOf(me).some((r) => r === 'operations' || r === 'admin') || b.opsMemberId === me.id || isFileAdmin(b, me.id)
  const { slice, pager } = usePaged(shown, 30, [q, show, tab])

  // team-wise: open, due soon, overdue per responsible person
  const team = useMemo(() => {
    const m = new Map<string, { open: number; soon: number; overdue: number }>()
    for (const { b, x } of deadlines) {
      const who = x.key === 'file' ? b.opsMemberId : x.assignee ?? b.adminId
      if (!who) continue
      const r = m.get(who) ?? { open: 0, soon: 0, overdue: 0 }
      r.open++; if (x.state === 'OVERDUE') r.overdue++; else if (x.state !== 'LATER') r.soon++
      m.set(who, r)
    }
    return [...m].sort((a, c) => c[1].overdue - a[1].overdue || c[1].soon - a[1].soon || c[1].open - a[1].open)
  }, [deadlines])

  // history: reminders sent, schedules changed, deadlines set — newest first
  const history = useMemo(() => [
    ...files.flatMap((b) => (b.followUp?.log ?? []).map((l) => ({ at: l.at, by: l.by, b, what: l.kind === 'REMINDER' ? 'Follow-up reminder sent' : l.kind === 'RESCHEDULE' ? 'Follow-up rescheduled' : l.kind === 'PAUSE' ? 'Follow-ups paused' : l.kind === 'RESUME' ? 'Follow-ups resumed' : 'Follow-up recorded', note: l.note }))),
    ...files.flatMap((b) => Object.entries(b.adminWork ?? {}).flatMap(([k, w]) => (w?.history ?? []).filter((h) => /Reminder|due/i.test(h.note ?? '')).map((h) => ({ at: h.at, by: h.by, b, what: `${ADMIN_STAGES.find((s) => s.id === k)?.label}: reminder`, note: h.note })))),
    ...db.audit.filter((a) => a.action === 'DEADLINE_SET' || a.action === 'FOLLOWUP_SCHEDULE' || (a.action === 'ADMIN_STAGE' && /due/i.test(a.detail))).map((a) => ({ at: a.at, by: a.by, b: files.find((b) => b.id === a.ref), what: a.action === 'DEADLINE_SET' ? 'Client deadline set' : 'Schedule changed', note: a.before || a.after ? `${a.before ?? '—'} → ${a.after ?? '—'}` : a.detail })),
  ].sort((a, c) => c.at.localeCompare(a.at)).slice(0, 300), [files, db.audit])

  return (
    <div>
      <PageHeader title="Reminders" icon={BellRing} subtitle={`Deadlines, follow-ups and documents awaited on every active client · alerts go out by themselves ${DUE_SOON_DAYS} days before and every day while overdue`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Overdue" value={count('OVERDUE')} icon={AlarmClock} tone="red" />
        <MiniStat label={`Due today or in ${DUE_SOON_DAYS} days`} value={count('TODAY') + count('SOON')} icon={CalendarClock} tone="amber" />
        <MiniStat label="Follow-ups due this week" value={followUps.filter((b) => !b.followUp!.paused && days(t, b.followUp!.nextOn) <= 7).length} icon={BellRing} tone="blue" />
        <MiniStat label="Client documents awaited" value={docs.length} icon={FileWarning} tone="violet" />
      </div>
      <Tabs className="mb-4 w-fit max-w-full" value={tab} onChange={(v) => setParams({ tab: v })} tabs={[
        { id: 'deadlines', label: 'Deadlines', icon: AlarmClock, count: deadlines.length }, { id: 'followups', label: 'Follow-ups', icon: BellRing, count: followUps.length },
        { id: 'docs', label: 'Client documents', icon: FileWarning, count: docs.length }, { id: 'team', label: 'Team', icon: Users, count: team.length }, { id: 'history', label: 'History', icon: History },
      ]} />

      {tab === 'deadlines' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <SearchBox value={q} onChange={setQ} placeholder="Search client, CRM ID, person…" className="min-w-56 flex-1" />
            <Tabs value={show} onChange={setShow} tabs={[{ id: 'open', label: 'All open', count: deadlines.length }, { id: 'OVERDUE', label: 'Overdue', count: count('OVERDUE') }, { id: 'TODAY', label: 'Today', count: count('TODAY') }, { id: 'SOON', label: 'Soon', count: count('SOON') }, { id: 'LATER', label: 'Upcoming', count: count('LATER') }]} />
          </div>
          {!shown.length ? <EmptyState icon={AlarmClock} title="No deadlines here" text="Set a client deadline below in Follow-ups, or give an Admin stage a due date on the client's Workflow tab." /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Deadline for</Th><Th>Responsible</Th><Th>Status</Th><Th>Due</Th><Th>Change deadline</Th></tr></thead>
              <tbody>{slice.map(({ b, x }) => {
                const who = x.key === 'file' ? b.opsMemberId : x.assignee ?? b.adminId
                const editable = x.key === 'file' ? mayEditFile(b) : canWorkAdminStage(db, me, b, x.key as AdminStageId)
                return (
                  <tr key={`${b.id}-${x.key}`} className={x.state === 'OVERDUE' ? 'bg-bad-soft/30' : undefined}>
                    <Td><Link to={`/bookings/${b.id}?tab=workflow`} className="font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{b.bookingId}</span></Td>
                    <Td className="text-sm">{x.label}{x.status && <span className="block text-[11px] text-mute">{adminStatusLabel(x.status)}</span>}</Td>
                    <Td className="text-sm">{userName(db, who)}<span className="block text-[11px] text-mute">{x.key === 'file' ? 'Operations' : 'Admin'}</span></Td>
                    <Td><Badge tone={STATE[x.state].tone} dot>{STATE[x.state].label}</Badge>{x.key !== 'file' && <span className="mt-0.5 block text-[11px] text-mute">{progressOf(x.status)}</span>}</Td>
                    <Td className="whitespace-nowrap text-sm"><b>{fmtDate(x.due)}</b><span className={`block text-[11px] ${x.state === 'OVERDUE' ? 'font-semibold text-bad' : 'text-mute'}`}>{left(x.due, t)}</span></Td>
                    <Td>{editable ? <input type="date" defaultValue={x.due} aria-label={`New deadline for ${x.label}, ${b.companyName}`} className="h-9 rounded-lg border border-line bg-card px-2 text-sm"
                      onChange={(e) => { const v = e.target.value; if (!v || v === x.due) return; run(() => (x.key === 'file' ? setFileDeadline(me, b.id, v) : setAdminWork(me, b.id, x.key as AdminStageId, { due: v })), 'Deadline changed') }} /> : <span className="text-xs text-mute">—</span>}</Td>
                  </tr>
                )
              })}</tbody>
            </Table>
          )}
          {pager}
        </Card>
      )}

      {tab === 'followups' && (
        <Card className="overflow-hidden">
          <CardHeader title="Follow-up schedules and client deadlines" icon={BellRing} subtitle="Each active client is reminded every few days until the work is done — change the interval, the next date or the client deadline, or pause it" />
          {!followUps.length ? <EmptyState icon={BellRing} title="No follow-up schedules" text="A schedule starts when Legal approves a file." /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Operations · Admin</Th><Th>Every (days)</Th><Th>Next reminder</Th><Th>Last follow-up</Th><Th>Client deadline</Th><Th /></tr></thead>
              <tbody>{followUps.filter(match).map((b) => {
                const f = b.followUp!, may = mayEditFile(b)
                return (
                  <tr key={b.id}>
                    <Td><Link to={`/bookings/${b.id}?tab=workflow`} className="font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{b.bookingId}</span></Td>
                    <Td className="text-xs">{userName(db, b.opsMemberId)}<span className="block text-mute">{b.adminId ? userName(db, b.adminId) : '—'}</span></Td>
                    <Td>{may ? <Input aria-label="Repeat every (days)" type="number" min={1} max={90} defaultValue={f.everyDays} className="w-20" onBlur={(e) => { const n = Number(e.target.value); if (n && n !== f.everyDays) run(() => setFollowUpSchedule(me, b.id, { everyDays: n }), 'Interval changed') }} /> : f.everyDays}</Td>
                    <Td>{f.paused ? <Badge tone="gray">Paused</Badge> : may ? <input type="date" min={t} defaultValue={f.nextOn} aria-label="Next reminder" className="h-9 rounded-lg border border-line bg-card px-2 text-sm" onChange={(e) => { const v = e.target.value; if (v && v !== f.nextOn) run(() => setFollowUpSchedule(me, b.id, { nextOn: v }), 'Next reminder changed') }} /> : fmtDate(f.nextOn)}</Td>
                    <Td className="text-xs">{f.lastOn ? fmtDate(f.lastOn) : <span className="text-mute">none yet</span>}</Td>
                    <Td>{may ? <input type="date" defaultValue={b.deadline || ''} aria-label="Client deadline" className="h-9 rounded-lg border border-line bg-card px-2 text-sm" onChange={(e) => run(() => setFileDeadline(me, b.id, e.target.value || null), e.target.value ? 'Client deadline set' : 'Client deadline removed')} /> : b.deadline ? fmtDate(b.deadline) : '—'}</Td>
                    <Td className="text-right">{may && <Button size="sm" variant="ghost" icon={f.paused ? Play : Pause} onClick={() => run(() => setFollowUpSchedule(me, b.id, { paused: !f.paused }), f.paused ? 'Reminders resumed' : 'Reminders paused')}>{f.paused ? 'Resume' : 'Pause'}</Button>}</Td>
                  </tr>
                )
              })}</tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'docs' && (
        <Card className="overflow-hidden">
          <CardHeader title="Documents still awaited from clients" icon={FileWarning} subtitle="Operations and Admin are reminded every 7 days until each one arrives" />
          {!docs.length ? <EmptyState icon={FileWarning} title="Nothing awaited" /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Document</Th><Th>Asked</Th><Th>Waiting</Th><Th>Operations · Admin</Th></tr></thead>
              <tbody>{docs.filter(({ b }) => match(b)).map(({ b, s, since }) => (
                <tr key={`${b.id}-${s.id}`}>
                  <Td><Link to={`/bookings/${b.id}?tab=workflow`} className="font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{b.bookingId}</span></Td>
                  <Td className="text-sm">{s.label}<span className="block text-[11px] text-mute">{clientDocState(b, s.id) === 'RESUBMISSION' ? 'Asked again' : 'Upload needed'}</span></Td>
                  <Td className="text-xs">{since ? fmtDate(since.slice(0, 10)) : '—'}</Td>
                  <Td>{since ? <Badge tone={days(since.slice(0, 10), t) > 7 ? 'red' : 'amber'}>{days(since.slice(0, 10), t)} days</Badge> : '—'}</Td>
                  <Td className="text-xs">{userName(db, b.opsMemberId)}<span className="block text-mute">{b.adminId ? userName(db, b.adminId) : '—'}</span></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'team' && (
        <Card className="overflow-hidden">
          <CardHeader title="Who has what" icon={Users} subtitle="Open deadlines per person — the one with the most overdue first" />
          {!team.length ? <EmptyState icon={Users} title="No open deadlines" /> : (
            <Table>
              <thead><tr><Th>Person</Th><Th className="text-right">Overdue</Th><Th className="text-right">Due soon</Th><Th className="text-right">Open</Th></tr></thead>
              <tbody>{team.map(([id, r]) => (
                <tr key={id}><Td className="font-semibold">{userName(db, id)}</Td><Td className="text-right">{r.overdue ? <Badge tone="red">{r.overdue}</Badge> : 0}</Td><Td className="text-right">{r.soon ? <Badge tone="amber">{r.soon}</Badge> : 0}</Td><Td className="text-right font-semibold">{r.open}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card className="overflow-hidden">
          <CardHeader title="Reminder and deadline history" icon={History} subtitle="Reminders sent, schedules and deadlines changed — newest first" />
          {!history.length ? <EmptyState icon={History} title="Nothing yet" /> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Client</Th><Th>What</Th><Th>Details</Th><Th>By</Th></tr></thead>
              <tbody>{history.map((h, i) => (
                <tr key={i}><Td className="whitespace-nowrap text-xs text-mute">{fmtDateTime(h.at)}</Td>
                  <Td className="text-sm">{h.b ? <Link to={`/bookings/${h.b.id}`} className="hover:underline"><span className="font-mono text-[11px]">{h.b.bookingId}</span> {h.b.companyName}</Link> : '—'}</Td>
                  <Td className="text-sm font-semibold">{h.what}</Td><Td className="text-xs">{h.note ?? ''}</Td><Td className="text-xs">{h.by ? userName(db, h.by) : 'Automatic'}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
