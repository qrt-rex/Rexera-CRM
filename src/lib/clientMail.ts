import type { Booking, DB, User } from './types'
import { DOC_FORM, STAGE_OUTCOMES, STAGES, stageLabel } from './workflow'
import { roleLabel } from './rbac'
import { isEmail } from './format'
import type { ClientEmailRequest, ClientEmailStep } from '../../supabase/functions/_shared/client-email.mjs'

/**
 * Emails from the Operation team / Admin to the client. Each template is filled from the client file; the person
 * can edit the subject and message before sending. In the message, a blank line starts a new paragraph and lines
 * starting with "•" become a bullet list.
 */
export type ClientTemplateKey = 'welcome' | 'documents' | 'progress' | 'submitted' | 'approved' | 'resubmission' | 'hold' | 'rejected' | 'completed' | 'custom'

export const CLIENT_TEMPLATES: { key: ClientTemplateKey; name: string; when: string; subject: string; heading: string; body: string; tracker: boolean }[] = [
  { key: 'welcome', name: 'Welcome · work started', when: 'File received, stage 1', tracker: true,
    subject: 'Welcome to Rexera — work on your {service} has started ({file})',
    heading: 'Work on your file has started',
    body: 'Dear {client},\n\nThank you for choosing Rexera. We have received your file for {service} and our team has started working on it.\n\nYour file number is {file}. Please mention it whenever you write to us.\n\nWhat happens next:\n\n• We collect and check your documents\n• We prepare and submit your application\n• We keep you updated at every stage\n\nIf you have any questions, simply reply to this email — it comes straight to me.' },
  { key: 'documents', name: 'Documents needed', when: 'Data collection, stages 1–2', tracker: false,
    subject: 'Documents needed for your {service} file ({file})',
    heading: 'We need a few documents from you',
    body: 'Dear {client},\n\nTo move your {service} application forward, we need the following documents from you:\n\n{missing_docs}\n\nPlease reply to this email with clear scans or photos (PDF or JPG). If any document is not available, let us know and we will guide you.\n\nOnce we receive them, we will review everything and update you.' },
  { key: 'progress', name: 'Progress update', when: 'Any stage', tracker: true,
    subject: 'Progress update on your {service} file ({file})',
    heading: 'Your file is moving ahead',
    body: 'Dear {client},\n\nHere is the latest update on your {service} file.\n\nCurrent stage: {stage}{note}\n\nWe are working on the next step and will keep you informed. The tracker below shows where your file stands.' },
  { key: 'submitted', name: 'Application submitted', when: 'Stage 6 · Submission', tracker: true,
    subject: 'Your {service} application has been submitted ({file})',
    heading: 'Your application has been submitted',
    body: 'Dear {client},\n\nGood news — we have submitted your {service} application.\n\nThe authority usually takes some time to review it. We are tracking it closely and will inform you as soon as we hear back. If they ask for anything more, we will contact you right away.' },
  { key: 'approved', name: 'Approved 🎉', when: 'Stage 8 · Approved', tracker: true,
    subject: 'Congratulations! Your {service} application is approved ({file})',
    heading: 'Congratulations — your application is approved!',
    body: 'Dear {client},\n\nWe are happy to inform you that your {service} application has been approved.\n\nWe will share the approval documents with you shortly. Thank you for trusting Rexera — it has been a pleasure working with you.' },
  { key: 'resubmission', name: 'Re-submission', when: 'Stage 8 · Re-submission', tracker: true,
    subject: 'Update: re-submission for your {service} file ({file})',
    heading: 'A re-submission is needed',
    body: 'Dear {client},\n\nThe authority has asked for a re-submission of your {service} application.\n\nReason: {reason}\n\nOur team is preparing the re-submission. If we need anything from you, we will let you know — please keep an eye on your email and phone.' },
  { key: 'hold', name: 'On hold · need response', when: 'File on hold', tracker: false,
    subject: 'Your {service} file is on hold — we need your response ({file})',
    heading: 'We need your response to continue',
    body: 'Dear {client},\n\nYour {service} file is currently on hold.\n\nReason: {reason}\n\nPlease reply to this email or call us so we can continue the work without delay.' },
  { key: 'rejected', name: 'Not approved', when: 'Stage 8 · Rejected', tracker: false,
    subject: 'Update on your {service} application ({file})',
    heading: 'An update on your application',
    body: 'Dear {client},\n\nWe regret to inform you that your {service} application was not approved.\n\nReason: {reason}\n\nPlease don’t worry — our team will review the next options with you. We will call you shortly, or you can reply to this email to set up a time.' },
  { key: 'completed', name: 'Work completed', when: 'File completed', tracker: true,
    subject: 'Your {service} work is complete ({file})',
    heading: 'All work on your file is complete',
    body: 'Dear {client},\n\nWe are pleased to let you know that all work on your {service} file is now complete.\n\nThank you for choosing Rexera. If you need any further help — or would like to explore other schemes and services — just reply to this email.' },
  { key: 'custom', name: 'Custom message', when: 'Anything else', tracker: false,
    subject: 'Regarding your {service} file ({file})',
    heading: 'Regarding your file',
    body: 'Dear {client},\n\n' },
]
export const clientTemplate = (k: string) => CLIENT_TEMPLATES.find((t) => t.key === k) ?? CLIENT_TEMPLATES[CLIENT_TEMPLATES.length - 1]!

/** The template that fits where the file is now. */
export function suggestTemplate(b: Booking): ClientTemplateKey {
  if (b.status === 'COMPLETED') return 'completed'
  if (b.status === 'ON_HOLD' || b.stageOutcome === 'HOLD_CLIENT') return 'hold'
  if (b.stage === 8 && b.stageOutcome === 'APPROVED') return 'approved'
  if (b.stage === 8 && b.stageOutcome === 'REJECTED') return 'rejected'
  if (b.stage === 8 && b.stageOutcome === 'RESUBMISSION') return 'resubmission'
  if (b.stage === 6) return 'submitted'
  if (b.stage <= 1 && !b.clientEmails?.some((e) => e.status !== 'FAILED')) return 'welcome'
  if (b.stage <= 2) return 'documents'
  return 'progress'
}

const serviceNames = (b: Booking) => b.services?.map((s) => s.name).join(', ') || b.serviceName
const currentStage = (b: Booking) => b.status === 'COMPLETED' ? 'Completed' : b.opsMemberId ? stageLabel(b.stage, b.stageOutcome).replace(/^\d+\.\s*/, '') : 'Getting started'

/** Standard client documents not on the file yet (rejected uploads count as missing). */
export function missingDocs(b: Booking) {
  const have = new Set(b.documents.filter((d) => d.status !== 'REJECTED').map((d) => d.category))
  return DOC_FORM.filter((x) => !have.has(x.cat))
}

/** Progress tracker for the email: the 8 stages, with the result name on the last one. */
export function clientSteps(b: Booking): ClientEmailStep[] {
  const done = b.status === 'COMPLETED'
  return STAGES.map((s, i) => {
    const n = i + 1
    const label = n === 8 ? (STAGE_OUTCOMES[8]!.find((o) => o.id === b.stageOutcome && b.stage === 8)?.label ?? 'Final result') : s
    return { label, state: done || (b.opsMemberId && n < b.stage) ? 'done' : b.opsMemberId && n === b.stage ? 'current' : 'todo' }
  })
}

export interface ClientDraft {
  template: ClientTemplateKey
  to: string
  cc: string[]
  subject: string
  heading: string
  message: string
  tracker: boolean
  details: boolean
}

/** Fills a template from the client file. Missing facts become [square-bracket] notes for the sender to complete. */
export function draftFor(b: Booking, key: ClientTemplateKey): ClientDraft {
  const t = clientTemplate(key)
  const last = b.stageHistory.at(-1)
  const docs = missingDocs(b)
  const vars: Record<string, string> = {
    client: b.contactPerson || b.companyName, company: b.companyName, service: serviceNames(b), file: b.bookingId, stage: currentStage(b),
    reason: b.stageReason || b.holdReason || '[add the reason]',
    // only a note someone wrote — not the automatic "Moved to …" / "Started" ones
    note: last?.note && !/^(Moved to |Started$|Assigned by Legal$|Approved by Operations$|\d+\. )/.test(last.note) ? `\n\nNote from our team: ${last.note}` : '',
    missing_docs: docs.length ? docs.map((d) => `• ${d.cat} — ${d.hint}`).join('\n') : '• [list the documents you need]',
  }
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
  const cc = [b.paymentEmail, b.startupContact?.email].filter((e): e is string => !!e && isEmail(e) && e.toLowerCase() !== b.email?.toLowerCase())
  return { template: key, to: b.email || '', cc: [...new Set(cc)].slice(0, 3), subject: fill(t.subject), heading: fill(t.heading), message: fill(t.body), tracker: t.tracker, details: true }
}

/** The request the server turns into the branded email. */
export function clientEmailRequest(db: DB, b: Booking, me: User, d: ClientDraft): ClientEmailRequest {
  const sender = { name: me.name, role: roleLabel(me.role), phone: me.phone || undefined, email: isEmail(me.email) ? me.email : undefined }
  return {
    to: d.to.trim(), cc: d.cc.map((x) => x.trim()).filter(Boolean), replyTo: sender.email, subject: d.subject.trim(), heading: d.heading.trim() || undefined, message: d.message,
    details: d.details ? [['File number', b.bookingId], ['Company', b.companyName], ['Service', serviceNames(b)], ['Current stage', currentStage(b)], ['Your contact', [me.name, me.phone].filter(Boolean).join(' · ')]] : undefined,
    steps: d.tracker ? clientSteps(b) : undefined,
    sender, company: db.settings.companyName || 'Rexera',
  }
}
