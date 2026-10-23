// Workflow rules shared by the CRM (browser) and the live server's scheduled jobs (server/jobs.mjs), so both decide
// the same way: which files are due a follow-up, when the Pitch Deck reminder repeats, when a scheme expires,
// Admin progress figures, and the welcome message text. Plain JavaScript, no imports.

/** The five Admin work stages tracked on every file Admin works on. */
export const ADMIN_STAGES = [
  { id: 'PRECHECK', label: 'Pitch Deck', short: 'Pitch Deck' },
  { id: 'FINANCE', label: 'Finance Added', short: 'Finance' },
  { id: 'DPR', label: 'DPR — Detailed Project Report', short: 'DPR' },
  { id: 'CERTIFICATION', label: 'Certification', short: 'Certification' },
  { id: 'SUBMISSION', label: 'Application / Submission', short: 'Submission' },
]
/** Status of one Admin stage on one file. NOT_NEEDED stages are left out of every count and percentage. */
export const ADMIN_WORK_STATUSES = [
  { id: 'NOT_STARTED', label: 'Not started', tone: 'gray' },
  { id: 'IN_PROGRESS', label: 'In progress', tone: 'blue' },
  { id: 'PENDING_DOCUMENTS', label: 'Pending documents', tone: 'amber' },
  { id: 'PENDING_REVIEW', label: 'Pending review', tone: 'violet' },
  { id: 'SUBMITTED', label: 'Submitted', tone: 'cyan' },
  { id: 'APPROVED', label: 'Approved', tone: 'green' },
  { id: 'RETURNED', label: 'Rejected / returned', tone: 'red' },
  { id: 'COMPLETED', label: 'Completed', tone: 'green' },
  { id: 'NOT_NEEDED', label: 'Not needed', tone: 'gray' },
]
export const ADMIN_DONE = ['APPROVED', 'COMPLETED']
export const adminStatusLabel = (s) => ADMIN_WORK_STATUSES.find((x) => x.id === s)?.label ?? s

/** Files that are being worked (follow-ups and Admin progress only count these). */
export const ACTIVE_FILE_STATUSES = ['IN_OPERATIONS', 'WITH_ADMIN', 'OPS_REVIEW', 'ON_HOLD']
/** Files that are out of the work (never followed up, never counted as pending). */
export const CLOSED_FILE_STATUSES = ['COMPLETED', 'REJECTED']

export const DEFAULT_WORKFLOW = {
  fileReminderDays: 15,
  precheckDays: 3,
  welcomeAuto: true,
  welcomeEmail: {
    subject: 'Welcome to {company} — your file {reference} is with our Operations team',
    body: [
      'Dear {client_name},',
      '',
      'Thank you for choosing {company}. We have received your file for {service} and our legal team has approved it. It is now with our Operations team, who will take it forward from here.',
      '',
      'Reference: {reference}',
      'Current status: {status}',
      '',
      'Next steps:',
      '• {ops_name} from our Operations team will contact you shortly.',
      '• Please keep your company documents (PAN, GST, incorporation, bank details) ready.',
      '• Reply to this email or call us if anything has changed.',
      '',
      'Operations contact: {ops_name} · {ops_phone} · {ops_email}',
    ].join('\n'),
  },
  welcomeWhatsapp: 'Hello {client_name}, welcome to {company}! Your file {reference} for {service} has been approved by our legal team and is now with our Operations team ({status}). {ops_name} will contact you shortly — {ops_phone}.',
  schemeAlertRoles: ['admin', 'operations'],
  opsContact: { name: '', phone: '', email: '' },
  // Interakt template names (approved by Meta in the Interakt dashboard); empty = not set up, nothing is sent
  whatsapp: { welcomeTemplate: '', invoiceTemplate: '', formTemplate: '', language: 'en' },
}
/** The settings with every missing value filled from the defaults. */
export const workflowSettings = (w) => ({
  ...DEFAULT_WORKFLOW, ...(w ?? {}),
  welcomeEmail: { ...DEFAULT_WORKFLOW.welcomeEmail, ...(w?.welcomeEmail ?? {}) },
  opsContact: { ...DEFAULT_WORKFLOW.opsContact, ...(w?.opsContact ?? {}) },
  whatsapp: { ...DEFAULT_WORKFLOW.whatsapp, ...(w?.whatsapp ?? {}) },
})

// ------------------------------------------------------------------ WhatsApp templates (Interakt)
/** What fills {{1}}, {{2}}, … of each template, in this order — the template in Interakt must use the same order. */
export const WHATSAPP_WELCOME_VARS = ['client_name', 'service', 'reference', 'ops_name', 'ops_phone']
export const WHATSAPP_INVOICE_VARS = ['client_name', 'document', 'amount', 'company']
export const WHATSAPP_FORM_VARS = ['client_name', 'form', 'link', 'company']
/** Template values in order; WhatsApp refuses an empty variable, so a missing one becomes "-". */
export const templateValues = (names, vars) => names.map((n) => String(vars?.[n] ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-')

// ------------------------------------------------------------------ dates (India time, YYYY-MM-DD)
/** Today in India, whatever clock zone the computer or server runs in. */
export function istToday(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
const utc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) }
/** Whole days from a to b (b later = positive). */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000)
/** The first reminder date after `today`, stepping `every` days from `from` (a missed reminder isn't sent twice). */
export function nextAfter(from, every, today) {
  if (from > today) return from
  const steps = Math.floor(daysBetween(from, today) / every) + 1
  return addDays(from, steps * every)
}

// ------------------------------------------------------------------ 15-day file follow-up
/** Due today (or overdue): the file is being worked, the schedule isn't paused and its date has come. */
export const followUpDue = (b, today) => !!b.followUp && !b.followUp.paused && ACTIVE_FILE_STATUSES.includes(b.status) && b.followUp.nextOn <= today

// ------------------------------------------------------------------ Pitch Deck reminder (every 3 or 4 days)
export const precheckPending = (b) => {
  const w = b.adminWork?.PRECHECK
  return !!w && ACTIVE_FILE_STATUSES.includes(b.status) && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED'
}
export const precheckDue = (b, today) => precheckPending(b) && !!b.adminWork.PRECHECK.nextRemindOn && b.adminWork.PRECHECK.nextRemindOn <= today

// ------------------------------------------------------------------ schemes
/** UPCOMING / ACTIVE / EXPIRED (after its end date) / INACTIVE (switched off) / NO_DATES */
export function schemeState(s, today) {
  if (!s.active) return 'INACTIVE'
  if (!s.startDate || !s.endDate) return 'NO_DATES'
  if (today < s.startDate) return 'UPCOMING'
  if (today > s.endDate) return 'EXPIRED'
  return 'ACTIVE'
}
/** Days from start to end, both included (1 Jan – 31 Jan = 31 days). */
export const schemeDuration = (s) => (s.startDate && s.endDate ? daysBetween(s.startDate, s.endDate) + 1 : null)
export const schemeDaysLeft = (s, today) => (s.endDate ? daysBetween(today, s.endDate) : null)
/** The one-day-before expiry alert is due (sent once per end date). */
export const schemeAlertDue = (s, today) => !!s.active && !!s.endDate && s.endDate === addDays(today, 1)

// ------------------------------------------------------------------ Admin progress
/**
 * Admin progress for a list of files: for each Admin employee and stage, how many files are in each status, how many
 * are done, overdue, and done / eligible. A file counts once per stage, for the person assigned to that stage (else
 * the file's Admin). Closed (completed / rejected) files are left out of "pending" but their done stages still count
 * as done; NOT_NEEDED stages are left out entirely.
 */
export function adminProgress(bookings, today) {
  const rows = new Map()
  const blank = () => Object.fromEntries(ADMIN_STAGES.map((s) => [s.id, { total: 0, done: 0, overdue: 0, byStatus: {}, ids: [], updatedAt: '' }]))
  for (const b of bookings) {
    if (!b.adminWork || b.status === 'REJECTED') continue
    for (const st of ADMIN_STAGES) {
      const w = b.adminWork[st.id]
      if (!w || w.status === 'NOT_NEEDED') continue
      const who = w.assignee || b.adminId || ''
      if (!rows.has(who)) rows.set(who, blank())
      const cell = rows.get(who)[st.id]
      cell.total++
      cell.ids.push(b.id)
      cell.byStatus[w.status] = (cell.byStatus[w.status] ?? 0) + 1
      if (ADMIN_DONE.includes(w.status)) cell.done++
      else if (w.due && w.due < today && b.status !== 'COMPLETED') cell.overdue++
      if (w.updatedAt > cell.updatedAt) cell.updatedAt = w.updatedAt
    }
  }
  return [...rows.entries()].map(([userId, stages]) => {
    const total = Object.values(stages).reduce((t, c) => t + c.total, 0), done = Object.values(stages).reduce((t, c) => t + c.done, 0)
    return { userId, stages, total, done, overdue: Object.values(stages).reduce((t, c) => t + c.overdue, 0), pct: total ? Math.round((done / total) * 100) : null }
  })
}

// ------------------------------------------------------------------ welcome message
/** {client_name} … placeholders → values (unknown ones are left as they are). */
export const fillTemplate = (text, vars) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : k === 'ops_phone' || k === 'ops_email' ? '—' : m))
export const WELCOME_PLACEHOLDERS = ['{client_name}', '{company}', '{service}', '{reference}', '{status}', '{ops_name}', '{ops_phone}', '{ops_email}']
