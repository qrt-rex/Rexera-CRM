/**
 * Automatic filters for imported tables: each column is profiled once and gets the filter that suits its data.
 *   choice — a handful of distinct values (Stage, City, Source…) → pick one or more
 *   number — mostly numeric (Experience, CTC, Score…)         → min / max
 *   date   — mostly dates (Applied On…)                       → from / to
 *   text   — everything else (Name, Phone, Email…)            → contains
 */
export type ColumnKind = 'choice' | 'number' | 'date' | 'text'
export interface ColumnProfile { kind: ColumnKind; values: { value: string; count: number }[]; min?: number; max?: number; from?: string; to?: string; filled: number }
export type ColumnFilter =
  | { kind: 'choice'; values: string[] }
  | { kind: 'number'; min: string; max: string }
  | { kind: 'date'; from: string; to: string }
  | { kind: 'text'; q: string }

export const toNumber = (s: string) => {
  const t = s.replace(/[₹,\s%]/g, '').replace(/^rs\.?/i, '')
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null
  return Number(t)
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200
/** Recognised dates → YYYY-MM-DD: 2026-10-05 · 05 Oct 2026 / 5-Sept-26 · 05/10/2026 (day first, Indian style). */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}.*$/, '')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) { const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!]; return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null }
  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})$/)
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3)]
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!
    return mo && valid(y, mo, +m[1]!) ? `${y}-${pad(mo)}-${pad(+m[1]!)}` : null
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) { const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!; return valid(y, +m[2]!, +m[1]!) ? `${y}-${pad(+m[2]!)}-${pad(+m[1]!)}` : null }
  return null
}

export function profileColumns(columns: string[], rows: string[][]): ColumnProfile[] {
  return columns.map((_, i) => {
    const counts = new Map<string, number>()
    let nums = 0, dates = 0, filled = 0
    let min = Infinity, max = -Infinity, from = '9999-12-31', to = '0000-01-01'
    for (const r of rows) {
      const v = (r[i] ?? '').trim()
      if (!v) continue
      filled++
      counts.set(v, (counts.get(v) ?? 0) + 1)
      const n = toNumber(v)
      if (n !== null) { nums++; if (n < min) min = n; if (n > max) max = n }
      const d = n === null ? toIsoDate(v) : null
      if (d) { dates++; if (d < from) from = d; if (d > to) to = d }
    }
    const values = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'en', { numeric: true }))
    const distinct = values.length
    const share = (k: number) => (filled ? k / filled : 0)
    // phone-like columns (10+ digit numbers, all different) read better as text search than as a range
    const phoneLike = share(nums) >= 0.8 && Math.abs(min) >= 1e9 && distinct === filled
    let kind: ColumnKind
    if (!filled) kind = 'text'
    else if (distinct <= 12 && distinct < filled) kind = 'choice'
    else if (share(nums) >= 0.8 && !phoneLike) kind = 'number'
    else if (share(dates) >= 0.8) kind = 'date'
    else if (distinct <= 30 && distinct <= filled * 0.6) kind = 'choice'
    else kind = 'text'
    return { kind, values, filled, ...(kind === 'number' ? { min, max } : {}), ...(kind === 'date' ? { from, to } : {}) }
  })
}

export const emptyFilter = (p: ColumnProfile): ColumnFilter =>
  p.kind === 'choice' ? { kind: 'choice', values: [] } : p.kind === 'number' ? { kind: 'number', min: '', max: '' } : p.kind === 'date' ? { kind: 'date', from: '', to: '' } : { kind: 'text', q: '' }

export function isActive(f?: ColumnFilter) {
  if (!f) return false
  return f.kind === 'choice' ? f.values.length > 0 : f.kind === 'number' ? f.min !== '' || f.max !== '' : f.kind === 'date' ? !!(f.from || f.to) : f.q.trim() !== ''
}

export function matches(cell: string, f: ColumnFilter) {
  const v = (cell ?? '').trim()
  switch (f.kind) {
    case 'choice': return !f.values.length || f.values.includes(v)
    case 'text': return !f.q.trim() || v.toLowerCase().includes(f.q.trim().toLowerCase())
    case 'number': {
      if (f.min === '' && f.max === '') return true
      const n = toNumber(v)
      return n !== null && (f.min === '' || n >= Number(f.min)) && (f.max === '' || n <= Number(f.max))
    }
    case 'date': {
      if (!f.from && !f.to) return true
      const d = toIsoDate(v)
      return !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to)
    }
  }
}

export function describe(column: string, f: ColumnFilter) {
  switch (f.kind) {
    case 'choice': return `${column}: ${f.values.length > 2 ? `${f.values.slice(0, 2).join(', ')} +${f.values.length - 2}` : f.values.join(', ')}`
    case 'text': return `${column} contains “${f.q.trim()}”`
    case 'number': return `${column} ${f.min !== '' && f.max !== '' ? `${f.min}–${f.max}` : f.min !== '' ? `≥ ${f.min}` : `≤ ${f.max}`}`
    case 'date': return `${column} ${f.from && f.to ? `${f.from} → ${f.to}` : f.from ? `from ${f.from}` : `until ${f.to}`}`
  }
}
