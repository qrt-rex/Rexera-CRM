import type { FileRef } from './types'
import { nowIso, uid } from './format'
import { CLOUD } from './cloud'
import { getSupabase } from './supabase'

/**
 * Uploaded files (resumes, leave attachments, candidate CVs, payment proofs, client documents) live in their own
 * IndexedDB store so the main data document stays small and quick to save. Records keep only a FileRef.
 * With Supabase (VITE_DATA_BACKEND=supabase) every file is also stored in the private "crm-files" bucket, so anyone
 * signed in can open it on any computer; this browser keeps a copy.
 */
const BUCKET = 'crm-files'
const bucket = async () => (await getSupabase()).storage.from(BUCKET)
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
  if (CLOUD) {
    const { error } = await (await bucket()).upload(ref.id, f, { contentType: ref.type, upsert: false })
    if (error) throw new Error(`Could not upload ${f.name}: ${error.message}`)
  }
  await tx('readwrite', (s) => { s.put({ ...ref, blob: f }) })
  return ref
}
export async function getFile(id: string): Promise<Blob | undefined> {
  const row = await tx<{ blob: Blob } | undefined>('readonly', (s) => s.get(id) as IDBRequest<{ blob: Blob } | undefined>)
  if (row?.blob || !CLOUD) return row?.blob
  // added on another computer: fetch it once and keep a copy here
  const { data } = await (await bucket()).download(id)
  if (data) await tx('readwrite', (s) => { s.put({ id, blob: data }) }).catch(() => undefined)
  return data ?? undefined
}
export async function deleteFile(id: string) {
  await tx('readwrite', (s) => { s.delete(id) })
  if (CLOUD) await (await bucket()).remove([id]).catch(() => undefined)
}

/** Opens the file in a new tab (PDF / image) or downloads it. */
export async function openFile(ref: FileRef, download = false) {
  // the tab opens straight away, while this is still the click: opened after loading the file, browsers block it
  const viewer = !download && /^(application\/pdf|image\/)/.test(ref.type) ? window.open('', '_blank') : null
  if (viewer) viewer.opener = null
  const blob = await getFile(ref.id).catch(() => undefined)
  if (!blob) {
    viewer?.close()
    throw new Error(CLOUD ? 'This file could not be found.' : 'This file is not stored in this browser (it may have been added on another computer).')
  }
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: ref.type }))
  if (viewer) viewer.location.href = url
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
/** Every uploaded file the CRM data points at (proofs, documents, resumes, attachments, bills…), wherever it sits. */
export function fileRefsIn(data: unknown): FileRef[] {
  const out = new Map<string, FileRef>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.id === 'string' && typeof o.name === 'string' && typeof o.type === 'string' && typeof o.size === 'number' && typeof o.at === 'string') out.set(o.id, o as unknown as FileRef)
    else Object.values(o).forEach(walk)
  }
  walk(data)
  return [...out.values()]
}

/**
 * Files added in the CRM. Old-CRM files (gigabytes) are left out — they can be attached again from the export folder.
 * With Supabase, `refs` (the files the data points at) are fetched from the bucket when this browser has no copy;
 * `missing` lists any that couldn't be fetched.
 */
export async function exportFiles(refs?: FileRef[]): Promise<{ files: StoredFile[]; missing: FileRef[] }> {
  const files: StoredFile[] = [], missing: FileRef[] = []
  if (CLOUD && refs) {
    const todo = refs.filter((r) => !r.id.startsWith('lg-f-'))
    const worker = async () => {
      for (let r = todo.shift(); r; r = todo.shift()) {
        const blob = await getFile(r.id).catch(() => undefined)
        if (blob) files.push({ ...r, data: await toB64(blob) }); else missing.push(r)
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    return { files, missing }
  }
  const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String).filter((k) => !k.startsWith('lg-f-'))
  for (const id of keys) {
    const row = await tx<(FileRef & { blob: Blob }) | undefined>('readonly', (s) => s.get(id) as IDBRequest<(FileRef & { blob: Blob }) | undefined>)
    if (row) { const { blob, ...ref } = row; files.push({ ...ref, data: await toB64(blob) }) }
  }
  return { files, missing }
}
export async function importFiles(list: StoredFile[]) {
  for (const { data, ...ref } of list) {
    const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: ref.type })
    await tx('readwrite', (s) => { s.put({ ...ref, blob }) })
  }
}
