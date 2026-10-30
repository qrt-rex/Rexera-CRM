#!/usr/bin/env node
// Checks for the Automation Center: the rule engine (supabase/automation-rules.mjs) and how the app reads records,
// spots events and fills texts (src/lib/automation.ts).   node supabase/automation-rules.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { produce } from 'immer'
import { fillText, ruleMatches, ruleProblems, scheduleRunId, TEMPLATES, testCondition } from './automation-rules.mjs'

// ------------------------------------------------------------------ the engine on its own
const f = { values: { status: 'PENDING_ACCOUNTS', quoted: 150000, service: 'Seed Fund Scheme', assigned: true, note: '' }, text: { record: 'RX-1', company: 'Asha Foods' } }
assert.equal(testCondition({ field: 'status', op: 'eq', value: 'PENDING_ACCOUNTS' }, f, 'select'), true)
assert.equal(testCondition({ field: 'status', op: 'in', values: ['REJECTED', 'pending_accounts'] }, f, 'select'), true, 'case does not matter')
assert.equal(testCondition({ field: 'status', op: 'not_in', values: ['PENDING_ACCOUNTS'] }, f, 'select'), false)
assert.equal(testCondition({ field: 'quoted', op: 'gte', value: 100000 }, f, 'money'), true)
assert.equal(testCondition({ field: 'quoted', op: 'lt', value: '100000' }, f, 'money'), false)
assert.equal(testCondition({ field: 'service', op: 'contains', value: 'seed' }, f, 'text'), true)
assert.equal(testCondition({ field: 'assigned', op: 'is', value: false }, f, 'bool'), false)
assert.equal(testCondition({ field: 'note', op: 'empty' }, f, 'text'), true)
assert.equal(testCondition({ field: 'missing', op: 'gte', value: 1 }, f, 'number'), false, 'an unknown value never matches')
const fields = { status: { type: 'select' }, quoted: { type: 'money' } }
assert.equal(ruleMatches({ conditions: [] }, f, fields), true, 'no conditions: always')
assert.equal(ruleMatches({ conditions: [{ field: 'status', op: 'eq', value: 'X' }, { field: 'quoted', op: 'gt', value: 1 }] }, f, fields), false)
assert.equal(ruleMatches({ match: 'any', conditions: [{ field: 'status', op: 'eq', value: 'X' }, { field: 'quoted', op: 'gt', value: 1 }] }, f, fields), true)
assert.equal(fillText('New {record} · {company} for {first_name}', f), 'New RX-1 · Asha Foods for {first_name}', 'per-person placeholders are left for the email')
// daily checks: once per record, or once per period
assert.equal(scheduleRunId({ id: 'r', repeatDays: 0 }, 'bk-1', '2026-10-30'), 'ar-r-bk-1')
assert.equal(scheduleRunId({ id: 'r', repeatDays: 1 }, 'bk-1', '2026-10-30'), scheduleRunId({ id: 'r', repeatDays: 1 }, 'bk-1', '2026-10-30'))
assert.notEqual(scheduleRunId({ id: 'r', repeatDays: 1 }, 'bk-1', '2026-10-30'), scheduleRunId({ id: 'r', repeatDays: 1 }, 'bk-1', '2026-10-31'), 'next day: again')
assert.equal(scheduleRunId({ id: 'r', repeatDays: 7 }, 'bk-1', '2026-10-30'), scheduleRunId({ id: 'r', repeatDays: 7 }, 'bk-1', '2026-11-01'), 'same week: not again')
// the editor's checks
const probs = ruleProblems({ name: 'x', trigger: 'schedule.daily', entity: 'booking', conditions: [], actions: [{ type: 'task', to: [] }, { type: 'notify', to: [{ kind: 'role' }] }] }, { booking: {} })
for (const re of [/name/, /at least one condition/, /who gets it/, /task and its due date/, /pick the role/, /notification title/]) assert.ok(probs.some((p) => re.test(p)), `expected ${re}`)
assert.ok(ruleProblems({ name: 'Lead note', trigger: 'lead.created', conditions: [], actions: [{ type: 'comment', text: 'hello' }] }, { lead: {} }).some((p) => /only works on CRM entries/.test(p)))

// ------------------------------------------------------------------ with the app: fields, facts, events, actions
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildSeed } = await vite.ssrLoadModule('/src/lib/seed.ts')
const { upgradeDb } = await vite.ssrLoadModule('/src/lib/hrsuite.ts')
const A = await vite.ssrLoadModule('/src/lib/automation.ts')
await vite.close()

// every ready-made rule is valid against the app's real fields
for (const t of TEMPLATES) assert.deepEqual(A.automationProblems(t), [], t.name)

const db = upgradeDb(await buildSeed())
const b = db.bookings.find((x) => x.status === 'PENDING_ACCOUNTS') ?? db.bookings[0]
const facts = A.factsOf(db, 'booking', b)
assert.equal(facts.values.status, b.status)
assert.equal(facts.text.record, b.bookingId)
assert.equal(facts.text.link, `/bookings/${b.id}`)
assert.ok(typeof facts.values.daysInStatus === 'number')

// events: a status change, a payment, a new lead — and nothing for an unrelated edit
const at = '2026-10-30T06:00:00.000Z'
const lead0 = structuredClone(db.leads[0])
const next = produce(db, (d) => {
  const x = d.bookings.find((y) => y.id === b.id)
  x.status = 'REJECTED'
  x.payments.push({ id: 'pay-new', part: x.payments.length + 1, amount: 5000, gst: 900, total: 5900, date: '2026-10-30', mode: 'UPI', proofName: '', recordedBy: x.createdBy, verified: false })
  d.leads.unshift({ ...lead0, id: 'lead-new', code: 'LD-NEW', calls: [] })
  d.users[0].phone = '9999999999'
})
const ev = A.eventsBetween(db, next).map((e) => `${e.trigger}:${e.record.id}`)
assert.ok(ev.includes(`booking.status:${b.id}`))
assert.ok(ev.includes(`booking.payment:${b.id}`))
assert.ok(ev.includes('lead.created:lead-new'))
assert.equal(ev.length, 3, 'a phone number change starts nothing')
const changed = A.eventsBetween(db, next).find((e) => e.trigger === 'booking.status')
const cf = A.factsOf(next, 'booking', changed.record, changed.prev)
assert.equal(cf.values.prevStatus, b.status, 'the status before the change can be checked')
assert.equal(cf.values.payment, 5000)
// the "rejected → email the sales person" template matches this change and goes to the owner
const rejected = TEMPLATES.find((t) => t.trigger === 'booking.status')
assert.equal(ruleMatches(rejected, cf, A.FIELDS.booking), true)
assert.deepEqual(A.recipientsOf(next, 'booking', changed.record, rejected.actions[0].to).map((u) => u.id), [changed.record.createdBy].filter((id) => next.users.find((u) => u.id === id)?.active))

// switches: on until IT Support turns one off
assert.equal(A.builtinOn(db, 'task-reminders'), true)
const off = produce(db, (d) => { d.automationRules = [{ id: 'builtin:task-reminders', name: 'x', enabled: false, position: 0, trigger: 'builtin', conditions: [], actions: [] }] })
assert.equal(A.builtinOn(off, 'task-reminders'), false)
assert.equal(A.builtinOn(off, 'combo-reminders'), true)

// a daily check finds the records it should, and a done run is not repeated
const stuck = { ...TEMPLATES.find((t) => t.entity === 'booking'), id: 'rule-stuck', enabled: true, position: 1, conditions: [{ field: 'status', op: 'in', values: ['PENDING_ACCOUNTS', 'PENDING_LEGAL', 'IN_OPERATIONS', 'WITH_ADMIN'] }, { field: 'daysInStatus', op: 'gte', value: 0 }] }
const hits = A.scheduleMatches(db, stuck)
assert.ok(hits.length > 0, 'the demo data has files in progress')
const doneDb = produce(db, (d) => { d.automationRuns = [{ id: hits[0].runId, ruleId: 'rule-stuck', ruleName: 'x', at, trigger: 'schedule.daily', recordType: 'booking', recordId: hits[0].record.id, recordLabel: '', ok: true, detail: '' }] })
assert.equal(A.scheduleMatches(doneDb, stuck).find((m) => m.record.id === hits[0].record.id).done, true)

// only IT Support edits
const it = db.users.find((u) => u.role === 'it'), sa = db.users.find((u) => u.role === 'superadmin')
assert.equal(A.canEditAutomation(it), true)
assert.equal(A.canEditAutomation(sa), false, 'Super Admin looks, IT Support edits')
assert.equal(A.canViewAutomation(sa), true)

console.log('✓ automation: conditions, texts, daily-check periods, editor checks, templates, events, facts, switches, IT-only editing')
// the app's store keeps a BroadcastChannel open (tab sync), which would keep Node running
process.exit(0)
