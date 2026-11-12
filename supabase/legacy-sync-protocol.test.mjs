import assert from 'node:assert/strict'
import { applyRepairs, changedTables, fingerprintKey, planWrites, repairStep, rowHash, signRequest, signedText, verifyRequest } from './legacy-sync-protocol.mjs'

const secret = 'x'.repeat(40)

// ------------------------------------------------------------------ signed requests
const params = { table: 'crm', offset: 2000, db: 'main', limit: '' }
assert.equal(signedText('100', 'rows', params), '100\nrows\ndb=main&offset=2000&table=crm', 'keys sorted, empty values left out')
const h = await signRequest(secret, 'rows', params, 1_000_000_000_000)
const hdr = { 'x-rexera-time': h['X-Rexera-Time'], 'x-rexera-signature': h['X-Rexera-Signature'] }
assert.equal(await verifyRequest(secret, hdr, 'rows', params, 1_000_000_000_000), null)
assert.match(await verifyRequest('y'.repeat(40), hdr, 'rows', params, 1_000_000_000_000), /Wrong signature/)
assert.match(await verifyRequest(secret, hdr, 'rows', { ...params, table: 'users' }, 1_000_000_000_000), /Wrong signature/, 'another table → another signature')
assert.match(await verifyRequest(secret, hdr, 'rows', params, 1_000_000_000_000 + 301_000), /expired/, 'older than 5 minutes')
// a path with ( ) and spaces signs the same as PHP's encoding of it (JS encodeURIComponent rules)
assert.equal(signedText('1', 'file', { path: 'uploads/a b(1).pdf' }), "1\nfile\npath=uploads%2Fa%20b(1).pdf")

// ------------------------------------------------------------------ change detection
const fpA = { main: { crm: '10:111', users: '5:22' } }, fpB = { main: { users: '5:22', crm: '11:112' } }
assert.equal(fingerprintKey(fpA), fingerprintKey({ main: { users: '5:22', crm: '10:111' } }), 'order does not matter')
assert.notEqual(fingerprintKey(fpA), fingerprintKey(fpB))
assert.deepEqual(changedTables(fpA, { ...fpB, billing: { invoices: '1:1' } }), ['billing.invoices', 'crm'])

// ------------------------------------------------------------------ what a sync writes
const T = [['bookings', 'id'], ['invoice_items', 'invoice_id,position']]
const b1 = { id: 'lg-b-1', status: 'IN_OPERATIONS', stage: 2 }
const b2 = { id: 'lg-b-2', status: 'PENDING_LEGAL', stage: 1 }
// first sync: everything new is added and remembered
let r = planWrites({}, { bookings: [b1, b2] }, new Map(), 'new', T)
assert.deepEqual(r.writes.bookings.map((x) => x.id), ['lg-b-1', 'lg-b-2'])
assert.deepEqual(r.counts.bookings, { added: 2, updated: 0, kept: 0, same: 0 })
const synced = new Map(r.hashes.map((x) => [`${x.table_name}|${x.row_key}`, x.hash]))
// the old CRM moved b1 on; nobody touched it in the new CRM → updated
const b1old = { ...b1, stage: 3 }
r = planWrites({ bookings: [b1, b2] }, { bookings: [b1old, b2] }, synced, 'new', T)
assert.deepEqual(r.writes.bookings, [b1old])
assert.deepEqual(r.counts.bookings, { added: 0, updated: 1, kept: 0, same: 1 })
// someone changed b2 in the new CRM (Admin assigned), the old CRM changed it too → the new CRM's work is kept
const b2new = { ...b2, status: 'WITH_ADMIN' }, b2old = { ...b2, stage: 2 }
r = planWrites({ bookings: [b1, b2new] }, { bookings: [b1, b2old] }, synced, 'new', T)
assert.equal(r.writes.bookings, undefined, 'nothing overwritten')
assert.deepEqual(r.counts.bookings, { added: 0, updated: 0, kept: 1, same: 1 })
// … unless IT chose "take the old CRM's version"
r = planWrites({ bookings: [b1, b2new] }, { bookings: [b1, b2old] }, synced, 'old', T)
assert.deepEqual(r.writes.bookings, [b2old])
// rows only in the new CRM are never deleted (they're simply not in the plan)
r = planWrites({ bookings: [b1, b2, { id: 'b-new-crm' }] }, { bookings: [b1, b2] }, synced, 'new', T)
assert.equal(r.writes.bookings, undefined)
// composite keys
r = planWrites({ invoice_items: [{ invoice_id: 'i1', position: 1, qty: 1 }] }, { invoice_items: [{ invoice_id: 'i1', position: 1, qty: 1 }, { invoice_id: 'i1', position: 2, qty: 3 }] }, new Map(), 'new', T)
assert.deepEqual(r.writes.invoice_items, [{ invoice_id: 'i1', position: 2, qty: 3 }])
// a record the sync never wrote that differs (e.g. imported by hand earlier, then edited) counts as changed here
r = planWrites({ bookings: [b2new] }, { bookings: [b2old] }, new Map(), 'new', T)
assert.deepEqual(r.counts.bookings, { added: 0, updated: 0, kept: 1, same: 0 })
assert.equal(rowHash({ a: 1 }), rowHash({ a: 1 })); assert.notEqual(rowHash({ a: 1 }), rowHash({ a: 2 }))

// ------------------------------------------------------------------ self-repair of refused old data
const bk = { id: 'lg-b-1', created_by: 'lg-u-99', stage: 12, gst_rate: 18, company: 'x'.repeat(30), total_quoted: -500, booking_id: 'lg-b-0', note: 'abc', paid_on: '0000-00-00' }
assert.deepEqual(repairStep('bookings', bk, 'insert or update on table "bookings" violates foreign key constraint "bookings_created_by_fkey"'), { column: 'created_by', to: null, why: 'pointed at a record that is not in the CRM (e.g. a removed user) — link left empty' })
assert.equal(repairStep('booking_comments', bk, 'violates foreign key constraint "booking_comments_booking_id_fkey"'), null, 'a missing client file is never cut — the comment waits for it')
assert.equal(repairStep('bookings', bk, 'new row for relation "bookings" violates check constraint "bookings_stage_check"').to, 9, 'stage kept in 1–9')
assert.equal(repairStep('bookings', bk, 'new row for relation "bookings" violates check constraint "bookings_total_quoted_check"').to, 0)
assert.equal(repairStep('bookings', bk, 'value too long for type character varying(20)').to.length, 20)
assert.deepEqual(repairStep('bookings', bk, 'null value in column "mode" of relation "bookings" violates not-null constraint').to, '')
assert.equal(repairStep('bookings', bk, 'null value in column "amount" violates not-null constraint').to, 0)
assert.equal(repairStep('bookings', bk, 'invalid input syntax for type date: "0000-00-00"').column, 'paid_on')
assert.equal(repairStep('bookings', bk, 'something else'), null)
// repairs made once are applied again to the same old value — and dropped when the old CRM corrects it
const rows = { bookings: [{ id: 'lg-b-1', stage: 12 }, { id: 'lg-b-2', stage: 3 }] }
const repairs = { 'bookings|lg-b-1': { stage: { from: 12, to: 9 } }, 'bookings|lg-b-2': { stage: { from: 15, to: 9 } } }
assert.equal(applyRepairs(rows, repairs, T), 1)
assert.deepEqual(rows.bookings.map((r) => r.stage), [9, 3], 'lg-b-2 was corrected in the old CRM: its old repair no longer applies')

console.log('✓ old CRM sync: self-repair of refused old data (missing links, empty values, ranges, too long, bad dates)')
console.log('✓ old CRM sync: signed requests, change detection, adds new records, applies old-CRM changes, never overwrites new-CRM work or deletes')
