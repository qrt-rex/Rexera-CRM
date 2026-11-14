import assert from 'node:assert/strict'
import { makePeople, mapProblem, oldKey, peopleRows, placeAssignee, realign, teamLeadFor } from './legacy-people-rules.mjs'

// made-up people in the shapes found in the CRM: old accounts (lg-u-…), an old account now replaced, a deleted old id
const U = (id, name, email, role, extra = {}) => ({ id, name, email, role, extraRoles: [], active: true, ...extra })
const users = [
  U('lg-u-7', 'Sales One', 'one@example.test', 'sales', { legacyId: 7, legacyRole: 'Employee', teamLeadId: 'u-tl' }),
  U('lg-u-8', 'Sales Two', 'two@old.example.test', 'sales', { legacyId: 8, legacyRole: 'Employee', active: false }),
  U('u-two', 'Sales Two', 'two@example.test', 'sales'),                               // the same person's new account
  U('lg-u-63', 'Admin Member', 'am@example.test', 'admin', { legacyId: 63, legacyRole: 'Admin Member' }),
  U('lg-u-46', 'Ops Member', 'ops@example.test', 'operations', { legacyId: 46, legacyRole: 'Admin Member' }),
  U('lg-u-31', 'Old Manager', 'mgr@example.test', 'teamlead', { legacyId: 31, legacyRole: 'Manager' }),
  U('u-tl', 'Team Lead', 'tl@example.test', 'teamlead'),
  U('u-ops2', 'Ops Two', 'ops2@example.test', 'operations'),
  U('u-admin', 'Removed Admin', 'admin@example.test#removed-u-admin', 'admin', { active: false }),
]
const B = (n, crm, extra = {}) => ({ id: `lg-b-${n}`, status: 'IN_OPERATIONS', createdBy: '', teamLeadId: 'u-admin', comments: [], approvals: [], stageHistory: [], payments: [], documents: [], legacy: { crm }, ...extra })
const db = () => ({
  users: structuredClone(users), notices: [{ id: 'lg-n-1', userId: 'lg-u-8' }], invoices: [],
  bookings: [
    B(1, { lead_closed_by_email: 'one@example.test', assigned_to: '46' }, { createdBy: 'lg-u-7' }),
    B(2, { lead_closed_by_email: 'two@old.example.test', assigned_to: '63' }, { createdBy: 'lg-u-8', opsMemberId: 'lg-u-63', comments: [{ id: 'c', by: 'lg-u-8' }] }),
    B(3, { lead_closed_by_email: 'one@example.test', assigned_to: '48' }, { createdBy: 'lg-u-7', status: 'ON_HOLD' }),
    B(4, { lead_closed_by_email: 'one@example.test', assigned_to: '46' }, { createdBy: 'lg-u-7', opsMemberId: 'u-ops2' }),   // reassigned here: stays
    B(5, { lead_closed_by: 'Old Manager' }, { createdBy: '', status: 'PENDING_TL' }),
    { id: 'b-new', status: 'IN_OPERATIONS', createdBy: 'lg-u-8', teamLeadId: 'u-admin', legacy: undefined },                 // not an old file: untouched
  ],
  leads: [{ id: 'lg-l-1', assignedTo: 'lg-u-8', createdBy: 'lg-u-8', chain: [{ to: 'lg-u-8', by: 'lg-u-31' }] }],
})

assert.equal(oldKey(' 48 '), '48'); assert.equal(oldKey('0'), ''); assert.equal(oldKey(''), ''); assert.equal(oldKey('abc'), '')
assert.deepEqual(placeAssignee('IN_OPERATIONS', users[4]), { opsMemberId: 'lg-u-46' })
assert.deepEqual(placeAssignee('IN_OPERATIONS', users[3]), { adminId: 'lg-u-63', status: 'WITH_ADMIN' }, 'an old Admin Member who is an Admin here: the file is With Admin')
assert.deepEqual(placeAssignee('ON_HOLD', users[3]), { adminId: 'lg-u-63', holdFrom: 'WITH_ADMIN' })
assert.equal(placeAssignee('COMPLETED', users[4]), null)

// without a map: Operations person found, Admin Member's files to their Admin dashboard, removed team leader replaced
let d = db()
realign(d, {}, { apply: true })
const [b1, b2, b3, b4, b5] = d.bookings
assert.equal(b1.opsMemberId, 'lg-u-46'); assert.equal(b1.teamLeadId, 'u-tl', "owner's team leader")
assert.equal(b2.adminId, 'lg-u-63'); assert.equal(b2.status, 'WITH_ADMIN'); assert.equal(b2.opsMemberId, undefined)
assert.equal(b2.createdBy, 'lg-u-8', 'no map yet: the inactive old account keeps it (listed for IT)')
assert.equal(b3.opsMemberId, undefined, 'old id 48 has no account: waits for the map')
assert.equal(b4.opsMemberId, 'u-ops2', 'work reassigned in the new CRM stays')
assert.equal(b5.createdBy, 'lg-u-31', 'owner found by the closer name'); assert.equal(b5.teamLeadId, undefined, 'the Manager is not their own team leader')
assert.equal(d.bookings[5].teamLeadId, 'u-admin', 'new CRM files are never touched')

// with IT's map: old #8 → the new account, old #48 (deleted in the old CRM) → an Operations member
const map = { 8: 'u-two', 48: 'u-ops2' }
assert.equal(mapProblem(map, users), null); assert.match(mapProblem({ 8: 'u-admin' }, users), /not active/); assert.match(mapProblem({ x: 'u-two' }, users), /not an old CRM user/)
const P = makePeople(users, map)
assert.equal(P.byOldId('8').id, 'u-two'); assert.equal(P.byEmail('two@old.example.test').id, 'u-two'); assert.equal(P.byOldId('48').id, 'u-ops2'); assert.equal(P.manager().id, 'lg-u-31')
assert.equal(teamLeadFor(users[0], P.manager(), P.byId), 'u-tl')
d = db()
const changes = realign(d, map, { apply: true })
assert.equal(d.bookings[1].createdBy, 'u-two'); assert.equal(d.bookings[1].comments[0].by, 'u-two', 'history follows the person')
assert.equal(d.bookings[2].opsMemberId, 'u-ops2')
assert.equal(d.leads[0].assignedTo, 'u-two'); assert.equal(d.leads[0].chain[0].to, 'u-two'); assert.equal(d.leads[0].chain[0].by, 'lg-u-31')
assert.equal(d.notices[0].userId, 'u-two')
assert.ok(changes.some((c) => c.kind === 'owner') && changes.some((c) => c.kind === 'admin') && changes.some((c) => c.kind === 'teamlead'))
// running it again changes nothing (stable: a later copy gives the same answer)
assert.equal(realign(d, map, { apply: true }).length, 0)
// read-only by default
const ro = db(); realign(ro, map); assert.equal(ro.bookings[1].createdBy, 'lg-u-8')

// the person list: inactive old account → suggestion by the same name; deleted old id listed as unknown
const rows = peopleRows(db(), {})
const r8 = rows.find((r) => r.oldId === '8'), r48 = rows.find((r) => r.oldId === '48'), r63 = rows.find((r) => r.oldId === '63')
assert.equal(r8.state, 'inactive'); assert.deepEqual(r8.suggestion, { userId: 'u-two', why: 'same name' }); assert.equal(r8.owned, 1)
assert.equal(r48.state, 'unknown'); assert.equal(r48.ops, 1); assert.equal(r48.name, 'Old CRM user #48')
assert.equal(r63.state, 'ok')
assert.equal(peopleRows(db(), map).find((r) => r.oldId === '8').state, 'ok')

console.log('✓ old CRM people: person map, owners, Operations / Admin placement, team leaders, history, leads, stable re-runs')
