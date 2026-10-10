import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Ban, Briefcase, CircleCheck, CircleDashed, Flame, History, Pause, Phone, PhoneCall, PhoneOff, Play, Radio, RefreshCcw, Settings2, SkipForward, Square, Timer, UserPlus } from 'lucide-react'
import type { CallOutcome, Lead } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { createLead, logCall, setLeadStatus, visibleLeads } from '../../lib/actions'
import { CALL_OUTCOMES, LEAD_STATUS, OPEN_LEAD } from '../../lib/workflow'
import { addDays, fmtDate, fmtDateTime, fmtTime, inr, normPhone, today, ymd } from '../../lib/format'
import { blutec, dialerKey, DialerError, FINAL_STATUSES, isHot, type AgentConnect, type BlutecStatus, type CallStatus, type Ivr, type IvrStats } from '../../lib/dialer'
import { rolesOf } from '../../lib/rbac'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, Modal, PageHeader, Table, Tabs, Td, Textarea, Th, useConfirm, useRun, useToast } from '../../components/ui'
import { salesNumbers } from '../../lib/metrics'
import { MiniStat } from '../dashboards/widgets'

/** Blutec connection state, checked once per page view. */
function useBlutec() {
  const [state, setState] = useState<{ loading: boolean; status?: BlutecStatus; error?: string }>({ loading: true })
  const check = useCallback(() => {
    setState({ loading: true })
    blutec.status().then((status) => setState({ loading: false, status }), (e: Error) => setState({ loading: false, error: e.message }))
  }, [])
  useEffect(() => { check() }, [check])
  return { ...state, check }
}

export function CallLogger({ lead, seconds = 0, suggested, onDone }: { lead: Lead; seconds?: number; suggested?: CallOutcome; onDone?: (outcome: CallOutcome) => void }) {
  const me = useMe()
  const run = useRun()
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [note, setNote] = useState('')
  const [follow, setFollow] = useState('')
  useEffect(() => { setOutcome(null); setNote(''); setFollow('') }, [lead.id])
  useEffect(() => { if (suggested) setOutcome(suggested) }, [suggested])
  const needsFollow = outcome === 'CALL_BACK' || outcome === 'INTERESTED'
  const save = async () => {
    if (!outcome) return
    const ok = await run(() => logCall(me, lead.id, outcome, note, needsFollow ? follow || ymd(addDays(new Date(), 1)) : undefined, seconds), 'Call logged')
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
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const roles = rolesOf(me)
  // Calls are for sales people (sales / team leader); IVR campaigns are for Super Admin only
  const showCalls = roles.some((r) => r === 'sales' || r === 'teamlead')
  const showIvr = roles.includes('superadmin')
  const tab = showIvr && (!showCalls || params.get('tab') === 'ivr') ? 'ivr' : showCalls ? 'calls' : null
  const bt = useBlutec()
  return (
    <div>
      <PageHeader title="Dialer" icon={Phone}
        subtitle={tab === 'ivr' ? 'IVR campaigns through Blutec: live stats and hot prospects' : 'Click-to-call through Blutec — follow-ups due come first, then new leads'}
        actions={tab && <>
          <ConnectionPill bt={bt} ivr={tab === 'ivr'} />
          {showCalls && showIvr && <Tabs value={tab} onChange={(t) => setParams(t === 'calls' ? {} : { tab: t })} tabs={[{ id: 'calls', label: 'Calls', icon: PhoneCall }, { id: 'ivr', label: 'IVR campaigns', icon: Radio }]} />}
        </>} />
      {tab === 'calls' ? <CallsTab bt={bt} /> : tab === 'ivr' ? <IvrTab bt={bt} manage /> : (
        <Card><EmptyState icon={Phone} title="Dialer is for sales people" text="Calls are used by sales people and team leaders; IVR campaigns are run by the Super Admin." /></Card>
      )}
    </div>
  )
}

function ConnectionPill({ bt, ivr }: { bt: ReturnType<typeof useBlutec>; ivr: boolean }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(dialerKey.get)
  const ok = ivr ? bt.status?.ivr : bt.status?.dialer
  return (
    <>
      <button onClick={() => setOpen(true)} className={cx('flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold', ok ? 'border-ok/30 bg-ok-soft text-ok' : 'border-warn/30 bg-warn-soft text-warn')}>
        {bt.loading ? <CircleDashed className="size-4 animate-spin" /> : ok ? <CircleCheck className="size-4" /> : <Settings2 className="size-4" />}
        {bt.loading ? 'Checking dialer…' : ivr ? (ok ? 'Blutec IVR connected' : 'IVR not connected') : ok ? 'Blutec connected' : 'Dialer not connected'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Blutec dialer connection" size="lg" footer={<><Button variant="outline" icon={RefreshCcw} onClick={bt.check}>Check again</Button><Button onClick={() => setOpen(false)}>Close</Button></>}>
        <div className="space-y-3 text-sm">
          <p>Click-to-call: <b className={bt.status?.dialer ? 'text-ok' : 'text-warn'}>{bt.status?.dialer ? 'connected' : 'not set up'}</b> · DND check: <b className={bt.status?.dnc ? 'text-ok' : 'text-warn'}>{bt.status?.dnc ? 'on' : 'not set up'}</b> · IVR: <b className={bt.status?.ivr ? 'text-ok' : 'text-warn'}>{bt.status?.ivr ? 'connected' : 'not set up'}</b>{bt.error ? ` · ${bt.error}` : ''}</p>
          {!import.meta.env.DEV && <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); dialerKey.set(key); bt.check() }}>
            <Input className="flex-1" label="Dialer access key (this computer)" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} hint="From the Super Admin. Use the IVR key on the Super Admin's computer." />
            <Button type="submit">Save</Button>
          </form>}
          <p className="text-mute">Calls ring <b>your own phone</b> first (the number set for your agent in Blutec), then connect the client. Each CRM user's email must be added as an agent in Blutec.</p>
          <p className="font-semibold">To connect (done once by IT):</p>
          <ol className="list-decimal space-y-1 pl-5 text-mute">
            <li>In Blutec, make a dedicated <b>API user</b> (Company Admin, never used to sign in to the website), create a <b>long-lived API token</b> (blt_…) and — once Blutec support has enabled Click-to-Call — a <b>Click-to-Call credential</b> (key id, API key, signing secret).</li>
            <li>On this computer, add them to <code>.env.local</code> (never in a VITE_ variable): <code>BLUTEC_KEY_ID</code>, <code>BLUTEC_API_KEY</code>, <code>BLUTEC_SIGNING_SECRET</code>, <code>BLUTEC_TOKEN</code>, <code>BLUTEC_IVR_EMAIL</code>, <code>BLUTEC_IVR_PASSWORD</code> — then restart the app.</li>
            <li>For the live site, set the same values in Render → Environment, plus <code>DIALER_ACCESS_KEY</code> (staff) and <code>IVR_ACCESS_KEY</code> (Super Admin) — any long random text — then enter the key above on each computer.</li>
          </ol>
          <p className="text-xs text-mute">Until then, “Call now” opens your phone's dialler and you log the outcome by hand.</p>
        </div>
      </Modal>
    </>
  )
}

function CallsTab({ bt }: { bt: ReturnType<typeof useBlutec> }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const toast = useToast()
  const nav = useNavigate()
  const [confirm, confirmNode] = useConfirm()
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
  const [manualStart, setManualStart] = useState<number | null>(null)
  const [live, setLive] = useState<{ refId: string; status: string; info?: CallStatus } | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { if (manualStart === null) return; const i = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(i) }, [manualStart])
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); if (retry.current) clearTimeout(retry.current) }, [])
  void tick
  const manualSecs = manualStart ? Math.floor((Date.now() - manualStart) / 1000) : 0
  const ended = !!live && FINAL_STATUSES.includes(live.status)
  const secs = live?.info?.talk_duration_seconds ?? live?.info?.duration_seconds ?? manualSecs
  const suggested: CallOutcome | undefined = ended ? (isHot(live?.info?.disposition) ? 'INTERESTED' : !live?.info?.answer_time ? 'NO_ANSWER' : undefined) : undefined
  const n = salesNumbers(db, me)
  const myCallsToday = db.leads.flatMap((l) => l.calls.filter((c) => c.by === me.id && c.at.slice(0, 10) === t).map((c) => ({ ...c, lead: l }))).sort((a, b) => b.at.localeCompare(a.at))
  const reset = () => { if (poll.current) clearInterval(poll.current); if (retry.current) clearTimeout(retry.current); poll.current = null; retry.current = null; setLive(null); setManualStart(null) }
  /** The client asked not to be called: Blutec's DND list (when connected) + the lead leaves every queue. */
  const markDnd = async (l: Lead) => {
    if (!(await confirm(`Do not call ${l.name} again?`, `${bt.status?.dnc ? 'The number is added to the company’s Do-Not-Disturb list in Blutec, so no campaign or click-to-call dials it, and ' : ''}the lead is marked “Not interested” with a note.`, true))) return
    const ok = await run(async () => {
      if (bt.status?.dnc) await blutec.dncAdd(l.phone, `Asked not to be called (CRM, ${me.name})`)
      setLeadStatus(me, l.id, 'NOT_INTERESTED', 'Asked not to be called (DND)')
    }, `${l.name} won't be called again`)
    if (ok) next()
  }
  const next = () => { reset(); const i = queue.findIndex((l) => l.id === current?.id); setCurrentId(queue[(i + 1) % queue.length]?.id ?? null) }

  const dial = async (l: Lead, attempt = `${Date.now()}`, retried = false) => {
    retry.current = null
    let r: { ref_id: string; status: string }
    try { r = await blutec.clickToCall(me.email, l.phone, l.id, attempt) }
    catch (e) {
      const code = e instanceof DialerError ? e.code : undefined
      // all lines busy: try the same click once more after 15 s (same Idempotency-Key, so it can't dial twice)
      if (code === 'CHANNEL_LIMIT' && !retried) {
        toast('warning', 'All calling lines are busy — trying again in 15 seconds')
        setLive({ refId: '', status: 'waiting_for_a_free_line' })
        retry.current = setTimeout(() => dial(l, attempt, true), 15_000)
        return
      }
      setLive(null)
      toast('error', code === 'DND' ? `${l.name} is on the Do-Not-Disturb list — this number can't be called.` : e instanceof Error ? e.message : 'The call could not be placed.')
      return
    }
    toast('info', 'Your phone is ringing — answer it to connect the client')
    setLive({ refId: r.ref_id, status: r.status })
    if (poll.current) clearInterval(poll.current)
    poll.current = setInterval(async () => {
      try {
        const s = await blutec.callStatus(r.ref_id)
        setLive({ refId: r.ref_id, status: s.status, info: s })
        if (FINAL_STATUSES.includes(s.status) && poll.current) { clearInterval(poll.current); poll.current = null }
      } catch { /* keep polling; the call itself is unaffected */ }
    }, 3000)
  }
  const afterSave = async (o: CallOutcome) => {
    if ((o === 'INTERESTED' || o === 'CONVERTED') && current && can('bookings.create')) {
      if (await confirm('Hot prospect — create a CRM entry?', `${current.name}'s details will be filled in for you; you can change anything before saving.`)) { nav(`/bookings/new?lead=${current.id}`); return }
    }
    next()
  }

  return (
    <div>
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
                <button onClick={() => { setCurrentId(l.id); reset() }} className={cx('flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card2', current?.id === l.id && 'bg-brand-soft')}>
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
              <span className={cx('grid size-24 place-items-center rounded-full text-3xl font-extrabold text-white', (live && !ended) || manualStart ? 'bg-ok anim-ring' : 'bg-brand')}>{current.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <h2 className="mt-4 text-2xl font-extrabold">{current.name}</h2>
              <p className="text-mute">{current.company || 'No company'} · {current.city || current.state}</p>
              <p className="mt-2 font-mono text-xl tracking-wider">{current.phone}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Badge tone={LEAD_STATUS[current.status].tone}>{LEAD_STATUS[current.status].label}</Badge>
                {current.service && <Badge tone="navy">{current.service}</Badge>}
                {current.price != null && <Badge tone="green">{inr(current.price)}</Badge>}
                {current.followUp && <Badge tone="amber">Follow-up {fmtDate(current.followUp)}</Badge>}
              </div>
              {live && (
                <div className="mt-4 w-full rounded-2xl border border-line bg-card2 p-3 text-sm">
                  <p className="font-semibold">{ended ? 'Call ended' : live.status === 'accepted' || live.status === 'initiated' ? 'Ringing your phone…' : `Call ${live.status.replace(/_/g, ' ')}`}</p>
                  {live.info && <p className="text-xs text-mute">{live.info.talk_duration_seconds != null ? `Talk ${Math.round(live.info.talk_duration_seconds / 60 * 10) / 10} min` : ''}{live.info.disposition ? ` · ${live.info.disposition}` : ''}{live.info.hangup_cause ? ` · ${live.info.hangup_cause.replace(/_/g, ' ').toLowerCase()}` : ''}</p>}
                  {ended && isHot(live.info?.disposition) && <p className="mt-1 text-xs font-semibold text-violet-600 dark:text-violet-300">🔥 Hot prospect — save “Interested” to create the CRM entry</p>}
                </div>
              )}
              {manualStart !== null && <p className="mt-4 font-mono text-3xl font-bold text-ok">{String(Math.floor(manualSecs / 60)).padStart(2, '0')}:{String(manualSecs % 60).padStart(2, '0')}</p>}
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {bt.status?.dialer
                  ? (!live || ended ? <Button size="lg" variant="success" icon={PhoneCall} onClick={() => dial(current)}>{ended ? 'Call again' : 'Call now'}</Button> : <Button size="lg" variant="outline" icon={PhoneOff} onClick={reset}>Hide call</Button>)
                  : manualStart === null
                    ? <a href={`tel:+91${current.phone}`} onClick={() => setManualStart(Date.now())}><Button size="lg" variant="success" icon={PhoneCall}>Call now</Button></a>
                    : <Button size="lg" variant="danger" icon={PhoneOff} onClick={() => setManualStart(null)}>End call</Button>}
                <Button size="lg" variant="outline" icon={SkipForward} onClick={next}>Skip</Button>
                <Button size="lg" variant="ghost" icon={Ban} onClick={() => markDnd(current)}>Do not call</Button>
                {can('bookings.create') && <Button size="lg" variant="soft" icon={Briefcase} onClick={() => nav(`/bookings/new?lead=${current.id}`)}>Book</Button>}
              </div>
              {current.notes && <p className="mt-5 w-full whitespace-pre-line rounded-xl bg-card2 p-3 text-left text-sm">{current.notes}</p>}
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <h4 className="mb-3 font-bold">Outcome</h4>
              <CallLogger lead={current} seconds={secs} suggested={suggested} onDone={afterSave} />
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
      {confirmNode}
    </div>
  )
}

/** IVR broadcasts: live stats, start / pause / resume / stop (managers), and the people who pressed the key (hot prospects). */
function IvrTab({ bt, manage }: { bt: ReturnType<typeof useBlutec>; manage: boolean }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [confirm, confirmNode] = useConfirm()
  const [ivrs, setIvrs] = useState<Ivr[] | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [stats, setStats] = useState<IvrStats | null>(null)
  const [connects, setConnects] = useState<AgentConnect[] | null>(null)
  const [from, setFrom] = useState(ymd(addDays(new Date(), -7)))
  const [error, setError] = useState('')
  const ready = !!bt.status?.ivr

  const load = useCallback(async () => {
    setError('')
    try { const l = await blutec.ivrList(); setIvrs(l); setSel((s) => s ?? l[0]?.id ?? null) } catch (e) { setError((e as Error).message) }
    try { setConnects((await blutec.ivrConnects(from, today())).items) } catch { setConnects([]) }
  }, [from])
  useEffect(() => { if (ready) load() }, [ready, load])
  useEffect(() => {
    if (!ready || sel == null) return
    let stop = false
    const get = () => blutec.ivrStats(sel).then((s) => !stop && setStats(s), () => !stop && setStats(null))
    get()
    const i = setInterval(get, 5000)
    return () => { stop = true; clearInterval(i) }
  }, [ready, sel])

  const control = async (op: 'start' | 'pause' | 'resume' | 'stop') => {
    const ivr = ivrs?.find((x) => x.id === sel)
    if (!ivr) return
    if ((op === 'start' || op === 'stop') && !(await confirm(`${op === 'start' ? 'Start' : 'Stop'} “${ivr.name}”?`, op === 'start' ? 'This starts dialing real customers right away.' : 'The broadcast stops dialing.', op === 'stop'))) return
    if (await run(() => blutec.ivrControl(ivr.id, op), `Broadcast ${op === 'stop' ? 'stopped' : op + 'ed'}`)) load()
  }
  const leadFor = (phone: string) => db.leads.find((l) => l.phone === normPhone(phone))
  const toLead = async (c: AgentConnect, book: boolean) => {
    let lead = leadFor(c.lead_phone)
    if (!lead) {
      const ok = await run(() => createLead(me, { name: `IVR prospect ${normPhone(c.lead_phone).slice(-4)}`, company: '', phone: normPhone(c.lead_phone), email: '', city: '', state: 'Gujarat', service: '', source: 'IVR campaign', notes: `Pressed the IVR key on ${fmtDateTime(c.created_at)} · talked ${Math.round(c.talk_seconds / 60 * 10) / 10} min with ${c.agent_name}`, assignedTo: me.id }), 'Lead added')
      if (!ok) return
      lead = leadFor(c.lead_phone)
    }
    if (lead && book) nav(`/bookings/new?lead=${lead.id}`)
    else if (lead) nav(`/leads?open=${lead.id}`)
  }

  if (!ready) return <Card><EmptyState icon={Radio} title="IVR is not connected" text="Ask IT to add the Blutec IVR API account (see “IVR not connected” at the top). Then campaigns, live stats and hot prospects show here." /></Card>
  const cur = ivrs?.find((x) => x.id === sel)
  const st = stats?.broadcast_status ?? cur?.broadcast_status
  return (
    <div className="space-y-6">
      {error && <p className="rounded-xl bg-bad-soft px-4 py-2 text-sm text-bad">{error}</p>}
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="IVR campaigns" subtitle={ivrs ? `${ivrs.length} campaign(s)` : 'Loading…'} icon={Radio} action={<Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Refresh" onClick={load} />} />
          <ul className="max-h-[60vh] overflow-y-auto">
            {(ivrs ?? []).map((x) => (
              <li key={x.id}><button onClick={() => setSel(x.id)} className={cx('flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card2', sel === x.id && 'bg-brand-soft')}>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{x.name}</span>
                <Badge tone={x.broadcast_status === 'running' ? 'green' : x.broadcast_status === 'paused' ? 'amber' : 'gray'}>{x.broadcast_status}</Badge>
              </button></li>
            ))}
            {ivrs && !ivrs.length && <li className="p-5 text-sm text-mute">No IVR campaigns in Blutec yet.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title={cur?.name ?? 'Pick a campaign'} subtitle={st ? `Broadcast ${st} · updates every 5 seconds` : undefined} icon={Radio}
            action={manage && cur && <span className="flex flex-wrap gap-2">
              {st !== 'running' && st !== 'paused' && <Button size="sm" variant="success" icon={Play} onClick={() => control('start')}>Start</Button>}
              {st === 'running' && <Button size="sm" variant="outline" icon={Pause} onClick={() => control('pause')}>Pause</Button>}
              {st === 'paused' && <Button size="sm" variant="success" icon={Play} onClick={() => control('resume')}>Resume</Button>}
              {(st === 'running' || st === 'paused') && <Button size="sm" variant="danger" icon={Square} onClick={() => control('stop')}>Stop</Button>}
            </span>} />
          {stats ? (
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 xl:grid-cols-6">
              {([['Total leads', stats.total_leads], ['Dialed', stats.dialed], ['Answered', stats.answered], ['Pressed key', stats.pressed_1], ['Dialing now', stats.dialing_now], ['Remaining', stats.remaining]] as [string, number][]).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-card2 p-3"><p className="text-[11px] text-mute">{k}</p><p className="text-xl font-extrabold tabular-nums">{(v ?? 0).toLocaleString('en-IN')}</p></div>
              ))}
            </div>
          ) : <p className="p-6 text-sm text-mute">{cur ? 'Loading live stats…' : 'Choose a campaign on the left.'}</p>}
          {!manage && <p className="border-t border-line px-5 py-2 text-xs text-mute">Starting and stopping broadcasts is for team leaders and admins.</p>}
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Hot prospects from IVR" subtitle="People who pressed the key and were connected to an agent" icon={Flame}
          action={<span className="flex items-end gap-2"><Input label="Since" type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} /><Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Refresh" onClick={load} /></span>} />
        {!connects ? <p className="p-6 text-sm text-mute">Loading…</p> : !connects.length ? <EmptyState icon={Flame} title="No connects in this period" /> : (
          <Table>
            <thead><tr><Th>Phone</Th><Th>When</Th><Th>Agent</Th><Th className="text-right">Talk</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {connects.map((c) => {
                const lead = leadFor(c.lead_phone)
                return (
                  <tr key={c.id}>
                    <Td className="font-mono">{normPhone(c.lead_phone)}{lead && <span className="block font-sans text-xs text-mute">{lead.name} · {LEAD_STATUS[lead.status].label}</span>}</Td>
                    <Td className="text-xs">{fmtDateTime(c.created_at)}</Td>
                    <Td className="text-xs">{c.agent_name}</Td>
                    <Td className="text-right tabular-nums">{Math.round(c.talk_seconds / 60 * 10) / 10} min</Td>
                    <Td><Badge tone={c.status === 'connected' ? 'green' : 'gray'}>{c.status}</Badge></Td>
                    <Td className="text-right"><span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" icon={UserPlus} onClick={() => toLead(c, false)}>{lead ? 'Open lead' : 'Add lead'}</Button>
                      {can('bookings.create') && <Button size="sm" variant="soft" icon={Briefcase} onClick={() => toLead(c, true)}>CRM entry</Button>}
                    </span></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {confirmNode}
    </div>
  )
}
