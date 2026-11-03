import { useEffect, useState } from 'react'
import type { CallOutcome, Lead } from '../../lib/types'
import { useMe } from '../../lib/auth'
import { logCall } from '../../lib/actions'
import { CALL_OUTCOMES, FOLLOW_UP_LEAD } from '../../lib/workflow'
import { addDays, ymd } from '../../lib/format'
import { Button, cx, Input, Textarea, useRun } from '../../components/ui'
import { BlutecEmbed } from '../../components/BlutecEmbed'

/** `totalSec` / `callStatus`: what Blutec reported for the call; `endedAt`: when it ended (the time until Save is wrap-up). */
export function CallLogger({ lead, seconds = 0, suggested, refId, totalSec, callStatus, endedAt, onDone }: {
  lead: Lead; seconds?: number; suggested?: CallOutcome; refId?: string; totalSec?: number; callStatus?: string; endedAt?: number; onDone?: (outcome: CallOutcome) => void
}) {
  const me = useMe()
  const run = useRun()
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [note, setNote] = useState('')
  const [follow, setFollow] = useState('')
  useEffect(() => { setOutcome(null); setNote(''); setFollow('') }, [lead.id])
  useEffect(() => { if (suggested) setOutcome(suggested) }, [suggested])
  const needsFollow = !!outcome && FOLLOW_UP_LEAD.includes(outcome)
  const save = async () => {
    if (!outcome) return
    const wrapSec = endedAt ? Math.max(0, Math.round((Date.now() - endedAt) / 1000)) : undefined
    const ok = await run(() => logCall(me, lead.id, outcome, note, needsFollow ? follow || ymd(addDays(new Date(), 1)) : undefined, seconds, refId, { totalSec, callStatus, wrapSec }), 'Call logged')
    if (ok) { const o = outcome; setOutcome(null); setNote(''); setFollow(''); onDone?.(o) }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CALL_OUTCOMES.map((o) => (
          <button key={o.id} onClick={() => setOutcome(o.id)}
            className={cx('rounded-xl border px-3 py-2 text-xs font-semibold transition', outcome === o.id ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{o.label}</button>
        ))}
      </div>
      {needsFollow && <Input label="Follow-up date" type="date" value={follow || ymd(addDays(new Date(), 1))} onChange={(e) => setFollow(e.target.value)} />}
      <Textarea placeholder="Call note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button className="w-full" disabled={!outcome} onClick={save}>Save outcome</Button>
    </div>
  )
}

export default function Dialer() {
  return (
    <div className="h-[calc(100vh-80px)]">
      <BlutecEmbed className="h-full w-full" />
    </div>
  )
}
