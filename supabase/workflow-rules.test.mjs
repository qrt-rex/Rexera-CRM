// node supabase/workflow-rules.test.mjs — reminder dates, scheme expiry and Admin progress
import assert from 'node:assert/strict'
import { addDays, adminProgress, daysBetween, followUpDue, istToday, nextAfter, precheckDue, schemeAlertDue, schemeDaysLeft, schemeDuration, schemeState, fillTemplate, workflowSettings } from './workflow-rules.mjs'

// India date, whatever the server's clock zone: 19:00 UTC on the 20th is already the 21st in India
assert.equal(istToday(Date.UTC(2026, 9, 20, 19, 0)), '2026-10-21')
assert.equal(istToday(Date.UTC(2026, 9, 20, 18, 0)), '2026-10-20')
assert.equal(addDays('2026-10-25', 15), '2026-11-09')
assert.equal(addDays('2026-12-31', 1), '2027-01-01')
assert.equal(daysBetween('2026-10-01', '2026-10-16'), 15)
// a reminder missed for a while is sent once, then the next one is in the future
assert.equal(nextAfter('2026-10-01', 15, '2026-10-01'), '2026-10-16')
assert.equal(nextAfter('2026-10-01', 15, '2026-10-20'), '2026-10-31')
assert.equal(nextAfter('2026-11-01', 15, '2026-10-20'), '2026-11-01', 'a future date stays')

// 15-day follow-up: only active, unpaused files whose date has come
const f = (status, nextOn, paused = false) => ({ status, followUp: { everyDays: 15, startedOn: '2026-10-01', nextOn, paused, log: [] } })
assert.equal(followUpDue(f('IN_OPERATIONS', '2026-10-16'), '2026-10-16'), true)
assert.equal(followUpDue(f('IN_OPERATIONS', '2026-10-17'), '2026-10-16'), false)
assert.equal(followUpDue(f('IN_OPERATIONS', '2026-10-16', true), '2026-10-20'), false, 'paused')
assert.equal(followUpDue(f('COMPLETED', '2026-10-16'), '2026-10-20'), false, 'completed files stop')
assert.equal(followUpDue(f('ON_HOLD', '2026-10-16'), '2026-10-20'), true, 'on hold still needs chasing')

// Pre-Check Deck: pending and due
const pc = (status, nextRemindOn, file = 'WITH_ADMIN') => ({ status: file, adminWork: { PRECHECK: { status, nextRemindOn, history: [], updatedAt: '', updatedBy: '' } } })
assert.equal(precheckDue(pc('IN_PROGRESS', '2026-10-20'), '2026-10-20'), true)
assert.equal(precheckDue(pc('APPROVED', '2026-10-20'), '2026-10-20'), false, 'approved stops')
assert.equal(precheckDue(pc('IN_PROGRESS', '2026-10-20', 'REJECTED'), '2026-10-25'), false, 'rejected file stops')

// schemes
const s = { active: true, startDate: '2026-10-01', endDate: '2026-10-31' }
assert.equal(schemeDuration(s), 31)
assert.equal(schemeState(s, '2026-09-30'), 'UPCOMING')
assert.equal(schemeState(s, '2026-10-31'), 'ACTIVE', 'the end date itself is still active')
assert.equal(schemeState(s, '2026-11-01'), 'EXPIRED')
assert.equal(schemeState({ ...s, active: false }, '2026-10-10'), 'INACTIVE')
assert.equal(schemeDaysLeft(s, '2026-10-30'), 1)
assert.equal(schemeAlertDue(s, '2026-10-30'), true, 'one day before the end')
assert.equal(schemeAlertDue(s, '2026-10-29'), false)
assert.equal(schemeAlertDue(s, '2026-10-31'), false)

// Admin progress: each file once per stage, NOT_NEEDED left out, numerator / denominator kept
const w = (status, assignee, due) => ({ status, assignee, due, history: [], updatedAt: '2026-10-10T00:00:00Z', updatedBy: 'x' })
const files = [
  { id: 'b1', status: 'WITH_ADMIN', adminId: 'a1', adminWork: { PRECHECK: w('COMPLETED'), FINANCE: w('IN_PROGRESS', undefined, '2026-10-01'), DPR: w('NOT_NEEDED') } },
  { id: 'b2', status: 'WITH_ADMIN', adminId: 'a1', adminWork: { PRECHECK: w('APPROVED'), FINANCE: w('NOT_STARTED') } },
  { id: 'b3', status: 'WITH_ADMIN', adminId: 'a1', adminWork: { PRECHECK: w('IN_PROGRESS', 'a2') } },
  { id: 'b4', status: 'REJECTED', adminId: 'a1', adminWork: { PRECHECK: w('IN_PROGRESS') } },
]
const p = adminProgress(files, '2026-10-20')
const a1 = p.find((r) => r.userId === 'a1'), a2 = p.find((r) => r.userId === 'a2')
assert.deepEqual([a1.stages.PRECHECK.done, a1.stages.PRECHECK.total], [2, 2])
assert.deepEqual([a1.stages.FINANCE.done, a1.stages.FINANCE.total, a1.stages.FINANCE.overdue], [0, 2, 1])
assert.equal(a1.stages.DPR.total, 0, 'not needed is left out')
assert.deepEqual([a1.done, a1.total, a1.pct], [2, 4, 50])
assert.deepEqual([a2.stages.PRECHECK.total, a2.pct], [1, 0], 'the stage assignee gets it, not the file admin')

// templates
assert.equal(fillTemplate('Hi {client_name} — {reference} {unknown}', { client_name: 'Asha', reference: 'RX-1' }), 'Hi Asha — RX-1 {unknown}')
assert.equal(workflowSettings({ precheckDays: 4 }).fileReminderDays, 15)
assert.equal(workflowSettings({ welcomeEmail: { subject: 'S' } }).welcomeEmail.body.length > 50, true, 'missing parts come from the defaults')
console.log('✓ workflow rules: India dates, follow-ups, Pre-Check Deck, schemes, Admin progress, templates')
