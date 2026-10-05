import { Link } from 'react-router-dom'
import {
  BookOpenCheck, Briefcase, CalendarCheck2, CheckCircle2, ClipboardList, FileClock, FileText, FolderKanban, Images, PauseCircle,
  Send, ShieldCheck, UserCheck, UsersRound, ListTodo, Inbox,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { monthStart, waitingFor } from '../../lib/metrics'
import { STAGES } from '../../lib/workflow'
import { fmtDate } from '../../lib/format'
import { EmptyState, Stat } from '../../components/ui'
import { BookingRow, BookingStatusBadge, DeadlineBadge, StageTrack } from '../../components/booking'
import { Greeting, LoginLogoutCard, Section, Tile, TileGrid, UpcomingEvents, ViewAll } from './widgets'

export function OperationsDashboard() {
  const db = useDb()
  const me = useMe()
  const sa = me.role === 'superadmin'
  const mine = db.bookings.filter((b) => (sa || b.opsMemberId === me.id) && b.opsMemberId)
  const active = mine.filter((b) => b.status === 'IN_OPERATIONS')
  const openTasks = mine.flatMap((b) => b.tasks.filter((t) => !t.done)).length
  const pendingDocs = mine.flatMap((b) => b.documents.filter((d) => d.status === 'PENDING')).length
  const hold = mine.filter((b) => b.status === 'ON_HOLD').length
  const toAdmin = mine.filter((b) => b.status === 'WITH_ADMIN').length

  return (
    <div>
      <Greeting subtitle="Operation Team · process client files through the 9 stages" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total files" value={mine.length} icon={FileText} tone="violet" sub="assigned to you" />
        <Stat label="Active files" value={active.length} icon={FolderKanban} tone="green" sub="in operations" />
        <Stat label="Open tasks" value={openTasks} icon={ListTodo} tone="blue" sub="across files" />
        <Stat label="Pending documents" value={pendingDocs} icon={FileClock} tone="amber" sub="to verify" />
        <Stat label="On hold / with Admin" value={`${hold} / ${toAdmin}`} icon={PauseCircle} tone="pink" />
      </div>
      <TileGrid>
        <Tile to="/documents" icon={FileText} label="Document Management" desc="Upload & verify client documents" tone="blue" badge={pendingDocs} />
        <Tile to="/work" icon={ClipboardList} label="Tasks & Follow-ups" desc="Kanban of your files and stages" tone="green" badge={openTasks} />
        <Tile to="/reports" icon={BookOpenCheck} label="Reports" desc="Stage-wise and turnaround" tone="navy" />
        <Tile to="/approvals" icon={Send} label="Assign to Admin" desc="Hand ready files to Admin" tone="orange" badge={active.length} />
        <Tile to="/content" icon={Images} label="Flyer, post edit" desc="Create marketing material" tone="pink" />
        <Tile to="/employees" icon={UsersRound} label="Employee details" desc="Directory and teams" tone="cyan" />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" tone="green" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="My active files" subtitle="Move stages from the file page" icon={FolderKanban} className="xl:col-span-2" action={<ViewAll to="/work" />}>
          {!active.length ? <EmptyState icon={Inbox} title="No active files" text="Legal assigns files to you here." /> : (
            <ul className="divide-y divide-line/70">
              {active.slice(0, 6).map((b) => (
                <li key={b.id} className="px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
                    <DeadlineBadge b={b} />
                    <span className="ml-auto text-xs text-mute">Stage {b.stage}/{STAGES.length} · {STAGES[b.stage - 1]} · max {b.maxStage}</span>
                  </div>
                  <StageTrack b={b} />
                  <p className="mt-2 text-xs text-mute">{b.serviceName} · due {fmtDate(b.deadline)} · {b.tasks.filter((t) => !t.done).length} open task(s)</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-6"><LoginLogoutCard /><UpcomingEvents limit={3} /></div>
      </div>
    </div>
  )
}

export function AdminDashboard() {
  const db = useDb()
  const me = useMe()
  const sa = me.role === 'superadmin'
  const waiting = waitingFor(db, me).filter((b) => ['WITH_ADMIN', 'ON_HOLD'].includes(b.status))
  const assigned = db.bookings.filter((b) => b.status === 'WITH_ADMIN' && (sa || b.adminId === me.id))
  const completed = db.bookings.filter((b) => b.status === 'COMPLETED' && (sa || b.adminId === me.id))
  const hold = db.bookings.filter((b) => b.status === 'ON_HOLD' && (sa || b.adminId === me.id || b.holdFrom === 'WITH_ADMIN'))
  const monthDone = completed.filter((b) => b.updatedAt.slice(0, 10) >= monthStart()).length

  return (
    <div>
      <Greeting subtitle="Admin · finish client work handed over by Operations" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Assigned to me" value={assigned.length} icon={Inbox} tone="blue" />
        <Stat label="On hold clients" value={hold.length} icon={PauseCircle} tone="orange" />
        <Stat label="Completed (all time)" value={completed.length} icon={CheckCircle2} tone="green" />
        <Stat label="Completed this month" value={monthDone} icon={ShieldCheck} tone="violet" />
      </div>
      <TileGrid>
        <Tile to="/approvals" icon={Inbox} label="Operation team → assigned to me" desc="Files waiting for you" tone="blue" badge={assigned.length} highlight={assigned.length > 0} />
        <Tile to="/bookings" icon={Briefcase} label="CRM Entry" desc="Every client file" tone="violet" />
        <Tile to="/content" icon={Images} label="Flyer, post edit" desc="Marketing material" tone="orange" />
        <Tile to="/bookings?status=COMPLETED" icon={CheckCircle2} label="Complete client work" desc="Finished files" tone="green" />
        <Tile to="/bookings?status=ON_HOLD" icon={PauseCircle} label="On hold client" desc="Waiting on client or issue" tone="amber" badge={hold.length} />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Waiting for me" subtitle="Complete, hold or return to Operations" icon={Inbox} className="xl:col-span-2" action={<ViewAll to="/approvals" />}>
          {waiting.length ? waiting.slice(0, 6).map((b) => <BookingRow key={b.id} b={b} />) : <EmptyState icon={CheckCircle2} title="Nothing waiting" text="Operations will assign files to you." />}
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
