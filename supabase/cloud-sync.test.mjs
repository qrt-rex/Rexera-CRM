#!/usr/bin/env node
/**
 * Check for src/lib/cloud.ts: each kind of change to the CRM document must turn into exactly the table writes
 * it needs — no more (a lead edit must not rewrite every lead), no less.   node supabase/cloud-sync.test.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { produce } from 'immer'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildSeed } = await vite.ssrLoadModule('/src/lib/seed.ts')
const { upgradeDb } = await vite.ssrLoadModule('/src/lib/hrsuite.ts')
const { plan } = await vite.ssrLoadModule('/src/lib/cloud.ts')
await vite.close()

/** A stand-in Supabase client that records each write as "table op [rows]" instead of sending it. */
function recorder() {
  const log = []
  const done = { error: null, then: (f) => Promise.resolve({ error: null }).then(f) }
  const q = (table, op, rows) => {
    const entry = { table, op, rows: rows ? (Array.isArray(rows) ? rows : [rows]) : [] }
    log.push(entry)
    const chain = { ...done, eq: (c, v) => { entry.where = `${c}=${v}`; return chain }, in: (c, v) => { entry.where = `${c} in ${v}`; return chain }, filter: (c, o, v) => { entry.where = `${c} ${o} ${v}`; return chain } }
    return chain
  }
  const client = { from: (t) => ({ insert: (r) => q(t, 'insert', r), update: (r) => q(t, 'update', r), upsert: (r) => q(t, 'upsert', r), delete: () => q(t, 'delete') }) }
  return { client, log }
}
async function writes(prev, next) {
  const { client, log } = recorder()
  for (const step of plan(prev, next, client)) await Promise.all(step.map((op) => op()))
  return log.map((w) => `${w.table} ${w.op}${w.rows.length ? ` ${w.rows.length}` : ''}${w.where ? ` (${w.where})` : ''}`)
}

const base = upgradeDb(await buildSeed())
const lead = base.leads[0], booking = base.bookings[0], [a, b] = base.users
const at = '2026-10-12T05:30:00.000Z'

assert.deepEqual(await writes(base, base), [], 'no change, no writes')

assert.deepEqual(await writes(base, produce(base, (d) => { d.leads[0].name = 'Renamed' })), [`leads update 1 (id=${lead.id})`], 'edit one lead')

assert.deepEqual(await writes(base, produce(base, (d) => {
  d.leads[0].calls.unshift({ id: 'c-new', at, by: a.id, outcome: 'BUSY', note: '', durationSec: 0 })
})), [`leads update 1 (id=${lead.id})`, 'lead_calls insert 1'], 'log a call')

assert.deepEqual(await writes(base, produce(base, (d) => { d.leads.splice(0, 1) })), [`leads delete (id in ("${lead.id}"))`], 'delete a lead')

// new CRM entry: the booking, its children, and the counter — not every other setting
const created = await writes(base, produce(base, (d) => {
  const copy = structuredClone(booking)
  d.bookings.unshift({ ...copy, id: 'bk-new', bookingId: 'RX-2026-999999' })
  d.counters.booking += 1
}))
assert.equal(created[0], 'bookings insert 1', 'new booking first')
assert.ok(created.every((w) => !w.includes(' update ')), 'a new booking only inserts')
assert.deepEqual(created.filter((w) => w.startsWith('app_settings')), ['app_settings upsert 1'], 'only the counters row')

assert.deepEqual(await writes(base, produce(base, (d) => {
  d.bookings[0].comments.push({ id: 'cm-new', by: a.id, at, text: 'hi', kind: '' })
})), [`bookings update 1 (id=${booking.id})`, 'booking_comments insert 1'], 'comment on a booking')

assert.deepEqual(await writes(base, produce(base, (d) => { d.users[1].teamLeadId = a.id })), [`app_users update 1 (id=${b.id})`], 'change a team lead')
const [{ rows: [userRow] }] = await (async () => { const { client, log } = recorder(); for (const s of plan(base, produce(base, (d) => { d.users[1].teamLeadId = a.id }), client)) await Promise.all(s.map((op) => op())); return log })()
assert.equal(userRow.team_lead_id, a.id, 'the team lead reaches the row')

assert.deepEqual(await writes(base, produce(base, (d) => {
  d.audit.unshift({ id: 'a-new', at, by: a.id, action: 'TEST', detail: '' })
})), ['audit_log insert 1'], 'audit entry')

const withAsset = produce(base, (d) => { d.assets = [{ id: 'as-1', tag: 'RX-AST-0001', name: 'Laptop', category: 'IT', status: 'IN_STOCK', createdAt: at, history: [{ at, by: a.id, action: 'ADDED' }] }] })
assert.deepEqual(await writes(withAsset, produce(withAsset, (d) => {
  d.assets[0].status = 'ASSIGNED'; d.assets[0].assignedTo = b.id
  d.assets[0].history.unshift({ at, by: a.id, action: 'ASSIGNED', userId: b.id })
})), ['company_assets update 1 (id=as-1)', 'asset_events insert 1'], 'assign an asset: one new history row')

assert.deepEqual(await writes(base, produce(base, (d) => { d.rolePerms.sales = [...d.rolePerms.sales, 'reports.view'] })),
  ['role_permissions delete (role=sales)', `role_permissions insert ${new Set(base.rolePerms.sales).size + 1}`], 'role permissions: rewrite that role only')

console.log('✓ cloud sync writes only what changed')
