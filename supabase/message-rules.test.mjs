#!/usr/bin/env node
// Checks for supabase/message-rules.mjs (client WhatsApp / email messages).   node supabase/message-rules.test.mjs
import assert from 'node:assert/strict'
import { DEFAULT_TEMPLATES, fillMessage, leftovers, MESSAGE_STAGES, messageProblem, oneLine, stageClosed, stageDenied, stagesFor, templatesWith, canEditTemplates } from './message-rules.mjs'

const booking = (status, stage = 1, more = {}) => ({ kind: 'booking', status, stage, ownerId: 'u-s1', teamLeadId: 'u-tl1', ...more })
const entry = { kind: 'entry', status: 'HOT', ownerId: 'u-s1', teamLeadId: 'u-tl1' }

// who may send what
assert.deepEqual(stagesFor(['sales'], 'u-s1', entry).map((s) => s.id), ['WELCOME'], 'sales: only the welcome')
assert.deepEqual(stagesFor(['sales'], 'u-s1', booking('PENDING_ACCOUNTS')).map((s) => s.id), ['WELCOME'])
assert.equal(stageDenied('WELCOME', ['sales'], 'u-s2', entry), 'Only for your own clients.', 'another sales person’s client')
assert.equal(stageDenied('WELCOME', ['teamlead'], 'u-tl1', entry), null, 'the team leader of the owner')
assert.equal(stageDenied('ACCOUNT_CLEARED', ['sales'], 'u-s1', booking('PENDING_LEGAL')), 'Your team does not send this message.')
assert.deepEqual(stagesFor(['accounts'], 'u-acc', booking('PENDING_LEGAL')).map((s) => s.id), ['ACCOUNT_CLEARED'], 'accounts: only account cleared')
assert.deepEqual(stagesFor(['legal'], 'u-leg', booking('IN_OPERATIONS')).map((s) => s.id), ['LEGAL_CLEARED'], 'legal: only legal cleared')
assert.equal(stagesFor(['operations'], 'u-op1', booking('IN_OPERATIONS')).length, MESSAGE_STAGES.length, 'operations: every message')
assert.equal(stagesFor(['admin'], 'u-ad1', booking('WITH_ADMIN')).length, MESSAGE_STAGES.length, 'admin: every message')
assert.equal(stagesFor(['it'], 'u-it', booking('WITH_ADMIN')).length, MESSAGE_STAGES.length)
assert.deepEqual(stagesFor(['operations'], 'u-op1', entry).map((s) => s.id), ['WELCOME', 'GENERAL'], 'a client entry has no file messages yet')

// when each message opens
assert.equal(stageClosed('ACCOUNT_CLEARED', booking('PENDING_ACCOUNTS')), 'Opens when Accounts has cleared the account (file with Legal).')
assert.equal(stageClosed('ACCOUNT_CLEARED', booking('PENDING_LEGAL')), null)
assert.equal(stageClosed('LEGAL_CLEARED', booking('PENDING_LEGAL')), 'Opens when Legal has cleared the file (file with Operations).')
assert.equal(stageClosed('LEGAL_CLEARED', booking('IN_OPERATIONS')), null)
assert.equal(stageClosed('LEGAL_CLEARED', booking('ON_HOLD', 3, { holdFrom: 'IN_OPERATIONS' })), null, 'on hold counts as where it was')
assert.match(stageClosed('SUBMITTED', booking('IN_OPERATIONS', 5)), /stage 6/)
assert.equal(stageClosed('SUBMITTED', booking('WITH_ADMIN', 6)), null)
assert.equal(stageClosed('COMPLETED', booking('COMPLETED', 8)), null)
assert.match(stageClosed('WELCOME', booking('REJECTED')), /rejected/)
assert.equal(stageClosed('GENERAL', booking('REJECTED')), null, 'a general message is always open')
assert.match(stageClosed('ACCOUNT_CLEARED', entry), /CRM entry/)
assert.match(stageClosed('WELCOME', { ...entry, status: 'NOT_INTERESTED' }), /not interested/)

// templates
assert.ok(canEditTemplates(['operations']) && canEditTemplates(['admin']) && canEditTemplates(['superadmin']) && canEditTemplates(['it']))
assert.ok(!canEditTemplates(['sales']) && !canEditTemplates(['accounts']) && !canEditTemplates(['legal']))
const t = templatesWith({ WELCOME: { whatsapp: 'Hi {client_name}!' } })
assert.equal(t.WELCOME.whatsapp, 'Hi {client_name}!')
assert.equal(t.WELCOME.subject, DEFAULT_TEMPLATES.WELCOME.subject, 'unsaved parts come from the default')
const vars = { client_name: 'Asha', company: 'Asha Foods', application_no: 'RX-2026-000123', service: 'PMEGP', team_member: 'Sneha', team_phone: '', our_company: 'Rexera', stage: '3. Document review', status: 'With Operations' }
const filled = fillMessage(DEFAULT_TEMPLATES.LEGAL_CLEARED.email, vars)
assert.match(filled, /Dear Asha,/)
assert.match(filled, /PMEGP \(RX-2026-000123\)/)
assert.deepEqual(leftovers(filled), [], 'every placeholder of a default template is filled')
assert.ok(!/\n\n$/.test(filled) && !filled.includes('undefined'))
assert.equal(fillMessage('Hi {client_name} {unknown}', vars), 'Hi Asha {unknown}', 'an unknown placeholder stays for the sender to see')
for (const s of MESSAGE_STAGES) for (const k of ['subject', 'email', 'whatsapp']) assert.deepEqual(leftovers(fillMessage(DEFAULT_TEMPLATES[s.id][k], vars)), [], `${s.id}.${k}`)
assert.equal(oneLine('Line one\n\n• two\nthree'), 'Line one • two three')
assert.equal(fillMessage('Welcome to {our_company}.', { our_company: 'Rexera Pvt. Ltd.' }), 'Welcome to Rexera Pvt. Ltd.', 'no double full stop')
assert.equal(fillMessage('Wait...', {}), 'Wait...', 'an ellipsis stays')

// checks before sending
const ok = { stage: 'WELCOME', channel: 'EMAIL', subject: 'Welcome', body: 'Dear Asha, welcome.', clientEntryId: 'ce-1' }
assert.equal(messageProblem(ok), null)
assert.match(messageProblem({ ...ok, subject: '' }), /subject/)
assert.equal(messageProblem({ ...ok, channel: 'WHATSAPP', subject: '' }), null, 'WhatsApp has no subject')
assert.match(messageProblem({ ...ok, channel: 'WHATSAPP', body: 'x'.repeat(901) }), /900/)
assert.match(messageProblem({ ...ok, body: 'Dear {client_name}' }), /\{client_name\}/)
assert.match(messageProblem({ ...ok, bookingId: 'bk-1' }), /Which client/, 'one record, not two')
assert.match(messageProblem({ ...ok, channel: 'SMS' }), /WhatsApp or Email/)

console.log('✓ client messages: who sends what, when it opens, templates, placeholders, checks')
