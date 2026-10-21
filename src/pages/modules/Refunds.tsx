import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Undo2 } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName, visibleBookings } from '../../lib/actions'
import { downloadCsv, fmtDate, inr, today } from '../../lib/format'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

/** Accounts only: every refund entry — which clients were paid back and which are still waiting. */
export default function Refunds() {
  const db = useDb()
  const me = useMe()
  const [tab, setTab] = useState<'PENDING' | 'REFUNDED' | 'ALL'>('PENDING')
  const [q, setQ] = useState('')
  const rows = useMemo(() => visibleBookings(db, me).flatMap((b) => (b.refunds ?? []).map((r) => ({ b, r }))).sort((x, y) => y.r.date.localeCompare(x.r.date)), [db, me])
  const list = rows.filter(({ b, r }) => (tab === 'ALL' || r.status === tab) && (!q || `${b.companyName} ${b.bookingId} ${b.mobile} ${r.reason} ${r.ref ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const sum = (s: 'PENDING' | 'REFUNDED') => rows.filter(({ r }) => r.status === s).reduce((t, { r }) => t + r.amount, 0)
  return (
    <div>
      <PageHeader title="Refunds" subtitle="Accounts only · refund entries from every CRM entry — paid back or not" icon={Undo2}
        actions={<Button variant="outline" icon={Download} onClick={() => downloadCsv(`refunds-${today()}.csv`, list.map(({ b, r }) => ({
          crm_id: b.bookingId, company: b.companyName, sales_person: userName(db, b.createdBy), date: r.date, amount: r.amount, reason: r.reason,
          status: r.status === 'REFUNDED' ? 'Refunded' : 'Not refunded', refunded_on: r.refundedOn ?? '', mode: r.mode ?? '', reference: r.ref ?? '', entered_by: userName(db, r.by),
        })))}>Export</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Not refunded yet" value={inr(sum('PENDING'))} icon={Undo2} tone="amber" />
        <MiniStat label="Refunded" value={inr(sum('REFUNDED'))} icon={Undo2} tone="green" />
        <MiniStat label="Refund entries" value={rows.length} icon={Undo2} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'PENDING', label: 'Not refunded', count: rows.filter(({ r }) => r.status === 'PENDING').length },
            { id: 'REFUNDED', label: 'Refunded', count: rows.filter(({ r }) => r.status === 'REFUNDED').length },
            { id: 'ALL', label: 'All', count: rows.length },
          ]} />
          <SearchBox value={q} onChange={setQ} placeholder="Search client, CRM ID, reason, UTR…" className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={Undo2} title="No refunds here" text="Add a refund entry from the client's CRM entry page (Refunds card)." /> : (
          <Table>
            <thead><tr><Th>Client</Th><Th>Date</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
            <tbody>
              {list.map(({ b, r }) => (
                <tr key={r.id} className="hover:bg-card2/60">
                  <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{b.bookingId} · {userName(db, b.createdBy)}</span></Td>
                  <Td className="text-xs">{fmtDate(r.date)}</Td>
                  <Td className="text-sm">{r.reason}</Td>
                  <Td className="text-right font-bold tabular-nums">{inr(r.amount)}</Td>
                  <Td>{r.status === 'REFUNDED' ? <span><Badge tone="green">Refunded</Badge><span className="block text-[11px] text-mute">{fmtDate(r.refundedOn)} · {r.mode}{r.ref ? ` · ${r.ref}` : ''}</span></span> : <Badge tone="amber">Not refunded yet</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
