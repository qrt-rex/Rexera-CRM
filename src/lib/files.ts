import type { FileRef } from './types'
import { nowIso, uid } from './format'

/**
 * Uploaded files (resumes, leave attachments, candidate CVs) live in their own IndexedDB store so the main data
 * document stays small and quick to save. Records keep only a FileRef.
 */
const DB_NAME = 'rexera-files', STORE = 'files'

export const DOC_TYPES = 'application/pdf,image/png,image/jpeg,image/webp'
export const RESUME_TYPES = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MAX_FILE_BYTES = 5 * 1024 * 1024

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open()
  return new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => { res((req ? req.result : undefined) as T); db.close() }
    t.onerror = () => { rej(t.error); db.close() }
  })
}

/** Checks type and size; throws a readable error. `accept` is a comma list of MIME types / extensions. */
export function checkFile(f: File, accept: string, label: string) {
  if (f.size > MAX_FILE_BYTES) throw new Error(`${label} is too large (max 5 MB).`)
  const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
  const ok = accept.split(',').some((a) => { a = a.trim().toLowerCase(); return a.startsWith('.') ? a === ext : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : a === f.type })
  if (!ok) throw new Error(`${label}: this file type isn't allowed.`)
}

export async function saveFile(f: File): Promise<FileRef> {
  const ref: FileRef = { id: uid('file-'), name: f.name, type: f.type || 'application/octet-stream', size: f.size, at: nowIso() }
  await tx('readwrite', (s) => { s.put({ ...ref, blob: f }) })
  return ref
}
export async function getFile(id: string): Promise<Blob | undefined> {
  const row = await tx<{ blob: Blob } | undefined>('readonly', (s) => s.get(id) as IDBRequest<{ blob: Blob } | undefined>)
  return row?.blob
}
export async function deleteFile(id: string) { await tx('readwrite', (s) => { s.delete(id) }) }

/** Opens the file in a new tab (PDF / image) or downloads it. */
export async function openFile(ref: FileRef, download = false) {
  const blob = await getFile(ref.id)
  if (!blob) throw new Error('This file is not stored in this browser (it may have been added on another computer).')
  const url = URL.createObjectURL(blob)
  if (!download && /^(application\/pdf|image\/)/.test(ref.type)) window.open(url, '_blank', 'noopener')
  else { const a = document.createElement('a'); a.href = url; a.download = ref.name; a.click() }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const fileSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// ------------------------------------------------------------------ old CRM files (ids start with lg-f-, see legacyFiles.ts)
/** Ids of the old-CRM files already stored in this browser. */
export async function storedLegacyIds(): Promise<Set<string>> {
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys(IDBKeyRange.bound('lg-f-', 'lg-f-￿')))
  return new Set((keys ?? []).map(String))
}
/** Stores several files in one transaction (much quicker than one by one for thousands of files). */
export async function putFiles(rows: { ref: FileRef; blob: Blob }[]) {
  await tx('readwrite', (s) => { for (const { ref, blob } of rows) s.put({ ...ref, blob }) })
}
/** Space this browser still allows (bytes), and asks it not to clear our data when the disk gets full. */
export async function storageRoom() {
  const persisted = await navigator.storage?.persist?.().catch(() => false)
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  return { free: est?.quota != null ? est.quota - (est.usage ?? 0) : null, quota: est?.quota ?? null, used: est?.usage ?? null, persisted: !!persisted }
}

// ------------------------------------------------------------------ backups
export interface StoredFile extends FileRef { data: string }
const toB64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(b) })
/** Files added in the CRM. Old-CRM files (gigabytes) are left out — they can be attached again from the export folder. */
export async function exportFiles(): Promise<StoredFile[]> {
  const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String).filter((k) => !k.startsWith('lg-f-'))
  const out: StoredFile[] = []
  for (const id of keys) {
    const row = await tx<(FileRef & { blob: Blob }) | undefined>('readonly', (s) => s.get(id) as IDBRequest<(FileRef & { blob: Blob }) | undefined>)
    if (row) { const { blob, ...ref } = row; out.push({ ...ref, data: await toB64(blob) }) }
  }
  return out
}
export async function importFiles(list: StoredFile[]) {
  for (const { data, ...ref } of list) {
    const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: ref.type })
    await tx('readwrite', (s) => { s.put({ ...ref, blob }) })
  }
}
