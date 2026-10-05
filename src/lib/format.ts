import type { Booking, Invoice } from './types'

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })
const inrCompactFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })

export const inr = (n: number) => inrFmt.format(Math.round((n || 0) * 100) / 100)
export function inrShort(n: number) {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${inrCompactFmt.format(n / 1e7)} Cr`
  if (a >= 1e5) return `₹${inrCompactFmt.format(n / 1e5)} L`
  if (a >= 1e3) return `₹${inrCompactFmt.format(n / 1e3)} K`
  return inr(n)
}
export const round2 = (n: number) => Math.round(n * 100) / 100

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
export const nowIso = () => new Date().toISOString()

/** Local YYYY-MM-DD (IST in practice). */
export function ymd(d: Date | string = new Date()) {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export const today = () => ymd()
export function addDays(d: Date | string, n: number) {
  const x = new Date(typeof d === 'string' ? d : d.getTime())
  x.setDate(x.getDate() + n)
  return x
}
export const fmtDate = (d?: string) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtTime = (d?: string) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--')
export const fmtDateTime = (d?: string) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—')

export function ago(d: string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return fmtDate(d)
}
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

// ---------- validators ----------
export const normPhone = (p: string) => p.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').slice(-10)
export const isPhone = (p: string) => /^[6-9]\d{9}$/.test(normPhone(p))
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
export const isPan = (p: string) => /^[A-Z]{5}\d{4}[A-Z]$/.test(p.toUpperCase())
export const isGstin = (g: string) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g.toUpperCase())
export const isPin = (p: string) => /^[1-9]\d{5}$/.test(p)

// ---------- GST & booking money ----------
export function gstSplit(amount: number, rate: number, clientState: string, supplierState: string) {
  const tax = round2((amount * rate) / 100)
  const intra = clientState.trim().toLowerCase() === supplierState.trim().toLowerCase()
  return intra ? { cgst: round2(tax / 2), sgst: round2(tax / 2), igst: 0, tax } : { cgst: 0, sgst: 0, igst: tax, tax }
}

export function bookingMoney(b: Booking) {
  const quotedWithGst = round2(b.totalQuoted * (1 + b.gstRate / 100))
  const collected = round2(b.payments.reduce((s, p) => s + p.total, 0))
  const collectedBase = round2(b.payments.reduce((s, p) => s + p.amount, 0))
  const outstanding = Math.max(0, round2(quotedWithGst - collected))
  const pct = quotedWithGst ? Math.min(100, Math.round((collected / quotedWithGst) * 100)) : 0
  return { quotedWithGst, collected, collectedBase, outstanding, pct }
}

export function invoiceTotals(inv: Invoice, supplierState: string) {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0
  for (const it of inv.items) {
    const t = round2(it.qty * it.rate)
    taxable += t
    const g = gstSplit(t, it.gstRate, inv.state, supplierState)
    cgst += g.cgst; sgst += g.sgst; igst += g.igst
  }
  const grand = round2(taxable + cgst + sgst + igst)
  return { taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), grand, balance: round2(grand - inv.paid) }
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function two(n: number): string { return n < 20 ? ones[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}` }
function three(n: number): string { return n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n) }
export function rupeesInWords(n: number) {
  let r = Math.floor(n)
  const paise = Math.round((n - r) * 100)
  if (r === 0 && !paise) return 'Zero Rupees Only'
  const parts: string[] = []
  const cr = Math.floor(r / 1e7); r %= 1e7
  const lk = Math.floor(r / 1e5); r %= 1e5
  const th = Math.floor(r / 1e3); r %= 1e3
  if (cr) parts.push(`${three(cr)} Crore`)
  if (lk) parts.push(`${two(lk)} Lakh`)
  if (th) parts.push(`${two(th)} Thousand`)
  if (r) parts.push(three(r))
  return `${parts.join(' ')} Rupees${paise ? ` and ${two(paise)} Paise` : ''} Only`
}

// ---------- CSV ----------
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0]!)
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function parseCsv(text: string): Record<string, string>[] {
  const [head, ...body] = parseCsvRows(text)
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

/** Raw CSV (or other single-character delimiter) → rows of cells; blank lines dropped. */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  text = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === delimiter) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
]
