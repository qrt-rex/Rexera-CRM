import type { Call, CallOutcome, DB, Lead, User } from './types'
import { OPEN_LEAD } from './workflow'
import { ymd } from './format'

/**
 * Dialer dashboard numbers for one agent and one day, worked out from the CRM call log (every dialer call is saved
 * there, by the agent or by Blutec's call-completed webhook) and the agent's day (Start my day, breaks, Logout).
 * Plain functions over the DB, so the dashboard can be changed without touching the dialer itself.
 */
export interface AgentCall extends Call { lead: Lead }

/** The agent's calls on `day`, newest first, from the leads the viewer can see. */
export function callsOn(leads: Lead[], userId: string, day: string): AgentCall[] {
  return leads.flatMap((l) => l.calls.filter((c) => c.by === userId && ymd(c.at) === day).map((c) => ({ ...c, lead: l })))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Outcomes that mean the client never came on the line. */
const NOT_CONNECTED: CallOutcome[] = ['NOT_PICKUP', 'BUSY', 'VOICE_MAIL']
/** A completed call reached the client: Blutec says completed with talk time, or (calls from the agent's own phone) the outcome says so. */
export const isCompleted = (c: Call) => (c.callStatus ? c.callStatus === 'completed' && c.durationSec > 0 : !NOT_CONNECTED.includes(c.outcome))

export function callKpis(calls: Call[]) {
  return {
    calls: calls.length,
    completed: calls.filter(isCompleted).length,
    talkSec: calls.reduce((s, c) => s + (c.durationSec || 0), 0),
    // the whole call (ringing included) when Blutec reported it, else the talk time
    totalSec: calls.reduce((s, c) => s + (c.totalSec ?? c.durationSec ?? 0), 0),
  }
}

/** Calls per outcome (disposition), most first. */
export function dispositionCounts(calls: Call[]) {
  const m = new Map<CallOutcome, number>()
  for (const c of calls) m.set(c.outcome, (m.get(c.outcome) ?? 0) + 1)
  return [...m.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count)
}

/** Pending callbacks: the agent's open leads with a follow-up date, soonest (and overdue) first. */
export const pendingCallbacks = (leads: Lead[], userId: string) => leads
  .filter((l) => l.assignedTo === userId && OPEN_LEAD.includes(l.status) && !!l.followUp)
  .sort((a, b) => a.followUp!.localeCompare(b.followUp!))

export type AgentState = 'AVAILABLE' | 'ON_CALL' | 'WRAP_UP' | 'BREAK' | 'OFFLINE'
export const AGENT_STATES: { id: AgentState; label: string; color: string }[] = [
  { id: 'AVAILABLE', label: 'Available', color: '#16a34a' },
  { id: 'ON_CALL', label: 'On Call', color: '#2563eb' },
  { id: 'WRAP_UP', label: 'Wrap Up', color: '#eab308' },
  { id: 'BREAK', label: 'Breaks / Away', color: '#f97316' },
  { id: 'OFFLINE', label: 'Offline', color: '#94a3b8' },
]
/** What the dialer on this computer knows right now (a call ringing / on, or ended and the outcome not saved yet). */
export interface LiveCall { state: 'ON_CALL' | 'WRAP_UP'; since: number }

/**
 * Time in each state today, in seconds, and the state now. From the day the agent started (Start my day) to Logout or
 * now: breaks are Breaks / Away, call time is On Call, the time to save each outcome is Wrap Up, the rest is
 * Available. Offline is the time since Logout. Before the day is started there is no Available time and the state is
 * Offline (not started); a live call is only known on the agent's own dialer (`live`).
 */
export function agentActivity(db: DB, user: User, calls: Call[], now: number, live?: LiveCall | null) {
  const day = ymd(new Date(now))
  const s = db.sessions.find((x) => x.userId === user.id && x.date === day)
  const secs = (a: number, b: number) => Math.max(0, Math.round((b - a) / 1000))
  const dur: Record<AgentState, number> = { AVAILABLE: 0, ON_CALL: 0, WRAP_UP: 0, BREAK: 0, OFFLINE: 0 }
  if (!s) return { dur, state: (live?.state ?? 'OFFLINE') as AgentState, since: live?.since, started: false }
  const start = new Date(s.loginAt).getTime()
  const end = s.logoutAt ? new Date(s.logoutAt).getTime() : now
  const breaks = s.breaks ?? []
  dur.BREAK = breaks.reduce((t, b) => t + secs(Math.max(start, new Date(b.start).getTime()), Math.min(end, b.end ? new Date(b.end).getTime() : end)), 0)
  dur.ON_CALL = calls.reduce((t, c) => t + (c.totalSec ?? c.durationSec ?? 0), 0) + (live?.state === 'ON_CALL' ? secs(live.since, now) : 0)
  dur.WRAP_UP = calls.reduce((t, c) => t + (c.wrapSec ?? 0), 0) + (live?.state === 'WRAP_UP' ? secs(live.since, now) : 0)
  dur.AVAILABLE = Math.max(0, secs(start, end) - dur.BREAK - dur.ON_CALL - dur.WRAP_UP)
  if (s.logoutAt) dur.OFFLINE = secs(end, now)
  const openBreak = breaks.find((b) => !b.end)
  const lastChange = Math.min(now, Math.max(start, ...breaks.map((b) => (b.end ? new Date(b.end).getTime() : 0)), ...calls.map((c) => new Date(c.at).getTime())))
  const state: AgentState = live?.state ?? (s.logoutAt ? 'OFFLINE' : openBreak ? 'BREAK' : 'AVAILABLE')
  const since = live?.since ?? (s.logoutAt ? end : openBreak ? new Date(openBreak.start).getTime() : lastChange)
  return { dur, state, since, started: true }
}

/** 3725 → "01:02" (hours:minutes). */
export const hhmm = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`
