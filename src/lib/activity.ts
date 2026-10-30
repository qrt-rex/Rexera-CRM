import type { User } from './types'
import { rolesOf } from './rbac'
import { CLOUD } from './cloud'
import { getSupabase } from './supabase'
import { uid } from './format'

/**
 * User activity log — every page opened, click, choice, form submit and action result of every person, for the IT
 * Support team only (IT dashboard → User activity; Super Admin cannot read it — the database allows IT alone).
 *
 * Only what was clicked is kept (the button / link / tab text, where it was, the page) — never what anyone typed:
 * text boxes and password fields are never read. Events are sent in small batches (every few seconds), so clicking
 * never waits for the network. With Supabase they go to the activity_log table; in browser mode they stay in this
 * browser (the newest 3000).
 */
export type ActivityKind = 'page' | 'click' | 'change' | 'submit' | 'action' | 'error'
export interface ActivityEvent {
  id: string; at: string; userId: string; role: string; kind: ActivityKind
  /** what was clicked / opened / done */
  label: string
  /** page (path) and the window / section it happened in */
  path: string; area?: string
  detail?: string
  /** an action's result */
  ok?: boolean
}
export const ACTIVITY_KINDS: { id: ActivityKind; label: string }[] = [
  { id: 'page', label: 'Opened a page' }, { id: 'click', label: 'Clicked' }, { id: 'change', label: 'Chose' }, { id: 'submit', label: 'Submitted a form' },
  { id: 'action', label: 'Action result' }, { id: 'error', label: 'Screen error' },
]
/** Only the IT Support team reads the activity log (not Super Admin). */
export const canReadActivity = (u: User) => rolesOf(u).includes('it')

const LOCAL_KEY = 'rexera-activity'
const LOCAL_MAX = 3000
let me: { id: string; role: string } | null = null
let queue: ActivityEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let last: { key: string; t: number } | null = null
let lastLabel = ''
const clip = (s: string | undefined | null, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** Records one event for the signed-in person (ignored when nobody is signed in). */
export function track(kind: ActivityKind, label: string, extra: { area?: string; detail?: string; ok?: boolean; path?: string } = {}) {
  if (!me || !label) return
  // the page it happened on (a page view passes its own: a redirect may already have moved on)
  const path = (extra.path ?? (typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '')).slice(0, 300)
  // the same thing twice within a second (double click, re-render) is one event
  const key = `${kind}|${label}|${path}|${extra.ok}`
  const t = Date.now()
  if (last && last.key === key && t - last.t < 1000) return
  last = { key, t }
  if (kind === 'click') lastLabel = label
  queue.push({ id: uid('act-'), at: new Date(t).toISOString(), userId: me.id, role: me.role, kind, label: clip(label, 200), path, area: clip(extra.area, 160) || undefined, detail: clip(extra.detail, 500) || undefined, ok: extra.ok })
  if (queue.length >= 25) void flush()
  else if (!timer) timer = setTimeout(() => { void flush() }, 4000)
}
/** The result of an action (save, approve, send …) — called by useRun; named after the button that started it. */
export function trackAction(ok: boolean, message?: string) {
  track('action', lastLabel || message || 'Action', { ok, detail: message })
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  const batch = queue
  queue = []
  if (!batch.length) return
  if (!CLOUD) {
    try {
      const cur = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as ActivityEvent[]
      localStorage.setItem(LOCAL_KEY, JSON.stringify([...batch.reverse(), ...cur].slice(0, LOCAL_MAX)))
    } catch { /* storage full or blocked: activity is best effort */ }
    return
  }
  try {
    const sb = await getSupabase()
    const { error } = await sb.from('activity_log').insert(batch.map((e) => ({
      id: e.id, at: e.at, user_id: e.userId, role: e.role, kind: e.kind, label: e.label, path: e.path, area: e.area ?? null, detail: e.detail ?? null, ok: e.ok ?? null,
    })))
    if (error) console.warn('[activity]', error.message)
  } catch (e) { console.warn('[activity]', e) }
}

// ------------------------------------------------------------------ what was clicked, in words
const CLICKABLE = 'button, a, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], input[type="checkbox"], input[type="radio"], label'
/** The window or section an element is in: the dialog / panel name, else the nearest heading above it. */
function areaOf(el: Element): string {
  const box = el.closest('[role="dialog"], [aria-label][role="region"], section[aria-label], nav[aria-label], aside')
  if (box) {
    const name = box.getAttribute('aria-label') || box.querySelector('h1, h2, h3')?.textContent
    if (name) return name
  }
  return el.closest('section, article, [class*="Card"]')?.querySelector('h2, h3, b')?.textContent ?? ''
}
function labelOf(el: Element): string {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const text = el.closest('label')?.textContent || el.getAttribute('aria-label') || el.name
    return `${clip(text, 120)} → ${el.checked ? 'on' : 'off'}`
  }
  return clip(el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.textContent, 120)
}
function onClick(e: MouseEvent) {
  const target = e.target as Element | null
  const el = target?.closest?.(CLICKABLE)
  if (!el || el.closest('[data-no-log]')) return
  // a label around a text box is not an action (its content is never read); around a checkbox, the box's own click
  // is the one recorded (with on / off)
  if (el.tagName === 'LABEL' && el.querySelector('input, textarea, select')) return
  const label = labelOf(el)
  if (!label) return
  const href = el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? undefined : undefined
  track('click', label, { area: areaOf(el), detail: href && !href.startsWith('#') ? `→ ${href}` : undefined })
}
function onChange(e: Event) {
  const el = e.target
  if (!(el instanceof HTMLSelectElement) || el.closest('[data-no-log]')) return
  const name = el.getAttribute('aria-label') || el.closest('label')?.querySelector('span')?.textContent || el.name || 'Choice'
  track('change', `${clip(name, 80)}: ${clip(el.selectedOptions[0]?.textContent, 80)}`, { area: areaOf(el) })
}
function onSubmit(e: Event) {
  const form = e.target as HTMLFormElement
  if (form.closest('[data-no-log]')) return
  track('submit', clip(form.getAttribute('aria-label') || form.querySelector('button[type="submit"]')?.textContent || 'Form', 120), { area: areaOf(form) })
}
const onHide = () => { if (document.visibilityState === 'hidden') void flush() }

/** Starts recording for the signed-in person (the app shell calls it; calling it again for someone else switches). */
export function startActivity(u: User) {
  const first = !me
  me = { id: u.id, role: u.role }
  if (!first || typeof document === 'undefined') return
  document.addEventListener('click', onClick, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', () => { void flush() })
}
/** Stops recording (sign-out): what is queued is sent first. */
export function stopActivity() { void flush(); me = null }

// ------------------------------------------------------------------ reading (IT Support)
export interface ActivityFilter { from: string; to: string; userId?: string; kind?: ActivityKind | ''; q?: string }
/** Events between two dates (YYYY-MM-DD, inclusive, India time), newest first, `limit` at a time from `offset`. */
export async function loadActivity(f: ActivityFilter, offset = 0, limit = 200): Promise<ActivityEvent[]> {
  const start = new Date(`${f.from}T00:00:00+05:30`).toISOString(), end = new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86400000).toISOString()
  const q = f.q?.trim().toLowerCase()
  if (!CLOUD) {
    await flush()
    let list: ActivityEvent[] = []
    try { list = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') } catch { /* nothing kept */ }
    return list.filter((e) => e.at >= start && e.at < end && (!f.userId || e.userId === f.userId) && (!f.kind || e.kind === f.kind)
      && (!q || `${e.label} ${e.path} ${e.area ?? ''} ${e.detail ?? ''}`.toLowerCase().includes(q))).slice(offset, offset + limit)
  }
  const sb = await getSupabase()
  let req = sb.from('activity_log').select('*').gte('at', start).lt('at', end).order('at', { ascending: false }).range(offset, offset + limit - 1)
  if (f.userId) req = req.eq('user_id', f.userId)
  if (f.kind) req = req.eq('kind', f.kind)
  if (q) { const s = q.replace(/[%,()]/g, ' '); req = req.or(`label.ilike.%${s}%,path.ilike.%${s}%,area.ilike.%${s}%,detail.ilike.%${s}%`) }
  const { data, error } = await req
  if (error) throw new Error(/permission|row-level/i.test(error.message) ? 'Only the IT Support team can read the activity log.' : error.message)
  return (data ?? []).map((r) => ({ id: r.id, at: r.at, userId: r.user_id, role: r.role, kind: r.kind, label: r.label, path: r.path, area: r.area ?? undefined, detail: r.detail ?? undefined, ok: r.ok ?? undefined }))
}
/** Removes events older than `days` days (IT Support). Answers how many were removed (browser mode) or -1 (live). */
export async function pruneActivity(days: number) {
  const before = new Date(Date.now() - days * 86400000).toISOString()
  if (!CLOUD) {
    try {
      const list = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as ActivityEvent[]
      const keep = list.filter((e) => e.at >= before)
      localStorage.setItem(LOCAL_KEY, JSON.stringify(keep))
      return list.length - keep.length
    } catch { return 0 }
  }
  const sb = await getSupabase()
  const { error } = await sb.from('activity_log').delete().lt('at', before)
  if (error) throw new Error(error.message)
  return -1
}
