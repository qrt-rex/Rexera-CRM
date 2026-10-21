import type { Booking, DB, Delivery, User } from './types'
import type { ClientEmailRequest } from '../../supabase/functions/_shared/client-email.mjs'
import { getDb } from './store'
import { claimWelcome, recordWelcome } from './actions'
import { sendClientEmailClient } from './emailClient'
import { clientSteps } from './clientMail'
import { isEmail } from './format'
import { fillTemplate, workflowSettings } from '../../supabase/workflow-rules.mjs'

/**
 * The client welcome message after Legal approval (Workflow settings → templates). The same text is used by the
 * screen that approves the file and by the live server's job that retries it (server/jobs.mjs).
 */
export function welcomeVars(db: DB, b: Booking) {
  const w = workflowSettings(db.settings.workflow)
  const ops = db.users.find((u) => u.id === b.opsMemberId)
  return {
    client_name: b.contactPerson || b.companyName, company: db.settings.companyName || 'Rexera', service: b.services?.filter((s) => !s.complimentary).map((s) => s.name).join(', ') || b.serviceName,
    reference: b.bookingId, status: 'With our Operations team', ops_name: w.opsContact.name || ops?.name || 'Our Operations team',
    ops_phone: w.opsContact.phone || ops?.phone || '', ops_email: w.opsContact.email || (ops && isEmail(ops.email) ? ops.email : ''),
  }
}
export function welcomeContent(db: DB, b: Booking) {
  const w = workflowSettings(db.settings.workflow), v = welcomeVars(db, b)
  return { subject: fillTemplate(w.welcomeEmail.subject, v), message: fillTemplate(w.welcomeEmail.body, v), whatsapp: fillTemplate(w.welcomeWhatsapp, v), vars: v }
}
/** The branded email (the server renders it; no document is attached — clients get files through secure form links). */
export function welcomeRequest(db: DB, b: Booking): ClientEmailRequest {
  const c = welcomeContent(db, b), v = c.vars
  return {
    to: b.email, subject: c.subject, heading: 'Your file is with our Operations team', message: c.message,
    details: [['Reference', b.bookingId], ['Company', b.companyName], ['Service', v.service], ['Current status', v.status], ['Operations contact', [v.ops_name, v.ops_phone].filter(Boolean).join(' · ')]],
    steps: clientSteps(b),
    sender: { name: v.ops_name, role: 'Operations', phone: v.ops_phone || undefined, email: v.ops_email || undefined },
    replyTo: v.ops_email || undefined, company: v.company,
  }
}
/** wa.me link with the welcome text (WhatsApp isn't connected to a provider yet: staff send it from their phone). */
export function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '').slice(-10)
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : ''}?text=${encodeURIComponent(text)}`
}

/**
 * Sends the queued welcome email once. Returns null when there is nothing to send (already sent, being sent, no
 * email, or switched off). The result is what the mail server answered — a failure stays on the file with Retry.
 */
export async function deliverWelcome(me: User, id: string): Promise<{ status: Delivery['status']; to: string; error?: string } | null> {
  if (!claimWelcome(me, id)) return null
  const db = getDb()
  const b = db.bookings.find((x) => x.id === id)!
  const req = welcomeRequest(db, b)
  try {
    const r = await sendClientEmailClient(req)
    const status: Delivery['status'] = r.delivered ? 'SENT' : r.notConfigured ? 'NOT_CONFIGURED' : 'FAILED'
    recordWelcome(me, id, 'email', { status, error: r.delivered ? undefined : r.message || 'Sending failed', subject: req.subject })
    return { status, to: req.to, error: r.delivered ? undefined : r.message }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Sending failed'
    recordWelcome(me, id, 'email', { status: 'FAILED', error, subject: req.subject })
    return { status: 'FAILED', to: req.to, error }
  }
}
