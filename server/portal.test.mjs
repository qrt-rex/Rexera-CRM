// node server/portal.test.mjs — the client portal: Super Admin access management, and that a client sees and changes
// only their own entries (never another client's, never internal notes)
import assert from 'node:assert/strict'
import { portalAdmin, portalClient } from './portal.mjs'
import { docStatus, projectProgress, reviewSteps } from '../supabase/portal-rules.mjs'

// ---------------------------------------------------------------- shared rules
const item = (status, statusAt) => ({ status, statusAt, assignedAt: '2026-10-01T00:00:00.000Z', assignedBy: 'ops', history: [] })
assert.equal(docStatus(item('ASSIGNED', '2026-10-01T00:00:00.000Z'), [], 'DPR'), 'PENDING_UPLOAD')
assert.equal(docStatus(item('ASSIGNED', '2026-10-01T00:00:00.000Z'), [{ category: 'DPR', at: '2026-10-02T00:00:00.000Z' }], 'DPR'), 'SUBMITTED', 'an upload makes it submitted, never approved')
assert.equal(docStatus(item('REJECTED', '2026-10-03T00:00:00.000Z'), [{ category: 'DPR', at: '2026-10-02T00:00:00.000Z' }], 'DPR'), 'RESUBMISSION', 'an upload from before the rejection does not count')
assert.equal(docStatus(item('REJECTED', '2026-10-03T00:00:00.000Z'), [{ category: 'DPR', at: '2026-10-04T00:00:00.000Z' }], 'DPR'), 'SUBMITTED')
assert.equal(docStatus({ ...item('ASSIGNED', 'x'), removed: true }, [], 'DPR'), null)
assert.deepEqual(reviewSteps('SUBMITTED'), ['START']); assert.deepEqual(reviewSteps('UNDER_REVIEW'), ['APPROVE', 'REJECT']); assert.deepEqual(reviewSteps('PENDING_UPLOAD'), [])
assert.equal(projectProgress([]), null)
assert.equal(projectProgress([{ status: 'DONE', visible: true }, { status: 'PENDING', visible: true, tasks: [{ done: true }, { done: false }] }, { status: 'PENDING', visible: false }]), 50)
assert.equal(projectProgress([{ status: 'DONE', visible: true }, { status: 'PENDING', visible: true, tasks: [{ done: true }, { done: false }] }, { status: 'PENDING', visible: false }], true), 75, 'the client sees progress of the milestones shown to them')

// ---------------------------------------------------------------- fake Supabase
function fakeSb(tables, users) {
  const t = structuredClone(tables)
  const calls = { links: [], bans: [], revoked: [], uploads: [], deleted: [] }
  const from = (name) => {
    const rows = (t[name] ??= [])
    const filters = []
    const match = (r) => filters.every((f) => f(r))
    const pickCols = (r) => r
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push((r) => r[k] === v); return api },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return api },
      maybeSingle: async () => ({ data: structuredClone(rows.find(match) ?? null), error: null }),
      then: (ok, bad) => Promise.resolve({ data: structuredClone(rows.filter(match).map(pickCols)), error: null }).then(ok, bad),
      insert: (x) => {
        const list = structuredClone([x].flat())
        if (name === 'client_accounts' && list.some((a) => t.client_accounts.some((o) => o.email === a.email))) return Promise.resolve({ error: { message: 'duplicate key' } })
        rows.push(...list)
        return { then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad) }
      },
      update: (patch) => ({ eq: (k, v) => Promise.resolve((() => { for (const r of rows) if (r[k] === v) Object.assign(r, structuredClone(patch)); return { error: null } })()) }),
    }
    return api
  }
  const auth = {
    getUser: async (token) => ({ data: { user: users[token] ?? null } }),
    admin: {
      generateLink: async ({ type, email, options }) => { calls.links.push({ type, email, redirectTo: options.redirectTo }); return { data: { user: { id: `auth-${email}` }, properties: { action_link: `https://x.supabase.co/verify?type=${type}&t=secret` } }, error: null } },
      updateUserById: async (id, patch) => { calls.bans.push({ id, ...patch }); return { error: null } },
      deleteUser: async (id) => { calls.deleted.push(id); return { error: null } },
    },
  }
  const storage = { from: () => ({
    upload: async (id) => { calls.uploads.push(id); return { error: null } },
    createSignedUrl: async (id) => ({ data: { signedUrl: `https://files/${id}?sig` }, error: null }),
    remove: async () => ({ error: null }),
  }) }
  const rpc = async (fn, args) => { calls.revoked.push(args.uid); return { error: null } }
  return { from, auth, storage, rpc, t, calls }
}
const env = () => ''
const mails = []
const deps = (sb) => ({ client: sb, now: new Date('2026-10-25T10:00:00.000Z'), appUrl: 'https://crm.test', sendEmail: async (m, extra) => { mails.push({ ...m, button: extra?.button }); return { success: true } } })

const docs = {
  DPR: { status: 'ASSIGNED', statusAt: '2026-10-20T00:00:00.000Z', assignedAt: '2026-10-20T00:00:00.000Z', assignedBy: 'ops', assignee: 'adm', internalNote: 'SECRET-INTERNAL note', history: [{ at: '2026-10-20T00:00:00.000Z', by: 'ops', action: 'Asked for', client: true }, { at: '2026-10-20T00:00:00.000Z', by: 'ops', action: 'STAFF-ONLY step' }] },
  FINANCE: { status: 'UNDER_REVIEW', statusAt: '2026-10-22T00:00:00.000Z', assignedAt: '2026-10-19T00:00:00.000Z', assignedBy: 'ops', history: [] },
}
const sb = fakeSb({
  app_users: [{ id: 'sa', name: 'Owner', role: 'superadmin', active: true, email: 'owner@rexera.test' }, { id: 'ops', name: 'Priya Ops', role: 'operations', active: true, email: 'priya@rexera.test', phone: '9000000001' }, { id: 'adm', name: 'Admin', role: 'admin', active: true }],
  user_permission_overrides: [], role_permissions: [],
  bookings: [
    { id: 'b1', booking_code: 'RX-1', company_name: 'Asha Foods', contact_person: 'Asha', email: 'asha@client.test', payment_email: null, mobile: '9876543210', ops_member_id: 'ops', client_docs: docs,
      milestones: [{ id: 'm1', title: 'Kick-off', status: 'DONE', visible: true }, { id: 'm2', title: 'DPR ready', status: 'IN_PROGRESS', visible: true, tasks: [{ id: 't', title: 'x', done: true }, { id: 'u', title: 'y', done: false }] }, { id: 'm3', title: 'INTERNAL milestone', status: 'PENDING', visible: false }],
      client_updates: [{ id: 'cu1', at: '2026-10-24T00:00:00.000Z', by: 'ops', title: 'Bank call done', text: 'All good', file: { id: 'file-update0001', name: 'minutes.pdf', type: 'application/pdf', size: 10, at: '2026-10-24T00:00:00.000Z' } }] },
    { id: 'b2', booking_code: 'RX-2', company_name: 'Ravi Steel', contact_person: 'Ravi', email: 'ravi@client.test', mobile: '9825011111', ops_member_id: 'ops', client_docs: { DPR: { ...docs.DPR, internalNote: 'RAVI-PRIVATE' } }, milestones: [], client_updates: [] },
  ],
  client_accounts: [], client_activity: [], client_doc_uploads: [{ id: 'cu-ravi000000001', booking_id: 'b2', category: 'DPR', file: { id: 'file-ravi000001', name: 'ravi-dpr.pdf', type: 'application/pdf', size: 9, at: '2026-10-21T00:00:00.000Z' }, at: '2026-10-21T00:00:00.000Z', account_id: 'other' }],
  notifications: [], audit_log: [],
  media_items: [
    { id: 'med-all', title: 'Seed Fund flyer', description: 'For every client', scheme_name: 'Seed Fund', media_type: 'FLYER', files: [{ id: 'media-flyer00001', name: 'flyer.png', type: 'image/png', size: 9 }], internal: true, external: true, submitted: true, submitted_at: '2026-10-24T00:00:00.000Z', client_booking_ids: [], notes: 'COMPANY-NOTE price may change' },
    { id: 'med-ravi', title: 'RAVI-ONLY poster', scheme_name: 'PMEGP', media_type: 'POSTER', files: [{ id: 'media-ravi000001', name: 'ravi.pdf', type: 'application/pdf', size: 9 }], internal: false, external: true, submitted: true, submitted_at: '2026-10-24T00:00:00.000Z', client_booking_ids: ['b2'] },
    { id: 'med-int', title: 'INTERNAL-ONLY deck', scheme_name: 'Seed Fund', media_type: 'PDF', files: [{ id: 'media-int0000001', name: 'int.pdf', type: 'application/pdf', size: 9 }], internal: true, external: false, submitted: true, submitted_at: '2026-10-24T00:00:00.000Z', client_booking_ids: [] },
    { id: 'med-draft', title: 'DRAFT-NOT-PUBLISHED', scheme_name: 'Seed Fund', media_type: 'POST', files: [{ id: 'media-draft00001', name: 'd.png', type: 'image/png', size: 9 }], internal: true, external: true, submitted: false, client_booking_ids: [] },
  ],
}, {
  'tok-sa': { id: 'auth-sa' }, 'tok-ops': { id: 'auth-ops' }, 'tok-asha': { id: 'auth-asha@client.test' }, 'tok-ravi': { id: 'auth-ravi@client.test' },
})
const SA = { id: 'sa', email: 'owner@rexera.test', roles: ['superadmin'] }, OPS = { id: 'ops', email: 'priya@rexera.test', roles: ['operations'] }
const admin = (who, action, body) => portalAdmin(env, who, action, body, deps(sb))
const client = (tok, action, body = {}) => portalClient(env, `Bearer ${tok}`, action, body, '1.2.3.4', deps(sb))

// ---------------------------------------------------------------- Super Admin: invite, no duplicates
let r = await admin(OPS, 'invite', { email: 'asha@client.test', bookingIds: ['b1'] })
assert.equal(r.status, 403, 'only the Super Admin (portal.manage) manages access')
r = await admin(null, 'invite', {})
assert.equal(r.status, 401)
r = await admin(SA, 'invite', { email: 'someone@else.test', bookingIds: ['b1'] })
assert.equal(r.status, 409); assert.equal(r.body.code, 'EMAIL_MISMATCH', 'the email must be the one on the CRM entry')
r = await admin(SA, 'invite', { email: 'priya@rexera.test', bookingIds: ['b1'], override: true })
assert.equal(r.status, 409, 'a staff login email is refused')
r = await admin(SA, 'invite', { email: ' Asha@Client.test ', bookingIds: ['b1'] })
assert.equal(r.status, 200, r.body.message)
const asha = sb.t.client_accounts[0]
assert.equal(asha.email, 'asha@client.test'); assert.equal(asha.status, 'INVITED'); assert.equal(asha.assigned_to, 'ops'); assert.equal(asha.auth_user_id, 'auth-asha@client.test')
assert.equal(sb.calls.links[0].redirectTo, 'https://crm.test/portal/welcome')
assert.match(mails[0].button.url, /verify\?type=invite/); assert.equal(mails[0].to, 'asha@client.test')
assert.ok(!JSON.stringify(r.body).includes('secret'), 'the sign-in link never goes back to the browser')
r = await admin(SA, 'invite', { email: 'asha@client.test', bookingIds: ['b2'], override: true })
assert.equal(r.body.code, 'EXISTS', 'one account per email')
r = await admin(SA, 'invite', { email: 'other@client.test', bookingIds: ['b1'], override: true })
assert.equal(r.body.code, 'TAKEN', 'a CRM entry belongs to one account')
r = await admin(SA, 'invite', { email: 'ravi@client.test', bookingIds: ['b2'] })
assert.equal(r.status, 200)
const ravi = sb.t.client_accounts[1]

// ---------------------------------------------------------------- the client: own data only
r = await client('tok-ops', 'me')
assert.equal(r.status, 403, 'a staff sign-in is not a client')
r = await client('nope', 'me')
assert.equal(r.status, 401)
r = await client('tok-asha', 'session')
assert.equal(sb.t.client_accounts[0].status, 'ACTIVE', 'setting the password activates the account')
r = await client('tok-asha', 'me')
assert.equal(r.status, 200)
const view = JSON.stringify(r.body)
assert.deepEqual(r.body.projects.map((p) => p.code), ['RX-1'], 'only the client’s own entries')
assert.ok(!view.includes('Ravi') && !view.includes('RAVI-PRIVATE') && !view.includes('ravi-dpr'), 'nothing of another client')
assert.ok(!view.includes('SECRET-INTERNAL') && !view.includes('STAFF-ONLY') && !view.includes('INTERNAL milestone'), 'no internal notes, staff history or hidden milestones')
const p1 = r.body.projects[0]
assert.equal(p1.progress, 75); assert.deepEqual(p1.milestones.map((m) => m.title), ['Kick-off', 'DPR ready'])
assert.deepEqual(p1.docs.map((d) => [d.category, d.status, d.canUpload]), [['FINANCE', 'UNDER_REVIEW', false], ['DPR', 'PENDING_UPLOAD', true]])
assert.equal(p1.contact.name, 'Priya Ops')
// Digital Media: published external media meant for this client only; no company notes, internal media or drafts
assert.deepEqual(r.body.media.map((m) => m.title), ['Seed Fund flyer'])
assert.ok(!view.includes('COMPANY-NOTE') && !view.includes('RAVI-ONLY') && !view.includes('INTERNAL-ONLY') && !view.includes('DRAFT-NOT-PUBLISHED'), 'only external, published media meant for them')
assert.equal((await client('tok-asha', 'file', { id: 'media-flyer00001' })).status, 200, 'their media file opens')
assert.equal((await client('tok-asha', 'file', { id: 'media-ravi000001' })).status, 404, 'media meant for another client does not')
assert.equal((await client('tok-asha', 'file', { id: 'media-int0000001' })).status, 404, 'internal media never reaches a client')
assert.ok(r.body.notices.some((n) => /upload your DPR/.test(n.text)))

const pdf = Buffer.from('%PDF-1.4 portal test').toString('base64')
const up = (tok, bookingId, category, uploadId, file = { name: 'dpr.pdf', type: 'application/pdf', data: pdf }) => client(tok, 'upload', { bookingId, category, uploadId, file })
r = await up('tok-asha', 'b2', 'DPR', 'cu-asha00000001')
assert.equal(r.status, 404, 'cannot upload into another client’s entry')
r = await up('tok-asha', 'b1', 'CERTIFICATION', 'cu-asha00000002')
assert.equal(r.status, 404, 'only documents the team asked for')
r = await up('tok-asha', 'b1', 'FINANCE', 'cu-asha00000003')
assert.equal(r.status, 409, 'not while it is under review')
r = await up('tok-asha', 'b1', 'DPR', 'cu-asha00000004', { name: 'evil.pdf', type: 'application/pdf', data: Buffer.from('MZ not a pdf').toString('base64') })
assert.equal(r.status, 422, 'the file content is checked')
r = await up('tok-asha', 'b1', 'DPR', 'cu-asha00000005')
assert.equal(r.status, 200, r.body.message); assert.equal(r.body.status, 'SUBMITTED')
assert.equal(sb.t.bookings[0].client_docs.DPR.status, 'ASSIGNED', 'uploading never changes (or approves) the stored status')
assert.ok(sb.t.notifications.some((n) => n.user_id === 'ops' && /Client uploaded: DPR/.test(n.title)))
r = await up('tok-asha', 'b1', 'DPR', 'cu-asha00000005')
assert.equal(r.body.duplicate, true, 'the same upload sent twice is stored once')
assert.equal(sb.t.client_doc_uploads.filter((u) => u.booking_id === 'b1').length, 1)
r = await up('tok-ravi', 'b2', 'DPR', 'cu-asha00000005')
assert.equal(r.status, 409, 'another client cannot reuse an upload id')
r = await client('tok-asha', 'me')
assert.equal(r.body.projects[0].docs.find((d) => d.category === 'DPR').status, 'SUBMITTED')

const mine = sb.t.client_doc_uploads.find((u) => u.booking_id === 'b1').file.id
r = await client('tok-asha', 'file', { id: mine })
assert.equal(r.status, 200); assert.match(r.body.url, /^https:\/\/files\//)
r = await client('tok-asha', 'file', { id: 'file-update0001' })
assert.equal(r.status, 200, 'files in updates to the client')
r = await client('tok-asha', 'file', { id: 'file-ravi000001' })
assert.equal(r.status, 404, 'never another client’s file')

r = await client('tok-asha', 'profile', { name: 'Asha Patel', phone: '98765 43210', message: 'Please call me' })
assert.equal(r.status, 200); assert.equal(sb.t.client_accounts[0].name, 'Asha Patel')
assert.ok(sb.t.notifications.some((n) => /Message from client/.test(n.title)))
r = await client('tok-asha', 'profile', { name: 'A' })
assert.equal(r.status, 422)

// ---------------------------------------------------------------- deactivate / approve / sign out everywhere
r = await admin(SA, 'status', { accountId: asha.id, active: false })
assert.equal(r.status, 200)
assert.equal(sb.calls.bans.at(-1).ban_duration, '876000h'); assert.ok(sb.calls.revoked.includes('auth-asha@client.test'))
r = await client('tok-asha', 'me')
assert.equal(r.status, 403, 'a deactivated client is refused at once, even with a live session')
r = await admin(SA, 'send-link', { accountId: asha.id })
assert.equal(r.status, 409)
r = await admin(SA, 'status', { accountId: asha.id, active: true })
assert.equal(r.body.status, 'ACTIVE')
r = await client('tok-asha', 'me')
assert.equal(r.status, 200)
r = await admin(SA, 'send-link', { accountId: asha.id })
assert.equal(r.status, 200); assert.equal(sb.calls.links.at(-1).type, 'recovery', 'an active account gets a reset link')
r = await admin(SA, 'revoke', { accountId: asha.id })
assert.equal(r.status, 200)

// linking: no entry in two accounts; new entries need the matching email (or a confirmation)
r = await admin(SA, 'link', { accountId: ravi.id, bookingIds: ['b2', 'b1'] })
assert.equal(r.body.code, 'TAKEN')
r = await admin(SA, 'assign', { accountId: ravi.id, userId: 'adm' })
assert.equal(r.status, 200); assert.equal(sb.t.client_accounts[1].assigned_to, 'adm')
assert.ok(sb.t.client_activity.filter((a) => a.account_id === asha.id).length >= 5, 'every step is in the activity log')
assert.ok(sb.t.audit_log.some((a) => a.action === 'PORTAL_DEACTIVATE'))

// forgot password: the same answer whether or not the email has an account
const before = mails.length
r = await client('', 'forgot', { email: 'nobody@x.test' })
assert.equal(r.status, 200); assert.equal(mails.length, before)
r = await client('', 'forgot', { email: 'asha@client.test' })
assert.equal(r.status, 200); assert.equal(mails.length, before + 1)
console.log('✓ client portal: invites without duplicates, own data only, no internal notes, uploads reviewed (never auto-approved), access control')
