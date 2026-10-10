import type { Booking, DB } from './types'
import { userName } from './actions'
import { BOOKING_STATUS, stageLabel } from './workflow'
import { bookingMoney, fmtDate, fmtDateTime } from './format'

/** jsPDF's built-in fonts have no ₹ or curly quotes. */
const t = (s: unknown) => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/·/g, '|')
const rs = (n: number) => 'Rs. ' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** One-page summary of a CRM entry (client, services, payments with GST, people, status, documents) as a PDF Blob. */
export async function bookingPdf(db: DB, b: Booking): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40
  const company = db.settings.companyName || 'Rexera'
  const m = bookingMoney(b)
  let y = 0

  const header = () => {
    doc.setFillColor(46, 58, 140); doc.rect(0, 0, W, 8, 'F')
    doc.setFillColor(244, 123, 32); doc.rect(0, 8, W, 3, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(46, 58, 140); doc.text(t(company), M, 40)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 116, 130); doc.text('CRM Entry', M, 54)
    doc.setFont('courier', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 34, 45); doc.text(t(b.bookingId), W - M, 40, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 116, 130); doc.text(t(`Generated ${fmtDateTime(new Date().toISOString())}`), W - M, 54, { align: 'right' })
    doc.setDrawColor(220, 224, 232); doc.line(M, 64, W - M, 64)
    y = 86
  }
  const ensure = (h: number) => { if (y + h > H - 50) { doc.addPage(); header() } }
  const section = (title: string) => {
    ensure(40); y += 6
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(46, 58, 140); doc.text(t(title).toUpperCase(), M, y)
    y += 6; doc.setDrawColor(46, 58, 140); doc.setLineWidth(0.8); doc.line(M, y, M + 26, y); doc.setLineWidth(0.5); y += 14
  }
  /** label / value pairs in two columns */
  const pairs = (rows: [string, string][]) => {
    const colW = (W - 2 * M) / 2
    for (let i = 0; i < rows.length; i += 2) {
      const cells = rows.slice(i, i + 2)
      const heights = cells.map(([, v]) => (doc.splitTextToSize(t(v || '-'), colW - 110) as string[]).length)
      const h = Math.max(...heights) * 12 + 6
      ensure(h)
      cells.forEach(([k, v], j) => {
        const x = M + j * colW
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 116, 130); doc.text(t(k), x, y)
        doc.setTextColor(30, 34, 45); doc.setFont('helvetica', 'bold')
        doc.text(doc.splitTextToSize(t(v || '-'), colW - 110) as string[], x + 104, y)
      })
      y += h
    }
  }
  /** simple ruled table; `right` = column indexes aligned right */
  const table = (head: string[], rows: string[][], widths: number[], right: number[] = []) => {
    const total = widths.reduce((a, c) => a + c, 0), scale = (W - 2 * M) / total
    const ws = widths.map((w) => w * scale)
    const row = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
      const lines = cells.map((c, i) => doc.splitTextToSize(t(c), ws[i]! - 10) as string[])
      const h = Math.max(...lines.map((l) => l.length)) * 11 + 9
      ensure(h)
      if (fill) { doc.setFillColor(...fill); doc.rect(M, y - 11, W - 2 * M, h, 'F') }
      let x = M
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.8); doc.setTextColor(bold ? 46 : 30, bold ? 58 : 34, bold ? 140 : 45)
      lines.forEach((l, i) => { const r = right.includes(i); doc.text(l, r ? x + ws[i]! - 5 : x + 5, y, { align: r ? 'right' : 'left' }); x += ws[i]! })
      y += h
      doc.setDrawColor(230, 233, 240); doc.line(M, y - 11, W - M, y - 11)
    }
    row(head, true, [241, 243, 249])
    for (const r of rows) row(r, false)
    y += 4
  }

  header()
  // title block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(30, 34, 45)
  for (const line of doc.splitTextToSize(t(b.companyName), W - 2 * M - 170) as string[]) { doc.text(line, M, y); y += 20 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 116, 130)
  doc.text(t(`${b.serviceName} | ${b.mode}`), M, y); y += 8
  // status pill on the right of the title
  const st = t(BOOKING_STATUS[b.status].label)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  const pw = doc.getTextWidth(st) + 18
  doc.setFillColor(b.status === 'COMPLETED' ? 14 : b.status === 'REJECTED' ? 220 : 46, b.status === 'COMPLETED' ? 159 : b.status === 'REJECTED' ? 38 : 58, b.status === 'COMPLETED' ? 110 : b.status === 'REJECTED' ? 38 : 140)
  doc.roundedRect(W - M - pw, 92, pw, 18, 9, 9, 'F'); doc.setTextColor(255, 255, 255); doc.text(st, W - M - pw / 2, 104, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 116, 130)
  doc.text(t(b.opsMemberId ? `Stage ${stageLabel(b.stage, b.stageOutcome)}` : 'Processing not started'), W - M, 124, { align: 'right' })
  y += 16

  // money summary boxes
  ensure(60)
  const boxes: [string, string, [number, number, number]][] = [['Quoted (incl. GST)', rs(m.quotedWithGst), [30, 34, 45]], ['Paid (incl. GST)', rs(m.collected), [14, 159, 110]], ['Outstanding', rs(m.outstanding), [220, 38, 38]]]
  const bw = (W - 2 * M - 20) / 3
  boxes.forEach(([k, v, c], i) => {
    const x = M + i * (bw + 10)
    doc.setFillColor(245, 247, 251); doc.setDrawColor(226, 230, 238); doc.roundedRect(x, y, bw, 46, 6, 6, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 116, 130); doc.text(k, x + 12, y + 17)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...c); doc.text(v, x + 12, y + 35)
  })
  y += 66

  section('Client')
  pairs([
    ['Company', b.companyName], ['Contact person', b.contactPerson], ['Mobile', b.mobile], ['Email', b.email],
    ['PAN', b.pan], ['GSTIN', b.gstin], ['City / State', [b.city, b.state].filter(Boolean).join(', ')], ['Industry', b.industry],
    ...(b.address ? [['Address', b.address] as [string, string]] : []), ...(b.cin ? [['CIN / LLPIN', b.cin] as [string, string]] : []),
    ...(b.paymentContact ? [['Payment contact', [b.paymentContact, b.paymentEmail].filter(Boolean).join(' | ')] as [string, string]] : []),
  ])

  section('Services')
  const svcs = b.services?.length ? b.services : [{ serviceId: b.serviceId, name: b.serviceName, price: b.totalQuoted }]
  table(['Service', 'Price (excl. GST)'], [...svcs.map((s) => [s.name, s.price ? rs(s.price) : 'in total']), ['Total quoted', rs(b.totalQuoted)], [`GST ${b.gstRate}%`, rs(m.quotedWithGst - b.totalQuoted)], ['Total with GST', rs(m.quotedWithGst)]], [70, 30], [1])
  pairs([
    ['Booking date', fmtDate(b.bookingDate ?? b.createdAt)], ['Mode', b.mode],
    ['Success fee', b.successFee ? (b.successFee.value ? (b.successFee.type === 'PCT' ? `${b.successFee.value}%` : rs(b.successFee.value)) : 'None') : b.successFeePct ? `${b.successFeePct}%` : '-'],
    ['Deadline', fmtDate(b.deadline)], ['Priority', b.priority.toLowerCase()], ['Entered on', fmtDateTime(b.createdAt)],
  ])

  section('Payments')
  table(['Part', 'Date', 'Mode', 'Amount', 'GST', 'Total', 'Verified'],
    b.payments.length ? b.payments.map((p) => [String(p.part), fmtDate(p.date), p.mode, rs(p.amount), rs(p.gst), rs(p.total), p.verified ? 'Yes' : 'Pending']) : [['-', 'No payments recorded', '', '', '', '', '']],
    [8, 16, 14, 18, 15, 18, 11], [3, 4, 5])
  pairs([['Paid (incl. GST)', rs(m.collected)], ['Outstanding', rs(m.outstanding)]])

  section('People')
  pairs([
    ['BDM / Sales person', b.createdBy ? userName(db, b.createdBy) : b.ownerName ?? '-'], ['Lead closed by', b.closedBy ? userName(db, b.closedBy) : '-'],
    ['Team leader', userName(db, b.teamLeadId)], ['Operations', userName(db, b.opsMemberId)], ['Admin', userName(db, b.adminId)], ['Status', BOOKING_STATUS[b.status].label],
  ])

  if (b.remarks || b.holdReason || b.stageReason) {
    section('Remarks')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 34, 45)
    for (const p of [b.remarks, b.holdReason && `On hold: ${b.holdReason}`, b.stageReason && `Stage note: ${b.stageReason}`].filter(Boolean) as string[]) {
      for (const line of doc.splitTextToSize(t(p), W - 2 * M) as string[]) { ensure(13); doc.text(line, M, y); y += 13 }
      y += 4
    }
  }

  if (b.documents.length) {
    section(`Documents (${b.documents.length})`)
    table(['Category', 'File', 'Status', 'Added'], b.documents.map((d) => [d.category, d.name, (d.status ?? 'PENDING').toLowerCase(), fmtDate(d.at)]), [28, 40, 12, 20])
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 154, 165)
    doc.text(t(`${company} | ${b.bookingId} | ${b.companyName}`), M, H - 24)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' })
  }
  return doc.output('blob')
}

/**
 * Opens the entry's PDF in a new tab. The tab is opened straight away (inside the click) so pop-up blockers allow it,
 * then filled once the PDF is ready; if the browser still blocks it, the PDF is downloaded instead.
 */
export async function openBookingPdf(db: DB, b: Booking) {
  const win = window.open('', '_blank')
  if (win) win.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">Preparing PDF…</p>')
  try {
    const url = URL.createObjectURL(await bookingPdf(db, b))
    if (win) win.location.href = url
    else { const a = document.createElement('a'); a.href = url; a.download = `${b.bookingId}-${b.companyName.replace(/[^\w]+/g, '-')}.pdf`; a.click() }
    setTimeout(() => URL.revokeObjectURL(url), 120_000)
  } catch (e) {
    win?.close()
    throw e
  }
}
