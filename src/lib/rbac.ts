import type { DB, Perm, Role, User } from './types'

export const ROLES: { id: Role; label: string; short: string; color: string; desc: string }[] = [
  { id: 'superadmin', label: 'Super Admin', short: 'SA', color: '#2E3A8C', desc: 'Everything, every dashboard, final say' },
  { id: 'admin', label: 'Admin', short: 'AD', color: '#7C3AED', desc: 'Completes client work assigned by Operations' },
  { id: 'accounts', label: 'Accounts', short: 'AC', color: '#0E9F6E', desc: 'Verifies payments; approves, rejects or holds client files' },
  { id: 'legal', label: 'Legal', short: 'LG', color: '#B45309', desc: 'Reviews approved files and assigns them to Operations' },
  { id: 'operations', label: 'Operation Team', short: 'OP', color: '#0891B2', desc: 'Processes files through the 9 stages, assigns to Admin' },
  { id: 'teamlead', label: 'Team Leader', short: 'TL', color: '#DB2777', desc: 'Leads a sales team, first approval of CRM entries' },
  { id: 'sales', label: 'Sales Person', short: 'SP', color: '#F47B20', desc: 'Calls leads, books clients, submits CRM entries' },
  { id: 'hr', label: 'HR', short: 'HR', color: '#059669', desc: 'People, attendance, leave and company updates' },
  { id: 'it', label: 'IT Support', short: 'IT', color: '#475569', desc: 'Master access: users & access, API keys, backups, system tools' },
  { id: 'support', label: 'Customer Support', short: 'CS', color: '#0D9488', desc: 'Answers client queries, follows up documents and status' },
]

export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r
export const roleColor = (r: Role) => ROLES.find((x) => x.id === r)?.color ?? '#6B7280'

export const PERM_GROUPS: { group: string; perms: { id: Perm; label: string }[] }[] = [
  {
    group: 'Sales',
    perms: [
      { id: 'leads.own', label: 'Work own leads' },
      { id: 'leads.manage', label: 'See & manage all leads' },
      { id: 'leads.assign', label: 'Assign leads / clients' },
      { id: 'dialer.use', label: 'Use the dialer' },
      { id: 'team.progress', label: 'Sales team progress' },
      { id: 'team.assign', label: 'Assign clients to sales people' },
    ],
  },
  {
    group: 'CRM entries (bookings)',
    perms: [
      { id: 'bookings.create', label: 'Create CRM entries' },
      { id: 'bookings.own', label: 'See own CRM entries' },
      { id: 'bookings.team', label: 'See team CRM entries' },
      { id: 'bookings.all', label: 'See all CRM entries' },
      { id: 'bookings.approve_tl', label: 'Team-leader approval' },
      { id: 'bookings.accounts', label: 'Accounts: approve / reject / hold, edit money' },
      { id: 'bookings.legal', label: 'Legal: review & assign to Operations' },
      { id: 'bookings.process', label: 'Operations: process stages, assign to Admin' },
      { id: 'bookings.admin', label: 'Admin: complete or hold client work' },
    ],
  },
  {
    group: 'Content',
    perms: [
      { id: 'content.view', label: 'View flyers, posts & sales info' },
      { id: 'content.manage', label: 'Create / edit flyers, posts & sales info' },
      { id: 'schemes.view', label: 'View schemes' },
      { id: 'schemes.manage', label: 'Manage schemes' },
      { id: 'broadcasts.view', label: 'View broadcasts' },
      { id: 'broadcasts.manage', label: 'Publish broadcasts' },
      { id: 'documents.forms', label: 'Client document forms' },
    ],
  },
  {
    group: 'Billing',
    perms: [
      { id: 'billing.own', label: 'See own invoices' },
      { id: 'billing.create', label: 'Create proforma / invoices' },
      { id: 'billing.manage', label: 'All invoices, payments & cancel' },
    ],
  },
  {
    group: 'People',
    perms: [
      { id: 'attendance.all', label: "See everyone's attendance" },
      { id: 'leave.approve', label: 'Approve leave' },
      { id: 'employees.view', label: 'Employee directory' },
      { id: 'employees.manage', label: 'Add / edit employees' },
      { id: 'events.manage', label: 'Create events' },
      { id: 'performance.view', label: 'Performance report cards' },
      { id: 'recruitment.manage', label: 'Recruitment & data import' },
    ],
  },
  {
    group: 'Payroll',
    perms: [
      { id: 'payroll.view', label: "See everyone's payroll & payslips" },
      { id: 'payroll.manage', label: 'Run payroll, PF settings' },
      { id: 'incentives.manage', label: 'Sales incentive rules' },
    ],
  },
  {
    group: 'Workspace & admin',
    perms: [
      { id: 'messages.use', label: 'Internal messages' },
      { id: 'email.send', label: 'Email Center & email automations' },
      { id: 'templates.manage', label: 'Message templates' },
      { id: 'reports.view', label: 'Reports & analytics' },
      { id: 'reports.export', label: 'Export data (CSV)' },
      { id: 'access.manage', label: 'Roles, users & permissions' },
      { id: 'audit.view', label: 'Activity log' },
    ],
  },
]

export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.id))

const common: Perm[] = ['broadcasts.view', 'messages.use', 'schemes.view', 'content.view']

export const DEFAULT_ROLE_PERMS: Record<Role, Perm[]> = {
  superadmin: [...ALL_PERMS],
  admin: [...common, 'bookings.all', 'bookings.admin', 'content.manage', 'employees.view', 'documents.forms', 'reports.view'],
  accounts: [...common, 'bookings.all', 'bookings.accounts', 'billing.create', 'billing.manage', 'reports.view', 'reports.export'],
  legal: [...common, 'bookings.all', 'bookings.legal', 'documents.forms', 'leave.approve', 'reports.view'],
  operations: [...common, 'bookings.all', 'bookings.process', 'content.manage', 'employees.view', 'documents.forms', 'reports.view', 'events.manage'],
  teamlead: [
    ...common, 'leads.own', 'leads.assign', 'dialer.use', 'bookings.create', 'bookings.own', 'bookings.team', 'bookings.approve_tl',
    'billing.own', 'billing.create', 'team.progress', 'team.assign', 'documents.forms', 'leave.approve', 'reports.view',
  ],
  sales: [...common, 'leads.own', 'dialer.use', 'bookings.create', 'bookings.own', 'billing.own', 'billing.create', 'documents.forms'],
  hr: [
    ...common, 'attendance.all', 'leave.approve', 'employees.view', 'employees.manage', 'events.manage', 'broadcasts.manage',
    'templates.manage', 'reports.view', 'reports.export', 'audit.view',
    'payroll.view', 'payroll.manage', 'incentives.manage', 'recruitment.manage', 'performance.view', 'email.send',
  ],
  it: [...ALL_PERMS],
  support: [...common, 'bookings.all', 'documents.forms', 'templates.manage'],
}

/** Permissions a role may never hold, whatever the matrix or per-user grants say. */
export const RESERVED: Partial<Record<Perm, Role[]>> = {
  'access.manage': ['superadmin'],
  'billing.manage': ['superadmin', 'accounts'],
  'bookings.accounts': ['superadmin', 'accounts'],
  'payroll.view': ['superadmin', 'hr'],
  'payroll.manage': ['superadmin', 'hr'],
  'incentives.manage': ['superadmin', 'hr'],
}

export function rolesOf(u: User): Role[] {
  return [u.role, ...u.extraRoles.filter((r) => r !== u.role)]
}

/** Super Admin and IT Support hold every permission and can open every dashboard. */
export const MASTER_ROLES: Role[] = ['superadmin', 'it']
export const isMaster = (u: User) => rolesOf(u).some((r) => MASTER_ROLES.includes(r))

export function effectivePerms(db: DB, u: User | null | undefined): Set<Perm> {
  if (!u) return new Set()
  const roles = rolesOf(u)
  if (roles.some((r) => MASTER_ROLES.includes(r))) return new Set(ALL_PERMS)
  const s = new Set<Perm>()
  for (const r of roles) for (const p of db.rolePerms[r] ?? DEFAULT_ROLE_PERMS[r]) s.add(p)
  for (const p of u.grants) s.add(p)
  for (const p of u.denies) s.delete(p)
  for (const [perm, allowed] of Object.entries(RESERVED) as [Perm, Role[]][]) {
    if (s.has(perm) && !roles.some((r) => allowed.includes(r))) s.delete(perm)
  }
  return s
}

export function canOpenDashboard(u: User, slug: Role) {
  return rolesOf(u).includes(slug) || isMaster(u)
}
