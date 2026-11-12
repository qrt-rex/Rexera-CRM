import type { Booking, DB, Role, User } from './types'
import { mutate } from './store'
import { nowIso, uid } from './format'
import { isMaster, rolesOf } from './rbac'
import { isFileAdmin } from './fileAdmins'
import { ActionError } from './actions'

/**
 * Old CRM data, role by role: who sees which old client file and lead on their dashboard, what has no owner, and the
 * fixes. IT Support → Old CRM sync → Role-wise distribution.
 *  - Sales: a file shows on the sales person's dashboard by its owner (createdBy).
 *  - Operations: a file with Operations (or on hold there) shows by its Operations person (opsMemberId).
 *  - Admin: by its Admin members. Team Leader / Accounts / Legal: by status (their queues).
 *  - Leads: by the assignee.
 * Automatic fixes use what the old CRM recorded (closing person's email, submitter, name, assigned-to); anything
 * still open is listed for IT to give to someone in one go. Changes are kept by later copies (the new CRM's work wins).
 */
const OPS_STATUSES = ['IN_OPERATIONS', 'ON_HOLD']
const isLegacy = (b: { id: string }) => b.id.startsWith('lg-')

export interface Fix { kind: 'owner' | 'ops'; bookingId: string; userId: string; why: string }
export interface Mismatch { user: User; role: Role; files: string[] }
export interface PersonRow { user: User; roles: Role[]; owned: number; ops: number; admin: number; leads: number }
export interface Distribution {
  files: number; leads: number
  owner: { ok: number; missing: string[]; inactive: string[] }
  ops: { inOps: number; ok: number; missing: string[]; inactive: string[] }
  admin: number
  queues: { label: string; role: Role; count: number }[]
  leadsAssigned: number; leadsOpen: number; leadsInactive: number
  fixes: Fix[]
  /** old assignee who is here but lacks the role (e.g. set up as Admin only) */
  opsMismatch: Mismatch[]
  noPassword: User[]
  people: PersonRow[]
}

/** The report (pure — reads the data, changes nothing). */
export function distribution(d: DB): Distribution {
  const users = new Map(d.users.map((u) => [u.id, u]))
  const active = (id?: string) => !!id && !!users.get(id)?.active
  const byLegacy = new Map(d.users.filter((u) => u.legacyId != null).map((u) => [String(u.legacyId), u]))
  const byEmail = new Map(d.users.map((u) => [u.email.trim().toLowerCase(), u]))
  const byName = new Map<string, User | null>()
  for (const u of d.users.filter((x) => x.active)) { const k = u.name.trim().toLowerCase(); byName.set(k, byName.has(k) ? null : u) }
  const files = d.bookings.filter(isLegacy)
  const leads = d.leads.filter(isLegacy)

  const fixes: Fix[] = []
  const owner = { ok: 0, missing: [] as string[], inactive: [] as string[] }
  const ops = { inOps: 0, ok: 0, missing: [] as string[], inactive: [] as string[] }
  const mismatch = new Map<string, Mismatch>()
  let admin = 0
  for (const b of files) {
    const crm = b.legacy?.crm ?? {}
    // Sales owner
    if (active(b.createdBy)) owner.ok++
    else {
      const cand = [byEmail.get((crm.lead_closed_by_email ?? '').trim().toLowerCase()), byLegacy.get(String(crm.submitted_by ?? '').trim()),
        byName.get((crm.lead_closed_by ?? b.ownerName ?? '').trim().toLowerCase()) ?? undefined].find((u) => u?.active && u.id !== b.createdBy)
      if (cand) fixes.push({ kind: 'owner', bookingId: b.id, userId: cand.id, why: 'the sales person recorded in the old CRM' })
      else (b.createdBy && users.has(b.createdBy) ? owner.inactive : owner.missing).push(b.id)
    }
    // Operations person
    if (OPS_STATUSES.includes(b.status)) {
      ops.inOps++
      if (active(b.opsMemberId)) ops.ok++
      else {
        const was = byLegacy.get(String(crm.assigned_to ?? '').trim())
        if (was?.active && rolesOf(was).includes('operations')) fixes.push({ kind: 'ops', bookingId: b.id, userId: was.id, why: 'assigned to them in the old CRM' })
        else if (was?.active) {
          const m = mismatch.get(was.id) ?? { user: was, role: 'operations' as Role, files: [] }
          m.files.push(b.id); mismatch.set(was.id, m)
        } else (b.opsMemberId ? ops.inactive : ops.missing).push(b.id)
      }
    }
    if ((b.adminIds?.length ?? 0) > 0 || b.adminId) admin++
  }
  const count = (s: string[]) => files.filter((b) => s.includes(b.status)).length
  const queues: Distribution['queues'] = [
    { label: 'Waiting for Team Leader approval', role: 'teamlead', count: count(['PENDING_TL']) },
    { label: 'Waiting for Accounts', role: 'accounts', count: count(['PENDING_ACCOUNTS', 'ACCOUNTS_HOLD']) },
    { label: 'Waiting for Legal', role: 'legal', count: count(['PENDING_LEGAL', 'CHANGES_REQUIRED']) },
    { label: 'With Operations / on hold', role: 'operations', count: ops.inOps },
    { label: 'Completed', role: 'superadmin', count: count(['COMPLETED']) },
    { label: 'Rejected', role: 'superadmin', count: count(['REJECTED']) },
  ]
  // who sees what: every active person with old files or leads
  const rows = new Map<string, PersonRow>()
  const row = (id: string) => { const u = users.get(id); if (!u?.active) return null; let r = rows.get(id); if (!r) rows.set(id, r = { user: u, roles: rolesOf(u), owned: 0, ops: 0, admin: 0, leads: 0 }); return r }
  for (const b of files) {
    const o = row(b.createdBy); if (o) o.owned++
    if (b.opsMemberId) { const x = row(b.opsMemberId); if (x) x.ops++ }
    for (const id of new Set([b.adminId, ...(b.adminIds ?? [])].filter(Boolean) as string[])) { const x = row(id); if (x && isFileAdmin(b, id)) x.admin++ }
  }
  for (const l of leads) if (l.assignedTo) { const x = row(l.assignedTo); if (x) x.leads++ }
  // old users who can't sign in yet: their dashboards stay empty until IT gives them a password
  const involved = new Set([...rows.keys()])
  return {
    files: files.length, leads: leads.length, owner, ops, admin, queues,
    leadsAssigned: leads.filter((l) => active(l.assignedTo)).length, leadsOpen: leads.filter((l) => !l.assignedTo).length,
    leadsInactive: leads.filter((l) => l.assignedTo && !active(l.assignedTo)).length,
    fixes, opsMismatch: [...mismatch.values()].sort((a, b) => b.files.length - a.files.length),
    noPassword: d.users.filter((u) => u.active && u.needsPasswordReset && involved.has(u.id)),
    people: [...rows.values()].sort((a, b) => (b.owned + b.ops + b.admin + b.leads) - (a.owned + a.ops + a.admin + a.leads)),
  }
}

const needIt = (me: User) => { if (!isMaster(me)) throw new ActionError('Only IT Support or Super Admin can distribute the old CRM data.') }
const log = (d: DB, by: string, detail: string) => d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action: 'LEGACY_DISTRIBUTE', detail })

/** Applies the automatic fixes (from the report) — owners and Operations persons the old CRM recorded. */
export function applyFixes(me: User, fixes: Fix[]) {
  needIt(me)
  return mutate((d) => {
    const users = new Map(d.users.map((u) => [u.id, u]))
    let owners = 0, opsN = 0
    for (const f of fixes) {
      const b = d.bookings.find((x) => x.id === f.bookingId)
      const u = users.get(f.userId)
      if (!b || !u?.active) continue
      if (f.kind === 'owner') { b.createdBy = u.id; b.ownerName = undefined; owners++ }
      else if (OPS_STATUSES.includes(b.status) && rolesOf(u).includes('operations')) { b.opsMemberId = u.id; opsN++ }
      b.updatedAt = nowIso()
    }
    log(d, me.id, `Old CRM data distributed automatically: ${owners} file(s) to their sales person, ${opsN} file(s) to their Operations person (as recorded in the old CRM)`)
    return { owners, ops: opsN }
  })
}

/** Gives files to one person: as sales owner, or as Operations person (files with Operations only). */
export function assignFiles(me: User, ids: string[], kind: 'owner' | 'ops', userId: string) {
  needIt(me)
  return mutate((d) => {
    const u = d.users.find((x) => x.id === userId && x.active)
    if (!u) throw new ActionError('Pick an active person.')
    if (kind === 'ops' && !rolesOf(u).includes('operations')) throw new ActionError(`${u.name} doesn't have the Operations role — give it in Access Control first, or pick an Operations member.`)
    let n = 0
    for (const b of d.bookings) {
      if (!ids.includes(b.id)) continue
      if (kind === 'owner') { b.createdBy = u.id; b.ownerName = undefined }
      else if (OPS_STATUSES.includes(b.status)) b.opsMemberId = u.id
      else continue
      b.updatedAt = nowIso(); n++
    }
    log(d, me.id, `Old CRM data: ${n} file(s) given to ${u.name} as ${kind === 'owner' ? 'sales owner' : 'Operations person'}`)
    return n
  })
}

/** The old assignee is here without the Operations role: give it as an extra role, then hand over their old files. */
export function grantOpsAndAssign(me: User, m: Mismatch) {
  needIt(me)
  return mutate((d) => {
    const u = d.users.find((x) => x.id === m.user.id)
    if (!u) throw new ActionError('Person not found.')
    if (!rolesOf(u).includes('operations')) u.extraRoles = [...u.extraRoles, 'operations']
    let n = 0
    for (const b of d.bookings) if (m.files.includes(b.id) && OPS_STATUSES.includes(b.status)) { b.opsMemberId = u.id; b.updatedAt = nowIso(); n++ }
    log(d, me.id, `Old CRM data: ${u.name} given Operations as an extra role and their ${n} old file(s) (assigned to them in the old CRM)`)
    return n
  })
}

export const legacyBookings = (d: DB): Booking[] => d.bookings.filter(isLegacy)
