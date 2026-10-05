import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, PhoneCall, PhoneOff, SkipForward, Timer, Phone, Flame, History } from 'lucide-react'
import type { CallOutcome, Lead } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { logCall, visibleLeads } from '../../lib/actions'
import { CALL_OUTCOMES, LEAD_STATUS, OPEN_LEAD } from '../../lib/workflow'
import { addDays, fmtDate, fmtTime, inr, today, ymd } from '../../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, PageHeader, Textarea, useRun } from '../../components/ui'
import { salesNumbers } from '../../lib/metrics'
import { MiniStat } from '../dashboards/widgets'

export function CallLogger({ lead, seconds = 0, onDone }: { lead: Lead; seconds?: number; onDone?: () => void }) {
  const me = useMe()
  const run = useRun()
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [note, setNote] = useState('')
  const [follow, setFollow] = useState('')
  useEffect(() => { setOutcome(null); setNote(''); setFollow('') }, [lead.id])
  const needsFollow = outcome === 'CALL_BACK' || outcome === 'INTERESTED'
  const save = async () => {
    if (!outcome) return
    const ok = await run(() => logCall(me, lead.id, outcome, note, needsFollow ? follow || ymd(addDays(new Date(), 1)) : undefined, seconds), 'Call logged')
    if (ok) { setOutcome(null); setNote(''); setFollow(''); onDone?.() }
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
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const t = today()
  const queue = useMemo(() => visibleLeads(db, me)
    .filter((l) => OPEN_LEAD.includes(l.status) && (l.assignedTo === me.id || !l.assignedTo))
    .sort((a, b) => {
      const da = a.followUp && a.followUp <= t ? 0 : a.status === 'NEW' ? 1 : 2
      const dbb = b.followUp && b.followUp <= t ? 0 : b.status === 'NEW' ? 1 : 2
      return da - dbb || (a.followUp ?? '').localeCompare(b.followUp ?? '')
    }), [db, me, t])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const current = queue.find((l) => l.id === currentId) ?? queue[0]
  const [onCall, setOnCall] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { if (onCall === null) return; const i = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(i) }, [onCall])
  const secs = onCall ? Math.floor((Date.now() - onCall) / 1000) : 0
  void tick
  const n = salesNumbers(db, me)
  const myCallsToday = db.leads.flatMap((l) => l.calls.filter((c) => c.by === me.id && c.at.slice(0, 10) === t).map((c) => ({ ...c, lead: l }))).sort((a, b) => b.at.localeCompare(a.at))
  const next = () => { setOnCall(null); const i = queue.findIndex((l) => l.id === current?.id); setCurrentId(queue[(i + 1) % queue.length]?.id ?? null) }

  return (
    <div>
      <PageHeader title="Dialer" subtitle="Follow-ups due come first, then new leads" icon={Phone} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="In my queue" value={queue.length} icon={PhoneCall} />
        <MiniStat label="Follow-ups due" value={n.followUps} icon={Flame} tone="amber" />
        <MiniStat label="Calls today" value={n.callsToday} icon={History} tone="green" />
        <MiniStat label="Talk time today" value={`${Math.round(myCallsToday.reduce((s, c) => s + c.durationSec, 0) / 60)} min`} icon={Timer} tone="violet" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[340px_1fr_320px]">
        <Card className="overflow-hidden xl:max-h-[70vh] xl:overflow-y-auto">
          <CardHeader title="Queue" subtitle={`${queue.length} leads`} />
          {!queue.length && <EmptyState icon={PhoneCall} title="Queue is empty" text="Great work! Add leads or ask your team leader for more." />}
          <ul>
            {queue.map((l) => (
              <li key={l.id}>
                <button onClick={() => { setCurrentId(l.id); setOnCall(null) }} className={cx('flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card2', current?.id === l.id && 'bg-brand-soft')}>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{l.name}</span><span className="block truncate text-xs text-mute">{l.service || l.company}</span></span>
                  {l.followUp && l.followUp <= t ? <Badge tone="red">Due</Badge> : <Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {current ? (
          <Card className="p-6">
            <div className="flex flex-col items-center text-center">
              <span className={cx('grid size-24 place-items-center rounded-full text-3xl font-extrabold text-white', onCall ? 'bg-ok anim-ring' : 'bg-brand')}>{current.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <h2 className="mt-4 text-2xl font-extrabold">{current.name}</h2>
              <p className="text-mute">{current.company || 'No company'} · {current.city || current.state}</p>
              <p className="mt-2 font-mono text-xl tracking-wider">{current.phone}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Badge tone={LEAD_STATUS[current.status].tone}>{LEAD_STATUS[current.status].label}</Badge>
                {current.service && <Badge tone="navy">{current.service}</Badge>}
                {current.price != null && <Badge tone="green">{inr(current.price)}</Badge>}
                {current.followUp && <Badge tone="amber">Follow-up {fmtDate(current.followUp)}</Badge>}
              </div>
              {onCall !== null && <p className="mt-4 font-mono text-3xl font-bold text-ok">{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</p>}
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {onCall === null
                  ? <a href={`tel:+91${current.phone}`} onClick={() => setOnCall(Date.now())}><Button size="lg" variant="success" icon={PhoneCall}>Call now</Button></a>
                  : <Button size="lg" variant="danger" icon={PhoneOff} onClick={() => setOnCall(null)}>End call</Button>}
                <Button size="lg" variant="outline" icon={SkipForward} onClick={next}>Skip</Button>
                {can('bookings.create') && <Button size="lg" variant="soft" icon={Briefcase} onClick={() => nav(`/bookings/new?lead=${current.id}`)}>Book</Button>}
              </div>
              {current.notes && <p className="mt-5 w-full whitespace-pre-line rounded-xl bg-card2 p-3 text-left text-sm">{current.notes}</p>}
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <h4 className="mb-3 font-bold">Outcome</h4>
              <CallLogger lead={current} seconds={secs} onDone={next} />
            </div>
          </Card>
        ) : <Card><EmptyState icon={Phone} title="Nothing to dial" /></Card>}

        <Card className="overflow-hidden">
          <CardHeader title="Today's calls" subtitle={`${myCallsToday.length} logged`} />
          <ul className="max-h-[60vh] overflow-y-auto">
            {myCallsToday.map((c) => (
              <li key={c.id} className="border-b border-line/60 px-4 py-3">
                <p className="text-sm font-semibold">{c.lead.name}</p>
                <p className="text-xs text-mute">{fmtTime(c.at)} · {CALL_OUTCOMES.find((o) => o.id === c.outcome)?.label} · {Math.round(c.durationSec / 60)} min</p>
              </li>
            ))}
            {!myCallsToday.length && <li className="p-5 text-sm text-mute">No calls yet today.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}
