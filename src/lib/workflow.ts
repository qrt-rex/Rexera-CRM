import type { BookingStatus, CallOutcome, LeadStatus, Role } from './types'

/** Client work stages (Admin and Operations move files through these). */
export const STAGES = [
  'Data Collection',
  'Data Received',
  'Document In-process / In-review',
  'Document Approved',
  'Ready to Submit',
  'Submission',
  'Company Information Under Process',
  'Approved / Rejected / Re-submission / Hold',
] as const

/** Stages with a step (3) or a result (8) to choose; the first option is the default when a file reaches the stage. */
export const STAGE_OUTCOMES: Record<number, { id: string; label: string; tone: Tone }[]> = {
  3: [{ id: 'IN_PROCESS', label: 'Document in process', tone: 'blue' }, { id: 'IN_REVIEW', label: 'Document in review', tone: 'violet' }],
  8: [
    { id: 'APPROVED', label: 'Approved', tone: 'green' }, { id: 'REJECTED', label: 'Rejected', tone: 'red' },
    { id: 'RESUBMISSION', label: 'Re-submission', tone: 'amber' }, { id: 'HOLD_CLIENT', label: 'Hold', tone: 'orange' },
  ],
}
export const FINAL_STAGE = STAGES.length
/** "3. Document in review", "8. Approved" — the stage with its chosen step / result. */
export function stageLabel(stage: number, outcome?: string) {
  const o = STAGE_OUTCOMES[stage]?.find((x) => x.id === outcome)
  return `${stage}. ${o ? o.label : STAGES[stage - 1] ?? ''}`
}

export const HOLD_REASONS = [
  'Client not responsive',
  'Documents not complete',
  'Company incorporation under process',
  'Payment pending',
  'Internal issue',
]

type Tone = 'navy' | 'orange' | 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'gray' | 'cyan' | 'pink'

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone; owner: Role | null; step: number }> = {
  PENDING_TL: { label: 'Pending Team Leader', tone: 'pink', owner: 'teamlead', step: 1 },
  PENDING_ACCOUNTS: { label: 'Pending Accounts', tone: 'amber', owner: 'accounts', step: 2 },
  ACCOUNTS_HOLD: { label: 'On hold · Accounts', tone: 'orange', owner: 'accounts', step: 2 },
  PENDING_LEGAL: { label: 'Pending Legal', tone: 'violet', owner: 'legal', step: 3 },
  IN_OPERATIONS: { label: 'With Operations', tone: 'cyan', owner: 'operations', step: 4 },
  WITH_ADMIN: { label: 'With Admin', tone: 'blue', owner: 'admin', step: 5 },
  OPS_REVIEW: { label: 'Pending Operations approval', tone: 'violet', owner: 'operations', step: 6 },
  ON_HOLD: { label: 'On hold', tone: 'orange', owner: null, step: -1 },
  COMPLETED: { label: 'Completed', tone: 'green', owner: null, step: 7 },
  REJECTED: { label: 'Rejected', tone: 'red', owner: 'sales', step: 0 },
}

/** Approval / processing chain shown as a stepper on every CRM entry. */
export const CHAIN = [
  { key: 'SUBMITTED', label: 'Submitted', role: 'sales' as Role },
  { key: 'TL', label: 'Team Leader', role: 'teamlead' as Role },
  { key: 'ACCOUNTS', label: 'Accounts', role: 'accounts' as Role },
  { key: 'LEGAL', label: 'Legal', role: 'legal' as Role },
  { key: 'OPS', label: 'Operations', role: 'operations' as Role },
  { key: 'ADMIN', label: 'Admin', role: 'admin' as Role },
  { key: 'REVIEW', label: 'Ops approval', role: 'operations' as Role },
  { key: 'DONE', label: 'Completed', role: 'operations' as Role },
]

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  NEW: { label: 'New', tone: 'blue' },
  ATTEMPTED: { label: 'Attempted', tone: 'gray' },
  CALL_BACK: { label: 'Call back', tone: 'amber' },
  INTERESTED: { label: 'Interested · hot prospect', tone: 'violet' },
  NOT_INTERESTED: { label: 'Not interested', tone: 'red' },
  CONVERTED: { label: 'Converted', tone: 'green' },
  INVALID: { label: 'Invalid', tone: 'gray' },
}
export const OPEN_LEAD: LeadStatus[] = ['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED']

export const CALL_OUTCOMES: { id: CallOutcome; label: string; to: LeadStatus; tone: Tone }[] = [
  { id: 'NO_ANSWER', label: 'No answer', to: 'ATTEMPTED', tone: 'gray' },
  { id: 'BUSY', label: 'Busy', to: 'ATTEMPTED', tone: 'gray' },
  { id: 'CALL_BACK', label: 'Call back later', to: 'CALL_BACK', tone: 'amber' },
  { id: 'INTERESTED', label: 'Interested', to: 'INTERESTED', tone: 'violet' },
  { id: 'CONVERTED', label: 'Converted (sale)', to: 'CONVERTED', tone: 'green' },
  { id: 'NOT_INTERESTED', label: 'Not interested', to: 'NOT_INTERESTED', tone: 'red' },
  { id: 'WRONG_NUMBER', label: 'Wrong number', to: 'INVALID', tone: 'red' },
]

export const SERVICE_CATEGORIES = [
  'Government Grants & Schemes',
  'Certifications & Registrations',
  'Funding & Investment',
  'Company Services',
  'Digital Services',
]

/** The client document checklist on Document Forms (one upload slot each). */
export const DOC_FORM: { cat: string; short: string; hint: string }[] = [
  { cat: 'Certificate of Incorporation (COI)', short: 'COI', hint: 'Company incorporation certificate' },
  { cat: 'GST certificate', short: 'GST', hint: 'GST registration certificate' },
  { cat: 'MSME / Udyam certificate', short: 'MSME', hint: 'Udyam registration' },
  { cat: 'Aadhaar card', short: 'Aadhaar', hint: 'Director / proprietor Aadhaar' },
  { cat: 'Company PAN card', short: 'Company PAN', hint: 'PAN card of the company' },
  { cat: 'Bank statement', short: 'Bank statement', hint: 'Last 6 to 12 months' },
  { cat: 'ITR', short: 'ITR', hint: 'Income tax returns' },
  { cat: 'Pitch deck', short: 'Pitch deck', hint: 'Business presentation' },
  { cat: 'MOU', short: 'MOU', hint: 'Memorandum of understanding' },
  { cat: 'AOA', short: 'AOA', hint: 'Articles of association' },
  { cat: 'Passport / photo', short: 'Passport / photo', hint: 'Passport copy or passport-size photo' },
  { cat: 'CMA report', short: 'CMA', hint: 'Credit monitoring arrangement data' },
]
/** Counts as KYC in the missing-KYC lists. */
export const KYC_CATEGORIES = ['KYC', 'Aadhaar card', 'Company PAN card', 'Passport / photo']

export const DOC_CATEGORIES = [
  ...DOC_FORM.map((d) => d.cat),
  'CRM', 'Quotation (QT)', 'Agreement', 'Payment receipt', 'F.R (Financial report)', 'D.P.R (Detailed project report)', 'KYC', 'Company documents',
  'Government certificates', 'Financial', 'Other',
]

/** Best guess of the document type from its title / file name (the person can change it). */
export function guessCategory(name: string, fallback = 'Other') {
  const n = name.toLowerCase()
  if (/\bcoi\b|\bcio\b|incorporat/.test(n)) return 'Certificate of Incorporation (COI)'
  if (/msme|udyam|udyog/.test(n)) return 'MSME / Udyam certificate'
  if (/aadha?r/.test(n) && /\bpan\b/.test(n)) return 'KYC'
  if (/aadha?r/.test(n)) return 'Aadhaar card'
  if (/\bpan\b|pan[\s_-]?card/.test(n)) return 'Company PAN card'
  if (/gst/.test(n)) return 'GST certificate'
  if (/bank|statement/.test(n)) return 'Bank statement'
  if (/\bitr\b|income[\s_-]?tax/.test(n)) return 'ITR'
  if (/\bmou\b|\bmoa\b|memorandum/.test(n)) return 'MOU'
  if (/\baoa\b|articles/.test(n)) return 'AOA'
  if (/\bcma\b/.test(n)) return 'CMA report'
  if (/passport|photo/.test(n)) return 'Passport / photo'
  if (/agree|contract/.test(n)) return 'Agreement'
  if (/quot|\bqt\b|proposal/.test(n)) return 'Quotation (QT)'
  if (/\bcrm\b/.test(n)) return 'CRM'
  if (/pitch|deck/.test(n)) return 'Pitch deck'
  if (/\bdpr\b|project[\s_-]?report/.test(n)) return 'D.P.R (Detailed project report)'
  if (/\bfr\b|financial|balance|p&l/.test(n)) return 'F.R (Financial report)'
  if (/receipt|payment|utr|screenshot/.test(n)) return 'Payment receipt'
  if (/kyc|voter|director/.test(n)) return 'KYC'
  if (/dpiit|startup india|startup certificate|fssai|importer|iec\b|approval letter|\btan\b/.test(n)) return 'Government certificates'
  if (/logo|brochure|brand|product|concept|layout|mockup/.test(n)) return 'Company documents'
  return fallback
}

export const LEAD_SOURCES =['Website', 'Facebook Ads', 'Google Ads', 'Referral', 'Walk-in', 'IVR campaign', 'Exhibition', 'Cold call']

export type { Tone }
