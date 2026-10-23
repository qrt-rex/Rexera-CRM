// node server/whatsapp.test.mjs — Interakt requests, the WhatsApp welcome (once per file) and sending invoice PDFs.
// Nothing leaves this computer: Interakt, the mail server and Supabase are fakes.
import assert from 'node:assert/strict'
import { sendTemplate, welcomeWhatsapp } from './whatsapp.mjs'
import { sendFormLink, sendInvoice, sendWelcomeNow } from './share.mjs'
import { workflowSettings } from '../supabase/workflow-rules.mjs'

const env = (vars) => (k) => vars[k] ?? ''
const KEY = { INTERAKT_API_KEY: 'aW50ZXJha3Qtc2VjcmV0' }
/** Records each request; answers with `answer(n)` → { status, body }. */
function fakeInterakt(answer = () => ({ status: 201, body: { result: true, message: 'Message created successfully', id: 'ik-msg-1' } })) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    const a = answer(calls.length)
    return { ok: a.status < 300, status: a.status, json: async () => a.body }
  }
  return { calls, fetchImpl }
}

// ---------------------------------------------------------------- one template message
let ik = fakeInterakt()
assert.equal((await sendTemplate(env({}), { template: 't', phone: '9876543210' }, ik.fetchImpl)).status, 'NOT_CONFIGURED', 'no key: nothing sent')
assert.equal((await sendTemplate(env(KEY), { template: '', phone: '9876543210' }, ik.fetchImpl)).status, 'NOT_CONFIGURED', 'no template chosen')
assert.equal((await sendTemplate(env(KEY), { template: 't', phone: '12345' }, ik.fetchImpl)).status, 'NO_CONTACT')
assert.equal(ik.calls.length, 0)
let r = await sendTemplate(env(KEY), { template: 'invoice_pdf', language: 'en', phone: '+91 98765-43210', bodyValues: ['Asha', 'Tax invoice X1'], headerValues: ['https://files.test/x.pdf'], fileName: 'X1.pdf', callbackData: 'invoice:i1' }, ik.fetchImpl)
assert.deepEqual(r, { status: 'SENT', to: '9876543210', id: 'ik-msg-1' })
assert.equal(ik.calls[0].url, 'https://api.interakt.ai/v1/public/message/')
assert.equal(ik.calls[0].headers.Authorization, `Basic ${KEY.INTERAKT_API_KEY}`)
assert.deepEqual(ik.calls[0].body, {
  countryCode: '+91', phoneNumber: '9876543210', type: 'Template', callbackData: 'invoice:i1',
  template: { name: 'invoice_pdf', languageCode: 'en', bodyValues: ['Asha', 'Tax invoice X1'], headerValues: ['https://files.test/x.pdf'], fileName: 'X1.pdf' },
})
ik = fakeInterakt(() => ({ status: 401, body: { result: false, message: 'Invalid API key' } }))
r = await sendTemplate(env(KEY), { template: 't', phone: '9876543210' }, ik.fetchImpl)
assert.equal(r.status, 'FAILED')
assert.match(r.error, /refused the API key/)
ik = fakeInterakt(() => ({ status: 200, body: { result: false, message: 'Template not approved' } }))
assert.equal((await sendTemplate(env(KEY), { template: 't', phone: '9876543210' }, ik.fetchImpl)).error, 'Template not approved')

// ---------------------------------------------------------------- a tiny Supabase (tables, JSON paths, storage)
const at = (row, k) => k.split(/->>?/).reduce((v, p) => (v == null ? v : v[p]), row)
function fake(tables) {
  const t = structuredClone(tables), stored = new Map()
  const from = (name) => {
    const rows = (t[name] ??= []), filters = []
    let patch = null
    const match = (r) => filters.every((f) => f(r))
    const api = {
      select: () => api, eq: (k, v) => { filters.push((r) => at(r, k) === v); return api },
      maybeSingle: async () => ({ data: structuredClone(rows.find(match) ?? null), error: null }),
      update: (p) => { patch = p; return api },
      insert: async (x) => { rows.push(...structuredClone(Array.isArray(x) ? x : [x])); return { error: null } },
      upsert: async (x) => { for (const y of [x].flat()) if (!rows.some((r) => r.key === y.key)) rows.push(structuredClone(y)); return { error: null } },
      then: (ok) => { const hit = rows.filter(match); if (patch) for (const r of hit) Object.assign(r, structuredClone(patch)); return ok({ data: structuredClone(hit), error: null }) },
    }
    return api
  }
  const storage = { from: () => ({
    upload: async (id, bytes, o) => { stored.set(id, { bytes, type: o.contentType }); return { error: null } },
    createSignedUrl: async (id, secs) => ({ data: { signedUrl: `https://files.test/${id}?token=sig&ttl=${secs}` } }),
  }) }
  return { from, storage, t, stored }
}

// ---------------------------------------------------------------- welcome on WhatsApp: once per file
const now = Date.UTC(2026, 9, 21, 5, 0)
const w = workflowSettings({ whatsapp: { welcomeTemplate: 'client_welcome', invoiceTemplate: 'invoice_pdf', language: 'en' }, opsContact: { name: 'Sneha', phone: '9800000001', email: '' } })
const row = { id: 'b1', booking_code: 'RX-1', company_name: 'Asha Foods', contact_person: 'Asha', mobile: '9876500001', service_name: 'Seed Fund', ops_member_id: 'ops',
  welcome: { email: { status: 'SENT', attempts: 1 }, whatsapp: { status: 'PENDING', attempts: 0, to: '9876500001' }, createdAt: new Date(now - 60_000).toISOString(), createdBy: 'leg' } }
let sb = fake({ bookings: [row], reminder_log: [], audit_log: [], notifications: [] })
ik = fakeInterakt()
const opt = { w, company: 'Rexera', ops: { name: 'Sneha' }, now, fetchImpl: ik.fetchImpl }
assert.equal(await welcomeWhatsapp(sb, env(KEY), row, opt), null, 'queued a minute ago: the approving screen sends it, not the job')
r = await welcomeWhatsapp(sb, env(KEY), row, { ...opt, immediate: true })
assert.equal(r.status, 'SENT')
assert.deepEqual(ik.calls[0].body.template.bodyValues, ['Asha', 'Seed Fund', 'RX-1', 'Sneha', '9800000001'])
let wa = sb.t.bookings[0].welcome.whatsapp
assert.equal(wa.status, 'SENT'); assert.equal(wa.attempts, 1); assert.equal(wa.messageId, 'ik-msg-1')
assert.equal(sb.t.bookings[0].welcome.email.status, 'SENT', 'the email side is left as it was')
assert.ok(sb.t.reminder_log.some((x) => x.key === 'welcome-wa:b1'))
assert.equal(await welcomeWhatsapp(sb, env(KEY), sb.t.bookings[0], { ...opt, immediate: true }), null, 'sent: never again')
// a screen with an old copy of the file writes it back as PENDING — the ledger still stops a second message
sb.t.bookings[0].welcome.whatsapp.status = 'PENDING'
assert.equal(await welcomeWhatsapp(sb, env(KEY), sb.t.bookings[0], { ...opt, immediate: true }), null)
assert.equal(sb.t.bookings[0].welcome.whatsapp.status, 'SENT', 'restored')
assert.equal(ik.calls.length, 1, 'one WhatsApp message in all')

// failure: kept on the file with the reason, Operations told, retried after 30 minutes, at most 3 tries
sb = fake({ bookings: [structuredClone(row)], reminder_log: [], audit_log: [], notifications: [] })
ik = fakeInterakt(() => ({ status: 400, body: { result: false, message: 'Template not approved' } }))
r = await welcomeWhatsapp(sb, env(KEY), sb.t.bookings[0], { ...opt, immediate: true, fetchImpl: ik.fetchImpl })
assert.equal(r.status, 'FAILED')
wa = sb.t.bookings[0].welcome.whatsapp
assert.equal(wa.status, 'FAILED'); assert.equal(wa.error, 'Template not approved')
assert.ok(sb.t.notifications.some((n) => n.user_id === 'ops' && /WhatsApp not sent/.test(n.title)))
assert.equal(await welcomeWhatsapp(sb, env(KEY), sb.t.bookings[0], { ...opt, now: now + 10 * 60_000, fetchImpl: ik.fetchImpl }), null, 'not before 30 minutes')
assert.equal((await welcomeWhatsapp(sb, env(KEY), sb.t.bookings[0], { ...opt, now: now + 31 * 60_000, fetchImpl: ik.fetchImpl })).status, 'FAILED')
assert.equal(sb.t.bookings[0].welcome.whatsapp.attempts, 2)

// ---------------------------------------------------------------- invoice PDF by email + WhatsApp
const pdf = Buffer.from('%PDF-1.4\n…invoice…').toString('base64')
const tables = () => ({
  invoices: [{ id: 'inv-1', number: 'RX/26-27/0044', type: 'TAX', client: 'Asha Foods', status: 'ISSUED' }, { id: 'inv-x', number: 'X', type: 'TAX', client: 'Other', status: 'ISSUED' }],
  bookings: [structuredClone(row)], app_settings: [{ key: 'workflow', value: { whatsapp: { welcomeTemplate: 'client_welcome', invoiceTemplate: 'invoice_pdf', language: 'en' } } }, { key: 'company', value: { name: 'Rexera' } }],
  app_users: [{ id: 'ops', name: 'Sneha', phone: '9800000001' }], invoice_shares: [], audit_log: [], reminder_log: [], notifications: [],
})
const setup = (visible = ['inv-1', 'b1']) => {
  const admin = fake(tables())
  // what the caller's own sign-in may read (row-level security)
  const asCaller = fake({ invoices: tables().invoices.filter((x) => visible.includes(x.id)), bookings: tables().bookings.filter((x) => visible.includes(x.id)) })
  return { admin, clients: { admin, asCaller, me: { id: 'acc', name: 'Anjali', active: true } } }
}
const mails = []
const deliverEmail = async (req, attachments) => { mails.push({ req, attachments }); return { success: true, message: 'ok' } }
const body = (x) => JSON.stringify({ invoiceId: 'inv-1', pdf, fileName: 'RX/26-27/0044', email: { to: 'asha@foods.test', subject: 'Tax invoice RX/26-27/0044', message: 'Please find it attached.' }, whatsapp: { phone: '9876500001', values: { client_name: 'Asha', document: 'Tax invoice RX/26-27/0044', amount: 'Rs. 17,700.00', company: 'Rexera' } }, ...x })

assert.equal((await sendInvoice(env({}), '', body())).status, 503, 'needs the live server with Supabase')
let s = setup([])
assert.equal((await sendInvoice(env(KEY), 'Bearer x', body(), { clients: s.clients, deliverEmail })).status, 403, 'an invoice the caller cannot open')
s = setup()
assert.equal((await sendInvoice(env(KEY), 'Bearer x', body({ pdf: Buffer.from('MZ\x90\x00').toString('base64') }), { clients: s.clients, deliverEmail })).status, 422, 'only a real PDF')
ik = fakeInterakt()
let res = await sendInvoice(env(KEY), 'Bearer x', body(), { clients: s.clients, deliverEmail, fetchImpl: ik.fetchImpl, now })
assert.equal(res.status, 200)
assert.equal(res.body.email.status, 'SENT'); assert.equal(res.body.whatsapp.status, 'SENT')
assert.deepEqual(mails[0].attachments, [{ filename: 'RX-26-27-0044.pdf', content: pdf, contentType: 'application/pdf' }], 'PDF attached to the email')
const [stored] = [...s.admin.stored.keys()]
assert.equal(s.admin.stored.get(stored).type, 'application/pdf', 'private copy for WhatsApp')
const tpl = ik.calls[0].body.template
assert.equal(tpl.name, 'invoice_pdf'); assert.equal(tpl.fileName, 'RX-26-27-0044.pdf')
assert.match(tpl.headerValues[0], new RegExp(`${stored}\\?token=sig&ttl=604800`), 'a 7-day signed link, not a public file')
assert.deepEqual(tpl.bodyValues, ['Asha', 'Tax invoice RX/26-27/0044', 'Rs. 17,700.00', 'Rexera'])
assert.deepEqual(s.admin.t.invoice_shares.map((x) => [x.channel, x.status, x.to_addr, x.sent_by]), [['email', 'SENT', 'asha@foods.test', 'acc'], ['whatsapp', 'SENT', '9876500001', 'acc']])
assert.equal(s.admin.t.invoice_shares[1].message_id, 'ik-msg-1')
assert.ok(s.admin.t.audit_log.some((x) => x.action === 'INVOICE_SENT'))
// no WhatsApp template: nothing uploaded, said honestly
s = setup()
s.admin.t.app_settings[0].value = {}
res = await sendInvoice(env(KEY), 'Bearer x', body({ email: undefined }), { clients: s.clients, deliverEmail, fetchImpl: ik.fetchImpl, now })
assert.equal(res.body.whatsapp.status, 'NOT_CONFIGURED'); assert.equal(res.body.success, false)
assert.equal(s.admin.stored.size, 0)

// ---------------------------------------------------------------- the approving screen asks for the WhatsApp welcome
s = setup(['inv-1'])
assert.equal((await sendWelcomeNow(env(KEY), 'Bearer x', JSON.stringify({ bookingId: 'b1' }), { clients: s.clients })).status, 403, 'a file the caller cannot open')
s = setup()
ik = fakeInterakt()
res = await sendWelcomeNow(env(KEY), 'Bearer x', JSON.stringify({ bookingId: 'b1' }), { clients: s.clients, fetchImpl: ik.fetchImpl, now })
assert.equal(res.body.result.status, 'SENT')
assert.deepEqual(ik.calls[0].body.template.bodyValues, ['Asha', 'Seed Fund', 'RX-1', 'Sneha', '9800000001'])
// ---------------------------------------------------------------- a Form Builder link on WhatsApp
const form = { id: 'frm-1', token: 'tok_ABCDEFGHIJKLMNOPQRSTUV12', name: 'KYC details', status: 'PUBLISHED', expires_on: null, booking_id: 'b1' }
const formSetup = (rows, wa = 'form_link') => {
  const admin = fake({ app_settings: [{ key: 'workflow', value: { whatsapp: { formTemplate: wa } } }, { key: 'company', value: { name: 'Rexera' } }], audit_log: [] })
  return { admin, clients: { admin, asCaller: fake({ doc_forms: rows }), me: { id: 'ops', name: 'Sneha', active: true } } }
}
s = formSetup([])
assert.equal((await sendFormLink(env(KEY), 'Bearer x', JSON.stringify({ formId: 'frm-1', phone: '9876500001' }), { clients: s.clients })).status, 403, 'a form the caller cannot manage')
s = formSetup([{ ...form, status: 'CLOSED' }])
assert.equal((await sendFormLink(env(KEY), 'Bearer x', JSON.stringify({ formId: 'frm-1', phone: '9876500001' }), { clients: s.clients, now })).status, 422, 'a closed link is not sent')
s = formSetup([form])
ik = fakeInterakt()
res = await sendFormLink(env(KEY), 'Bearer x', JSON.stringify({ formId: 'frm-1', phone: '9876500001', clientName: 'Asha' }), { clients: s.clients, fetchImpl: ik.fetchImpl, appUrl: 'https://crm.example.test/', now })
assert.equal(res.body.status, 'SENT')
assert.equal(ik.calls[0].body.template.name, 'form_link')
assert.deepEqual(ik.calls[0].body.template.bodyValues, ['Asha', 'KYC details', 'https://crm.example.test/f/tok_ABCDEFGHIJKLMNOPQRSTUV12', 'Rexera'], 'the link points at this CRM')
s = formSetup([form], '')
assert.equal((await sendFormLink(env(KEY), 'Bearer x', JSON.stringify({ formId: 'frm-1', phone: '9876500001' }), { clients: s.clients, now })).body.status, 'NOT_CONFIGURED', 'no form-link template: said so')
console.log('✓ WhatsApp (Interakt): template requests, welcome once per file, invoice PDF by email + WhatsApp, form links, access checks')
