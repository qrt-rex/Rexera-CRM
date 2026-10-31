import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArrowLeft, Building2, Layers, Check, CheckCircle2, ChevronRight, CircleDot, Download, FileText, FolderKanban, History, IndianRupee, ListTodo, MessageCircle, MessageSquare, Pencil, Plus, Receipt, Send, ShieldCheck, Trash2, X, Lock, Mail, Gift, Percent, Undo2, Workflow } from 'lucide-react'
import { AdminChecklist, FollowUpCard, WelcomeCard } from '../../components/WorkflowPanels'
import { ClientEmailComposer } from '../../components/ClientEmail'
import { MessageClientModal, MessageLog, NextMessage } from '../../components/ClientMessage'
import { mayMessage } from '../../lib/clientMessages'
import type { MessageStageId } from '../../../supabase/message-rules.mjs'
import { ClientPortalCard } from '../../components/ClientPortalPanel'
import { WhatsappClientButton } from '../../components/WhatsappClient'
import { openBookingPdf } from '../../lib/bookingPdf'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { addComboService, addComment, addComplimentaryService, addDocuments, addPayment, addRefund, commissionNow, deleteRefund, needsPriceSplit, addTask, canEditBooking, canEmailClient, canForwardAdminStages, canRunClientPortal, canMoveStage, deleteDocument, deleteTask, invoiceFromBooking, moveStage, PAYMENT_MODES, setCommission, setDeduction, setPaymentTds, setRefundStatus, toggleTask, userName, verifyPayment, visibleBookings, visibleDocuments, visibleTasks } from '../../lib/actions'
import { STAGES, STAGE_OUTCOMES, stageLabel } from '../../lib/workflow'
import { ago, bookingMoney, fmtDate, fmtDateTime, gstSplit, inr, today } from '../../lib/format'
import { isStageOnlyAdmin, roleLabel } from '../../lib/rbac'
import type { FileRef, LegacyRow } from '../../lib/types'
import { DOC_TYPES } from '../../lib/files'
import { FileField } from '../../components/FileField'
import { DocUploader, type PendingDoc } from '../../components/DocUploader'
import { DocReview } from '../../components/DocReview'
import { StageControls, StageText } from '../../components/StageControls'
import { FileLink } from '../../components/FileField'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, cx, EmptyState, Input, Modal, Select, Table, Tabs, Td, Textarea, Th, useConfirm, useRun } from '../../components/ui'
import { canSee, moduleByKey } from '../../lib/modules'
import { BookingStatusBadge, ChainStepper, DeadlineBadge, DecisionButtons, PriorityBadge, StageTrack } from '../../components/booking'

type Tab = 'overview' | 'workflow' | 'processing' | 'documents' | 'timeline' | 'messages' | 'legacy'

export default function BookingDetail() {
  const { id } = useParams()
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [params] = useSearchParams()
  // a notification can open a tab directly (/bookings/<id>?tab=workflow)
  const [tab, setTab] = useState<Tab>(() => (['workflow', 'processing', 'documents', 'timeline', 'messages'].includes(params.get('tab') ?? '') ? params.get('tab') as Tab : 'overview'))
  const [mail, setMail] = useState(false)
  // WhatsApp / email to the client: null = closed, '' = the composer on its first open message
  const [message, setMessage] = useState<MessageStageId | '' | null>(null)
  const b = visibleBookings(db, me).find((x) => x.id === id)
  if (!b) return <Card><EmptyState icon={FileText} title="CRM entry not found" text="It doesn't exist or isn't visible to you." action={<Link to="/bookings"><Button>All CRM entries</Button></Link>} /></Card>
  const m = bookingMoney(b)
  const invoices = db.invoices.filter((i) => i.bookingId === b.id)

  return (
    <div>
      <button onClick={() => nav(-1)} className="mb-4 flex items-center gap-1.5 text-sm text-mute hover:text-ink"><ArrowLeft className="size-4" />Back</button>
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 p-6">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand to-[#5b6ee1] text-white"><Building2 className="size-7" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold">{b.companyName}</h1><BookingStatusBadge b={b} /><PriorityBadge p={b.priority} /><DeadlineBadge b={b} /></div>
            <p className="mt-1 text-sm text-mute"><span className="font-mono font-semibold text-ink">{b.bookingId}</span> · {b.serviceName} · {b.mode} · entered {fmtDateTime(b.createdAt)} by {b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '—'}</p>
            {b.holdReason && <p className="mt-2 inline-flex rounded-lg bg-warn-soft px-3 py-1 text-sm font-medium text-warn">On hold: {b.holdReason}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={FileText} onClick={() => run(() => openBookingPdf(db, b))}>PDF</Button>
            {mayMessage(db, me, { kind: 'booking', b }) && <Button variant="accent" icon={MessageCircle} onClick={() => setMessage('')}>Message client</Button>}
            {canEmailClient(db, me, b) && <Button variant="outline" icon={Mail} onClick={() => setMail(true)}>Detailed email</Button>}
            <WhatsappClientButton b={b} />
            {canEditBooking(db, me, b) && <Link to={`/bookings/${b.id}/edit`}><Button variant="outline" icon={Pencil}>Edit</Button></Link>}
            {can('billing.create', 'billing.manage') && !invoices.length && !['PENDING_TL', 'REJECTED'].includes(b.status) && (
              <Button variant="outline" icon={Receipt} onClick={async () => { const inv = await run(() => invoiceFromBooking(me, b.id, can('billing.manage') ? 'TAX' : 'PROFORMA'), 'Invoice raised'); if (typeof inv === 'string') nav(`/billing/${inv}`) }}>Raise invoice</Button>
            )}
            {/* the invoice page needs billing access; others (e.g. Operations) just see the number */}
            {invoices.map((i) => canSee(moduleByKey('billing'), can)
              ? <Link key={i.id} to={`/billing/${i.id}`}><Button variant="soft" icon={Receipt}>{i.number}</Button></Link>
              : <span key={i.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-card2 px-4 font-mono text-sm font-semibold text-mute"><Receipt className="size-4" />{i.number}</span>)}
          </div>
        </div>
        <div className="border-t border-line bg-card2/50 px-6 py-5"><ChainStepper b={b} /></div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <p className="mr-auto text-sm text-mute">{nextStepText(b.status)}</p>
          <DecisionButtons b={b} />
        </div>
      </Card>

      <NextMessage b={b} onOpen={(s) => setMessage(s)} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Quoted with GST', inr(m.quotedWithGst), ''], ['Collected', inr(m.collected), 'text-ok'], ['Outstanding', inr(m.outstanding), 'text-bad'], ['Stage', b.opsMemberId ? `${stageLabel(b.stage, b.stageOutcome)} (of ${STAGES.length})` : 'Not started', '']].map(([k, v, c]) => (
          <Card key={k} className="p-4"><p className="text-xs font-semibold text-mute">{k}</p><p className={cx('mt-1 truncate text-lg font-extrabold', c)}>{v}</p></Card>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} className="mb-5 w-fit" tabs={[
        { id: 'overview', label: 'Overview', icon: Building2 },
        ...(b.welcome || b.followUp || b.adminWork || b.clientDocs || b.milestones || canForwardAdminStages(db, me, b) || canRunClientPortal(me, b) ? [{ id: 'workflow' as const, label: 'Workflow', icon: Workflow }] : []),
        { id: 'processing', label: 'Processing', icon: FolderKanban, count: visibleTasks(db, me, b).filter((t) => !t.done).length },
        { id: 'documents', label: 'Documents', icon: FileText, count: visibleDocuments(db, me, b).length }, { id: 'timeline', label: 'Timeline', icon: History, count: b.comments.length + b.approvals.length + (b.clientEmails?.length ?? 0) },
        { id: 'messages', label: 'Client messages', icon: MessageCircle, count: (db.clientMessages ?? []).filter((x) => x.bookingId === b.id).length },
        ...(b.legacy ? [{ id: 'legacy' as const, label: 'Old CRM record', icon: Archive }] : []),
      ]} />
      {tab === 'overview' && <Overview id={b.id} />}
      {tab === 'workflow' && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* an Admin set up in Operations Dashboard → Team sees only their own stages */}
          {!isStageOnlyAdmin(db, me) && <><WelcomeCard b={b} /><FollowUpCard b={b} /></>}
          <AdminChecklist b={b} />
          {!isStageOnlyAdmin(db, me) && <ClientPortalCard b={b} />}
        </div>
      )}
      {tab === 'processing' && <Processing id={b.id} />}
      {tab === 'documents' && <Documents id={b.id} />}
      {tab === 'timeline' && <Timeline id={b.id} />}
      {tab === 'messages' && (
        <Card className="overflow-hidden">
          <CardHeader title="Client messages" subtitle="Every WhatsApp and email message to this client — what was sent, by whom, to where, when, and whether it went" icon={MessageCircle}
            action={mayMessage(db, me, { kind: 'booking', b }) && <Button size="sm" icon={MessageCircle} onClick={() => setMessage('')}>Message client</Button>} />
          <MessageLog target={{ kind: 'booking', b }} />
        </Card>
      )}
      {message !== null && <MessageClientModal target={{ kind: 'booking', b }} stage={message || undefined} onClose={() => setMessage(null)} />}
      {tab === 'legacy' && <LegacyRecord id={b.id} />}
      {mail && <ClientEmailComposer b={b} onClose={() => setMail(false)} />}
    </div>
  )
}

function nextStepText(s: string) {
  return ({
    PENDING_TL: 'Waiting for the team leader’s approval.', PENDING_ACCOUNTS: 'Accounts verifies payments, then approves, holds or rejects.',
    ACCOUNTS_HOLD: 'Accounts put this file on hold.', PENDING_LEGAL: 'Legal reviews and assigns it to the Operation team.',
    IN_OPERATIONS: 'Operations is processing the stages; they hand it to Admin when ready.', WITH_ADMIN: 'Admin is completing the client work.',
    ON_HOLD: 'Work is paused until the reason is resolved.', COMPLETED: 'All work completed. 🎉', REJECTED: 'Rejected — the owner can fix and resubmit.',
  } as Record<string, string>)[s]
}

function useBooking(id: string) {
  const db = useDb()
  return db.bookings.find((x) => x.id === id)!
}

function Overview({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const b = useBooking(id)
  const [payOpen, setPayOpen] = useState(false)
  const blankPay = { amount: 0, date: today(), mode: 'UPI', proofName: '', tds: false, tdsPct: 10 }
  const [pay, setPay] = useState<{ amount: number; date: string; mode: string; proofName: string; proof?: FileRef; tds: boolean; tdsPct: number }>(blankPay)
  const [tdsFor, setTdsFor] = useState<{ payId: string; on: boolean; pct: number } | null>(null)
  const [ded, setDed] = useState<number | null>(null)
  // part payments 2, 3, 4 … are added only by Accounts
  const canPay = can('bookings.accounts')
  const g = gstSplit(pay.amount || 0, b.gstRate, b.state, db.settings.supplierState)
  const details: [string, string][] = [
    ['Contact person', b.contactPerson], ['Mobile', b.mobile], ['Email', b.email || '—'], ['PAN', b.pan || '—'], ['GSTIN', b.gstin || '—'],
    ['Location', `${b.city || '—'}, ${b.state}`], ['Industry', b.industry || '—'],
    ['Success fee (after discount)', b.successFee ? (b.successFee.value ? (b.successFee.type === 'PCT' ? `${b.successFee.value}%` : inr(b.successFee.value)) : 'None (0)') : b.successFeePct ? `${b.successFeePct}%` : '—'],
    ['Team leader', userName(db, b.teamLeadId)], ['Operations', userName(db, b.opsMemberId)], ['Admin', userName(db, b.adminId)], ['Deadline', fmtDate(b.deadline)],
  ]
  if (b.address) details.splice(6, 0, ['Address', b.address])
  if (b.paymentContact) details.push(['Payment contact', [b.paymentContact, b.paymentEmail].filter(Boolean).join(' · ')])
  details.push(['Booking date', fmtDate(b.bookingDate ?? b.createdAt)], ['Entered on', fmtDateTime(b.createdAt)])
  if (b.closedBy) details.push(['Lead closed by', userName(db, b.closedBy)])
  if (b.cin) details.push(['CIN / LLPIN', b.cin])
  if (b.website) details.push(['Website', b.website])
  if (b.startupContact) details.push(['Startup contact', [b.startupContact.phone, b.startupContact.email].filter(Boolean).join(' · ')])
  if (b.billing) details.push(['Invoice to', [b.billing.name, b.billing.pan, b.billing.gstin, b.billing.contact, b.billing.email].filter(Boolean).join(' · ')])
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="overflow-hidden">
        <CardHeader title="Client details" icon={Building2} />
        <dl className="divide-y divide-line/70 text-sm">
          {details.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-5 py-2.5"><dt className="shrink-0 text-mute">{k}</dt><dd className="min-w-0 break-words text-right font-medium" title={v}>{v}</dd></div>)}
        </dl>
        {b.remarks && <div className="border-t border-line px-5 py-3"><p className="text-[11px] font-semibold text-mute">Remarks</p><p className="whitespace-pre-line text-sm">{b.remarks}</p></div>}
      </Card>
      {(b.services?.length ?? 0) > 0 && <ServicesCard id={b.id} />}
      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title="Payments & instalments" subtitle={`GST ${b.gstRate}% · ${b.state === db.settings.supplierState ? 'CGST + SGST' : 'IGST'}`} icon={IndianRupee}
          action={canPay && b.status !== 'COMPLETED' && <Button size="sm" icon={Plus} onClick={() => setPayOpen(true)}>Balance payment</Button>} />
        <Table>
          <thead><tr><Th>Part</Th><Th>Date</Th><Th>Mode</Th><Th className="text-right">Amount</Th><Th className="text-right">GST</Th><Th className="text-right">Total</Th><Th className="text-right">TDS</Th><Th>Proof</Th><Th>Status</Th></tr></thead>
          <tbody>
            {b.payments.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold">{p.part === 1 ? 'Advance' : `Part ${p.part}`}</Td><Td>{p.dateUnknown ? <span className="text-xs text-mute" title={`Shown as the booking day, ${fmtDate(p.date)}`}>date not recorded</span> : fmtDate(p.date)}</Td><Td>{p.mode}</Td>
                <Td className="text-right tabular-nums">{inr(p.amount)}</Td><Td className="text-right tabular-nums text-mute">{inr(p.gst)}</Td><Td className="text-right font-bold tabular-nums">{inr(p.total)}</Td>
                <Td className="text-right text-xs tabular-nums">
                  {p.tds ? <span title={`Client deducted ${p.tds.pct}% TDS — received ${inr(p.total - p.tds.amount)}`}><b>{inr(p.tds.amount)}</b><span className="block text-mute">{p.tds.pct}%</span></span> : <span className="text-mute">—</span>}
                  {can('bookings.accounts') && <button className="block w-full text-right text-[11px] font-semibold text-brand-ink hover:underline" onClick={() => setTdsFor({ payId: p.id, on: !!p.tds, pct: p.tds?.pct ?? 10 })}>{p.tds ? 'Change' : 'Add TDS'}</button>}
                </Td>
                <Td>{p.proof ? <FileLink file={p.proof} label="Proof" /> : <span className="inline-flex max-w-32 items-center gap-1 truncate text-xs text-info"><FileText className="size-3.5" />{p.proofName || '—'}</span>}</Td>
                <Td>{p.verified ? <Badge tone="green">Verified</Badge> : can('bookings.accounts') ? (
                  <span className="flex gap-1"><Button size="sm" variant="success" icon={Check} onClick={() => run(() => verifyPayment(me, b.id, p.id, true), 'Verified')}>Verify</Button><Button size="sm" variant="ghost" icon={X} aria-label="Remove" onClick={() => confirm('Remove this payment?') && run(() => verifyPayment(me, b.id, p.id, false), 'Removed')} /></span>
                ) : <Badge tone="amber">Unverified</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line px-5 py-3 text-sm">
          <span className="text-mute">Service deduction: <b className="text-ink">{inr(b.deduction)}</b></span>
          {can('bookings.accounts') && (ded === null
            ? <button className="text-xs font-semibold text-brand-ink hover:underline" onClick={() => setDed(b.deduction)}>Edit deduction</button>
            : <span className="flex items-center gap-2"><input type="number" min={0} className="h-8 w-28 rounded-lg border border-line bg-card px-2" value={ded} onChange={(e) => setDed(Number(e.target.value))} /><Button size="sm" onClick={async () => { if (await run(() => setDeduction(me, b.id, ded), 'Deduction saved')) setDed(null) }}>Save</Button></span>)}
          <span className="ml-auto text-mute">Net advance after deduction: <b className="text-ink">{inr(Math.max(0, (b.payments[0]?.amount ?? 0) - b.deduction))}</b></span>
        </div>
      </Card>
      {can('bookings.accounts') && <CommissionCard id={b.id} />}
      {can('refunds.manage') && <RefundsCard id={b.id} />}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Add part payment ${b.payments.length + 1}`} subtitle="A new instalment on this same CRM entry — it counts in the scorecard and collections of the month it was paid in."
        footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => addPayment(me, b.id, { ...pay, tdsPct: pay.tds ? pay.tdsPct : undefined }), 'Payment added')) { setPayOpen(false); setPay(blankPay) } }}>Add payment</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount (before GST)" type="number" min={0} value={pay.amount || ''} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} hint={`+ GST ${inr(g.tax)} = ${inr((pay.amount || 0) + g.tax)}`} />
          <Input label="Date received" type="date" max={today()} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} hint="Counts in this month's scorecard" />
          <Select label="Mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{PAYMENT_MODES.map((x) => <option key={x}>{x}</option>)}</Select>
          {can('bookings.accounts') && (
            <div className="rounded-xl border border-line p-3">
              <Checkbox label="Client deducted TDS" checked={pay.tds} onChange={(v) => setPay({ ...pay, tds: v })} />
              {pay.tds && <Input className="mt-2" label="TDS %" type="number" min={1} max={15} step={0.5} value={pay.tdsPct} onChange={(e) => setPay({ ...pay, tdsPct: Number(e.target.value) })}
                hint={`1–15% · TDS ${inr(((pay.amount || 0) * (pay.tdsPct || 0)) / 100)} · received ${inr((pay.amount || 0) + g.tax - ((pay.amount || 0) * (pay.tdsPct || 0)) / 100)}`} />}
            </div>
          )}
          <div className="sm:col-span-2"><FileField label="Payment proof" required accept={DOC_TYPES} acceptLabel="Screenshot or PDF" value={pay.proof} onChange={(proof) => setPay({ ...pay, proof, proofName: proof?.name ?? '' })} /></div>
        </div>
      </Modal>
      <Modal open={!!tdsFor} onClose={() => setTdsFor(null)} title="TDS on this payment" size="sm"
        footer={<><Button variant="outline" onClick={() => setTdsFor(null)}>Cancel</Button><Button onClick={async () => { if (tdsFor && await run(() => setPaymentTds(me, b.id, tdsFor.payId, tdsFor.on ? tdsFor.pct : null), 'TDS saved')) setTdsFor(null) }}>Save</Button></>}>
        {tdsFor && <div className="grid gap-3">
          <Checkbox label="The client paid this after deducting TDS" checked={tdsFor.on} onChange={(v) => setTdsFor({ ...tdsFor, on: v })} />
          {tdsFor.on && <Input label="TDS % (1–15)" type="number" min={1} max={15} step={0.5} value={tdsFor.pct} onChange={(e) => setTdsFor({ ...tdsFor, pct: Number(e.target.value) })} hint="10% unless the client deducted a different rate" />}
        </div>}
      </Modal>
    </div>
  )
}

/** Accounts: optional commission to the CA / DSA who brought the client (5–30 % of what was collected, before GST). */
function CommissionCard({ id }: { id: string }) {
  const me = useMe()
  const run = useRun()
  const b = useBooking(id)
  const [f, setF] = useState<{ to: 'CA' | 'DSA'; name: string; pct: number } | null>(null)
  const c = b.commission
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Commission (CA / DSA)" subtitle="Optional · 5–30% · Accounts only" icon={Percent}
        action={<Button size="sm" variant="soft" onClick={() => setF(c ? { to: c.to, name: c.name, pct: c.pct } : { to: 'CA', name: '', pct: 10 })}>{c ? 'Edit' : 'Add'}</Button>} />
      {c ? (
        <dl className="divide-y divide-line/70 text-sm">
          <div className="flex justify-between px-5 py-2.5"><dt className="text-mute">To</dt><dd className="font-semibold">{c.to} · {c.name}</dd></div>
          <div className="flex justify-between px-5 py-2.5"><dt className="text-mute">Rate</dt><dd className="font-semibold">{c.pct}%</dd></div>
          <div className="flex justify-between px-5 py-2.5"><dt className="text-mute">On collections so far</dt><dd className="font-bold">{inr(commissionNow(b))}</dd></div>
        </dl>
      ) : <p className="px-5 py-4 text-sm text-mute">No commission on this client.</p>}
      <Modal open={!!f} onClose={() => setF(null)} title="Commission to CA / DSA" size="sm"
        footer={<>{c && <Button variant="ghost" className="mr-auto text-bad" onClick={async () => { if (await run(() => setCommission(me, b.id, null), 'Commission removed')) setF(null) }}>Remove</Button>}<Button variant="outline" onClick={() => setF(null)}>Cancel</Button><Button onClick={async () => { if (f && await run(() => setCommission(me, b.id, f), 'Commission saved')) setF(null) }}>Save</Button></>}>
        {f && <div className="grid gap-3">
          <Select label="Given to" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value as 'CA' | 'DSA' })}><option value="CA">CA (Chartered Accountant)</option><option value="DSA">DSA (Direct Selling Agent)</option></Select>
          <Input label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Commission %" type="number" min={5} max={30} step={0.5} value={f.pct} onChange={(e) => setF({ ...f, pct: Number(e.target.value) })} hint="Between 5% and 30% — worked out on what the client has paid (before GST)" />
        </div>}
      </Modal>
    </Card>
  )
}

/** Accounts only: money paid back to the client — pending until it is refunded. */
function RefundsCard({ id }: { id: string }) {
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const b = useBooking(id)
  const [add, setAdd] = useState<{ amount: number; date: string; reason: string } | null>(null)
  const [done, setDone] = useState<{ refundId: string; refundedOn: string; mode: string; ref: string } | null>(null)
  const list = b.refunds ?? []
  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader title="Refunds" subtitle="Accounts only · whether the client's money was paid back" icon={Undo2}
        action={<Button size="sm" variant="soft" icon={Plus} onClick={() => setAdd({ amount: 0, date: today(), reason: '' })}>Refund entry</Button>} />
      {!list.length ? <p className="px-5 py-4 text-sm text-mute">No refunds on this client.</p> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{fmtDate(r.date)}</Td>
                <Td className="text-sm">{r.reason}</Td>
                <Td className="text-right font-bold tabular-nums">{inr(r.amount)}</Td>
                <Td>{r.status === 'REFUNDED' ? <span><Badge tone="green">Refunded</Badge><span className="block text-[11px] text-mute">{fmtDate(r.refundedOn)} · {r.mode}{r.ref ? ` · ${r.ref}` : ''}</span></span> : <Badge tone="amber">Not refunded yet</Badge>}</Td>
                <Td className="text-right">
                  {r.status === 'PENDING'
                    ? <span className="flex justify-end gap-1"><Button size="sm" variant="success" icon={Check} onClick={() => setDone({ refundId: r.id, refundedOn: today(), mode: 'NEFT', ref: '' })}>Refunded</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete refund" onClick={async () => { if (await confirm('Delete this refund entry?', `${inr(r.amount)} · ${r.reason}`, true)) run(() => deleteRefund(me, b.id, r.id), 'Deleted') }} /></span>
                    : <Button size="sm" variant="ghost" onClick={() => run(() => setRefundStatus(me, b.id, r.id, null), 'Marked not refunded')}>Undo</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={!!add} onClose={() => setAdd(null)} title="Refund entry" size="sm"
        footer={<><Button variant="outline" onClick={() => setAdd(null)}>Cancel</Button><Button onClick={async () => { if (add && await run(() => addRefund(me, b.id, add), 'Refund entry saved')) setAdd(null) }}>Save</Button></>}>
        {add && <div className="grid gap-3">
          <Input label="Amount to refund (₹)" required type="number" min={0} value={add.amount || ''} onChange={(e) => setAdd({ ...add, amount: Number(e.target.value) })} hint={`Client paid ${inr(bookingMoney(b).collected)} in all`} />
          <Input label="Date" type="date" value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} />
          <Textarea label="Reason" required rows={2} value={add.reason} onChange={(e) => setAdd({ ...add, reason: e.target.value })} />
        </div>}
      </Modal>
      <Modal open={!!done} onClose={() => setDone(null)} title="Mark as refunded" size="sm"
        footer={<><Button variant="outline" onClick={() => setDone(null)}>Cancel</Button><Button onClick={async () => { if (done && await run(() => setRefundStatus(me, b.id, done.refundId, done), 'Marked refunded')) setDone(null) }}>Save</Button></>}>
        {done && <div className="grid gap-3">
          <Input label="Refunded on" type="date" max={today()} value={done.refundedOn} onChange={(e) => setDone({ ...done, refundedOn: e.target.value })} />
          <Select label="Mode" value={done.mode} onChange={(e) => setDone({ ...done, mode: e.target.value })}>{PAYMENT_MODES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input label="UTR / cheque no." value={done.ref} onChange={(e) => setDone({ ...done, ref: e.target.value })} />
        </div>}
      </Modal>
      {node}
    </Card>
  )
}

/** Services on the entry with their prices; a combo booking can add more until its deadline; Operations add complimentary ones. */
function ServicesCard({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const b = useBooking(id)
  const [add, setAdd] = useState<{ serviceId: string; price: string } | null>(null)
  const [gift, setGift] = useState<{ serviceId: string; note: string } | null>(null)
  const open = !!b.combo && today() <= b.combo.deadline
  const canAdd = open && (b.createdBy === me.id || b.teamLeadId === me.id || can('bookings.accounts') || me.role === 'superadmin')
  const daysLeft = b.combo ? Math.ceil((new Date(b.combo.deadline + 'T23:59:59').getTime() - Date.now()) / 86400000) : 0
  return (
    <Card className="overflow-hidden xl:col-span-3">
      <CardHeader title={b.combo ? `Combo booking · ${b.combo.months === 12 ? '1 year' : `${b.combo.months} months`}` : 'Services'} icon={Layers}
        subtitle={b.combo ? (open ? `Services can be added until ${fmtDate(b.combo.deadline)} · ${daysLeft} day(s) left` : `Combo period ended on ${fmtDate(b.combo.deadline)}`) : 'Price bifurcation'}
        action={<span className="flex gap-2">
          {can('bookings.process') && b.status !== 'REJECTED' && <Button size="sm" variant="soft" icon={Gift} onClick={() => setGift({ serviceId: '', note: '' })}>Complimentary service</Button>}
          {canAdd && <Button size="sm" icon={Plus} onClick={() => setAdd({ serviceId: '', price: '' })}>Add service</Button>}
        </span>} />
      <ul className="divide-y divide-line/70">
        {b.services!.map((s) => (
          <li key={s.serviceId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span>{s.name}
              {s.complimentary ? <span className="ml-2 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-semibold text-ok" title={s.addedBy ? `Added by ${userName(db, s.addedBy)}${s.addedAt ? ` on ${fmtDate(s.addedAt)}` : ''}` : undefined}>Complimentary</span>
                : needsPriceSplit(s) && <span className="ml-2 rounded-full bg-card2 px-2 py-0.5 text-[10px] text-mute">price required</span>}
            </span>
            <b className="tabular-nums">{s.complimentary ? 'Free' : s.price ? inr(s.price) : '—'}</b>
          </li>
        ))}
        <li className="flex justify-between gap-3 bg-card2/50 px-5 py-2.5 text-sm"><span className="font-semibold">{b.bookingType ? 'Total quoted (advance)' : 'Total quoted'}</span><b className="tabular-nums">{inr(b.totalQuoted)}</b></li>
      </ul>
      <Modal open={!!gift} onClose={() => setGift(null)} title="Add a complimentary service" size="sm" subtitle="Given free to the client — the money on this file doesn't change."
        footer={<><Button variant="outline" onClick={() => setGift(null)}>Cancel</Button><Button icon={Gift} onClick={async () => { if (gift && await run(() => addComplimentaryService(me, b.id, gift.serviceId, gift.note), 'Complimentary service added')) setGift(null) }}>Add</Button></>}>
        {gift && <div className="grid gap-4">
          <Select label="Service" required value={gift.serviceId} onChange={(e) => setGift({ ...gift, serviceId: e.target.value })}>
            <option value="">— Select —</option>{db.services.filter((s) => s.active && !b.services!.some((x) => x.serviceId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Textarea label="Why it is given" required rows={2} value={gift.note} onChange={(e) => setGift({ ...gift, note: e.target.value })} placeholder="e.g. promised at booking, goodwill" />
        </div>}
      </Modal>
      {b.combo && open && daysLeft <= 7 && <p className="border-t border-line bg-warn-soft px-5 py-2 text-xs text-warn">The combo deadline is near — add any remaining services before {fmtDate(b.combo.deadline)}.</p>}
      <Modal open={!!add} onClose={() => setAdd(null)} title="Add a service to this combo" size="sm"
        footer={<><Button variant="outline" onClick={() => setAdd(null)}>Cancel</Button><Button icon={Plus} onClick={async () => { if (add && await run(() => addComboService(me, b.id, add.serviceId, Number(add.price) || 0), 'Service added')) setAdd(null) }}>Add</Button></>}>
        {add && <div className="grid gap-4">
          <Select label="Service" required value={add.serviceId} onChange={(e) => { const s = db.services.find((x) => x.id === e.target.value); setAdd({ serviceId: e.target.value, price: add.price || String(s?.price ?? '') }) }}>
            <option value="">— Select —</option>{db.services.filter((s) => s.active && !b.services!.some((x) => x.serviceId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Price (₹, before GST)" type="number" inputMode="decimal" min={0} value={add.price} onChange={(e) => setAdd({ ...add, price: e.target.value })} hint="Added to the total quoted. Required for certification, website, logo and trade services." />
        </div>}
      </Modal>
    </Card>
  )
}

function Processing({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const b = useBooking(id)
  const movable = canMoveStage(db, me, b)
  const [target, setTarget] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const canMail = canEmailClient(db, me, b)
  const [mailAfter, setMailAfter] = useState(false)
  const [mail, setMail] = useState(false)
  const [task, setTask] = useState('')
  const [due, setDue] = useState('')
  const timeIn = useMemo(() => {
    const h = b.stageHistory
    return h.map((x, i) => ({ ...x, days: Math.max(0, Math.round(((i + 1 < h.length ? new Date(h[i + 1]!.at).getTime() : Date.now()) - new Date(x.at).getTime()) / 86400000)) }))
  }, [b.stageHistory])

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title="Processing stages" subtitle={b.opsMemberId ? `Now: ${stageLabel(b.stage, b.stageOutcome)}${b.stageReason ? ` — ${b.stageReason}` : ''} · allowed up to stage ${b.maxStage} · Admin and the Operation team can update stages` : 'Starts once Legal assigns Operations'} icon={FolderKanban} />
        <div className="p-5">
          <StageTrack b={b} />
          <ol className="mt-5 space-y-2">
            {STAGES.map((s, i) => {
              const n = i + 1
              const done = n < b.stage || (n === b.stage && b.status === 'COMPLETED')
              const cur = n === b.stage && b.status !== 'COMPLETED' && !!b.opsMemberId
              const locked = n > b.maxStage && me.role !== 'superadmin'
              const options = STAGE_OUTCOMES[n]
              const here = n === b.stage && !!b.opsMemberId
              return (
                <li key={s} className={cx('rounded-xl border px-4 py-3', cur ? 'border-accent bg-accent-soft/50' : 'border-line')}>
                  <div className="flex items-center gap-3">
                    <span className={cx('grid size-8 place-items-center rounded-full text-xs font-bold', done ? 'bg-ok text-white' : cur ? 'bg-accent text-white' : 'bg-card2 text-mute')}>{done ? <Check className="size-4" /> : n}</span>
                    <span className="flex-1 text-sm font-semibold">{s}</span>
                    {locked && <Lock className="size-4 text-mute" aria-label="Beyond allowed stage" />}
                    {movable && !cur && !locked && <Button size="sm" variant={n > b.stage ? 'soft' : 'ghost'} onClick={() => { setTarget(n); setNote('') }}>{n > b.stage ? 'Move here' : 'Move back'}</Button>}
                    {cur && <Badge tone="orange" dot>Current</Badge>}
                  </div>
                  {options && here && (
                    <div className="mt-2 space-y-1.5 pl-11">
                      {movable ? <StageControls b={b} variant="chips" showMove={false} />
                        : <p className="text-xs font-semibold"><StageText b={b} /></p>}
                      {b.stageReason && movable && <p className="text-xs text-bad">Reason: {b.stageReason}</p>}
                      {!b.stageOutcome && <span className="text-xs text-warn">Pick the {n === 3 ? 'step' : 'result'}</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </Card>
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <CardHeader title="Tasks & follow-ups" icon={ListTodo} />
          <ul className="divide-y divide-line/70">
            {visibleTasks(db, me, b).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                <button aria-label="Toggle task" onClick={() => toggleTask(me, b.id, t.id)} className={cx('grid size-5 place-items-center rounded-md border-2', t.done ? 'border-ok bg-ok text-white' : 'border-line')}>{t.done && <Check className="size-3" />}</button>
                <span className={cx('flex-1 text-sm', t.done && 'text-mute line-through')}>{t.title}{t.due && <span className={cx('ml-2 text-[11px]', !t.done && t.due < today() ? 'text-bad' : 'text-mute')}>{fmtDate(t.due)}</span>}</span>
                <button aria-label="Delete task" onClick={() => deleteTask(me, b.id, t.id)} className="text-mute hover:text-bad"><Trash2 className="size-3.5" /></button>
              </li>
            ))}
            {!visibleTasks(db, me, b).length && <li className="px-5 py-4 text-sm text-mute">No tasks yet.</li>}
          </ul>
          <div className="flex gap-2 border-t border-line p-3">
            <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="New task…" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-sm" onKeyDown={(e) => { if (e.key === 'Enter' && task.trim()) { run(() => addTask(me, b.id, task, due || undefined)); setTask('') } }} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 w-32 rounded-lg border border-line bg-card px-2 text-xs" aria-label="Due date" />
            <Button size="sm" icon={Plus} aria-label="Add task" onClick={() => { run(() => addTask(me, b.id, task, due || undefined)); setTask('') }} />
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Stage history" subtitle="Time spent per stage" icon={History} />
          <ol className="space-y-3 p-5">
            {timeIn.slice().reverse().map((h, i) => (
              <li key={i} className="flex gap-3 text-sm"><CircleDot className="mt-0.5 size-4 shrink-0 text-accent" />
                <div><p className="font-semibold">{stageLabel(h.stage, h.outcome)} <span className="font-normal text-mute">· {h.days} day(s)</span></p><p className="text-xs text-mute">{userName(db, h.by)} · {fmtDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</p></div>
              </li>
            ))}
            {!timeIn.length && <li className="text-sm text-mute">Not started.</li>}
          </ol>
        </Card>
      </div>
      <Modal open={target !== null} onClose={() => setTarget(null)} title={`Move to stage ${target}`} subtitle={target ? stageLabel(target, target === 3 ? 'IN_PROCESS' : undefined) : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button icon={ChevronRight} onClick={async () => { if (target && await run(() => moveStage(me, b.id, target, note), 'Stage updated')) { setTarget(null); if (mailAfter) setMail(true) } }}>Move</Button></>}>
        <Textarea label={target && target < b.stage ? 'Reason (required)' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} hint={mailAfter ? 'The note is added to the progress email — you can edit it before sending' : undefined} />
        {canMail && <div className="mt-3"><Checkbox checked={mailAfter} onChange={setMailAfter} label="Email the client about this update" /></div>}
      </Modal>
      {mail && <ClientEmailComposer b={b} onClose={() => setMail(false)} />}
    </div>
  )
}

function Documents({ id }: { id: string }) {
  const me = useMe()
  const db = useDb()
  const run = useRun()
  const b = useBooking(id)
  const [pending, setPending] = useState<PendingDoc[]>([])
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Client documents" subtitle="PAN card, GSTIN, CRM, QT, Agreement, pitch deck, F.R, D.P.R… — stored with uploader, date and time" icon={FileText} />
      <div className="border-b border-line p-5"><DocUploader label="Add documents" value={pending} onChange={setPending} onUpload={async (docs) => !!(await run(() => addDocuments(me, b.id, docs), `${docs.length} document(s) added`))} /></div>
      {!visibleDocuments(db, me, b).length ? <EmptyState icon={FileText} title="No documents yet" text="Upload KYC, company documents, certificates, pitch deck or financials." /> : (
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleDocuments(db, me, b).map((d) => (
            <div key={d.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info"><FileText className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.name}</p>
                <p className="text-[11px] text-mute">{d.category} · {d.size ? `${Math.round(d.size / 1024)} KB · ` : ''}{userName(db, d.by)} · {ago(d.at)}</p>
                {d.legacyPath && <p className="truncate font-mono text-[10px] text-mute" title={d.legacyPath}>old CRM: {d.legacyPath}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <DocReview bookingId={b.id} doc={d} compact />
                  {d.file && <FileLink file={d.file} label="Open" />}
                  {d.dataUrl && <a href={d.dataUrl} download={d.name} className="text-[11px] font-semibold text-brand-ink hover:underline"><Download className="inline size-3" /> Download</a>}
                  <button aria-label="Delete" className="ml-auto text-mute hover:text-bad" onClick={() => confirm(`Delete ${d.name}?`) && run(() => deleteDocument(me, b.id, d.id), 'Deleted')}><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Every column of the original old-CRM rows, exactly as they were in the dump (read-only). */
function LegacyRecord({ id }: { id: string }) {
  const b = useBooking(id)
  const [q, setQ] = useState('')
  const [empty, setEmpty] = useState(false)
  const lg = b.legacy!
  const groups: { title: string; rows: LegacyRow[] }[] = [
    { title: `Client file · crm #${b.legacyId ?? ''}`, rows: [lg.crm] },
    ...(lg.workflow ? [{ title: 'Workflow (stage timestamps)', rows: [lg.workflow] }] : []),
    ...(lg.deductions?.length ? [{ title: 'Deductions', rows: lg.deductions }] : []),
  ]
  const show = (k: string, v: string | null) => (empty || (v != null && v.trim() !== '')) && (!q || `${k} ${v ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Archive className="size-5 text-mute" />
        <p className="min-w-0 flex-1 text-sm text-mute">Imported from the old CRM. Values are shown exactly as stored there; times are as the old database wrote them.</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a field…" aria-label="Find a field" className="h-9 w-48 rounded-lg border border-line bg-card px-3 text-sm" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} className="accent-[var(--brand)]" />Show empty fields</label>
      </Card>
      {groups.map((g) => g.rows.map((row, i) => {
        const entries = Object.entries(row).filter(([k, v]) => show(k, v))
        return (
          <Card key={g.title + i} className="overflow-hidden">
            <CardHeader title={g.rows.length > 1 ? `${g.title} ${i + 1}` : g.title} subtitle={`${entries.length} of ${Object.keys(row).length} fields`} icon={Archive} />
            <dl className="grid text-sm sm:grid-cols-2">
              {entries.map(([k, v]) => (
                <div key={k} className="flex gap-3 border-b border-line/70 px-5 py-2 sm:odd:border-r">
                  <dt className="w-40 shrink-0 font-mono text-xs text-mute">{k}</dt>
                  <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">{v == null ? <i className="text-mute">NULL</i> : v === '' ? <i className="text-mute">(empty)</i> : v}</dd>
                </div>
              ))}
              {!entries.length && <p className="px-5 py-4 text-mute">No fields match.</p>}
            </dl>
          </Card>
        )
      }))}
    </div>
  )
}

function Timeline({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const b = useBooking(id)
  const [text, setText] = useState('')
  const items = [
    ...b.approvals.map((a) => ({ id: a.id, at: a.at, by: a.by, kind: 'approval' as const, title: `${a.level}: ${a.action.replace('_', ' ').toLowerCase()}`, text: a.remark, action: a.action })),
    ...b.comments.map((c) => ({ id: c.id, at: c.at, by: c.by, kind: 'comment' as const, title: c.kind, text: c.text, action: '' })),
    ...(b.clientEmails ?? []).map((e) => ({
      id: e.id, at: e.at, by: e.by, kind: 'email' as const, action: e.status,
      title: e.status === 'SENT' ? 'emailed the client' : e.status === 'MAIL_APP' ? 'opened the email in their own email app' : 'email to the client failed',
      text: `To: ${e.to}${e.cc.length ? ` · CC: ${e.cc.join(', ')}` : ''}\n“${e.subject}”${e.error ? `\n${e.error}` : ''}`,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at))
  const icon = (a: string) => a === 'REJECTED' ? <X className="size-4" /> : a === 'COMPLETED' ? <ShieldCheck className="size-4" /> : a.startsWith('ASSIGN') ? <Send className="size-4" /> : <CheckCircle2 className="size-4" />
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Timeline & comments" subtitle="Type @username to notify someone" icon={MessageSquare} />
      <div className="flex gap-3 border-b border-line p-5">
        <Avatar name={me.name} photo={me.photo} />
        <div className="flex-1">
          <Textarea rows={2} placeholder="Write a comment… e.g. @operations documents received" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex justify-end"><Button size="sm" icon={Send} onClick={async () => { if (await run(() => addComment(me, b.id, text), 'Comment added')) setText('') }}>Comment</Button></div>
        </div>
      </div>
      <ol className="space-y-5 p-5">
        {items.map((it) => {
          const u = db.users.find((x) => x.id === it.by)
          return (
            <li key={it.id} className="flex gap-3">
              {it.kind === 'approval'
                ? <span className={cx('grid size-9 shrink-0 place-items-center rounded-full text-white', it.action === 'REJECTED' ? 'bg-bad' : it.action === 'HOLD' ? 'bg-warn' : 'bg-ok')}>{icon(it.action)}</span>
                : it.kind === 'email'
                  ? <span className={cx('grid size-9 shrink-0 place-items-center rounded-full text-white', it.action === 'FAILED' ? 'bg-bad' : 'bg-accent')}><Mail className="size-4" /></span>
                  : <Avatar name={u?.name ?? '?'} photo={u?.photo} />}
              <div className="min-w-0 flex-1 rounded-2xl bg-card2 px-4 py-3">
                <p className="text-sm"><b>{u?.name ?? '—'}</b> <span className="text-mute">· {u ? roleLabel(u.role) : ''} · {it.title}</span></p>
                {it.text && <p className="mt-1 whitespace-pre-line text-sm">{it.text.split(/(@[\w.]+)/g).map((p, i) => p.startsWith('@') ? <b key={i} className="text-brand-ink">{p}</b> : p)}</p>}
                <p className="mt-1 text-[11px] text-mute">{fmtDateTime(it.at)}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
