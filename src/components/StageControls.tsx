import { useState } from 'react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { canMoveStage, moveStage, outcomeNeedsReason, setStageOutcome } from '../lib/actions'
import { STAGE_OUTCOMES, STAGES, stageLabel } from '../lib/workflow'
import { Button, cx, Modal, Textarea, useRun } from './ui'

/**
 * Stage + step / result controls for Admin and the Operation team.
 * Stage 8 starts "Approved"; Rejected / Re-submission / Hold ask for the reason.
 */
export function StageControls({ b, variant = 'select', showMove = true }: { b: Booking; variant?: 'select' | 'chips'; showMove?: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [ask, setAsk] = useState<{ outcome: string; stage?: number } | null>(null)
  const [reason, setReason] = useState('')
  const movable = canMoveStage(db, me, b)
  const outcomes = STAGE_OUTCOMES[b.stage]
  const next = STAGES.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.n !== b.stage && (x.n <= Math.max(b.maxStage, b.stage) || me.role === 'superadmin'))
  if (!movable) return null

  const pickOutcome = (o: string) => {
    if (outcomeNeedsReason(o)) { setReason(o === b.stageOutcome ? b.stageReason ?? '' : ''); setAsk({ outcome: o }) }
    else run(() => setStageOutcome(me, b.id, o), stageLabel(b.stage, o))
  }
  const move = (n: number) => {
    if (n < b.stage) { setReason(''); setAsk({ outcome: '', stage: n }); return }
    run(() => moveStage(me, b.id, n, ''), `Moved to ${stageLabel(n, STAGE_OUTCOMES[n]?.[0]?.id)}`)
  }
  const save = async () => {
    if (!ask) return
    const ok = ask.stage
      ? await run(() => moveStage(me, b.id, ask.stage!, reason), `Moved back to ${stageLabel(ask.stage!)}`)
      : await run(() => setStageOutcome(me, b.id, ask.outcome, reason), stageLabel(b.stage, ask.outcome))
    if (ok) setAsk(null)
  }
  const askLabel = ask?.stage ? `Move back to ${stageLabel(ask.stage)}` : ask ? stageLabel(b.stage, ask.outcome) : ''

  return (
    <>
      {outcomes && (variant === 'chips' ? (
        <div className="flex flex-wrap gap-2">
          {outcomes.map((o) => (
            <button key={o.id} type="button" onClick={() => pickOutcome(o.id)}
              className={cx('rounded-full border px-3 py-1 text-xs font-semibold transition', b.stageOutcome === o.id ? (outcomeNeedsReason(o.id) ? 'border-bad bg-bad text-white' : 'border-brand bg-brand text-white') : 'border-line bg-card hover:bg-card2')}>
              {o.label}{outcomeNeedsReason(o.id) ? '…' : ''}
            </button>
          ))}
        </div>
      ) : (
        <select aria-label={`${b.stage === 3 ? 'Step' : 'Result'} for ${b.companyName}`} value={b.stageOutcome ?? ''} onChange={(e) => e.target.value && pickOutcome(e.target.value)}
          className={cx('h-8 rounded-lg border px-2 text-xs font-semibold', outcomeNeedsReason(b.stageOutcome) ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line bg-card')}>
          {!b.stageOutcome && <option value="">{b.stage === 3 ? 'Pick step…' : 'Pick result…'}</option>}
          {outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}{outcomeNeedsReason(o.id) ? ' (give reason)' : ''}</option>)}
        </select>
      ))}
      {showMove && next.length > 0 && (
        <select aria-label={`Move ${b.companyName} to stage`} value="" onChange={(e) => e.target.value && move(Number(e.target.value))}
          className="h-8 rounded-lg border border-line bg-card px-2 text-xs font-semibold">
          <option value="">Move to stage…</option>
          {next.map((x) => <option key={x.n} value={x.n}>{x.n < b.stage ? '↩ ' : ''}{x.n}. {x.s}</option>)}
        </select>
      )}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={askLabel} subtitle={`${b.bookingId} · ${b.companyName}`} size="sm"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button><Button variant={ask?.stage ? 'primary' : 'danger'} disabled={reason.trim().length < 3} onClick={save}>Save</Button></>}>
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
          placeholder={ask?.stage ? 'Why is the file going back?' : ask?.outcome === 'HOLD_CLIENT' ? 'e.g. Client not responding since 3 calls' : ask?.outcome === 'REJECTED' ? 'Why was it rejected?' : 'What needs to be re-submitted?'} />
        <p className="mt-2 text-xs text-mute">The reason is shown on the file and to Legal, Admin and the Operation team.</p>
      </Modal>
    </>
  )
}

/**
 * One dropdown with every stage (and stage 3's steps / stage 8's results) — for lists. Admin and the Operation team can
 * change it; everyone else sees the stage as text. Moving back, or a result other than Approved, asks for the reason.
 */
export function StageSelect({ b, className }: { b: Booking; className?: string }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [ask, setAsk] = useState<{ stage: number; outcome?: string; title: string } | null>(null)
  const [reason, setReason] = useState('')
  if (!b.opsMemberId) return null
  if (!canMoveStage(db, me, b)) return <StageText b={b} className={cx('block text-[11px] font-semibold text-mute', className)} />
  const options = STAGES.flatMap((s, i) => {
    const n = i + 1
    const sub = STAGE_OUTCOMES[n]
    return sub ? sub.map((o) => ({ n, o: o.id, label: `${n}. ${o.label}` })) : [{ n, o: undefined as string | undefined, label: `${n}. ${s}` }]
  })
  const value = `${b.stage}:${b.stageOutcome ?? ''}`
  const limit = me.role === 'superadmin' ? STAGES.length : Math.max(b.maxStage, b.stage)
  const pick = (v: string) => {
    const [ns, o] = v.split(':')
    const n = Number(ns), outcome = o || undefined
    const title = stageLabel(n, outcome)
    if (n < b.stage || outcomeNeedsReason(outcome)) { setReason(''); setAsk({ stage: n, outcome, title }); return }
    run(() => (n === b.stage ? setStageOutcome(me, b.id, outcome!) : moveStage(me, b.id, n, '', outcome)), title)
  }
  const save = async () => {
    if (!ask) return
    const ok = await run(() => (ask.stage === b.stage && ask.outcome ? setStageOutcome(me, b.id, ask.outcome, reason) : moveStage(me, b.id, ask.stage, reason, ask.outcome)), ask.title)
    if (ok) setAsk(null)
  }
  return (
    <>
      <select aria-label={`Stage of ${b.companyName}`} value={value} onChange={(e) => pick(e.target.value)} title={b.stageReason ? `Reason: ${b.stageReason}` : undefined}
        className={cx('mt-1 block h-8 max-w-56 rounded-lg border px-2 text-xs font-semibold', outcomeNeedsReason(b.stageOutcome) ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line bg-card', className)}>
        {!options.some((x) => `${x.n}:${x.o ?? ''}` === value) && <option value={value}>{stageLabel(b.stage, b.stageOutcome)}</option>}
        {options.map((x) => (
          <option key={`${x.n}:${x.o ?? ''}`} value={`${x.n}:${x.o ?? ''}`} disabled={x.n > limit}>
            {x.label}{outcomeNeedsReason(x.o) ? ' (reason)' : ''}{x.n > limit ? ' — not allowed yet' : ''}
          </option>
        ))}
      </select>
      {b.stageReason && <p className="mt-0.5 max-w-56 truncate text-[11px] text-bad" title={b.stageReason}>{b.stageReason}</p>}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask ? (ask.stage < b.stage ? `Move back to ${ask.title}` : ask.title) : ''} subtitle={`${b.bookingId} · ${b.companyName}`} size="sm"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={save}>Save</Button></>}>
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={ask && ask.stage < b.stage ? 'Why is the file going back?' : 'Give the reason'} />
        <p className="mt-2 text-xs text-mute">The reason is shown on the file and to Legal, Admin and the Operation team.</p>
      </Modal>
    </>
  )
}

/** "8. Hold — Client not responding since Monday" */
export function StageText({ b, className }: { b: Booking; className?: string }) {
  const bad = outcomeNeedsReason(b.stageOutcome)
  return (
    <span className={cx(bad ? 'text-bad' : '', className)}>
      {stageLabel(b.stage, b.stageOutcome)}{b.stageReason ? <span className="font-normal"> — {b.stageReason}</span> : null}
    </span>
  )
}
