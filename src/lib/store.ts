import { useSyncExternalStore } from 'react'
import { produce, setAutoFreeze } from 'immer'
import type { DB } from './types'
import { buildSeed, SEED_VERSION } from './seed'
import { upgradeDb } from './hrsuite'

/**
 * Local document store. All collections live in one in-memory document, saved to the browser's IndexedDB
 * (hundreds of MB available — enough for thousands of client files) and synced across tabs. Writes go through
 * `mutate`, which uses structural sharing (only the records you change are copied), so large data stays fast.
 * Swapping this for the Supabase API later only touches lib/actions.ts.
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
export const storageBackend = () => backend

/** Applies a change. Only the records touched are copied, so this stays fast with thousands of client files. */
export function mutate<T = void>(fn: (d: DB) => T): T {
  let out!: T
  db = produce(db, (draft) => { out = fn(draft as DB) })
  save()
  emit()
  return out
}

/** Replaces all data at once (restore from a backup, legacy import). */
export function replaceDb(next: DB) {
  db = upgradeDb(next)
  save()
  emit()
}

export async function resetDemoData() {
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
