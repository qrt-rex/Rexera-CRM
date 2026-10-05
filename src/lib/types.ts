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
}

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
}

export interface Approval { id: string; level: string; action: string; by: string; at: string; remark: string }
export interface StageMove { stage: number; at: string; by: string; note: string }
export interface BComment { id: string; by: string; at: string; text: string; kind: string }
export interface BDoc { id: string; name: string; category: string; size: number; at: string; by: string; dataUrl?: string; status?: 'PENDING' | 'VERIFIED' | 'REJECTED' }
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
}

export interface DaySession { id: string; userId: string; date: string; loginAt: string; logoutAt?: string }

export interface Notice { id: string; userId: string; title: string; body: string; link?: string; at: string; read: boolean; kind: 'info' | 'success' | 'warning' | 'action' }
export interface Message { id: string; from: string; to: string; body: string; at: string; read: boolean }
export interface Template { id: string; name: string; body: string; by: string }
export interface Audit { id: string; at: string; by: string; action: string; detail: string }

export interface Settings { sessionMinutes: number; supplierState: string; companyName: string; companyGstin: string }

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
}
