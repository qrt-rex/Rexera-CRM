import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlarmClock, BellRing, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock, FolderKanban, History, Inbox, ListTodo,
  PauseCircle, Plus, Scale, Send, UserCog, UsersRound,
} from 'lucide-react'
import type { Booking } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { addTask, availableDecisions, TASK_REMIND_DAYS, toggleTask, userName, usersWithRole } from '../../lib/actions'
import { STAGES, stageLabel } from '../../lib/workflow'
import { addDays, ago, bookingMoney, daysBetween, fmtDate, fmtDateTime, inr, today, ymd } from '../../lib/format'
import { monthStart } from '../../lib/metrics'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, cx, EmptyState, Input, PageHeader, SearchBox, Select, Stat, Table, Td, Th, useRun } from '../../components/ui'
import { BookingStatusBadge, DeadlineBadge, DecisionButtons, DecisionModal, PriorityBadge, StageTrack } from '../../components/booking'
import { StageControls } from '../../components/StageControls'

type Filter = 'open' | 'active' | 'admin' | 'hold' | 'overdue' | 'done'
const OPEN = ['IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW', 'ON_HOLD']
const overdue = (b: Booking) => OPEN.includes(b.status) && !!b.deadline && b.deadline < today()
/** The Legal decision that handed the file to Operations (latest one when it was re-assigned). */
const handOver = (b: Booking) => [...b.approvals].reverse().find((a) => a.action === 'ASSIGN_OPS' || a.action === 'ASSIGNED_OPS')
/** Halfway through the current stage; 100% only once the file is completed. */
const progressPct = (b: Booking) => (b.status === 'COMPLETED' ? 100 : Math.round(((Math.max(1, b.stage) - 0.5) / STAGES.length) * 100))

/**
 * Operations Dashboard: every case Legal assigned to the Operation team — status, tasks, people, deadlines and progress.
 * Legal assigns from the queue at the top (the Legal dashboard's "Assign to Operations" opens it); the team works the cases.
 */
export default function OpsDesk() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const isLegal = can('bookings.legal')
  const highlight = params.get('case')
  const ops = usersWithRole(db, 'operations')

  const queue = useMemo(() => db.bookings.filter((b) => b.status === 'PENDING_LEGAL').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)), [db.bookings])
  const cases = useMemo(() => db.bookings.filter((b) => b.opsMemberId && b.status !== 'REJECTED'), [db.bookings])
  const own = cases.filter((b) => b.opsMemberId === me.id)
  const [filter, setFilter] = useState<Filter>('open')
  const [member, setMember] = useState(() => (!isLegal && own.length ? me.id : ''))
  const [q, setQ] = useState('')
  const [assigning, setAssigning] = useState<Booking | null>(null)

  // arriving from "Assign to Operations" on the Legal dashboard: jump to the queue; from an assignment: to the case
  useEffect(() => {
    const id = highlight ? `case-${highlight}` : params.get('view') === 'assign' ? 'assign-queue' : ''
    if (!id) return
    if (highlight) { setFilter('open'); setMember(''); setQ('') }
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [highlight, params])

  const month = monthStart()
  const stats = {
    queue: queue.length,
    active: cases.filter((b) => b.status === 'IN_OPERATIONS').length,
    admin: cases.filter((b) => b.status === 'WITH_ADMIN' || b.status === 'OPS_REVIEW').length,
    hold: cases.filter((b) => b.status === 'ON_HOLD').length,
    overdue: cases.filter(overdue).length,
    week: cases.filter((b) => OPEN.includes(b.status) && b.deadline && b.deadline >= today() && b.deadline <= ymd(addDays(new Date(), 7))).length,
    done: cases.filter((b) => b.status === 'COMPLETED' && b.updatedAt.slice(0, 10) >= month).length,
  }

  const list = useMemo(() => cases
    .filter((b) => ({
      open: OPEN.includes(b.status), active: b.status === 'IN_OPERATIONS', admin: b.status === 'WITH_ADMIN' || b.status === 'OPS_REVIEW',
      hold: b.status === 'ON_HOLD', overdue: overdue(b), done: b.status === 'COMPLETED',
    })[filter])
    .filter((b) => !member || b.opsMemberId === member)
    .filter((b) => !q || `${b.companyName} ${b.bookingId} ${b.serviceName} ${userName(db, b.opsMemberId)} ${userName(db, b.adminId)}`.toLowerCase().includes(q.toLowerCase()))
    // most urgent first: overdue, then nearest deadline
    .sort((a, b) => filter === 'done' ? b.updatedAt.localeCompare(a.updatedAt) : (a.deadline || '9999').localeCompare(b.deadline || '9999')), [cases, filter, member, q, db])

  const workload = useMemo(() => ops.map((u) => {
    const mine = cases.filter((b) => b.opsMemberId === u.id)
    return {
      u, active: mine.filter((b) => b.status === 'IN_OPERATIONS').length, admin: mine.filter((b) => b.status === 'WITH_ADMIN' || b.status === 'OPS_REVIEW').length,
      hold: mine.filter((b) => b.status === 'ON_HOLD').length, overdue: mine.filter(overdue).length,
      tasks: mine.filter((b) => OPEN.includes(b.status)).reduce((n, b) => n + b.tasks.filter((t) => !t.done).length, 0),
      done: mine.filter((b) => b.status === 'COMPLETED' && b.updatedAt.slice(0, 10) >= month).length,
    }
  }).sort((a, b) => b.active + b.hold - (a.active + a.hold)), [ops, cases, month])

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'open', label: 'All open', n: cases.filter((b) => OPEN.includes(b.status)).length }, { id: 'active', label: 'In operations', n: stats.active },
    { id: 'admin', label: 'With Admin / approval', n: stats.admin }, { id: 'hold', label: 'On hold', n: stats.hold },
    { id: 'overdue', label: 'Overdue', n: stats.overdue }, { id: 'done', label: 'Completed', n: cases.filter((b) => b.status === 'COMPLETED').length },
  ]

  return (
    <div>
      <PageHeader title="Operations Dashboard" subtitle="Cases assigned by the Legal team — status, tasks, team, deadlines and progress" icon={UserCog}
        actions={isLegal && <Button variant="accent" icon={Scale} onClick={() => document.getElementById('assign-queue')?.scrollIntoView({ behavior: 'smooth' })}>Assign to Operations{queue.length ? ` · ${queue.length}` : ''}</Button>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Waiting for Legal" value={stats.queue} icon={Scale} tone="violet" sub="to assign" />
        <Stat label="In operations" value={stats.active} icon={FolderKanban} tone="cyan" />
        <Stat label="With Admin / approval" value={stats.admin} icon={Send} tone="blue" />
        <Stat label="On hold" value={stats.hold} icon={PauseCircle} tone="amber" />
        <Stat label="Overdue" value={stats.overdue} icon={AlarmClock} tone="red" />
        <Stat label="Due in 7 days" value={stats.week} icon={Clock} tone="orange" />
        <Stat label="Completed this month" value={stats.done} icon={CheckCircle2} tone="green" />
      </div>

      {/* Legal's queue: approved by Accounts, waiting to be assigned */}
      <Card id="assign-queue" className="mb-6 scroll-mt-24 overflow-hidden">
        <CardHeader title="Waiting to be assigned" subtitle={isLegal ? 'Approved by Accounts — pick the Operation team member, the furthest stage and the deadline' : 'Files Legal is reviewing — they will be assigned to the team'} icon={Inbox} />
        {!queue.length ? <EmptyState icon={CheckCircle2} title="Nothing waiting" text="Files approved by Accounts appear here." /> : (
          <ul className="divide-y divide-line/70">
            {queue.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 px-5 py-3.5 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link><PriorityBadge p={b.priority} /></div>
                  <p className="truncate text-xs text-mute"><span className="font-mono">{b.bookingId}</span> · {b.serviceName} · sales {userName(db, b.createdBy)} · collected {inr(bookingMoney(b).collected)} · waiting {ago(b.updatedAt)}</p>
                </div>
                {availableDecisions(db, me, b).includes('ASSIGN_OPS') && <Button size="sm" variant="accent" icon={UserCog} onClick={() => setAssigning(b)}>Assign to Operations</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 2xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Assigned cases" subtitle={`${list.length} shown · most urgent first`} icon={ClipboardList} />
          <div className="space-y-3 border-b border-line p-4">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setFilter(t.id)}
                  className={cx('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition', filter === t.id ? 'border-brand bg-brand text-white' : t.id === 'overdue' && t.n ? 'border-bad/40 text-bad hover:bg-bad-soft' : 'border-line hover:bg-card2')}>
                  {t.label} · {t.n}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchBox value={q} onChange={setQ} placeholder="Search client, booking ID, service, person…" className="flex-1" />
              <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Team member" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
                <option value="">Whole team</option>
                {ops.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `Me (${u.name})` : u.name}</option>)}
              </select>
            </div>
          </div>
          {!list.length ? <EmptyState icon={FolderKanban} title="No cases here" text={filter === 'open' ? 'Cases appear once Legal assigns them.' : 'Try another filter.'} /> : (
            <ul className="divide-y divide-line/70">{list.map((b) => <CaseCard key={b.id} b={b} highlight={b.id === highlight} />)}</ul>
          )}
        </Card>

        <Card className="self-start overflow-hidden">
          <CardHeader title="Team workload" subtitle="Click a person to see their cases" icon={UsersRound} />
          <Table className="[&_table]:min-w-0">
            <thead><tr><Th>Member</Th><Th className="px-2 text-center" >Active</Th><Th className="px-2 text-center">Hold</Th><Th className="px-2 text-center">Late</Th><Th className="px-2 text-center">Tasks</Th></tr></thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.u.id} onClick={() => setMember(member === w.u.id ? '' : w.u.id)} className={cx('cursor-pointer hover:bg-card2', member === w.u.id && 'bg-brand-soft/60')}>
                  <Td className="py-2.5"><span className="flex items-center gap-2"><Avatar name={w.u.name} photo={w.u.photo} size={28} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{w.u.name}</span><span className="block text-[11px] text-mute">{w.done} done this month{w.admin ? ` · ${w.admin} with Admin` : ''}</span></span></span></Td>
                  <Td className="px-2 text-center font-bold">{w.active}</Td>
                  <Td className="px-2 text-center">{w.hold || '—'}</Td>
                  <Td className={cx('px-2 text-center', w.overdue > 0 && 'font-bold text-bad')}>{w.overdue || '—'}</Td>
                  <Td className="px-2 text-center">{w.tasks || '—'}</Td>
                </tr>
              ))}
              {!workload.length && <tr><Td colSpan={5} className="text-center text-mute">No Operation team members.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>

      {assigning && <DecisionModal b={assigning} kind="ASSIGN_OPS" onClose={() => setAssigning(null)}
        onDone={() => { const id = assigning.id; setAssigning(null); setParams({ case: id }) }} />}
    </div>
  )
}

/** One case: who has it, from whom, deadline, stage progress, tasks and progress updates. */
function CaseCard({ b, highlight }: { b: Booking; highlight: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [open, setOpen] = useState(highlight)
  const [task, setTask] = useState({ title: '', due: '', assignee: b.opsMemberId ?? '', remind: false })
  useEffect(() => { if (highlight) setOpen(true) }, [highlight])
  const from = handOver(b)
  const openTasks = b.tasks.filter((t) => !t.done)
  const next = [...openTasks].sort((x, y) => (x.due ?? '9').localeCompare(y.due ?? '9'))[0]
  const last = b.stageHistory.at(-1)
  const left = b.deadline ? daysBetween(today(), b.deadline) : null
  const pct = progressPct(b)
  const updates = [...b.stageHistory].reverse()
  const people = [b.opsMemberId, b.adminId].filter(Boolean) as string[]

  return (
    <li id={`case-${b.id}`} className={cx('scroll-mt-24 px-5 py-4 transition', highlight && 'bg-accent-soft/40 ring-2 ring-inset ring-accent/50')}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
        <span className="font-mono text-[11px] text-mute">{b.bookingId}</span>
        <BookingStatusBadge b={b} /><PriorityBadge p={b.priority} /><DeadlineBadge b={b} />
        {highlight && <Badge tone="orange">Just assigned</Badge>}
      </div>
      <p className="mt-0.5 truncate text-xs text-mute">{b.serviceName}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div><dt className="text-mute">Assigned to</dt><dd className="mt-0.5 flex items-center gap-1.5 font-semibold"><Avatar name={userName(db, b.opsMemberId)} size={20} />{userName(db, b.opsMemberId)}</dd>{b.adminId && <dd className="mt-0.5 text-mute">Admin: {userName(db, b.adminId)}</dd>}</div>
        <div><dt className="text-mute">Assigned by Legal</dt><dd className="mt-0.5 font-semibold">{from ? userName(db, from.by) : '—'}</dd>{from && <dd className="text-mute">{fmtDate(from.at)}</dd>}</div>
        <div><dt className="text-mute">Deadline</dt><dd className={cx('mt-0.5 font-semibold', left !== null && left < 0 && b.status !== 'COMPLETED' && 'text-bad')}>{b.deadline ? fmtDate(b.deadline) : '—'}</dd>
          {left !== null && b.status !== 'COMPLETED' && <dd className={left < 0 ? 'text-bad' : left <= 3 ? 'text-warn' : 'text-mute'}>{left < 0 ? `${-left} day(s) late` : left === 0 ? 'due today' : `${left} day(s) left`}</dd>}</div>
        <div><dt className="text-mute">Tasks</dt><dd className="mt-0.5 font-semibold">{openTasks.length} open · {b.tasks.length - openTasks.length} done</dd>{next && <dd className="truncate text-mute" title={next.title}>Next: {next.title}{next.due ? ` (${fmtDate(next.due)})` : ''}</dd>}</div>
      </dl>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px]"><span className="font-semibold">{stageLabel(b.stage, b.stageOutcome)} <span className="font-normal text-mute">· stage {b.stage} of {STAGES.length}, allowed up to {b.maxStage}</span></span><span className="font-bold">{pct}%</span></div>
        <StageTrack b={b} />
      </div>
      {from?.remark && <p className="mt-2 rounded-lg bg-card2 px-3 py-1.5 text-xs"><span className="font-semibold">Legal’s instructions:</span> {from.remark}</p>}
      {last && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mute"><History className="size-3.5" />Last update {ago(last.at)} by {userName(db, last.by)}{last.note ? ` — ${last.note}` : ''}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={open ? ChevronUp : ChevronDown} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Tasks & updates'}</Button>
        <StageControls b={b} />
        <span className="ml-auto"><DecisionButtons b={b} size="sm" /></span>
      </div>

      {open && (
        <div className="mt-3 grid gap-4 rounded-2xl border border-line p-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mute"><ListTodo className="size-3.5" />Tasks</p>
            <ul className="space-y-1.5">
              {b.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <button aria-label={t.done ? 'Mark not done' : 'Mark done'} onClick={() => run(() => toggleTask(me, b.id, t.id))}
                    className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2', t.done ? 'border-ok bg-ok text-white' : 'border-line hover:border-ok')}>{t.done && <Check className="size-3" />}</button>
                  <span className="min-w-0 flex-1">
                    <span className={cx(t.done && 'text-mute line-through')}>{t.title}</span>
                    <span className="block text-[11px] text-mute">{t.assignee ? userName(db, t.assignee) : 'Anyone'}{t.due ? ` · due ${fmtDate(t.due)}` : ''} · by {userName(db, t.by)}</span>
                  </span>
                  {t.remindEveryDays && !t.done && <BellRing className="mt-1 size-3.5 shrink-0 text-warn" aria-label={`Reminder every ${t.remindEveryDays} days`} />}
                  {!t.done && t.due && t.due < today() && <Badge tone="red">overdue</Badge>}
                </li>
              ))}
              {!b.tasks.length && <li className="text-sm text-mute">No tasks yet.</li>}
            </ul>
            {b.status !== 'COMPLETED' && (
              <div className="mt-3 space-y-2 rounded-xl bg-card2 p-3">
                <Input placeholder="New task, e.g. Collect audited financials" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} aria-label="New task" />
                <div className="grid grid-cols-2 gap-2">
                  <Select aria-label="Assign to" value={task.assignee} onChange={(e) => setTask({ ...task, assignee: e.target.value })}>
                    <option value="">Anyone</option>
                    {people.map((id) => <option key={id} value={id}>{userName(db, id)}{id === b.adminId ? ' · Admin' : ' · Operations'}</option>)}
                  </Select>
                  <Input type="date" aria-label="Due date" min={today()} value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Checkbox checked={task.remind} onChange={(v) => setTask({ ...task, remind: v })} label={`Remind every ${TASK_REMIND_DAYS} days`} />
                  <Button size="sm" icon={Plus} onClick={async () => { if (await run(() => addTask(me, b.id, task.title, task.due || undefined, { assignee: task.assignee || undefined, remind: task.remind }), 'Task added')) setTask({ ...task, title: '', due: '' }) }}>Add task</Button>
                </div>
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mute"><History className="size-3.5" />Progress updates</p>
            <ol className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {updates.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', i === 0 ? 'bg-accent' : 'bg-line')} />
                  <span className="min-w-0"><span className="font-semibold">{stageLabel(h.stage, h.outcome)}</span>{h.note && <span className="text-mute"> — {h.note}</span>}
                    <span className="block text-[11px] text-mute">{userName(db, h.by)} · {fmtDateTime(h.at)}</span></span>
                </li>
              ))}
              {!updates.length && <li className="text-sm text-mute">No updates yet.</li>}
            </ol>
          </div>
        </div>
      )}
    </li>
  )
}
