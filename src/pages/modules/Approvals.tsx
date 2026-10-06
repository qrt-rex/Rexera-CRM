import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { waitingFor } from '../../lib/metrics'
import { BOOKING_STATUS } from '../../lib/workflow'
import { Card, EmptyState, PageHeader, SearchBox, Tabs, usePaged } from '../../components/ui'
import { BookingRow } from '../../components/booking'

export default function Approvals() {
  const db = useDb()
  const me = useMe()
  const [q, setQ] = useState('')
  const all = useMemo(() => waitingFor(db, me), [db, me])
  const groups = useMemo(() => [...new Set(all.map((b) => b.status))], [all])
  const [tab, setTab] = useState<string>('all')
  const list = useMemo(() => all.filter((b) => (tab === 'all' || b.status === tab) && (!q || `${b.bookingId} ${b.companyName} ${b.serviceName}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.priority === 'HIGH' ? -1 : 0) - (b.priority === 'HIGH' ? -1 : 0) || a.updatedAt.localeCompare(b.updatedAt)), [all, tab, q])
  const { slice, pager } = usePaged(list, 25, [tab, q])

  return (
    <div>
      <PageHeader title="Waiting for me" subtitle="Oldest and high-priority files first. Every decision is notified and written to the timeline." icon={ClipboardCheck} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All', count: all.length }, ...groups.map((g) => ({ id: g, label: BOOKING_STATUS[g].label, count: all.filter((b) => b.status === g).length }))]} />
          <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        </div>
        {list.length ? slice.map((b) => <BookingRow key={b.id} b={b} />) : <EmptyState icon={CheckCircle2} title="You're all caught up" text="Files that need your decision appear here and in your notifications." />}
        {pager}
      </Card>
    </div>
  )
}
