import { useRef, useState } from 'react'
import { Check, CheckCircle2, History, Paperclip, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import type { Booking, FileRef, Refund } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { canRequestRefund, deleteRefund, PAYMENT_MODES, refundsOpen, requestRefund, reviewRefund, setRefundStatus, userName } from '../lib/actions'
import { checkFile, deleteFile, saveFile } from '../lib/files'
import { fmtDate, fmtDateTime, inr, today } from '../lib/format'
import { FileLink } from './FileField'
import { Badge, Button, Card, CardHeader, Checkbox, cx, Input, Modal, Select, Table, Td, Textarea, Th, useConfirm, useRun, useToast } from './ui'

export const REFUND_STATUS: Record<Refund['status'], { label: string; tone: 'amber' | 'blue' | 'red' | 'green' }> = {
  PENDING: { label: 'Pending', tone: 'amber' }, APPROVED: { label: 'Approved', tone: 'blue' }, REJECTED: { label: 'Rejected', tone: 'red' }, REFUNDED: { label: 'Completed', tone: 'green' },
}
const STEP: Record<NonNullable<Refund['history']>[number]['action'], string> = { REQUESTED: 'Requested', APPROVED: 'Approved', REJECTED: 'Rejected', COMPLETED: 'Completed', REOPENED: 'Reopened' }
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx'

/** Several files (PDF, image, Word) for a refund: the requester's documents or Accounts' proof. */
function FilesPicker({ label, files, onChange, required }: { label: string; files: FileRef[]; onChange: (f: FileRef[]) => void; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const add = async (list: FileList) => {
    setBusy(true)
    try {
      const out: FileRef[] = []
      for (const f of [...list]) { checkFile(f, ACCEPT, label); out.push(await saveFile(f)) }
      onChange([...files, ...out])
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not attach the file.') } finally { setBusy(false) }
  }
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-mute">{label}{required && <span className="text-bad"> *</span>}</span>
      <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { const l = e.target.files; if (l?.length) void add(l); e.target.value = '' }} />
      {files.length > 0 && <ul className="mb-2 flex flex-wrap gap-2">{files.map((f) => (
        <li key={f.id} className="flex items-center gap-1 rounded-lg bg-card2 py-1 pl-2 pr-1 text-xs"><FileLink file={f} />
          <button type="button" aria-label={`Remove ${f.name}`} className="text-mute hover:text-bad" onClick={() => { deleteFile(f.id).catch(() => {}); onChange(files.filter((x) => x.id !== f.id)) }}><X className="size-3.5" /></button></li>
      ))}</ul>}
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-3 py-2.5 text-left text-sm transition hover:border-brand hover:bg-brand-soft/40">
        <Paperclip className="size-4 text-mute" /><span><b>{busy ? 'Attaching…' : files.length ? 'Add more files' : 'Choose files'}</b><span className="block text-[11px] text-mute">PDF, image or Word · up to 5 MB each</span></span>
      </button>
    </div>
  )
}

/** The Refund button's form: the client, their payment history, transaction details and documents, then the request. */
export function RefundRequestModal({ b, onClose }: { b: Booking; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const verified = b.payments.filter((p) => p.verified).map((p) => p.id)
  const [ids, setIds] = useState<string[]>(verified.length ? verified : b.payments.map((p) => p.id))
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [docs, setDocs] = useState<FileRef[]>([])
  const collected = b.payments.reduce((t, p) => t + p.total, 0), open = refundsOpen(b), max = Math.max(0, collected - open)
  const picked = b.payments.filter((p) => ids.includes(p.id)).reduce((t, p) => t + p.total, 0)
  const close = () => { for (const f of docs) deleteFile(f.id).catch(() => {}); onClose() }
  const info: [string, string | undefined][] = [
    ['Client', b.companyName], ['Contact person', b.contactPerson], ['Mobile', b.mobile], ['Email', b.email], ['CRM ID', b.bookingId], ['Service', b.serviceName],
    ['Sales person', userName(db, b.createdBy)], ['Paid in all', inr(collected)], ['Already asked back / refunded', open ? inr(open) : 'nothing'],
  ]
  return (
    <Modal open onClose={close} size="xl" title={`Refund request · ${b.companyName}`} subtitle="Goes to the Accounts team for review — only Accounts approves and pays refunds"
      footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button icon={Undo2} disabled={!amount || amount > max || reason.trim().length < 5 || (b.payments.length > 0 && !ids.length)}
        onClick={async () => { if (await run(() => requestRefund(me, b.id, { amount, reason, paymentIds: ids, documents: docs }), 'Refund request sent to Accounts')) onClose() }}>Send to Accounts</Button></>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-2 text-sm">{info.filter(([, v]) => v).map(([k, v]) => <div key={k} className="rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">{k}</p><p className="break-words font-semibold">{v}</p></div>)}</div>
          <div className="overflow-hidden rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-xs font-bold">Payment history · tick the payment(s) to refund</p>
            {!b.payments.length ? <p className="px-3 py-3 text-sm text-mute">No payments recorded on this entry.</p> : (
              <table className="w-full text-xs"><thead className="bg-card2 text-mute"><tr><th className="w-8 px-2 py-1.5" /><th className="px-2 py-1.5 text-left">Part · date</th><th className="px-2 py-1.5 text-left">Mode · transaction</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
                <tbody>{b.payments.map((p) => (
                  <tr key={p.id} className="border-t border-line/60">
                    <td className="px-2 py-1.5"><Checkbox label={<span className="sr-only">Payment {p.part}</span>} checked={ids.includes(p.id)} onChange={(on) => setIds(on ? [...ids, p.id] : ids.filter((x) => x !== p.id))} /></td>
                    <td className="px-2 py-1.5">Part {p.part} · {fmtDate(p.date)}{!p.verified && <Badge tone="amber">not verified</Badge>}</td>
                    <td className="px-2 py-1.5">{p.mode}{p.proofName ? ` · ${p.proofName}` : ''}{p.tds ? ` · TDS ${p.tds.pct}%` : ''}{p.proof && <span className="block"><FileLink file={p.proof} label="Payment proof" /></span>}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{inr(p.total)}</td>
                  </tr>
                ))}</tbody></table>
            )}
          </div>
          {b.documents.length > 0 && (
            <div className="rounded-xl border border-line p-3"><p className="mb-1.5 text-xs font-bold">Documents on this entry</p>
              <div className="flex flex-wrap gap-2">{b.documents.slice(0, 12).map((d) => d.file ? <FileLink key={d.id} file={d.file} label={`${d.category}: ${d.name}`} /> : <span key={d.id} className="text-xs text-mute">{d.name}</span>)}</div></div>
          )}
        </div>
        <div className="grid content-start gap-3">
          <Input label="Refund amount (₹)" required type="number" min={0} max={max} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))}
            error={amount > max ? `Up to ${inr(max)} can still be refunded.` : undefined} hint={`Up to ${inr(max)}${picked ? ` · ticked payments total ${inr(picked)}` : ''}`} />
          {picked > 0 && amount !== Math.min(picked, max) && <button type="button" className="-mt-1 w-fit text-xs font-semibold text-brand-ink hover:underline" onClick={() => setAmount(Math.min(picked, max))}>Use {inr(Math.min(picked, max))}</button>}
          <Textarea label="Reason for the refund" required rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened, what the client asked for, any agreement made…" />
          <FilesPicker label="Supporting documents (client's request, cancellation letter, bank details …)" files={docs} onChange={setDocs} />
          <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">After you send it, the request is <b>Pending</b> with Accounts. You can follow it on this entry and on the Refunds page; Accounts approves or rejects it and completes it with the transaction ID and proof.</p>
        </div>
      </div>
    </Modal>
  )
}

/** Accounts' buttons for one refund: approve / reject a pending request, complete an approved one with proof, reopen, delete. */
export function RefundActions({ b, r }: { b: Booking; r: Refund }) {
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [reject, setReject] = useState<string | null>(null)
  const [done, setDone] = useState<{ refundedOn: string; mode: string; ref: string; proof: FileRef[] } | null>(null)
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {r.status === 'PENDING' && <>
        <Button size="sm" variant="success" icon={Check} onClick={() => run(() => reviewRefund(me, b.id, r.id, 'APPROVE', ''), 'Refund approved')}>Approve</Button>
        <Button size="sm" variant="outline" icon={X} onClick={() => setReject('')}>Reject</Button>
      </>}
      {(r.status === 'APPROVED' || r.status === 'PENDING') && <Button size="sm" variant={r.status === 'APPROVED' ? 'accent' : 'ghost'} icon={CheckCircle2} onClick={() => setDone({ refundedOn: today(), mode: 'NEFT', ref: '', proof: [] })}>Complete refund</Button>}
      {r.status === 'REFUNDED' && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={async () => { if (await confirm('Reopen this refund?', 'It goes back to Approved; the transaction ID and proof are cleared.')) run(() => setRefundStatus(me, b.id, r.id, null), 'Refund reopened') }}>Reopen</Button>}
      {(r.status === 'PENDING' || r.status === 'REJECTED') && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete refund request" onClick={async () => { if (await confirm('Delete this refund request?', `${inr(r.amount)} · ${r.reason}`, true)) run(() => deleteRefund(me, b.id, r.id), 'Deleted') }} />}
      <Modal open={reject !== null} onClose={() => setReject(null)} title="Reject the refund request" size="sm"
        footer={<><Button variant="outline" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" disabled={(reject ?? '').trim().length < 3} onClick={async () => { if (reject !== null && await run(() => reviewRefund(me, b.id, r.id, 'REJECT', reject), 'Refund rejected')) setReject(null) }}>Reject</Button></>}>
        <Textarea label="Why it is rejected (shown to the person who asked)" required rows={3} value={reject ?? ''} onChange={(e) => setReject(e.target.value)} />
      </Modal>
      <Modal open={!!done} onClose={() => setDone(null)} title={`Complete refund · ${inr(r.amount)}`} subtitle={`${b.companyName} · ${b.bookingId}`} size="md"
        footer={<><Button variant="outline" onClick={() => setDone(null)}>Cancel</Button><Button icon={CheckCircle2} disabled={!done || done.ref.trim().length < 3 || !done.proof.length} onClick={async () => { if (done && await run(() => setRefundStatus(me, b.id, r.id, done), 'Refund completed')) setDone(null) }}>Mark completed</Button></>}>
        {done && <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Refunded on" type="date" max={today()} value={done.refundedOn} onChange={(e) => setDone({ ...done, refundedOn: e.target.value })} />
          <Select label="Mode" value={done.mode} onChange={(e) => setDone({ ...done, mode: e.target.value })}>{PAYMENT_MODES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input label="Refund transaction ID (UTR / cheque no.)" required value={done.ref} onChange={(e) => setDone({ ...done, ref: e.target.value })} className="sm:col-span-2" />
          <div className="sm:col-span-2"><FilesPicker label="Proof of refund (receipt, transaction screenshot or bank confirmation)" required files={done.proof} onChange={(proof) => setDone({ ...done, proof })} /></div>
        </div>}
      </Modal>
      {node}
    </span>
  )
}

/** Proof, documents and the full history of one refund. */
export function RefundDetails({ r }: { r: Refund }) {
  const db = useDb()
  return (
    <div className="grid gap-2 text-xs">
      {r.reviewNote && <p className={cx('rounded-lg px-2 py-1.5', r.status === 'REJECTED' ? 'bg-bad-soft text-bad' : 'bg-card2')}>Accounts: {r.reviewNote}</p>}
      {!!r.documents?.length && <p className="flex flex-wrap items-center gap-2"><span className="text-mute">Documents:</span>{r.documents.map((f) => <FileLink key={f.id} file={f} />)}</p>}
      {!!r.proof?.length && <p className="flex flex-wrap items-center gap-2"><span className="text-mute">Proof of refund:</span>{r.proof.map((f) => <FileLink key={f.id} file={f} />)}</p>}
      {!!r.history?.length && <ol className="space-y-0.5 border-l-2 border-line pl-3">{r.history.map((h, i) => <li key={i}><b>{STEP[h.action]}</b> · {userName(db, h.by)} · {fmtDateTime(h.at)}{h.note ? ` — ${h.note}` : ''}</li>)}</ol>}
    </div>
  )
}

/** The refunds on one client (CRM entry page): everyone who may ask sees and follows them; Accounts acts on them. */
export function RefundsCard({ b }: { b: Booking }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const accounts = can('refunds.manage')
  const [ask, setAsk] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const list = [...(b.refunds ?? [])].sort((x, y) => y.at.localeCompare(x.at))
  const mayAsk = canRequestRefund(db, me, b)
  if (!accounts && !mayAsk) return null
  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader title="Refunds" icon={Undo2} subtitle={accounts ? 'Requests from every team · approve, reject and complete them with the transaction ID and proof' : 'Ask for a refund and follow it · Accounts approves and pays it'}
        action={mayAsk && <Button size="sm" variant="soft" icon={Undo2} onClick={() => setAsk(true)}>Refund</Button>} />
      {!list.length ? <p className="px-5 py-4 text-sm text-mute">No refund requests on this client.</p> : (
        <Table>
          <thead><tr><Th>Requested</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.map((r) => [
              <tr key={r.id}>
                <Td className="text-xs">{fmtDate(r.date)}<span className="block text-mute">{userName(db, r.by)}</span></Td>
                <Td className="max-w-80 text-sm">{r.reason}</Td>
                <Td className="text-right font-bold tabular-nums">{inr(r.amount)}</Td>
                <Td><Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>{r.status === 'REFUNDED' && <span className="block text-[11px] text-mute">{fmtDate(r.refundedOn)} · {r.mode} · {r.ref}</span>}</Td>
                <Td className="text-right"><span className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="ghost" icon={History} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button>
                  {accounts && <RefundActions b={b} r={r} />}
                </span></Td>
              </tr>,
              open === r.id && <tr key={`${r.id}-d`}><td colSpan={5} className="bg-card2/40 px-5 py-3"><RefundDetails r={r} /></td></tr>,
            ])}
          </tbody>
        </Table>
      )}
      {ask && <RefundRequestModal b={b} onClose={() => setAsk(false)} />}
    </Card>
  )
}
