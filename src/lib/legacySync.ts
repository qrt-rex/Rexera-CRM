import { CLOUD } from './cloud'
import { getSupabase } from './supabase'

/**
 * Old CRM sync — the IT dashboard's side. Everything runs on the live server (server/legacySync.mjs); this file only
 * calls its API (/api/legacy-sync, IT Support only) with the signed-in person's Supabase session.
 */
export interface SyncConfig {
  enabled: boolean; autopilot?: boolean; url: string | null; interval_sec: number; prefer: 'new' | 'old'; db_limit_bytes: number; storage_limit_bytes: number
  old_name: string | null; old_logo: string | null; updated_by: string | null; updated_at: string | null
  state: {
    fingerprint?: unknown; lastCheckAt?: string; lastRunAt?: string; lastOkAt?: string; lastPingAt?: string; connected?: boolean; lastError?: string | null
    lastTotals?: { added: number; updated: number; kept: number }; oldRows?: number; oldTotal?: number; oldTotalAt?: string
    old?: { name?: string; logo?: string | null; version?: string; php?: string; uploads?: boolean; databases?: Record<string, { mysql?: string; tables?: string[] }> }
  }
}
export interface Counts { added: number; updated: number; kept: number; same: number }
export interface SyncRun {
  id: number; started_at: string; finished_at: string | null; trigger: 'auto' | 'manual' | 'full'; status: 'running' | 'ok' | 'partial' | 'error' | 'stopped'
  changed_tables: string[] | null; rows_read: number | null; error: string | null; by_user: string | null
  written: (Record<string, Counts> & { totals?: { added: number; updated: number; kept: number }; notes?: string[]; failedRows?: { table: string; key: string; error: string; tries?: number }[] }) | null
  files: { copied: number; failed: { path: string; doc: string; booking: string; error: string; tries?: number }[]; more: boolean; setAside?: number } | null
}
export interface SyncStatus { config: SyncConfig; secret: { set: boolean; problem: string | null }; running: boolean; runs: SyncRun[] }
export interface TableSize { name: string; rows: number; bytes: number }
export interface SyncStorage {
  new: { database_bytes: number; tables: TableSize[]; buckets: { bucket: string; files: number; bytes: number }[]; db_limit_bytes: number; storage_limit_bytes: number }
  old: null | {
    databases: Record<string, { bytes: number; tables: TableSize[] }>
    files?: { bytes: number; files: number; at: string }
    disk?: { free: number | null; total: number | null }
  }
  oldError: string | null; oldAt: string
}
export interface Ping { name: string; logo?: string; version: string; php: string; time: string; uploads: boolean; databases: Record<string, { mysql: string; tables: string[] }> }

export const INTERVALS = [15, 30, 60, 300, 900] as const
export const intervalText = (s: number) => (s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : `${s / 60} minutes`)

async function api<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: object): Promise<T> {
  let token = ''
  if (CLOUD) token = (await (await getSupabase()).auth.getSession()).data.session?.access_token ?? ''
  const res = await fetch(`/api/legacy-sync${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(() => null)
  const j = (await res?.json().catch(() => null)) as ({ success?: boolean; message?: string } & T) | null
  if (!res) throw new Error('Could not reach the CRM server.')
  if (!j) throw new Error(CLOUD ? `The server answered ${res.status}.` : 'The old CRM sync runs on the live CRM (Supabase + the CRM server). This copy keeps its data in the browser.')
  if (!res.ok || !j.success) throw new Error(j.message || `The server answered ${res.status}.`)
  return j
}

export const loadStatus = () => api<SyncStatus>('')
export const loadStorage = (fresh = false) => api<SyncStorage>(`/storage${fresh ? '?fresh=1' : ''}`)
export const saveConfig = (patch: Partial<{ enabled: boolean; autopilot: boolean; url: string; intervalSec: number; prefer: 'new' | 'old'; dbLimitBytes: number; storageLimitBytes: number; oldName: string; oldLogo: string }>) =>
  api<{ config: SyncConfig }>('/config', 'POST', patch)
export const testConnection = (url?: string) => api<{ ping: Ping; autopilot?: string | null }>('/test', 'POST', url ? { url } : {})
export const runNow = (full = false) => api<{ started: boolean; message?: string }>('/run', 'POST', { full })
export const stopRun = () => api<{ stopping: boolean }>('/stop', 'POST', {})

/** 48 random characters for LEGACY_SYNC_SECRET (made in this browser; never sent anywhere by the CRM). */
export function newSecret() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint32Array(48))
  return [...r].map((n) => abc[n % abc.length]).join('')
}

/** "1.2 GB" */
export const bytes = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}
