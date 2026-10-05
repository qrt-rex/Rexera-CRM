import { useSyncExternalStore } from 'react'
import type { DB } from './types'
import { buildSeed, SEED_VERSION } from './seed'

/**
 * Local document store. Every collection lives in one JSON document persisted to localStorage and
 * synced across tabs. All writes go through `mutate`, so swapping this for REST calls to the
 * FastAPI backend later only touches lib/actions.ts.
 */
const KEY = 'rexera-crm-db'
let db: DB
const listeners = new Set<() => void>()

export async function initStore() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed.version === SEED_VERSION) { db = parsed; return }
    }
  } catch { /* corrupted or blocked storage: reseed */ }
  db = await buildSeed()
  save()
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* quota or private mode: keep in memory */ }
}
function emit() { listeners.forEach((l) => l()) }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try { db = JSON.parse(e.newValue) as DB; emit() } catch { /* ignore */ }
    }
  })
}

export const getDb = () => db

export function mutate<T = void>(fn: (d: DB) => T): T {
  const next = structuredClone(db)
  const out = fn(next)
  db = next
  save()
  emit()
  return out
}

export async function resetDemoData() {
  db = await buildSeed()
  save()
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Whole database snapshot; stable until the next write, so derive with useMemo. */
export function useDb(): DB {
  return useSyncExternalStore(subscribe, () => db)
}
