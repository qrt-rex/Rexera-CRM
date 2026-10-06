import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, IndianRupee, Printer, Receipt } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { cancelInvoice, recordInvoicePayment, setInvoiceBranch, userName, visibleInvoices } from '../../lib/actions'
import { fmtDate, gstSplit, inr, invoiceTotals, rupeesInWords } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Input, Modal, useConfirm, useRun } from '../../components/ui'
import { Logo } from '../../components/Logo'

export default function InvoiceView() {
  const { id } = useParams()
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [payOpen, setPayOpen] = useState(false)
  const [amt, setAmt] = useState(0)
  const inv = visibleInvoices(db, me).find((x) => x.id === id)
  if (!inv) return <Card><EmptyState icon={Receipt} title="Invoice not found" action={<Link to="/billing"><Button>All invoices</Button></Link>} /></Card>
  const branches = db.settings.branches ?? []
  const branch = branches.find((x) => x.id === inv.branchId)
  const st = branch?.state || db.settings.supplierState
  const t = invoiceTotals(inv, st)
  const booking = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined
  const clientAddress = inv.clientAddress || [booking?.address, booking?.city, booking?.state].filter(Boolean).join(', ')
  const creator = db.users.find((u) => u.id === inv.createdBy)
  const needBranch = inv.type === 'TAX' && !branch
  const intra = inv.state.toLowerCase() === st.toLowerCase()

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link to="/billing" className="mr-auto flex items-center gap-1.5 text-sm text-mute hover:text-ink"><ArrowLeft className="size-4" />All invoices</Link>
        {can('billing.manage') && inv.status !== 'CANCELLED' && inv.status !== 'PAID' && <Button variant="success" icon={IndianRupee} onClick={() => { setAmt(t.balance); setPayOpen(true) }}>Record payment</Button>}
        {can('billing.manage') && inv.status !== 'CANCELLED' && <Button variant="outline" icon={Ban} onClick={async () => { if (await confirm('Cancel invoice?', `${inv.number} will stay in the register as cancelled.`, true)) run(() => cancelInvoice(me, inv.id), 'Invoice cancelled') }}>Cancel</Button>}
        {can('billing.manage', 'billing.create') && inv.status !== 'CANCELLED' && (
          <select aria-label="Branch" value={inv.branchId ?? ''} onChange={(e) => run(() => setInvoiceBranch(me, inv.id, e.target.value), 'Branch set')}
            className={`h-10 rounded-xl border bg-card px-3 text-sm font-semibold ${needBranch ? 'border-warn ring-2 ring-warn/20' : 'border-line'}`}>
            <option value="">Choose branch…</option>{branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <Button icon={Printer} disabled={needBranch} title={needBranch ? 'Choose the branch first' : undefined} onClick={() => window.print()}>Print / PDF</Button>
      </div>
      {needBranch && <p className="no-print mb-3 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn">Choose the branch this tax invoice is issued from — its address and GSTIN print on the invoice.</p>}
      {branch && !branch.address && <p className="no-print mb-3 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn">The {branch.name} address isn't filled in yet — Super Admin / IT can add it under Access → Settings → Branches.</p>}
      <Card className="print-area overflow-hidden bg-white text-[#111827]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-[#F47B20] p-8">
          <div className="max-w-sm"><Logo size="md" fixed /><p className="mt-3 text-sm font-semibold">{db.settings.companyName}{branch ? ` — ${branch.name}` : ''}</p>
            {branch ? <>
              <p className="whitespace-pre-line text-xs text-[#374151]">{[branch.address, [branch.city, branch.state, branch.pin].filter(Boolean).join(', ')].filter(Boolean).join('\n') || 'Branch address not set'}</p>
              <p className="text-xs text-[#6B7280]">GSTIN {branch.gstin || db.settings.companyGstin}{branch.phone ? ` · ${branch.phone}` : ''}{branch.email ? ` · ${branch.email}` : ''}</p>
            </> : <p className="text-xs text-[#6B7280]">GSTIN {db.settings.companyGstin} · {st}, India</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold text-[#2E3A8C]">{inv.type === 'TAX' ? 'TAX INVOICE' : 'PROFORMA INVOICE'}</p>
            <p className="font-mono text-sm">{inv.number}</p>
            <p className="text-xs text-[#6B7280]">Date {fmtDate(inv.date)} · Due {fmtDate(inv.due)}</p>
            <Badge tone={inv.status === 'PAID' ? 'green' : inv.status === 'CANCELLED' ? 'gray' : 'amber'} className="mt-2">{inv.status.replace('_', ' ').toLowerCase()}</Badge>
          </div>
        </div>
        <div className="grid gap-6 p-8 sm:grid-cols-2">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">Bill to</p><p className="mt-1 font-bold">{inv.client}</p>
            {clientAddress && <p className="text-sm">{clientAddress}</p>}
            <p className="text-sm">GSTIN: {inv.gstin || 'Unregistered'}{(inv.clientPan || booking?.pan) ? ` · PAN: ${inv.clientPan || booking?.pan}` : ''}</p>
            <p className="text-sm">Place of supply: {inv.state}</p>
            {booking && <p className="text-sm">{booking.contactPerson}{booking.mobile ? ` · ${booking.mobile}` : ''}{booking.email ? ` · ${booking.email}` : ''}</p>}</div>
          <div className="sm:text-right"><p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">Sales person</p><p className="mt-1 font-semibold">{userName(db, inv.salesPerson)}</p>
            {booking && <p className="text-sm text-[#6B7280]">CRM entry {booking.bookingId}</p>}</div>
        </div>
        <div className="overflow-x-auto px-8">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-[#ECEEFB] text-left text-[11px] uppercase text-[#2E3A8C]"><th className="p-2">#</th><th className="p-2">Description</th><th className="p-2">SAC</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Taxable</th>{intra ? <><th className="p-2 text-right">CGST</th><th className="p-2 text-right">SGST</th></> : <th className="p-2 text-right">IGST</th>}</tr></thead>
            <tbody>
              {inv.items.map((it, i) => {
                const tx = it.qty * it.rate
                const g = gstSplit(tx, it.gstRate, inv.state, st)
                return <tr key={i} className="border-b border-[#E3E6EB]"><td className="p-2">{i + 1}</td><td className="p-2 font-medium">{it.desc}</td><td className="p-2">{it.sac}</td><td className="p-2 text-right">{it.qty}</td><td className="p-2 text-right">{inr(it.rate)}</td><td className="p-2 text-right">{inr(tx)}</td>{intra ? <><td className="p-2 text-right">{inr(g.cgst)}<span className="block text-[10px] text-[#6B7280]">{it.gstRate / 2}%</span></td><td className="p-2 text-right">{inr(g.sgst)}<span className="block text-[10px] text-[#6B7280]">{it.gstRate / 2}%</span></td></> : <td className="p-2 text-right">{inr(g.igst)}<span className="block text-[10px] text-[#6B7280]">{it.gstRate}%</span></td>}</tr>
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 p-8 sm:grid-cols-2">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">Amount in words</p><p className="mt-1 text-sm font-semibold">{rupeesInWords(t.grand)}</p>
            <p className="mt-6 text-[11px] text-[#6B7280]">Bank: HDFC Bank · A/c 50200012345678 · IFSC HDFC0001234<br />This is a computer-generated invoice.</p>
            <p className="mt-2 text-[11px] text-[#6B7280]">Generated by: <b className="text-[#111827]">{creator ? `${creator.name} (@${creator.username})` : '—'}</b>{branch ? ` · Branch: ${branch.name}` : ''}</p></div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-[#6B7280]">Taxable value</span>{inr(t.taxable)}</div>
            {intra ? <><div className="flex justify-between"><span className="text-[#6B7280]">CGST</span>{inr(t.cgst)}</div><div className="flex justify-between"><span className="text-[#6B7280]">SGST</span>{inr(t.sgst)}</div></> : <div className="flex justify-between"><span className="text-[#6B7280]">IGST</span>{inr(t.igst)}</div>}
            <div className="flex justify-between border-t-2 border-[#2E3A8C] pt-2 text-lg font-extrabold text-[#2E3A8C]"><span>Grand total</span>{inr(t.grand)}</div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Paid</span>{inr(inv.paid)}</div>
            <div className="flex justify-between font-bold text-[#DC2626]"><span>Balance</span>{inr(Math.max(0, t.balance))}</div>
          </div>
        </div>
      </Card>
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" size="sm"
        footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => recordInvoicePayment(me, inv.id, amt, t.grand), 'Payment recorded')) setPayOpen(false) }}>Save</Button></>}>
        <Input label="Amount received (₹)" type="number" min={0} value={amt || ''} onChange={(e) => setAmt(Number(e.target.value))} hint={`Balance ${inr(t.balance)}`} />
      </Modal>
      {node}
    </div>
  )
}
