import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Archive, ArrowLeft, Building2, Layers, Check, CheckCircle2, ChevronRight, CircleDot, Download, FileText, FolderKanban, History, IndianRupee, ListTodo,
  MessageSquare, Pencil, Plus, Receipt, Send, ShieldCheck, Trash2, Upload, X, Lock,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import {
  addComboService, addComment, addDocuments, addPayment, needsPriceSplit, addTask, canEditBooking, canMoveStage, deleteDocument, setStageOutcome, deleteTask, invoiceFromBooking, moveStage,
  setDeduction, setDocStatus, toggleTask, userName, verifyPayment, visibleBookings,
} from '../../lib/actions'
import { DOC_CATEGORIES, STAGES, STAGE_OUTCOMES, stageLabel } from '../../lib/workflow'
import { ago, bookingMoney, fmtDate, fmtDateTime, gstSplit, inr, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import type { FileRef, LegacyRow } from '../../lib/types'
import { DOC_TYPES } from '../../lib/files'
import { FileField } from '../../components/FileField'
import { DocUploader, type PendingDoc } from '../../components/DocUploader'
import { StageControls, StageText } from '../../components/StageControls'
import { FileLink } from '../../components/FileField'
import {
  Avatar, Badge, Button, Card, CardHeader, cx, EmptyState, FileButton, Input, Modal, Select, Table, Tabs, Td, Textarea, Th, readAsDataUrl, useRun,
} from '../../components/ui'
import { BookingStatusBadge, ChainStepper, DeadlineBadge, DecisionButtons, PriorityBadge, StageTrack } from '../../components/booking'

type Tab = 'overview' | 'processing' | 'documents' | 'timeline' | 'legacy'

export default function BookingDetail() {
  const { id } = useParams()
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
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
            {canEditBooking(db, me, b) && <Link to={`/bookings/${b.id}/edit`}><Button variant="outline" icon={Pencil}>Edit</Button></Link>}
            {can('billing.create', 'billing.manage') && !invoices.length && !['PENDING_TL', 'REJECTED'].includes(b.status) && (
              <Button variant="outline" icon={Receipt} onClick={async () => { const inv = await run(() => invoiceFromBooking(me, b.id, can('billing.manage') ? 'TAX' : 'PROFORMA'), 'Invoice raised'); if (typeof inv === 'string') nav(`/billing/${inv}`) }}>Raise invoice</Button>
            )}
            {invoices.map((i) => <Link key={i.id} to={`/billing/${i.id}`}><Button variant="soft" icon={Receipt}>{i.number}</Button></Link>)}
          </div>
        </div>
        <div className="border-t border-line bg-card2/50 px-6 py-5"><ChainStepper b={b} /></div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <p className="mr-auto text-sm text-mute">{nextStepText(b.status)}</p>
          <DecisionButtons b={b} />
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Quoted with GST', inr(m.quotedWithGst), ''], ['Collected', inr(m.collected), 'text-ok'], ['Outstanding', inr(m.outstanding), 'text-bad'], ['Stage', b.opsMemberId ? `${stageLabel(b.stage, b.stageOutcome)} (of ${STAGES.length})` : 'Not started', '']].map(([k, v, c]) => (
          <Card key={k} className="p-4"><p className="text-xs font-semibold text-mute">{k}</p><p className={cx('mt-1 truncate text-lg font-extrabold', c)}>{v}</p></Card>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} className="mb-5 w-fit" tabs={[
        { id: 'overview', label: 'Overview', icon: Building2 }, { id: 'processing', label: 'Processing', icon: FolderKanban, count: b.tasks.filter((t) => !t.done).length },
        { id: 'documents', label: 'Documents', icon: FileText, count: b.documents.length }, { id: 'timeline', label: 'Timeline', icon: History, count: b.comments.length + b.approvals.length },
        ...(b.legacy ? [{ id: 'legacy' as const, label: 'Old CRM record', icon: Archive }] : []),
      ]} />
      {tab === 'overview' && <Overview id={b.id} />}
      {tab === 'processing' && <Processing id={b.id} />}
      {tab === 'documents' && <Documents id={b.id} />}
      {tab === 'timeline' && <Timeline id={b.id} />}
      {tab === 'legacy' && <LegacyRecord id={b.id} />}
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
  const [pay, setPay] = useState<{ amount: number; date: string; mode: string; proofName: string; proof?: FileRef }>({ amount: 0, date: today(), mode: 'UPI', proofName: '' })
  const [ded, setDed] = useState<number | null>(null)
  const canPay = b.createdBy === me.id || b.teamLeadId === me.id || can('bookings.accounts')
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
          <thead><tr><Th>Part</Th><Th>Date</Th><Th>Mode</Th><Th className="text-right">Amount</Th><Th className="text-right">GST</Th><Th className="text-right">Total</Th><Th>Proof</Th><Th>Status</Th></tr></thead>
          <tbody>
            {b.payments.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold">{p.part === 1 ? 'Advance' : `Part ${p.part}`}</Td><Td>{p.dateUnknown ? <span className="text-xs text-mute" title={`Shown as the booking day, ${fmtDate(p.date)}`}>date not recorded</span> : fmtDate(p.date)}</Td><Td>{p.mode}</Td>
                <Td className="text-right tabular-nums">{inr(p.amount)}</Td><Td className="text-right tabular-nums text-mute">{inr(p.gst)}</Td><Td className="text-right font-bold tabular-nums">{inr(p.total)}</Td>
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
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Add balance payment" subtitle="Balance payments are new instalments on this same CRM entry."
        footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => addPayment(me, b.id, pay), 'Payment added')) { setPayOpen(false); setPay({ amount: 0, date: today(), mode: 'UPI', proofName: '' }) } }}>Add payment</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount (before GST)" type="number" min={0} value={pay.amount || ''} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} hint={`+ GST ${inr(g.tax)} = ${inr((pay.amount || 0) + g.tax)} · outstanding ${inr(bookingMoney(b).outstanding)}`} />
          <Input label="Date" type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
          <Select label="Mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['UPI', 'NEFT', 'RTGS', 'IMPS', 'Cheque', 'Card', 'Cash'].map((x) => <option key={x}>{x}</option>)}</Select>
          <div className="sm:col-span-2"><FileField label="Payment proof" required accept={DOC_TYPES} acceptLabel="Screenshot or PDF" value={pay.proof} onChange={(proof) => setPay({ ...pay, proof, proofName: proof?.name ?? '' })} /></div>
        </div>
      </Modal>
    </div>
  )
}

/** Services on the entry with their prices; a combo booking can add more until its deadline. */
function ServicesCard({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const b = useBooking(id)
  const [add, setAdd] = useState<{ serviceId: string; price: string } | null>(null)
  const open = !!b.combo && today() <= b.combo.deadline
  const canAdd = open && (b.createdBy === me.id || b.teamLeadId === me.id || can('bookings.accounts') || me.role === 'superadmin')
  const daysLeft = b.combo ? Math.ceil((new Date(b.combo.deadline + 'T23:59:59').getTime() - Date.now()) / 86400000) : 0
  return (
    <Card className="overflow-hidden xl:col-span-3">
      <CardHeader title={b.combo ? `Combo booking · ${b.combo.months === 12 ? '1 year' : `${b.combo.months} months`}` : 'Services'} icon={Layers}
        subtitle={b.combo ? (open ? `Services can be added until ${fmtDate(b.combo.deadline)} · ${daysLeft} day(s) left` : `Combo period ended on ${fmtDate(b.combo.deadline)}`) : 'Price bifurcation'}
        action={canAdd && <Button size="sm" icon={Plus} onClick={() => setAdd({ serviceId: '', price: '' })}>Add service</Button>} />
      <ul className="divide-y divide-line/70">
        {b.services!.map((s) => (
          <li key={s.serviceId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span>{s.name}{needsPriceSplit(s) && <span className="ml-2 rounded-full bg-card2 px-2 py-0.5 text-[10px] text-mute">price required</span>}</span>
            <b className="tabular-nums">{s.price ? inr(s.price) : '—'}</b>
          </li>
        ))}
        <li className="flex justify-between gap-3 bg-card2/50 px-5 py-2.5 text-sm"><span className="font-semibold">Total quoted</span><b className="tabular-nums">{inr(b.totalQuoted)}</b></li>
      </ul>
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
            {b.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                <button aria-label="Toggle task" onClick={() => toggleTask(me, b.id, t.id)} className={cx('grid size-5 place-items-center rounded-md border-2', t.done ? 'border-ok bg-ok text-white' : 'border-line')}>{t.done && <Check className="size-3" />}</button>
                <span className={cx('flex-1 text-sm', t.done && 'text-mute line-through')}>{t.title}{t.due && <span className={cx('ml-2 text-[11px]', !t.done && t.due < today() ? 'text-bad' : 'text-mute')}>{fmtDate(t.due)}</span>}</span>
                <button aria-label="Delete task" onClick={() => deleteTask(me, b.id, t.id)} className="text-mute hover:text-bad"><Trash2 className="size-3.5" /></button>
              </li>
            ))}
            {!b.tasks.length && <li className="px-5 py-4 text-sm text-mute">No tasks yet.</li>}
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
        footer={<><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button icon={ChevronRight} onClick={async () => { if (target && await run(() => moveStage(me, b.id, target, note), 'Stage updated')) setTarget(null) }}>Move</Button></>}>
        <Textarea label={target && target < b.stage ? 'Reason (required)' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  )
}

function Documents({ id }: { id: string }) {
  const me = useMe()
  const db = useDb()
  const { can } = useAuth()
  const run = useRun()
  const b = useBooking(id)
  const [pending, setPending] = useState<PendingDoc[]>([])
  const verifier = can('bookings.process', 'bookings.legal', 'bookings.admin')
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Client documents" subtitle="PAN card, GSTIN, CRM, QT, Agreement, pitch deck, F.R, D.P.R… — stored with uploader, date and time" icon={FileText} />
      <div className="border-b border-line p-5"><DocUploader label="Add documents" value={pending} onChange={setPending} onUpload={async (docs) => !!(await run(() => addDocuments(me, b.id, docs), `${docs.length} document(s) added`))} /></div>
      {!b.documents.length ? <EmptyState icon={FileText} title="No documents yet" text="Upload KYC, company documents, certificates, pitch deck or financials." /> : (
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {b.documents.map((d) => (
            <div key={d.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info"><FileText className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.name}</p>
                <p className="text-[11px] text-mute">{d.category} · {d.size ? `${Math.round(d.size / 1024)} KB · ` : ''}{userName(db, d.by)} · {ago(d.at)}</p>
                {d.legacyPath && <p className="truncate font-mono text-[10px] text-mute" title={d.legacyPath}>old CRM: {d.legacyPath}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={d.status === 'VERIFIED' ? 'green' : d.status === 'REJECTED' ? 'red' : 'amber'}>{(d.status ?? 'PENDING').toLowerCase()}</Badge>
                  {verifier && d.status !== 'VERIFIED' && <button className="text-[11px] font-semibold text-ok hover:underline" onClick={() => setDocStatus(me, b.id, d.id, 'VERIFIED')}>Verify</button>}
                  {verifier && d.status !== 'REJECTED' && <button className="text-[11px] font-semibold text-bad hover:underline" onClick={() => setDocStatus(me, b.id, d.id, 'REJECTED')}>Reject</button>}
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
