/**
 * Old CRM people → new CRM accounts: whose dashboard each old client file, lead and history entry belongs on.
 * Shared by the old-CRM import (src/lib/legacyImport.ts — also run by the live Old CRM sync) and IT Support →
 * Old CRM sync → Role-wise distribution, so both give every record to the same person and a later copy never undoes it.
 *
 *  - A person in the old CRM is their old user id. Normally the account with that legacy id (matched by email when the
 *    old data came in). IT's person map (settings.legacyPeople: old id → new account) wins: for someone who now works
 *    under another account, and for old ids whose account was deleted in the old CRM.
 *  - Sales: an old file belongs to the person who closed it (closer's email → submitter → closer's name).
 *  - Old "Admin Member" (the person a file was assigned to): Operations here → the file's Operations person;
 *    an Admin here → the file's Admin ("With Admin"), so it is on their Admin dashboard.
 *  - Team leader of a file: the owner's team leader, else the old CRM's Manager.
 *  - Never moves a record already with an active person who has the right role (work reassigned in the new CRM stays).
 */
export const OPS_STATUSES = ['IN_OPERATIONS', 'ON_HOLD']
export const rolesOf = (u) => (u ? [u.role, ...(u.extraRoles ?? [])] : [])
export const live = (u) => !!u && u.active === true && !u.deletedAt
const low = (s) => String(s ?? '').trim().toLowerCase()
const normName = (s) => low(s).replace(/[^a-z]/g, '')
/** removed accounts keep their email with "#removed-…" after it */
const cleanEmail = (e) => low(e).replace(/#.*$/, '')
const localPart = (e) => cleanEmail(e).split('@')[0].replace(/[^a-z]/g, '')
/** an old CRM user id ("48"), or '' for empty / 0 */
export const oldKey = (v) => { const k = String(v ?? '').trim(); return /^\d+$/.test(k) && Number(k) > 0 ? String(Number(k)) : '' }
const isLegacy = (r) => typeof r?.id === 'string' && r.id.startsWith('lg-')

/** Lookups that follow IT's person map. `users`: the CRM's users; `map`: old id → new user id. */
export function makePeople(users, map = {}) {
  const byId = new Map(users.map((u) => [u.id, u]))
  const prefer = (m, k, u) => { const was = m.get(k); if (!was || (live(u) && !live(was))) m.set(k, u) }
  const byLegacy = new Map(), byEmail = new Map(), byName = new Map()
  for (const u of users) {
    if (u.legacyId != null) prefer(byLegacy, String(u.legacyId), u)
    const e = cleanEmail(u.email); if (e) prefer(byEmail, e, u)
  }
  for (const u of users.filter(live)) { const k = normName(u.name); if (k) byName.set(k, byName.has(k) ? null : u) }
  const mapped = (k) => { const t = k && map?.[k] ? byId.get(map[k]) : undefined; return live(t) ? t : undefined }
  /** a user → the account that now holds their old work (IT's map), or themselves */
  const follow = (u) => (u ? (u.legacyId != null && mapped(String(u.legacyId))) || u : undefined)
  const people = {
    byId, follow,
    /** the account an old id belongs to (before the map) */
    accountOf: (k) => byLegacy.get(oldKey(k)),
    accountByEmail: (e) => byEmail.get(cleanEmail(e)),
    byOldId: (v) => { const k = oldKey(v); return k ? mapped(k) ?? follow(byLegacy.get(k)) : undefined },
    byEmail: (e) => follow(byEmail.get(cleanEmail(e))),
    byName: (n) => { const k = normName(n); return k ? follow(byName.get(k) ?? undefined) : undefined },
    /** the sales person of an old client file row */
    ownerOf: (r) => people.byEmail(r?.lead_closed_by_email) ?? people.byOldId(r?.submitted_by) ?? people.byName(r?.lead_closed_by),
    /** the old CRM's Manager (approved every new file) */
    manager: () => follow(users.filter((u) => low(u.legacyRole) === 'manager').sort((a, b) => Number(live(b)) - Number(live(a)))[0]),
  }
  return people
}

/** Where an old file with Operations goes for its old assignee (the old "Admin Member"). */
export function placeAssignee(status, person) {
  if (!OPS_STATUSES.includes(status) || !person) return null
  const r = rolesOf(person)
  if (r.includes('operations')) return { opsMemberId: person.id }
  if (r.includes('admin')) return { adminId: person.id, ...(status === 'IN_OPERATIONS' ? { status: 'WITH_ADMIN' } : { holdFrom: 'WITH_ADMIN' }) }
  return null
}
const placeable = (u) => live(u) && (rolesOf(u).includes('operations') || rolesOf(u).includes('admin'))

/** The team leader of an old file: the owner's team leader, else the old CRM's Manager (only active people). */
export function teamLeadFor(owner, manager, byId) {
  const tl = owner?.teamLeadId ? byId.get(owner.teamLeadId) : undefined
  if (live(tl) && tl.id !== owner.id) return tl.id
  return live(manager) && manager.id !== owner?.id ? manager.id : undefined
}

/**
 * Puts every old record with its person (see the top). Read-only unless `apply`; returns the changes
 * ({ kind: owner | ops | admin | teamlead | lead | history, record, id, field, from, to }).
 */
export function realign(db, map = {}, { apply = false } = {}) {
  const P = makePeople(db.users, map)
  const { byId } = P
  const manager = P.manager()
  const changes = []
  const set = (rec, record, field, to, kind) => {
    if ((rec[field] ?? undefined) === (to ?? undefined)) return
    changes.push({ kind, record, id: rec.id, field, from: rec[field], to })
    if (apply) { if (to === undefined) delete rec[field]; else rec[field] = to }
  }
  /** history entries made by someone who now works under another account → that account */
  const moved = (id) => { if (!id) return undefined; const u = byId.get(id), f = P.follow(u); return f && f !== u && live(f) ? f.id : undefined }
  const relink = (list, field, rec, record) => {
    for (const x of list ?? []) { const to = moved(x[field]); if (to) { changes.push({ kind: 'history', record, id: rec.id, field, from: x[field], to }); if (apply) x[field] = to } }
  }

  for (const b of db.bookings) {
    if (!isLegacy(b)) continue
    const r = b.legacy?.crm ?? {}
    // sales owner
    const cur = byId.get(b.createdBy), f = P.follow(cur)
    if (f && f !== cur && live(f)) set(b, 'booking', 'createdBy', f.id, 'owner')
    else if (!live(cur)) { const want = P.ownerOf(r); if (live(want) && want.id !== b.createdBy) set(b, 'booking', 'createdBy', want.id, 'owner') }
    if (b.ownerName && live(byId.get(b.createdBy))) set(b, 'booking', 'ownerName', undefined, 'owner')
    // Operations person / Admin (files no one has given to an Admin in the new CRM yet)
    if (OPS_STATUSES.includes(b.status) && !b.adminId && !b.adminIds?.length) {
      const o = byId.get(b.opsMemberId), fo = P.follow(o)
      const settled = live(o) && fo === o && rolesOf(o).includes('operations')
      if (!settled) {
        const who = [fo, P.byOldId(r.assigned_to)].find(placeable)
        const place = who && placeAssignee(b.status, who)
        if (place?.opsMemberId) set(b, 'booking', 'opsMemberId', place.opsMemberId, 'ops')
        else if (place?.adminId) {
          set(b, 'booking', 'adminId', place.adminId, 'admin')
          set(b, 'booking', 'opsMemberId', undefined, 'admin')
          if (place.status) set(b, 'booking', 'status', place.status, 'admin')
          if (place.holdFrom) set(b, 'booking', 'holdFrom', place.holdFrom, 'admin')
        }
      }
    }
    // team leader (a removed one is replaced)
    // (the old Manager as a stand-in gives way once the owner has their own team leader)
    const tl = byId.get(b.teamLeadId), ftl = P.follow(tl), want = teamLeadFor(byId.get(b.createdBy), manager, byId)
    if (ftl && ftl !== tl && live(ftl)) set(b, 'booking', 'teamLeadId', ftl.id, 'teamlead')
    else if (!live(tl) || (tl.id === manager?.id && want !== tl.id)) set(b, 'booking', 'teamLeadId', want, 'teamlead')
    relink(b.comments, 'by', b, 'booking'); relink(b.approvals, 'by', b, 'booking'); relink(b.stageHistory, 'by', b, 'booking')
    relink(b.payments, 'recordedBy', b, 'booking'); relink(b.documents, 'by', b, 'booking')
  }
  for (const l of db.leads) {
    if (!isLegacy(l)) continue
    const to = moved(l.assignedTo); if (to) set(l, 'lead', 'assignedTo', to, 'lead')
    const by = moved(l.createdBy); if (by) set(l, 'lead', 'createdBy', by, 'history')
    relink(l.chain, 'to', l, 'lead'); relink(l.chain, 'by', l, 'lead'); relink(l.history, 'by', l, 'lead')
  }
  for (const n of db.notices ?? []) { if (!isLegacy(n)) continue; const to = moved(n.userId); if (to) set(n, 'notice', 'userId', to, 'history') }
  for (const i of db.invoices ?? []) {
    if (!isLegacy(i)) continue
    const s = moved(i.salesPerson); if (s) set(i, 'invoice', 'salesPerson', s, 'history')
    const c = moved(i.createdBy); if (c) set(i, 'invoice', 'createdBy', c, 'history')
  }
  return changes
}

/**
 * Every old CRM person, for the person map: their account here, how much old work points at them, whether it reaches
 * an active person, and a suggestion when it doesn't (same email, the same email name on another company domain,
 * or the same full name). Old ids the old files point at that have no account (deleted in the old CRM) are listed too.
 */
export function peopleRows(db, map = {}) {
  const P = makePeople(db.users, map)
  const rows = new Map()
  const row = (k) => { let x = rows.get(k); if (!x) rows.set(k, x = { oldId: k, account: P.accountOf(k), owned: 0, ops: 0, leads: 0 }); return x }
  for (const u of db.users) if (u.legacyId != null && oldKey(u.legacyId)) row(oldKey(u.legacyId))
  for (const b of db.bookings) {
    if (!isLegacy(b)) continue
    const r = b.legacy?.crm ?? {}
    // closed: under the owner's account; a file without an active owner under the old id the old CRM names
    const own = P.byId.get(b.createdBy)
    const acc = live(own) ? oldKey(own.legacyId) : oldKey(P.accountByEmail(r.lead_closed_by_email)?.legacyId) || oldKey(r.submitted_by)
    if (acc) row(acc).owned++
    const k = oldKey(r.assigned_to); if (k && OPS_STATUSES.concat(['WITH_ADMIN', 'OPS_REVIEW']).includes(b.status)) row(k).ops++
  }
  for (const l of db.leads) { if (!isLegacy(l)) continue; const u = P.byId.get(l.assignedTo); const k = oldKey(u?.legacyId); if (k) row(k).leads++ }
  const actives = db.users.filter(live)
  const one = (list) => (list.length === 1 ? list[0] : undefined)
  return [...rows.values()].map((x) => {
    const a = x.account
    const now = map[x.oldId] ? P.byId.get(map[x.oldId]) : P.follow(a)
    const needsRole = x.ops > 0 && live(now) && !placeable(now)
    let suggestion
    if (!live(now) && a) {
      const others = actives.filter((u) => u.id !== a.id)
      const tests = [
        ['same email', (u) => !!cleanEmail(a.email) && cleanEmail(u.email) === cleanEmail(a.email)],
        ['same email name, other company domain', (u) => localPart(a.email).length > 3 && localPart(u.email) === localPart(a.email)],
        ['same name', (u) => normName(a.name).length > 3 && normName(u.name) === normName(a.name)],
      ]
      for (const [why, test] of tests) { const u = one(others.filter(test)); if (u) { suggestion = { userId: u.id, why }; break } }
    }
    const state = !a && !map[x.oldId] ? 'unknown' : !live(now) ? 'inactive' : needsRole ? 'role' : now.needsPasswordReset ? 'no-password' : 'ok'
    return { ...x, name: a?.name ?? `Old CRM user #${x.oldId}`, email: a ? cleanEmail(a.email) : '', oldRole: a?.legacyRole ?? '', mappedTo: map[x.oldId], nowId: now?.id, state, suggestion }
  }).sort((p, q) => (q.owned + q.ops + q.leads) - (p.owned + p.ops + p.leads))
}
/** Checks a person map before it is saved: every target must be an active account. */
export function mapProblem(map, users) {
  const byId = new Map(users.map((u) => [u.id, u]))
  for (const [k, id] of Object.entries(map ?? {})) {
    if (!oldKey(k)) return `“${k}” is not an old CRM user id.`
    if (id && !live(byId.get(id))) return `Old CRM user #${k} is mapped to someone who is not active.`
  }
  return null
}
