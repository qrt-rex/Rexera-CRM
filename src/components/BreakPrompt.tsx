import { useEffect, useState } from 'react'
import { Coffee, Pause } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { breakFor, breakLabel, breakLeftMs, breakWindow, inBreakWindow, onBreak, pauseDay, workDay, dateIn } from '../lib/actions'
import { todaySession } from '../lib/metrics'
import { Button, useRun, useSubmitting } from './ui'

const SKIP = 'rexera-break-later'

/**
 * At the start of the lunch break (1:00 pm by default — each person's own shift if HR set one) a "Start break" card
 * appears on every page for anyone whose day is running. One click starts the break: the day is paused, the start
 * time is recorded, and the break screen counts down until they resume (the time is saved with the day's breaks).
 */
export function BreakPrompt() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [busy, once] = useSubmitting()
  const s = todaySession(db, me.id)
  const working = !!s && !s.logoutAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [working])
  const bp = breakFor(me, db)
  const w = breakWindow(now, bp)
  const day = dateIn(now, bp.timeZone)
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(SKIP) } catch { return null } })
  const show = working && workDay(day, bp) && inBreakWindow(now, bp) && !onBreak(s) && !s?.breaks?.length && breakLeftMs(s, now) > 0 && later !== day
  if (!show) return null
  const skip = () => { try { sessionStorage.setItem(SKIP, day) } catch { /* private mode: hide for now only */ } setLater(day) }
  return (
    <div role="status" className="fixed bottom-4 right-4 z-[80] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-warn/40 bg-card p-4 shadow-pop anim-fade-up">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warn-soft text-warn"><Coffee className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Lunch break time</p>
          <p className="text-xs text-mute">{breakLabel(bp)} · back by {new Date(w.end).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: bp.timeZone })}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="accent" icon={Pause} className="flex-1" loading={busy} onClick={() => once(async () => { await run(() => pauseDay(me), 'Break started — enjoy your lunch') })}>Start break</Button>
        <Button variant="ghost" onClick={skip}>Later</Button>
      </div>
    </div>
  )
}
