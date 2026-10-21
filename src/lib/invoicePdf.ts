import type { DB, Invoice } from './types'
import { userName } from './actions'
import { fmtDate, gstSplit, invoiceTotals, rupeesInWords } from './format'

/** jsPDF's built-in fonts have no ₹ or curly quotes. */
const t = (s: unknown) => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/·/g, '|')
const rs = (n: number) => 'Rs. ' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const NAVY: [number, number, number] = [46, 58, 140], INK: [number, number, number] = [17, 24, 39], MUTE: [number, number, number] = [107, 114, 128]

/** File name for the invoice PDF, e.g. RX-26-27-0044.pdf */
export const invoiceFileName = (inv: Invoice) => `${inv.number.replace(/[^\w.-]+/g, '-')}.pdf`

/** The invoice as the client receives it (same content as the printed invoice) — a PDF Blob. */
export async function invoicePdf(db: DB, inv: Invoice): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40
  const branch = (db.settings.branches ?? []).find((x) => x.id === inv.branchId)
  const st = branch?.state || db.settings.supplierState
  const tot = invoiceTotals(inv, st)
  const intra = inv.state.toLowerCase() === st.toLowerCase()
  const booking = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined
  const clientAddress = inv.clientAddress || [booking?.address, booking?.city, booking?.state].filter(Boolean).join(', ')
  const creator = db.users.find((u) => u.id === inv.createdBy)
  const company = db.settings.companyName || 'Rexera'
  const font = (style: 'normal' | 'bold', size: number, color: [number, number, number] = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const lines = (s: string, width: number) => doc.splitTextToSize(t(s), width) as string[]

  // header: supplier (left), document (right), orange rule
  let y = 48
  font('bold', 16, NAVY); doc.text(t(company), M, y)
  font('bold', 10); doc.text(t(`${company}${branch ? ` - ${branch.name}` : ''}`), M, y + 18)
  font('normal', 8.5, [55, 65, 81])
  let ly = y + 31
  const addr = branch ? [branch.address, [branch.city, branch.state, branch.pin].filter(Boolean).join(', ')].filter(Boolean).join('\n') || 'Branch address not set' : ''
  for (const l of lines(addr, 270)) { doc.text(l, M, ly); ly += 11 }
  font('normal', 8.5, MUTE)
  doc.text(t(branch ? `GSTIN ${branch.gstin || db.settings.companyGstin}${branch.phone ? ` · ${branch.phone}` : ''}${branch.email ? ` · ${branch.email}` : ''}` : `GSTIN ${db.settings.companyGstin} · ${st}, India`), M, ly); ly += 11
  font('bold', 18, NAVY); doc.text(inv.type === 'TAX' ? 'TAX INVOICE' : 'PROFORMA INVOICE', W - M, y, { align: 'right' })
  doc.setFont('courier', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(t(inv.number), W - M, y + 18, { align: 'right' })
  font('normal', 8.5, MUTE); doc.text(t(`Date ${fmtDate(inv.date)} · Due ${fmtDate(inv.due)}`), W - M, y + 31, { align: 'right' })
  y = Math.max(ly, y + 40) + 8
  doc.setFillColor(244, 123, 32); doc.rect(M, y, W - 2 * M, 3, 'F')
  y += 24

  // bill to / sales person
  font('bold', 7.5, MUTE); doc.text('BILL TO', M, y); doc.text('SALES PERSON', W - M, y, { align: 'right' })
  y += 14
  font('bold', 10.5); doc.text(t(inv.client), M, y)
  font('normal', 9.5); doc.text(t(userName(db, inv.salesPerson)), W - M, y, { align: 'right' })
  if (booking) { font('normal', 8.5, MUTE); doc.text(t(`CRM entry ${booking.bookingId}`), W - M, y + 12, { align: 'right' }) }
  font('normal', 9)
  for (const l of [
    ...(clientAddress ? lines(clientAddress, 300) : []),
    `GSTIN: ${inv.gstin || 'Unregistered'}${(inv.clientPan || booking?.pan) ? ` · PAN: ${inv.clientPan || booking?.pan}` : ''}`,
    `Place of supply: ${inv.state}`,
    ...(booking ? [[booking.contactPerson, booking.mobile, booking.email].filter(Boolean).join(' · ')] : []),
  ]) { y += 12; doc.text(t(l), M, y) }
  y += 24

  // items
  const head = ['#', 'Description', 'SAC', 'Qty', 'Rate', 'Taxable', ...(intra ? ['CGST', 'SGST'] : ['IGST'])]
  const widths = intra ? [4, 30, 9, 6, 12, 13, 13, 13] : [4, 34, 10, 7, 14, 15, 16]
  const scale = (W - 2 * M) / widths.reduce((a, c) => a + c, 0), ws = widths.map((w) => w * scale)
  const right = new Set([3, 4, 5, 6, 7])
  const row = (cells: string[], header = false) => {
    const wrapped = cells.map((c, i) => lines(c, ws[i]! - 8))
    const h = Math.max(...wrapped.map((l) => l.length)) * 10.5 + 9
    if (y + h > H - 150) { doc.addPage(); y = 50 }
    if (header) { doc.setFillColor(236, 238, 251); doc.rect(M, y - 11, W - 2 * M, h, 'F') }
    font(header ? 'bold' : 'normal', header ? 7.5 : 8.5, header ? NAVY : INK)
    let x = M
    wrapped.forEach((l, i) => { const r = right.has(i); doc.text(l, r ? x + ws[i]! - 4 : x + 4, y, { align: r ? 'right' : 'left' }); x += ws[i]! })
    y += h
    doc.setDrawColor(227, 230, 235); doc.line(M, y - 11, W - M, y - 11)
  }
  row(head.map((h) => h.toUpperCase()), true)
  inv.items.forEach((it, i) => {
    const tx = it.qty * it.rate, g = gstSplit(tx, it.gstRate, inv.state, st)
    row([String(i + 1), it.desc, it.sac, String(it.qty), rs(it.rate), rs(tx), ...(intra ? [`${rs(g.cgst)} (${it.gstRate / 2}%)`, `${rs(g.sgst)} (${it.gstRate / 2}%)`] : [`${rs(g.igst)} (${it.gstRate}%)`])])
  })
  y += 16

  // amount in words (left) and totals (right)
  if (y > H - 170) { doc.addPage(); y = 50 }
  const top = y, tx0 = W - M - 200
  font('bold', 7.5, MUTE); doc.text('AMOUNT IN WORDS', M, y)
  font('bold', 9); for (const l of lines(rupeesInWords(tot.grand), 270)) { y += 13; doc.text(l, M, y) }
  y += 24
  font('normal', 7.5, MUTE)
  for (const l of ['Bank: HDFC Bank · A/c 50200012345678 · IFSC HDFC0001234', 'This is a computer-generated invoice.', `Generated by: ${creator ? `${creator.name} (@${creator.username})` : '-'}${branch ? ` · Branch: ${branch.name}` : ''}`]) { doc.text(t(l), M, y); y += 11 }
  let ty = top
  const total = (k: string, v: string, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = INK, size = 9) => {
    font('normal', size, MUTE); doc.text(k, tx0, ty); font(style, size, color); doc.text(v, W - M, ty, { align: 'right' }); ty += size + 6
  }
  total('Taxable value', rs(tot.taxable))
  if (intra) { total('CGST', rs(tot.cgst)); total('SGST', rs(tot.sgst)) } else total('IGST', rs(tot.igst))
  doc.setDrawColor(...NAVY); doc.setLineWidth(1.5); doc.line(tx0, ty - 4, W - M, ty - 4); doc.setLineWidth(0.5); ty += 8
  total('Grand total', rs(tot.grand), 'bold', NAVY, 12)
  total('Paid', rs(inv.paid))
  total('Balance', rs(Math.max(0, tot.balance)), 'bold', [220, 38, 38])

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); font('normal', 7.5, [150, 154, 165])
    doc.text(t(`${company} | ${inv.number} | ${inv.client}`), M, H - 24)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' })
  }
  return doc.output('blob')
}
