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
  { id: 'branchdirector', label: 'Branch Director', short: 'BD', color: '#0369A1', desc: 'Runs a branch: branch-wise progress, every sales person, assigns clients' },
  { id: 'digitalmedia', label: 'Digital Media', short: 'DM', color: '#BE185D', desc: 'Posts, flyers, posters and videos: creates, assigns and publishes media' },
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
      { id: 'leads.admin', label: 'CRM Leads page: add, upload, website leads, auto-assign, lead source (Super Admin)' },
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
      { id: 'followup.manage', label: 'Pause / resume / reschedule file follow-ups (Admin)' },
      { id: 'forms.manage', label: 'Document Form Builder: create forms and client links (Admin, Operation Team)' },
      { id: 'workflow.manage', label: 'Workflow settings: reminder intervals, welcome templates, alerts (Admin)' },
    ],
  },
  {
    group: 'Content',
    perms: [
      { id: 'content.view', label: 'View flyers, posts & sales info' },
      { id: 'content.manage', label: 'Create / edit flyers & posts (Admin, Operation Team)' },
      { id: 'salesinfo.manage', label: 'Add / edit sales information (Team Leader, Admin, Operation Team)' },
      { id: 'schemes.view', label: 'View schemes' },
      { id: 'schemes.manage', label: 'Add / edit schemes (Admin, Operation Team)' },
      { id: 'saleskit.manage', label: 'Edit the Sales Kit (Operation Team only)' },
      { id: 'eligibility.manage', label: 'Edit the Scheme Checker rules — schemes, conditions, documents (Super Admin & Operation Team only)' },
      { id: 'media.view', label: 'See company (internal) media on dashboards' },
      { id: 'media.manage', label: 'Digital Media section: dashboard, posts, flyers — create, assign, publish (Digital Media only)' },
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
      { id: 'refunds.manage', label: 'Refund entries (Accounts)' },
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
      { id: 'assets.manage', label: 'Company assets, inventory & expenses' },
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
      { id: 'reports.view', label: 'Reports & analytics' },
      { id: 'reports.export', label: 'Export data (CSV)' },
      { id: 'access.manage', label: 'Roles, users & permissions' },
      { id: 'website.manage', label: 'Website content, publishing & website leads (Super Admin)' },
      { id: 'portal.manage', label: 'Client portal accounts: invite, link, deactivate (Super Admin)' },
      { id: 'audit.view', label: 'Activity log' },
    ],
  },
]

export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.id))

const common: Perm[] = ['broadcasts.view', 'messages.use', 'schemes.view', 'content.view', 'media.view']

export const DEFAULT_ROLE_PERMS: Record<Role, Perm[]> = {
  superadmin: [...ALL_PERMS],
  admin: [...common, 'bookings.all', 'bookings.admin', 'content.manage', 'salesinfo.manage', 'schemes.manage', 'employees.view', 'documents.forms', 'reports.view', 'followup.manage', 'forms.manage', 'workflow.manage'],
  accounts: [...common, 'bookings.all', 'bookings.accounts', 'billing.create', 'billing.manage', 'refunds.manage', 'reports.view', 'reports.export'],
  legal: [...common, 'bookings.all', 'bookings.legal', 'documents.forms', 'leave.approve', 'reports.view'],
  operations: [...common, 'bookings.all', 'bookings.process', 'content.manage', 'salesinfo.manage', 'schemes.manage', 'employees.view', 'documents.forms', 'reports.view', 'events.manage', 'forms.manage', 'saleskit.manage', 'eligibility.manage'],
  teamlead: [
    ...common, 'salesinfo.manage', 'leads.own', 'leads.assign', 'dialer.use', 'bookings.create', 'bookings.own', 'bookings.team', 'bookings.approve_tl',
    'billing.own', 'billing.create', 'team.progress', 'team.assign', 'documents.forms', 'leave.approve', 'reports.view',
  ],
  sales: [...common, 'leads.own', 'dialer.use', 'bookings.create', 'bookings.own', 'billing.own', 'billing.create', 'documents.forms'],
  hr: [
    ...common, 'attendance.all', 'leave.approve', 'employees.view', 'employees.manage', 'events.manage', 'broadcasts.manage',
    'templates.manage', 'reports.view', 'reports.export', 'audit.view',
    'payroll.view', 'payroll.manage', 'incentives.manage', 'recruitment.manage', 'performance.view', 'email.send', 'assets.manage',
  ],
  it: [...ALL_PERMS],
  support: [...common, 'bookings.all', 'documents.forms', 'templates.manage'],
  // starting set — the Super Admin changes it in Access Management → Roles
  // Digital Media Dashboard: media, and the Flyers & Posts it feeds
  digitalmedia: [...common, 'media.manage', 'content.manage'],
  branchdirector: [...common, 'leads.manage', 'leads.assign', 'team.progress', 'team.assign', 'bookings.all', 'attendance.all', 'employees.view', 'reports.view', 'reports.export'],
}

/** Permissions a role may never hold, whatever the matrix or per-user grants say. */
export const RESERVED: Partial<Record<Perm, Role[]>> = {
  'access.manage': ['superadmin'],
  // the live website and client portal accounts: Super Admin only
  'website.manage': ['superadmin'],
  'portal.manage': ['superadmin'],
  'billing.manage': ['superadmin', 'accounts'],
  'refunds.manage': ['superadmin', 'accounts'],
  // the CRM Leads page (lead source, uploads, website leads, auto-assign) is the Super Admin's; others work leads in the Dialer
  'leads.admin': ['superadmin'],
  // workflow settings and follow-up schedules: Admin; client forms: Admin and the Operation team
  'workflow.manage': ['superadmin', 'admin'],
  'followup.manage': ['superadmin', 'admin'],
  'forms.manage': ['superadmin', 'admin', 'operations'],
  'bookings.accounts': ['superadmin', 'accounts'],
  'payroll.view': ['superadmin', 'hr'],
  'payroll.manage': ['superadmin', 'hr'],
  'incentives.manage': ['superadmin', 'hr'],
  // schemes, flyers & posts: Admin and the Operation team; sales information: also Team Leaders (Super Admin / IT always)
  'schemes.manage': ['superadmin', 'admin', 'operations'],
  // the Sales Kit everyone reads is edited by the Operation team only
  'saleskit.manage': ['superadmin', 'operations'],
  // Rexy's Scheme Checker rules: Super Admin and the Operation team — not IT (see canEditSchemeRules)
  'eligibility.manage': ['superadmin', 'operations'],
  'content.manage': ['superadmin', 'admin', 'operations', 'digitalmedia'],
  // the Digital Media section (dashboard, posts, flyers) belongs to the Digital Media team only
  'media.manage': ['superadmin', 'digitalmedia'],
  'salesinfo.manage': ['superadmin', 'admin', 'operations', 'teamlead'],
}

export function rolesOf(u: User): Role[] {
  return [u.role, ...u.extraRoles.filter((r) => r !== u.role)]
}

/** Super Admin and IT Support hold every permission and can open every dashboard. */
export const MASTER_ROLES: Role[] = ['superadmin', 'it']
export const isMaster = (u: User) => rolesOf(u).some((r) => MASTER_ROLES.includes(r))

/**
 * Who edits the Scheme Checker rules: Super Admin, and the Operation team while they hold eligibility.manage. IT
 * Support holds every permission but is left out on purpose (the database applies the same rule).
 */
export const canEditSchemeRules = (db: DB, u: User) => {
  const roles = rolesOf(u)
  return roles.includes('superadmin') || (roles.includes('operations') && effectivePerms(db, u).has('eligibility.manage'))
}

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
  // their own files only (visibleBookings): "own CRM entries" instead of every file
  if (isStageOnlyAdmin(db, u)) { for (const p of STAGE_ONLY_ADMIN_DROPS) s.delete(p); s.add('bookings.own') }
  return s
}

/**
 * An Admin (and nothing else) given documents in Operations Dashboard → Team: they work on — and see — only the files
 * and Admin stages assigned to them. The database applies the same rule (app.stage_only_admin()).
 */
export const isStageOnlyAdmin = (db: DB, u: User) => {
  const roles = rolesOf(u)
  return roles.length === 1 && roles[0] === 'admin' && !!db.settings.workflow?.adminStageAccess?.[u.id]
}
/** What such an Admin doesn't get from the Admin role: every file, workflow / form / follow-up settings and reports. */
export const STAGE_ONLY_ADMIN_DROPS: Perm[] = ['bookings.all', 'workflow.manage', 'forms.manage', 'followup.manage', 'reports.view', 'reports.export', 'documents.forms', 'media.manage']

export function canOpenDashboard(u: User, slug: Role) {
  return rolesOf(u).includes(slug) || isMaster(u)
}
