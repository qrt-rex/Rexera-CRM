import type { DB, DeletedItem, FileRef, User } from './types'
import { getDb, mutate } from './store'
import { rolesOf } from './rbac'
import { deleteFile } from './files'
import { downloadCsv, nowIso, uid } from './format'

/**
 * Deleted files: before anything is deleted anywhere in the CRM, a full copy goes to the IT Support dashboard. Nothing
 * is gone for good — not the record, not its stored files — until IT Support reviews the copy and deletes it.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg) }

const isFileRef = (v: unknown): v is FileRef => !!v && typeof v === 'object' && typeof (v as FileRef).id === 'string' && typeof (v as FileRef).name === 'string' && typeof (v as FileRef).size === 'number'
/** Every stored file inside a record (documents, uploads, resumes, proofs …). */
export function filesIn(v: unknown, out = new Map<string, FileRef>()): FileRef[] {
  if (isFileRef(v)) out.set(v.id, { id: v.id, name: v.name, type: v.type, size: v.size, at: v.at })
  else if (Array.isArray(v)) for (const x of v) filesIn(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) filesIn(x, out)
  return [...out.values()]
}

/**
 * Call inside the mutate that deletes, before removing: keeps an exact copy (works on Immer drafts). `data` may be one
 * record or a list (a bulk delete is one backup holding every row).
 */
export function archiveDeleted(d: DB, by: string, x: { module: string; kind: string; label: string; data: unknown }) {
  const data = JSON.parse(JSON.stringify(x.data ?? null)) as unknown
  const files = filesIn(data)
  const item: DeletedItem = {
    id: uid('del-'), module: x.module, kind: x.kind, label: x.label.slice(0, 200), rows: Array.isArray(data) ? data.length : 1, data,
    ...(files.length ? { files } : {}), deletedBy: by, deletedAt: nowIso(),
  }
  d.deletedItems = [item, ...(d.deletedItems ?? [])]
  return item
}

// ------------------------------------------------------------------ IT Support: review and delete for good
export const mayReviewDeleted = (u: User) => rolesOf(u).includes('it')

/** Permanently deletes the backup and the stored files that were part of it. IT Support only. */
export async function purgeDeleted(me: User, ids: string[]) {
  assert(mayReviewDeleted(me), 'Only IT Support deletes backups for good.')
  const items = (getDb().deletedItems ?? []).filter((x) => ids.includes(x.id))
  assert(items.length, 'Backup not found.')
  // a stored file still used by a live record (or another backup) is not removed
  const keep = new Set(filesIn(Object.fromEntries(Object.entries(getDb()).filter(([k]) => k !== 'deletedItems'))).map((f) => f.id))
  for (const f of (getDb().deletedItems ?? []).filter((x) => !ids.includes(x.id)).flatMap((x) => x.files ?? [])) keep.add(f.id)
  mutate((d) => {
    d.deletedItems = (d.deletedItems ?? []).filter((x) => !ids.includes(x.id))
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'DELETED_PURGE', detail: items.length === 1 ? `${items[0]!.module} · ${items[0]!.kind}: ${items[0]!.label}` : `${items.length} backups deleted for good` })
  })
  for (const f of items.flatMap((x) => x.files ?? [])) if (!keep.has(f.id)) await deleteFile(f.id).catch(() => undefined)
}

// ------------------------------------------------------------------ backups as CSV / Excel / JSON
const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v)
/** The backup as table rows: one per record, nested parts as JSON text. */
export function backupRows(item: DeletedItem): Record<string, unknown>[] {
  const list = Array.isArray(item.data) ? item.data : [item.data]
  return list.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])) : { value: cell(r) }))
}
const baseName = (item: DeletedItem) => `deleted-${item.module}-${item.kind}-${item.label}`.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 90)
export type BackupFormat = 'CSV' | 'EXCEL' | 'JSON'
export const BACKUP_FORMATS: BackupFormat[] = ['CSV', 'EXCEL', 'JSON']

export async function downloadBackup(item: DeletedItem, format: BackupFormat) {
  if (format === 'CSV') return downloadCsv(`${baseName(item)}.csv`, backupRows(item))
  if (format === 'EXCEL') {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRows(item)), item.kind.slice(0, 31) || 'Backup')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ module: item.module, kind: item.kind, name: item.label, records: item.rows, deleted_by: item.deletedBy, deleted_at: item.deletedAt, files: (item.files ?? []).map((f) => f.name).join(', ') }]), 'About')
    XLSX.writeFile(wb, `${baseName(item)}.xlsx`)
    return
  }
  const blob = new Blob([JSON.stringify({ module: item.module, kind: item.kind, name: item.label, deletedBy: item.deletedBy, deletedAt: item.deletedAt, files: item.files ?? [], data: item.data }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${baseName(item)}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
