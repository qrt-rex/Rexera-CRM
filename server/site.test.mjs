// node server/site.test.mjs — the website's published content, the website lead log and retrying a failed enquiry
import assert from 'node:assert/strict'
import { getSiteContent } from './site.mjs'
import { receiveWebsiteLead, retryWebsiteLead } from './websiteLeads.mjs'

function fakeDb(tables, { failLeads = false } = {}) {
  const t = structuredClone(tables)
  const from = (name) => {
    const rows = (t[name] ??= [])
    const filters = []
    const match = (r) => filters.every((f) => f(r))
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push((r) => r[k] === v); return api },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return api },
      lt: (k, v) => { filters.push((r) => r[k] != null && r[k] < v); return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      then: (ok) => ok({ data: rows.filter(match), error: null }),
      insert: async (x) => {
        if (name === 'leads' && t.__failLeads) return { error: { message: 'database is read-only' } }
        rows.push(...structuredClone([x].flat())); return { error: null }
      },
      upsert: async (r, { onConflict }) => { const i = rows.findIndex((o) => o[onConflict] === r[onConflict]); if (i >= 0) rows[i] = structuredClone(r); else rows.push(structuredClone(r)); return { error: null } },
      update: (patch) => ({ eq: async (k, v) => { for (const r of rows) if (r[k] === v) Object.assign(r, patch); return { error: null } } }),
    }
    return api
  }
  if (failLeads) t.__failLeads = true
  return { from, t }
}
const env = (vars = {}) => (k) => vars[k] ?? ''

// ---------------------------------------------------------------- published content only
let sb = fakeDb({ site_content: [
  { key: 'hero', draft: { title: 'Draft headline' }, published: { title: 'Live headline' }, published_at: '2026-10-24T10:00:00Z' },
  { key: 'services', draft: [], published: [{ id: 's1', title: 'Grants', active: true }, { id: 's2', title: 'Old offer', active: false }], published_at: '2026-10-25T09:00:00Z' },
  { key: 'about', draft: { heading: 'Never published' }, published: null },
  { key: 'secret', draft: {}, published: { x: 1 } },
] })
let r = await getSiteContent(env(), { client: sb, fresh: true })
assert.equal(r.status, 200)
assert.deepEqual(r.body.content.hero, { title: 'Live headline' }, 'the website gets what is published, never the draft')
assert.deepEqual(r.body.content.services.map((s) => s.title), ['Grants'], 'items switched off are left out')
assert.equal(r.body.content.about, undefined, 'an unpublished part is not served')
assert.equal(r.body.content.secret, undefined, 'only known parts')
assert.equal(r.body.publishedAt, '2026-10-25T09:00:00Z')

// ---------------------------------------------------------------- every submission is logged
const base = { app_users: [{ id: 'sa', name: 'Owner', role: 'superadmin', active: true }], user_extra_roles: [], app_settings: [{ key: 'counters', value: { booking: 1, lead: 7, invoice: 1 } }], leads: [], notifications: [], website_lead_log: [] }
const post = (sb, body, ip) => receiveWebsiteLead(env(), { contentType: 'application/json', raw: JSON.stringify(body), ip }, sb)
sb = fakeDb(base)
r = await post(sb, { name: 'Asha', phone: '98765 43210', email: 'a@x.test', form_name: 'grant-enquiry', service: 'Seed Fund' }, '1.1.1.1')
assert.equal(r.status, 200)
assert.equal(sb.t.website_lead_log[0].status, 'SAVED'); assert.equal(sb.t.website_lead_log[0].form, 'grant-enquiry'); assert.equal(sb.t.website_lead_log[0].lead_id, sb.t.leads[0].id)
r = await post(sb, { name: 'Asha again', phone: '9876543210' }, '1.1.1.2')
assert.equal(sb.t.website_lead_log[1].status, 'EXISTING', 'same number: no duplicate lead'); assert.equal(sb.t.leads.length, 1)
r = await post(sb, { name: 'No phone', email: 'np@x.test', key: 'SHOULD-NOT-BE-KEPT' }, '1.1.1.3')
assert.equal(r.status, 422)
assert.equal(sb.t.website_lead_log[2].status, 'INVALID'); assert.equal(sb.t.website_lead_log[2].fields.key, undefined, 'the form key is never logged')
await post(sb, { name: 'Bot', phone: '9876500000', website: 'http://spam' }, '1.1.1.4')
assert.equal(sb.t.website_lead_log[3].status, 'SPAM'); assert.equal(sb.t.leads.length, 1)

// a database error: logged as FAILED (with the fields), then saved by the Super Admin
sb = fakeDb(base, { failLeads: true })
await assert.rejects(() => post(sb, { name: 'Ravi', phone: '9825011111', company: 'Ravi Foods' }, '1.1.1.5'))
const failed = sb.t.website_lead_log[0]
assert.equal(failed.status, 'FAILED'); assert.match(failed.error, /read-only/); assert.equal(failed.fields.company, 'Ravi Foods')
delete sb.t.__failLeads
r = await retryWebsiteLead(sb, { id: 'ops', roles: ['operations'] }, { id: failed.id })
assert.equal(r.status, 403, 'only the Super Admin retries')
r = await retryWebsiteLead(sb, { id: 'sa', roles: ['superadmin'] }, { id: failed.id })
assert.equal(r.status, 200)
assert.equal(sb.t.leads[0].phone, '9825011111'); assert.equal(sb.t.website_lead_log[0].status, 'SAVED'); assert.equal(sb.t.website_lead_log[0].retried_by, 'sa')
r = await retryWebsiteLead(sb, { id: 'sa', roles: ['superadmin'] }, { id: failed.id })
assert.equal(r.status, 409, 'not saved twice')
// a submission without a mobile can be saved once the number is known
sb = fakeDb(base)
await post(sb, { name: 'Meena', email: 'm@x.test' }, '1.1.1.6')
r = await retryWebsiteLead(sb, { id: 'sa', roles: ['superadmin'] }, { id: sb.t.website_lead_log[0].id, phone: '9898989898' })
assert.equal(r.status, 200); assert.equal(sb.t.leads[0].name, 'Meena')
console.log('✓ website: published content only, every form submission logged, failed / phone-less ones saved later')
