import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Download, IndianRupee, Mail, MessageCircle, Printer, Receipt, Send } from 'lucide-react'
import type { Invoice } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { cancelInvoice, recordInvoicePayment, setInvoiceBranch, userName, visibleInvoices } from '../../lib/actions'
import { fmtDate, fmtDateTime, gstSplit, inr, invoiceTotals, isEmail, isPhone, rupeesInWords } from '../../lib/format'
import { CLOUD } from '../../lib/cloud'
import { invoiceFileName, invoicePdf } from '../../lib/invoicePdf'
import { invoiceShareText, sendInvoiceToClient, type ShareResult } from '../../lib/share'
import { Badge, Button, Card, Checkbox, EmptyState, Input, Modal, Textarea, useConfirm, useRun, useToast } from '../../components/ui'
import { Logo } from '../../components/Logo'

const SHARE_TONE = { SENT: 'green', FAILED: 'red', NOT_CONFIGURED: 'amber', NO_CONTACT: 'amber' } as const
const SHARE_LABEL = { SENT: 'Sent', FAILED: 'Failed', NOT_CONFIGURED: 'Not set up', NO_CONTACT: 'No contact' } as const

/**
 * Send the invoice PDF to the client from the live server: attached to an email and / or as a WhatsApp document
 * (Interakt). Each result is the provider's answer, kept on the invoice.
 */
function SendToClient({ inv, open, onClose }: { inv: Invoice; open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const x = invoiceShareText(db, inv)
  const [email, setEmail] = useState(x.email), [phone, setPhone] = useState(x.phone), [message, setMessage] = useState(x.message)
  const [byEmail, setByEmail] = useState(!!x.email), [byWa, setByWa] = useState(!!x.phone)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ email?: ShareResult; whatsapp?: ShareResult } | null>(null)
  // sent to the same person in the last 24 hours: ask before sending it again
  const digits = (s: string) => s.replace(/\D/g, '').slice(-10)
  const recent = (inv.shares ?? []).filter((s) => s.status === 'SENT' && Date.now() - new Date(s.at).getTime() < 24 * 3600_000
    && ((byEmail && s.channel === 'email' && s.to.toLowerCase() === email.trim().toLowerCase()) || (byWa && s.channel === 'whatsapp' && digits(s.to) === digits(phone))))
  const [again, setAgain] = useState(false)
  const problem = !byEmail && !byWa ? 'Choose email, WhatsApp or both.' : byEmail && !isEmail(email) ? 'Enter a valid email address.' : byWa && !isPhone(phone) ? 'Enter a valid 10-digit mobile number.' : byEmail && message.trim().length < 3 ? 'Write a short message.' : recent.length && !again ? 'Already sent to this recipient — tick “Send it again” to confirm.' : ''
  const send = async () => {
    setBusy(true)
    try {
      const r = await sendInvoiceToClient(db, me, inv, { email: byEmail ? email : undefined, phone: byWa ? phone : undefined, message })
      setResult(r)
      toast(r.success ? 'success' : 'error', r.success ? 'Invoice sent' : 'Not sent — see the details')
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Not sent') } finally { setBusy(false) }
  }
  const line = (k: string, r?: ShareResult) => r && <p className="flex flex-wrap items-center gap-2"><b>{k}</b><Badge tone={SHARE_TONE[r.status]}>{SHARE_LABEL[r.status]}</Badge><span className="text-mute">{r.to}{r.error ? ` — ${r.error}` : ''}</span></p>
  return (
    <Modal open={open} onClose={onClose} title="Send invoice to client" subtitle={`${x.kind} ${inv.number} · the PDF goes as an attachment / WhatsApp document`} size="md"
      footer={<><Button variant="outline" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>{!result && <Button icon={Send} disabled={!!problem || busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</Button>}</>}>
      {result ? <div className="space-y-2 text-sm">{line('Email', result.email)}{line('WhatsApp', result.whatsapp)}<p className="text-[11px] text-mute">“Sent” means the mail server / Interakt accepted it. Delivery and read receipts aren’t tracked.</p></div> : (
        <div className="grid gap-3">
          <Checkbox label="Email with the PDF attached" checked={byEmail} onChange={setByEmail} />
          {byEmail && <Input label="Client email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          {byEmail && <Textarea label="Message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}
          <Checkbox label="WhatsApp (the PDF as a document)" checked={byWa} onChange={setByWa} />
          {byWa && <Input label="Client WhatsApp number" value={phone} onChange={(e) => setPhone(e.target.value)} hint="Uses the invoice template chosen in Workflow settings → WhatsApp." />}
          {recent.length > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
              {recent.map((s) => <p key={s.id}>Already sent by {s.channel === 'email' ? 'email' : 'WhatsApp'} to {s.to} on {fmtDateTime(s.at)}.</p>)}
              <div className="mt-1"><Checkbox label="Send it again" checked={again} onChange={setAgain} /></div>
            </div>
          )}
          {problem && <p className="text-xs text-warn">{problem}</p>}
        </div>
      )}
    </Modal>
  )
}

/**
 * Share by hand: an email from the person's own mail app (attach the PDF) and a WhatsApp chat (wa.me link).
 */
function shareLinks(x: { kind: string; number: string; date: string; due: string; client: string; company: string; total: string; balance: string; email: string; phone: string }) {
  const text = [
    `Dear ${x.client},`, '',
    `Please find your ${x.kind.toLowerCase()} ${x.number} dated ${x.date} from ${x.company}.`,
    `Amount: ${x.total}`, ...(x.balance ? [`Balance due: ${x.balance} by ${x.due}`] : []), '',
    'Thank you,', x.company,
  ].join('\n')
  const digits = x.phone.replace(/\D/g, '').slice(-10)
  return {
    phone: digits,
    mail: `mailto:${encodeURIComponent(x.email)}?subject=${encodeURIComponent(`${x.kind} ${x.number} — ${x.company}`)}&body=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/${digits.length === 10 ? `91${digits}` : ''}?text=${encodeURIComponent(text)}`,
  }
}

export default function InvoiceView() {
  const { id } = useParams()
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [payOpen, setPayOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
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
  const share = shareLinks({
    kind: inv.type === 'TAX' ? 'Tax invoice' : 'Proforma invoice', number: inv.number, date: fmtDate(inv.date), due: fmtDate(inv.due), client: inv.client,
    company: db.settings.companyName, total: inr(t.grand), balance: t.balance > 0.5 ? inr(t.balance) : '',
    email: booking?.paymentEmail || booking?.email || '', phone: booking?.paymentContact || booking?.mobile || '',
  })

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
        <Button icon={Printer} variant="outline" disabled={needBranch} title={needBranch ? 'Choose the branch first' : undefined} onClick={() => window.print()}>Print</Button>
        <Button icon={Download} variant="outline" disabled={needBranch} title={needBranch ? 'Choose the branch first' : 'The PDF exactly as the client receives it'}
          onClick={() => run(async () => { const url = URL.createObjectURL(await invoicePdf(db, inv)); const a = document.createElement('a'); a.href = url; a.download = invoiceFileName(inv); a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000) })}>PDF</Button>
        {inv.status !== 'CANCELLED' && <>
          {CLOUD && can('billing.manage', 'billing.create') && <Button icon={Send} disabled={needBranch} title={needBranch ? 'Choose the branch first' : 'Email the PDF and / or send it on WhatsApp'} onClick={() => setSendOpen(true)}>Send to client</Button>}
          <a href={share.mail} className={needBranch ? 'pointer-events-none opacity-50' : ''} title="Opens your email app with the invoice details — attach the PDF yourself"><Button variant="outline" icon={Mail} disabled={needBranch}>{CLOUD ? 'Mail app' : 'Email'}</Button></a>
          <a href={share.whatsapp} target="_blank" rel="noreferrer" className={needBranch ? 'pointer-events-none opacity-50' : ''} title={share.phone ? `WhatsApp ${share.phone} from your phone / WhatsApp Web` : 'Opens WhatsApp — pick the client'}><Button variant="outline" icon={MessageCircle} disabled={needBranch}>{CLOUD ? 'WhatsApp chat' : 'WhatsApp'}</Button></a>
        </>}
      </div>
      {needBranch && <p className="no-print mb-3 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn">Choose the branch this tax invoice is issued from — its address and GSTIN print on the invoice.</p>}
      {branch && (!branch.address || !branch.bank) && <p className="no-print mb-3 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn">The {branch.name} {!branch.address && !branch.bank ? 'address and bank details aren’t' : !branch.address ? 'address isn’t' : 'bank details aren’t'} filled in yet — Super Admin / IT can add them under Access → Settings → Invoice branches.</p>}
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
            <p className="mt-6 text-[11px] text-[#6B7280]">{branch?.bank ? <>Bank: {branch.bank}<br /></> : null}This is a computer-generated invoice.</p>
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
      {!!inv.shares?.length && (
        <Card className="no-print mt-4 p-4">
          <p className="mb-2 text-sm font-bold">Sent to the client</p>
          <div className="space-y-1.5 text-sm">
            {inv.shares.map((s) => (
              <p key={s.id} className="flex flex-wrap items-center gap-2">
                {s.channel === 'email' ? <Mail className="size-4 text-mute" /> : <MessageCircle className="size-4 text-mute" />}
                <span>{s.to || '—'}</span><Badge tone={SHARE_TONE[s.status]}>{SHARE_LABEL[s.status]}</Badge>
                <span className="text-xs text-mute">{fmtDateTime(s.at)} · {userName(db, s.by)}{s.error ? ` · ${s.error}` : ''}</span>
              </p>
            ))}
          </div>
        </Card>
      )}
      {sendOpen && <SendToClient inv={inv} open onClose={() => setSendOpen(false)} />}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" size="sm"
        footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => recordInvoicePayment(me, inv.id, amt, t.grand), 'Payment recorded')) setPayOpen(false) }}>Save</Button></>}>
        <Input label="Amount received (₹)" type="number" min={0} value={amt || ''} onChange={(e) => setAmt(Number(e.target.value))} hint={`Balance ${inr(t.balance)}`} />
      </Modal>
      {node}
    </div>
  )
}
