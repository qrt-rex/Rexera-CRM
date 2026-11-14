import type { AccessControl, AccessKey, CustomRole, DB, FnAction, FnKey, Perm, Role, User } from './types'
import { mayManagePortalLogins } from '../../supabase/portal-rules.mjs'
import { canEditSchemes } from '../../supabase/scheme-kit-rules.mjs'

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
      { id: 'schemes.manage', label: 'Add / edit schemes (Operation Team, IT Support, Super Admin only)' },
      { id: 'saleskit.manage', label: 'Edit the Sales Kit and shared Scheme Kits (Operation Team, IT Support, Super Admin only)' },
      { id: 'eligibility.manage', label: 'Edit the Scheme Checker rules — schemes, conditions, documents (Operation Team, IT Support, Super Admin only)' },
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
      { id: 'refunds.manage', label: 'Refunds: approve, reject and complete (Accounts only)' },
      { id: 'refunds.request', label: 'Refunds: ask for a refund on a client and follow it (Sales, Team Leaders, Operations, Legal, Admin)' },
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
      { id: 'hrforms.manage', label: 'HR Form Builder: create, publish and assign employee forms; review every response' },
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
      { id: 'access.manage', label: 'User accounts: create, activate / deactivate, set passwords' },
      { id: 'roles.manage', label: 'Roles & permissions: create roles, give or take away permissions and functions (IT Support; anyone else only when IT allows it)' },
      { id: 'quiz.manage', label: 'Sales Quiz: create, edit, publish quizzes and see every result (IT Support; anyone else only when IT allows it)' },
      { id: 'website.manage', label: 'Website content, publishing & website leads (Super Admin)' },
      { id: 'portal.manage', label: 'Client portal logins: create ID and password, link, deactivate (IT Support only)' },
      { id: 'portal.view', label: 'Client portal: see every client’s logins, activity and progress (Legal, Operation team, Admin)' },
      { id: 'audit.view', label: 'Activity log' },
    ],
  },
]

export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.id))

const common: Perm[] = ['broadcasts.view', 'messages.use', 'schemes.view', 'content.view', 'media.view']

export const DEFAULT_ROLE_PERMS: Record<Role, Perm[]> = {
  // roles & permissions are IT Support's alone — not even the Super Admin's (unless IT allows it for that person)
  superadmin: ALL_PERMS.filter((p) => p !== 'roles.manage' && p !== 'quiz.manage'),
  admin: [...common, 'bookings.all', 'bookings.admin', 'content.manage', 'salesinfo.manage', 'employees.view', 'documents.forms', 'reports.view', 'followup.manage', 'forms.manage', 'workflow.manage', 'portal.view', 'refunds.request'],
  accounts: [...common, 'bookings.all', 'bookings.accounts', 'billing.create', 'billing.manage', 'refunds.manage', 'reports.view', 'reports.export'],
  legal: [...common, 'bookings.all', 'bookings.legal', 'documents.forms', 'leave.approve', 'reports.view', 'portal.view', 'refunds.request'],
  operations: [...common, 'bookings.all', 'bookings.process', 'content.manage', 'salesinfo.manage', 'schemes.manage', 'employees.view', 'documents.forms', 'reports.view', 'events.manage', 'forms.manage', 'saleskit.manage', 'eligibility.manage', 'portal.view', 'refunds.request'],
  teamlead: [
    ...common, 'salesinfo.manage', 'leads.own', 'leads.assign', 'dialer.use', 'bookings.create', 'bookings.own', 'bookings.team', 'bookings.approve_tl',
    'billing.own', 'billing.create', 'team.progress', 'team.assign', 'documents.forms', 'leave.approve', 'reports.view', 'refunds.request',
  ],
  sales: [...common, 'leads.own', 'dialer.use', 'bookings.create', 'bookings.own', 'billing.own', 'billing.create', 'documents.forms', 'refunds.request'],
  hr: [
    ...common, 'attendance.all', 'leave.approve', 'employees.view', 'employees.manage', 'events.manage', 'broadcasts.manage',
    'templates.manage', 'reports.view', 'reports.export', 'audit.view',
    'payroll.view', 'payroll.manage', 'incentives.manage', 'recruitment.manage', 'performance.view', 'email.send', 'assets.manage', 'hrforms.manage',
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
  // the live website: Super Admin only
  'website.manage': ['superadmin'],
  // client portal logins: IT Support only (see canManagePortalLogins — the Super Admin holds the permission but not this)
  'portal.manage': ['it'],
  // every client's portal logins and progress: Legal, the Operation team and Admin (IT and Super Admin always)
  'portal.view': ['superadmin', 'legal', 'operations', 'admin'],
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
  // schemes wherever they are (Schemes, Sales Kit + shared Scheme Kits, Scheme Checker): the Operation Team, IT Support
  // and Super Admin only — nobody else, even if given the permission by name (the database checks app.can_edit_schemes())
  'schemes.manage': ['superadmin', 'it', 'operations'],
  'saleskit.manage': ['superadmin', 'it', 'operations'],
  'eligibility.manage': ['superadmin', 'it', 'operations'],
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
/** Sales people and team leaders see clients' numbers masked (+91 XXXXXXXX78); they call through the dialer. */
export const seesMaskedPhones = (u: User) => rolesOf(u).every((r) => r === 'sales' || r === 'teamlead')

/** Who edits the Scheme Checker rules: like every scheme — the Operation Team, IT Support and Super Admin. */
export const canEditSchemeRules = (_db: DB, u: User) => canEditSchemes(rolesOf(u))
/** Schemes wherever they are: the Operation Team, IT Support and Super Admin only (by role, not by permission). */
export const canEditSchemesUser = (u: User | null | undefined) => !!u && u.active !== false && canEditSchemes(rolesOf(u))

/** Who creates client portal logins (ID + password), sets passwords, links entries, deactivates: IT Support only (the server applies the same). */
export const canManagePortalLogins = (u: User | null | undefined) => !!u && mayManagePortalLogins(rolesOf(u))

// ------------------------------------------------------------------ IT Support's access control
/** The actions a person can be given (or not) in every module. */
export const FN_ACTIONS: { id: FnAction; label: string }[] = [
  { id: 'view', label: 'View' }, { id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' },
  { id: 'download', label: 'Download' }, { id: 'export', label: 'Export' }, { id: 'approve', label: 'Approve' }, { id: 'send', label: 'Send' },
]
export const fnKey = (module: string, action: FnAction): FnKey => `fn:${module}:${action}`
const isFn = (k: AccessKey): k is FnKey => k.startsWith('fn:')
const isPerm = (k: AccessKey): k is Perm => !isFn(k)

export const accessControlOf = (db: DB): AccessControl => ({ customRoles: [], userRole: {}, roleDeny: {}, ...(db.settings.accessControl ?? {}) })
/** The custom role IT gave this person (it replaces their main role's permissions), if any. */
export const customRoleOf = (db: DB, u: User): CustomRole | undefined => {
  const ac = accessControlOf(db), id = ac.userRole[u.id]
  return id ? ac.customRoles.find((r) => r.id === id) : undefined
}
/**
 * Roles & permissions are managed by IT Support only — anyone else (Super Admin included) only when IT gives them
 * "roles.manage" by name. The database applies the same rule (app.can_manage_roles()).
 */
export const canManageRoles = (u: User | null | undefined) =>
  !!u && (rolesOf(u).includes('it') || (u.grants.includes('roles.manage') && !u.denies.includes('roles.manage')))
/** Sales Quiz: IT Support makes the quizzes and sees every result (anyone else only when IT allows it by name). */
export const canManageQuiz = (u: User | null | undefined) =>
  !!u && (rolesOf(u).includes('it') || (u.grants.includes('quiz.manage') && !u.denies.includes('quiz.manage')))
/** Only Sales users take the quiz (the database checks the same). */
export const canTakeQuiz = (u: User | null | undefined) => !!u && rolesOf(u).includes('sales')

/**
 * The functions this person may NOT use ('leads:export'): those every one of their roles is denied (a custom role
 * stands in for the main role), then the person's own allow / deny from IT. IT Support never loses Access Control.
 */
export function deniedFns(db: DB, u: User | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!u) return out
  const ac = accessControlOf(db)
  const custom = customRoleOf(db, u)
  const roleIds = [custom ? custom.id : u.role, ...u.extraRoles.filter((r) => r !== u.role)]
  const lists = roleIds.map((r) => new Set(ac.roleDeny[r] ?? []))
  if (lists.length) for (const f of lists[0]!) if (lists.every((l) => l.has(f))) out.add(f)
  for (const k of u.denies) if (isFn(k)) out.add(k.slice(3))
  for (const k of u.grants) if (isFn(k)) out.delete(k.slice(3))
  if (rolesOf(u).includes('it')) for (const f of [...out]) if (f.startsWith('access:')) out.delete(f)
  return out
}

export function effectivePerms(db: DB, u: User | null | undefined): Set<Perm> {
  if (!u) return new Set()
  const roles = rolesOf(u)
  const denies = u.denies.filter(isPerm), grants = u.grants.filter(isPerm)
  if (roles.some((r) => MASTER_ROLES.includes(r))) {
    // masters hold everything — except what IT took away from them by name, and roles & permissions (IT's)
    const s = new Set(ALL_PERMS)
    for (const p of denies) s.delete(p)
    if (!canManageRoles(u)) s.delete('roles.manage')
    if (!canManageQuiz(u)) s.delete('quiz.manage')
    return s
  }
  const s = new Set<Perm>()
  const custom = customRoleOf(db, u)
  for (const r of roles) for (const p of (custom && r === u.role ? custom.perms : db.rolePerms[r] ?? DEFAULT_ROLE_PERMS[r])) s.add(p)
  for (const p of grants) s.add(p)
  for (const p of denies) s.delete(p)
  if (!canManageRoles(u)) s.delete('roles.manage')
  if (!canManageQuiz(u)) s.delete('quiz.manage')
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
export const STAGE_ONLY_ADMIN_DROPS: Perm[] = ['bookings.all', 'workflow.manage', 'forms.manage', 'followup.manage', 'reports.view', 'reports.export', 'documents.forms', 'media.manage', 'portal.view']

export function canOpenDashboard(u: User, slug: Role) {
  // the IT Support dashboard (user activity, system tools) is the IT team's alone — not even Super Admin's
  if (slug === 'it') return rolesOf(u).includes('it')
  return rolesOf(u).includes(slug) || isMaster(u)
}
/**
 * The dashboards a person can switch between: one per role they hold (main role first) — Admin + Legal + HR gives
 * three. Super Admin / IT Support: every dashboard they may open.
 */
export function dashboardsOf(u: User): Role[] {
  const own = rolesOf(u).filter((r) => canOpenDashboard(u, r))
  return isMaster(u) ? [...own, ...ROLES.map((r) => r.id).filter((r) => !own.includes(r) && canOpenDashboard(u, r))] : own
}

/** The dashboard last opened on this computer (per person) — where Dashboard, the logo and sign-in take them back. */
const LAST_DASH = (id: string) => `rexera-last-dashboard:${id}`
export function homeDashboard(u: User): Role {
  let last: string | null = null
  try { last = localStorage.getItem(LAST_DASH(u.id)) } catch { /* storage blocked */ }
  return last && dashboardsOf(u).includes(last as Role) ? (last as Role) : u.role
}
export function rememberDashboard(u: User, role: Role) {
  try { if (dashboardsOf(u).includes(role)) localStorage.setItem(LAST_DASH(u.id), role) } catch { /* storage blocked */ }
}
