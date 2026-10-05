import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import type { EventItem } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deleteEvent, upsertEvent, userName } from '../../lib/actions'
import { fmtDate, today, ymd } from '../../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, Modal, PageHeader, Select, Textarea, useRun } from '../../components/ui'

const KIND_TONE = { MEETING: 'navy', TRAINING: 'blue', HOLIDAY: 'red', DEADLINE: 'amber', CELEBRATION: 'orange' } as const
const KIND_BG = { MEETING: 'bg-brand', TRAINING: 'bg-info', HOLIDAY: 'bg-bad', DEADLINE: 'bg-warn', CELEBRATION: 'bg-accent' }
type Draft = Omit<EventItem, 'id' | 'by'> & { id?: string }

export default function Events() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const selected = params.get('date') ?? today()
  const [cursor, setCursor] = useState(() => { const d = new Date(selected + 'T00:00:00'); d.setDate(1); return d })
  const [edit, setEdit] = useState<Draft | null>(null)
  const manage = can('events.manage')
  const cells = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth()
    const start = (new Date(y, m, 1).getDay() + 6) % 7
    return [...Array(start).fill(null), ...Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => ymd(new Date(y, m, i + 1)))] as (string | null)[]
  }, [cursor])
  const onDay = db.events.filter((e) => e.date === selected).sort((a, b) => a.time.localeCompare(b.time))
  const upcoming = db.events.filter((e) => e.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 8)

  return (
    <div>
      <PageHeader title="Events & Calendar" subtitle="Meetings, trainings, holidays and deadlines" icon={CalendarDays}
        actions={manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ title: '', date: selected, time: '10:00', kind: 'MEETING', description: '' })}>New event</Button>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" icon={ChevronLeft} aria-label="Previous" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} />
              <Button size="sm" variant="outline" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); setParams({ date: today() }) }}>Today</Button>
              <Button size="sm" variant="outline" icon={ChevronRight} aria-label="Next" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-bold text-mute">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="py-1">{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />
              const evs = db.events.filter((e) => e.date === d)
              return (
                <button key={d} onClick={() => setParams({ date: d })}
                  className={cx('flex min-h-20 flex-col items-stretch rounded-xl border p-1.5 text-left transition sm:min-h-24', d === selected ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-card2')}>
                  <span className={cx('mb-1 grid size-6 place-items-center rounded-full text-xs font-bold', d === today() ? 'bg-accent text-white' : '')}>{Number(d.slice(8))}</span>
                  {evs.slice(0, 2).map((e) => <span key={e.id} className={cx('mb-0.5 truncate rounded px-1 text-[10px] font-semibold text-white', KIND_BG[e.kind])}>{e.title}</span>)}
                  {evs.length > 2 && <span className="text-[10px] text-mute">+{evs.length - 2} more</span>}
                </button>
              )
            })}
          </div>
        </Card>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={fmtDate(selected)} subtitle={`${onDay.length} event(s)`} icon={CalendarDays} />
            {!onDay.length ? <EmptyState icon={CalendarDays} title="Free day" /> : (
              <ul className="divide-y divide-line/70">
                {onDay.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <div className="flex items-center gap-2"><Badge tone={KIND_TONE[e.kind]}>{e.kind.toLowerCase()}</Badge><span className="text-xs text-mute">{e.kind === 'HOLIDAY' ? 'All day' : e.time}</span>
                      {manage && <span className="ml-auto flex gap-1"><Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEdit(e)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" className="text-bad" onClick={() => run(() => deleteEvent(me, e.id), 'Deleted')} /></span>}</div>
                    <p className="mt-1 font-semibold">{e.title}</p><p className="text-sm text-mute">{e.description}</p><p className="mt-1 text-[11px] text-mute">by {userName(db, e.by)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Upcoming" />
            <ul className="divide-y divide-line/70">{upcoming.map((e) => <li key={e.id}><button className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-card2" onClick={() => setParams({ date: e.date })}><span className={cx('size-2 rounded-full', KIND_BG[e.kind])} /><span className="flex-1 truncate text-sm">{e.title}</span><span className="text-xs text-mute">{fmtDate(e.date)}</span></button></li>)}</ul>
          </Card>
        </div>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit event' : 'New event'}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (edit && await run(() => upsertEvent(me, edit), 'Saved')) setEdit(null) }}>Save</Button></>}>
        {edit && <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="sm:col-span-2" />
          <Input label="Date" type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
          <Input label="Time" type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} />
          <Select label="Type" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as EventItem['kind'] })} className="sm:col-span-2">{Object.keys(KIND_TONE).map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}</Select>
          <Textarea label="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="sm:col-span-2" />
        </div>}
      </Modal>
    </div>
  )
}
