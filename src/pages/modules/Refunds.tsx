import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, History, Undo2 } from 'lucide-react'
import type { Booking, Refund } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName, visibleBookings } from '../../lib/actions'
import { downloadCsv, fmtDate, inr, today } from '../../lib/format'
import { REFUND_STATUS, RefundActions, RefundDetails } from '../../components/Refunds'
import { FileLink } from '../../components/FileField'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th, usePaged } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

type Tab = Refund['status'] | 'ALL'
const paymentsOf = (b: Booking, r: Refund) => b.payments.filter((p) => (r.paymentIds ?? []).includes(p.id))

/**
 * Refund report: every refund request on the CRM entries this person can open — Accounts reviews, approves / rejects
 * and completes them (with the transaction ID and proof); everyone else who may ask follows their status here.
 */
export default function Refunds() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const accounts = can('refunds.manage')
  const [params, setParams] = useSearchParams()
  const tab = (['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED', 'ALL'].includes(params.get('tab') ?? '') ? params.get('tab') : accounts ? 'PENDING' : 'ALL') as Tab
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => visibleBookings(db, me).flatMap((b) => (b.refunds ?? []).map((r) => ({ b, r }))).sort((x, y) => y.r.at.localeCompare(x.r.at)), [db, me])
  const ql = q.trim().toLowerCase()
  const list = rows.filter(({ b, r }) => (tab === 'ALL' || r.status === tab) && (!ql || `${b.companyName} ${b.bookingId} ${b.contactPerson} ${b.mobile} ${r.reason} ${r.ref ?? ''} ${userName(db, r.by)}`.toLowerCase().includes(ql)))
  const { slice, pager } = usePaged(list, 25, [tab, q])
  const sum = (s: Refund['status']) => rows.filter(({ r }) => r.status === s).reduce((t, { r }) => t + r.amount, 0)
  const count = (s: Tab) => rows.filter(({ r }) => s === 'ALL' || r.status === s).length

  const exportCsv = () => downloadCsv(`refund-report-${today()}.csv`, list.map(({ b, r }) => ({
    client_name: b.companyName, client_id: b.bookingId, contact: b.contactPerson, refund_amount: r.amount,
    original_payments: paymentsOf(b, r).map((p) => `Part ${p.part} ${p.date} ${p.mode} ₹${p.total}`).join('; '),
    refund_reason: r.reason, requested_by: userName(db, r.by), request_date: r.date, status: REFUND_STATUS[r.status].label,
    reviewed_by: r.reviewedBy ? userName(db, r.reviewedBy) : '', review_note: r.reviewNote ?? '', refunded_on: r.refundedOn ?? '', mode: r.mode ?? '',
    transaction_id: r.ref ?? '', proof: (r.proof ?? []).map((f) => f.name).join('; '), documents: (r.documents ?? []).map((f) => f.name).join('; '),
  })))

  return (
    <div>
      <PageHeader title="Refunds" icon={Undo2}
        subtitle={accounts ? 'Refund requests from Sales, Team Leaders, Operations, Legal and Admin — review, approve or reject, and complete with proof' : 'Refund requests on your clients and where they stand · only Accounts approves and pays refunds'}
        actions={<Button variant="outline" icon={Download} disabled={!list.length} onClick={exportCsv}>Export report</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label={`Pending · ${count('PENDING')}`} value={inr(sum('PENDING'))} icon={Undo2} tone="amber" />
        <MiniStat label={`Approved, to pay · ${count('APPROVED')}`} value={inr(sum('APPROVED'))} icon={Undo2} tone="blue" />
        <MiniStat label={`Completed · ${count('REFUNDED')}`} value={inr(sum('REFUNDED'))} icon={Undo2} tone="green" />
        <MiniStat label={`Rejected · ${count('REJECTED')}`} value={inr(sum('REJECTED'))} icon={Undo2} tone="red" />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={(['PENDING', 'APPROVED', 'REFUNDED', 'REJECTED', 'ALL'] as Tab[]).map((s) => ({ id: s, label: s === 'ALL' ? 'All' : REFUND_STATUS[s].label, count: count(s) }))} />
          <SearchBox value={q} onChange={setQ} placeholder="Search client, CRM ID, reason, person, transaction ID…" className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={Undo2} title="No refunds here" text="Refund requests are made with the Refund button on the client's CRM entry page." /> : (
          <Table>
            <thead><tr>
              <Th>Client · ID</Th><Th className="text-right">Refund amount</Th><Th>Original payment</Th><Th>Reason</Th><Th>Requested by · date</Th>
              <Th>Status</Th><Th>Transaction ID</Th><Th>Proof · documents</Th>{accounts && <Th className="text-right">Accounts</Th>}<Th />
            </tr></thead>
            <tbody>
              {slice.map(({ b, r }) => [
                <tr key={r.id} className="align-top hover:bg-card2/60">
                  <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{b.bookingId}</span></Td>
                  <Td className="text-right font-bold tabular-nums">{inr(r.amount)}</Td>
                  <Td className="text-xs">{paymentsOf(b, r).length ? paymentsOf(b, r).map((p) => <span key={p.id} className="block whitespace-nowrap">Part {p.part} · {fmtDate(p.date)} · {p.mode} · {inr(p.total)}</span>) : <span className="text-mute">—</span>}</Td>
                  <Td className="max-w-64 text-sm">{r.reason}</Td>
                  <Td className="text-xs">{userName(db, r.by)}<span className="block text-mute">{fmtDate(r.date)}</span></Td>
                  <Td><Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>{r.status === 'REFUNDED' && <span className="block text-[11px] text-mute">{fmtDate(r.refundedOn)} · {r.mode}</span>}</Td>
                  <Td className="font-mono text-xs">{r.ref ?? <span className="text-mute">—</span>}</Td>
                  <Td className="text-xs">{[...(r.proof ?? []), ...(r.documents ?? [])].length ? <span className="flex max-w-56 flex-col gap-0.5">{(r.proof ?? []).map((f) => <FileLink key={f.id} file={f} label={`Proof: ${f.name}`} />)}{(r.documents ?? []).map((f) => <FileLink key={f.id} file={f} />)}</span> : <span className="text-mute">—</span>}</Td>
                  {accounts && <Td className="text-right"><RefundActions b={b} r={r} /></Td>}
                  <Td><Button size="sm" variant="ghost" icon={History} aria-label="History" title="History" onClick={() => setOpen(open === r.id ? null : r.id)} /></Td>
                </tr>,
                open === r.id && <tr key={`${r.id}-h`}><td colSpan={accounts ? 10 : 9} className="bg-card2/40 px-5 py-3"><RefundDetails r={r} /></td></tr>,
              ])}
            </tbody>
          </Table>
        )}
        {pager}
      </Card>
    </div>
  )
}
