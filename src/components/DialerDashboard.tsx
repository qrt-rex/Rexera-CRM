import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronDown, CircleCheck, CircleDashed, Clock3, Coffee, Download, Info, LogIn, LogOut, PhoneCall, PhoneOutgoing, PlayCircle, Radio, RefreshCcw, TrendingUp, type LucideIcon } from 'lucide-react'
import type { Lead } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { isMaster, seesMaskedPhones } from '../lib/rbac'
import { endDay, leadTakers, pauseDay, resumeDay, startDay, visibleLeads } from '../lib/actions'
import { blutec, type BlutecCampaign, type CallStatus } from '../lib/dialer'
import { CALL_OUTCOMES, LEAD_STATUS, type Tone } from '../lib/workflow'
import { fmtDate, fmtDateTime, fmtTime, maskPhone, normPhone, today, ymd } from '../lib/format'
import { AGENT_STATES, agentActivity, callKpis, callsBy, callsOn, callType, dispositionCounts, hms, isCompleted, pendingCallbacks, type AgentCall, type LiveCall } from '../lib/callStats'
import { MultiFilter } from './MultiFilter'
import { Badge, Button, Card, cx, Input, Menu, MenuItem, Modal, SearchBox, Select, Table, Td, Th, useConfirm, usePaged, useRun } from './ui'

/**
 * The dialer screens for one agent: Dashboard (today's numbers, outcomes, campaigns, callbacks, time in each state),
 * Call history and Callbacks. Sales people see their own; people who can see other people's leads (Super Admin, IT,
 * team leaders, branch directors, anyone given leads.manage / team.progress) can pick an agent whose leads they may
 * see — the numbers are worked out only from leads the viewer can see, so changing the picked agent never shows more.
 */
export function useAgentPick() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const master = isMaster(me)
  const canPick = master || can('leads.manage', 'team.progress')
  const visible = useMemo(() => visibleLeads(db, me), [db, me])
  const agents = useMemo(() => !canPick ? [] : leadTakers(db).filter((u) => u.id === me.id || master || can('leads.manage') || u.teamLeadId === me.id || visible.some((l) => l.assignedTo === u.id)),
    [db, me, canPick, master, can, visible])
  const [agentId, setAgentId] = useState(me.id)
  const self = agentId === me.id
  const agent = db.users.find((u) => u.id === agentId) ?? me
  // the agent's own calls come from every lead loaded for them; someone else's only from leads the viewer can see
  const leads = self ? db.leads : visible
  const picker = canPick && agents.length > 1 ? (
    <Select aria-label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="min-w-52">
      {agents.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (me)` : u.name}</option>)}
    </Select>
  ) : null
  return { agentId, agent, self, master, leads, picker }
}
export type AgentPick = ReturnType<typeof useAgentPick>

const useNow = () => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  return now
}
const TONE_HEX: Record<Tone, string> = {
  navy: '#2E3A8C', orange: '#f47b20', green: '#16a34a', red: '#dc2626', amber: '#d97706', blue: '#2563eb', violet: '#7c3aed', gray: '#94a3b8', cyan: '#0891b2', pink: '#db2777',
}
const outcomeOf = (id: string) => CALL_OUTCOMES.find((o) => o.id === id)

/** A screen title: big heading, one line under it, actions on the right. */
export function DialerTitle({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3 anim-fade-up">
      <div className="min-w-[12rem] flex-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-mute">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}
function Panel({ title, icon: Icon, action, className, children }: { title: string; icon?: LucideIcon; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={cx('flex flex-col overflow-hidden', className)}>
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        {Icon && <Icon className="size-4 text-mute" />}
        <h3 className="flex-1 text-[15px] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  )
}
const Quiet = ({ children }: { children: ReactNode }) => <p className="flex flex-1 items-center justify-center px-5 py-8 text-center text-sm text-mute">{children}</p>
function Kpi({ label, value, icon: Icon, color }: { label: string; value: ReactNode; icon: LucideIcon; color: string }) {
  return (
    <Card className="flex items-start justify-between gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
      <span className="min-w-0">
        <span className="block text-xs text-mute">{label}</span>
        <span className="mt-2 block text-2xl font-extrabold tabular-nums">{value}</span>
      </span>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: color }}><Icon className="size-5" /></span>
    </Card>
  )
}

// ------------------------------------------------------------------ status (top of the dialer)
/**
 * The agent's state now, with the switch beside it: Start my day → Available; Break / Away pauses the day (within
 * the lunch-break rules); Log out for the day ends it. On Call / Wrap Up come from the call on this computer.
 */
export function AgentStatusMenu({ live }: { live?: LiveCall | null }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const now = useNow()
  const t = ymd(new Date(now))
  const act = agentActivity(db, me, useMemo(() => callsOn(db.leads, me.id, t), [db.leads, me.id, t]), now, live)
  const def = AGENT_STATES.find((s) => s.id === act.state)!
  const loggedOut = !!db.sessions.find((s) => s.userId === me.id && s.date === t)?.logoutAt
  const label = !act.started && act.state === 'OFFLINE' ? 'Offline · start your day' : def.label
  return (
    <>
      <Menu width="w-60" trigger={(open) => (
        <button className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition" style={{ background: `${def.color}1f`, color: def.color }} aria-expanded={open}>
          <span className="size-2 rounded-full" style={{ background: def.color }} />{label}<ChevronDown className="size-4" />
        </button>
      )}>
        {(close) => (
          <div className="py-1">
            <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-mute">My status</p>
            {(!act.started || loggedOut) && <MenuItem icon={LogIn} onClick={() => { close(); run(() => startDay(me), 'Your day has started') }}>{loggedOut ? 'Start again' : 'Start my day'} · Available</MenuItem>}
            {act.started && act.state === 'BREAK' && <MenuItem icon={PlayCircle} onClick={() => { close(); run(() => resumeDay(me), 'Back — you are available') }}>Available</MenuItem>}
            {act.started && !loggedOut && act.state !== 'BREAK' && <MenuItem icon={Coffee} onClick={() => { close(); run(() => pauseDay(me), 'On a break') }}>Break / Away</MenuItem>}
            {act.started && !loggedOut && <MenuItem icon={LogOut} danger onClick={async () => { close(); if (await confirm('Log out for the day?', 'Your day ends now. You can start again tomorrow (or ask HR / IT to re-open it).', true)) run(() => endDay(me), 'Logged out for the day') }}>Log out for the day</MenuItem>}
            {act.since && <p className="border-t border-line px-4 py-2 text-xs text-mute">{def.label} for <span className="font-mono">{hms(Math.max(0, Math.round((now - act.since) / 1000)))}</span></p>}
          </div>
        )}
      </Menu>
      {confirmNode}
    </>
  )
}

// ------------------------------------------------------------------ dashboard
export function DialerDashboard({ pick, live, onStart, onCallbacks, onOpenLead }: {
  pick: AgentPick; live?: LiveCall | null; onStart?: () => void; onCallbacks?: () => void; onOpenLead?: (lead: Lead) => void
}) {
  const db = useDb()
  const { can } = useAuth()
  const nav = useNavigate()
  const { agentId, agent, self, master, leads, picker } = pick
  const t = today()
  const now = useNow()
  const calls = useMemo(() => callsOn(leads, agentId, t), [leads, agentId, t])
  const k = callKpis(calls)
  const callbacks = useMemo(() => pendingCallbacks(leads, agentId), [leads, agentId])
  const act = agentActivity(db, agent, calls, now, self ? live : null)
  // the agent's own lead opens in the dialer; someone else's in CRM Leads (Super Admin)
  const open = self ? onOpenLead : can('leads.admin') ? (l: Lead) => nav(`/leads?open=${l.id}`) : undefined

  return (
    <div className="space-y-5">
      <DialerTitle title={self ? `Welcome back, ${agent.name.split(' ')[0]}!` : `${agent.name} · dialer`}
        subtitle={self ? 'Here’s your performance summary for today' : 'Their performance summary for today'}
        right={<>{picker}{self && onStart && <Button variant="accent" size="lg" icon={PlayCircle} onClick={onStart}>Start Dialing</Button>}</>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="Calls Today" value={k.calls} icon={PhoneCall} color="#3b82f6" />
        <Kpi label="Completed" value={k.completed} icon={CircleCheck} color="#10b981" />
        <Kpi label="Talk Time" value={hms(k.talkSec)} icon={Clock3} color="#a855f7" />
        <Kpi label="Total Duration" value={hms(k.totalSec)} icon={TrendingUp} color="#f59e0b" />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Disposition Breakdown" className="min-h-72 xl:col-span-2">
          {!calls.length ? <Quiet>No calls yet today</Quiet> : <Dispositions calls={calls} />}
        </Panel>
        <div className="flex flex-col gap-5">
          <CampaignsPanel agentId={agentId} self={self} master={master} />
          <Panel title="Upcoming Callbacks" className="flex-1"
            action={onCallbacks && <button onClick={onCallbacks} className="text-xs font-medium text-mute hover:text-ink">View all</button>}>
            {!callbacks.length ? <Quiet>No pending callbacks</Quiet> : <CallbackList leads={callbacks.slice(0, 4)} onOpen={open} />}
          </Panel>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
          <Radio className="size-4 text-mute" />
          <h3 className="flex-1 text-[15px] font-bold">Today’s Activity</h3>
          <StatePill act={act} now={now} />
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-5">
          {AGENT_STATES.map((s) => (
            <div key={s.id} className={cx('rounded-xl p-4 transition', act.state === s.id && 'ring-2')} style={{ background: `${s.color}1c`, color: s.color, ['--tw-ring-color' as string]: `${s.color}66` }}>
              <p className="font-mono text-lg font-bold tabular-nums">{s.id === 'BREAK' ? `${act.breaks}x · ` : ''}{hms(act.dur[s.id])}</p>
              <p className="mt-1 text-xs font-medium">{s.label}</p>
            </div>
          ))}
        </div>
        {!act.started && <p className="border-t border-line px-5 py-2 text-xs text-mute">{self ? 'Your day has not started — choose Start my day in the status menu at the top.' : 'Their day has not started yet.'}</p>}
        {act.started && !self && <p className="border-t border-line px-5 py-2 text-xs text-mute">A call in progress shows only on the agent's own dialer; finished calls count here.</p>}
      </Card>
    </div>
  )
}

function StatePill({ act, now }: { act: ReturnType<typeof agentActivity>; now: number }) {
  const def = AGENT_STATES.find((s) => s.id === act.state)!
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${def.color}1c`, color: def.color }}>
      <span className="size-2 rounded-full" style={{ background: def.color }} />{def.label}
      {act.since && <span className="font-mono font-medium opacity-80">{hms(Math.max(0, Math.round((now - act.since) / 1000)))}</span>}
    </span>
  )
}

/** Today's calls by outcome: a ring and the list beside it, most first. */
function Dispositions({ calls }: { calls: AgentCall[] }) {
  const rows = dispositionCounts(calls).map((d) => ({ ...d, def: outcomeOf(d.outcome) }))
  const total = calls.length
  const R = 54, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex flex-1 flex-wrap items-center justify-center gap-8 px-5 pb-6 pt-2">
      <svg viewBox="0 0 140 140" className="size-44 shrink-0 -rotate-90" role="img" aria-label="Calls by outcome">
        <circle cx="70" cy="70" r={R} fill="none" className="stroke-card2" strokeWidth="16" />
        {rows.map((d) => {
          const len = (d.count / total) * C
          const seg = <circle key={d.outcome} cx="70" cy="70" r={R} fill="none" stroke={TONE_HEX[d.def?.tone ?? 'gray']} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          offset += len
          return seg
        })}
        <text x="70" y="66" textAnchor="middle" className="fill-current text-[26px] font-extrabold" transform="rotate(90 70 70)">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="fill-current text-[10px] opacity-60" transform="rotate(90 70 70)">calls</text>
      </svg>
      <ul className="min-w-56 flex-1 space-y-2.5">
        {rows.map((d) => (
          <li key={d.outcome} className="flex items-center gap-3 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: TONE_HEX[d.def?.tone ?? 'gray'] }} />
            <span className="flex-1 truncate">{d.def?.label ?? d.outcome}</span>
            <b className="tabular-nums">{d.count}</b>
            <span className="w-10 text-right text-xs tabular-nums text-mute">{Math.round((d.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CallbackList({ leads, onOpen }: { leads: Lead[]; onOpen?: (l: Lead) => void }) {
  const t = today()
  return (
    <ul className="divide-y divide-line/70">
      {leads.map((l) => (
        <li key={l.id} className="flex items-center gap-3 px-5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{l.name}{l.company ? ` · ${l.company}` : ''}</span>
            <span className="block truncate text-xs text-mute">{maskPhone(l.phone)} · {LEAD_STATUS[l.status].label}{l.service ? ` · ${l.service}` : ''}</span>
          </span>
          <Badge tone={l.followUp! < t ? 'red' : l.followUp === t ? 'amber' : 'blue'}>{l.followUp! < t ? 'Overdue · ' : l.followUp === t ? 'Today · ' : ''}{fmtDate(l.followUp)}</Badge>
          {onOpen && <Button size="sm" variant="ghost" icon={PhoneCall} onClick={() => onOpen(l)}>Call</Button>}
        </li>
      ))}
    </ul>
  )
}

/**
 * The Blutec dialer campaigns given to the agent (Super Admin sets them under Dialer campaigns). The server only ever
 * sends a sales person their own; the Super Admin / IT can look at anyone's. Progress shows only when Blutec sends
 * the lead counts.
 */
function CampaignsPanel({ agentId, self, master }: { agentId: string; self: boolean; master: boolean }) {
  const db = useDb()
  const ids = useMemo(() => Object.entries(db.settings.dialerCampaigns ?? {}).filter(([, users]) => users.includes(agentId)).map(([id]) => Number(id)), [db.settings.dialerCampaigns, agentId])
  const key = ids.join(',')
  const [state, setState] = useState<{ loading: boolean; rows?: BlutecCampaign[]; error?: string; at?: number }>({ loading: true })
  const load = useCallback(() => {
    // nothing assigned: nothing to ask Blutec for
    if ((!self && !master) || !key) { setState({ loading: false, rows: [], at: undefined }); return }
    setState((s) => ({ ...s, loading: true }))
    const req = self ? blutec.myCampaigns(key.split(',').map(Number)) : blutec.campaigns().then((all) => all.filter((c) => key.split(',').map(Number).includes(Number(c.id))))
    // a failed refresh keeps the last list on screen, with the error
    req.then((rows) => setState({ loading: false, rows, at: Date.now() }), (e: Error) => setState((s) => ({ ...s, loading: false, error: e.message })))
  }, [self, master, key])
  useEffect(() => {
    load()
    const i = setInterval(load, 60_000) // Blutec rate limits: once a minute is plenty for campaign counts
    return () => clearInterval(i)
  }, [load])
  const rows = state.rows ?? []
  return (
    <Panel title={self ? 'Your Campaigns' : 'Campaigns'}
      action={(self || master) && key && <button onClick={load} disabled={state.loading} aria-label="Refresh campaigns" title={state.at ? `Updated ${fmtTime(new Date(state.at).toISOString())}` : 'Refresh'} className="grid size-7 place-items-center rounded-lg text-mute hover:bg-card2 hover:text-ink">
        {state.loading ? <CircleDashed className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
      </button>}>
      {state.error && <p className="mx-5 mb-2 rounded-lg bg-bad-soft px-3 py-1.5 text-xs text-bad">Could not refresh from Blutec: {state.error}</p>}
      {!self && !master ? <Quiet>{ids.length ? `${ids.length} campaign(s) assigned` : 'No campaigns assigned'}</Quiet>
        : !rows.length ? <Quiet>{state.loading && !state.rows ? 'Loading…' : 'No campaigns assigned'}</Quiet>
          : (
            <ul className="divide-y divide-line/70 pb-2">
              {rows.map((c) => {
                const r = c as unknown as Record<string, unknown>
                const total = Number(r.total_leads), fresh = Number(r.fresh_leads)
                const used = Number.isFinite(Number(r.used_leads)) && r.used_leads != null ? Number(r.used_leads) : total - fresh
                const progress = r.total_leads != null && Number.isFinite(total) && total > 0 && Number.isFinite(used) ? Math.min(100, Math.round((used / total) * 100)) : null
                return (
                  <li key={c.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-2"><span className="flex-1 truncate text-sm font-semibold">{c.name}</span>{c.status && <Badge tone={c.status === 'active' ? 'green' : 'gray'}>{c.status}</Badge>}</div>
                    {progress != null && (
                      <div className="mt-2">
                        <div className="mb-1 flex justify-between text-[11px] text-mute"><span>{used.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} leads used</span><span>{progress}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-ok" style={{ width: `${progress}%` }} /></div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
    </Panel>
  )
}

// ------------------------------------------------------------------ callbacks
export function CallbacksView({ pick, onOpenLead }: { pick: AgentPick; onOpenLead?: (lead: Lead) => void }) {
  const { can } = useAuth()
  const nav = useNavigate()
  const { agentId, self, leads, picker } = pick
  const t = today()
  const [view, setView] = useState<'all' | 'due' | 'upcoming'>('all')
  const all = useMemo(() => pendingCallbacks(leads, agentId), [leads, agentId])
  const due = all.filter((l) => l.followUp! <= t)
  const upcoming = all.filter((l) => l.followUp! > t)
  const list = view === 'due' ? due : view === 'upcoming' ? upcoming : all
  const open = self ? onOpenLead : can('leads.admin') ? (l: Lead) => nav(`/leads?open=${l.id}`) : undefined
  const { slice, pager } = usePaged(list, 25, [view, agentId])
  const views = [{ id: 'all', label: 'All' }, { id: 'due', label: 'Due Now' }, { id: 'upcoming', label: 'Upcoming' }] as const
  return (
    <div className="space-y-5">
      <DialerTitle title="All Callbacks" subtitle={`${self ? 'All your' : 'All their'} scheduled callback leads (past, present, and future)`}
        right={<>{picker}
          <span className="flex gap-1.5">
            {views.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)} className={cx('h-9 rounded-xl px-4 text-sm font-semibold transition', view === v.id ? 'bg-brand text-white shadow-sm' : 'bg-accent-soft text-accent hover:brightness-95')}>{v.label}</button>
            ))}
          </span>
        </>} />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {([['Total', all.length, ''], ['Due Now', due.length, 'text-bad'], ['Upcoming', upcoming.length, 'text-ok']] as const).map(([label, n, cls]) => (
          <Card key={label} className="p-4"><span className="block text-xs text-mute">{label}</span><span className={cx('mt-1 block text-2xl font-extrabold tabular-nums', cls)}>{n}</span></Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        {!list.length ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <CalendarDays className="size-12 text-mute/70" strokeWidth={1.5} />
            <h4 className="mt-4 font-bold">No callbacks</h4>
            <p className="mt-1 text-sm text-mute">{view === 'due' ? 'Nothing is due right now' : view === 'upcoming' ? 'Nothing scheduled ahead' : self ? 'You have no scheduled callbacks' : 'No scheduled callbacks'}</p>
          </div>
        ) : (
          <>
            <Table>
              <thead><tr><Th>Callback</Th><Th>Lead</Th><Th>Phone</Th><Th>Status</Th><Th>Service</Th><Th>Last call</Th><Th className="text-right" /></tr></thead>
              <tbody>
                {slice.map((l) => {
                  const last = l.calls.filter((c) => c.by === agentId).sort((a, b) => b.at.localeCompare(a.at))[0]
                  return (
                    <tr key={l.id} className="hover:bg-card2/50">
                      <Td><Badge tone={l.followUp! < t ? 'red' : l.followUp === t ? 'amber' : 'blue'}>{l.followUp! < t ? 'Overdue · ' : l.followUp === t ? 'Today · ' : ''}{fmtDate(l.followUp)}</Badge></Td>
                      <Td><b className="block text-sm">{l.name}</b><span className="text-xs text-mute">{[l.code, l.company].filter(Boolean).join(' · ')}</span></Td>
                      <Td className="font-mono text-xs">{maskPhone(l.phone)}</Td>
                      <Td><Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge></Td>
                      <Td className="text-xs">{l.service || '—'}</Td>
                      <Td className="text-xs text-mute">{last ? `${fmtDateTime(last.at)} · ${outcomeOf(last.outcome)?.label ?? last.outcome}` : '—'}</Td>
                      <Td className="text-right">{open && <Button size="sm" variant="soft" icon={PhoneCall} onClick={() => open(l)}>{self ? 'Call' : 'Open'}</Button>}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {pager}
          </>
        )}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ call history
const pretty = (s: string) => s.replace(/_/g, ' ')
const ANY = ''
export function CallHistory({ pick, onOpenLead }: { pick: AgentPick; onOpenLead?: (lead: Lead) => void }) {
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const { agentId, self, leads, picker } = pick
  const masked = seesMaskedPhones(me)
  const all = useMemo(() => callsBy(leads, agentId), [leads, agentId])
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [campaign, setCampaign] = useState(ANY)
  const [type, setType] = useState(ANY)
  const [status, setStatus] = useState(ANY)
  const [dispo, setDispo] = useState<string[]>([])
  const [info, setInfo] = useState<AgentCall | null>(null)
  const campaigns = useMemo(() => [...new Set(all.map((c) => c.lead.source).filter(Boolean))].sort(), [all])
  const base = useMemo(() => {
    const s = q.trim().toLowerCase(), digits = s.replace(/\D/g, '')
    return all.filter((c) => {
      const day = ymd(c.at)
      if (from && day < from) return false
      if (to && day > to) return false
      if (campaign && c.lead.source !== campaign) return false
      if (type && callType(c) !== type) return false
      if (status && (isCompleted(c) ? 'done' : 'missed') !== status) return false
      // a masked number is searched by its last digits only
      if (s && !(digits.length >= 2 && (masked ? normPhone(c.lead.phone).endsWith(digits) : normPhone(c.lead.phone).includes(digits))) && !`${c.lead.name} ${c.lead.code}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [all, q, from, to, campaign, type, status, masked])
  const rows = dispo.length ? base.filter((c) => dispo.includes(c.outcome)) : base
  const dispoOptions = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of base) m.set(c.outcome, (m.get(c.outcome) ?? 0) + 1)
    return [...m.entries()].map(([value, count]) => ({ value, label: outcomeOf(value)?.label ?? value, count, color: TONE_HEX[outcomeOf(value)?.tone ?? 'gray'] }))
  }, [base])
  const { slice, pager } = usePaged(rows, 25, [q, from, to, campaign, type, status, dispo, agentId])
  const open = self ? onOpenLead : can('leads.admin') ? (l: Lead) => nav(`/leads?open=${l.id}`) : undefined
  const phoneOf = (p: string) => (masked ? maskPhone(p) : normPhone(p) || p)
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Date', 'Time', 'Direction', 'Type', 'Phone', 'Lead', 'Campaign / source', 'Duration', 'Talk', 'Status', 'Disposition', 'Note'].map(esc).join(',')]
    for (const c of rows) lines.push([fmtDate(c.at), fmtTime(c.at), 'Outgoing', callType(c), phoneOf(c.lead.phone), c.lead.name, c.lead.source, hms(c.totalSec ?? c.durationSec), hms(c.durationSec), isCompleted(c) ? 'Completed' : 'Not connected', outcomeOf(c.outcome)?.label ?? c.outcome, c.note].map(esc).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv' }))
    a.download = `call-history-${today()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const filtered = !!(q || from || to || campaign || type || status || dispo.length)

  return (
    <div className="space-y-5">
      <DialerTitle title="Call History" subtitle={`${self ? 'Your' : 'Their'} complete call records (${all.length.toLocaleString('en-IN')} calls)`}
        right={<>{picker}<Button variant="outline" icon={Download} onClick={exportCsv} disabled={!rows.length} aria-label="Export to Excel (CSV)" title="Export to Excel (CSV)" /></>} />
      <Card className="space-y-4 p-4 sm:p-5">
        <SearchBox value={q} onChange={setQ} placeholder={masked ? 'Search by name, lead code or the last digits of the number…' : 'Search by phone number, name or lead code…'} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <Input label="Date From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Date To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          <Select label="Campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value={ANY}>All Campaigns</option>
            {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Direction" value="out" onChange={() => {}} title="Calls from the CRM are outgoing">
            <option value="out">Outgoing</option>
          </Select>
          <Select label="Call Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value={ANY}>All Types</option><option>Click-to-call</option><option>Own phone</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value={ANY}>All Status</option><option value="done">Completed</option><option value="missed">Not connected</option>
          </Select>
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-mute">Disposition</span>
            <MultiFilter label={dispo.length ? 'Disposition' : 'All dispositions'} options={dispoOptions} value={dispo} onChange={setDispo} />
          </div>
        </div>
        {filtered && <p className="flex flex-wrap items-center gap-2 text-xs text-mute">{rows.length.toLocaleString('en-IN')} of {all.length.toLocaleString('en-IN')} calls match<button onClick={() => { setQ(''); setFrom(''); setTo(''); setCampaign(ANY); setType(ANY); setStatus(ANY); setDispo([]) }} className="font-semibold text-brand-ink hover:underline">Clear filters</button></p>}
      </Card>

      <Card className="overflow-hidden">
        {!rows.length ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <PhoneCall className="size-12 text-mute/70" strokeWidth={1.5} />
            <h4 className="mt-4 font-bold">{all.length ? 'No calls match' : 'No calls yet'}</h4>
            <p className="mt-1 text-sm text-mute">{all.length ? 'Change or clear the filters.' : 'Calls made from the dialer show here.'}</p>
          </div>
        ) : (
          <>
            <Table className="[&_table]:min-w-[1080px]">
              <thead><tr><Th>Date &amp; time</Th><Th>Dir</Th><Th>Type</Th><Th>Phone</Th><Th>Lead</Th><Th>Campaign</Th><Th>Duration</Th><Th>Status</Th><Th>Disposition</Th><Th className="text-right">Details</Th></tr></thead>
              <tbody>
                {slice.map((c) => {
                  const done = isCompleted(c), o = outcomeOf(c.outcome)
                  return (
                    <tr key={`${c.lead.id}-${c.id}`} className="hover:bg-card2/50">
                      <Td><b className="block whitespace-nowrap text-[13px]">{fmtDate(c.at)}</b><span className="whitespace-nowrap text-xs text-mute">{fmtTime(c.at)}</span></Td>
                      <Td><span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok"><PhoneOutgoing className="size-3" />Out</span></Td>
                      <Td><Badge tone={callType(c) === 'Click-to-call' ? 'blue' : 'gray'}>{callType(c)}</Badge></Td>
                      <Td className="whitespace-nowrap font-mono text-xs">{phoneOf(c.lead.phone)}</Td>
                      <Td>{open ? <button onClick={() => open(c.lead)} className="text-left text-[13px] font-semibold hover:text-brand-ink hover:underline">{c.lead.name}</button> : <b className="text-[13px]">{c.lead.name}</b>}</Td>
                      <Td className="max-w-40 text-xs"><span className="block truncate" title={c.lead.source}>{c.lead.source || '—'}</span></Td>
                      <Td><span className="block font-mono text-[13px] font-semibold tabular-nums">{hms(c.totalSec ?? c.durationSec)}</span><span className="text-[11px] text-mute">Talk: {hms(c.durationSec)}</span></Td>
                      <Td><Badge tone={done ? 'green' : 'red'}>{done ? 'Completed' : 'Not connected'}</Badge><span className="mt-0.5 block text-[11px] capitalize text-mute">{c.callStatus && c.callStatus !== 'completed' ? pretty(c.callStatus) : 'Call ended'}</span></Td>
                      <Td>{o ? <Badge tone={o.tone}>{o.label}</Badge> : <span className="text-mute">—</span>}</Td>
                      <Td className="text-right"><button onClick={() => setInfo(c)} aria-label="Call details" className="grid size-8 place-items-center rounded-full text-mute hover:bg-card2 hover:text-ink"><Info className="size-4" /></button></Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {pager}
          </>
        )}
      </Card>
      <CallInfo call={info} phone={info ? phoneOf(info.lead.phone) : ''} onClose={() => setInfo(null)} />
    </div>
  )
}

/** One call's details; a Blutec call can be looked up live (final status, hang-up cause, Blutec's disposition, recording). */
function CallInfo({ call, phone, onClose }: { call: AgentCall | null; phone: string; onClose: () => void }) {
  const [live, setLive] = useState<{ loading: boolean; data?: CallStatus; error?: string } | null>(null)
  useEffect(() => { setLive(null) }, [call?.id])
  const ref = call?.id.startsWith('bt-') ? call.id.slice(3) : ''
  const check = () => { setLive({ loading: true }); blutec.callStatus(ref).then((data) => setLive({ loading: false, data }), (e: Error) => setLive({ loading: false, error: e.message })) }
  const o = call ? outcomeOf(call.outcome) : undefined
  const row = (k: string, v: ReactNode) => <div className="flex justify-between gap-4 border-b border-line/60 py-2 last:border-0"><span className="text-mute">{k}</span><span className="text-right font-medium">{v}</span></div>
  return (
    <Modal open={!!call} onClose={onClose} title={call ? call.lead.name : ''} subtitle={call ? `${fmtDateTime(call.at)} · ${phone}` : ''}
      footer={<>{ref && <Button variant="outline" icon={RefreshCcw} loading={live?.loading} onClick={check}>Check with Blutec</Button>}<Button onClick={onClose}>Close</Button></>}>
      {call && (
        <div className="text-sm">
          {row('Direction', 'Outgoing')}
          {row('Type', callType(call))}
          {row('Campaign / source', call.lead.source || '—')}
          {row('Duration', <span className="font-mono">{hms(call.totalSec ?? call.durationSec)}</span>)}
          {row('Talk time', <span className="font-mono">{hms(call.durationSec)}</span>)}
          {call.wrapSec != null && row('Wrap-up', <span className="font-mono">{hms(call.wrapSec)}</span>)}
          {row('Status', isCompleted(call) ? 'Completed' : 'Not connected')}
          {row('Disposition', o ? <Badge tone={o.tone}>{o.label}</Badge> : '—')}
          {call.note && row('Note', <span className="whitespace-pre-line">{call.note}</span>)}
          {ref && row('Blutec reference', <span className="font-mono text-xs">{ref}</span>)}
          {live?.error && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{live.error}</p>}
          {live?.data && (
            <div className="mt-3 rounded-xl bg-card2 px-3 py-1">
              {row('Blutec status', pretty(live.data.status))}
              {live.data.hangup_cause && row('Hang-up', pretty(live.data.hangup_cause).toLowerCase())}
              {live.data.disposition && row('Blutec disposition', live.data.disposition)}
              {row('Recording', live.data.recording_status ? pretty(live.data.recording_status) : 'none reported')}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
