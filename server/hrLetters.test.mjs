// node server/hrLetters.test.mjs — offer / joining letters to selected candidates: who, to whom, PDF, duplicates, log
import assert from 'node:assert/strict'
import { sendHrLetter } from './hrLetters.mjs'

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
  const uploads = []
  const storage = { from: () => ({ upload: async (path) => { uploads.push(path); return { error: null } }, createSignedUrl: async (path) => ({ data: { signedUrl: `https://files.test/${path}?sig` } }) }) }
  return { from, storage, t, uploads }
}
const now = Date.UTC(2026, 9, 31, 6, 0)
const tables = () => ({
  app_users: [{ id: 'u-hr', role: 'hr', email: 'hr@rexera.test', phone: '9800000009' }],
  app_settings: [{ key: 'company', value: { name: 'Rexera' } }, { key: 'workflow', value: { whatsapp: { notifyTemplate: 'client_update', language: 'en' } } }],
  candidate_applications: [
    { id: 'c-1', name: 'Asha Rao', email: 'Asha@Mail.test', phone: '+91 98765 00011', position: 'Sales Executive', selected: true },
    { id: 'c-2', name: 'Ravi', email: 'ravi@mail.test', phone: '9876500012', position: 'Accountant', selected: false },
  ],
  candidate_letters: [], audit_log: [],
})
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')
const mails = []
const deliverEmail = async (m, att) => { mails.push({ m, att }); return { success: true } }
const env = (vars) => (k) => vars[k] ?? ''
const send = (t, body, o = {}) => {
  const admin = fake(t)
  return sendHrLetter(env(o.env ?? {}), 'Bearer x', JSON.stringify({ pdf: PDF, ...body }), { clients: { admin, asCaller: fake(t, o.visible), me: { id: 'u-hr', name: 'Hema HR', active: true } }, deliverEmail: o.deliverEmail ?? deliverEmail, fetchImpl: o.fetchImpl, now: o.now ?? now }).then((r) => ({ ...r, uploads: admin.uploads }))
}
const mail = { candidateId: 'c-1', kind: 'OFFER', channel: 'EMAIL', subject: 'Your offer letter', body: 'Dear Asha, please find your offer letter attached.' }

let t = tables()
let r = await send(t, { ...mail, kind: 'PROMOTION' })
assert.equal(r.status, 422, 'only offer and joining letters')
r = await send(t, { ...mail, candidateId: 'c-2' })
assert.equal(r.status, 422, 'a candidate who is not selected gets no letter'); assert.match(r.body.message, /Select the candidate/)
r = await send(t, mail, { visible: { candidate_applications: () => false } })
assert.equal(r.status, 403, 'someone who can’t open candidates (no recruitment.manage) can’t send')
r = await send(t, { ...mail, pdf: Buffer.from('not a pdf').toString('base64') })
assert.equal(r.status, 422, 'the PDF is checked')

r = await send(t, { ...mail, requestId: 'cl-req-000001' })
assert.equal(r.status, 200, r.body.message)
assert.equal(mails[0].m.to, 'asha@mail.test', 'always the email saved on the application')
assert.equal(mails[0].att[0].contentType, 'application/pdf'); assert.match(mails[0].att[0].filename, /offer-letter-Asha-Rao\.pdf/)
assert.equal(t.candidate_letters[0].status, 'SENT'); assert.equal(t.candidate_letters[0].sent_by, 'u-hr')
assert.ok(t.audit_log.some((a) => a.action === 'HR_LETTER'))
r = await send(t, { ...mail, requestId: 'cl-req-000001' })
assert.equal(r.body.duplicate, true); assert.equal(mails.length, 1, 'the same request is answered once')
r = await send(t, mail, { now: now + 60_000 })
assert.equal(r.status, 409, 'the same letter again within 2 minutes is refused')
r = await send(t, { ...mail, kind: 'JOINING', subject: 'Joining letter' }, { now: now + 60_000 })
assert.equal(r.status, 200, 'the joining letter is a different letter')

// WhatsApp: the PDF as a private 7-day link inside the client notification template
let sent
r = await send(t, { ...mail, channel: 'WHATSAPP', subject: undefined }, { env: { INTERAKT_API_KEY: 'k' }, fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ result: true, id: 'wa-1' }) } } })
assert.equal(r.status, 200, r.body.message)
assert.equal(sent.phoneNumber, '9876500011'); assert.equal(sent.template.name, 'client_update')
assert.equal(sent.template.bodyValues[0], 'Asha Rao'); assert.equal(sent.template.bodyValues[1], 'Sales Executive')
assert.match(sent.template.bodyValues[2], /^Your offer letter \(valid 7 days\): https:\/\/files\.test\/hr-letters\//)
assert.equal(r.uploads.length, 1)

// not set up: logged as NOT_CONFIGURED; sent from HR's own WhatsApp: MANUAL
t = tables()
r = await send(t, { ...mail, channel: 'WHATSAPP' })
assert.equal(r.status, 503); assert.equal(t.candidate_letters[0].status, 'NOT_CONFIGURED')
r = await send(t, { ...mail, channel: 'WHATSAPP', manual: true, pdf: undefined })
assert.equal(r.status, 200); assert.equal(t.candidate_letters.at(-1).status, 'MANUAL')
r = await send(t, mail, { deliverEmail: async () => ({ success: false, message: 'SMTP down' }) })
assert.equal(r.status, 502); assert.equal(t.candidate_letters.at(-1).error, 'SMTP down')
console.log('✓ HR letters: selected candidates only, HR only, saved email / mobile, PDF attached or linked, duplicates, log')
