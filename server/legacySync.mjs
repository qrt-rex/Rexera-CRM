/**
 * Old CRM → new CRM sync (IT Support only; IT dashboard → Old CRM sync).
 *
 * The old PHP CRM gets one read-only file, public/old-crm-connector/rexera-connector.php. This server talks to it with
 * signed requests (LEGACY_SYNC_SECRET), and while the sync is ON:
 *  1. every few seconds it asks for a fingerprint of the old tables — nothing else happens while nothing changed;
 *  2. when something changed (or IT presses Copy now) it reads the old CRM's tables, runs the CRM's own old-CRM import
 *     (the same mapping as IT → Import from old CRM; ids come from the old ids, so nothing is duplicated), copies
 *     uploaded files that aren't in the new CRM yet, and writes only what is new or changed;
 *  3. a record that someone changed in the new CRM is never overwritten (unless IT chose "take the old CRM's
 *     version"), and nothing in the new CRM is ever deleted.
 * Every run is logged (legacy_sync_runs). OFF stops it at once — a run in progress stops before it writes.
 */
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ORDER, mapAll, rowsToDb } from '../supabase/backup-mapping.mjs'
import {
  BILLING_TABLES, INTERVALS, MAIN_TABLES, PAGE, SYNC_TABLES, changedTables, fingerprintKey, planWrites, secretProblem, signRequest,
} from '../supabase/legacy-sync-protocol.mjs'
import { crmUser } from './users.mjs'

const TICK_MS = 5000
const MAX_FILES_PER_RUN = 200
const OLD_STATS_TTL = 5 * 60_000

let running = null, stopRequested = false, oldStats = null, timer = null

const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
  const key = env('SUPABASE_SECRET_KEY') || ''
  return url && key.startsWith('sb_secret_') ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}
const secretOf = (env) => env('LEGACY_SYNC_SECRET') || ''
/** https only (plain http only to this computer, for testing) */
export function urlProblem(u) {
  if (!u) return 'Enter the connector’s address.'
  let x
  try { x = new URL(u) } catch { return 'Not a valid address.' }
  if (x.protocol === 'https:') return null
  if (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)) return null
  return 'Use an https:// address — the connector carries client data.'
}

// ------------------------------------------------------------------ the connector
async function call(env, cfg, action, params = {}, { raw = false, timeoutMs = 30_000 } = {}) {
  const secret = secretOf(env)
  if (secretProblem(secret)) throw new Error('LEGACY_SYNC_SECRET is not set on the server (Render → Environment), or is shorter than 32 characters.')
  const p = urlProblem(cfg.url)
  if (p) throw new Error(p)
  const qs = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])) })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try { res = await fetch(`${cfg.url}${cfg.url.includes('?') ? '&' : '?'}${qs}`, { headers: await signRequest(secret, action, params), signal: ctrl.signal }) }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The old CRM did not answer in time.' : `Could not reach the old CRM: ${e.message}`) }
  finally { clearTimeout(t) }
  if (raw) {
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `The old CRM answered ${res.status}.`) }
    return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'application/octet-stream' }
  }
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.ok) throw new Error(j?.error || `The old CRM answered ${res.status}${res.status === 404 ? ' — is the connector file at that address?' : ''}.`)
  return j
}

// ------------------------------------------------------------------ config and state
async function loadConfig(sb) {
  const { data, error } = await sb.from('legacy_sync').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(/relation|does not exist/i.test(error.message) ? 'Run the database update 20261109000000_legacy_sync.sql first.' : error.message)
  return data ?? { id: 1, enabled: false, interval_sec: 60, prefer: 'new', state: {} }
}
async function saveState(sb, patch) {
  const cur = await loadConfig(sb)
  await sb.from('legacy_sync').update({ state: { ...(cur.state ?? {}), ...patch } }).eq('id', 1)
}

async function fetchAll(sb, table) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}
/** The new CRM as it is now, in the app's shape (the import builds on it). */
async function loadNewCrm(sb) {
  const tables = {}
  for (const [t] of ORDER) if (t !== 'app_users_team') tables[t] = await fetchAll(sb, t).catch(() => [])
  return rowsToDb(tables).db
}
async function loadSynced(sb) {
  const m = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('legacy_sync_rows').select('table_name,row_key,hash').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data) m.set(`${r.table_name}|${r.row_key}`, r.hash)
    if (data.length < 1000) return m
  }
}
/** Every row of the tables the import reads, page by page. */
async function readOld(env, cfg, db, names, shouldStop) {
  const out = {}
  let rows = 0
  for (const table of names) {
    if (shouldStop()) throw Object.assign(new Error('Stopped — the sync was switched off.'), { stopped: true })
    const all = []
    let columns = []
    for (let offset = 0; ; offset += PAGE) {
      const r = await call(env, cfg, 'rows', { db, table, offset, limit: PAGE })
      columns = r.columns
      all.push(...r.rows)
      if (r.rows.length < PAGE) break
    }
    out[table] = { columns, rows: all }
    rows += all.length
  }
  return { tables: out, rows }
}

// ------------------------------------------------------------------ one run
/** Uploaded files the import points at (old uploads folder) that the new CRM doesn't have yet → crm-files bucket. */
async function copyFiles(env, sb, cfg, next, shouldStop) {
  const copied = [], failed = []
  for (const b of next.bookings ?? []) for (const doc of b.documents ?? []) {
    if (doc.file || !doc.legacyPath) continue
    if (copied.length + failed.length >= MAX_FILES_PER_RUN || shouldStop()) return { copied: copied.length, failed, more: true }
    const path = String(doc.legacyPath)
    // one stable name per old file: copying again never makes a second copy
    const id = `lg-file-${createHash('sha256').update(path).digest('hex').slice(0, 32)}`
    try {
      let got
      for (const p of [path, path.replace(/^\.?\/?uploads\//i, '')]) {
        try { got = await call(env, cfg, 'file', { path: p }, { raw: true, timeoutMs: 60_000 }); break } catch (e) { if (p !== path) throw e }
      }
      const up = await sb.storage.from('crm-files').upload(id, got.buf, { contentType: got.type, upsert: false })
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(up.error.message)
      doc.file = { id, name: path.split('/').pop() || doc.name, type: got.type, size: got.buf.length, at: doc.at }
      doc.size = got.buf.length
      copied.push(id)
    } catch (e) { failed.push({ path, doc: doc.id, booking: b.id, error: e.message }) }
  }
  return { copied: copied.length, failed, more: false }
}

async function runOnce(env, { trigger = 'auto', by } = {}) {
  const sb = admin(env)
  if (!sb) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.')
  const cfg = await loadConfig(sb)
  stopRequested = false
  const shouldStop = () => stopRequested
  const now = new Date().toISOString()
  // 1. anything changed?
  const fp = (await call(env, cfg, 'fingerprint')).fingerprint ?? {}
  const before = cfg.state?.fingerprint
  if (trigger === 'auto' && before && fingerprintKey(before) === fingerprintKey(fp)) {
    await saveState(sb, { lastCheckAt: now, connected: true, lastError: null })
    return { skipped: true }
  }
  const { data: run, error: runErr } = await sb.from('legacy_sync_runs').insert({ trigger, status: 'running', changed_tables: before ? changedTables(before, fp) : ['(first copy)'], by_user: by ?? null }).select('id').single()
  if (runErr) throw new Error(runErr.message)
  const finish = (patch) => sb.from('legacy_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run.id)
  try {
    // 2. read the old CRM
    const ping = await call(env, cfg, 'ping')
    const mainNames = MAIN_TABLES.filter((t) => ping.databases?.main?.tables?.includes(t))
    const billNames = BILLING_TABLES.filter((t) => ping.databases?.billing?.tables?.includes(t))
    const main = await readOld(env, cfg, 'main', mainNames, shouldStop)
    const bill = billNames.length ? await readOld(env, cfg, 'billing', billNames, shouldStop) : null
    // 3. the CRM's own old-CRM import, on the new CRM as it is now
    const { buildImport } = await import('./dist/legacy-import.mjs').catch(() => { throw new Error('The import module is missing — the server must be built with `npm run build`.') })
    const current = await loadNewCrm(sb)
    const { next, report } = buildImport(main.tables, current, { replaceSampleData: false, billing: bill?.tables })
    // 4. files the new CRM doesn't have yet
    const files = await copyFiles(env, sb, cfg, next, shouldStop)
    if (shouldStop()) throw Object.assign(new Error('Stopped — the sync was switched off.'), { stopped: true })
    // 5. only what is new, or changed in the old CRM and untouched here
    const prev = mapAll({ db: current })
    const mapped = mapAll({ db: next })
    const nextRows = mapAll({ db: rowsToDb(mapped).db })   // the same shape as read back, so equal rows compare equal
    const synced = await loadSynced(sb)
    const plan = planWrites(prev, nextRows, synced, cfg.prefer === 'old' ? 'old' : 'new')
    if (shouldStop()) throw Object.assign(new Error('Stopped — the sync was switched off.'), { stopped: true })
    for (const [table, onConflict] of SYNC_TABLES) {
      const list = plan.writes[table] ?? []
      for (let i = 0; i < list.length; i += 200) {
        const { error } = await sb.from(table).upsert(list.slice(i, i + 200), { onConflict })
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    }
    for (let i = 0; i < plan.hashes.length; i += 500) {
      const { error } = await sb.from('legacy_sync_rows').upsert(plan.hashes.slice(i, i + 500).map((h) => ({ ...h, synced_at: new Date().toISOString() })), { onConflict: 'table_name,row_key' })
      if (error) throw new Error(`legacy_sync_rows: ${error.message}`)
    }
    const totals = Object.values(plan.counts).reduce((t, c) => ({ added: t.added + c.added, updated: t.updated + c.updated, kept: t.kept + c.kept }), { added: 0, updated: 0, kept: 0 })
    await finish({ status: 'ok', rows_read: main.rows + (bill?.rows ?? 0), written: { ...plan.counts, totals, notes: report.notes?.slice(0, 20) ?? [] }, files })
    // the fingerprint is remembered only after a complete run (files still to copy → the next check runs again)
    await saveState(sb, { fingerprint: files.more || files.failed.length ? null : fp, lastCheckAt: now, lastRunAt: now, lastOkAt: new Date().toISOString(), connected: true, lastError: null, lastTotals: totals, oldRows: main.rows + (bill?.rows ?? 0) })
    return { ok: true, totals, files }
  } catch (e) {
    await finish({ status: e.stopped ? 'stopped' : 'error', error: e.message })
    await saveState(sb, { lastCheckAt: now, lastRunAt: now, lastError: e.stopped ? null : e.message, connected: !/reach|answer|signature|expired|connector/i.test(e.message) })
    throw e
  }
}

/** One run at a time (the timer, Copy now and Copy everything share it). */
function start(env, opts) {
  if (running) return running
  running = runOnce(env, opts).catch((e) => ({ error: e.message })).finally(() => { running = null })
  return running
}

/** The timer: every 5 s it looks whether the sync is on and due. */
export function startLegacySync(env) {
  if (timer || !admin(env)) return
  timer = setInterval(async () => {
    if (running) return
    try {
      const sb = admin(env)
      const cfg = await loadConfig(sb)
      if (!cfg.enabled || !cfg.url || secretProblem(secretOf(env))) return
      const last = Date.parse(cfg.state?.lastCheckAt ?? '') || 0
      if (Date.now() - last < (cfg.interval_sec ?? 60) * 1000) return
      const r = await start(env, { trigger: 'auto' })
      if (r?.error) console.warn(`[legacy-sync] ${r.error}`)
      else if (!r?.skipped) console.log(`[legacy-sync] copied: +${r.totals.added} new, ${r.totals.updated} updated, ${r.totals.kept} kept (changed in the new CRM), ${r.files.copied} file(s)`)
    } catch (e) { console.warn(`[legacy-sync] ${e.message}`) }
  }, TICK_MS)
  timer.unref?.()
}

/** for the tests (server/legacySync.test.mjs): talk to a connector without the database */
export const forTests = { call, readOld }

// ------------------------------------------------------------------ the IT dashboard's API
const ok = (body) => ({ status: 200, body: { success: true, ...body } })
const no = (status, message) => ({ status, body: { success: false, message } })

/** GET /api/legacy-sync[/storage] · POST /api/legacy-sync/{config|test|run|stop} — IT Support only. */
export async function handleLegacySync(env, method, pathname, authorization, body = {}) {
  const me = await crmUser(env, authorization)
  if (!me) return no(401, 'Sign in again.')
  if (!me.roles.includes('it')) return no(403, 'The old CRM sync is managed by IT Support only.')
  const sb = admin(env)
  if (!sb) return no(503, 'Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server (Render → Environment).')
  const action = pathname.replace(/^\/api\/legacy-sync\/?/, '') || 'status'
  try {
    if (method === 'GET' && action === 'status') {
      const cfg = await loadConfig(sb)
      const { data: runs } = await sb.from('legacy_sync_runs').select('*').order('started_at', { ascending: false }).limit(50)
      return ok({ config: cfg, secret: { set: !!secretOf(env), problem: secretProblem(secretOf(env)) }, running: !!running, runs: runs ?? [] })
    }
    if (method === 'GET' && action === 'storage') {
      const cfg = await loadConfig(sb)
      const { data: stats, error } = await sb.rpc('crm_storage_stats')
      if (error) throw new Error(error.message)
      if (!oldStats || Date.now() - oldStats.at > OLD_STATS_TTL || body.fresh) {
        try { oldStats = { at: Date.now(), data: cfg.url ? await call(env, cfg, 'stats') : null, error: null } }
        catch (e) { oldStats = { at: Date.now(), data: null, error: e.message } }
      }
      return ok({ new: { ...stats, db_limit_bytes: cfg.db_limit_bytes, storage_limit_bytes: cfg.storage_limit_bytes }, old: oldStats.data, oldError: oldStats.error, oldAt: new Date(oldStats.at).toISOString() })
    }
    if (method === 'POST' && action === 'config') {
      const patch = {}
      if ('enabled' in body) patch.enabled = !!body.enabled
      if ('url' in body) { const u = String(body.url ?? '').trim(); const p = urlProblem(u); if (p && u) return no(422, p); patch.url = u || null }
      if ('intervalSec' in body) { const n = Number(body.intervalSec); if (!INTERVALS.includes(n)) return no(422, 'Pick one of the check intervals.'); patch.interval_sec = n }
      if ('prefer' in body) patch.prefer = body.prefer === 'old' ? 'old' : 'new'
      if ('dbLimitBytes' in body) patch.db_limit_bytes = Math.max(0, Math.round(Number(body.dbLimitBytes) || 0))
      if ('storageLimitBytes' in body) patch.storage_limit_bytes = Math.max(0, Math.round(Number(body.storageLimitBytes) || 0))
      if ('oldName' in body) patch.old_name = String(body.oldName ?? '').slice(0, 80) || null
      if ('oldLogo' in body) { const l = String(body.oldLogo ?? '').trim(); if (l && !/^https:\/\//.test(l)) return no(422, 'The logo address must start with https://'); patch.old_logo = l || null }
      if (patch.enabled) {
        const cfg = { ...(await loadConfig(sb)), ...patch }
        if (!cfg.url) return no(422, 'Enter and test the connector’s address first.')
        if (secretProblem(secretOf(env))) return no(422, 'Set LEGACY_SYNC_SECRET on the server first (Render → Environment).')
      }
      if (patch.enabled === false) stopRequested = true   // a run in progress stops before it writes
      const { error } = await sb.from('legacy_sync').update({ ...patch, updated_by: me.id, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) throw new Error(error.message)
      await sb.from('audit_log').insert({ at: new Date().toISOString(), by_user: me.id, action: 'LEGACY_SYNC', detail: `Old CRM sync settings: ${Object.entries(patch).map(([k, v]) => `${k} = ${v}`).join(', ')}` })
      return ok({ config: await loadConfig(sb) })
    }
    if (method === 'POST' && action === 'test') {
      const saved = await loadConfig(sb)
      const url = body.url ? String(body.url).trim() : ''
      if (url) { const p = urlProblem(url); if (p) return no(422, p) }
      const cfg = { ...saved, ...(url ? { url } : {}) }
      if (!cfg.url) return no(422, 'Enter the connector’s address first.')
      const ping = await call(env, cfg, 'ping', {}, { timeoutMs: 15_000 })
      // a working address is saved at once (no separate Save needed before turning the sync on)
      if (url && url !== saved.url) {
        const { error } = await sb.from('legacy_sync').update({ url, updated_by: me.id, updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) throw new Error(error.message)
        await sb.from('audit_log').insert({ at: new Date().toISOString(), by_user: me.id, action: 'LEGACY_SYNC', detail: `Old CRM sync: connector address set to ${url} (tested)` })
      }
      await saveState(sb, { connected: true, lastPingAt: new Date().toISOString(), old: { name: ping.name, logo: /^https:\/\//.test(ping.logo ?? '') ? ping.logo : null, version: ping.version, php: ping.php, databases: ping.databases, uploads: ping.uploads } })
      return ok({ ping })
    }
    if (method === 'POST' && action === 'run') {
      if (running) return ok({ started: false, message: 'A copy is already running.' })
      void start(env, { trigger: body.full ? 'full' : 'manual', by: me.id })
      return ok({ started: true })
    }
    if (method === 'POST' && action === 'stop') { stopRequested = true; return ok({ stopping: !!running }) }
    return no(404, 'Unknown action.')
  } catch (e) { return no(502, e.message) }
}
