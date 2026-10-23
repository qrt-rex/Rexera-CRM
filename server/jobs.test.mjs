// node server/jobs.test.mjs — scheduled jobs: follow-ups, Pitch Deck, scheme expiry, welcome retries; never twice
import assert from 'node:assert/strict'
import { runJobs, jobsAuthorized } from './jobs.mjs'

/** In-memory stand-in for the Supabase client: just what jobs.mjs uses (incl. JSON path filters like a->b->>c). */
function fakeSupabase(tables) {
  const t = structuredClone(tables)
  const get = (row, path) => path.split(/->>|->/).reduce((v, k) => (v == null ? undefined : v[k]), row)
  const from = (name) => {
    const rows = (t[name] ??= [])
    const filters = []
    const match = (r) => filters.every((f) => f(r))
    let patch = null, pendingUpsert = null
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push((r) => get(r, k) === v); return api },
      in: (k, vs) => { filters.push((r) => vs.includes(get(r, k))); return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      update: (p) => { patch = p; return api },
      upsert: (r, { onConflict, ignoreDuplicates }) => { pendingUpsert = { r, onConflict, ignoreDuplicates }; return api },
      insert: async (x) => { rows.push(...structuredClone(Array.isArray(x) ? x : [x])); return { error: null } },
      then: (ok) => {
        if (pendingUpsert) {
          const { r, onConflict, ignoreDuplicates } = pendingUpsert
          const i = rows.findIndex((o) => o[onConflict] === r[onConflict])
          if (i >= 0 && ignoreDuplicates) return ok({ data: [], error: null })
          if (i >= 0) rows[i] = structuredClone(r); else rows.push(structuredClone(r))
          return ok({ data: [r], error: null })
        }
        if (patch) { const hit = rows.filter(match); for (const r of hit) Object.assign(r, structuredClone(patch)); return ok({ data: hit.map((r) => ({ id: r.id })), error: null }) }
        return ok({ data: rows.filter(match), error: null })
      },
    }
    return api
  }
  return { from, t }
}

const env = (vars) => (k) => vars[k] ?? ''
const now = Date.UTC(2026, 9, 21, 5, 0) // 10:30 am IST, 21 Oct 2026
const base = {
  app_settings: [{ key: 'company', value: { name: 'Rexera' } }],
  app_users: [{ id: 'ops', name: 'Sneha', role: 'operations', active: true, phone: '9800000001', email: 'sneha@rexera.test' }, { id: 'adm', name: 'Priya', role: 'admin', active: true }, { id: 'sa', name: 'Rohan', role: 'superadmin', active: true }],
  user_extra_roles: [],
  bookings: [
    { id: 'b1', booking_code: 'RX-1', company_name: 'Asha Foods', contact_person: 'Asha', email: 'asha@foods.test', mobile: '9876500001', status: 'IN_OPERATIONS', stage: 2, service_name: 'Seed Fund', ops_member_id: 'ops', admin_id: null,
      follow_up: { everyDays: 15, startedOn: '2026-10-01', nextOn: '2026-10-16', log: [] }, admin_work: null,
      welcome: { email: { status: 'PENDING', attempts: 0 }, whatsapp: { status: 'NOT_CONFIGURED', attempts: 0 }, createdAt: '2026-10-21T04:00:00.000Z', createdBy: 'leg' } },
    { id: 'b2', booking_code: 'RX-2', company_name: 'Bina Tech', contact_person: 'Bina', email: 'bina@tech.test', mobile: '9876500002', status: 'WITH_ADMIN', stage: 3, service_name: 'PMEGP', ops_member_id: 'ops', admin_id: 'adm',
      follow_up: { everyDays: 15, startedOn: '2026-10-10', nextOn: '2026-10-25', log: [] },
      admin_work: { PRECHECK: { status: 'IN_PROGRESS', assignee: 'adm', remindEveryDays: 3, nextRemindOn: '2026-10-20', history: [], updatedAt: '', updatedBy: '' } },
      welcome: { email: { status: 'SENT', attempts: 1 }, whatsapp: { status: 'NOT_CONFIGURED', attempts: 0 }, createdAt: '2026-10-10T00:00:00.000Z', createdBy: 'leg' } },
  ],
  schemes: [{ id: 's1', title: 'Seed Fund 2026', active: true, end_date: '2026-10-22' }, { id: 's2', title: 'Later', active: true, end_date: '2026-12-31' }],
  reminder_log: [], notifications: [], audit_log: [], booking_client_emails: [],
}

const sb = fakeSupabase(base)
let sent = []
const send = async (body) => { sent.push(body); return { success: true, message: 'ok' } }
const runJobsWith = (client, e, o) => runJobs(e, { ...o, client })
let r = await runJobsWith(sb, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send, now })
assert.equal(r.ok, true)
assert.equal(r.followUps, 1, 'b1 follow-up was due on the 16th')
assert.equal(sb.t.bookings[0].follow_up.nextOn, '2026-10-31', 'next follow-up 15 days on, in the future')
assert.equal(r.precheck, 1, 'b2 pitch deck due on the 20th')
assert.equal(sb.t.bookings[1].admin_work.PRECHECK.nextRemindOn, '2026-10-23')
assert.equal(r.schemes, 1, 'scheme ending tomorrow')
assert.equal(r.welcome.sent, 1, 'queued welcome for b1 (older than 5 min) sent')
assert.equal(sb.t.bookings[0].welcome.email.status, 'SENT')
assert.equal(sent.length, 1)
assert.match(sent[0].subject, /RX-1/)
assert.equal(sb.t.booking_client_emails.length, 1)
const n1 = sb.t.notifications.length
assert.ok(sb.t.notifications.some((n) => n.user_id === 'adm' && /Pitch Deck/.test(n.title)))
assert.ok(sb.t.notifications.some((n) => n.user_id === 'ops' && /Follow-up due/.test(n.title)))
assert.equal(sb.t.app_settings.find((s) => s.key === 'jobs').value.lastRunAt, new Date(now).toISOString())

// a second run straight after does nothing again
r = await runJobsWith(sb, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send, now: now + 60_000 })
assert.deepEqual([r.followUps, r.precheck, r.schemes, r.welcome.sent], [0, 0, 0, 0])
assert.equal(sb.t.notifications.length, n1, 'no duplicate notifications')
assert.equal(sent.length, 1, 'no second welcome email')

// a failed welcome is retried after 30 minutes, at most 3 attempts
const sb2 = fakeSupabase(base)
let fail = 0
const failing = async () => { fail++; return { success: false, message: 'SMTP timed out' } }
r = await runJobsWith(sb2, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send: failing, now })
assert.equal(sb2.t.bookings[0].welcome.email.status, 'FAILED')
assert.equal(sb2.t.bookings[0].welcome.email.error, 'SMTP timed out')
r = await runJobsWith(sb2, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send: failing, now: now + 10 * 60_000 })
assert.equal(fail, 1, 'not retried before 30 minutes')
await runJobsWith(sb2, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send: failing, now: now + 31 * 60_000 })
await runJobsWith(sb2, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send: failing, now: now + 62 * 60_000 })
await runJobsWith(sb2, env({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'sb_secret_x' }), { send: failing, now: now + 93 * 60_000 })
assert.equal(fail, 3, 'stops after 3 attempts')
assert.equal(sb2.t.bookings[0].welcome.email.attempts, 3)

// the cron secret
assert.equal(jobsAuthorized(env({ JOBS_SECRET: 'a-long-enough-secret' }), 'a-long-enough-secret'), true)
assert.equal(jobsAuthorized(env({ JOBS_SECRET: 'a-long-enough-secret' }), 'wrong'), false)
assert.equal(jobsAuthorized(env({ JOBS_SECRET: 'short' }), 'short'), false, 'too short a secret is refused')
assert.equal(jobsAuthorized(env({}), ''), false, 'no secret set: closed')
console.log('✓ scheduled jobs: follow-ups, Pitch Deck, scheme expiry, welcome retries — each once')
