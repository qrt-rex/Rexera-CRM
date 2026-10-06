import { jsPDF } from 'jspdf'
import { fmtDate, inr } from './format'

export type LetterKind = 'joining' | 'internship' | 'experience'
export const LETTER_KINDS: { id: LetterKind; label: string; title: string }[] = [
  { id: 'joining', label: 'Joining letter', title: 'Appointment & Joining Letter' },
  { id: 'internship', label: 'Internship letter', title: 'Internship Offer Letter' },
  { id: 'experience', label: 'Experience letter', title: 'Experience Certificate' },
]

export interface LetterData {
  company: string
  companyLine: string
  refNo: string
  date: string
  name: string
  address: string
  designation: string
  department: string
  location: string
  /** joining / internship start */
  startDate: string
  /** internship end / relieving date */
  endDate: string
  /** monthly salary (joining) or stipend (internship), ₹ */
  amount: number
  probationMonths: number
  reportingTo: string
  signatory: string
  signatoryTitle: string
}

const d = (s: string) => (s ? fmtDate(s) : '__________')
const first = (n: string) => n.trim().split(/\s+/)[0] || n

/** Editable body text for each letter (paragraphs separated by a blank line). */
export function draftBody(kind: LetterKind, x: LetterData): string {
  if (kind === 'joining') return [
    `Dear ${first(x.name)},`,
    `We are pleased to appoint you as ${x.designation || '__________'}${x.department ? ` in the ${x.department} department` : ''} at ${x.company}, with effect from ${d(x.startDate)}. Your place of work will be ${x.location || 'our office'}${x.reportingTo ? ` and you will report to ${x.reportingTo}` : ''}.`,
    `Your monthly salary (CTC) will be ${x.amount ? inr(x.amount) : '__________'}, paid as per the company's salary structure (basic, HRA and allowances) after statutory deductions such as provident fund and professional tax. A detailed salary break-up is shared with your payslip.`,
    `You will be on probation for ${x.probationMonths || 3} month(s) from your date of joining. On successful completion, your employment will be confirmed in writing. During probation either side may end the employment with 15 days' notice; after confirmation the notice period is 30 days.`,
    `You are expected to follow the company's policies, code of conduct and working hours, and to keep all client and company information strictly confidential during and after your employment.`,
    `Please sign and return a copy of this letter as your acceptance, along with your identity, address and educational documents on the day of joining.`,
    `We welcome you to the team and wish you a successful career with us.`,
  ].join('\n\n')
  if (kind === 'internship') return [
    `Dear ${first(x.name)},`,
    `We are happy to offer you an internship as ${x.designation || 'Intern'}${x.department ? ` in the ${x.department} department` : ''} at ${x.company}. The internship will run from ${d(x.startDate)} to ${d(x.endDate)} at ${x.location || 'our office'}${x.reportingTo ? `, under the guidance of ${x.reportingTo}` : ''}.`,
    x.amount ? `You will receive a monthly stipend of ${inr(x.amount)}, paid for the days you attend.` : `This is an unpaid internship focused on learning and hands-on project experience.`,
    `During the internship you are expected to follow the company's policies and working hours and to keep all company and client information confidential. Either side may end the internship with 7 days' notice.`,
    `On successful completion you will receive an internship completion certificate.`,
    `Please confirm your acceptance by signing and returning a copy of this letter. We look forward to working with you.`,
  ].join('\n\n')
  return [
    `TO WHOM IT MAY CONCERN`,
    `This is to certify that ${x.name || '__________'} was employed with ${x.company} as ${x.designation || '__________'}${x.department ? ` in the ${x.department} department` : ''} from ${d(x.startDate)} to ${d(x.endDate)}.`,
    `During this period we found ${first(x.name)} to be sincere, hardworking and dependable. ${first(x.name)} handled the responsibilities of the role with professionalism and maintained good relations with colleagues and clients.`,
    `${first(x.name)} has been relieved of all duties, and all dues have been settled. We wish ${first(x.name)} every success in future endeavours.`,
  ].join('\n\n')
}

const pdfText = (s: string) => s.replace(/₹\s?/g, 'Rs. ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")

/** A4 letter on company letterhead, returned as a PDF Blob. */
export function letterPdf(kind: LetterKind, x: LetterData, body: string): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 56
  let y = 0
  const header = () => {
    doc.setFillColor(46, 58, 140); doc.rect(0, 0, W, 8, 'F')
    doc.setFillColor(244, 123, 32); doc.rect(0, 8, W, 3, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(46, 58, 140)
    doc.text(pdfText(x.company), M, 52)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 116, 130)
    if (x.companyLine) doc.text(pdfText(x.companyLine), M, 67)
    doc.setDrawColor(220, 224, 232); doc.line(M, 80, W - M, 80)
    y = 108
  }
  const ensure = (h: number) => { if (y + h > H - 90) { doc.addPage(); header() } }
  header()
  doc.setTextColor(30, 34, 45); doc.setFontSize(10)
  if (x.refNo) doc.text(pdfText(`Ref: ${x.refNo}`), M, y)
  doc.text(pdfText(`Date: ${d(x.date)}`), W - M, y, { align: 'right' })
  y += 28
  if (kind !== 'experience') {
    doc.setFont('helvetica', 'bold'); doc.text(pdfText(x.name || '__________'), M, y); y += 14
    doc.setFont('helvetica', 'normal')
    for (const line of doc.splitTextToSize(pdfText(x.address), 260) as string[]) { doc.text(line, M, y); y += 13 }
    y += 12
  }
  const title = LETTER_KINDS.find((k) => k.id === kind)!.title
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(46, 58, 140)
  doc.text(pdfText(kind === 'experience' ? title : `Subject: ${title}`), kind === 'experience' ? W / 2 : M, y, { align: kind === 'experience' ? 'center' : 'left' })
  y += 26
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(30, 34, 45)
  for (const para of body.split(/\n\s*\n/)) {
    const p = para.trim()
    const heading = p.length < 60 && p === p.toUpperCase() && /[A-Z]/.test(p)   // e.g. TO WHOM IT MAY CONCERN
    doc.setFont('helvetica', heading ? 'bold' : 'normal')
    const lines = doc.splitTextToSize(pdfText(p), W - 2 * M) as string[]
    for (const line of lines) { ensure(15); doc.text(line, M, y); y += 15 }
    y += 8
  }
  doc.setFont('helvetica', 'normal')
  ensure(110)
  const top = y + 14, right = W - M - 170
  doc.text(pdfText(`For ${x.company}`), M, top)
  doc.setDrawColor(150, 150, 160); doc.line(M, top + 52, M + 170, top + 52)
  doc.setFont('helvetica', 'bold'); doc.text(pdfText(x.signatory || 'Authorised Signatory'), M, top + 66)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 130); doc.text(pdfText(x.signatoryTitle || 'Human Resources'), M, top + 79)
  if (kind !== 'experience') {
    doc.setTextColor(30, 34, 45); doc.text('Accepted by:', right, top)
    doc.line(right, top + 52, W - M, top + 52)
    doc.setFont('helvetica', 'bold'); doc.text(pdfText(x.name || ''), right, top + 66)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 130); doc.text('Signature & date', right, top + 79)
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150, 154, 165)
    doc.text(pdfText(`${x.company} · ${title}`), M, H - 30)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 30, { align: 'right' })
  }
  return doc.output('blob')
}
