import type { Booking, DB, Invoice, InvoiceShare, User } from './types'
import { whatsappLink } from '../../supabase/workflow-rules.mjs'
import { CLOUD } from './cloud'
import type { ClientEmailRequest } from '../../supabase/functions/_shared/client-email.mjs'
import { fmtDate, inr, invoiceTotals, isEmail } from './format'
import { invoiceFileName, invoicePdf } from './invoicePdf'
import { invoiceBranch } from './branches'
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

/**
 * A message to the entry's client on WhatsApp. On the live CRM with a client notification template it goes straight
 * through Interakt ('SENT'); otherwise WhatsApp (app or Web) opens with the client's number and the message typed in
 * ('OPENED'), and the person presses send there. The server and the button both allow only Operation, Admin and Legal.
 */
/** Where clients sign in to follow their file (the website's client portal). */
export const CLIENT_PORTAL_URL = String(import.meta.env.VITE_CLIENT_PORTAL_URL || 'https://websiterexera.vercel.app/portal')

export async function whatsappClient(b: Pick<Booking, 'id' | 'mobile'>, message: string): Promise<'SENT' | 'OPENED'> {
  const link = whatsappLink(b.mobile, message)
  // a tab opened before any await isn't stopped by the pop-up blocker; closed again if Interakt sends it
  const tab = link ? window.open('about:blank', '_blank') : null
  try {
    if (CLOUD) {
      const r = await serverPost<{ success: boolean; status: InvoiceShare['status']; error?: string }>('/api/whatsapp/notify', { bookingId: b.id, message })
      if (r.status === 'SENT') { tab?.close(); return 'SENT' }
      if (r.status === 'NO_CONTACT') throw new Error('This entry has no valid 10-digit mobile number — add it first.')
      if (r.status !== 'NOT_CONFIGURED') throw new Error(r.error || 'WhatsApp could not send the message — try again.')
    }
    if (!link) throw new Error('This entry has no valid 10-digit mobile number — add it first.')
    if (tab) { tab.opener = null; tab.location.href = link } else window.location.href = link
    return 'OPENED'
  } catch (e) {
    tab?.close()
    throw e
  }
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
  const branch = invoiceBranch(db, inv)
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
