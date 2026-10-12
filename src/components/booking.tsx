import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCircle2, Clock, PauseCircle, PlayCircle, RotateCcw, Send, ShieldCheck, UserCog, XCircle, type LucideIcon } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { availableDecisions, decide, userName, usersWithRole, type Decision } from '../lib/actions'
import { BOOKING_STATUS, CHAIN, HOLD_REASONS, STAGES, stageLabel } from '../lib/workflow'
import { addDays, bookingMoney, fmtDate, inr, ymd } from '../lib/format'
import { Badge, Button, cx, Input, Modal, Progress, Select, Textarea, useRun } from './ui'

export function BookingStatusBadge({ b }: { b: Booking }) {
  const s = BOOKING_STATUS[b.status]
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}

export function PriorityBadge({ p }: { p: Booking['priority'] }) {
  return <Badge tone={p === 'HIGH' ? 'red' : p === 'MEDIUM' ? 'amber' : 'gray'}>{p.toLowerCase()}</Badge>
}

export function DeadlineBadge({ b }: { b: Booking }) {
  if (['COMPLETED', 'REJECTED'].includes(b.status) || !b.deadline) return null
  const t = ymd()
  const soon = ymd(addDays(new Date(), 3))
  if (b.deadline < t) return <Badge tone="red">Overdue</Badge>
  if (b.deadline <= soon) return <Badge tone="amber">Due soon</Badge>
  return <Badge tone="green">On track</Badge>
}

/** Index in CHAIN that the booking has reached. */
function chainIndex(b: Booking) {
  switch (b.status) {
    case 'PENDING_TL': case 'REJECTED': return 1
    case 'PENDING_ACCOUNTS': case 'ACCOUNTS_HOLD': return 2
    case 'PENDING_LEGAL': return 3
    case 'IN_OPERATIONS': return 4
    case 'WITH_ADMIN': return 5
    case 'OPS_REVIEW': return 6
    case 'ON_HOLD': return b.holdFrom === 'WITH_ADMIN' ? 5 : 4
    case 'COMPLETED': return 8
  }
}

export function ChainStepper({ b, compact }: { b: Booking; compact?: boolean }) {
  const db = useDb()
  const idx = chainIndex(b)
  const problem = b.status === 'REJECTED' ? 'red' : ['ON_HOLD', 'ACCOUNTS_HOLD'].includes(b.status) ? 'amber' : null
  const who = (key: string) => {
    if (key === 'SUBMITTED') return userName(db, b.createdBy)
    if (key === 'TL') return userName(db, b.teamLeadId)
    if (key === 'OPS') return b.opsMemberId ? userName(db, b.opsMemberId) : ''
    if (key === 'ADMIN') return b.adminId ? userName(db, b.adminId) : ''
    if (key === 'REVIEW' || key === 'DONE') return b.opsMemberId ? userName(db, b.opsMemberId) : ''
    return ''
  }
  return (
    <ol className="flex w-full items-start">
      {CHAIN.map((c, i) => {
        const done = i < idx
        const current = i === idx
        const tone = current && problem ? problem : null
        return (
          <li key={c.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 && <span className={cx('absolute right-1/2 top-[15px] h-0.5 w-full -translate-y-1/2', i <= idx ? 'bg-ok' : 'bg-line')} />}
            <span className={cx('relative z-10 grid size-[30px] place-items-center rounded-full border-2 text-xs font-bold transition',
              done ? 'border-ok bg-ok text-white' : tone === 'red' ? 'border-bad bg-bad text-white' : tone === 'amber' ? 'border-warn bg-warn text-white' :
                current ? 'border-accent bg-accent-soft text-accent anim-ring' : 'border-line bg-card text-mute')}>
              {done ? <Check className="size-4" /> : tone === 'red' ? <XCircle className="size-4" /> : tone === 'amber' ? <PauseCircle className="size-4" /> : i + 1}
            </span>
            {!compact && (
              <>
                <span className={cx('mt-1.5 text-[11px] font-bold', current ? 'text-ink' : 'text-mute')}>{c.label}</span>
                <span className="hidden max-w-full truncate px-1 text-[10px] text-mute sm:block">{who(c.key)}</span>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function StageTrack({ b }: { b: Booking }) {
  return (
    <div className="flex gap-1" aria-label={`Stage ${stageLabel(b.stage, b.stageOutcome)} of ${STAGES.length}`} title={stageLabel(b.stage, b.stageOutcome)}>
      {STAGES.map((s, i) => (
        <span key={s} title={`${i + 1}. ${s}${i + 1 > b.maxStage ? ' (locked)' : ''}`}
          className={cx('h-2 flex-1 rounded-full', i < b.stage ? 'bg-ok' : i < b.maxStage ? 'bg-brand-soft' : 'bg-line/60')} />
      ))}
    </div>
  )
}

export function MoneyBar({ b }: { b: Booking }) {
  const m = bookingMoney(b)
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]"><span className="text-mute">{inr(m.collected)} of {inr(m.quotedWithGst)}</span><span className="font-bold">{m.pct}%</span></div>
      <Progress value={m.pct} tone={m.pct >= 100 ? 'green' : 'orange'} />
    </div>
  )
}

const DEC_META: Record<Decision['kind'], { label: string; icon: LucideIcon; variant: 'success' | 'danger' | 'outline' | 'primary' | 'accent' }> = {
  APPROVE: { label: 'Approve', icon: CheckCircle2, variant: 'success' },
  REJECT: { label: 'Reject', icon: XCircle, variant: 'danger' },
  HOLD: { label: 'On hold', icon: PauseCircle, variant: 'outline' },
  RESUME: { label: 'Resume', icon: PlayCircle, variant: 'primary' },
  RESUBMIT: { label: 'Resubmit', icon: RotateCcw, variant: 'primary' },
  ASSIGN_OPS: { label: 'Assign to Operations', icon: UserCog, variant: 'accent' },
  ASSIGN_ADMIN: { label: 'Assign to Admin', icon: Send, variant: 'accent' },
  RETURN_OPS: { label: 'Return to Operations', icon: RotateCcw, variant: 'outline' },
  COMPLETE: { label: 'Work done · send to Operations', icon: Send, variant: 'success' },
  APPROVE_DONE: { label: 'Approve & complete', icon: ShieldCheck, variant: 'success' },
  RETURN_ADMIN: { label: 'Return to Admin', icon: RotateCcw, variant: 'outline' },
}

/** Legal handing a file that already has an Operations member to someone else. */
const reassign = (b: Booking, k: Decision['kind']) => k === 'ASSIGN_OPS' && !!b.opsMemberId

export function DecisionButtons({ b, size = 'md', onDone }: { b: Booking; size?: 'sm' | 'md'; onDone?: (kind: Decision['kind']) => void }) {
  const db = useDb()
  const me = useMe()
  const [kind, setKind] = useState<Decision['kind'] | null>(null)
  const kinds = availableDecisions(db, me, b)
  if (!kinds.length) return null
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => { const m = DEC_META[k]; return <Button key={k} size={size} variant={reassign(b, k) ? 'outline' : m.variant} icon={m.icon} onClick={() => setKind(k)}>{reassign(b, k) ? 'Reassign Operations' : m.label}</Button> })}
      </div>
      <DecisionModal b={b} kind={kind} onClose={() => setKind(null)} onDone={onDone} />
    </>
  )
}

/** `onDone` runs after the decision is saved (e.g. go to the Operations Dashboard after assigning). */
export function DecisionModal({ b, kind, onClose, onDone }: { b: Booking; kind: Decision['kind'] | null; onClose: () => void; onDone?: (kind: Decision['kind']) => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [remark, setRemark] = useState('')
  const [ops, setOps] = useState('')
  const [admin, setAdmin] = useState('')
  const [maxStage, setMaxStage] = useState(6)
  const [deadline, setDeadline] = useState('')
  const opsUsers = usersWithRole(db, 'operations')
  const admins = usersWithRole(db, 'admin')
  useEffect(() => {
    if (!kind) return
    setRemark(''); setOps(b.opsMemberId ?? ''); setAdmin(b.adminId ?? ''); setMaxStage(Math.max(b.maxStage, 6)); setDeadline(b.deadline || '')
  }, [kind, b])
  if (!kind) return null
  const m = reassign(b, kind) ? { ...DEC_META[kind], label: 'Reassign Operations' } : DEC_META[kind]
  const needsReason = ['REJECT', 'HOLD', 'RETURN_OPS', 'RETURN_ADMIN'].includes(kind)
  const load = (id: string) => db.bookings.filter((x) => (x.opsMemberId === id && x.status === 'IN_OPERATIONS') || (x.adminId === id && x.status === 'WITH_ADMIN')).length

  const submit = async () => {
    let dec: Decision
    if (kind === 'ASSIGN_OPS') dec = { kind, remark, opsMemberId: ops, maxStage, deadline }
    else if (kind === 'ASSIGN_ADMIN') dec = { kind, remark, adminId: admin }
    else dec = { kind, remark } as Decision
    const ok = await run(() => decide(me, b.id, dec), `${m.label}: done`)
    if (ok) { onClose(); onDone?.(kind) }
  }

  return (
    <Modal open onClose={onClose} title={m.label} subtitle={`${b.bookingId} · ${b.companyName} · ${b.serviceName}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={m.variant === 'outline' ? 'primary' : m.variant} icon={m.icon} onClick={submit}>{m.label}</Button></>}>
      <div className="space-y-4">
        {kind === 'APPROVE' && b.status !== 'PENDING_TL' && (
          <div className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">Approving verifies all {b.payments.length} payment(s) ({inr(bookingMoney(b).collected)}) and sends the file to Legal.</div>
        )}
        {kind === 'ASSIGN_OPS' && (
          <>
            <Select label="Operation Team member" required value={ops} onChange={(e) => setOps(e.target.value)}>
              <option value="">— Select —</option>
              {opsUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {load(u.id)} active file(s)</option>)}
            </Select>
            <Select label="Furthest stage they may reach" value={maxStage} onChange={(e) => setMaxStage(Number(e.target.value))} hint="They cannot move the file beyond this stage without you.">
              {STAGES.map((s, i) => <option key={s} value={i + 1}>{i + 1}. {s}</option>)}
            </Select>
            <Input label="Deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </>
        )}
        {kind === 'ASSIGN_ADMIN' && (
          <Select label="Admin" required value={admin} onChange={(e) => setAdmin(e.target.value)}>
            <option value="">— Select —</option>
            {admins.map((u) => <option key={u.id} value={u.id}>{u.name} · {load(u.id)} active file(s)</option>)}
          </Select>
        )}
        {kind === 'HOLD' && (
          <div className="flex flex-wrap gap-2">
            {HOLD_REASONS.map((r) => <button key={r} onClick={() => setRemark(r)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', remark === r ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-card2')}>{r}</button>)}
          </div>
        )}
        <Textarea label={needsReason ? 'Reason' : 'Remark'} required={needsReason} value={remark} onChange={(e) => setRemark(e.target.value)}
          placeholder={needsReason ? 'Explain why — the sales owner sees this.' : 'Optional note for the timeline'} />
      </div>
    </Modal>
  )
}

/** Compact row used by dashboard queues. */
export function BookingRow({ b, showActions = true, onDone }: { b: Booking; showActions?: boolean; onDone?: (kind: Decision['kind']) => void }) {
  const db = useDb()
  const m = bookingMoney(b)
  return (
    <div className="flex flex-col gap-3 border-b border-line/70 px-5 py-4 last:border-0 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/bookings/${b.id}`} className="font-bold hover:text-brand-ink hover:underline">{b.companyName}</Link>
          <BookingStatusBadge b={b} />
          <PriorityBadge p={b.priority} />
        </div>
        <p className="mt-0.5 truncate text-xs text-mute">
          <span className="font-mono">{b.bookingId}</span> · {b.serviceName} · by {userName(db, b.createdBy)} · {fmtDate(b.createdAt)}
        </p>
        {b.holdReason && <p className="mt-1 flex items-center gap-1 text-xs text-warn"><Clock className="size-3" />{b.holdReason}</p>}
      </div>
      <div className="text-left md:w-40 md:text-right">
        <p className="text-sm font-bold">{inr(m.collected)}</p>
        <p className="text-[11px] text-mute">of {inr(m.quotedWithGst)}</p>
      </div>
      {showActions && <DecisionButtons b={b} size="sm" onDone={onDone} />}
    </div>
  )
}
