import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, IndianRupee, Plus, Receipt, Wallet, AlertCircle } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName, visibleInvoices } from '../../lib/actions'
import { downloadCsv, fmtDate, inr, invoiceTotals, today } from '../../lib/format'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Tabs, Td, Th } from '../../components/ui'
import { InvoiceFormModal } from '../../components/InvoiceForm'
import { MiniStat } from '../dashboards/widgets'

const statusTone = { ISSUED: 'blue', PARTIALLY_PAID: 'amber', PAID: 'green', CANCELLED: 'gray' } as const

export default function Billing() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'TAX' | 'PROFORMA' | 'due'>('all')
  const [params, setParams] = useSearchParams()
  // ?new=1 (e.g. from the dashboard) opens the new-invoice form straight away
  const [open, setOpenState] = useState(() => params.get('new') === '1' && can('billing.create', 'billing.manage'))
  const setOpen = (v: boolean) => { setOpenState(v); if (!v && params.has('new')) setParams({}, { replace: true }) }
  const all = visibleInvoices(db, me)
  const st = db.settings.supplierState
  const rows = useMemo(() => all.map((i) => ({ i, t: invoiceTotals(i, st) })), [all, st])
  const list = rows.filter(({ i, t }) => (tab === 'all' || (tab === 'due' ? t.balance > 0.5 && i.status !== 'CANCELLED' : i.type === tab)) && (!q || `${i.number} ${i.client} ${i.gstin}`.toLowerCase().includes(q.toLowerCase())))
  const billed = rows.filter((r) => r.i.status !== 'CANCELLED' && r.i.type === 'TAX').reduce((s, r) => s + r.t.grand, 0)
  const paid = rows.filter((r) => r.i.status !== 'CANCELLED').reduce((s, r) => s + r.i.paid, 0)
  const due = rows.filter((r) => r.i.status !== 'CANCELLED').reduce((s, r) => s + Math.max(0, r.t.balance), 0)

  return (
    <div>
      <PageHeader title="Invoice / Bill" subtitle={can('billing.manage') ? 'All GST invoices, proforma and receivables' : 'Your invoices and proforma'} icon={IndianRupee}
        actions={<>
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`invoices-${today()}.csv`, list.map(({ i, t }) => ({ number: i.number, type: i.type, date: i.date, client: i.client, gstin: i.gstin, state: i.state, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.grand, paid: i.paid, balance: t.balance, status: i.status, sales_person: userName(db, i.salesPerson) })))}>GST register</Button>
          {can('billing.create', 'billing.manage') && <Button variant="accent" icon={Plus} onClick={() => setOpen(true)}>New invoice</Button>}
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Billed (tax invoices)" value={inr(billed)} icon={Receipt} />
        <MiniStat label="Collected" value={inr(paid)} icon={Wallet} tone="green" />
        <MiniStat label="Receivable" value={inr(due)} icon={AlertCircle} tone="red" />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All', count: rows.length }, { id: 'TAX', label: 'Tax' }, { id: 'PROFORMA', label: 'Proforma' }, { id: 'due', label: 'Receivable' }]} />
          <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={Receipt} title="No invoices" text="Raise one from a CRM entry or create a new invoice." /> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Client</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th>Sales</Th></tr></thead>
            <tbody>
              {list.map(({ i, t }) => (
                <tr key={i.id} className="cursor-pointer hover:bg-card2/60" onClick={() => nav(`/billing/${i.id}`)}>
                  <Td><Link to={`/billing/${i.id}`} className="font-mono font-semibold hover:underline">{i.number}</Link><p className="text-[11px] text-mute">{i.type === 'TAX' ? 'Tax invoice' : 'Proforma'}</p></Td>
                  <Td><p className="font-semibold">{i.client}</p><p className="text-[11px] text-mute">{i.gstin || 'Unregistered'} · {i.state}</p></Td>
                  <Td className="text-xs">{fmtDate(i.date)}<p className="text-mute">due {fmtDate(i.due)}</p></Td>
                  <Td className="text-right font-semibold tabular-nums">{inr(t.grand)}</Td>
                  <Td className="text-right tabular-nums">{t.balance > 0.5 && i.status !== 'CANCELLED' ? <span className="font-semibold text-bad">{inr(t.balance)}</span> : '—'}</Td>
                  <Td><Badge tone={statusTone[i.status]}>{i.status.replace('_', ' ').toLowerCase()}</Badge>{i.status !== 'PAID' && i.status !== 'CANCELLED' && i.due < today() && <Badge tone="red" className="ml-1">overdue</Badge>}</Td>
                  <Td className="text-xs">{userName(db, i.salesPerson)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {open && <InvoiceFormModal onClose={() => setOpen(false)} />}
    </div>
  )
}
