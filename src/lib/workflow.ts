import type { BookingStatus, CallOutcome, LeadStatus, Role } from './types'

export const STAGES = [
  'Data Collection',
  'Data Received',
  'Documents In-process',
  'Documents In-review',
  'Documents Approved',
  'Ready to Submit',
  'Submitted',
  'Approved / Rejected',
  'Re-submission',
] as const

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
  ON_HOLD: { label: 'On hold', tone: 'orange', owner: null, step: -1 },
  COMPLETED: { label: 'Completed', tone: 'green', owner: null, step: 6 },
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
  { key: 'DONE', label: 'Completed', role: 'admin' as Role },
]

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  NEW: { label: 'New', tone: 'blue' },
  ATTEMPTED: { label: 'Attempted', tone: 'gray' },
  CALL_BACK: { label: 'Call back', tone: 'amber' },
  INTERESTED: { label: 'Interested', tone: 'violet' },
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

export const DOC_CATEGORIES = ['KYC', 'Company documents', 'Government certificates', 'Pitch deck / DPR', 'Financial', 'Other']

export const LEAD_SOURCES = ['Website', 'Facebook Ads', 'Google Ads', 'Referral', 'Walk-in', 'IVR campaign', 'Exhibition', 'Cold call']

export type { Tone }
