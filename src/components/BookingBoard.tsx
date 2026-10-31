import { useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { GripVertical, Lock } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { canMoveStage, moveStage, userName } from '../lib/actions'
import { STAGE_OUTCOMES, STAGES, stageLabel } from '../lib/workflow'
import { bookingMoney, inr } from '../lib/format'
import { BookingStatusBadge, PriorityBadge } from './booking'
import { StageSelect } from './StageControls'
import { Button, cx, Modal, Textarea, useRun } from './ui'

const PER_COLUMN = 60
/** Entries not with the Operation team yet (approvals, legal) have no stage: they wait in the first column. */
const WAITING = 0

/**
 * CRM entries as a board, stage by stage: drag a card to another stage (the same rules as the stage menu — up to the
 * file's allowed stage, a reason when it goes back). Each card also keeps its stage menu, for touch screens and keyboards.
 */
export function BookingBoard({ list }: { list: Booking[] }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [ask, setAsk] = useState<{ b: Booking; stage: number } | null>(null)
  const [reason, setReason] = useState('')
  const dragged = dragId ? list.find((b) => b.id === dragId) : undefined
  const limitOf = (b: Booking) => (me.role === 'superadmin' ? STAGES.length : Math.max(b.maxStage, b.stage))
  /** may the dragged card go to stage n? */
  const allowed = (n: number) => !!dragged && n !== WAITING && n !== dragged.stage && n <= limitOf(dragged)
  const columns = [WAITING, ...STAGES.map((_, i) => i + 1)]
  const colOf = (b: Booking) => (b.opsMemberId ? b.stage : WAITING)

  const drop = (n: number) => {
    const b = dragged
    setDragId(null); setOver(null)
    if (!b || !allowed(n)) return
    if (n < b.stage) { setReason(''); setAsk({ b, stage: n }); return }
    run(() => moveStage(me, b.id, n, ''), `${b.bookingId} moved to ${stageLabel(n, STAGE_OUTCOMES[n]?.[0]?.id)}`)
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain p-4">
      <div className="flex min-w-max gap-3">
        {columns.map((n) => {
          const cards = list.filter((b) => colOf(b) === n)
          const ok = allowed(n), hot = over === n && ok
          return (
            <section key={n} aria-label={n === WAITING ? 'Not with Operations yet' : `Stage ${n}: ${STAGES[n - 1]}`}
              onDragOver={(e: DragEvent) => { if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== n) setOver(n) } }}
              onDragLeave={(e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((x) => (x === n ? null : x)) }}
              onDrop={(e: DragEvent) => { e.preventDefault(); drop(n) }}
              className={cx('flex w-72 shrink-0 flex-col rounded-2xl border bg-card2/60 transition',
                hot ? 'border-brand bg-brand-soft/60 ring-2 ring-brand/30' : dragged ? (ok ? 'border-brand/40 border-dashed' : 'border-line opacity-60') : 'border-line')}>
              <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <span className={cx('grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold', n === WAITING ? 'bg-line text-mute' : 'bg-brand text-white')}>{n === WAITING ? '–' : n}</span>
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold" title={n === WAITING ? 'Approvals / legal — not with the Operation team yet' : STAGES[n - 1]}>{n === WAITING ? 'With approvals' : STAGES[n - 1]}</h3>
                <span className="rounded-full bg-card px-2 text-[11px] font-semibold text-mute">{cards.length}</span>
              </header>
              <div className="flex max-h-[65vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                {cards.slice(0, PER_COLUMN).map((b) => {
                  const movable = canMoveStage(db, me, b)
                  const m = bookingMoney(b)
                  return (
                    <article key={b.id} draggable={movable}
                      onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); setDragId(b.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }}
                      className={cx('group rounded-xl border border-line bg-card p-3 shadow-sm transition', movable ? 'cursor-grab active:cursor-grabbing hover:border-brand/40 hover:shadow-card' : '', dragId === b.id && 'opacity-40')}>
                      <div className="flex items-start gap-1.5">
                        <div className="min-w-0 flex-1">
                          <Link to={`/bookings/${b.id}`} draggable={false} className="block truncate text-sm font-semibold hover:text-brand-ink hover:underline">{b.companyName}</Link>
                          <p className="truncate font-mono text-[11px] text-mute">{b.bookingId}</p>
                        </div>
                        {movable ? <GripVertical className="mt-0.5 size-4 shrink-0 text-mute/60 group-hover:text-mute" aria-hidden /> : <Lock className="mt-0.5 size-3.5 shrink-0 text-mute/50" aria-label="You can't move this file" />}
                      </div>
                      <p className="mt-1 truncate text-xs" title={b.serviceName}>{b.serviceName}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1"><BookingStatusBadge b={b} /><PriorityBadge p={b.priority} /></div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-mute">
                        <span className="truncate">{b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '—'}</span>
                        <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{inr(m.collected)}<span className="font-normal text-mute"> / {inr(m.quotedWithGst)}</span></span>
                      </div>
                      {b.opsMemberId && <StageSelect b={b} className="mt-2 w-full max-w-none" />}
                    </article>
                  )
                })}
                {cards.length > PER_COLUMN && <p className="px-1 py-2 text-center text-[11px] text-mute">+{cards.length - PER_COLUMN} more — search or filter to narrow the list</p>}
                {!cards.length && <p className={cx('rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-mute', hot && 'border-brand text-brand-ink')}>{hot ? 'Drop here' : 'No files'}</p>}
              </div>
            </section>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-mute">Drag a card to another stage to move the file — only to stages it may reach; going back asks for a reason. Locked cards can’t be moved by you.</p>

      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask ? `Move back to ${stageLabel(ask.stage)}` : ''} subtitle={ask && `${ask.b.bookingId} · ${ask.b.companyName}`} size="sm"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={async () => { if (ask && await run(() => moveStage(me, ask.b.id, ask.stage, reason), `Moved back to ${stageLabel(ask.stage)}`)) setAsk(null) }}>Move back</Button></>}>
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Why is the file going back?" />
        <p className="mt-2 text-xs text-mute">The reason is shown on the file and to Legal, Admin and the Operation team.</p>
      </Modal>
    </div>
  )
}
