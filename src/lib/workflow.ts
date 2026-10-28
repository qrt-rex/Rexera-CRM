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
  CHANGES_REQUIRED: { label: 'Changes required (Legal)', tone: 'amber', owner: 'sales', step: 3 },
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

/** The 14 lead dispositions, in the order people pick them (same as the Blutec dialer's call report). */
export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  NEW: { label: 'New', tone: 'blue' },
  ANSWER: { label: 'Answer', tone: 'cyan' },
  INTRO: { label: 'Intro', tone: 'violet' },
  HOT_PROSPECT: { label: 'Hot prospect', tone: 'orange' },
  CALL_BACK: { label: 'Call back', tone: 'amber' },
  NOT_PICKUP: { label: 'Not pickup', tone: 'gray' },
  BUSY: { label: 'Busy', tone: 'gray' },
  VOICE_MAIL: { label: 'Voice mail', tone: 'gray' },
  NOT_INTERESTED: { label: 'Not interested', tone: 'red' },
  WRONG_NUMBER: { label: 'Wrong number', tone: 'red' },
  DND: { label: 'DND', tone: 'red' },
  LANGUAGE_ISSUE: { label: 'Language issue', tone: 'gray' },
  SCRAP: { label: 'Scrap', tone: 'red' },
  CONVERTED: { label: 'Converted', tone: 'green' },
}
/** Still being worked on (in the queue and dialer). */
export const OPEN_LEAD: LeadStatus[] = ['NEW', 'ANSWER', 'INTRO', 'HOT_PROSPECT', 'CALL_BACK', 'NOT_PICKUP', 'BUSY', 'VOICE_MAIL', 'LANGUAGE_ISSUE']
/** Dead ends. */
export const CLOSED_LEAD: LeadStatus[] = ['NOT_INTERESTED', 'WRONG_NUMBER', 'DND', 'SCRAP']
/** These ask for the next follow-up date. */
export const FOLLOW_UP_LEAD: LeadStatus[] = ['INTRO', 'HOT_PROSPECT', 'CALL_BACK']

/** A call ends with any disposition but New; the lead takes that disposition. */
export const CALL_OUTCOMES: { id: CallOutcome; label: string; to: LeadStatus; tone: Tone }[] = (Object.keys(LEAD_STATUS) as LeadStatus[])
  .filter((k): k is CallOutcome => k !== 'NEW').map((k) => ({ id: k, label: LEAD_STATUS[k].label, to: k, tone: LEAD_STATUS[k].tone }))

/** A disposition written as text (Blutec's call report, old-CRM rows, a sheet column) → the status, if it names one. */
export function dispositionToStatus(text?: string | null): LeadStatus | undefined {
  const k = (text ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!k) return undefined
  const byLabel = (Object.keys(LEAD_STATUS) as LeadStatus[]).find((s) => LEAD_STATUS[s].label.toLowerCase().replace(/[^a-z]/g, '') === k)
  if (byLabel) return byLabel
  const ALIAS: Record<string, LeadStatus> = {
    contacted: 'ANSWER', answered: 'ANSWER', interested: 'HOT_PROSPECT', hot: 'HOT_PROSPECT', callback: 'CALL_BACK', followuprequired: 'CALL_BACK',
    noanswer: 'NOT_PICKUP', notpicked: 'NOT_PICKUP', notpickedup: 'NOT_PICKUP', noresponse: 'NOT_PICKUP', voicemail: 'VOICE_MAIL',
    invalid: 'WRONG_NUMBER', wrong: 'WRONG_NUMBER', closed: 'NOT_INTERESTED', sale: 'CONVERTED', booked: 'CONVERTED',
  }
  return ALIAS[k]
}

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
/** Legal attaches one of these to the client's file before handing it to Operations. */
export const LEGAL_DOC_CATEGORIES = ['Agreement', 'Undertaking']
export const hasLegalDoc = (b: { documents: { category: string }[] }) => b.documents.some((x) => LEGAL_DOC_CATEGORIES.includes(x.category))
/** Counts as KYC in the missing-KYC lists. */
export const KYC_CATEGORIES = ['KYC', 'Aadhaar card', 'Company PAN card', 'Passport / photo']

export const DOC_CATEGORIES = [
  ...DOC_FORM.map((d) => d.cat),
  'CRM', 'Quotation (QT)', 'Agreement', 'Undertaking', 'Payment receipt', 'F.R (Financial report)', 'D.P.R (Detailed project report)', 'KYC', 'Company documents',
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
  if (/undertak/.test(n)) return 'Undertaking'
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
