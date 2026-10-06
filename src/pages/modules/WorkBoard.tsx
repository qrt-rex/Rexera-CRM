import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Columns3, FolderKanban, List, PauseCircle } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName, usersWithRole, visibleBookings } from '../../lib/actions'
import { STAGES } from '../../lib/workflow'
import { bookingMoney, fmtDate, inr, today } from '../../lib/format'
import { Avatar, Badge, Card, cx, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th, usePaged } from '../../components/ui'
import { BookingStatusBadge, DeadlineBadge, PriorityBadge, StageTrack } from '../../components/booking'

/** Cards drawn per column before "Show all" — keeps the board quick with thousands of imported files. */
const COLUMN_CAP = 30

export default function WorkBoard() {
  const db = useDb()
  const me = useMe()
  const [view, setView] = useState<'board' | 'table'>('board')
  // operations/admin open on their own files — unless they have none (e.g. a shared team login), then the whole board
  const [scope, setScope] = useState<'mine' | 'all'>(() => (me.role === 'operations' || me.role === 'admin') && db.bookings.some((b) => b.opsMemberId === me.id || b.adminId === me.id) ? 'mine' : 'all')
  const [member, setMember] = useState('')
  const [q, setQ] = useState('')
  const [overdue, setOverdue] = useState(false)
  const files = useMemo(() => visibleBookings(db, me).filter((b) => b.opsMemberId && ['IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW', 'ON_HOLD', 'COMPLETED'].includes(b.status))
    .filter((b) => scope === 'all' || b.opsMemberId === me.id || b.adminId === me.id)
    .filter((b) => !member || b.opsMemberId === member || b.adminId === member)
    .filter((b) => !overdue || (!!b.deadline && b.deadline < today() && b.status !== 'COMPLETED'))
    .filter((b) => !q || `${b.bookingId} ${b.companyName} ${b.serviceName}`.toLowerCase().includes(q.toLowerCase())), [db, me, scope, member, q, overdue])
  const members = [...usersWithRole(db, 'operations'), ...usersWithRole(db, 'admin')]
  const [expanded, setExpanded] = useState<string[]>([])
  const { slice, pager } = usePaged(files, 50, [scope, member, q, overdue])

  return (
    <div>
      <PageHeader title="Client Work Board" subtitle="Every assigned file across the 9 processing stages" icon={FolderKanban}
        actions={<Tabs value={view} onChange={setView} tabs={[{ id: 'board', label: 'Board', icon: Columns3 }, { id: 'table', label: 'Table', icon: List }]} />} />
      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <Tabs value={scope} onChange={setScope} tabs={[{ id: 'mine', label: 'Assigned to me' }, { id: 'all', label: 'All files' }]} />
        <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        <select value={member} onChange={(e) => setMember(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Member">
          <option value="">All members</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="accent-[var(--brand)]" />Overdue only</label>
      </Card>

      {!files.length ? <Card><EmptyState icon={FolderKanban} title="No files" text="Files appear here once Legal assigns them to Operations." /></Card> : view === 'board' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...STAGES.map((s, i) => ({ key: `s${i + 1}`, title: `${i + 1}. ${s}`, items: files.filter((b) => b.stage === i + 1 && !['ON_HOLD', 'COMPLETED'].includes(b.status)) })),
            { key: 'hold', title: 'On hold', items: files.filter((b) => b.status === 'ON_HOLD') },
            { key: 'done', title: 'Completed', items: files.filter((b) => b.status === 'COMPLETED') }].map((col) => (
            <div key={col.key} className="w-72 shrink-0">
              <div className={cx('mb-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold', col.key === 'hold' ? 'bg-warn-soft text-warn' : col.key === 'done' ? 'bg-ok-soft text-ok' : 'bg-card2')}>
                <span className="truncate">{col.title}</span><span className="rounded-full bg-card px-2 text-xs">{col.items.length}</span>
              </div>
              <div className="space-y-3">
                {(expanded.includes(col.key) ? col.items : col.items.slice(0, COLUMN_CAP)).map((b) => (
                  <Link key={b.id} to={`/bookings/${b.id}`} className="block rounded-2xl border border-line bg-card p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
                    <div className="mb-1 flex items-center gap-1.5"><PriorityBadge p={b.priority} /><DeadlineBadge b={b} /></div>
                    <p className="truncate font-bold">{b.companyName}</p>
                    <p className="truncate text-xs text-mute">{b.serviceName}</p>
                    <div className="my-3"><StageTrack b={b} /></div>
                    {b.holdReason && <p className="mb-2 flex items-center gap-1 text-xs text-warn"><PauseCircle className="size-3" />{b.holdReason}</p>}
                    <div className="flex items-center gap-2 text-[11px] text-mute">
                      <Avatar name={userName(db, b.status === 'WITH_ADMIN' ? b.adminId : b.opsMemberId)} size={22} />
                      <span className="flex-1 truncate">{userName(db, b.status === 'WITH_ADMIN' ? b.adminId : b.opsMemberId)}</span>
                      <span>{b.tasks.filter((t) => !t.done).length} tasks · {fmtDate(b.deadline)}</span>
                    </div>
                    {b.status === 'WITH_ADMIN' && <Badge tone="blue" className="mt-2">With Admin</Badge>}
                    {b.status === 'OPS_REVIEW' && <Badge tone="violet" className="mt-2">Waiting for Operations approval</Badge>}
                  </Link>
                ))}
                {col.items.length > COLUMN_CAP && (
                  <button onClick={() => setExpanded((x) => x.includes(col.key) ? x.filter((k) => k !== col.key) : [...x, col.key])} className="w-full rounded-xl border border-dashed border-line py-2 text-xs font-semibold text-brand-ink hover:bg-card2">
                    {expanded.includes(col.key) ? 'Show fewer' : `Show all ${col.items.length} (${col.items.length - COLUMN_CAP} more)`}
                  </button>
                )}
                {!col.items.length && <p className="rounded-2xl border border-dashed border-line p-4 text-center text-xs text-mute">Empty</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th>Client</Th><Th>Status</Th><Th>Stage</Th><Th>Operations</Th><Th>Admin</Th><Th>Deadline</Th><Th className="text-right">Collected</Th></tr></thead>
            <tbody>
              {slice.map((b) => (
                <tr key={b.id} className="hover:bg-card2/60">
                  <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.serviceName}</p></Td>
                  <Td><BookingStatusBadge b={b} /></Td>
                  <Td className="w-48"><p className="mb-1 text-xs">{b.stage}. {STAGES[b.stage - 1]}</p><StageTrack b={b} /></Td>
                  <Td className="text-xs">{userName(db, b.opsMemberId)}</Td><Td className="text-xs">{userName(db, b.adminId)}</Td>
                  <Td className="text-xs">{fmtDate(b.deadline)} <DeadlineBadge b={b} /></Td>
                  <Td className="text-right text-sm font-semibold">{inr(bookingMoney(b).collected)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {pager}
        </Card>
      )}
    </div>
  )
}
