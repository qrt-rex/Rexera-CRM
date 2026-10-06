import {
  BarChart3, BellRing, BookOpenCheck, Briefcase, CalendarDays, ClipboardCheck, FileText, FolderKanban, Images, IndianRupee,
  KeyRound, Megaphone, MessagesSquare, Phone, Settings, ShieldCheck, Sparkles, UserCheck, UserPlus, Users, UsersRound,
  CalendarCheck2, Network, ScrollText, Wallet, Receipt, Landmark, Trophy, SlidersHorizontal, Gauge, KeySquare, DatabaseBackup, DatabaseZap, MailPlus, ClipboardList, FilePen, Inbox, type LucideIcon,
} from 'lucide-react'
import type { Perm } from './types'
import type { Tone } from './workflow'

export interface ModuleDef {
  key: string
  path: string
  label: string
  desc: string
  icon: LucideIcon
  tone: Tone
  /** visible when the user has ANY of these (empty = everyone signed in) */
  perms: Perm[]
  group: 'Sales' | 'Client files' | 'Content' | 'People' | 'Finance' | 'Workspace' | 'Admin'
  /** listed only in the HR sidebar (still searchable with Ctrl K) */
  hrOnly?: boolean
}

export const MODULES: ModuleDef[] = [
  { key: 'leads', path: '/leads', label: 'CRM Leads', desc: 'Add, call, follow up and convert leads', icon: UserPlus, tone: 'navy', perms: ['leads.own', 'leads.manage'], group: 'Sales' },
  { key: 'dialer', path: '/dialer', label: 'Dialer', desc: 'Power-dial your queue and log outcomes', icon: Phone, tone: 'orange', perms: ['dialer.use'], group: 'Sales' },
  { key: 'team', path: '/team', label: 'Sales Team Progress', desc: 'Calls, conversions and collections by person', icon: BarChart3, tone: 'green', perms: ['team.progress'], group: 'Sales' },
  { key: 'assign', path: '/assign', label: 'Client Assignment', desc: 'Who owns which client, reassign within team', icon: Network, tone: 'pink', perms: ['team.assign', 'bookings.create', 'leads.assign'], group: 'Sales' },
  { key: 'bookings', path: '/bookings', label: 'CRM Entries', desc: 'Client bookings, approvals and payments', icon: Briefcase, tone: 'violet', perms: ['bookings.own', 'bookings.team', 'bookings.all'], group: 'Client files' },
  { key: 'approvals', path: '/approvals', label: 'Waiting for me', desc: 'Files that need your decision now', icon: ClipboardCheck, tone: 'amber', perms: ['bookings.approve_tl', 'bookings.accounts', 'bookings.legal', 'bookings.process', 'bookings.admin'], group: 'Client files' },
  { key: 'work', path: '/work', label: 'Client Work Board', desc: '9-stage processing kanban', icon: FolderKanban, tone: 'cyan', perms: ['bookings.process', 'bookings.admin', 'bookings.legal', 'bookings.all'], group: 'Client files' },
  { key: 'documents', path: '/documents', label: 'Document Forms', desc: 'Collect and verify client documents', icon: FileText, tone: 'blue', perms: ['documents.forms'], group: 'Client files' },
  { key: 'schemes', path: '/schemes', label: 'Schemes', desc: 'Government schemes and offers', icon: Sparkles, tone: 'green', perms: ['schemes.view', 'schemes.manage'], group: 'Content' },
  { key: 'content', path: '/content', label: 'Flyers, Posts & Sales Info', desc: 'Marketing material and sales scripts', icon: Images, tone: 'orange', perms: ['content.view', 'content.manage'], group: 'Content' },
  { key: 'broadcasts', path: '/broadcasts', label: 'Broadcasts', desc: 'Company updates with acknowledgement', icon: Megaphone, tone: 'red', perms: ['broadcasts.view', 'broadcasts.manage'], group: 'Content' },
  { key: 'billing', path: '/billing', label: 'Invoice / Bill', desc: 'GST invoices, proforma and receivables', icon: IndianRupee, tone: 'amber', perms: ['billing.own', 'billing.create', 'billing.manage'], group: 'Finance' },
  { key: 'attendance', path: '/attendance', label: 'Attendance Board', desc: 'Live day status and history', icon: UserCheck, tone: 'green', perms: [], group: 'People' },
  { key: 'leave', path: '/leave', label: 'Leave', desc: 'Request my leave, approve requests', icon: CalendarCheck2, tone: 'violet', perms: [], group: 'People' },
  { key: 'employees', path: '/employees', label: 'Employee Details', desc: 'Directory, profiles and teams', icon: UsersRound, tone: 'cyan', perms: ['employees.view', 'employees.manage', 'access.manage'], group: 'People' },
  { key: 'payroll', path: '/payroll', label: 'Payroll', desc: 'Monthly salary runs: calculate, approve, lock, pay', icon: Wallet, tone: 'blue', perms: ['payroll.view', 'payroll.manage'], group: 'People', hrOnly: true },
  { key: 'payslips', path: '/payslips', label: 'Payslips', desc: 'Printable payslips for finalised months', icon: Receipt, tone: 'cyan', perms: [], group: 'People', hrOnly: true },
  { key: 'pf', path: '/pf', label: 'PF Management', desc: 'PF rules, wage limits, UANs', icon: Landmark, tone: 'green', perms: ['payroll.view', 'payroll.manage'], group: 'People', hrOnly: true },
  { key: 'incentives', path: '/incentives', label: 'Sales Incentives', desc: 'Daily, weekly and monthly incentive per sales person', icon: Trophy, tone: 'orange', perms: ['incentives.manage', 'payroll.view'], group: 'People', hrOnly: true },
  { key: 'incentive-settings', path: '/incentive-settings', label: 'Incentive Settings', desc: 'Thresholds and slabs, versioned', icon: SlidersHorizontal, tone: 'amber', perms: ['incentives.manage'], group: 'People', hrOnly: true },
  { key: 'performance', path: '/performance', label: 'Performance', desc: 'Report cards and scores', icon: Gauge, tone: 'violet', perms: ['performance.view'], group: 'People', hrOnly: true },
  { key: 'candidates', path: '/candidates', label: 'Candidate Forms', desc: 'Share an apply link; resumes come in here', icon: ClipboardList, tone: 'violet', perms: ['recruitment.manage'], group: 'People', hrOnly: true },
  { key: 'letters', path: '/letters', label: 'Letters', desc: 'Joining, internship and experience letters (PDF)', icon: FilePen, tone: 'pink', perms: ['employees.manage'], group: 'People', hrOnly: true },
  { key: 'recruitment', path: '/recruitment', label: 'Recruitment', desc: 'Import CSV / Excel files into tables', icon: Briefcase, tone: 'navy', perms: ['recruitment.manage'], group: 'People', hrOnly: true },
  { key: 'events', path: '/events', label: 'Events & Calendar', desc: 'Meetings, trainings, holidays', icon: CalendarDays, tone: 'pink', perms: [], group: 'People' },
  { key: 'messages', path: '/messages', label: 'Messages', desc: 'Team chat and document sharing', icon: MessagesSquare, tone: 'blue', perms: ['messages.use'], group: 'Workspace' },
  { key: 'email-center', path: '/email-center', label: 'Email Center', desc: 'Email people at their login address, automations', icon: MailPlus, tone: 'orange', perms: ['email.send'], group: 'Workspace' },
  { key: 'inbox', path: '/inbox', label: 'Email', desc: 'Emails sent to your login address', icon: Inbox, tone: 'blue', perms: [], group: 'Workspace' },
  { key: 'reports', path: '/reports', label: 'Reports', desc: 'Analytics, report cards and exports', icon: BookOpenCheck, tone: 'navy', perms: ['reports.view'], group: 'Workspace' },
  { key: 'notifications', path: '/notifications', label: 'Notifications', desc: 'Everything that needs your attention', icon: BellRing, tone: 'orange', perms: [], group: 'Workspace' },
  { key: 'access', path: '/access', label: 'Access Management', desc: 'Users, roles and permissions', icon: KeyRound, tone: 'navy', perms: ['access.manage'], group: 'Admin' },
  { key: 'api-keys', path: '/api-keys', label: 'API Keys', desc: 'Keys for integrations: create, rotate, revoke', icon: KeySquare, tone: 'orange', perms: ['access.manage'], group: 'Admin' },
  { key: 'legacy-import', path: '/legacy-import', label: 'Import from old CRM', desc: 'Load the old PHP CRM .sql dump, checked line by line', icon: DatabaseZap, tone: 'violet', perms: ['access.manage'], group: 'Admin' },
  { key: 'backup', path: '/backup', label: 'Data Backup & Restore', desc: 'Encrypted backups, snapshots, restore', icon: DatabaseBackup, tone: 'cyan', perms: ['access.manage'], group: 'Admin' },
  { key: 'audit', path: '/audit', label: 'Activity Log', desc: 'Who did what and when', icon: ScrollText, tone: 'gray', perms: ['audit.view'], group: 'Admin' },
  { key: 'security', path: '/settings', label: 'Profile & Settings', desc: 'Profile, security, appearance', icon: Settings, tone: 'gray', perms: [], group: 'Workspace' },
  { key: 'users', path: '/access?tab=users', label: 'Users', desc: 'Create and manage accounts', icon: Users, tone: 'navy', perms: ['access.manage'], group: 'Admin' },
  { key: 'system', path: '/access?tab=settings', label: 'System Settings', desc: 'Session timeout, company, GST state', icon: ShieldCheck, tone: 'gray', perms: ['access.manage'], group: 'Admin' },
]

export const moduleByKey = (k: string) => MODULES.find((m) => m.key === k)!
export const canSee = (m: ModuleDef, has: (...p: Perm[]) => boolean) => !m.perms.length || has(...m.perms)
