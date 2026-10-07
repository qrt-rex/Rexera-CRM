import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Briefcase, Download, Plus } from 'lucide-react'
import type { BookingStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName, visibleBookings } from '../../lib/actions'
import { BOOKING_STATUS, STAGES, stageLabel } from '../../lib/workflow'
import { bookingMoney, downloadCsv, fmtDateTime, inr, today } from '../../lib/format'
import { pipelineTotals } from '../../lib/metrics'
import { Button, Card, EmptyState, PageHeader, SearchBox, Table, Td, Th, usePaged } from '../../components/ui'
import { BookingStatusBadge, DeadlineBadge, MoneyBar, PriorityBadge } from '../../components/booking'
import { StageSelect } from '../../components/StageControls'
import { MiniStat } from '../dashboards/widgets'
import { IndianRupee, Wallet, AlertCircle } from 'lucide-react'

export default function Bookings() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [service, setService] = useState('')
  const [owner, setOwner] = useState('')
  const status = (params.get('status') ?? '') as BookingStatus | ''
  const all = useMemo(() => visibleBookings(db, me), [db, me])

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return all.filter((b) => (!status || b.status === status) && (!service || b.serviceId === service) && (!owner || b.createdBy === owner) &&
      (!s || [b.bookingId, b.companyName, b.contactPerson, b.mobile, b.email, b.serviceName, b.gstin, b.pan].some((x) => x.toLowerCase().includes(s))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [all, q, status, service, owner])
  const { slice, pager } = usePaged(list, 50, [q, status, service, owner])
  const totals = pipelineTotals(db, list)
  const owners = [...new Set(all.map((b) => b.createdBy))]
  const countBy = (st: BookingStatus) => all.filter((b) => b.status === st).length

  return (
    <div>
      <PageHeader title="CRM Entries" subtitle="Every client booking: approval chain, processing stage and money" icon={Briefcase}
        actions={<>
          {can('reports.export', 'bookings.all', 'bookings.team', 'bookings.own') && <Button variant="outline" icon={Download} onClick={() => downloadCsv(`crm-entries-${today()}.csv`, list.map((b) => { const m = bookingMoney(b); return { booking_id: b.bookingId, company: b.companyName, contact: b.contactPerson, mobile: b.mobile, email: b.email, pan: b.pan, gstin: b.gstin, state: b.state, service: b.serviceName, mode: b.mode, status: BOOKING_STATUS[b.status].label, stage: stageLabel(b.stage, b.stageOutcome), quoted: b.totalQuoted, quoted_with_gst: m.quotedWithGst, collected: m.collected, outstanding: m.outstanding, sales_person: b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '', team_leader: userName(db, b.teamLeadId), operations: userName(db, b.opsMemberId), admin: userName(db, b.adminId), booking_date: b.bookingDate ?? b.createdAt.slice(0, 10), entered_at: fmtDateTime(b.createdAt), remarks: b.remarks ?? '' } }))}>Export</Button>}
          {can('bookings.create') && <Link to="/bookings/new"><Button variant="accent" icon={Plus}>New CRM entry</Button></Link>}
        </>} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Quoted (with GST)" value={inr(totals.quoted)} icon={IndianRupee} />
        <MiniStat label="Collected" value={inr(totals.collected)} icon={Wallet} tone="green" />
        <MiniStat label="Outstanding" value={inr(totals.outstanding)} icon={AlertCircle} tone="red" />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setParams({})} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${!status ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>All · {all.length}</button>
        {(Object.keys(BOOKING_STATUS) as BookingStatus[]).map((st) => (
          <button key={st} onClick={() => setParams({ status: st })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${status === st ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>{BOOKING_STATUS[st].label} · {countBy(st)}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search ID, company, mobile, PAN, GSTIN…" className="min-w-60 flex-1" />
          <select value={service} onChange={(e) => setService(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Service">
            <option value="">All services</option>{db.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {owners.length > 1 && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Sales person">
              <option value="">All sales people</option>{owners.map((id) => <option key={id} value={id}>{userName(db, id)}</option>)}
            </select>
          )}
        </div>
        {!list.length ? <EmptyState icon={Briefcase} title="No CRM entries" text="Try another filter, or create a new entry." /> : (
          <Table>
            <thead><tr><Th>Client</Th><Th>Service</Th><Th>Status · stage</Th><Th className="w-52">Payment</Th><Th>Owner</Th><Th>Created</Th></tr></thead>
            <tbody>
              {slice.map((b) => (
                <tr key={b.id} className="hover:bg-card2/60">
                  <Td>
                    <Link to={`/bookings/${b.id}`} className="block font-semibold hover:text-brand-ink">{b.companyName}</Link>
                    <span className="font-mono text-[11px] text-mute">{b.bookingId}</span>
                  </Td>
                  <Td><span className="block max-w-48 truncate">{b.serviceName}</span><span className="flex gap-1 pt-0.5"><PriorityBadge p={b.priority} /><DeadlineBadge b={b} /></span></Td>
                  <Td><BookingStatusBadge b={b} /><StageSelect b={b} /></Td>
                  <Td><MoneyBar b={b} /></Td>
                  <Td className="text-xs">{b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '—'}</Td>
                  <Td className="text-xs text-mute">{fmtDateTime(b.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pager}
      </Card>
    </div>
  )
}
