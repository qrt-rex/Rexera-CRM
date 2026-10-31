// node server/clientMessages.test.mjs — client WhatsApp / email messages: permissions, recipient, duplicates, log
import assert from 'node:assert/strict'
import { sendClientMessage } from './clientMessages.mjs'

/** In-memory stand-in for the Supabase client (what clientMessages.mjs uses). `visible` limits what the caller reads. */
function fake(t, visible) {
  const from = (name) => {
    const rows = (t[name] ??= [])
    const filters = []
    let lim = Infinity
    const match = (r) => filters.every((f) => f(r)) && (!visible || !visible[name] || visible[name](r))
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push((r) => r[k] === v); return api },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return api },
      gte: (k, v) => { filters.push((r) => r[k] >= v); return api },
      limit: (n) => { lim = n; return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      insert: async (x) => { rows.push(...structuredClone(Array.isArray(x) ? x : [x])); return { error: null } },
      then: (ok) => ok({ data: rows.filter(match).slice(0, lim), error: null }),
    }
    return api
  }
  return { from, t }
}
const now = Date.UTC(2026, 9, 31, 6, 0)
const tables = () => ({
  app_users: [{ id: 'u-s1', role: 'sales', team_lead_id: 'u-tl1', phone: '9800000001', email: 'rahul@rexera.test' }, { id: 'u-acc', role: 'accounts' }, { id: 'u-op1', role: 'operations', email: 'sneha@rexera.test' }, { id: 'u-s2', role: 'sales' }],
  user_extra_roles: [],
  app_settings: [{ key: 'company', value: { name: 'Rexera' } }, { key: 'workflow', value: { whatsapp: { notifyTemplate: 'client_update', language: 'en' } } }],
  bookings: [{ id: 'bk-1', booking_code: 'RX-2026-000123', company_name: 'Asha Foods', contact_person: 'Asha', email: 'asha@foods.test', mobile: '9876500001', status: 'PENDING_LEGAL', stage: 1, created_by: 'u-s1', team_lead_id: 'u-tl1' }],
  client_entries: [{ id: 'ce-1', client_name: 'Bina', company_name: 'Bina Tech', phone: '9876500002', email: null, status: 'HOT', owner_id: 'u-s1' }],
  client_messages: [], audit_log: [],
})
const as = (t, id, name = 'Someone') => ({ admin: fake(t), asCaller: fake(t), me: { id, name, active: true } })
const mails = []
const deliverEmail = async (m) => { mails.push(m); return { success: true, message: `Email sent to ${m.to}` } }
const env = (vars) => (k) => vars[k] ?? ''
const send = (t, who, body, o = {}) => sendClientMessage(env(o.env ?? {}), 'Bearer x', JSON.stringify(body), { clients: as(t, who, o.name), deliverEmail: o.deliverEmail ?? deliverEmail, fetchImpl: o.fetchImpl, now: o.now ?? now })

// 1) Accounts: account cleared, by email, to the address SAVED on the entry (not one from the browser)
let t = tables()
let r = await send(t, 'u-acc', { stage: 'ACCOUNT_CLEARED', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Account cleared', body: 'Dear Asha, your account is cleared.', to: 'attacker@evil.test', requestId: 'cm-req-0001' }, { name: 'Priya' })
assert.equal(r.status, 200, r.body.message)
assert.equal(r.body.status, 'SENT')
assert.equal(mails.at(-1).to, 'asha@foods.test', 'the record’s email, whatever the browser sends')
assert.equal(mails.at(-1).sender.name, 'Priya')
assert.equal(mails.at(-1).sender.role, 'Accounts Team')
assert.equal(t.client_messages.length, 1)
assert.deepEqual([t.client_messages[0].channel, t.client_messages[0].to_addr, t.client_messages[0].sent_by, t.client_messages[0].stage], ['EMAIL', 'asha@foods.test', 'u-acc', 'ACCOUNT_CLEARED'])
assert.equal(t.audit_log.length, 1)

// 2) the same request again: answered once, nothing sent twice
const before = mails.length
r = await send(t, 'u-acc', { stage: 'ACCOUNT_CLEARED', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Account cleared', body: 'Dear Asha, your account is cleared.', requestId: 'cm-req-0001' })
assert.equal(r.body.duplicate, true)
assert.equal(mails.length, before)
// 3) a new click of the same message within 2 minutes: refused
r = await send(t, 'u-acc', { stage: 'ACCOUNT_CLEARED', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Account cleared', body: 'Again', requestId: 'cm-req-0002' }, { now: now + 60_000 })
assert.equal(r.status, 409)
// …but WhatsApp is a separate button and goes through
r = await send(t, 'u-acc', { stage: 'ACCOUNT_CLEARED', channel: 'WHATSAPP', bookingId: 'bk-1', body: 'Your account is cleared.\nNow with Legal.' }, { now: now + 60_000, env: { INTERAKT_API_KEY: 'k' }, fetchImpl: async (_url, init) => { const b = JSON.parse(init.body); assert.equal(b.template.name, 'client_update'); assert.deepEqual(b.template.bodyValues, ['Asha', 'RX-2026-000123', 'Your account is cleared. Now with Legal.', 'Rexera']); assert.equal(b.phoneNumber, '9876500001'); return { ok: true, json: async () => ({ result: true, id: 'wa-1' }) } } })
assert.equal(r.body.status, 'SENT', r.body.message)
assert.equal(t.client_messages.at(-1).provider_id, 'wa-1')

// 4) permissions: sales can't send Accounts' message; another sales person can't message someone else's client
t = tables()
r = await send(t, 'u-s1', { stage: 'ACCOUNT_CLEARED', channel: 'EMAIL', bookingId: 'bk-1', subject: 'x x x', body: 'Cleared' })
assert.equal(r.status, 403)
r = await send(t, 'u-s2', { stage: 'WELCOME', channel: 'WHATSAPP', clientEntryId: 'ce-1', body: 'Welcome!' })
assert.equal(r.status, 403)
assert.match(r.body.message, /your own clients/)
// a record the sender can't open (row-level security) can't be messaged
r = await sendClientMessage(env({}), 'Bearer x', JSON.stringify({ stage: 'GENERAL', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Hello there', body: 'Hi Asha' }), { clients: { admin: fake(t), asCaller: fake(t, { bookings: () => false }), me: { id: 'u-op1', name: 'Sneha' } }, deliverEmail, now })
assert.equal(r.status, 403)
// not open yet at this step of the file
r = await send(t, 'u-op1', { stage: 'LEGAL_CLEARED', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Legal cleared', body: 'Cleared' })
assert.equal(r.status, 422)
assert.match(r.body.message, /Legal has cleared/)

// 5) sales welcome on their own client entry: no email saved → asked to add it; WhatsApp not set up → recorded as such
r = await send(t, 'u-s1', { stage: 'WELCOME', channel: 'EMAIL', clientEntryId: 'ce-1', subject: 'Welcome Bina', body: 'Welcome!' })
assert.equal(r.status, 422)
assert.match(r.body.message, /No email address/)
r = await send(t, 'u-s1', { stage: 'WELCOME', channel: 'WHATSAPP', clientEntryId: 'ce-1', body: 'Welcome!' })
assert.equal(r.body.status, 'NOT_CONFIGURED')
assert.match(r.body.message, /INTERAKT_API_KEY/)
assert.equal(t.client_messages.at(-1).status, 'NOT_CONFIGURED', 'a failed attempt is recorded too')
// sent from the sales person's own WhatsApp instead: recorded, nothing sent from here
r = await send(t, 'u-s1', { stage: 'WELCOME', channel: 'WHATSAPP', clientEntryId: 'ce-1', body: 'Welcome!', manual: true })
assert.equal(r.body.status, 'MANUAL')
assert.equal(t.client_messages.at(-1).to_addr, '9876500002')
// the team leader of the owner may send it too
t.app_users.push({ id: 'u-tl1', role: 'teamlead' })
r = await send(t, 'u-tl1', { stage: 'WELCOME', channel: 'WHATSAPP', clientEntryId: 'ce-1', body: 'Welcome!', manual: true }, { now: now + 10 * 60_000 })
assert.equal(r.body.status, 'MANUAL')

// 6) the mail server's failure is reported and recorded
t = tables()
r = await send(t, 'u-op1', { stage: 'PAYMENT_REMINDER', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Payment reminder', body: 'Please pay' }, { deliverEmail: async () => ({ success: false, configured: false, message: 'Email is not set up on the server (SMTP_USER / SMTP_PASS).' }) })
assert.equal(r.status, 503)
assert.equal(r.body.status, 'NOT_CONFIGURED')
assert.equal(t.client_messages[0].error, 'Email is not set up on the server (SMTP_USER / SMTP_PASS).')
// placeholders left in the text are refused before anything happens
r = await send(t, 'u-op1', { stage: 'GENERAL', channel: 'EMAIL', bookingId: 'bk-1', subject: 'Hello', body: 'Dear {client_name}' })
assert.equal(r.status, 422)

console.log('✓ client messages server: permissions, saved recipient, duplicates, WhatsApp template, manual sends, failures logged')
