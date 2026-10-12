import { useSyncExternalStore } from 'react'
import { produce, setAutoFreeze } from 'immer'
import type { DB } from './types'
import { buildSeed, SEED_VERSION } from './seed'
import { upgradeDb } from './hrsuite'
import { CLOUD, loadCloud, pushChanges, watchCloud, unwatchCloud } from './cloud'

/**
 * Local document store. All collections live in one in-memory document, saved to the browser's IndexedDB
 * (hundreds of MB available — enough for thousands of client files) and synced across tabs. Writes go through
 * `mutate`, which uses structural sharing (only the records you change are copied), so large data stays fast.
 * With VITE_DATA_BACKEND=supabase the document is filled from Supabase instead and every change is written back
 * (lib/cloud.ts); nothing is kept in the browser then.
 */
setAutoFreeze(false)
const LEGACY_KEY = 'rexera-crm-db'          // older builds kept everything in localStorage
const IDB_NAME = 'rexera-crm-store', IDB_STORE = 'kv', IDB_KEY = 'db'
let db: DB
let backend: 'indexeddb' | 'localstorage' = 'indexeddb'
const listeners = new Set<() => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rexera-crm-db') : null

// ------------------------------------------------------------------ IndexedDB helpers
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB unavailable'))
  })
}
async function idbGet(): Promise<DB | undefined> {
  const d = await idb()
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => { resolve(req.result as DB | undefined); d.close() }
    req.onerror = () => { reject(req.error); d.close() }
  })
}
async function idbPut(value: DB) {
  const d = await idb()
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(IDB_STORE, 'readwrite')
    t.objectStore(IDB_STORE).put(value, IDB_KEY)
    t.oncomplete = () => { resolve(); d.close() }
    t.onerror = t.onabort = () => { reject(t.error ?? new Error('Saving failed — the browser may be out of space.')); d.close() }
  })
}

// ------------------------------------------------------------------ load / save
export async function initStore() {
  if (CLOUD) return reloadFromCloud(true)
  let loaded: DB | undefined
  try {
    loaded = await idbGet()
  } catch {
    backend = 'localstorage'   // IndexedDB blocked (some private modes): fall back
  }
  if (!loaded) {
    try {
      const raw = localStorage.getItem(LEGACY_KEY)
      if (raw) loaded = JSON.parse(raw) as DB
    } catch { /* corrupted or blocked */ }
  }
  db = loaded && loaded.version === SEED_VERSION ? upgradeDb(loaded) : upgradeDb(await buildSeed())
  await persistNow()
  // data now lives in IndexedDB; free the small localStorage area
  if (backend === 'indexeddb') try { localStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
}

let timer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()
async function persistNow() {
  if (CLOUD) return
  const snapshot = db
  if (backend === 'indexeddb') {
    try { await idbPut(snapshot); channel?.postMessage('changed'); return } catch { backend = 'localstorage' }
  }
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(snapshot)) } catch { /* quota: keep in memory */ }
}
/** Writes are batched (a burst of changes is saved once) and flushed when the tab is hidden or closed. */
function save() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; saving = saving.then(persistNow) }, 200)
}
export function flushSaves() {
  if (CLOUD) return cloudSaving
  if (timer) { clearTimeout(timer); timer = null; saving = saving.then(persistNow) }
  return saving
}
function emit() { listeners.forEach((l) => l()) }

if (typeof window !== 'undefined') {
  // another tab saved: reload from storage
  channel?.addEventListener('message', async () => {
    try { const next = await idbGet(); if (next) { db = next; emit() } } catch { /* ignore */ }
  })
  window.addEventListener('storage', (e) => {
    if (e.key === LEGACY_KEY && e.newValue && backend === 'localstorage') {
      try { db = JSON.parse(e.newValue) as DB; emit() } catch { /* ignore */ }
    }
  })
  const flush = () => { void flushSaves() }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

export const getDb = () => db
export const storageBackend = () => (CLOUD ? 'supabase' : backend)

// ------------------------------------------------------------------ Supabase (VITE_DATA_BACKEND=supabase)
let skeleton: DB | undefined
/** App defaults with no records: what the CRM shows before sign-in, and the base the tables are laid over. */
async function emptyDb(): Promise<DB> {
  skeleton ??= upgradeDb(await buildSeed())
  const d = structuredClone(skeleton)
  for (const [k, v] of Object.entries(d)) if (Array.isArray(v) && k !== 'upgrades') (d as unknown as Record<string, unknown[]>)[k] = []
  return d
}
async function fromCloud(loaded: DB): Promise<DB> {
  const base = await emptyDb()
  const d = { ...base, ...Object.fromEntries(Object.entries(loaded).filter(([, v]) => v !== undefined)) } as DB
  d.settings = { ...base.settings, ...loaded.settings }
  // no data-version row yet (nothing migrated): don't re-run the one-time upgrades over the tables
  if (loaded.version == null) { d.version = base.version; d.upgrades = base.upgrades }
  return upgradeDb(d)
}
let cloudSaving: Promise<void> = Promise.resolve()
const syncListeners = new Set<(message: string) => void>()
/** The screen shows these: a change Supabase refused (the data is then reloaded, so the screen matches the database). */
export function onSyncError(fn: (message: string) => void) { syncListeners.add(fn); return () => { syncListeners.delete(fn) } }

/** Loads everything this person may see from Supabase (after sign-in, or at start-up with a saved session). */
export async function reloadFromCloud(first = false) {
  db = await fromCloud(await loadCloud())
  if (!first) emit()
  await watchCloud(async (next) => { db = await fromCloud(next); emit() })
}
/** Signed out: forget everything that was loaded. */
export async function clearCloudDb() {
  await unwatchCloud()
  db = await fromCloud(await loadCloud())
  emit()
}
function pushToCloud(prev: DB, next: DB) {
  const run = cloudSaving.then(async () => {
    const errors = await pushChanges(prev, next)
    if (!errors.length) return
    const msg = /row-level security|permission/i.test(errors[0]) ? "You don't have access to save that." : errors[0]
    syncListeners.forEach((l) => l(`Not saved: ${msg}`))
    db = await fromCloud(await loadCloud())
    emit()
    throw new Error(msg)
  })
  cloudSaving = run.catch(() => undefined)
  return run
}
let lastSave: Promise<void> = Promise.resolve()
/** Resolves once the latest change reached Supabase; rejects if it was refused. Browser mode: resolves at once. */
export const saved = () => (CLOUD ? lastSave : Promise.resolve())

/** Applies a change. Only the records touched are copied, so this stays fast with thousands of client files. */
export function mutate<T = void>(fn: (d: DB) => T): T {
  let out!: T
  const prev = db
  db = produce(db, (draft) => { out = fn(draft as DB) })
  if (CLOUD) { if (db !== prev) { lastSave = pushToCloud(prev, db); lastSave.catch(() => undefined) } } else save()
  emit()
  return out
}

/** Replaces all data at once (restore from a backup, legacy import). */
export function replaceDb(next: DB) {
  const prev = db
  db = upgradeDb(next)
  if (CLOUD) { lastSave = pushToCloud(prev, db); lastSave.catch(() => undefined) } else save()
  emit()
}

export async function resetDemoData() {
  if (CLOUD) throw new Error('Demo data can’t be loaded into the live database.')
  db = upgradeDb(await buildSeed())
  save()
  emit()
}

/** Approximate size of all CRM data in bytes (as JSON). */
export const approxDataBytes = () => { try { return JSON.stringify(db).length } catch { return 0 } }

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Whole database snapshot; stable until the next write, so derive with useMemo. */
export function useDb(): DB {
  return useSyncExternalStore(subscribe, () => db)
}
