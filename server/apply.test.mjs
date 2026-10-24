// node server/apply.test.mjs — public job applications on the live server: checks, resume contents, duplicates, HR told
import assert from 'node:assert/strict'
import { submitJobApplication } from './apply.mjs'

function fake(tables, files) {
  const t = structuredClone(tables), removed = []
  const from = (name) => {
    const rows = (t[name] ??= []), filters = []
    const match = (r) => filters.every((f) => f(r))
    let insertErr = null
    const api = {
      select: () => api, eq: (k, v) => { filters.push((r) => r[k] === v); return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      insert: async (x) => {
        // a database without the branch column yet
        if (name === 'candidate_applications' && t.__noBranch && [x].flat().some((r) => 'branch' in r)) return { error: { message: "Could not find the 'branch' column of 'candidate_applications'" } }
        rows.push(...structuredClone([x].flat())); return { error: insertErr }
      },
      then: (ok) => ok({ data: rows.filter(match), error: null }),
    }
    return api
  }
  const storage = { from: () => ({
    download: async (id) => (files[id] ? { data: new Blob([files[id]]), error: null } : { data: null, error: { message: 'Object not found' } }),
    remove: async (ids) => { removed.push(...ids); return { error: null } },
  }) }
  return { from, storage, t, removed }
}
const env = () => ''
const pdf = Buffer.from('%PDF-1.7\n…cv…'), exe = Buffer.from('MZ\x90\x00 not a cv')
const base = {
  candidate_forms: [{ id: 'cf1', token: 'tok-job-1', title: 'BDE', active: true }, { id: 'cf2', token: 'tok-closed', title: 'Old', active: false },
    { id: 'cf3', token: 'tok-sales-only', title: 'Sales', active: true, positions: ['BDM (Business Development Manager)', 'Tele-sales Executive'] }],
  candidate_applications: [], notifications: [],
  app_users: [{ id: 'hr1', role: 'hr', active: true }, { id: 'sa', role: 'superadmin', active: true }, { id: 'hr-old', role: 'hr', active: false }],
  user_extra_roles: [],
}
const files = { 'file-cv1k2m3n4': pdf, 'file-bad1x2y3z': exe }
const app = {
  name: 'Asha Patel', email: 'Asha@Example.test', phone: '+91 98765 43210', city: 'Ahmedabad', qualification: 'MBA', experience: '1–3 years', branch: 'Vadodara',
  position: 'BDE (Business Development Executive)', candidateType: 'EXPERIENCED', currentCtc: '3,60,000', interviewAt: '2099-01-15T11:30', linkedin: '',
}
const body = (x = {}) => JSON.stringify({ application: { ...app, ...x.application }, resume: { id: 'file-cv1k2m3n4', name: 'cv.pdf', type: 'application/pdf', size: 10, at: '2026-10-24T05:00:00.000Z', ...x.resume } })
let ip = 0
const send = (sb, token, raw) => submitJobApplication(env, token, raw, `10.0.0.${++ip}`, sb)

let sb = fake(base, files)
assert.equal((await send(sb, 'tok-nope', body())).status, 404)
assert.equal((await send(sb, 'tok-closed', body())).status, 410, 'closed form')
let r = await send(sb, 'tok-job-1', body({ application: { branch: 'Mumbai' } }))
assert.equal(r.status, 422); assert.equal(r.body.errors.branch, 'Choose the branch you are applying for.')
r = await send(sb, 'tok-job-1', body({ application: { position: ' ', candidateType: 'BOSS', interviewAt: '2020-01-01T10:00', linkedin: 'javascript:alert(1)' } }))
assert.deepEqual(Object.keys(r.body.errors).sort(), ['candidateType', 'interviewAt', 'linkedin', 'position'], 'position, type, a past interview slot and a non-web link are refused')
r = await send(sb, 'tok-job-1', body({ application: { currentCtc: '' } }))
assert.equal(r.body.errors.currentCtc, 'Enter your current CTC.', 'experienced: current CTC needed')
r = await send(sb, 'tok-job-1', body({ resume: { id: 'file-bad1x2y3z' } }))
assert.equal(r.status, 422, 'a renamed program is not a resume'); assert.deepEqual(sb.removed, ['file-bad1x2y3z'])
assert.equal((await send(sb, 'tok-job-1', body({ resume: { id: 'file-missing9q' } }))).status, 422, 'resume not uploaded')
r = await send(sb, 'tok-job-1', body())
assert.equal(r.status, 200)
const row = sb.t.candidate_applications[0]
assert.equal(row.email, 'asha@example.test'); assert.equal(row.phone, '9876543210'); assert.equal(row.branch, 'Vadodara')
assert.equal(row.status, 'NEW'); assert.equal(row.linkedin, null, 'optional link left empty')
assert.equal(row.position, 'BDE (Business Development Executive)'); assert.equal(row.candidate_type, 'EXPERIENCED'); assert.equal(row.current_ctc, '3,60,000'); assert.equal(row.interview_at, '2099-01-15T11:30')
assert.equal(row.resume.type, 'application/pdf'); assert.equal(row.resume.size, pdf.length)
assert.deepEqual(sb.t.notifications.map((n) => n.user_id), ['hr1'], 'active HR told')
assert.match(sb.t.notifications[0].body, /Employee \(experienced\) · interview 2099-01-15 11:30/)
assert.equal((await send(sb, 'tok-job-1', body())).status, 409, 'same email twice')
// a fresher: CTC is optional — kept when given, empty when not
r = await send(sb, 'tok-job-1', body({ application: { email: 'ravi@example.test', candidateType: 'FRESHER', currentCtc: '', experience: 'Fresher' } }))
assert.equal(r.status, 200); assert.equal(sb.t.candidate_applications.at(-1).current_ctc, null)
r = await send(sb, 'tok-job-1', body({ application: { email: 'meena@example.test', candidateType: 'INTERNSHIP', currentCtc: '8,000 stipend', experience: 'Internship' } }))
assert.equal(r.status, 200); assert.equal(sb.t.candidate_applications.at(-1).current_ctc, '8,000 stipend')
r = await send(sb, 'tok-job-1', body({ application: { email: 'x@example.test', position: 'CEO' } }))
assert.equal(r.body.errors.position, 'Choose the position you are applying for.', 'only positions from the list')
// a form with ticked positions takes only those
r = await send(sb, 'tok-sales-only', body({ application: { email: 'y@example.test' } }))
assert.equal(r.body.errors.position, 'Choose the position you are applying for.', 'BDE is not on this form')
r = await send(sb, 'tok-sales-only', body({ application: { email: 'y@example.test', position: 'Tele-sales Executive' } }))
assert.equal(r.status, 200)

// the new columns aren't in the database yet: the application is still saved, those answers in the message
sb = fake({ ...base, __noBranch: true }, files)
assert.equal((await send(sb, 'tok-job-1', body())).status, 200)
assert.match(sb.t.candidate_applications[0].message, /^Branch: Vadodara\nPosition: BDE \(Business Development Executive\)\nApplying as: Employee \(experienced\)\nPreferred interview: 2099-01-15T11:30\nCurrent CTC: 3,60,000/)
console.log('✓ job applications: form open, answers, branch, position, interview slot, CTC, resume contents, duplicates, HR told')
