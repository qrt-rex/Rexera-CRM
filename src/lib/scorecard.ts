import type { DB, User } from './types'
import { addDays, fmtDate, fmtDateTime, today, ymd } from './format'
import { branchName } from './branches'

/**
 * Sales scorecard (like the monthly "BRD SCORECARD" sheet): rank, person, target, collection achieved till date,
 * pending and achievement % for a day, a week, a month or a financial year. Money is what clients paid, with GST.
 * Targets are monthly on each person; a day / week is that share of the month and a year is twelve months.
 */
export type ScorePeriod = 'day' | 'week' | 'month' | 'year'
export const SCORE_PERIODS: { id: ScorePeriod; label: string }[] = [
  { id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'year', label: 'Yearly' },
]

export interface ScoreRow { rank: number; user: User; branch: string; target: number; collected: number; pending: number; pct: number | null }
export interface ScoreTotals { target: number; collected: number; pending: number; pct: number | null }
export interface Scorecard {
  period: ScorePeriod; from: string; to: string; tillDate: string; label: string; title: string
  rows: ScoreRow[]; total: ScoreTotals; branches: { name: string; people: number; total: ScoreTotals }[]
}

const local = (s: string) => new Date(s + 'T00:00:00')
const daysIn = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const mon = (d: Date) => MONTHS[d.getMonth()]!
const yy = (d: Date) => String(d.getFullYear()).slice(2)
const dd = (d: Date) => String(d.getDate()).padStart(2, '0')

/** First and last day of the period that contains `on`, and its sheet label (OCT-26, FY 2026-27 …). */
export function periodRange(period: ScorePeriod, on: string) {
  const d = local(on)
  if (period === 'day') return { from: on, to: on, label: `${dd(d)}-${mon(d)}-${yy(d)}`, share: 1 / daysIn(d) }
  if (period === 'week') {
    const start = addDays(d, -((d.getDay() + 6) % 7)), end = addDays(start, 6) // Monday – Sunday
    return { from: ymd(start), to: ymd(end), label: `${dd(start)}-${mon(start)} TO ${dd(end)}-${mon(end)}-${yy(end)}`, share: 7 / daysIn(d) }
  }
  if (period === 'month') {
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: `${mon(d)}-${yy(d)}`, share: 1 }
  }
  const fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1 // Indian financial year, April – March
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY ${fy}-${String(fy + 1).slice(2)}`, share: 12 }
}

const totals = (rows: { target: number; collected: number }[]): ScoreTotals => {
  const target = rows.reduce((s, r) => s + r.target, 0), collected = rows.reduce((s, r) => s + r.collected, 0)
  return { target, collected, pending: target - collected, pct: target ? Math.round((collected / target) * 100) : null }
}

/** The scorecard for these people; `scopeName` heads the sheet (a branch name, or "All branches"). */
export function buildScorecard(db: DB, people: User[], period: ScorePeriod, on: string, scopeName: string): Scorecard {
  const r = periodRange(period, on)
  const tillDate = r.to < today() ? r.to : today()
  const got = new Map<string, number>()
  const ids = new Set(people.map((u) => u.id))
  for (const b of db.bookings) {
    if (!ids.has(b.createdBy) || b.status === 'REJECTED') continue
    for (const p of b.payments) if (p.date >= r.from && p.date <= tillDate) got.set(b.createdBy, (got.get(b.createdBy) ?? 0) + p.total)
  }
  const rows = people.map((u) => {
    const target = Math.round((u.target ?? 0) * r.share), collected = Math.round(got.get(u.id) ?? 0)
    return { rank: 0, user: u, branch: branchName(db, u.branchId), target, collected, pending: target - collected, pct: target ? Math.round((collected / target) * 100) : null }
  }).sort((a, b) => b.collected - a.collected || (b.pct ?? -1) - (a.pct ?? -1) || a.user.name.localeCompare(b.user.name))
  rows.forEach((x, i) => { x.rank = i + 1 })
  const byBranch = new Map<string, ScoreRow[]>()
  for (const x of rows) byBranch.set(x.branch, [...(byBranch.get(x.branch) ?? []), x])
  return {
    period, from: r.from, to: r.to, tillDate, label: r.label,
    title: `${scopeName} SCORECARD ${r.label}`.toUpperCase(),
    rows, total: totals(rows),
    branches: [...byBranch.entries()].map(([name, list]) => ({ name, people: list.length, total: totals(list) })).sort((a, b) => b.total.collected - a.total.collected),
  }
}

/** ₹1,64,000 / -₹2,25,329 — whole rupees, Indian grouping. */
export const money = (n: number, sym = '₹') => `${n < 0 ? '-' : ''}${sym}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`
export const pctText = (p: number | null) => (p === null ? '—' : `${p}%`)
const fileName = (c: Scorecard) => `scorecard-${c.title.replace(/ SCORECARD.*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${c.period}-${c.from}`

/** The scorecard as a PNG picture (title box, blue header, peach rows, grand total — like the monthly sheet), downloaded at once. */
export async function scorecardImage(c: Scorecard, company: string) {
  const multi = c.branches.length > 1
  type Align = 'left' | 'center' | 'right'
  const cols: { h: string[]; w: number; a: Align }[] = [
    { h: ['RANK'], w: 64, a: 'center' }, { h: ['EMPLOYEE NAMES'], w: multi ? 230 : 270, a: 'left' }, ...(multi ? [{ h: ['BRANCH'], w: 150, a: 'left' as const }] : []),
    { h: ['TARGET', c.label], w: 130, a: 'right' }, { h: ['COLLECTION', 'ACH. TILL DATE'], w: 150, a: 'right' }, { h: ['PENDING'], w: 125, a: 'right' }, { h: ['ACH.', 'PERCENTAGE'], w: 130, a: 'right' },
  ]
  const W = cols.reduce((s, x) => s + x.w, 0), PAD = 16, ROW = 26, HEAD_H = 52, TITLE_H = 54
  const branchH = multi ? 40 + 34 + (c.branches.length + 1) * ROW : 0
  const H = PAD + TITLE_H + HEAD_H + (c.rows.length + 1) * ROW + branchH + 34
  const scale = 2 // sharp on phones and when zoomed
  const cv = document.createElement('canvas')
  cv.width = (W + PAD * 2) * scale; cv.height = H * scale
  const g = cv.getContext('2d')
  if (!g) throw new Error('This browser cannot make images.')
  g.scale(scale, scale)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W + PAD * 2, H)
  g.lineWidth = 1; g.strokeStyle = '#1f1f1f'; g.textBaseline = 'middle'
  const SANS = 'Calibri, "Segoe UI", Arial, sans-serif'
  let y = PAD

  const cell = (x: number, w: number, h: number, fill: string, lines: string[], a: Align, font: string, color = '#141414') => {
    g.fillStyle = fill; g.fillRect(x, y, w, h); g.strokeRect(x + 0.5, y + 0.5, w, h)
    g.fillStyle = color; g.font = font; g.textAlign = a
    const tx = a === 'left' ? x + 8 : a === 'right' ? x + w - 8 : x + w / 2, lh = 15
    lines.forEach((s, i) => g.fillText(s, tx, y + h / 2 + (i - (lines.length - 1) / 2) * lh, w - 12))
  }
  const row = (ws: number[], aligns: Align[], cells: string[], h: number, fill: string, font: string, colors: (string | undefined)[] = []) => {
    let x = PAD
    cells.forEach((s, i) => { cell(x, ws[i]!, h, fill, s.split('\n'), aligns[i]!, font, colors[i]); x += ws[i]! })
    y += h
  }
  const tone = (p: number | null) => (p === null ? '#6b7280' : p >= 100 ? '#047857' : p >= 60 ? '#141414' : '#b91c1c')
  const BOLD = `bold 15px ${SANS}`, HEAD = `bold 13px ${SANS}`, HEAD_BG = '#DCE6F1', BODY_BG = '#F8CBAD'

  // title
  cell(PAD, W, TITLE_H, '#ffffff', [c.title], 'center', `bold 28px Cambria, Georgia, "Times New Roman", serif`); y += TITLE_H
  const ws = cols.map((x) => x.w), al = cols.map((x) => x.a)
  row(ws, cols.map(() => 'center' as Align), cols.map((x) => x.h.join('\n')), HEAD_H, HEAD_BG, HEAD)
  for (const r of c.rows) {
    row(ws, al, [String(r.rank), r.user.name.toUpperCase(), ...(multi ? [r.branch] : []), money(r.target), money(r.collected), money(r.pending), pctText(r.pct)], ROW, BODY_BG, BOLD,
      [undefined, undefined, ...(multi ? [undefined] : []), undefined, undefined, r.pending < 0 ? '#047857' : undefined, tone(r.pct)])
  }
  row(ws, ['center', 'center', ...(multi ? ['center' as Align] : []), 'right', 'right', 'right', 'right'],
    ['', 'GRAND TOTAL', ...(multi ? [''] : []), money(c.total.target), money(c.total.collected), money(c.total.pending), pctText(c.total.pct)], ROW, '#ffffff', BOLD)

  if (multi) {
    y += 24
    g.fillStyle = '#141414'; g.font = `bold 16px ${SANS}`; g.textAlign = 'left'; g.fillText('BRANCH-WISE', PAD, y + 8); y += 22
    const k = W / 640, bw = [220, 70, 90, 100, 90, 70].map((x) => x * k), ba: Align[] = ['left', 'center', 'right', 'right', 'right', 'right']
    row(bw, bw.map(() => 'center' as Align), ['BRANCH', 'PEOPLE', 'TARGET', 'COLLECTION', 'PENDING', 'ACH. %'], 34, HEAD_BG, HEAD)
    for (const b of c.branches) row(bw, ba, [b.name, String(b.people), money(b.total.target), money(b.total.collected), money(b.total.pending), pctText(b.total.pct)], ROW, BODY_BG, BOLD,
      [undefined, undefined, undefined, undefined, b.total.pending < 0 ? '#047857' : undefined, tone(b.total.pct)])
    row(bw, ['center', 'center', 'right', 'right', 'right', 'right'], ['GRAND TOTAL', String(c.rows.length), money(c.total.target), money(c.total.collected), money(c.total.pending), pctText(c.total.pct)], ROW, '#ffffff', BOLD)
  }

  g.fillStyle = '#6b7280'; g.font = `12px ${SANS}`; g.textAlign = 'left'
  g.fillText(`${company} · ${fmtDate(c.from)} – ${fmtDate(c.to)} · collections till ${fmtDate(c.tillDate)}, with GST · made ${fmtDateTime(new Date().toISOString())}`, PAD, H - 16)

  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not make the image.')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${fileName(c)}.png`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
