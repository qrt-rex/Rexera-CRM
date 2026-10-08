import { useMemo, useState } from 'react'
import { BellRing, Clock, Coffee, Pencil, Plus, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react'
import type { BreakPolicy, Shift, User } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { breakFor, breakMinutes, breakPolicy, clock, DEFAULT_BREAK, LOCAL_TZ, sameTz, saveBreakPolicy, saveShift, userName } from '../../lib/actions'
import { fmtDateTime } from '../../lib/format'
import { Avatar, Button, Card, CardHeader, Checkbox, cx, EmptyState, Input, Modal, PageHeader, Select, Textarea, Toggle, useRun } from '../../components/ui'

type Draft = Omit<BreakPolicy, 'updatedAt' | 'updatedBy'>
const toDraft = ({ updatedAt: _a, updatedBy: _b, ...p }: BreakPolicy): Draft => ({ ...p, offDays: [...p.offDays] })
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// browsers list some zones by their old names; show (and save) the current ones
const MODERN: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv',
}
const ZONES = (() => {
  let list: string[]
  try { list = Intl.supportedValuesOf('timeZone') } catch { list = ['Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'] }
  return [...new Set(list.map((z) => MODERN[z] ?? z))].sort()
})()
/** The list entry for a saved zone, even when it was saved under another name. */
const zoneOption = (tz: string) => ZONES.find((z) => sameTz(z, tz)) ?? tz
/** "13:40" (+ minutes) as a time of day in a time zone. */
const at = (hhmm: string, tz: string, plus = 0) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const d = new Date(Date.UTC(2000, 0, 1, h, m + plus))
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + (sameTz(tz, LOCAL_TZ) ? '' : ` (${tz})`)
}

function OffDays({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekly off days">
      {DAYS.map((d, i) => {
        const off = value.includes(i)
        return (
          <button key={d} type="button" disabled={disabled} aria-pressed={off} onClick={() => onChange(off ? value.filter((x) => x !== i) : [...value, i])}
            className={cx('h-8 min-w-11 rounded-lg border px-2 text-xs font-bold transition disabled:opacity-60', off ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line bg-card text-ink/80 hover:border-brand/50')}>
            {d}
          </button>
        )
      })}
    </div>
  )
}

export default function BreakSettings() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const manage = can('employees.manage')
  const saved = breakPolicy(db)
  const [f, setF] = useState<Draft>(() => toDraft(saved))
  const set = (patch: Partial<Draft>) => setF({ ...f, ...patch })
  const [editing, setEditing] = useState<string | null>(null)

  const len = breakMinutes(f as BreakPolicy)
  const steps = [
    { time: at(f.start, f.timeZone), text: f.remind ? 'Break reminder to everyone whose day is running' : 'Break starts (reminder off)' },
    { time: at(f.end, f.timeZone), text: 'Break ends — back by now is on time' },
    { time: at(f.end, f.timeZone, 1), text: 'Late counting starts' },
    { time: at(f.end, f.timeZone, f.warnAfterMin), text: f.monitor ? 'Still away → marked late, warning sent, HR alerted' : 'Late checks off — nobody is warned' },
  ]
  const shifts = db.users.filter((u) => u.active && u.shift)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Break Time" icon={Coffee}
        subtitle={saved.updatedAt ? `Saved ${fmtDateTime(saved.updatedAt)} by ${userName(db, saved.updatedBy)}` : 'Default lunch break 1:00 – 1:40 pm'}
        actions={manage && <>
          <Button variant="outline" icon={RotateCcw} onClick={() => setF(toDraft(DEFAULT_BREAK))}>Load defaults</Button>
          <Button icon={Save} onClick={() => run(() => saveBreakPolicy(me, f), 'Break time saved')}>Save</Button>
        </>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Company lunch break" subtitle={len > 0 ? `${len} minutes · pause and resume inside the window` : 'The end must be after the start'} icon={Coffee} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Input label="Break starts" type="time" disabled={!manage} value={f.start} onChange={(e) => set({ start: e.target.value })} />
            <Input label="Break ends (expected return)" type="time" disabled={!manage} value={f.end} onChange={(e) => set({ end: e.target.value })} />
            <Select label="Time zone" disabled={!manage} value={zoneOption(f.timeZone)} onChange={(e) => set({ timeZone: e.target.value })} hint="Break times are in this zone" className="sm:col-span-2">
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs font-semibold text-mute">Weekly off days</p>
              <OffDays value={f.offDays} onChange={(v) => set({ offDays: v })} disabled={!manage} />
              <p className="mt-1 text-xs text-mute">No reminder or late alert on these days</p>
            </div>
            <Input label="Warn when still away after (minutes)" type="number" min={0} max={30} disabled={!manage} value={f.warnAfterMin}
              onChange={(e) => set({ warnAfterMin: Math.round(Number(e.target.value)) })} hint={`Warning goes out at ${at(f.end, f.timeZone, f.warnAfterMin)}`} className="sm:col-span-2" />
            <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm sm:col-span-2">
              <span><b>Break reminder</b><span className="block text-xs text-mute">A notification at the break start to everyone working (not on leave, not absent, not off)</span></span>
              {manage ? <Toggle checked={f.remind} onChange={(v) => set({ remind: v })} label="Break reminder" /> : <span className="text-xs font-semibold">{f.remind ? 'On' : 'Off'}</span>}
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm sm:col-span-2">
              <span><b>Late-break checks</b><span className="block text-xs text-mute">Mark late, warn the employee and alert HR</span></span>
              {manage ? <Toggle checked={f.monitor} onChange={(v) => set({ monitor: v })} label="Late-break checks" /> : <span className="text-xs font-semibold">{f.monitor ? 'On' : 'Off'}</span>}
            </label>
          </div>
        </Card>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Late warning to the employee" icon={ShieldAlert} />
            <div className="p-5">
              <Textarea label="Message" rows={3} maxLength={300} disabled={!manage} value={f.warnMessage} onChange={(e) => set({ warnMessage: e.target.value })}
                hint="Shown as a pop-up notification and on the employee's break banner" />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="What happens every working day" icon={BellRing} />
            <ol className="space-y-3 p-5 text-sm">
              {steps.map((s) => (
                <li key={s.text} className="flex gap-3">
                  <span className="w-24 shrink-0 font-bold tabular-nums">{s.time}</span>
                  <span className="text-ink/80">{s.text}</span>
                </li>
              ))}
              <li className="flex gap-3"><span className="w-24 shrink-0 font-bold">On return</span><span className="text-ink/80">Actual return time and minutes late are saved; the HR alert updates by itself</span></li>
            </ol>
          </Card>
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Employee shifts" icon={Clock}
          subtitle="People whose break, time zone or off days differ from the company. Everyone else follows the company break."
          action={manage && <Button size="sm" variant="soft" icon={Plus} onClick={() => setEditing('')}>Add shift</Button>} />
        {!shifts.length ? <EmptyState icon={Clock} title="Everyone is on the company break" text="Add a shift for someone who works a different break, time zone or week." /> : (
          <ul className="divide-y divide-line/70">
            {shifts.map((u) => {
              const p = breakFor(u, db)
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={u.name} photo={u.photo} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.name}</span>
                    <span className="block truncate text-xs text-mute">{u.department || '—'} · break {at(p.start, p.timeZone)} – {at(p.end, p.timeZone)} · off {p.offDays.length ? p.offDays.map((d) => DAYS[d]).join(', ') : 'none'}</span>
                  </span>
                  {manage && <>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u.id)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run(() => saveShift(me, u.id, undefined), `${u.name} is back on the company break`)}>Remove</Button>
                  </>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {editing !== null && <ShiftEditor userId={editing} company={saved} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ShiftEditor({ userId, company, onClose }: { userId: string; company: BreakPolicy; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const people = useMemo(() => db.users.filter((u) => u.active && (u.id === userId || !u.shift)).sort((a, b) => a.name.localeCompare(b.name)), [db.users, userId])
  const [who, setWho] = useState(userId || people[0]?.id || '')
  const cur: Shift = db.users.find((u) => u.id === who)?.shift ?? {}
  const [ownBreak, setOwnBreak] = useState(!!cur.breakStart)
  const [start, setStart] = useState(cur.breakStart ?? company.start)
  const [end, setEnd] = useState(cur.breakEnd ?? company.end)
  const [tz, setTz] = useState(cur.timeZone ?? '')
  const [ownDays, setOwnDays] = useState(!!cur.offDays)
  const [days, setDays] = useState<number[]>(cur.offDays ?? [...company.offDays])
  const name = (u: User) => `${u.name} · ${u.department || '—'}`
  const save = async () => {
    const sh: Shift = { ...(ownBreak && { breakStart: start, breakEnd: end }), ...(tz && { timeZone: tz }), ...(ownDays && { offDays: days }) }
    if (await run(() => saveShift(me, who, Object.keys(sh).length ? sh : undefined), 'Shift saved')) onClose()
  }
  return (
    <Modal open onClose={onClose} title={userId ? 'Edit shift' : 'Add shift'} subtitle="Anything you leave on “company” follows the company break"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Save} disabled={!who} onClick={save}>Save shift</Button></>}>
      <div className="space-y-4">
        <Select label="Employee" value={who} disabled={!!userId} onChange={(e) => setWho(e.target.value)}>
          {people.map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}
        </Select>
        <div className="rounded-xl border border-line p-3">
          <Checkbox checked={ownBreak} onChange={setOwnBreak} label={<span className="font-semibold">Own break time <span className="font-normal text-mute">(company: {at(company.start, company.timeZone)} – {at(company.end, company.timeZone)})</span></span>} />
          {ownBreak && <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Break starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="Break ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>}
        </div>
        <Select label="Time zone" value={tz && zoneOption(tz)} onChange={(e) => setTz(e.target.value)} hint="Where this person works; their break times are in this zone">
          <option value="">Company ({company.timeZone})</option>
          {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
        </Select>
        <div className="rounded-xl border border-line p-3">
          <Checkbox checked={ownDays} onChange={setOwnDays} label={<span className="font-semibold">Own weekly off days <span className="font-normal text-mute">(company: {company.offDays.map((d) => DAYS[d]).join(', ') || 'none'})</span></span>} />
          {ownDays && <div className="mt-3"><OffDays value={days} onChange={setDays} /></div>}
        </div>
        <p className="text-xs text-mute">Time there now: <b>{clock(Date.now(), tz || company.timeZone)}</b> · their break {at(ownBreak ? start : company.start, tz || company.timeZone)} – {at(ownBreak ? end : company.end, tz || company.timeZone)}</p>
      </div>
    </Modal>
  )
}
