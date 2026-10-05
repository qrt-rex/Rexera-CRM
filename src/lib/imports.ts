import { useEffect, useState } from 'react'
import { parseCsvRows, uid, nowIso } from './format'

/**
 * Imported tables (Recruitment → Import). Every CSV file, and every non-empty sheet of an Excel workbook,
 * becomes one table with its own columns. Tables live in this browser's IndexedDB, which holds far more
 * than localStorage, and are shared by everyone who signs in on this browser.
 */
export interface Dataset {
  id: string
  name: string
  fileName: string
  sheet?: string
  kind: 'csv' | 'excel'
  columns: string[]
  rows: string[][]
  importedAt: string
  importedBy: string
  bytes: number
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods'

// ------------------------------------------------------------------ IndexedDB
const DB_NAME = 'rexera-imports'
const STORE = 'datasets'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Browser storage is unavailable.'))
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => { resolve(req ? req.result : undefined); db.close() }
    t.onerror = () => { reject(t.error ?? new Error('Saving failed.')); db.close() }
    t.onabort = () => { reject(t.error ?? new Error('Saving failed — the browser may be out of storage space.')); db.close() }
  })
}

let cache: Dataset[] | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rexera-imports') : null
channel?.addEventListener('message', () => { cache = null; emit() })

export async function listDatasets(): Promise<Dataset[]> {
  if (cache) return cache
  const all = ((await tx<Dataset[]>('readonly', (s) => s.getAll() as IDBRequest<Dataset[]>)) ?? []).sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  cache = all
  return all
}
async function changed() { cache = null; emit(); channel?.postMessage('changed') }
export async function saveDatasets(list: Dataset[]) { await tx('readwrite', (s) => { for (const d of list) s.put(d) }); await changed() }
export async function deleteDataset(id: string) { await tx('readwrite', (s) => s.delete(id)); await changed() }
export async function renameDataset(d: Dataset, name: string) { await tx('readwrite', (s) => s.put({ ...d, name: name.trim() || d.name })); await changed() }

export function useDatasets() {
  const [state, setState] = useState<{ list: Dataset[]; loading: boolean; error: string }>({ list: cache ?? [], loading: !cache, error: '' })
  useEffect(() => {
    let on = true
    const load = () => listDatasets().then((list) => on && setState({ list, loading: false, error: '' }), (e: Error) => on && setState({ list: [], loading: false, error: e.message }))
    load()
    listeners.add(load)
    return () => { on = false; listeners.delete(load) }
  }, [])
  return state
}

// ------------------------------------------------------------------ parsing
/** First non-empty row is the header; blank or repeated headers get unique names; empty rows dropped. */
function toTable(raw: unknown[][]): { columns: string[]; rows: string[][] } | null {
  const cells = raw.map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
  const nonEmpty = cells.filter((r) => r.some((c) => c !== ''))
  if (!nonEmpty.length) return null
  const [head, ...body] = nonEmpty as [string[], ...string[][]]
  const width = Math.max(head.length, ...body.map((r) => r.length))
  const seen = new Map<string, number>()
  const columns = Array.from({ length: width }, (_, i) => {
    const base = head[i] || `Column ${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
  const rows = body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  return { columns, rows }
}

export async function parseFile(file: File, by: string): Promise<Dataset[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25 MB.`)
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const base = { fileName: file.name, importedAt: nowIso(), importedBy: by, bytes: file.size }
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    const text = await file.text()
    const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : undefined)
    const delimiter = ext === 'tsv' || (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
    const t = toTable(parseCsvRows(text, delimiter))
    if (!t) throw new Error(`${file.name} has no data.`)
    return [{ ...base, ...t, id: uid('ds-'), name: file.name.replace(/\.[^.]+$/, ''), kind: 'csv' }]
  }
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: true })
    const out: Dataset[] = []
    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet]
      if (!ws) continue
      // formatted text as Excel shows it, except real dates, which are written the Indian way (05 Oct 2026)
      const shown = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
      const values = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: false })
      const t = toTable(shown.map((r, i) => r.map((c, j) => {
        const v = values[i]?.[j]
        if (!(v instanceof Date) || Number.isNaN(v.getTime())) return c
        const day = v.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        return v.getHours() || v.getMinutes() ? `${day} ${v.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : day
      })))
      if (!t) continue
      const name = file.name.replace(/\.[^.]+$/, '')
      out.push({ ...base, ...t, id: uid('ds-'), name: wb.SheetNames.length > 1 ? `${name} · ${sheet}` : name, sheet, kind: 'excel' })
    }
    if (!out.length) throw new Error(`${file.name} has no data in any sheet.`)
    return out
  }
  throw new Error(`${file.name}: use a CSV or Excel file (.csv, .xlsx, .xls, .ods).`)
}
