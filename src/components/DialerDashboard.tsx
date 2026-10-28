import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CalendarClock, CircleCheck, Clock3, ListChecks, PhoneCall, PieChart, RefreshCcw, Timer } from 'lucide-react'
import type { Lead } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { isMaster } from '../lib/rbac'
import { leadTakers, visibleLeads } from '../lib/actions'
import { blutec, type BlutecCampaign } from '../lib/dialer'
import { CALL_OUTCOMES, LEAD_STATUS } from '../lib/workflow'
import { fmtDate, fmtTime, today } from '../lib/format'
import { AGENT_STATES, agentActivity, callKpis, callsOn, dispositionCounts, hhmm, pendingCallbacks, type LiveCall } from '../lib/callStats'
import { MiniStat } from '../pages/dashboards/widgets'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Modal, Select } from './ui'

/**
 * The dialer dashboard: today's calling numbers, outcomes, campaigns, callbacks and time in each state for one agent.
 * Sales people see their own; people who can see other people's leads (Super Admin, IT, team leaders, branch
 * directors, anyone given leads.manage / team.progress) can pick an agent whose leads they may see — the numbers are
 * worked out only from leads the viewer can see, so changing the picked agent never shows more than that.
 */
export function DialerDashboard({ live, onOpenLead }: { live?: LiveCall | null; onOpenLead?: (lead: Lead) => void }) {
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
  const t = today()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  const calls = useMemo(() => callsOn(leads, agentId, t), [leads, agentId, t])
  const k = callKpis(calls)
  const dispo = dispositionCounts(calls)
  const callbacks = useMemo(() => pendingCallbacks(leads, agentId), [leads, agentId])
  const act = agentActivity(db, agent, calls, now, self ? live : null)
  const stateDef = AGENT_STATES.find((s) => s.id === act.state)!
  // the call log is live (Supabase sends every change); this is when it last changed on this screen
  const [syncedAt, setSyncedAt] = useState(() => Date.now())
  useEffect(() => { setSyncedAt(Date.now()) }, [db])
  const [allCallbacks, setAllCallbacks] = useState(false)
  // the agent's own lead opens in the dialer; someone else's in CRM Leads (Super Admin)
  const nav = useNavigate()
  const open = self ? onOpenLead : can('leads.admin') ? (l: Lead) => nav(`/leads?open=${l.id}`) : undefined

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="grid size-12 place-items-center rounded-2xl text-white" style={{ background: stateDef.color }}><Activity className="size-6" /></span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-mute">{self ? 'Your status now' : `${agent.name} · status now`}</span>
          <span className="block text-xl font-extrabold" style={{ color: stateDef.color }}>{stateDef.label}{!act.started && act.state === 'OFFLINE' ? ' · day not started' : ''}</span>
          {act.since && <span className="block text-xs text-mute">for {hhmm(Math.max(0, Math.round((now - act.since) / 1000)))} (hh:mm) · since {fmtTime(new Date(act.since).toISOString())}</span>}
        </span>
        <span className="ml-auto flex flex-wrap items-end gap-3">
          {canPick && agents.length > 1 && (
            <Select label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="min-w-52">
              {agents.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (me)` : u.name}</option>)}
            </Select>
          )}
          <span className="text-xs text-mute">Call log updated {fmtTime(new Date(syncedAt).toISOString())}</span>
        </span>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Calls today" value={k.calls} icon={PhoneCall} tone="navy" />
        <MiniStat label="Completed" value={k.completed} icon={CircleCheck} tone="green" />
        <MiniStat label="Talk time (hh:mm)" value={hhmm(k.talkSec)} icon={Timer} tone="violet" />
        <MiniStat label="Total duration (hh:mm)" value={hhmm(k.totalSec)} icon={Clock3} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Disposition breakdown" subtitle="Today's calls by the outcome saved for them" icon={PieChart} />
          {!dispo.length ? <EmptyState icon={PieChart} title="No calls recorded today" /> : (
            <ul className="space-y-3 p-5">
              {dispo.map((d) => {
                const def = CALL_OUTCOMES.find((o) => o.id === d.outcome)
                return (
                  <li key={d.outcome}>
                    <div className="mb-1 flex items-center justify-between text-sm"><Badge tone={def?.tone ?? 'gray'}>{def?.label ?? d.outcome}</Badge><span className="font-bold tabular-nums">{d.count} <span className="text-xs font-normal text-mute">({Math.round((d.count / calls.length) * 100)}%)</span></span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-brand" style={{ width: `${(d.count / calls.length) * 100}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Today's activity" subtitle={act.started ? 'Time in each state since the day was started' : 'The day has not been started (Start my day)'} icon={Activity} />
          <ul className="divide-y divide-line/70">
            {AGENT_STATES.map((s) => (
              <li key={s.id} className={cx('flex items-center gap-3 px-5 py-3 text-sm', act.state === s.id && 'bg-card2')}>
                <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 font-semibold">{s.label}{act.state === s.id && <span className="ml-2 text-xs font-normal text-mute">now</span>}</span>
                <span className="font-mono tabular-nums">{s.id === 'OFFLINE' && !act.dur.OFFLINE ? '—' : hhmm(act.dur[s.id])}</span>
              </li>
            ))}
          </ul>
          {!self && <p className="border-t border-line px-5 py-2 text-xs text-mute">A call in progress shows only on the agent's own dialer; finished calls count here.</p>}
        </Card>

        <CampaignsPanel agentId={agentId} self={self} master={master} />

        <Card className="overflow-hidden">
          <CardHeader title="Upcoming callbacks" subtitle={`${callbacks.length} pending · follow-up dates on open leads`} icon={CalendarClock}
            action={callbacks.length > 0 && <Button size="sm" variant="ghost" onClick={() => setAllCallbacks(true)}>View all</Button>} />
          {!callbacks.length ? <EmptyState icon={CalendarClock} title="No pending callbacks" /> : <CallbackList leads={callbacks.slice(0, 5)} onOpen={open} />}
        </Card>
      </div>

      <Modal open={allCallbacks} onClose={() => setAllCallbacks(false)} size="lg" title="All pending callbacks" subtitle={`${callbacks.length} · ${self ? 'yours' : agent.name}`}>
        <CallbackList leads={callbacks} onOpen={open && ((l) => { setAllCallbacks(false); open(l) })} />
      </Modal>
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
            <span className="block truncate text-xs text-mute">{l.phone} · {LEAD_STATUS[l.status].label}{l.service ? ` · ${l.service}` : ''}</span>
          </span>
          <Badge tone={l.followUp! < t ? 'red' : l.followUp === t ? 'amber' : 'blue'}>{l.followUp! < t ? 'Overdue · ' : ''}{fmtDate(l.followUp)}</Badge>
          {onOpen && <Button size="sm" variant="ghost" onClick={() => onOpen(l)}>Open</Button>}
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
    <Card className="overflow-hidden">
      <CardHeader title={self ? 'Your campaigns' : 'Campaigns'} icon={ListChecks}
        subtitle={state.at ? `Blutec · updated ${fmtTime(new Date(state.at).toISOString())}` : state.loading ? 'Loading from Blutec…' : undefined}
        action={(self || master) && <Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Refresh campaigns" onClick={load} loading={state.loading} />} />
      {state.error && <p className="border-b border-line bg-bad-soft px-5 py-2 text-xs text-bad">Could not refresh from Blutec: {state.error}</p>}
      {!self && !master ? <p className="p-5 text-sm text-mute">{ids.length ? `${ids.length} campaign(s) assigned.` : 'No campaigns assigned.'} Campaign details are shown to the agent and the Super Admin.</p>
        : !rows.length ? <EmptyState icon={ListChecks} title={state.loading && !state.rows ? 'Loading…' : 'No campaigns assigned'} />
          : (
            <ul className="divide-y divide-line/70">
              {rows.map((c) => {
                const r = c as unknown as Record<string, unknown>
                const total = Number(r.total_leads), fresh = Number(r.fresh_leads)
                const used = Number.isFinite(Number(r.used_leads)) && r.used_leads != null ? Number(r.used_leads) : total - fresh
                const progress = r.total_leads != null && Number.isFinite(total) && total > 0 && Number.isFinite(used) ? Math.min(100, Math.round((used / total) * 100)) : null
                return (
                  <li key={c.id} className="px-5 py-3">
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
    </Card>
  )
}
