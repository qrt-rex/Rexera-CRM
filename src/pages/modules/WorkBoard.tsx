import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName, usersWithRole, visibleBookings } from '../../lib/actions'
import { bookingMoney, fmtDate, inr, today } from '../../lib/format'
import { Card, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th, usePaged } from '../../components/ui'
import { BookingStatusBadge, DeadlineBadge, StageTrack } from '../../components/booking'

export default function WorkBoard() {
  const db = useDb()
  const me = useMe()
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
  const { slice, pager } = usePaged(files, 50, [scope, member, q, overdue])

  return (
    <div>
      {/* a fixed, read-only table: stages are moved from inside each client file */}
      <PageHeader title="Client Work Board" subtitle="Every assigned file across the processing stages" icon={FolderKanban} />
      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <Tabs value={scope} onChange={setScope} tabs={[{ id: 'mine', label: 'Assigned to me' }, { id: 'all', label: 'All files' }]} />
        <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        <select value={member} onChange={(e) => setMember(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Member">
          <option value="">All members</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="accent-[var(--brand)]" />Overdue only</label>
      </Card>

      {!files.length ? <Card><EmptyState icon={FolderKanban} title="No files" text="Files appear here once Legal assigns them to Operations." /></Card> : (
        <Card className="overflow-hidden">
          <Table>
            <thead><tr><Th>Client</Th><Th>Status</Th><Th>Stage</Th><Th>Operations</Th><Th>Admin</Th><Th>Deadline</Th><Th className="text-right">Collected</Th></tr></thead>
            <tbody>
              {slice.map((b) => (
                <tr key={b.id} className="hover:bg-card2/60">
                  <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.serviceName}</p></Td>
                  <Td><BookingStatusBadge b={b} /></Td>
                  <Td className="w-48"><StageTrack b={b} /></Td>
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
