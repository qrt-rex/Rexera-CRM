import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownUp, BadgePercent, CheckCircle2, Download, FileDown, RotateCcw } from 'lucide-react'
import type { Booking } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { commissionDue, setCommissionPaid, userName, visibleBookings } from '../../lib/actions'
import { commissionPdf, type CommissionRow } from '../../lib/commissionPdf'
import { downloadCsv, fmtDate, inr, today } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Table, Tabs, Td, Th, useConfirm, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

type Sort = 'newest' | 'oldest' | 'amount' | 'name'
const MODES = ['NEFT', 'IMPS', 'UPI', 'RTGS', 'Cheque', 'Cash']

/**
 * Accounts: every CA / DSA commission on the CRM entries — what is owed and what was paid. The amount is worked out from
 * the payments actually received (before GST), so it is always current; once paid, the paid amount is kept.
 */
export default function Commission() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [tab, setTab] = useState<'PENDING' | 'PAID' | 'ALL'>('PENDING')
  const [to, setTo] = useState<'' | 'CA' | 'DSA'>('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [paying, setPaying] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => visibleBookings(db, me).filter((b) => b.commission).map((b) => {
    const c = b.commission!
    return { b, c, status: (c.status ?? 'PENDING') as 'PENDING' | 'PAID', base: b.payments.reduce((t, p) => t + p.amount, 0), amount: commissionDue(b) }
  }), [db, me])
  const list = rows
    .filter((r) => (tab === 'ALL' || r.status === tab) && (!to || r.c.to === to))
    .filter((r) => !q || `${r.b.companyName} ${r.b.bookingId} ${r.c.name} ${r.c.ref ?? ''} ${userName(db, r.b.createdBy)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => sort === 'amount' ? y.amount - x.amount : sort === 'name' ? x.c.name.localeCompare(y.c.name) : sort === 'oldest' ? x.c.at.localeCompare(y.c.at) : y.c.at.localeCompare(x.c.at))
  const sum = (s?: 'PENDING' | 'PAID') => rows.filter((r) => !s || r.status === s).reduce((t, r) => t + r.amount, 0)
  const toRow = (r: (typeof list)[number]): CommissionRow => ({
    crm: r.b.bookingId, client: r.b.companyName, sales: userName(db, r.b.createdBy), to: r.c.to, name: r.c.name, pct: r.c.pct, base: r.base, amount: r.amount,
    status: r.status, paidOn: r.c.paidOn, mode: r.c.mode, ref: r.c.ref, setOn: r.c.at,
  })
  const filterText = [tab === 'ALL' ? 'All' : tab === 'PAID' ? 'Paid' : 'Not paid', to || 'CA + DSA', q && `"${q}"`].filter(Boolean).join(' | ')
  const exportPdf = async () => {
    setBusy(true)
    try {
      const blob = await commissionPdf(db.settings.companyName || 'Rexera', list.map(toRow), filterText)
      const url = URL.createObjectURL(blob), a = document.createElement('a')
      a.href = url; a.download = `commission-${today()}.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Commission" subtitle="CA / DSA commission on every CRM entry — worked out from the payments received (before GST)" icon={BadgePercent}
        actions={<>
          <Button variant="outline" icon={Download} disabled={!list.length} onClick={() => downloadCsv(`commission-${today()}.csv`, list.map((r) => ({ ...toRow(r), status: r.status === 'PAID' ? 'Paid' : 'Not paid' })))}>CSV</Button>
          <Button icon={FileDown} loading={busy} onClick={exportPdf}>Export PDF</Button>
        </>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Commissions" value={rows.length} icon={BadgePercent} />
        <MiniStat label="Total commission" value={inr(sum())} icon={BadgePercent} tone="violet" />
        <MiniStat label="Not paid yet" value={inr(sum('PENDING'))} icon={BadgePercent} tone="amber" />
        <MiniStat label="Paid" value={inr(sum('PAID'))} icon={CheckCircle2} tone="green" />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'PENDING', label: 'Not paid', count: rows.filter((r) => r.status === 'PENDING').length },
            { id: 'PAID', label: 'Paid', count: rows.filter((r) => r.status === 'PAID').length },
            { id: 'ALL', label: 'All', count: rows.length },
          ]} />
          <select value={to} onChange={(e) => setTo(e.target.value as '' | 'CA' | 'DSA')} aria-label="CA or DSA" className="h-10 rounded-xl border border-line bg-card px-3 text-sm"><option value="">CA + DSA</option><option value="CA">CA</option><option value="DSA">DSA</option></select>
          <label className="flex items-center gap-1.5 text-sm text-mute"><ArrowDownUp className="size-4" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="h-10 rounded-xl border border-line bg-card px-3 text-sm text-ink">
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Highest amount</option><option value="name">CA / DSA name</option>
            </select></label>
          <SearchBox value={q} onChange={setQ} placeholder="Search client, CRM ID, CA / DSA, reference…" className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={BadgePercent} title="No commissions here" text="Accounts adds a commission on the client's CRM entry (Commission card)." /> : (
          <Table>
            <thead><tr><Th>Client</Th><Th>CA / DSA</Th><Th className="text-right">Collected (excl. GST)</Th><Th className="text-right">Commission</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.b.id} className="hover:bg-card2/60">
                  <Td><Link to={`/bookings/${r.b.id}`} className="font-semibold hover:text-brand-ink hover:underline">{r.b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{r.b.bookingId} · {userName(db, r.b.createdBy)}</span></Td>
                  <Td><b>{r.c.name}</b><span className="block text-[11px] text-mute">{r.c.to} · {r.c.pct}% · set {fmtDate(r.c.at)} by {userName(db, r.c.by)}</span></Td>
                  <Td className="text-right tabular-nums">{inr(r.base)}</Td>
                  <Td className="text-right font-bold tabular-nums">{inr(r.amount)}</Td>
                  <Td>{r.status === 'PAID'
                    ? <span><Badge tone="green">Paid</Badge><span className="block text-[11px] text-mute">{fmtDate(r.c.paidOn)} · {r.c.mode}{r.c.ref ? ` · ${r.c.ref}` : ''}{r.c.paidBy ? ` · ${userName(db, r.c.paidBy)}` : ''}</span></span>
                    : <Badge tone="amber">Not paid</Badge>}</Td>
                  <Td className="text-right">{can('bookings.accounts') && (r.status === 'PAID'
                    ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={async () => { if (await confirm('Mark as not paid?', `${r.c.name} · ${r.b.bookingId}`)) run(() => setCommissionPaid(me, r.b.id, null), 'Marked not paid') }}>Undo</Button>
                    : <Button size="sm" variant="success" icon={CheckCircle2} disabled={r.amount <= 0} title={r.amount <= 0 ? 'No payment received yet' : undefined} onClick={() => setPaying(r.b)}>Mark paid</Button>)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {paying && <PayModal b={paying} onClose={() => setPaying(null)} />}
      {node}
    </div>
  )
}

function PayModal({ b, onClose }: { b: Booking; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState({ paidOn: today(), mode: 'NEFT', ref: '' })
  return (
    <Modal open onClose={onClose} title="Commission paid" subtitle={`${b.commission!.to} ${b.commission!.name} · ${b.bookingId} · ${inr(commissionDue(b))}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => setCommissionPaid(me, b.id, f), 'Commission marked paid')) onClose() }}>Save</Button></>}>
      <div className="grid gap-3">
        <Input label="Paid on" type="date" max={today()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />
        <Select label="Mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</Select>
        <Input label="Reference (UTR / cheque no.)" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      </div>
    </Modal>
  )
}
