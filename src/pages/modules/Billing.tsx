import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, FilePlus2, IndianRupee, Plus, Receipt, Trash2, Wallet, AlertCircle } from 'lucide-react'
import type { Invoice, InvoiceItem } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { createInvoice, userName, visibleInvoices } from '../../lib/actions'
import { INDIAN_STATES, addDays, downloadCsv, fmtDate, gstSplit, inr, invoiceTotals, today, ymd } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Table, Tabs, Td, Th, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

const statusTone = { ISSUED: 'blue', PARTIALLY_PAID: 'amber', PAID: 'green', CANCELLED: 'gray' } as const

export default function Billing() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'TAX' | 'PROFORMA' | 'due'>('all')
  const [open, setOpen] = useState(false)
  const all = visibleInvoices(db, me)
  const st = db.settings.supplierState
  const rows = useMemo(() => all.map((i) => ({ i, t: invoiceTotals(i, st) })), [all, st])
  const list = rows.filter(({ i, t }) => (tab === 'all' || (tab === 'due' ? t.balance > 0.5 && i.status !== 'CANCELLED' : i.type === tab)) && (!q || `${i.number} ${i.client} ${i.gstin}`.toLowerCase().includes(q.toLowerCase())))
  const billed = rows.filter((r) => r.i.status !== 'CANCELLED' && r.i.type === 'TAX').reduce((s, r) => s + r.t.grand, 0)
  const paid = rows.filter((r) => r.i.status !== 'CANCELLED').reduce((s, r) => s + r.i.paid, 0)
  const due = rows.filter((r) => r.i.status !== 'CANCELLED').reduce((s, r) => s + Math.max(0, r.t.balance), 0)

  // new invoice form
  const [f, setF] = useState({ type: (can('billing.manage') ? 'TAX' : 'PROFORMA') as Invoice['type'], client: '', gstin: '', state: 'Gujarat', due: ymd(addDays(new Date(), 15)) })
  const [items, setItems] = useState<InvoiceItem[]>([{ desc: '', sac: '998311', qty: 1, rate: 0, gstRate: 18 }])
  const draft = invoiceTotals({ ...f, items, paid: 0 } as unknown as Invoice, st)

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

      <Modal open={open} onClose={() => setOpen(false)} size="xl" title="New invoice" subtitle={`Supplier state ${st}: same state → CGST + SGST, otherwise IGST`}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button icon={FilePlus2} onClick={async () => { const id = await run(() => createInvoice(me, { ...f, items }), 'Invoice created'); if (typeof id === 'string') { setOpen(false); nav(`/billing/${id}`) } }}>Create {f.type === 'TAX' ? 'tax invoice' : 'proforma'}</Button></>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Invoice['type'] })}>{can('billing.manage') && <option value="TAX">Tax invoice</option>}<option value="PROFORMA">Proforma</option></Select>
          <Input label="Client" required value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} className="sm:col-span-2" list="clients" />
          <datalist id="clients">{db.bookings.map((b) => <option key={b.id} value={b.companyName} />)}</datalist>
          <Input label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />
          <Select label="Place of supply" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
          <Input label="Due date" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-card2 text-left text-[11px] uppercase text-mute"><tr><th className="p-2">Description</th><th className="p-2">SAC</th><th className="p-2">Qty</th><th className="p-2">Rate</th><th className="p-2">GST %</th><th className="p-2 text-right">Amount</th><th /></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const upd = (p: Partial<InvoiceItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
                const cls = 'h-9 w-full rounded-lg border border-line bg-card px-2'
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="p-2"><input className={cls} value={it.desc} onChange={(e) => upd({ desc: e.target.value })} list="svcs" placeholder="Service" /></td>
                    <td className="p-2 w-24"><input className={cls} value={it.sac} onChange={(e) => upd({ sac: e.target.value })} /></td>
                    <td className="p-2 w-16"><input type="number" min={1} className={cls} value={it.qty} onChange={(e) => upd({ qty: Number(e.target.value) })} /></td>
                    <td className="p-2 w-28"><input type="number" min={0} className={cls} value={it.rate || ''} onChange={(e) => upd({ rate: Number(e.target.value) })} /></td>
                    <td className="p-2 w-20"><select className={cls} value={it.gstRate} onChange={(e) => upd({ gstRate: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className="p-2 text-right tabular-nums">{inr(it.qty * it.rate + gstSplit(it.qty * it.rate, it.gstRate, f.state, st).tax)}</td>
                    <td className="p-2"><button aria-label="Remove line" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-mute hover:text-bad"><Trash2 className="size-4" /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="svcs">{db.services.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <Button size="sm" variant="soft" icon={Plus} onClick={() => setItems([...items, { desc: '', sac: '998311', qty: 1, rate: 0, gstRate: 18 }])}>Add line</Button>
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-mute">Taxable</span>{inr(draft.taxable)}</div>
            {draft.igst ? <div className="flex justify-between"><span className="text-mute">IGST</span>{inr(draft.igst)}</div> : <><div className="flex justify-between"><span className="text-mute">CGST</span>{inr(draft.cgst)}</div><div className="flex justify-between"><span className="text-mute">SGST</span>{inr(draft.sgst)}</div></>}
            <div className="flex justify-between border-t border-line pt-1 font-bold"><span>Total</span>{inr(draft.grand)}</div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
