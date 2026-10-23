import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpenCheck, Briefcase, CalendarCheck2, CheckCircle2, ClipboardList, FileClock, FileText, FolderKanban, Images, PauseCircle,
  Send, ShieldCheck, UserCheck, UserCog, UsersRound, ListTodo, Inbox, FileSignature, Settings2, ClipboardCheck,
} from 'lucide-react'
import { AdminProgressOverview, AutomationAlerts } from '../../components/OpsAutomation'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName, usersWithRole } from '../../lib/actions'
import { isMaster } from '../../lib/rbac'
import { monthStart, waitingFor } from '../../lib/metrics'
import { STAGES } from '../../lib/workflow'
import { ACTIVE_FILE_STATUSES, ADMIN_DONE, ADMIN_STAGES, adminStatusLabel } from '../../../supabase/workflow-rules.mjs'
import { fmtDate, ymd } from '../../lib/format'
import { EmptyState, Stat } from '../../components/ui'
import { HBars } from '../../components/charts'
import { BookingRow, BookingStatusBadge, DeadlineBadge, StageTrack } from '../../components/booking'
import { ClientWorkRow } from '../../components/ClientWork'
import { TasksPanel } from '../../components/TasksPanel'
import { WorkProgressPanel } from '../../components/WorkProgressPanel'
import { Greeting, LoginLogoutCard, Section, Tile, TileGrid, UpcomingEvents, ViewAll } from './widgets'

export function OperationsDashboard() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const sa = isMaster(me)
  const own = useMemo(() => db.bookings.filter((b) => b.opsMemberId === me.id), [db.bookings, me.id])
  // a shared team login (or a lead) usually has no files of its own: open on the whole team
  const canTeam = sa || can('bookings.all')
  const [scope, setScope] = useState<'mine' | 'team'>(() => (canTeam && !own.length ? 'team' : 'mine'))
  const team = scope === 'team' && canTeam
  const mine = useMemo(() => (team ? db.bookings.filter((b) => b.opsMemberId) : own), [team, db.bookings, own])
  const active = useMemo(() => mine.filter((b) => b.status === 'IN_OPERATIONS').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [mine])
  const workload = useMemo(() => team ? usersWithRole(db, 'operations').map((u) => ({ label: u.name, value: db.bookings.filter((b) => b.opsMemberId === u.id && ['IN_OPERATIONS', 'ON_HOLD'].includes(b.status)).length, sub: 'active files' })).filter((x) => x.value).sort((a, b) => b.value - a.value) : [], [team, db])
  const openTasks = mine.flatMap((b) => b.tasks.filter((t) => !t.done)).length
  const pendingDocs = mine.flatMap((b) => b.documents.filter((d) => d.status === 'PENDING')).length
  const hold = mine.filter((b) => b.status === 'ON_HOLD').length
  const toAdmin = mine.filter((b) => b.status === 'WITH_ADMIN').length
  // Admin finished these: the Operations member approves completion
  const toApprove = useMemo(() => db.bookings.filter((b) => b.status === 'OPS_REVIEW' && (team || b.opsMemberId === me.id)), [db.bookings, team, me.id])
  const who = team ? 'team' : 'me'

  return (
    <div>
      <Greeting subtitle="Operation Team · process client files through the 9 stages"
        right={canTeam ? (
          <div role="tablist" aria-label="Which files" className="flex gap-1 rounded-2xl bg-white/10 p-1 backdrop-blur">
            {([['mine', `Assigned to me · ${own.length}`], ['team', 'Whole team']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={scope === id} onClick={() => setScope(id)}
                className={scope === id ? 'rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-[#2E3A8C] shadow-sm' : 'rounded-xl px-3.5 py-2 text-sm font-semibold text-white/85 hover:bg-white/15 hover:text-white'}>{label}</button>
            ))}
          </div>
        ) : undefined} />
      {/* every count opens its list (Operations Dashboard filtered to the same files) */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total files" value={mine.length} icon={FileText} tone="violet" sub={team ? 'across the team' : 'assigned to you'} to={`/ops-desk?filter=all&member=${who}`} />
        <Stat label="Active files" value={active.length} icon={FolderKanban} tone="green" sub="in operations" to={`/ops-desk?filter=active&member=${who}`} />
        <Stat label="Open tasks" value={openTasks} icon={ListTodo} tone="blue" sub="across files" to="/work" />
        <Stat label="Pending documents" value={pendingDocs} icon={FileClock} tone="amber" sub="to verify" to="/documents" />
        <Stat label="On hold" value={hold} icon={PauseCircle} tone="pink" to={`/ops-desk?filter=hold&member=${who}`} />
        <Stat label="With Admin" value={toAdmin} icon={Send} tone="blue" to={`/ops-desk?filter=admin&member=${who}`} />
        <Stat label="Waiting for my approval" value={toApprove.length} icon={CheckCircle2} tone="green" sub="work done by Admin" to={`/ops-desk?filter=review&member=${who}`} />
      </div>
      <TileGrid>
        <Tile to="/ops-desk" icon={UserCog} label="Operations Dashboard" desc="Cases from Legal: status, tasks, deadlines" tone="orange" badge={active.length} highlight={active.length > 0} />
        <Tile to="/documents" icon={FileText} label="Document Management" desc="Upload & verify client documents" tone="blue" badge={pendingDocs} />
        <Tile to="/work" icon={ClipboardList} label="Tasks & Follow-ups" desc="Kanban of your files and stages" tone="green" badge={openTasks} />
        <Tile to="/reports" icon={BookOpenCheck} label="Reports" desc="Stage-wise and turnaround" tone="navy" />
        <Tile to="/approvals" icon={Send} label="Assign to Admin" desc="Hand ready files to Admin" tone="orange" badge={active.length} />
        <Tile to="/content" icon={Images} label="Flyer, post edit" desc="Create marketing material" tone="pink" />
        <Tile to="/employees" icon={UsersRound} label="Employee details" desc="Directory and teams" tone="cyan" />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" tone="green" />
      </TileGrid>
      {toApprove.length > 0 && (
        <Section title="Approve completed client work" subtitle="Admin has finished these — approve to complete, or send back" icon={CheckCircle2} className="mt-6">
          {toApprove.slice(0, 8).map((b) => <BookingRow key={b.id} b={b} />)}
        </Section>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title={team ? 'Team active files' : 'My active files'} subtitle={`${active.length} in operations · client documents shown on each file`} icon={FolderKanban} className="xl:col-span-2" action={<ViewAll to="/work" />}>
          {!active.length ? <EmptyState icon={Inbox} title="No active files" text="Legal assigns files to you here." /> : (
            <ul className="divide-y divide-line/70">
              {active.slice(0, 6).map((b) => <ClientWorkRow key={b.id} b={b} showDocs />)}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <TasksPanel scope={team ? 'all' : 'mine'} />
          {team && <Section title="Team workload" subtitle="Active and on-hold files per person" icon={UsersRound}><div className="max-h-96 overflow-y-auto p-5"><HBars data={workload} /></div></Section>}
          <LoginLogoutCard /><UpcomingEvents limit={3} />
        </div>
      </div>
      <WorkProgressPanel title={team ? 'Client work progress · whole team' : 'Client work progress · all files'} className="mt-6" />
    </div>
  )
}

export function AdminDashboard() {
  const db = useDb()
  const me = useMe()
  const sa = isMaster(me)
  const waiting = waitingFor(db, me).filter((b) => ['WITH_ADMIN', 'ON_HOLD'].includes(b.status))
  const assigned = db.bookings.filter((b) => b.status === 'WITH_ADMIN' && (sa || b.adminId === me.id))
  const completed = db.bookings.filter((b) => b.status === 'COMPLETED' && (sa || b.adminId === me.id))
  const hold = db.bookings.filter((b) => b.status === 'ON_HOLD' && (sa || b.adminId === me.id || b.holdFrom === 'WITH_ADMIN'))
  const monthDone = completed.filter((b) => ymd(b.updatedAt) >= monthStart()).length
  const sentForApproval = db.bookings.filter((b) => b.status === 'OPS_REVIEW' && (sa || b.adminId === me.id)).length
  // single stages the Operation team forwarded to me (Pitch Deck, Finance, DPR, Certification, Submission)
  const myStages = db.bookings.filter((b) => ACTIVE_FILE_STATUSES.includes(b.status)).flatMap((b) => ADMIN_STAGES
    .filter((s) => { const w = b.adminWork?.[s.id]; return !!w && w.assignee === me.id && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED' })
    .map((s) => ({ b, s, w: b.adminWork![s.id]! })))
    .sort((x, y) => (x.w.due || '9999').localeCompare(y.w.due || '9999'))

  return (
    <div>
      <Greeting subtitle="Admin · move client work through the stages, add documents, then send it to Operations for approval" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Assigned to me" value={assigned.length} icon={Inbox} tone="blue" to="/approvals" />
        <Stat label="My open stages" value={myStages.length} icon={ClipboardCheck} tone="cyan" sub="Pitch Deck, DPR, …" onClick={() => document.getElementById('my-stages')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        <Stat label="On hold clients" value={hold.length} icon={PauseCircle} tone="orange" to="/bookings?status=ON_HOLD" />
        <Stat label="Sent for Ops approval" value={sentForApproval} icon={Send} tone="violet" to="/bookings?status=OPS_REVIEW" />
        <Stat label="Completed (all time)" value={completed.length} icon={CheckCircle2} tone="green" to="/bookings?status=COMPLETED" />
        <Stat label="Completed this month" value={monthDone} icon={ShieldCheck} tone="violet" to="/bookings?status=COMPLETED" />
      </div>
      <TileGrid>
        <Tile to="/approvals" icon={Inbox} label="Operation team → assigned to me" desc="Files waiting for you" tone="blue" badge={assigned.length} highlight={assigned.length > 0} />
        <Tile to="/bookings" icon={Briefcase} label="CRM Entry" desc="Every client file" tone="violet" />
        <Tile to="/content" icon={Images} label="Flyer, post edit" desc="Marketing material" tone="orange" />
        <Tile to="/bookings?status=COMPLETED" icon={CheckCircle2} label="Complete client work" desc="Finished files" tone="green" />
        <Tile to="/bookings?status=ON_HOLD" icon={PauseCircle} label="On hold client" desc="Waiting on client or issue" tone="amber" badge={hold.length} />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
        <Tile to="/forms" icon={FileSignature} label="Document Form Builder" desc="Client forms & secure links" tone="violet" />
        <Tile to="/workflow-settings" icon={Settings2} label="Workflow settings" desc="Reminders, welcome message, alerts" tone="navy" />
      </TileGrid>
      <Section id="my-stages" title="My Admin stages" subtitle="Stages the Operation team assigned to you — open one to update its status and upload its file" icon={ClipboardCheck} className="mt-6">
        {!myStages.length ? <EmptyState icon={CheckCircle2} title="No open stages" text="Pitch Deck, Finance, DPR, Certification and Submission stages assigned to you appear here." /> : (
          <ul className="divide-y divide-line/70">
            {myStages.slice(0, 12).map(({ b, s, w }) => (
              <li key={`${b.id}-${s.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <Link to={`/bookings/${b.id}?tab=workflow`} className="font-semibold hover:underline">{s.label} · {b.companyName}</Link>
                  <span className="block text-[11px] text-mute"><span className="font-mono font-semibold text-ink">{w.ref ?? b.bookingId}</span>{w.assignedBy ? ` · from ${userName(db, w.assignedBy)}` : ''}{w.due ? ` · due ${fmtDate(w.due)}` : ''}</span>
                </span>
                <span className="rounded-full bg-card2 px-2.5 py-0.5 text-xs font-semibold">{adminStatusLabel(w.status)}</span>
                <Link to={`/bookings/${b.id}?tab=workflow`} className="text-xs font-semibold text-brand-ink hover:underline">Update / upload</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="mt-6"><AutomationAlerts /><AdminProgressOverview /></div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="My client work" subtitle={`Stages: ${STAGES.join(' → ')}`} icon={Inbox} className="xl:col-span-2" action={<ViewAll to="/work" />}>
          {waiting.length ? <ul className="divide-y divide-line/70">{waiting.slice(0, 8).map((b) => <ClientWorkRow key={b.id} b={b} showDocs />)}</ul> : <EmptyState icon={CheckCircle2} title="Nothing waiting" text="Operations will assign files to you." />}
        </Section>
        <div className="space-y-6">
          <LoginLogoutCard />
          <Section title="Recently completed" icon={CheckCircle2} action={<ViewAll to="/bookings?status=COMPLETED" />}>
            <ul className="divide-y divide-line/70">
              {completed.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><Link to={`/bookings/${b.id}`} className="block truncate text-sm font-semibold hover:underline">{b.companyName}</Link><p className="truncate text-xs text-mute">{b.serviceName} · {userName(db, b.createdBy)}</p></div>
                  <BookingStatusBadge b={b} />
                </li>
              ))}
              {!completed.length && <li className="p-5 text-sm text-mute">No completed files yet.</li>}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}
