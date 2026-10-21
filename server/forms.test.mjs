// node server/forms.test.mjs — public client forms: link checks, mobile check, answers, file contents, storage
import assert from 'node:assert/strict'
import { getPublicForm, submitPublicForm } from './forms.mjs'
import { checkAnswers, fileProblem, formProblems, sniffType } from '../supabase/form-rules.mjs'

// ---------------------------------------------------------------- rules
const pdf = Buffer.from('%PDF-1.7\n…'), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), exe = Buffer.from('MZ\x90\x00')
assert.equal(sniffType(pdf), 'application/pdf')
assert.equal(fileProblem('a.pdf', 'application/pdf', pdf.length, pdf), null)
assert.match(fileProblem('virus.pdf', 'application/pdf', exe.length, exe), /doesn't look like/, 'a renamed program is refused')
assert.match(fileProblem('a.exe', 'application/x-msdownload', 4, exe), /isn't allowed/)
assert.match(fileProblem('big.png', 'image/png', 6 * 1024 * 1024, png), /larger than 5 MB/)
const fields = [
  { id: 'n', label: 'Name', type: 'text', required: true }, { id: 'e', label: 'Email', type: 'email', required: false },
  { id: 'p', label: 'Mobile', type: 'phone', required: true }, { id: 's', label: 'Type', type: 'select', required: true, options: ['Pvt Ltd', 'LLP'] },
  { id: 'c', label: 'I agree', type: 'checkbox', required: true }, { id: 'f', label: 'PAN', type: 'file', required: true },
]
let r = checkAnswers(fields, { n: ' Asha ', e: 'bad', p: '+91 98765 43210', s: 'Other', c: false }, [])
assert.deepEqual(Object.keys(r.errors).sort(), ['c', 'e', 'f', 's'])
r = checkAnswers(fields, { n: ' Asha ', p: '+91 98765 43210', s: 'LLP', c: 'on' }, [{ fieldId: 'f', size: 10 }])
assert.deepEqual(r.errors, {})
assert.deepEqual(r.clean, { n: 'Asha', p: '9876543210', s: 'LLP', c: true })
assert.deepEqual(formProblems({ name: '', kind: 'ONLINE', fields: [] }), ['Give the form a name.', 'Add at least one field.'])
assert.match(formProblems({ name: 'x', kind: 'ONLINE', fields: [{ id: 'a', label: 'T', type: 'select', required: false, options: [] }] })[0], /at least one choice/)

// ---------------------------------------------------------------- a tiny Supabase (tables + storage)
function fake(tables) {
  const t = structuredClone(tables), stored = new Map(), removed = []
  const from = (name) => {
    const rows = (t[name] ??= []), filters = []
    let patch = null
    const match = (r) => filters.every((f) => f(r))
    const api = {
      select: () => api, eq: (k, v) => { filters.push((r) => r[k] === v); return api },
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      update: (p) => { patch = p; return api },
      insert: async (x) => { rows.push(...structuredClone(Array.isArray(x) ? x : [x])); return { error: null } },
      then: (ok) => { if (patch) for (const r of rows.filter(match)) Object.assign(r, patch); return ok({ data: rows.filter(match), error: null }) },
    }
    return api
  }
  const storage = { from: () => ({
    upload: async (id, bytes, o) => { stored.set(id, { bytes, type: o.contentType }); return { error: null } },
    createSignedUrl: async (id) => ({ data: { signedUrl: `https://files.test/${id}?sig=1` } }),
    remove: async (ids) => { removed.push(...ids); return { error: null } },
  }) }
  return { from, storage, t, stored, removed }
}
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUV12', env = () => ''
const base = {
  doc_forms: [
    { id: 'frm-1', token: TOKEN, name: 'KYC', description: 'd', instructions: 'i', kind: 'ONLINE', fields, version: 2, status: 'PUBLISHED', booking_id: 'b1', verify: 'MOBILE', views: 0, created_by: 'ops', expires_on: null },
    { id: 'frm-2', token: 'tok_CLOSEDCLOSEDCLOSED1234', name: 'Old', fields, version: 1, status: 'CLOSED', verify: 'NONE', views: 0 },
    { id: 'frm-3', token: 'tok_EXPIREDEXPIREDEXPIR12', name: 'Late', fields, version: 1, status: 'PUBLISHED', verify: 'NONE', views: 0, expires_on: '2020-01-01' },
  ],
  bookings: [{ id: 'b1', booking_code: 'RX-1', company_name: 'Asha Foods', mobile: '9876543210', payment_contact: '9000000000', ops_member_id: 'ops' }],
  doc_form_submissions: [], notifications: [], audit_log: [],
}

let sb = fake(base)
let a = await getPublicForm(env, 'short', null, '1.1.1.1', sb)
assert.equal(a.status, 404, 'a malformed token')
a = await getPublicForm(env, 'tok_CLOSEDCLOSEDCLOSED1234', null, '1.1.1.1', sb)
assert.equal(a.status, 410, 'closed form')
a = await getPublicForm(env, 'tok_EXPIREDEXPIREDEXPIR12', null, '1.1.1.1', sb)
assert.equal(a.status, 410)
assert.match(a.body.message, /expired/)
a = await getPublicForm(env, TOKEN, null, '1.1.1.1', sb)
assert.equal(a.status, 401, 'mobile needed first')
assert.equal(a.body.verify, true)
assert.equal(a.body.form, undefined, 'nothing of the form before the mobile check')
a = await getPublicForm(env, TOKEN, '9111111111', '1.1.1.1', sb)
assert.equal(a.status, 403, 'wrong mobile')
a = await getPublicForm(env, TOKEN, '+91 98765 43210', '1.1.1.1', sb)
assert.equal(a.status, 200)
assert.equal(a.body.form.fields.length, 6)
assert.equal(sb.t.doc_forms[0].views, 1, 'views counted')

// submit: bad answers are refused before anything is stored
const good = { mobile: '9876543210', answers: { n: 'Asha', p: '9876543210', s: 'LLP', c: true }, files: [{ fieldId: 'f', name: 'pan.pdf', type: 'application/pdf', data: pdf.toString('base64') }] }
let s = await submitPublicForm(env, TOKEN, JSON.stringify({ ...good, files: [{ fieldId: 'f', name: 'pan.pdf', type: 'application/pdf', data: exe.toString('base64') }] }), '2.2.2.2', sb)
assert.equal(s.status, 422)
assert.match(s.body.errors.f, /doesn't look like/)
assert.equal(sb.stored.size, 0)
s = await submitPublicForm(env, TOKEN, JSON.stringify({ ...good, mobile: '' }), '2.2.2.2', sb)
assert.equal(s.status, 401, 'mobile checked on submit too')
s = await submitPublicForm(env, TOKEN, JSON.stringify(good), '2.2.2.2', sb)
assert.equal(s.status, 200)
const sub = sb.t.doc_form_submissions[0]
assert.equal(sub.form_version, 2)
assert.equal(sub.booking_id, 'b1')
assert.equal(sub.files.length, 1)
assert.equal(sb.stored.get(sub.files[0].file.id).type, 'application/pdf', 'file in private storage')
assert.equal(sub.fields.length, 6, 'the fields as the client saw them are kept')
assert.ok(sb.t.notifications.some((n) => n.user_id === 'ops' && /Form returned/.test(n.title)))
assert.ok(sb.t.audit_log.some((x) => x.action === 'FORM_SUBMITTED'))
s = await submitPublicForm(env, 'tok_CLOSEDCLOSEDCLOSED1234', JSON.stringify(good), '2.2.2.2', sb)
assert.equal(s.status, 410, 'a closed form takes nothing')
console.log('✓ client forms: links, expiry, mobile check, answers, file contents, private storage')
