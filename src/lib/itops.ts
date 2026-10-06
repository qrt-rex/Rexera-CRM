import type { ApiKey, ApiScope, BackupLogEntry, DB, User } from './types'
import { approxDataBytes, flushSaves, getDb, mutate, replaceDb, storageBackend } from './store'
import { buildImport, type DumpTables, type ImportOptions } from './legacyImport'
import { ActionError } from './actions'
import { isMaster } from './rbac'
import { hashPassword } from './crypto'
import { DEMO_PASSWORD, SEED_VERSION } from './seed'
import { listDatasets, saveDatasets, type Dataset } from './imports'
import { addDays, fmtDate, nowIso, uid } from './format'
import { cloudConfig, pingCloud } from './supabase'
import { exportFiles, importFiles, type StoredFile } from './files'

function needMaster(me: User) {
  if (!isMaster(me)) throw new ActionError('Only IT Support or Super Admin can do that.')
}
const log = (d: DB, by: string, action: string, detail: string) => d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail })
const logBackup = (d: DB, e: Omit<BackupLogEntry, 'id' | 'at'>) => { d.backupLog.unshift({ ...e, id: uid('bk-'), at: nowIso() }); d.backupLog.length = Math.min(d.backupLog.length, 100) }

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// ================================================================== API keys
export const API_SCOPES: { id: ApiScope; label: string }[] = [
  { id: 'leads:write', label: 'Create leads (website forms, ads, IVR)' },
  { id: 'leads:read', label: 'Read leads' },
  { id: 'bookings:read', label: 'Read CRM entries' },
  { id: 'billing:read', label: 'Read invoices & payments' },
  { id: 'reports:read', label: 'Read reports' },
  { id: 'webhooks:send', label: 'Receive event webhooks' },
]

/** Creates a key and returns it once; only its SHA-256 hash and a short prefix are kept. */
export async function createApiKey(me: User, i: { name: string; scopes: ApiScope[]; days: number | null }) {
  needMaster(me)
  if (i.name.trim().length < 2) throw new ActionError('Give the key a name (what uses it).')
  if (!i.scopes.length) throw new ActionError('Pick at least one permission.')
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const secret = 'rx_live_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  const hash = await sha256(secret)
  mutate((d) => {
    const key: ApiKey = {
      id: uid('key-'), name: i.name.trim(), prefix: secret.slice(0, 14), hash, scopes: [...i.scopes], createdBy: me.id, createdAt: nowIso(),
      expiresAt: i.days ? addDays(new Date(), i.days).toISOString() : undefined,
    }
    d.apiKeys.unshift(key)
    log(d, me.id, 'API_KEY_CREATE', `${key.name} (${key.prefix}…) · ${key.scopes.join(', ')}`)
  })
  return secret
}
export function revokeApiKey(me: User, id: string) {
  needMaster(me)
  mutate((d) => {
    const k = d.apiKeys.find((x) => x.id === id)
    if (!k || k.revokedAt) throw new ActionError('Key not found or already revoked.')
    k.revokedAt = nowIso(); k.revokedBy = me.id
    log(d, me.id, 'API_KEY_REVOKE', `${k.name} (${k.prefix}…)`)
  })
}
/** Revokes a key and issues a new one with the same name, permissions and lifetime. */
export async function rotateApiKey(me: User, id: string) {
  const k = getDb().apiKeys.find((x) => x.id === id)
  if (!k) throw new ActionError('Key not found.')
  const days = k.expiresAt ? Math.max(1, Math.round((new Date(k.expiresAt).getTime() - new Date(k.createdAt).getTime()) / 86400000)) : null
  if (!k.revokedAt) revokeApiKey(me, id)
  return createApiKey(me, { name: k.name, scopes: k.scopes, days })
}
/** Checks a pasted key against the stored hashes (for testing an integration). */
export async function verifyApiKey(secret: string) {
  const hash = await sha256(secret.trim())
  const k = getDb().apiKeys.find((x) => x.hash === hash)
  if (!k) return { ok: false as const, reason: 'Unknown key' }
  if (k.revokedAt) return { ok: false as const, reason: `Revoked ${fmtDate(k.revokedAt)}`, key: k }
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return { ok: false as const, reason: 'Expired', key: k }
  return { ok: true as const, key: k }
}
export const keyStatus = (k: ApiKey) => (k.revokedAt ? 'revoked' : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'expired' : 'active')

// ================================================================== backups
interface BackupFile { app: 'rexera-crm'; format: 1; exportedAt: string; exportedBy: string; seedVersion: number; db: DB; imports: Dataset[]; files?: StoredFile[] }
interface EncryptedFile { app: 'rexera-crm'; format: 1; encrypted: true; exportedAt: string; salt: string; iv: string; data: string }

async function keyFrom(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Downloads include uploaded files (resumes, leave attachments); in-browser snapshots don't need them (restores never delete files). */
async function buildBackup(me: User, withFiles = false): Promise<BackupFile> {
  return { app: 'rexera-crm', format: 1, exportedAt: nowIso(), exportedBy: me.name, seedVersion: SEED_VERSION, db: getDb(), imports: await listDatasets().catch(() => []), files: withFiles ? await exportFiles().catch(() => []) : undefined }
}

/** Full backup (all CRM data + imported recruitment tables), optionally encrypted with AES-256-GCM. */
export async function downloadBackup(me: User, passphrase?: string) {
  needMaster(me)
  if (passphrase !== undefined && passphrase.length < 8) throw new ActionError('Use a passphrase of at least 8 characters.')
  let text = JSON.stringify(await buildBackup(me, true))
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(passphrase, salt), new TextEncoder().encode(text))
    text = JSON.stringify({ app: 'rexera-crm', format: 1, encrypted: true, exportedAt: nowIso(), salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) } satisfies EncryptedFile)
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = `rexera-backup-${stamp}${passphrase ? '-encrypted' : ''}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  mutate((d) => { logBackup(d, { by: me.id, kind: 'DOWNLOAD', note: a.download, bytes: text.length, encrypted: !!passphrase }); log(d, me.id, 'BACKUP_DOWNLOAD', `${a.download} · ${Math.round(text.length / 1024)} KB`) })
}

/** Reads a backup file; returns 'needs-passphrase' for encrypted files when no passphrase is given. */
export async function readBackupFile(file: File, passphrase?: string): Promise<BackupFile | 'needs-passphrase'> {
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch { throw new ActionError('This is not a Rexera backup file (not valid JSON).') }
  if (!parsed || typeof parsed !== 'object') throw new ActionError('This is not a Rexera CRM backup file.')
  const p = parsed as Partial<BackupFile & EncryptedFile>
  if (p.app !== 'rexera-crm' || p.format !== 1) throw new ActionError('This is not a Rexera CRM backup file.')
  if (p.encrypted) {
    if (!passphrase) return 'needs-passphrase'
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv!) as BufferSource }, await keyFrom(passphrase, unb64(p.salt!)), unb64(p.data!) as BufferSource)
      return validate(JSON.parse(new TextDecoder().decode(plain)))
    } catch (e) {
      if (e instanceof ActionError) throw e
      throw new ActionError('Wrong passphrase, or the file is damaged.')
    }
  }
  return validate(p)
}
function validate(p: Partial<BackupFile>): BackupFile {
  const d = p.db as DB | undefined
  if (!d || !Array.isArray(d.users) || !Array.isArray(d.bookings) || !d.rolePerms || !d.settings) throw new ActionError('The backup is missing data and cannot be restored.')
  if (d.version !== SEED_VERSION) throw new ActionError(`This backup is from a different app version (${d.version}); this app uses ${SEED_VERSION}.`)
  if (!d.users.some((u) => u.active && u.role === 'superadmin')) throw new ActionError('The backup has no active Super Admin, so it is refused.')
  return { ...(p as BackupFile), imports: Array.isArray(p.imports) ? p.imports : [] }
}

/** Restores a backup. A snapshot of the current data is taken first, so a restore can be undone. */
export async function restoreBackup(me: User, b: BackupFile, label: string) {
  needMaster(me)
  await createSnapshot(me, `Before restoring ${label}`, 'SNAPSHOT')
  const next = structuredClone(b.db)
  next.backupLog = [...(getDb().backupLog ?? [])]
  next.backupLog.unshift({ id: uid('bk-'), at: nowIso(), by: me.id, kind: 'RESTORE', note: label, bytes: JSON.stringify(b.db).length })
  next.audit = [{ id: uid('a-'), at: nowIso(), by: me.id, action: 'BACKUP_RESTORE', detail: `${label} (exported ${new Date(b.exportedAt).toLocaleString('en-IN')} by ${b.exportedBy})` }, ...(next.audit ?? [])]
  replaceDb(next)
  if (b.imports.length) await saveDatasets(b.imports)
  if (b.files?.length) await importFiles(b.files)
}

// ------------------------------------------------------------------ snapshots (kept in this browser)
interface Snapshot { id: string; at: string; by: string; label: string; bytes: number; payload: string }
const SNAP_DB = 'rexera-backups', SNAP_STORE = 'snapshots', MAX_SNAPSHOTS = 10
function snapDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(SNAP_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(SNAP_STORE, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error ?? new Error('Browser storage is unavailable.'))
  })
}
async function snapTx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await snapDb()
  return new Promise((res, rej) => {
    const t = d.transaction(SNAP_STORE, mode)
    const req = fn(t.objectStore(SNAP_STORE))
    t.oncomplete = () => { res(req ? req.result : undefined); d.close() }
    t.onerror = t.onabort = () => { rej(t.error ?? new Error('Snapshot storage failed — the browser may be out of space.')); d.close() }
  })
}
export type SnapshotInfo = Omit<Snapshot, 'payload'>
export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const all = (await snapTx<Snapshot[]>('readonly', (s) => s.getAll() as IDBRequest<Snapshot[]>)) ?? []
  return all.map(({ payload: _p, ...rest }) => rest).sort((a, b) => b.at.localeCompare(a.at))
}
export async function createSnapshot(me: User, label: string, kind: 'SNAPSHOT' | 'AUTO_SNAPSHOT' = 'SNAPSHOT') {
  needMaster(me)
  const payload = JSON.stringify(await buildBackup(me))
  await snapTx('readwrite', (s) => { s.put({ id: uid('snap-'), at: nowIso(), by: me.id, label, bytes: payload.length, payload } satisfies Snapshot) })
  const all = await listSnapshots()
  for (const old of all.slice(MAX_SNAPSHOTS)) await snapTx('readwrite', (s) => s.delete(old.id))
  mutate((d) => logBackup(d, { by: me.id, kind, note: label, bytes: payload.length }))
}
export async function restoreSnapshot(me: User, id: string) {
  const snap = await snapTx<Snapshot>('readonly', (s) => s.get(id) as IDBRequest<Snapshot>)
  if (!snap) throw new ActionError('Snapshot not found.')
  await restoreBackup(me, validate(JSON.parse(snap.payload)), `snapshot “${snap.label}”`)
}

// ------------------------------------------------------------------ import from the old PHP CRM
/** Snapshot first, then rebuild the import against the data as it is right now (so nothing typed since the preview is lost). */
export async function importLegacy(me: User, tables: DumpTables, opts: ImportOptions, fileName: string) {
  needMaster(me)
  await createSnapshot(me, `Before importing ${fileName}`, 'SNAPSHOT')
  const { next, report } = buildImport(tables, getDb(), opts)
  const failed = report.checks.filter((c) => !c.ok)
  if (failed.length) throw new ActionError(`Import stopped — ${failed.length} check(s) did not match: ${failed.map((c) => c.label).join(', ')}. Nothing was changed.`)
  const bytes = JSON.stringify(next).length
  logBackup(next, { by: me.id, kind: 'IMPORT', note: `${fileName}: ${report.imported.clientFiles} client files, ${report.imported.users} new users`, bytes })
  log(next, me.id, 'LEGACY_IMPORT', `${fileName} — ${Object.entries(report.imported).map(([k, v]) => `${k} ${v}`).join(', ')}${opts.replaceSampleData ? ' · sample data removed' : ''}`)
  replaceDb(next)
  await flushSaves()
  return report
}
export async function deleteSnapshot(me: User, id: string) {
  needMaster(me)
  await snapTx('readwrite', (s) => s.delete(id))
}
/** Takes a snapshot when the last one is more than a day old (run when IT opens the dashboard). */
export async function autoSnapshotIfDue(me: User) {
  if (!isMaster(me)) return false
  const last = (await listSnapshots())[0]
  if (last && Date.now() - new Date(last.at).getTime() < 86400000) return false
  await createSnapshot(me, 'Automatic daily snapshot', 'AUTO_SNAPSHOT')
  return true
}

// ================================================================== one-click operations
export function unlockAllAccounts(me: User) {
  needMaster(me)
  return mutate((d) => {
    const n = Object.keys(d.loginFails).length
    d.loginFails = {}
    log(d, me.id, 'UNLOCK_ALL', `${n} sign-in lock(s) cleared`)
    return n
  })
}
export function signOutEveryone(me: User) {
  needMaster(me)
  mutate((d) => { d.settings.sessionsValidAfter = nowIso(); log(d, me.id, 'SIGN_OUT_ALL', 'All sessions ended') })
}
export function setMaintenance(me: User, on: boolean, message: string) {
  needMaster(me)
  mutate((d) => {
    d.settings.maintenance = { on, message: message.trim(), by: me.id, at: nowIso() }
    log(d, me.id, on ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', message.trim() || '—')
  })
}
/** Removes read notifications older than 30 days and activity older than 180 days. */
export function cleanupOldData(me: User) {
  needMaster(me)
  return mutate((d) => {
    const n30 = addDays(new Date(), -30).toISOString(), a180 = addDays(new Date(), -180).toISOString()
    const nb = d.notices.length, ab = d.audit.length
    d.notices = d.notices.filter((n) => !n.read || n.at >= n30)
    d.audit = d.audit.filter((a) => a.at >= a180)
    const removed = { notices: nb - d.notices.length, audit: ab - d.audit.length }
    log(d, me.id, 'CLEANUP', `${removed.notices} old notifications, ${removed.audit} old activity entries removed`)
    return removed
  })
}

// ================================================================== health check
export interface HealthItem { id: string; level: 'ok' | 'warn' | 'error'; title: string; detail: string; fix?: { label: string; run: (me: User) => void | Promise<unknown> } }

export async function runHealthCheck(): Promise<HealthItem[]> {
  const d = getDb()
  const out: HealthItem[] = []
  const add = (i: HealthItem) => out.push(i)
  const active = d.users.filter((u) => u.active)

  const bytes = approxDataBytes()
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  const idbStore = storageBackend() === 'indexeddb'
  const nearFull = idbStore ? !!(est?.quota && est.usage && est.usage / est.quota > 0.8) : bytes > 4_000_000
  add({ id: 'storage', level: nearFull ? 'error' : !idbStore && bytes > 3_000_000 ? 'warn' : 'ok', title: 'Data storage',
    detail: `${(bytes / 1048576).toFixed(1)} MB of CRM data · ${idbStore ? `IndexedDB${est?.quota ? `, browser quota ${(est.quota / 1048576).toFixed(0)} MB` : ''}` : 'localStorage fallback (about 5 MB max) — IndexedDB is blocked in this browser'}` })

  const sas = active.filter((u) => u.role === 'superadmin')
  add({ id: 'sa', level: sas.length ? 'ok' : 'error', title: 'Super Admin', detail: sas.length ? `${sas.length} active Super Admin account(s)` : 'No active Super Admin!' })

  const dupe = (key: 'email' | 'username') => { const seen = new Map<string, number>(); for (const u of d.users) seen.set(u[key].toLowerCase(), (seen.get(u[key].toLowerCase()) ?? 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([k]) => k) }
  const dups = [...dupe('email'), ...dupe('username')]
  add({ id: 'dupes', level: dups.length ? 'error' : 'ok', title: 'Unique sign-in names', detail: dups.length ? `Used more than once: ${dups.join(', ')}` : 'Every email and username is unique' })

  const demo: string[] = []
  for (const u of active) if ((await hashPassword(u.username, DEMO_PASSWORD)) === u.passHash) demo.push(u.name)
  add({ id: 'demo-pw', level: demo.length ? 'warn' : 'ok', title: 'Default passwords', detail: demo.length ? `${demo.length} active account(s) still use the shared demo password: ${demo.slice(0, 5).join(', ')}${demo.length > 5 ? '…' : ''}` : 'No active account uses the demo password' })

  const locked = Object.entries(d.loginFails).filter(([, f]) => f.until && new Date(f.until) > new Date())
  add({ id: 'locks', level: locked.length ? 'warn' : 'ok', title: 'Locked sign-ins', detail: locked.length ? `${locked.length} locked: ${locked.map(([k]) => k).join(', ')}` : 'No accounts are locked', fix: locked.length ? { label: 'Unlock all', run: (me) => { unlockAllAccounts(me) } } : undefined })

  const inactiveIds = new Set(d.users.filter((u) => !u.active).map((u) => u.id))
  const known = new Set(d.users.map((u) => u.id))
  const strandedLeads = d.leads.filter((l) => l.assignedTo && (inactiveIds.has(l.assignedTo) || !known.has(l.assignedTo)))
  add({ id: 'leads', level: strandedLeads.length ? 'warn' : 'ok', title: 'Lead ownership', detail: strandedLeads.length ? `${strandedLeads.length} lead(s) assigned to inactive or deleted users` : 'Every assigned lead has an active owner',
    fix: strandedLeads.length ? { label: 'Unassign them', run: (me) => mutate((x) => { const ids = new Set(strandedLeads.map((l) => l.id)); for (const l of x.leads) if (ids.has(l.id)) l.assignedTo = undefined; log(x, me.id, 'HEALTH_FIX', `${ids.size} stranded lead(s) unassigned`) }) } : undefined })

  const strandedFiles = d.bookings.filter((b) => (b.status === 'IN_OPERATIONS' && b.opsMemberId && inactiveIds.has(b.opsMemberId)) || (b.status === 'WITH_ADMIN' && b.adminId && inactiveIds.has(b.adminId)) || !known.has(b.createdBy))
  add({ id: 'files', level: strandedFiles.length ? 'warn' : 'ok', title: 'Client file ownership', detail: strandedFiles.length ? `${strandedFiles.length} file(s) are with inactive people: ${strandedFiles.slice(0, 3).map((b) => b.bookingId).join(', ')} — reassign them from the file page` : 'Every active file has an active owner' })

  const lastBackup = d.backupLog.find((b) => b.kind !== 'RESTORE')
  const age = lastBackup ? (Date.now() - new Date(lastBackup.at).getTime()) / 86400000 : Infinity
  add({ id: 'backup', level: age > 7 ? 'warn' : 'ok', title: 'Backups', detail: lastBackup ? `Last backup ${Math.floor(age)} day(s) ago (${lastBackup.kind.toLowerCase().replace('_', ' ')})` : 'No backup taken yet',
    fix: age > 1 ? { label: 'Snapshot now', run: (me) => createSnapshot(me, 'Health-check snapshot') } : undefined })

  const oldRead = d.notices.filter((n) => n.read && n.at < addDays(new Date(), -30).toISOString()).length
  add({ id: 'cleanup', level: oldRead > 200 ? 'warn' : 'ok', title: 'Old notifications', detail: `${d.notices.length} notifications stored, ${oldRead} read and older than 30 days`, fix: oldRead ? { label: 'Clean up', run: (me) => { cleanupOldData(me) } } : undefined })

  const keys = d.apiKeys.filter((k) => keyStatus(k) === 'active')
  const expiring = keys.filter((k) => k.expiresAt && new Date(k.expiresAt).getTime() - Date.now() < 14 * 86400000)
  add({ id: 'keys', level: expiring.length ? 'warn' : 'ok', title: 'API keys', detail: `${keys.length} active${expiring.length ? ` · ${expiring.length} expire within 14 days: ${expiring.map((k) => k.name).join(', ')}` : ''}` })

  const cloud = await pingCloud()
  add({ id: 'cloud', level: cloud.ok ? 'ok' : cloudConfig().status === 'not-configured' ? 'warn' : 'error', title: 'Cloud database (Supabase)', detail: cloud.detail })

  if (d.settings.maintenance?.on) add({ id: 'maint', level: 'warn', title: 'Maintenance mode is ON', detail: 'Only IT Support and Super Admin can use the app.', fix: { label: 'Turn off', run: (me) => setMaintenance(me, false, '') } })
  return out
}
