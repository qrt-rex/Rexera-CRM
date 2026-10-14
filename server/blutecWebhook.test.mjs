#!/usr/bin/env node
/** Check for server/blutecWebhook.mjs.   node server/blutecWebhook.test.mjs */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { completedCall, ivrLead, receive, verifySignature } from './blutecWebhook.mjs'

// signature: hex HMAC-SHA256 of `${timestamp}.${raw body}` (Blutec's IVR webhook screen)
const secret = 'whsec_test', body = '{"event":"ivr.interested"}', ts = String(Math.floor(Date.now() / 1000))
const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
assert.ok(verifySignature(secret, ts, body, sig))
assert.ok(verifySignature(secret, ts, body, `sha256=${sig.toUpperCase()}`), 'prefix / case tolerated')
assert.ok(!verifySignature(secret, ts, body + ' ', sig), 'body changed')
assert.ok(!verifySignature('other', ts, body, sig), 'wrong secret')
assert.ok(!verifySignature(secret, String(Number(ts) - 3600), body, crypto.createHmac('sha256', secret).update(`${Number(ts) - 3600}.${body}`).digest('hex')), 'an hour old: replay')
assert.ok(!verifySignature(secret, ts, body, undefined), 'unsigned')
// a bad signature is refused before anything else happens
assert.equal(receive((k) => (k === 'BLUTEC_IVR_WEBHOOK_SECRET' ? secret : ''), 'ivr', { 'x-webhook-timestamp': ts, 'x-webhook-signature': 'bad' }, body).answer.status, 401)

// the payload from Blutec's IVR webhook screen
const ivr = ivrLead({
  event: 'ivr.interested', occurred_at: '2026-10-01T10:30:00.000Z', ivr: { id: 12, name: 'Diwali blast' }, digit: '1', disposition: { id: 4, name: 'Interested' },
  call: { id: 9001, duration_seconds: 18 }, lead: { id: 440, phone: '+919876543221', email: 'Lead@Example.com', custom_data: { name: 'Asha Patel', city: 'Ahmedabad', budget: '5L' } },
})
assert.deepEqual([ivr.phone, ivr.name, ivr.email, ivr.city, ivr.source], ['9876543221', 'Asha Patel', 'lead@example.com', 'Ahmedabad', 'IVR: Diwali blast'])
assert.deepEqual(ivr.extra, { budget: '5L' })
assert.match(ivr.note, /Pressed 1 \(Interested\) in “Diwali blast” · 18s call/)

// a finished CRM call → the lead's call history
const done = completedCall({ event: 'call.completed', payload: { ref_id: 'abc-123', call: { status: 'completed', start_time: '2026-10-14T05:00:00.000Z', answer_time: '2026-10-14T05:00:10.000Z', talk_duration_seconds: 95, disposition: 'Hot Prospect' }, custom_identifier: { crm_lead_id: 'lead-9', crm_user_id: 'u-s1' } } })
assert.deepEqual([done.id, done.lead_id, done.called_by, done.outcome, done.duration_sec], ['bt-abc-123', 'lead-9', 'u-s1', 'HOT_PROSPECT', 95])
assert.equal(completedCall({ payload: { ref_id: 'x', call: { status: 'failed' }, custom_identifier: { crm_lead_id: 'l' } } }).outcome, 'NOT_PICKUP', 'never answered')
assert.equal(completedCall({ payload: { ref_id: 'x', call: {} } }), null, 'not a CRM lead call')
console.log('✓ Blutec webhooks: signature, IVR lead, finished call')
