/**
 * Auto-debug on the server: every error goes to app_errors (IT dashboard → Error log), diagnosed and grouped by
 * supabase/debug-rules.mjs.
 *  - POST /api/errors: the browser reports errors of the signed-in person (batched; limited per person).
 *  - logError(): the server's own errors (crashes, failed jobs) and the old CRM sync's errors.
 * Without Supabase (local) the last errors are kept in memory only.
 */
import { createClient } from '@supabase/supabase-js'
import { toRecord } from '../supabase/debug-rules.mjs'
import { crmUser } from './users.mjs'

const PER_MINUTE = 60
const seen = new Map()   // user → { at, n } (rate limit)
const recent = []        // last errors when there is no database

const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
  const key = env('SUPABASE_SECRET_KEY') || ''
  return url && key.startsWith('sb_secret_') ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

async function store(env, rec) {
  const sb = admin(env)
  if (!sb) { recent.unshift({ ...rec, at: new Date().toISOString() }); recent.length = Math.min(recent.length, 200); return }
  const { error } = await sb.rpc('log_app_error', rec)
  // never let logging an error cause another one (e.g. the database update not run yet)
  if (error) console.warn(`[errors] could not log: ${error.message}`)
}

/** The server logs one of its own errors (or the sync's). Never throws. */
export async function logError(env, { source = 'server', message, detail, place, userId, autoFixed, count } = {}) {
  try {
    const rec = toRecord({ source, message: message instanceof Error ? message.message : message, detail: detail ?? (message instanceof Error ? message.stack : undefined), place, autoFixed, count }, userId)
    if (rec) await store(env, rec)
  } catch (e) { console.warn(`[errors] ${e.message}`) }
}

/** POST /api/errors — up to 20 reports from the signed-in person's browser. */
export async function handleErrorReport(env, authorization, body) {
  const me = await crmUser(env, authorization).catch(() => null)
  if (!me) return { status: 401, body: { success: false, message: 'Sign in again.' } }
  const now = Date.now()
  const s = seen.get(me.id)
  const win = s && now - s.at < 60_000 ? s : { at: now, n: 0 }
  const list = Array.isArray(body?.errors) ? body.errors.slice(0, 20) : []
  const room = Math.max(0, PER_MINUTE - win.n)
  win.n += list.length
  seen.set(me.id, win)
  let saved = 0
  for (const r of list.slice(0, room)) {
    const rec = toRecord(r, me.id)
    if (rec) { await store(env, rec); saved++ }
  }
  return { status: 200, body: { success: true, saved } }
}

export const recentErrors = () => recent
