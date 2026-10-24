export type Role = 'superadmin' | 'admin' | 'accounts' | 'legal' | 'operations' | 'teamlead' | 'sales' | 'hr' | 'it' | 'support' | 'branchdirector'

export type Perm =
  | 'leads.own' | 'leads.manage' | 'leads.assign' | 'leads.admin' | 'dialer.use'
  | 'bookings.create' | 'bookings.own' | 'bookings.team' | 'bookings.all'
  | 'bookings.approve_tl' | 'bookings.accounts' | 'bookings.legal' | 'bookings.process' | 'bookings.admin'
  | 'content.view' | 'content.manage' | 'salesinfo.manage' | 'schemes.view' | 'schemes.manage'
  | 'broadcasts.view' | 'broadcasts.manage'
  | 'billing.own' | 'billing.create' | 'billing.manage' | 'refunds.manage'
  | 'workflow.manage' | 'forms.manage' | 'followup.manage' | 'saleskit.manage'
  | 'team.progress' | 'team.assign'
  | 'attendance.all' | 'leave.approve'
  | 'employees.view' | 'employees.manage'
  | 'events.manage' | 'messages.use' | 'templates.manage'
  | 'documents.forms' | 'reports.view' | 'reports.export'
  | 'access.manage' | 'audit.view'
  | 'payroll.view' | 'payroll.manage' | 'incentives.manage' | 'recruitment.manage' | 'performance.view'
  | 'email.send' | 'assets.manage'

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
  /** last working day (set when HR removes the employee) */
  exitOn?: string
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
  /** own shift (HR → Break Time); anything left out follows the company break policy */
  shift?: Shift
  /** the branch this person works in (Access → Settings → branches) */
  branchId?: string
  /** Branch Director: the branches they run (empty = every branch) */
  branchIds?: string[]
}

/** A person's own break window, time zone and weekly off days. */
export interface Shift { breakStart?: string; breakEnd?: string; timeZone?: string; offDays?: number[] }

/** Every original column of a record imported from the old CRM, exactly as it was. */
export type LegacyRow = Record<string, string | null>

/** Lead dispositions — the same list as the Blutec dialer's call report (and the old CRM). */
export type LeadStatus =
  | 'NEW' | 'ANSWER' | 'INTRO' | 'HOT_PROSPECT' | 'CALL_BACK' | 'NOT_PICKUP' | 'BUSY' | 'VOICE_MAIL'
  | 'NOT_INTERESTED' | 'WRONG_NUMBER' | 'DND' | 'LANGUAGE_ISSUE' | 'SCRAP' | 'CONVERTED'
/** A call ends with a disposition (any status but New). */
export type CallOutcome = Exclude<LeadStatus, 'NEW'>

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
  /** from uploaded sheets / web forms (old CRM fields) */
  altPhone?: string
  location?: string
  industry?: string
  businessType?: string
  turnover?: string
  fundingAmount?: string
  fundingCategory?: string
  requirement?: string
  /** when the client filled the form (sheet timestamp) */
  formAt?: string
  /** every other column of the uploaded row, as it was */
  extra?: Record<string, string>
  /** the upload batch it came from (Leads → Upload history) */
  uploadId?: string
  /** who handed the lead to whom, oldest first */
  chain?: LeadHop[]
  /** when the current owner got it; and when they first opened it (unseen = "new" badge) */
  assignedAt?: string
  seenAt?: string
  /** what happened to the lead, newest first */
  history?: LeadEvent[]
}
export interface LeadHop { to: string; by: string; at: string; kind: 'ASSIGNED' | 'REASSIGNED' | 'FORWARDED'; note?: string }
export interface LeadEvent { at: string; by: string; action: string; note?: string }
/** One uploaded lead sheet (Super Admin → Leads → Upload). */
export interface LeadUpload { id: string; fileName: string; size: number; totalRows: number; imported: number; by: string; at: string }

export type BookingStatus =
  | 'PENDING_TL' | 'PENDING_ACCOUNTS' | 'ACCOUNTS_HOLD' | 'PENDING_LEGAL' | 'CHANGES_REQUIRED'
  | 'IN_OPERATIONS' | 'WITH_ADMIN' | 'OPS_REVIEW' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED'

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
  /** attachment proving the payment was received */
  proof?: FileRef
  /** the client paid after deducting TDS (1–15 %, 10 % by default): `amount` is the TDS kept back on this payment */
  tds?: { pct: number; amount: number }
}

/** One delivery of an automatic client message (welcome email / WhatsApp). Never marked SENT unless the provider accepted it. */
export interface Delivery {
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'NO_CONTACT' | 'SKIPPED'
  to?: string
  attempts: number
  lastAt?: string
  sentAt?: string
  error?: string
  /** the provider's message id (Interakt) */
  messageId?: string
  /** staff opened the chat / mail by hand (not a delivery confirmation) */
  manualAt?: string
  manualBy?: string
}
/** The welcome message sent to the client once Legal approves the file and it moves to Operations (once per file). */
export interface WelcomeState { email: Delivery; whatsapp: Delivery; createdAt: string; createdBy: string }
/** Every-15-days follow-up while Operations works the file (Admin can pause / resume / reschedule). */
export interface FollowUp {
  everyDays: number
  startedOn: string
  nextOn: string
  lastOn?: string
  paused?: boolean
  log: { at: string; by: string; kind: 'NOTE' | 'REMINDER' | 'PAUSE' | 'RESUME' | 'RESCHEDULE'; note?: string }[]
}
/** The five Admin work stages tracked on every file Admin works on. */
export type AdminStageId = 'PRECHECK' | 'FINANCE' | 'DPR' | 'CERTIFICATION' | 'SUBMISSION'
export type AdminWorkStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PENDING_DOCUMENTS' | 'PENDING_REVIEW' | 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'COMPLETED' | 'NOT_NEEDED'
export interface AdminWorkItem {
  status: AdminWorkStatus
  /** the Admin employee doing this stage (defaults to the file's Admin) */
  assignee?: string
  /** assignment number: the file number plus /1, /2, /3 … — one more each time the file goes to another person */
  ref?: string
  assignedBy?: string
  assignedAt?: string
  /** when it was last marked Submitted, and by whom */
  submittedAt?: string
  submittedBy?: string
  due?: string
  updatedAt: string
  updatedBy: string
  startedAt?: string
  doneAt?: string
  history: { at: string; by: string; status: AdminWorkStatus; note?: string; assignee?: string; ref?: string }[]
  /** Pitch Deck follow-up: every 3 (or 4) days while it is pending */
  remindEveryDays?: number
  nextRemindOn?: string
  lastFollowUpOn?: string
}
/** Admin / Operations settings for the automated workflow (Workflow settings page). */
export interface WorkflowSettings {
  fileReminderDays: number
  precheckDays: number
  welcomeAuto: boolean
  welcomeEmail: { subject: string; body: string }
  welcomeWhatsapp: string
  /** who gets the one-day-before scheme expiry alert */
  schemeAlertRoles: Role[]
  /** shown to clients in the welcome message */
  opsContact: { name: string; phone: string; email: string }
  /** document types each Admin may handle and upload (user id → stages); a person not listed may do all five */
  adminStageAccess?: Record<string, AdminStageId[]>
  /** Interakt template names (approved by Meta); empty = WhatsApp not set up for that message */
  whatsapp: { welcomeTemplate: string; invoiceTemplate: string; formTemplate: string; language: string }
}

// ------------------------------------------------------------------ Document Form Builder (client links)
export type FormFieldType = 'text' | 'textarea' | 'email' | 'phone' | 'date' | 'number' | 'select' | 'checkbox' | 'file'
export interface FormField { id: string; label: string; type: FormFieldType; required: boolean; options?: string[]; help?: string }
/**
 * A form sent to a client by secure link: ONLINE = fields to fill in (and files to upload); UPLOAD = a document the
 * client downloads and returns completed. Editing a published form makes a new version; old answers keep theirs.
 */
export interface DocForm {
  id: string
  /** secret, unguessable part of the link (/f/<token>); a new one revokes the old link */
  token: string
  name: string
  description: string
  instructions: string
  kind: 'ONLINE' | 'UPLOAD'
  fields: FormField[]
  version: number
  versions: { version: number; at: string; by: string; fields: FormField[] }[]
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED'
  /** the client file it belongs to (optional) */
  bookingId?: string
  /** the link stops working after this day */
  expiresOn?: string
  /** the client must enter the mobile number on the client file before they see or submit anything */
  verify: 'NONE' | 'MOBILE'
  /** UPLOAD forms: the document the client downloads */
  document?: FileRef
  createdBy: string
  createdAt: string
  updatedAt: string
  updatedBy: string
  views: number
  lastViewedAt?: string
}
export interface FormSubmission {
  id: string
  formId: string
  formVersion: number
  bookingId?: string
  /** the fields as they were when the client answered */
  fields: FormField[]
  answers: Record<string, string | number | boolean>
  files: { fieldId: string; file: FileRef }[]
  submittedAt: string
  status: 'NEW' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED'
  reviewedBy?: string
  reviewedAt?: string
  note?: string
}

/** How a CRM entry is booked: one service, several services, or a combo package (3 / 6 / 9 / 12 months). */
export type BookingType = 'SINGLE' | 'MULTIPLE' | 'COMBO3' | 'COMBO6' | 'COMBO9' | 'COMBO12'
/** Money paid back to a client (Accounts only). */
export interface Refund {
  id: string
  amount: number
  /** the day the refund was asked for / agreed */
  date: string
  reason: string
  status: 'PENDING' | 'REFUNDED'
  refundedOn?: string
  mode?: string
  /** UTR / cheque no. */
  ref?: string
  by: string
  at: string
}

export interface Approval { id: string; level: string; action: string; by: string; at: string; remark: string }
export interface StageMove { stage: number; at: string; by: string; note: string; outcome?: string }
export interface BComment { id: string; by: string; at: string; text: string; kind: string }
export interface BDoc {
  id: string; name: string; category: string; size: number; at: string; by: string; dataUrl?: string; status?: 'PENDING' | 'VERIFIED' | 'REJECTED'; legacyPath?: string; file?: FileRef; note?: string
  /** who verified / rejected it, and when (final: only a Super Admin can change it afterwards) */
  reviewedBy?: string; reviewedAt?: string
}
export interface BTask {
  id: string; title: string; done: boolean; due?: string; by: string; assignee?: string
  /** remind the processing person and the admin person every N days (15) until done */
  remindEveryDays?: number
  createdAt?: string
  lastRemindedAt?: string
}

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
  /** step / result inside the current stage: stage 3 IN_PROCESS | IN_REVIEW, stage 8 APPROVED | REJECTED | RESUBMISSION | HOLD_CLIENT */
  stageOutcome?: string
  /** why stage 8 is Rejected / Re-submission / Hold */
  stageReason?: string
  /** every service on the entry with its price (bifurcation); serviceId / serviceName mirror the first / all names */
  services?: BookingService[]
  /** combo booking: services can be added until the deadline (3, 6, 9 or 12 months from the booking date) */
  combo?: { months: 3 | 6 | 9 | 12; startedOn: string; deadline: string; deadlineNotified?: boolean }
  /** Single / Multiple / Combo (older entries: worked out from the services and combo) */
  bookingType?: BookingType
  /** commission to the CA / DSA who brought the client (Accounts, optional): 5–30 % */
  commission?: {
    to: 'CA' | 'DSA'; name: string; pct: number; amount: number; by: string; at: string
    /** paid out to the CA / DSA (Accounts): the amount actually paid is kept */
    status?: 'PENDING' | 'PAID'; paidOn?: string; paidAmount?: number; mode?: string; ref?: string; paidBy?: string
  }
  /** money paid back to the client (Accounts only) */
  refunds?: Refund[]
  /** automatic welcome message after Legal approval (email + WhatsApp) */
  welcome?: WelcomeState
  /** every-15-days follow-up schedule while the file is being processed */
  followUp?: FollowUp
  /** Admin checklist: Pitch Deck, Finance Added, DPR, Certification, Application / Submission */
  adminWork?: Partial<Record<AdminStageId, AdminWorkItem>>
  paymentContact?: string
  paymentEmail?: string
  /** booking date entered by sales (createdAt keeps the exact date and time of entry) */
  bookingDate?: string
  /** after-discount success fee: an amount or a percentage (0 = client did not agree) */
  successFee?: { type: 'AMOUNT' | 'PCT'; value: number }
  /** sales person's remarks (mandatory on new entries) */
  remarks?: string
  /** who closed the lead (defaults to the person entering it) */
  closedBy?: string
  /** emails sent to the client from the file (Operation team / Admin) */
  clientEmails?: ClientEmailLog[]
}

/** One email to the client: SENT by the CRM, MAIL_APP = handed to the sender's own email app, FAILED = not sent. */
export interface ClientEmailLog {
  id: string; at: string; by: string
  to: string; cc: string[]; subject: string; template: string
  status: 'SENT' | 'MAIL_APP' | 'FAILED'
  error?: string
}

/** A service on a CRM entry; `complimentary` ones are given free by the Operation team. */
export interface BookingService { serviceId: string; name: string; price: number; complimentary?: boolean; addedBy?: string; addedAt?: string }
export interface Service {
  id: string; name: string; category: string; price: number; gstRate: number; deduction: number; active: boolean
  /** price by booking type (Single uses `price`); blank = same as Single */
  prices?: Partial<Record<BookingType, number>>
}

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
  /** branch the invoice is issued from (Accounts chooses it before printing a tax invoice) */
  branchId?: string
  clientAddress?: string
  clientPan?: string
  /** each time the PDF was sent to the client (written by the live server only — the provider's answer, never assumed) */
  shares?: InvoiceShare[]
}
export interface InvoiceShare {
  id: string; at: string; by: string; channel: 'email' | 'whatsapp'; to: string
  /** SENT = accepted by the mail server / Interakt */
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'NO_CONTACT'
  error?: string; messageId?: string
}

/** One scheme in the Sales Kit (what sales offers clients): everyone reads it, the Operation team edits it. */
export interface SalesKitItem {
  id: string
  /** Grant, Equity, Loan … (the sheets of the original Sales Kit) */
  category: string
  position: number
  name: string
  benefits: string
  sectors: string
  eligibility: string
  /** a date or "Rolling basis" */
  lastDate: string
  organisation: string
  schemeType: string
  applicableFor: string
  /** our upfront charge, e.g. "INR 10,000 + 18% GST" */
  minCharge: string
  /** government registration charge / note (Certification, GeM) */
  registrationCharge?: string
  updatedAt?: string
  updatedBy?: string
}

/** Company branch: invoices show its address and GSTIN. */
export interface Branch {
  id: string; name: string; /** short code shown on dashboards, e.g. AMD-A */ code?: string; address: string; city: string; state: string; pin: string; gstin: string; phone: string; email: string
  /** bank details printed on its invoices, e.g. "HDFC Bank · A/c 5020… · IFSC HDFC0001234" (nothing printed when empty) */
  bank?: string
}

export interface Scheme {
  id: string; title: string; category: string; summary: string; benefit: string; eligibility: string; active: boolean; createdAt: string; by: string
  /** price (₹) shown to sales */
  price?: number
  /** the scheme runs from startDate to endDate (both inclusive); expired after endDate */
  startDate?: string
  endDate?: string
  updatedAt?: string
  updatedBy?: string
}
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

/** A break inside the working day. Breaks share the lunch window's budget (HR → Break Time). */
export interface DayBreak { start: string; end?: string }
/** Back from lunch after the break window ended. Kept on the day for history and reports. */
export interface LateBreak {
  breakStart: string
  /** end of that day's break window */
  expectedReturn: string
  /** resumed (or ended the day); empty while still away */
  returnedAt?: string
  /** whole minutes after the expected return (from the end + 1 min) */
  lateMinutes: number
  /** the employee got the "return to work" warning */
  warnedAt?: string
}
export interface DaySession {
  id: string; userId: string; date: string; loginAt: string
  /** set when the person ends the day — they can't sign in again until tomorrow */
  logoutAt?: string
  breaks?: DayBreak[]
  /** HR/IT re-opened the day after it was ended */
  reopenedBy?: string
  lateBreak?: LateBreak
}
/** Lunch break rules, set by HR (HR → Break Time). Times are HH:MM in `timeZone`; people with a shift override them. */
export interface BreakPolicy {
  start: string
  end: string
  /** IANA time zone, e.g. Asia/Kolkata */
  timeZone: string
  /** weekdays nobody is scheduled (0 = Sunday): no reminder, no late alert */
  offDays: number[]
  /** minutes after the end when someone still away is warned (2 → 1:42 pm) */
  warnAfterMin: number
  /** "break has started" reminder at the start time */
  remind: boolean
  /** late-break checks: warning to the employee, alert to HR */
  monitor: boolean
  warnMessage: string
  updatedAt?: string
  updatedBy?: string
}

/** An uploaded file kept in the browser's file store (lib/files.ts); records only hold this reference. */
export interface FileRef { id: string; name: string; type: string; size: number; at: string }
/** An old-CRM upload that isn't linked to a client file: where it was, and our best guess of what it is. */
export interface LegacyFile { path: string; file: FileRef; kind: string }

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
  /** the office the candidate is applying for (JOB_BRANCHES) */
  branch?: string
  /** the position they apply for (starts as the form's role title) */
  position?: string
  /** Internship / Fresher / Employee (experienced) */
  candidateType?: 'INTERNSHIP' | 'FRESHER' | 'EXPERIENCED'
  /** current CTC (experienced candidates) */
  currentCtc?: string
  /** preferred interview slot, India time: YYYY-MM-DDTHH:mm */
  interviewAt?: string
  linkedin?: string
  message?: string
  resume: FileRef
  submittedAt: string
  status: 'NEW' | 'SHORTLISTED' | 'REJECTED' | 'HIRED'
  notes?: string
}

export interface Notice { id: string; userId: string; title: string; body: string; link?: string; at: string; read: boolean; kind: 'info' | 'success' | 'warning' | 'action' }
export interface Message { id: string; from: string; to: string; body: string; at: string; read: boolean; attachments?: FileRef[] }
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
  /** after Logout, no sign-in until the next day (IT / Super Admin always can). Off = testing: people can sign in again. */
  dayLock?: boolean
  branches?: Branch[]
  breakPolicy?: BreakPolicy
  /** automatic lead assignment (round robin): new website / CSV / manual leads go to these people in turn */
  leadAssign?: LeadAssign
  /** reminder intervals, welcome templates, scheme alert recipients */
  workflow?: WorkflowSettings
  /** written by the live server's scheduled job each time it runs (read-only in the app) */
  jobs?: { lastRunAt: string; summary?: string }
}
/** Round robin: `next` is the position in `userIds` that gets the next lead (wraps back to the first person). */
export interface LeadAssign { on: boolean; userIds: string[]; next: number }

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
  /** salary paid to this person (date, UTR / cheque no., who marked it) — Salary Paid / Not Paid */
  paidOn?: string
  paidRef?: string
  paidBy?: string
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

// ------------------------------------------------------------------ company assets, inventory, expenses (HR)
export type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'REPAIR' | 'RETIRED'
export interface AssetEvent { at: string; by: string; action: 'ADDED' | 'ASSIGNED' | 'RETURNED' | 'REPAIR' | 'RETIRED' | 'BACK_IN_STOCK' | 'EDITED'; userId?: string; note?: string }
/** One individually tracked item (laptop, phone, SIM, chair…). */
export interface Asset {
  id: string
  /** RX-AST-0001 */
  tag: string
  name: string
  category: string
  brand?: string
  model?: string
  serial?: string
  purchaseDate?: string
  cost?: number
  vendor?: string
  warrantyUntil?: string
  location?: string
  condition?: 'NEW' | 'GOOD' | 'FAIR' | 'POOR'
  status: AssetStatus
  assignedTo?: string
  assignedOn?: string
  notes?: string
  invoice?: FileRef
  history: AssetEvent[]
  createdAt: string
}
export interface StockMove { at: string; by: string; qty: number; note?: string; issuedTo?: string }
/** Consumables counted by quantity (stationery, pantry, toner…). */
export interface StockItem { id: string; name: string; category: string; unit: string; qty: number; minQty: number; unitCost?: number; location?: string; moves: StockMove[]; createdAt: string }
export interface Expense {
  id: string
  date: string
  category: string
  description: string
  /** amount before GST */
  amount: number
  gst: number
  vendor?: string
  paidVia: 'CASH' | 'UPI' | 'BANK' | 'CARD' | 'CHEQUE'
  paidBy?: string
  /** branch the expense belongs to (AMD-A, AMD-Y, BRD …); none = all branches / head office */
  branchId?: string
  bill?: FileRef
  by: string
  createdAt: string
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
  /** files from the old CRM's uploads folder that no client file refers to (kept so nothing is lost) */
  legacyFiles?: LegacyFile[]
  leadUploads?: LeadUpload[]
  assets?: Asset[]
  stock?: StockItem[]
  expenses?: Expense[]
  /** Document Form Builder: forms sent to clients by secure link, and what came back */
  docForms?: DocForm[]
  salesKit?: SalesKitItem[]
  formSubmissions?: FormSubmission[]
  /** one-time data upgrades already applied */
  upgrades: string[]
}
