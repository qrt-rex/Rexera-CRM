// node server/websiteLeads.test.mjs — website enquiry form → CRM lead
import assert from 'node:assert/strict'
import { normMobile, parseEnquiry, receiveWebsiteLead, saveLead, WEBSITE_SOURCE } from './websiteLeads.mjs'

// ---------------------------------------------------------------- reading the form
assert.equal(normMobile('+91 98250 12345'), '9825012345')
assert.equal(normMobile('09825012345'), '9825012345')
assert.equal(normMobile('12345'), '')
const cf7 = parseEnquiry('application/x-www-form-urlencoded', 'your-name=Asha+Patel&your-phone=%2B91-98765-43210&your-email=Asha%40Mail.com&your-subject=Seed+Fund&your-message=Need+funding&utm_source=google')
assert.equal(cf7.lead.name, 'Asha Patel')
assert.equal(cf7.lead.phone, '9876543210')
assert.equal(cf7.lead.email, 'asha@mail.com')
assert.equal(cf7.lead.service, 'Seed Fund')
assert.equal(cf7.lead.message, 'Need funding')
assert.deepEqual(cf7.lead.extra, { utm_source: 'google' }, 'unknown fields are kept')
const json = parseEnquiry('application/json', JSON.stringify({ fields: { name: { value: 'Ravi' }, mobile: '9825011111' }, website: '' }))
assert.equal(json.lead.name, 'Ravi', 'Elementor-style nested fields')
assert.equal(json.lead.spam, false)
assert.equal(parseEnquiry('application/json', '{"name":"x","phone":"9825011111","website":"http://spam"}').lead.spam, true, 'honeypot')
assert.equal(parseEnquiry('application/json', '{bad').error, 'Bad JSON')

// ---------------------------------------------------------------- a tiny in-memory Supabase
function fakeDb(tables) {
  const t = structuredClone(tables)
  const from = (name) => {
    const rows = (t[name] ??= [])
    const q = { filters: [] }
    const match = (r) => q.filters.every((f) => f(r))
    const api = {
      select: () => api,
      eq: (k, v) => { q.filters.push((r) => r[k] === v); return api },
      in: (k, vs) => { q.filters.push((r) => vs.includes(r[k])); return api },
      lt: (k, v) => { q.filters.push((r) => r[k] != null && r[k] < v); return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      then: (ok) => ok({ data: rows.filter(match), error: null }),
      insert: async (x) => {
        const list = Array.isArray(x) ? x : [x]
        for (const r of list) if (name === 'leads' && rows.some((o) => o.phone === r.phone)) return { error: { message: 'duplicate key value violates unique constraint "leads_phone_key"' } }
        rows.push(...structuredClone(list)); return { error: null }
      },
      upsert: async (r, { onConflict }) => { const i = rows.findIndex((o) => o[onConflict] === r[onConflict]); if (i >= 0) rows[i] = structuredClone(r); else rows.push(structuredClone(r)); return { error: null } },
      update: (patch) => ({ eq: async (k, v) => { for (const r of rows) if (r[k] === v) Object.assign(r, patch); return { error: null } } }),
    }
    return api
  }
  return { from, t }
}

const now = new Date('2026-10-19T10:00:00Z') // 3:30 pm IST
const yesterday = '2026-10-18T06:00:00.000Z'
const base = {
  app_users: [
    { id: 'sa', name: 'Owner', role: 'superadmin', active: true },
    { id: 'a', name: 'Anil', role: 'sales', active: true },
    { id: 'b', name: 'Bina', role: 'sales', active: true },
    { id: 'c', name: 'Chetan', role: 'sales', active: true },
  ],
  user_extra_roles: [],
  app_settings: [{ key: 'counters', value: { booking: 1, lead: 41, invoice: 1 } }, { key: 'leadAssign', value: { on: true, userIds: ['a', 'b', 'c'], next: 1 } }],
  leads: [{ id: 'old-1', name: 'Stale', phone: '9000000001', status: 'NEW', assigned_to: 'c', assigned_at: yesterday, history: [] }],
  notifications: [],
}

// round robin starts at `next` (Bina); Chetan is skipped (a "New" lead from yesterday), so it wraps to Anil
let db = fakeDb(base)
const one = { name: 'Asha', phone: '9876543210', email: '', company: 'Asha Foods', city: 'Surat', state: '', service: 'Seed Fund', requirement: '', message: 'hi', page: '/contact', extra: {} }
let r = await saveLead(db, one, now)
assert.equal(r.owner, 'b')
r = await saveLead(db, { ...one, phone: '9876543211' }, now)
assert.equal(r.owner, 'a', 'Chetan has an overdue lead, so the turn goes back to the first person')
const lead = db.t.leads.find((l) => l.phone === '9876543210')
assert.equal(lead.source, WEBSITE_SOURCE)
assert.equal(lead.code, 'LD-41')
assert.equal(db.t.leads.find((l) => l.phone === '9876543211').code, 'LD-42')
assert.equal(lead.chain[0].to, 'b')
assert.equal(db.t.app_settings.find((s) => s.key === 'leadAssign').value.next, 1, 'pointer moves past the last person given a lead')
assert.ok(db.t.notifications.some((n) => n.user_id === 'sa' && n.title === 'New website enquiry'))
assert.ok(db.t.notifications.some((n) => n.user_id === 'b' && n.link === '/dialer'))

// the same number again: no second lead, a note on the existing one
r = await saveLead(db, { ...one, message: 'second visit' }, now)
assert.equal(r.existing, true)
assert.equal(db.t.leads.filter((l) => l.phone === '9876543210').length, 1)
assert.match(db.t.leads.find((l) => l.phone === '9876543210').notes, /second visit/)

// auto-assign off: the lead waits unassigned
db = fakeDb({ ...base, app_settings: [{ key: 'counters', value: { booking: 1, lead: 1, invoice: 1 } }] })
r = await saveLead(db, one, now)
assert.equal(r.owner, undefined)
assert.equal(db.t.leads.find((l) => l.phone === one.phone).assigned_to, undefined)

// ---------------------------------------------------------------- the endpoint's checks (before any database work)
const env = (vars) => (k) => vars[k] ?? ''
r = await receiveWebsiteLead(env({ WEBSITE_LEAD_KEY: 's3cret' }), { contentType: 'application/json', raw: JSON.stringify({ name: 'X', phone: '9825011111' }), ip: '1.1.1.1' })
assert.equal(r.status, 401, 'form key required when set')
r = await receiveWebsiteLead(env({}), { contentType: 'application/json', raw: JSON.stringify({ name: 'X', phone: '123' }), ip: '1.1.1.2' })
assert.equal(r.status, 422, 'a bad mobile number is refused')
r = await receiveWebsiteLead(env({}), { contentType: 'application/json', raw: JSON.stringify({ name: 'X', phone: '9825011111', website: 'spam' }), ip: '1.1.1.3' })
assert.equal(r.status, 200, 'bots get a normal answer')
r = await receiveWebsiteLead(env({}), { contentType: 'application/json', raw: JSON.stringify({ name: 'X', phone: '9825011111' }), ip: '1.1.1.4' })
assert.equal(r.status, 503, 'no Supabase: says so')
for (let i = 0; i < 21; i++) r = await receiveWebsiteLead(env({}), { contentType: 'application/json', raw: '{"phone":"9825011111"}', ip: '9.9.9.9' })
assert.equal(r.status, 429, 'rate limited')

console.log('✓ website leads: form fields, round robin, repeats, key, spam and rate limits')
