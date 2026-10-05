import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../lib/store'
import { ymd } from '../lib/format'
import { cx } from '../components/ui'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function MiniCalendar() {
  const db = useDb()
  const nav = useNavigate()
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const eventDays = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of db.events) m.set(e.date, e.kind)
    return m
  }, [db.events])

  const cells = useMemo(() => {
    const y = cursor.getFullYear(), mo = cursor.getMonth()
    const startDow = (new Date(y, mo, 1).getDay() + 6) % 7
    const days = new Date(y, mo + 1, 0).getDate()
    return [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => new Date(y, mo, i + 1))] as (Date | null)[]
  }, [cursor])
  const todayKey = ymd()
  const kindColor: Record<string, string> = { HOLIDAY: 'bg-bad', DEADLINE: 'bg-warn', TRAINING: 'bg-info', MEETING: 'bg-brand', CELEBRATION: 'bg-accent' }

  return (
    <div className="rounded-2xl border border-line bg-card2/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button aria-label="Previous month" className="grid size-7 place-items-center rounded-lg text-mute hover:bg-card hover:text-ink" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></button>
        <span className="text-[13px] font-bold uppercase tracking-wider">{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
        <button aria-label="Next month" className="grid size-7 place-items-center rounded-lg text-mute hover:bg-card hover:text-ink" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
        {DOW.map((d, i) => <span key={i} className="py-1 font-semibold text-mute">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const k = ymd(d)
          const ev = eventDays.get(k)
          const isToday = k === todayKey
          const sunday = d.getDay() === 0
          return (
            <button key={i} onClick={() => nav(`/events?date=${k}`)} title={ev ? `${ev.toLowerCase()} on this day` : undefined}
              aria-label={`${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}${ev ? `, ${ev.toLowerCase()}` : ''}`}
              className={cx('relative mx-auto grid size-7 place-items-center rounded-lg tabular-nums transition',
                isToday ? 'bg-accent font-bold text-white shadow-md shadow-accent/30' : 'hover:bg-card', sunday && !isToday && 'text-bad/80')}>
              {d.getDate()}
              {ev && <span className={cx('absolute bottom-0.5 size-1 rounded-full', isToday ? 'bg-white' : kindColor[ev])} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
