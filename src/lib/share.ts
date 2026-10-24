import type { DB, Invoice, InvoiceShare, User } from './types'
import type { ClientEmailRequest } from '../../supabase/functions/_shared/client-email.mjs'
import { fmtDate, inr, invoiceTotals, isEmail } from './format'
import { invoiceFileName, invoicePdf } from './invoicePdf'
import { serverPost } from './serverApi'

/**
 * Sending to clients through the live server (server/share.mjs): the server checks this person's own sign-in, and
 * the WhatsApp key (Interakt) and the mail server's password never reach the browser. Needs the live CRM (Supabase).
 */
export { serverPost }

/** Asks the server to send the file's queued WhatsApp welcome now (otherwise its job does within 15 minutes). */
export async function requestWelcomeWhatsapp(bookingId: string) {
  const r = await serverPost<{ result: { status: string; to: string; error?: string } | null }>('/api/whatsapp/welcome', { bookingId })
  return r.result
}

/** A Document Form Builder link to the client on WhatsApp (Interakt form-link template). */
export async function sendFormWhatsapp(formId: string, phone: string, clientName: string) {
  return serverPost<{ success: boolean; status: InvoiceShare['status']; to?: string; error?: string }>('/api/forms/share', { formId, phone, clientName })
}

export type ShareResult ={ status: InvoiceShare['status']; to: string; error?: string }
const blobBase64 = (b: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1] ?? '')
  r.onerror = () => fail(new Error('Could not read the PDF.'))
  r.readAsDataURL(b)
})
/** The words used in the email and in the WhatsApp template ({{1}} client, {{2}} document, {{3}} amount, {{4}} company). */
export function invoiceShareText(db: DB, inv: Invoice) {
  const branch = (db.settings.branches ?? []).find((x) => x.id === inv.branchId)
  const t = invoiceTotals(inv, branch?.state || db.settings.supplierState)
  const kind = inv.type === 'TAX' ? 'Tax invoice' : 'Proforma invoice', company = db.settings.companyName || 'Rexera'
  const booking = inv.bookingId ? db.bookings.find((x) => x.id === inv.bookingId) : undefined
  return {
    kind, company, total: t.grand, balance: t.balance,
    email: booking?.paymentEmail || booking?.email || '', phone: booking?.paymentContact || booking?.mobile || '',
    clientName: booking?.contactPerson || inv.client,
    message: [`Please find attached your ${kind.toLowerCase()} ${inv.number} dated ${fmtDate(inv.date)} for ${inr(t.grand)}.`, ...(t.balance > 0.5 ? [`Balance due: ${inr(t.balance)} by ${fmtDate(inv.due)}.`] : [])].join('\n'),
  }
}

/** Makes the invoice PDF here and has the server send it: attached to an email and / or as a WhatsApp document. */
export async function sendInvoiceToClient(db: DB, me: User, inv: Invoice, to: { email?: string; phone?: string; message: string }) {
  const x = invoiceShareText(db, inv)
  const pdf = await blobBase64(await invoicePdf(db, inv))
  const myEmail = isEmail(me.email) ? me.email : undefined
  const email: ClientEmailRequest | undefined = to.email ? {
    to: to.email.trim(), subject: `${x.kind} ${inv.number} — ${x.company}`, heading: `${x.kind} ${inv.number}`, message: `Dear ${x.clientName},\n\n${to.message.trim()}`, company: x.company,
    sender: { name: me.name, role: 'Accounts', ...(me.phone ? { phone: me.phone } : {}), ...(myEmail ? { email: myEmail } : {}) }, ...(myEmail ? { replyTo: myEmail } : {}),
    details: [['Document', `${x.kind} ${inv.number}`], ['Date', fmtDate(inv.date)], ['Amount', inr(x.total)], ...(x.balance > 0.5 ? [['Balance due', `${inr(x.balance)} by ${fmtDate(inv.due)}`] as [string, string]] : [])],
  } : undefined
  return serverPost<{ success: boolean; email?: ShareResult; whatsapp?: ShareResult }>('/api/invoices/send', {
    invoiceId: inv.id, pdf, fileName: invoiceFileName(inv), email,
    whatsapp: to.phone ? { phone: to.phone, values: { client_name: x.clientName, document: `${x.kind} ${inv.number}`, amount: inr(x.total), company: x.company } } : undefined,
  })
}
