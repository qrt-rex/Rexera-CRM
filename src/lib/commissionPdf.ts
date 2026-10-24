import { fmtDate } from './format'

/** jsPDF's built-in fonts have no ₹ or curly quotes. */
const t = (s: unknown) => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/·/g, '|')
const rs = (n: number) => 'Rs. ' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface CommissionRow {
  crm: string; client: string; sales: string; to: string; name: string; pct: number; base: number; amount: number
  status: 'PENDING' | 'PAID'; paidOn?: string; mode?: string; ref?: string; setOn: string
}

/** Commission report (landscape A4): what was filtered, totals, then one row per commission. */
export async function commissionPdf(company: string, rows: CommissionRow[], filters: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36
  const total = rows.reduce((s, r) => s + r.amount, 0), paid = rows.filter((r) => r.status === 'PAID').reduce((s, r) => s + r.amount, 0)
  let y = 0
  const header = () => {
    doc.setFillColor(46, 58, 140); doc.rect(0, 0, W, 8, 'F'); doc.setFillColor(244, 123, 32); doc.rect(0, 8, W, 3, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(46, 58, 140); doc.text(t(company), M, 38)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 116, 130); doc.text('Commission report (CA / DSA)', M, 53)
    doc.text(t(`Generated ${fmtDate(new Date().toISOString())}`), W - M, 38, { align: 'right' })
    doc.text(t(filters), W - M, 53, { align: 'right' })
    y = 72
  }
  header()
  // summary boxes
  const boxes: [string, string, [number, number, number]][] = [
    ['Commissions', String(rows.length), [30, 34, 45]], ['Total commission', rs(total), [46, 58, 140]],
    ['Paid', rs(paid), [14, 159, 110]], ['Not paid yet', rs(total - paid), [220, 38, 38]],
  ]
  const bw = (W - 2 * M - 30) / 4
  boxes.forEach(([k, v, c], i) => {
    const x = M + i * (bw + 10)
    doc.setFillColor(245, 247, 251); doc.setDrawColor(226, 230, 238); doc.roundedRect(x, y, bw, 42, 6, 6, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 116, 130); doc.text(k, x + 10, y + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...c); doc.text(v, x + 10, y + 32)
  })
  y += 62
  // table
  const head = ['CRM entry', 'Client', 'Sales person', 'CA / DSA', '%', 'Collected *', 'Commission', 'Status', 'Paid on · mode · ref']
  const widths = [74, 118, 78, 105, 40, 88, 84, 54, 138]
  const scale = (W - 2 * M) / widths.reduce((a, b) => a + b, 0), ws = widths.map((w) => w * scale)
  const right = new Set([4, 5, 6])
  const row = (cells: string[], bold = false, fill?: [number, number, number]) => {
    const lines = cells.map((c, i) => doc.splitTextToSize(t(c), ws[i]! - 8) as string[])
    const h = Math.max(...lines.map((l) => l.length)) * 10.5 + 8
    if (y + h > H - 40) { doc.addPage(); header() }
    if (fill) { doc.setFillColor(...fill); doc.rect(M, y - 10, W - 2 * M, h, 'F') }
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 7.8 : 8.3); doc.setTextColor(bold ? 46 : 30, bold ? 58 : 34, bold ? 140 : 45)
    let x = M
    lines.forEach((l, i) => { const r = right.has(i); doc.text(l, r ? x + ws[i]! - 4 : x + 4, y, { align: r ? 'right' : 'left' }); x += ws[i]! })
    y += h
    doc.setDrawColor(230, 233, 240); doc.line(M, y - 10, W - M, y - 10)
  }
  row(head, true, [236, 238, 251])
  if (!rows.length) row(['', 'No commissions match these filters.', '', '', '', '', '', '', ''])
  for (const r of rows) row([r.crm, r.client, r.sales, `${r.to} · ${r.name}`, `${r.pct}%`, rs(r.base), rs(r.amount), r.status === 'PAID' ? 'Paid' : 'Not paid', r.status === 'PAID' ? [fmtDate(r.paidOn), r.mode, r.ref].filter(Boolean).join(' · ') : `set ${fmtDate(r.setOn)}`])
  row(['', 'Total', '', '', '', rs(rows.reduce((s, r) => s + r.base, 0)), rs(total), '', ''], true, [245, 247, 251])
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110, 116, 130)
  doc.text('* Collected = payments received on the CRM entry, before GST. Commission = collected x commission %; once paid, the amount paid is shown.', M, y + 4)

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 154, 165)
    doc.text(t(`${company} | Commission report`), M, H - 18); doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' })
  }
  return doc.output('blob')
}
