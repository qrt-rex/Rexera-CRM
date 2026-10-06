export type Role = 'superadmin' | 'admin' | 'accounts' | 'legal' | 'operations' | 'teamlead' | 'sales' | 'hr' | 'it' | 'support'

export type Perm =
  | 'leads.own' | 'leads.manage' | 'leads.assign' | 'dialer.use'
  | 'bookings.create' | 'bookings.own' | 'bookings.team' | 'bookings.all'
  | 'bookings.approve_tl' | 'bookings.accounts' | 'bookings.legal' | 'bookings.process' | 'bookings.admin'
  | 'content.view' | 'content.manage' | 'schemes.view' | 'schemes.manage'
  | 'broadcasts.view' | 'broadcasts.manage'
  | 'billing.own' | 'billing.create' | 'billing.manage'
  | 'team.progress' | 'team.assign'
  | 'attendance.all' | 'leave.approve'
  | 'employees.view' | 'employees.manage'
  | 'events.manage' | 'messages.use' | 'templates.manage'
  | 'documents.forms' | 'reports.view' | 'reports.export'
  | 'access.manage' | 'audit.view'
  | 'payroll.view' | 'payroll.manage' | 'incentives.manage' | 'recruitment.manage' | 'performance.view'
  | 'email.send'

export interface Address { line: string; city: string; state: string; pin: string; country: string }

export interface User {
  id: string
  name: string
  username: string
  email: string
  phone: string
  role: Role
  extraRoles: Role[]
  grants: Perm[]
  denies: Perm[]
  teamLeadId?: string
  department: string
  designation: string
  joinedOn: string
  active: boolean
  passHash: string
  photo?: string
  address?: Address
  salary?: number
  target?: number
  /** imported from the old PHP CRM */
  legacyId?: number
  legacyRole?: string
  /** account came from the old CRM without a password; IT must reset it before first sign-in */
  needsPasswordReset?: boolean
  /** resume uploaded when HR added the person */
  resume?: FileRef
}

/** Every original column of a record imported from the old CRM, exactly as it was. */
export type LegacyRow = Record<string, string | null>

export type LeadStatus = 'NEW' | 'ATTEMPTED' | 'CALL_BACK' | 'INTERESTED' | 'NOT_INTERESTED' | 'CONVERTED' | 'INVALID'
export type CallOutcome = 'NO_ANSWER' | 'BUSY' | 'CALL_BACK' | 'INTERESTED' | 'NOT_INTERESTED' | 'CONVERTED' | 'WRONG_NUMBER'

export interface Call { id: string; at: string; by: string; outcome: CallOutcome; note: string; durationSec: number }

export interface Lead {
  id: string
  code: string
  name: string
  company: string
  phone: string
  email: string
  city: string
  state: string
  service: string
  source: string
  price?: number
  status: LeadStatus
  followUp?: string
  notes: string
  assignedTo?: string
  createdBy: string
  createdAt: string
  calls: Call[]
  legacy?: LegacyRow
}

export type BookingStatus =
  | 'PENDING_TL' | 'PENDING_ACCOUNTS' | 'ACCOUNTS_HOLD' | 'PENDING_LEGAL'
  | 'IN_OPERATIONS' | 'WITH_ADMIN' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED'

export interface Payment {
  id: string
  part: number
  amount: number
  gst: number
  total: number
  date: string
  mode: string
  proofName: string
  recordedBy: string
  verified: boolean
  /** imported from the old CRM without a date: `date` is the booking day */
  dateUnknown?: boolean
}

export interface Approval { id: string; level: string; action: string; by: string; at: string; remark: string }
export interface StageMove { stage: number; at: string; by: string; note: string }
export interface BComment { id: string; by: string; at: string; text: string; kind: string }
export interface BDoc { id: string; name: string; category: string; size: number; at: string; by: string; dataUrl?: string; status?: 'PENDING' | 'VERIFIED' | 'REJECTED'; legacyPath?: string }
export interface BTask { id: string; title: string; done: boolean; due?: string; by: string; assignee?: string }

export interface Booking {
  id: string
  bookingId: string
  companyName: string
  contactPerson: string
  mobile: string
  email: string
  pan: string
  gstin: string
  city: string
  state: string
  industry: string
  serviceId: string
  serviceName: string
  mode: 'Refundable' | 'Non-Refundable'
  successFeePct: number
  totalQuoted: number
  gstRate: number
  deduction: number
  payments: Payment[]
  createdBy: string
  teamLeadId?: string
  status: BookingStatus
  holdFrom?: BookingStatus
  holdReason?: string
  approvals: Approval[]
  opsMemberId?: string
  adminId?: string
  stage: number
  maxStage: number
  stageHistory: StageMove[]
  comments: BComment[]
  documents: BDoc[]
  tasks: BTask[]
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  deadline: string
  leadId?: string
  createdAt: string
  updatedAt: string
  /** old-CRM id and every original column (crm row + workflow/deduction rows), kept unchanged */
  legacyId?: number
  legacy?: { crm: LegacyRow; workflow?: LegacyRow; deductions?: LegacyRow[] }
  address?: string
  website?: string
  /** CIN / LLPIN */
  cin?: string
  startupContact?: { phone: string; email: string }
  /** invoice-to details, only when they differ from the client's own */
  billing?: { name: string; pan: string; gstin: string; contact: string; email: string }
  /** closer's name when they aren't a CRM user (old-CRM files) */
  ownerName?: string
}

export interface Service { id: string; name: string; category: string; price: number; gstRate: number; deduction: number; active: boolean }

export interface InvoiceItem { desc: string; sac: string; qty: number; rate: number; gstRate: number }
export interface Invoice {
  id: string
  number: string
  type: 'TAX' | 'PROFORMA'
  bookingId?: string
  client: string
  gstin: string
  state: string
  items: InvoiceItem[]
  paid: number
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'
  date: string
  due: string
  salesPerson?: string
  createdBy: string
}

export interface Scheme { id: string; title: string; category: string; summary: string; benefit: string; eligibility: string; active: boolean; createdAt: string; by: string }
export interface Post { id: string; kind: 'FLYER' | 'POST' | 'SALES_INFO'; title: string; body: string; theme: string; createdAt: string; by: string; pinned?: boolean }
export interface Broadcast { id: string; title: string; body: string; priority: 'NORMAL' | 'HIGH' | 'URGENT'; audience: Role[] | 'ALL'; by: string; at: string; acks: string[] }
export interface EventItem { id: string; title: string; date: string; time: string; kind: 'MEETING' | 'TRAINING' | 'HOLIDAY' | 'DEADLINE' | 'CELEBRATION'; description: string; by: string }

export type LeaveType = 'CL' | 'SL' | 'EL' | 'LOP'
export interface LeaveRequest {
  id: string
  userId: string
  type: LeaveType
  from: string
  to: string
  days: number
  reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  approvers: Role[]
  decidedBy?: string
  decidedAt?: string
  remark?: string
  createdAt: string
  /** required for leave longer than 2 days (photo or PDF) */
  attachment?: FileRef
}

/** A break inside the working day. Breaks share a daily budget (BREAK_MINUTES). */
export interface DayBreak { start: string; end?: string }
export interface DaySession {
  id: string; userId: string; date: string; loginAt: string
  /** set when the person ends the day — they can't sign in again until tomorrow */
  logoutAt?: string
  breaks?: DayBreak[]
  /** HR/IT re-opened the day after it was ended */
  reopenedBy?: string
}

/** An uploaded file kept in the browser's file store (lib/files.ts); records only hold this reference. */
export interface FileRef { id: string; name: string; type: string; size: number; at: string }

export interface CandidateForm {
  id: string
  /** used in the public link /apply/<token> */
  token: string
  title: string
  kind: 'JOB' | 'INTERNSHIP'
  department: string
  description: string
  active: boolean
  createdAt: string
  by: string
}
export interface CandidateApplication {
  id: string
  formId: string
  name: string
  email: string
  phone: string
  city: string
  dob?: string
  qualification: string
  college?: string
  experience: string
  currentCompany?: string
  expectedSalary?: string
  noticePeriod?: string
  linkedin?: string
  message?: string
  resume: FileRef
  submittedAt: string
  status: 'NEW' | 'SHORTLISTED' | 'REJECTED' | 'HIRED'
  notes?: string
}

export interface Notice { id: string; userId: string; title: string; body: string; link?: string; at: string; read: boolean; kind: 'info' | 'success' | 'warning' | 'action' }
export interface Message { id: string; from: string; to: string; body: string; at: string; read: boolean }
export interface Template { id: string; name: string; body: string; by: string }
export interface Audit { id: string; at: string; by: string; action: string; detail: string }

export interface Settings {
  sessionMinutes: number
  supplierState: string
  companyName: string
  companyGstin: string
  /** while on, only IT and Super Admin can sign in or use the app */
  maintenance?: { on: boolean; message: string; by: string; at: string }
  /** sessions started before this moment are signed out ("sign out everyone") */
  sessionsValidAfter?: string
}

export type ApiScope = 'leads:read' | 'leads:write' | 'bookings:read' | 'billing:read' | 'reports:read' | 'webhooks:send'
export interface ApiKey {
  id: string
  name: string
  /** first characters, shown so people can tell keys apart; the full key is never stored */
  prefix: string
  hash: string
  scopes: ApiScope[]
  createdBy: string
  createdAt: string
  expiresAt?: string
  revokedAt?: string
  revokedBy?: string
}
/** One email to one person (personalised). Emails sent together share a batchId. */
export interface EmailMsg {
  id: string
  batchId: string
  to: string
  toEmail: string
  from: string
  subject: string
  body: string
  at: string
  automation?: string
  read: boolean
}
export type AutomationKey = 'welcome' | 'leave-decision' | 'payslip-ready' | 'start-day-reminder' | 'monthly-attendance' | 'work-anniversary' | 'broadcast-copy'
export interface EmailAutomation {
  key: AutomationKey
  enabled: boolean
  subject: string
  body: string
  lastRunKey?: string
  lastRunAt?: string
  sent: number
}

export interface BackupLogEntry { id: string; at: string; by: string; kind: 'DOWNLOAD' | 'SNAPSHOT' | 'AUTO_SNAPSHOT' | 'RESTORE' | 'IMPORT'; note: string; bytes: number; encrypted?: boolean }

export interface PayRow {
  userId: string
  name: string
  designation: string
  department: string
  /** monthly salary (CTC); runs saved before the salary-structure change don't have it */
  ctc?: number
  hra?: number
  otherAllowance?: number
  /** salary − employer PF */
  gross: number
  daysInMonth: number
  paidDays: number
  lopDays: number
  lopAmount: number
  basic: number
  pfWages: number
  pfEmployee: number
  pfEmployer: number
  pt: number
  /** automatic sales incentive for the month — HR reference only, not part of net salary */
  incentive: number
  /** net salary (for runs saved before the salary-structure change, this still includes the incentive) */
  net: number
}
export type PayrollStatus = 'CALCULATED' | 'APPROVED' | 'FINALIZED' | 'PAID'
export interface PayrollRun {
  id: string
  month: string
  status: PayrollStatus
  provisional: boolean
  rows: PayRow[]
  calculatedAt: string
  calculatedBy: string
  history: { at: string; by: string; action: string; note: string }[]
}
export interface PfSettings {
  enabled: boolean
  employeePct: number
  employerPct: number
  epsPct: number
  /** cap PF wages at wageCeiling (off = PF on the full basic) */
  ceilingEnabled: boolean
  wageCeiling: number
  /** PF is calculated on at least wageFloor (when basic is lower) */
  floorEnabled?: boolean
  wageFloor?: number
  ptEnabled: boolean
  /** basic as % of monthly salary */
  basicPct: number
  /** HRA as % of basic */
  hraPct: number
}
export interface PfAccount { userId: string; uan: string; enrolled: boolean }
/** Incentive added by HR for a month (also after the month). Shown in the HR pages only, never on payslips. */
export interface ManualIncentive {
  id: string
  userId: string
  month: string
  amount: number
  reason: string
  addedBy: string
  addedAt: string
  paidAt?: string
}
export interface IncentiveRules {
  version: number
  eligibilityMultiple: number
  dailyThreshold: number
  dailyPct: number
  weeklyThreshold: number
  weeklyPct: number
  monthlyMultiple: number
  slabs: { upTo: number | null; pct: number }[]
  updatedAt: string
  updatedBy: string
}

export interface DB {
  version: number
  users: User[]
  leads: Lead[]
  bookings: Booking[]
  services: Service[]
  invoices: Invoice[]
  schemes: Scheme[]
  posts: Post[]
  broadcasts: Broadcast[]
  events: EventItem[]
  leaves: LeaveRequest[]
  sessions: DaySession[]
  notices: Notice[]
  messages: Message[]
  templates: Template[]
  audit: Audit[]
  rolePerms: Record<Role, Perm[]>
  settings: Settings
  counters: { booking: number; lead: number; invoice: number }
  loginFails: Record<string, { count: number; until?: string }>
  payrollRuns: PayrollRun[]
  pfSettings: PfSettings
  pfAccounts: PfAccount[]
  incentiveRules: IncentiveRules
  incentiveHistory: IncentiveRules[]
  manualIncentives: ManualIncentive[]
  apiKeys: ApiKey[]
  backupLog: BackupLogEntry[]
  emails: EmailMsg[]
  emailAutomations: EmailAutomation[]
  candidateForms: CandidateForm[]
  candidates: CandidateApplication[]
  /** one-time data upgrades already applied */
  upgrades: string[]
}
