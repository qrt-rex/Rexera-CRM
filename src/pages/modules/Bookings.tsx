import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Briefcase, ClipboardList, Columns3, Download, FileText, Pencil, Plus, Rows3 } from 'lucide-react'
import type { Booking, BookingStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { canEditBooking, clientDocState, userName, visibleBookings } from '../../lib/actions'
import { ADMIN_DONE, ADMIN_STAGES } from '../../../supabase/workflow-rules.mjs'
import { FilterBar, MultiFilter, optionsFrom } from '../../components/MultiFilter'
import { rolesOf } from '../../lib/rbac'
import { visibleClientEntries } from '../../lib/clientEntries'
import { ClientEntriesPanel, ClientEntryButtons } from '../../components/ClientEntry'
import { BOOKING_STATUS, STAGES, stageColor, stageLabel } from '../../lib/workflow'
import { addDays, bookingMoney, downloadCsv, fmtDateTime, inr, today, ymd } from '../../lib/format'
import { pipelineTotals } from '../../lib/metrics'
import { Button, Card, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th, usePaged, useRun } from '../../components/ui'
import { openBookingPdf } from '../../lib/bookingPdf'
import { BookingStatusBadge, DeadlineBadge, MoneyBar, PriorityBadge } from '../../components/booking'
import { StageBadge, StageSelect } from '../../components/StageControls'
import { BookingBoard } from '../../components/BookingBoard'
import { MiniStat } from '../dashboards/widgets'
import { IndianRupee, Wallet, AlertCircle } from 'lucide-react'

type FilterKey = 'stage' | 'docs' | 'ops' | 'admin' | 'service' | 'owner' | 'priority' | 'deadline'
const NONE = '-'
const DOCS = { verify: 'Documents to verify', client: 'Waiting for the client', admin: 'Admin work pending', none: 'Nothing pending' } as const
const DEADLINE = { overdue: 'Overdue', soon: 'Due in 3 days', later: 'Later', none: 'No deadline', closed: 'Closed files' } as const
const stageName = (v: string) => (v === '0' ? 'With approvals (not with Operations yet)' : `${v}. ${STAGES[Number(v) - 1]}`)
/** each filter's value(s) for a CRM entry */
const FILTERS: Record<FilterKey, (b: Booking) => string | string[]> = {
  stage: (b) => String(b.opsMemberId ? b.stage : 0),
  docs: (b) => {
    const out: string[] = []
    if (b.documents.some((d) => d.status === 'PENDING')) out.push('verify')
    if (ADMIN_STAGES.some((s) => ['PENDING_UPLOAD', 'RESUBMISSION'].includes(clientDocState(b, s.id) ?? ''))) out.push('client')
    if (Object.values(b.adminWork ?? {}).some((w) => w && !ADMIN_DONE.includes(w.status))) out.push('admin')
    return out.length ? out : 'none'
  },
  ops: (b) => b.opsMemberId || NONE,
  admin: (b) => b.adminId || NONE,
  service: (b) => b.serviceId,
  owner: (b) => b.createdBy,
  priority: (b) => b.priority,
  deadline: (b) => {
    if (['COMPLETED', 'REJECTED'].includes(b.status)) return 'closed'
    if (!b.deadline) return 'none'
    return b.deadline < today() ? 'overdue' : b.deadline <= ymd(addDays(new Date(), 3)) ? 'soon' : 'later'
  },
}

export default function Bookings() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  // Excel-style filters: several values each (none picked = all)
  const [f, setF] = useState<Record<FilterKey, string[]>>({ stage: [], docs: [], ops: [], admin: [], service: [], owner: [], priority: [], deadline: [] })
  const setFilter = (k: FilterKey) => (v: string[]) => setF((x) => ({ ...x, [k]: v }))
  const active = Object.values(f).filter((v) => v.length).length
  const status = (params.get('status') ?? '') as BookingStatus | ''
  // table, or a board with one column per stage (drag a card to move the file)
  const layout = params.get('layout') === 'board' ? 'board' : 'table'
  const setLayout = (l: 'table' | 'board') => { const next = new URLSearchParams(params); if (l === 'board') next.set('layout', 'board'); else next.delete('layout'); setParams(next) }
  const all = useMemo(() => visibleBookings(db, me), [db, me])
  const run = useRun()
  // Legal, the Operation team and Admin get the case table: ID, company, BDM, service, paid with GST, status, PDF
  const desk = ['legal', 'operations', 'admin'].includes(me.role)

  // the rows every filter but one agrees on: each filter's counts show what picking it would give (like Excel)
  const base = useMemo(() => {
    const s = q.toLowerCase()
    return all.filter((b) => (!status || b.status === status) &&
      (!s || [b.bookingId, b.companyName, b.contactPerson, b.mobile, b.email, b.serviceName, b.gstin, b.pan].some((x) => x.toLowerCase().includes(s))))
  }, [all, q, status])
  const rowsExcept = (skip?: FilterKey) => base.filter((b) => (Object.keys(f) as FilterKey[]).every((k) => k === skip || !f[k].length || [FILTERS[k](b)].flat().some((v) => f[k].includes(v))))
  const list = useMemo(() => rowsExcept().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [base, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const { slice, pager } = usePaged(list, 50, [q, status, f])
  const totals = pipelineTotals(db, list)
  const opts = (k: FilterKey, label: (v: string) => string, color?: (v: string) => string | undefined) => optionsFrom(rowsExcept(k), FILTERS[k], label, color)
  const countBy = (st: BookingStatus) => all.filter((b) => b.status === st).length

  // sales people and team leaders see their client entries here too (the step before a CRM entry)
  const withEntries = rolesOf(me).some((r) => r === 'sales' || r === 'teamlead')
  const view = withEntries && params.get('view') === 'client' ? 'client' : 'crm'
  const entryCount = withEntries ? visibleClientEntries(db, me).length : 0

  return (
    <div>
      <PageHeader title="CRM Entries" subtitle={view === 'client' ? 'Client entries: follow up, then convert to a CRM entry once the payment is received' : 'Every client booking: approval chain, processing stage and money'} icon={Briefcase}
        actions={view === 'client' ? <ClientEntryButtons /> : <>
          {can('reports.export', 'bookings.all', 'bookings.team', 'bookings.own') && <Button variant="outline" icon={Download} onClick={() => downloadCsv(`crm-entries-${today()}.csv`, list.map((b) => { const m = bookingMoney(b); return { booking_id: b.bookingId, company: b.companyName, contact: b.contactPerson, mobile: b.mobile, email: b.email, pan: b.pan, gstin: b.gstin, state: b.state, service: b.serviceName, mode: b.mode, status: BOOKING_STATUS[b.status].label, stage: stageLabel(b.stage, b.stageOutcome), quoted: b.totalQuoted, quoted_with_gst: m.quotedWithGst, collected: m.collected, outstanding: m.outstanding, sales_person: b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '', team_leader: userName(db, b.teamLeadId), operations: userName(db, b.opsMemberId), admin: userName(db, b.adminId), booking_date: b.bookingDate ?? ymd(b.createdAt), entered_at: fmtDateTime(b.createdAt), remarks: b.remarks ?? '' } }))}>Export</Button>}
          {can('bookings.create') && <Link to="/bookings/new"><Button variant="accent" icon={Plus}>New CRM entry</Button></Link>}
        </>} />

      {withEntries && <Tabs className="mb-5 w-fit max-w-full" value={view} onChange={(v) => setParams(v === 'client' ? { view: 'client' } : {})} tabs={[
        { id: 'crm', label: 'CRM entries', icon: Briefcase, count: all.length }, { id: 'client', label: 'Client entries', icon: ClipboardList, count: entryCount },
      ]} />}
      {view === 'client' ? <Card className="overflow-hidden"><ClientEntriesPanel lead={rolesOf(me).includes('teamlead')} full /></Card> : <>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Quoted (with GST)" value={inr(totals.quoted)} icon={IndianRupee} />
        <MiniStat label="Collected" value={inr(totals.collected)} icon={Wallet} tone="green" />
        <MiniStat label="Outstanding" value={inr(totals.outstanding)} icon={AlertCircle} tone="red" />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setParams(layout === 'board' ? { layout: 'board' } : {})} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${!status ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>All · {all.length}</button>
        {/* highest count first; statuses with no entries go last */}
        {(Object.keys(BOOKING_STATUS) as BookingStatus[]).map((st) => ({ st, n: countBy(st) })).sort((x, y) => y.n - x.n).map(({ st }) => (
          <button key={st} onClick={() => setParams(layout === 'board' ? { status: st, layout: 'board' } : { status: st })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${status === st ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>{BOOKING_STATUS[st].label} · {countBy(st)}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search ID, company, mobile, PAN, GSTIN…" className="min-w-60 flex-1" />
          <Tabs className="ml-auto" value={layout} onChange={setLayout} tabs={[{ id: 'table', label: 'Table', icon: Rows3 }, { id: 'board', label: 'Board', icon: Columns3 }]} />
          {/* workflow stage, pending documents, who has it, service, sales person, priority, deadline — counts highest first */}
          <div className="w-full">
            <FilterBar active={active} onClear={() => setF({ stage: [], docs: [], ops: [], admin: [], service: [], owner: [], priority: [], deadline: [] })}>
              <MultiFilter label="Stage" keepOrder value={f.stage} onChange={setFilter('stage')} options={[...opts('stage', stageName, (v) => stageColor(Number(v)))].sort((a, b) => Number(a.value) - Number(b.value))} />
              <MultiFilter label="Pending documents" value={f.docs} onChange={setFilter('docs')} options={opts('docs', (v) => DOCS[v as keyof typeof DOCS] ?? v)} />
              <MultiFilter label="Operations" value={f.ops} onChange={setFilter('ops')} options={opts('ops', (v) => (v === NONE ? 'Not assigned' : userName(db, v)))} />
              <MultiFilter label="Admin" value={f.admin} onChange={setFilter('admin')} options={opts('admin', (v) => (v === NONE ? 'Not assigned' : userName(db, v)))} />
              <MultiFilter label="Service" value={f.service} onChange={setFilter('service')} options={opts('service', (v) => db.services.find((s) => s.id === v)?.name ?? all.find((b) => b.serviceId === v)?.serviceName ?? v)} width="w-80" />
              <MultiFilter label="Sales person" value={f.owner} onChange={setFilter('owner')} options={opts('owner', (v) => userName(db, v))} />
              <MultiFilter label="Priority" value={f.priority} onChange={setFilter('priority')} options={opts('priority', (v) => v.charAt(0) + v.slice(1).toLowerCase())} />
              <MultiFilter label="Deadline" value={f.deadline} onChange={setFilter('deadline')} options={opts('deadline', (v) => DEADLINE[v as keyof typeof DEADLINE] ?? v)} />
            </FilterBar>
          </div>
        </div>
        {!list.length ? <EmptyState icon={Briefcase} title="No CRM entries" text="Try another filter, or create a new entry." /> : layout === 'board' ? <BookingBoard list={list} /> : desk ? (
          <Table>
            <thead><tr><Th>CRM ID</Th><Th>Company name</Th><Th>BDM / Sales person</Th><Th>Service</Th><Th className="text-right">Amount paid <span className="normal-case">(incl. GST)</span></Th><Th>Status</Th><Th className="text-center">PDF</Th></tr></thead>
            <tbody>
              {slice.map((b) => {
                const m = bookingMoney(b)
                const pending = b.payments.filter((p) => !p.verified).length
                return (
                  <tr key={b.id} className="hover:bg-card2/60">
                    <Td className="whitespace-nowrap"><Link to={`/bookings/${b.id}`} className="font-mono text-xs font-semibold text-brand-ink hover:underline">{b.bookingId}</Link></Td>
                    <Td><Link to={`/bookings/${b.id}`} className="block font-semibold hover:text-brand-ink">{b.companyName}</Link><span className="text-[11px] text-mute">{b.contactPerson}</span></Td>
                    <Td className="text-sm">{b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '—'}</Td>
                    <Td><span className="block max-w-52 truncate" title={b.serviceName}>{b.serviceName}</span></Td>
                    <Td className="whitespace-nowrap text-right"><span className="block font-bold tabular-nums">{inr(m.collected)}</span><span className="text-[11px] text-mute">of {inr(m.quotedWithGst)}{pending ? ` · ${pending} unverified` : ''}</span></Td>
                    <Td><BookingStatusBadge b={b} />{b.opsMemberId && <StageBadge stage={b.stage} label={stageLabel(b.stage, b.stageOutcome)} className="mt-1 flex w-fit max-w-52" />}</Td>
                    <Td className="text-center"><Button size="sm" variant="outline" icon={FileText} aria-label={`View PDF of ${b.bookingId}`} onClick={() => run(() => openBookingPdf(db, b))}>View</Button></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        ) : (
          <Table>
            <thead><tr><Th>Client</Th><Th>Service</Th><Th>Status · stage</Th><Th className="w-52">Payment</Th><Th>Owner</Th><Th>Created</Th></tr></thead>
            <tbody>
              {slice.map((b) => (
                <tr key={b.id} className="hover:bg-card2/60">
                  <Td>
                    <Link to={`/bookings/${b.id}`} className="block font-semibold hover:text-brand-ink">{b.companyName}</Link>
                    <span className="font-mono text-[11px] text-mute">{b.bookingId}</span>
                    {canEditBooking(db, me, b) && <Link to={`/bookings/${b.id}/edit`} className="ml-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-ink hover:underline"><Pencil className="size-3" />Edit</Link>}
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
        {layout === 'table' && pager}
      </Card>
      </>}
    </div>
  )
}
