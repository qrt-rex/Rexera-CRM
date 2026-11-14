import type { Booking, DB, Role, User } from './types'
import { mutate } from './store'
import { nowIso, uid } from './format'
import { isMaster, rolesOf } from './rbac'
import { isFileAdmin } from './fileAdmins'
import { ActionError } from './actions'
import { live, makePeople, mapProblem, oldKey, peopleRows, realign, type Change, type PersonRow } from '../../supabase/legacy-people-rules.mjs'

export type { PersonRow } from '../../supabase/legacy-people-rules.mjs'

/**
 * Old CRM data, person by person and role by role (IT Support → Old CRM sync → Role-wise distribution).
 * The rules are shared with the old-CRM import / live sync (supabase/legacy-people-rules.mjs), so a later copy gives
 * every record to the same person:
 *  - People: each old CRM user → their account here; IT's person map for people who now work under another account,
 *    and for old ids whose account was deleted in the old CRM.
 *  - Sales: a file is on its closer's dashboard (createdBy). Team leaders see their team's files (the owner's team leader).
 *  - Operations: the old assignee's files — on their Operations dashboard, or (an Admin here) their Admin dashboard.
 *  - Leads: the assignee. History (comments, approvals, stages, payments, documents) follows the person.
 * Anything still without a person is listed, to give to someone in one go. Work reassigned in the new CRM stays.
 */
const OPS = ['IN_OPERATIONS', 'ON_HOLD', 'WITH_ADMIN', 'OPS_REVIEW']
const isLegacy = (b: { id: string }) => b.id.startsWith('lg-')

export interface Mismatch { user: User; role: Role; files: string[] }
export interface TeamGap { branchId: string; people: User[]; files: number }
export interface PersonLine { user: User; roles: Role[]; owned: number; ops: number; admin: number; leads: number }
export interface Distribution {
  files: number; leads: number
  owner: { ok: number; missing: string[]; inactive: string[] }
  ops: { inOps: number; ok: number; missing: string[] }
  admin: number
  queues: { label: string; role: Role; count: number }[]
  leadsAssigned: number; leadsOpen: number; leadsInactive: number
  /** what "Put everything right" changes, by kind */
  plan: Change[]; planCounts: Record<Change['kind'], number>
  /** old assignee who is here without Operations or Admin */
  opsMismatch: Mismatch[]
  noPassword: User[]
  people: PersonLine[]
  oldPeople: PersonRow[]
  teams: TeamGap[]; teamLeads: User[]
}

/** The report (pure — reads the data, changes nothing). */
export function distribution(d: DB): Distribution {
  const map = d.settings.legacyPeople ?? {}
  const users = new Map(d.users.map((u) => [u.id, u]))
  const files = d.bookings.filter(isLegacy)
  const leads = d.leads.filter(isLegacy)
  const plan = realign(d, map)
  const planCounts = { owner: 0, ops: 0, admin: 0, teamlead: 0, lead: 0, history: 0 } as Record<Change['kind'], number>
  const touched = new Set<string>()
  for (const c of plan) { planCounts[c.kind]++; if (c.kind === 'owner' || c.kind === 'ops' || c.kind === 'admin') touched.add(`${c.kind === 'owner' ? 'o' : 'p'}|${c.id}`) }
  // files already with their person, and what stays open after the automatic step
  const owner = { ok: 0, missing: [] as string[], inactive: [] as string[] }
  const ops = { inOps: 0, ok: 0, missing: [] as string[] }
  const P = makePeople(d.users, map)
  const mismatch = new Map<string, Mismatch>()
  let admin = 0
  for (const b of files) {
    if (live(users.get(b.createdBy))) owner.ok++
    else if (!touched.has(`o|${b.id}`)) (b.createdBy && users.has(b.createdBy) ? owner.inactive : owner.missing).push(b.id)
    const admins = [b.adminId, ...(b.adminIds ?? [])].filter(Boolean) as string[]
    if (admins.length) admin++
    if (!OPS.includes(b.status)) continue
    ops.inOps++
    const om = users.get(b.opsMemberId ?? '')
    const withPerson = admins.some((id) => live(users.get(id))) || (live(om) && rolesOf(om).includes('operations'))
    if (withPerson) { ops.ok++; continue }
    if (touched.has(`p|${b.id}`)) continue
    const was = P.byOldId(b.legacy?.crm?.assigned_to)
    if (live(was)) {
      const m = mismatch.get(was.id) ?? { user: was, role: 'operations' as Role, files: [] }
      m.files.push(b.id); mismatch.set(was.id, m)
    } else ops.missing.push(b.id)
  }
  const count = (s: string[]) => files.filter((b) => s.includes(b.status)).length
  const queues: Distribution['queues'] = [
    { label: 'Waiting for Team Leader approval', role: 'teamlead', count: count(['PENDING_TL']) },
    { label: 'Waiting for Accounts', role: 'accounts', count: count(['PENDING_ACCOUNTS', 'ACCOUNTS_HOLD']) },
    { label: 'Waiting for Legal', role: 'legal', count: count(['PENDING_LEGAL', 'CHANGES_REQUIRED']) },
    { label: 'With Operations / on hold', role: 'operations', count: count(['IN_OPERATIONS', 'ON_HOLD', 'OPS_REVIEW']) },
    { label: 'With Admin', role: 'admin', count: count(['WITH_ADMIN']) },
    { label: 'Completed', role: 'superadmin', count: count(['COMPLETED']) },
    { label: 'Rejected', role: 'superadmin', count: count(['REJECTED']) },
  ]
  // who sees what: every active person with old files or leads
  const rows = new Map<string, PersonLine>()
  const row = (id?: string) => { const u = id ? users.get(id) : undefined; if (!live(u)) return null; let r = rows.get(u.id); if (!r) rows.set(u.id, r = { user: u, roles: rolesOf(u), owned: 0, ops: 0, admin: 0, leads: 0 }); return r }
  for (const b of files) {
    const o = row(b.createdBy); if (o) o.owned++
    if (b.opsMemberId) { const x = row(b.opsMemberId); if (x) x.ops++ }
    for (const id of new Set([b.adminId, ...(b.adminIds ?? [])].filter(Boolean) as string[])) { const x = row(id); if (x && isFileAdmin(b, id)) x.admin++ }
  }
  for (const l of leads) { const x = row(l.assignedTo); if (x) x.leads++ }
  // team leaders: sales people with old files and no active team leader (their leader sees nothing of their work)
  const owners = new Map<string, number>()
  for (const b of files) owners.set(b.createdBy, (owners.get(b.createdBy) ?? 0) + 1)
  const gaps = new Map<string, TeamGap>()
  for (const u of d.users) {
    if (!live(u) || u.role !== 'sales' || live(users.get(u.teamLeadId ?? ''))) continue
    const k = u.branchId ?? ''
    const g = gaps.get(k) ?? { branchId: k, people: [], files: 0 }
    g.people.push(u); g.files += owners.get(u.id) ?? 0; gaps.set(k, g)
  }
  return {
    files: files.length, leads: leads.length, owner, ops, admin, queues,
    leadsAssigned: leads.filter((l) => live(users.get(l.assignedTo ?? ''))).length, leadsOpen: leads.filter((l) => !l.assignedTo).length,
    leadsInactive: leads.filter((l) => l.assignedTo && !live(users.get(l.assignedTo))).length,
    plan, planCounts, opsMismatch: [...mismatch.values()].sort((a, b) => b.files.length - a.files.length),
    noPassword: d.users.filter((u) => live(u) && u.needsPasswordReset && rows.has(u.id)),
    people: [...rows.values()].sort((a, b) => (b.owned + b.ops + b.admin + b.leads) - (a.owned + a.ops + a.admin + a.leads)),
    oldPeople: peopleRows(d, map),
    teams: [...gaps.values()].sort((a, b) => b.files - a.files),
    teamLeads: d.users.filter((u) => live(u) && rolesOf(u).includes('teamlead')).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

const needIt = (me: User) => { if (!isMaster(me)) throw new ActionError('Only IT Support or Super Admin can distribute the old CRM data.') }
const log = (d: DB, by: string, detail: string) => d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action: 'LEGACY_DISTRIBUTE', detail })
const summary = (changes: Change[]) => {
  const n = (k: Change['kind']) => new Set(changes.filter((c) => c.kind === k).map((c) => c.id)).size
  return `${n('owner')} file(s) to their sales person, ${n('ops')} to their Operations person, ${n('admin')} to their Admin, ${n('teamlead')} to their team leader, ${n('lead')} lead(s), ${changes.filter((c) => c.kind === 'history').length} history entr(ies) to the person's account`
}

/** Puts every old record with its person (the person map and what the old CRM recorded). */
export function applyFixes(me: User) {
  needIt(me)
  return mutate((d) => {
    const changes = realign(d, d.settings.legacyPeople ?? {}, { apply: true })
    for (const id of new Set(changes.filter((c) => c.record === 'booking').map((c) => c.id))) { const b = d.bookings.find((x) => x.id === id); if (b) b.updatedAt = nowIso() }
    log(d, me.id, `Old CRM data put with each person: ${summary(changes)}`)
    return changes.length
  })
}

/**
 * Saves the person map (old CRM user id → account; '' removes an entry) and at once moves their old files, leads and
 * history to that account. Later copies from the old CRM use the same map.
 */
export function savePeopleMap(me: User, entries: Record<string, string>) {
  needIt(me)
  return mutate((d) => {
    const map: Record<string, string> = { ...(d.settings.legacyPeople ?? {}) }
    for (const [k, id] of Object.entries(entries)) { const key = oldKey(k); if (!key) continue; if (id) map[key] = id; else delete map[key] }
    const p = mapProblem(map, d.users)
    if (p) throw new ActionError(p)
    const names = Object.entries(entries).map(([k, id]) => `#${k} → ${id ? d.users.find((u) => u.id === id)?.name ?? id : '(own account)'}`).join(', ')
    d.settings.legacyPeople = Object.keys(map).length ? map : undefined
    const changes = realign(d, map, { apply: true })
    for (const id of new Set(changes.filter((c) => c.record === 'booking').map((c) => c.id))) { const b = d.bookings.find((x) => x.id === id); if (b) b.updatedAt = nowIso() }
    log(d, me.id, `Old CRM person map: ${names}. Moved: ${summary(changes)}`)
    return changes.length
  })
}

/** Gives sales people a team leader; their old files follow (the leader sees and approves them). */
export function setTeamLead(me: User, userIds: string[], leadId: string) {
  needIt(me)
  return mutate((d) => {
    const tl = d.users.find((u) => u.id === leadId)
    if (!live(tl) || !rolesOf(tl).includes('teamlead')) throw new ActionError('Pick an active team leader.')
    let n = 0
    for (const u of d.users) if (userIds.includes(u.id) && u.id !== tl.id && live(u)) { u.teamLeadId = tl.id; n++ }
    const changes = realign(d, d.settings.legacyPeople ?? {}, { apply: true })
    log(d, me.id, `Team leader ${tl.name} for ${n} sales person(s); their old files follow (${summary(changes)})`)
    return n
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
      else if (['IN_OPERATIONS', 'ON_HOLD'].includes(b.status)) b.opsMemberId = u.id
      else continue
      b.updatedAt = nowIso(); n++
    }
    log(d, me.id, `Old CRM data: ${n} file(s) given to ${u.name} as ${kind === 'owner' ? 'sales owner' : 'Operations person'}`)
    return n
  })
}

/** The old assignee is here without Operations or Admin: give Operations as an extra role, then hand over their old files. */
export function grantOpsAndAssign(me: User, m: Mismatch) {
  needIt(me)
  return mutate((d) => {
    const u = d.users.find((x) => x.id === m.user.id)
    if (!u) throw new ActionError('Person not found.')
    if (!rolesOf(u).includes('operations')) u.extraRoles = [...u.extraRoles, 'operations']
    let n = 0
    for (const b of d.bookings) if (m.files.includes(b.id) && ['IN_OPERATIONS', 'ON_HOLD'].includes(b.status)) { b.opsMemberId = u.id; b.updatedAt = nowIso(); n++ }
    log(d, me.id, `Old CRM data: ${u.name} given Operations as an extra role and their ${n} old file(s) (assigned to them in the old CRM)`)
    return n
  })
}

export const legacyBookings = (d: DB): Booking[] => d.bookings.filter(isLegacy)
