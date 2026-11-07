import { CLOUD } from './cloud'
import { getSupabase } from './supabase'
import { diagnose, isNoise, toRecord, type ErrorSource } from '../../supabase/debug-rules.mjs'

/**
 * Auto-debug in the browser. Every error anywhere in the CRM — a page that breaks, a promise nobody caught, a save
 * Supabase refused — is diagnosed (supabase/debug-rules.mjs), fixed on the spot when that is safe (a new version →
 * reload once; an expired sign-in → renew it), and sent to the Error log (IT dashboard). The same error within a
 * short time is counted, not sent again. Without Supabase (local) the log is kept in this browser.
 */
export interface AppError {
  id: number; key: string; source: ErrorSource; code: string; title: string; message: string; detail: string | null; place: string | null
  user_id: string | null; count: number; first_at: string; last_at: string; status: 'open' | 'auto_fixed' | 'solved'
  diagnosis: string | null; fix: string | null; auto_fix: string | null; solved_by: string | null; solved_at: string | null
}
interface Report { source: ErrorSource; message: string; detail?: string; place: string; autoFixed?: string; count: number }

const LOCAL_KEY = 'rexera-error-log'
const RELOADED = 'rexera-chunk-reload'
const queue = new Map<string, Report>()
const lastSent = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null
let sending = false

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : (() => { try { return JSON.stringify(e) } catch { return String(e) } })())
const sessionUser = () => { try { return (JSON.parse(localStorage.getItem('rexera-session') || 'null') as { userId?: string } | null)?.userId ?? null } catch { return null } }

/** Reports one error (never throws). */
export function reportError(source: ErrorSource, error: unknown, extra: { detail?: string; autoFixed?: string; file?: string } = {}) {
  try {
    const message = messageOf(error).slice(0, 2000)
    if (!message.trim() || isNoise(message, extra.file)) return
    const place = `${location.pathname}${location.search}`
    const id = `${source}|${message}|${location.pathname}`
    const q = queue.get(id)
    if (q) { q.count++; return }
    // the same error again within 30 s: counted on the next report instead of sent again
    if (Date.now() - (lastSent.get(id) ?? 0) < 30_000) return
    const detail = extra.detail ?? (error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : undefined)
    queue.set(id, { source, message, detail, place, autoFixed: extra.autoFixed, count: 1 })
    if (!timer) timer = setTimeout(() => void flush(), 2000)
  } catch { /* reporting must never break the page */ }
}

async function flush() {
  timer = null
  if (sending || !queue.size) return
  sending = true
  const batch = [...queue.entries()].slice(0, 20)
  for (const [id] of batch) { queue.delete(id); lastSent.set(id, Date.now()) }
  const list = batch.map(([, r]) => r)
  try {
    if (CLOUD) {
      const token = (await (await getSupabase()).auth.getSession()).data.session?.access_token
      if (token) await fetch('/api/errors', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ errors: list }), keepalive: true })
    } else saveLocal(list)
  } catch { /* offline: dropped, it will happen again if it matters */ }
  sending = false
  if (queue.size) timer = setTimeout(() => void flush(), 2000)
}

// ------------------------------------------------------------------ local log (no Supabase)
function readLocal(): AppError[] { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as AppError[] } catch { return [] } }
function writeLocal(list: AppError[]) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 300))) } catch { /* storage full */ } }
function saveLocal(list: Report[]) {
  const all = readLocal()
  const now = new Date().toISOString()
  for (const r of list) {
    const rec = toRecord(r, sessionUser())
    if (!rec) continue
    const have = all.find((x) => x.key === rec.p_key)
    if (have) {
      Object.assign(have, { count: have.count + rec.p_count, last_at: now, message: rec.p_message, detail: rec.p_detail ?? have.detail, auto_fix: rec.p_auto_fix ?? have.auto_fix,
        status: have.status === 'solved' || rec.p_status === 'open' ? rec.p_status : have.status, ...(have.status === 'solved' ? { solved_by: null, solved_at: null } : {}) })
    } else {
      all.unshift({ id: Date.now() + Math.floor(Math.random() * 1000), key: rec.p_key, source: rec.p_source, code: rec.p_code, title: rec.p_title, message: rec.p_message, detail: rec.p_detail,
        place: rec.p_place, user_id: rec.p_user, count: rec.p_count, first_at: now, last_at: now, status: rec.p_status, diagnosis: rec.p_diagnosis, fix: rec.p_fix,
        auto_fix: rec.p_auto_fix, solved_by: null, solved_at: null })
    }
  }
  writeLocal(all.sort((a, b) => b.last_at.localeCompare(a.last_at)))
}

// ------------------------------------------------------------------ the Error log page
export async function loadErrors(): Promise<AppError[]> {
  if (!CLOUD) return readLocal()
  const { data, error } = await (await getSupabase()).from('app_errors').select('*').order('last_at', { ascending: false }).limit(500)
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Run the database update 20261110000000_auto_debug.sql (Supabase → SQL Editor → run-now.sql) to turn on the Error log.' : error.message)
  return (data ?? []) as AppError[]
}
export async function setErrorStatus(ids: number[], status: 'open' | 'solved', by: string) {
  const patch = status === 'solved' ? { status, solved_by: by, solved_at: new Date().toISOString() } : { status, solved_by: null, solved_at: null }
  if (!CLOUD) { writeLocal(readLocal().map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e))); return }
  const { error } = await (await getSupabase()).from('app_errors').update(patch).in('id', ids)
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------------------ automatic fixes + catching everything
/** A page file of an older version: reload once (at most once a minute, so a real outage doesn't loop). */
export function reloadForNewVersion(): boolean {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOADED)) || 0 } catch { /* blocked */ }
  if (Date.now() - last < 60_000) return false
  try { sessionStorage.setItem(RELOADED, String(Date.now())) } catch { /* blocked */ }
  void flush().finally(() => location.reload())
  return true
}

async function autoFix(source: ErrorSource, error: unknown): Promise<string | undefined> {
  const code = diagnose(messageOf(error)).code
  if (code === 'new-version') return reloadForNewVersion() ? 'Reloaded the page once with the new version.' : undefined
  if (code === 'sign-in-expired' && CLOUD) {
    const { error: e } = await (await getSupabase()).auth.refreshSession().catch((x) => ({ error: x }))
    return e ? undefined : 'Renewed the sign-in session automatically.'
  }
  void source
  return undefined
}
const catchIt = (source: ErrorSource, error: unknown, file?: string) => {
  void autoFix(source, error).then((autoFixed) => reportError(source, error, { autoFixed, file }), () => reportError(source, error, { file }))
}

let installed = false
/** Catches every error the CRM doesn't handle itself (started once in main.tsx). */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    // a <script>/<img> that failed to load reports on its element, not as a message
    if (!e.message && !e.error) return
    catchIt('browser', e.error ?? e.message, e.filename)
  })
  window.addEventListener('unhandledrejection', (e) => catchIt('browser', e.reason))
  window.addEventListener('pagehide', () => void flush())
}
