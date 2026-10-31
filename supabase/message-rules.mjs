// Client communication: the messages each team sends to a client — by WhatsApp and / or email — at each step of
// the client's process. Shared by the CRM screens and the live server (server/clientMessages.mjs), so both agree on
// who may send which message, when it is open, and what it says.
//
//  Sales Team      → Welcome (on their own client entries / CRM entries)
//  Accounts Team   → Account cleared, file forwarded to Legal
//  Legal Team      → Legal clearance, file forwarded to the Operation Team
//  Operation Team, Admin (and Super Admin / IT) → every message, at every stage, and the templates themselves
//
// Every message is a template with {placeholders}; the sender reviews and edits it before sending. WhatsApp messages
// the business starts must use a template Meta approved: the edited text goes into the approved "client update"
// template (Workflow settings → WhatsApp). Each send is recorded (content, sender, recipient, channel, time, status).

export const MESSAGE_STAGES = [
  { id: 'WELCOME', label: 'Welcome', desc: 'When the client entry is made — thank the client and say what happens next', teams: ['sales', 'teamlead', 'operations', 'admin'], on: 'any' },
  { id: 'ACCOUNT_CLEARED', label: 'Account cleared → with Legal', desc: 'Accounts has cleared the account; the file is forwarded to the Legal Team', teams: ['accounts', 'operations', 'admin'], on: 'booking' },
  { id: 'LEGAL_CLEARED', label: 'Legal cleared → with Operations', desc: 'Legal verification is complete; the file is forwarded to the Operation Team', teams: ['legal', 'operations', 'admin'], on: 'booking' },
  { id: 'DOCUMENTS', label: 'Documents needed', desc: 'Ask the client for documents to continue', teams: ['operations', 'admin'], on: 'booking' },
  { id: 'STAGE_UPDATE', label: 'Progress update', desc: 'Tell the client which stage the file has reached', teams: ['operations', 'admin'], on: 'booking' },
  { id: 'SUBMITTED', label: 'Application submitted', desc: 'The application has been submitted', teams: ['operations', 'admin'], on: 'booking' },
  { id: 'COMPLETED', label: 'Completed', desc: 'The work is complete', teams: ['operations', 'admin'], on: 'booking' },
  { id: 'PAYMENT_REMINDER', label: 'Payment reminder', desc: 'A balance payment is due', teams: ['operations', 'admin'], on: 'booking' },
  { id: 'GENERAL', label: 'General message', desc: 'Anything else, at any time', teams: ['operations', 'admin'], on: 'any' },
]
export const stageOf = (id) => MESSAGE_STAGES.find((s) => s.id === id)
export const CHANNELS = { EMAIL: 'Email', WHATSAPP: 'WhatsApp' }
export const MESSAGE_STATUS = {
  SENT: { label: 'Sent', tone: 'green' },
  MANUAL: { label: 'Sent from own WhatsApp / mail app', tone: 'blue' },
  FAILED: { label: 'Failed', tone: 'red' },
  NOT_CONFIGURED: { label: 'Not set up', tone: 'amber' },
}
/** A message sent twice to the same client on the same channel within this time is a duplicate (double click). */
export const DUPLICATE_WINDOW_MS = 2 * 60_000

const MASTER = ['superadmin', 'it']
const AFTER_ACCOUNTS = ['PENDING_LEGAL', 'CHANGES_REQUIRED', 'IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW', 'COMPLETED']
const AFTER_LEGAL = ['IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW', 'COMPLETED']
/** On hold counts as the status it was put on hold from. */
const effStatus = (r) => (r.status === 'ON_HOLD' && r.holdFrom ? r.holdFrom : r.status)

/**
 * Is a message open for this record now? `rec` = { kind: 'booking' | 'entry', status, stage, holdFrom? }.
 * Answers null when it is, else why not (shown to the sender).
 */
export function stageClosed(stageId, rec) {
  const s = stageOf(stageId)
  if (!s) return 'Unknown message.'
  if (s.on === 'booking' && rec.kind !== 'booking') return 'This message is sent from the CRM entry, once the client has paid.'
  if (rec.kind === 'booking' && rec.status === 'REJECTED' && stageId !== 'GENERAL') return 'This CRM entry was rejected.'
  if (rec.kind === 'entry') return rec.status === 'NOT_INTERESTED' && stageId !== 'GENERAL' ? 'This client said they are not interested.' : null
  const st = effStatus(rec)
  switch (stageId) {
    case 'ACCOUNT_CLEARED': return AFTER_ACCOUNTS.includes(st) ? null : 'Opens when Accounts has cleared the account (file with Legal).'
    case 'LEGAL_CLEARED': case 'DOCUMENTS': case 'STAGE_UPDATE': return AFTER_LEGAL.includes(st) ? null : 'Opens when Legal has cleared the file (file with Operations).'
    case 'SUBMITTED': return AFTER_LEGAL.includes(st) && Number(rec.stage) >= 6 ? null : 'Opens when the file reaches stage 6 (Submission).'
    case 'COMPLETED': return st === 'COMPLETED' || Number(rec.stage) >= 8 ? null : 'Opens when the file is complete (stage 8 or Completed).'
    default: return null
  }
}

/**
 * May this person send this message about this record? roles = their roles; rec also has ownerId (the sales person),
 * teamLeadId (theirs). Sales people and team leaders only for their own (team's) clients; the other teams for every
 * client they can see. Answers null, or why not.
 */
export function stageDenied(stageId, roles, userId, rec) {
  const s = stageOf(stageId)
  if (!s) return 'Unknown message.'
  if (roles.some((r) => MASTER.includes(r))) return null
  const mine = roles.filter((r) => s.teams.includes(r))
  if (!mine.length) return 'Your team does not send this message.'
  const sellerOnly = mine.every((r) => r === 'sales' || r === 'teamlead')
  if (sellerOnly && !(rec.ownerId === userId || (roles.includes('teamlead') && rec.teamLeadId === userId))) return 'Only for your own clients.'
  return null
}
/** The messages a person may send about a record (open or not — closed ones show why). */
export const stagesFor = (roles, userId, rec) => MESSAGE_STAGES.filter((s) => !stageDenied(s.id, roles, userId, rec) && (s.on === 'any' || rec.kind === 'booking'))
/** Who edits the saved templates: the Operation Team and Admin (Super Admin / IT always). */
export const canEditTemplates = (roles) => roles.some((r) => ['operations', 'admin', ...MASTER].includes(r))

// ------------------------------------------------------------------ templates
export const PLACEHOLDERS = [
  ['client_name', 'Client name'], ['company', 'Client company'], ['application_no', 'Application / CRM entry number'], ['status', 'Process status'],
  ['stage', 'Processing stage'], ['service', 'Service / scheme'], ['team_member', 'Your name'], ['team_phone', 'Your phone'], ['our_company', 'Our company name'],
]
const sign = '\n\nRegards,\n{team_member}\n{our_company}{team_phone_line}'
export const DEFAULT_TEMPLATES = {
  WELCOME: {
    subject: 'Welcome to {our_company}, {client_name}',
    email: 'Dear {client_name},\n\nThank you for speaking with us about {service} for {company}. We are glad to have you with {our_company}.\n\nWhat happens next:\n• We will share the documents we need and the steps involved.\n• Once your payment is received, we open your file with our Accounts team.\n• You can reply to this message any time with questions.' + sign,
    whatsapp: 'Thank you for choosing {our_company} for {service}. We will share the documents needed and the next steps shortly. Reply here any time with questions.',
  },
  ACCOUNT_CLEARED: {
    subject: 'Account cleared — your file {application_no} is with our Legal team',
    email: 'Dear {client_name},\n\nGood news: your account for {service} ({application_no}) has been cleared by our Accounts team.\n\nYour file has now been forwarded to our Legal team for verification. We will update you as soon as it is complete.' + sign,
    whatsapp: 'Your account for {service} ({application_no}) has been cleared by our Accounts team, and your file is now with our Legal team for verification. We will update you soon.',
  },
  LEGAL_CLEARED: {
    subject: 'Legal verification complete — file {application_no} is with our Operations team',
    email: 'Dear {client_name},\n\nAll required files for {service} ({application_no}) have been cleared by our Legal team.\n\nYour file has been forwarded to our Operation team, who will take it forward from here and keep you updated.' + sign,
    whatsapp: 'All required files for {service} ({application_no}) have been cleared by our Legal team. Your file is now with our Operation team for further processing.',
  },
  DOCUMENTS: {
    subject: 'Documents needed for {application_no}',
    email: 'Dear {client_name},\n\nTo continue with {service} ({application_no}), please share the following documents:\n• \n• \n\nYou can reply to this email with them attached.' + sign,
    whatsapp: 'To continue with {service} ({application_no}), please share the documents we need. Our team will send you the list — reply here with any questions.',
  },
  STAGE_UPDATE: {
    subject: 'Update on your file {application_no}',
    email: 'Dear {client_name},\n\nYour file for {service} ({application_no}) is now at: {stage}.\n\nWe will keep you updated on the next steps.' + sign,
    whatsapp: 'Your file for {service} ({application_no}) is now at: {stage}. We will keep you updated on the next steps.',
  },
  SUBMITTED: {
    subject: 'Application submitted — {application_no}',
    email: 'Dear {client_name},\n\nYour application for {service} ({application_no}) has been submitted. We will inform you as soon as we hear back.' + sign,
    whatsapp: 'Your application for {service} ({application_no}) has been submitted. We will inform you as soon as we hear back.',
  },
  COMPLETED: {
    subject: 'Your file {application_no} is complete',
    email: 'Dear {client_name},\n\nWe are happy to let you know that the work on {service} ({application_no}) is complete. Thank you for trusting {our_company}.' + sign,
    whatsapp: 'The work on {service} ({application_no}) is complete. Thank you for trusting {our_company}!',
  },
  PAYMENT_REMINDER: {
    subject: 'Payment reminder — {application_no}',
    email: 'Dear {client_name},\n\nThis is a gentle reminder that a balance payment for {service} ({application_no}) is due. Please let us know once it is done, or reply if you have any questions.' + sign,
    whatsapp: 'A gentle reminder that a balance payment for {service} ({application_no}) is due. Please let us know once it is done.',
  },
  GENERAL: {
    subject: 'About your file {application_no}',
    email: 'Dear {client_name},\n\n' + sign.trim(),
    whatsapp: '',
  },
}
/** The saved templates over the defaults (a stage never saved uses its default). */
export const templatesWith = (saved) => Object.fromEntries(MESSAGE_STAGES.map((s) => [s.id, { ...DEFAULT_TEMPLATES[s.id], ...(saved?.[s.id] ?? {}) }]))

/** {placeholders} filled in; an unknown one is left as typed (so the sender sees and fixes it). */
export function fillMessage(text, vars) {
  const v = { ...vars, team_phone_line: vars.team_phone ? `\n${vars.team_phone}` : '' }
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in v && v[k] != null && v[k] !== '' ? String(v[k]) : k in v ? '' : m))
    // "Pvt. Ltd." at the end of a sentence: one full stop, not two (an ellipsis stays)
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
}
/** Placeholders still left in a message (not filled) — the sender is asked to fix them. */
export const leftovers = (text) => [...new Set((String(text).match(/\{(\w+)\}/g) ?? []))]

// ------------------------------------------------------------------ WhatsApp (Interakt)
// Messages go in the approved "client notification" template (Workflow settings → notifyTemplate, WHATSAPP_NOTIFY_VARS).
/** WhatsApp template values can't hold line breaks: one line, at most 900 characters. */
export const oneLine = (s) => String(s ?? '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 900)

/** What is wrong with a message before it is sent (null = fine). */
export function messageProblem(m) {
  if (!m || typeof m !== 'object') return 'Bad request.'
  if (!stageOf(m.stage)) return 'Pick which message to send.'
  if (!(m.channel in CHANNELS)) return 'Pick WhatsApp or Email.'
  const body = String(m.body ?? '').trim()
  if (body.length < 3) return 'Write the message.'
  if (body.length > (m.channel === 'WHATSAPP' ? 900 : 6000)) return m.channel === 'WHATSAPP' ? 'A WhatsApp message can be up to 900 characters.' : 'The email can be up to 6000 characters.'
  if (m.channel === 'EMAIL' && (String(m.subject ?? '').trim().length < 3 || String(m.subject).length > 200)) return 'Write the email subject (3–200 characters).'
  const left = leftovers(`${m.subject ?? ''} ${body}`)
  if (left.length) return `Fill in or remove ${left.join(', ')} before sending.`
  if (!m.bookingId === !m.clientEntryId) return 'Which client is it for?'
  return null
}
