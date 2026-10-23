#!/usr/bin/env node
/**
 * Round-trip check for backup-mapping.mjs: app data → table rows → app data must lose nothing the app relies on.
 *
 *   node supabase/backup-mapping.test.mjs              (demo data, plus a record of every optional kind)
 *   node supabase/backup-mapping.test.mjs backup.json  (also a real, unencrypted backup — e.g. the main office PC's)
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { mapAll, rowsToDb } from './backup-mapping.mjs'

// the app's seed is TypeScript: let Vite load it
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildSeed } = await vite.ssrLoadModule('/src/lib/seed.ts')
const { upgradeDb } = await vite.ssrLoadModule('/src/lib/hrsuite.ts')
await vite.close()

/** Empty values mean the same to the app as a missing key; key order doesn't matter. */
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      const c = canon(v[k])
      if (c === undefined || c === null || c === '' || (Array.isArray(c) && !c.length) || (typeof c === 'object' && c && !Array.isArray(c) && !Object.keys(c).length)) continue
      out[k] = c
    }
    return out
  }
  return v
}
/** Every path where a and b differ, e.g. `users[3].passHash`. */
const diff = (a, b, path = '', out = []) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out)
  } else out.push(path)
  return out
}
/** Intended differences: passwords move to Supabase Auth, audit ids become database ids, older tasks get the booking's date. */
const INTENDED = [/^users\[\d+\]\.passHash$/, /^audit\[\d+\]\.id$/, /^bookings\[\d+\]\.tasks\[\d+\]\.createdAt$/]

function check(label, db, imports = []) {
  const tables = mapAll({ db, imports })
  const back = rowsToDb(tables)
  // 1) table rows → app data → table rows: nothing stored may change
  assert.deepEqual(canon(mapAll({ db: back.db, imports: back.imports })), canon(tables), `${label}: rows changed on a second pass`)
  // 2) app data → rows → app data: list anything the tables don't keep
  const lost = diff(canon(db), canon(back.db)).filter((p) => !INTENDED.some((re) => re.test(p)))
  const rows = Object.values(tables).reduce((n, r) => n + r.length, 0)
  if (lost.length) {
    console.error(`✗ ${label}: ${lost.length} value(s) not kept by the tables:`)
    for (const p of lost.slice(0, 40)) console.error(`   ${p}`)
    process.exitCode = 1
  } else console.log(`✓ ${label}: ${rows} rows, nothing lost`)
}

// demo data, plus one of each optional record the demo doesn't have
const db = upgradeDb(await buildSeed())
const [a, b] = db.users, bk = db.bookings[0], at = '2026-10-12T05:30:00.000Z'
a.photo = 'data:image/png;base64,AAAA'; a.shift = { breakStart: '13:00', breakEnd: '13:45', timeZone: 'Asia/Kolkata', offDays: [0] }; a.branchId = 'br-1'
b.branchIds = ['br-1', 'br-2']
bk.clientEmails = [{ id: 'ce-1', at, by: a.id, to: 'client@example.com', cc: ['ops@example.com'], subject: 'Welcome', template: 'welcome', status: 'SENT' }]
bk.documents.push({ id: 'doc-x', name: 'pan.pdf', category: 'KYC', size: 10, at, by: a.id, status: 'VERIFIED', file: { id: 'f-1', name: 'pan.pdf', type: 'application/pdf', size: 10, at }, note: 'front side', reviewedBy: b.id, reviewedAt: at })
db.sessions.push({ id: 'ds-x', userId: a.id, date: '2026-10-12', loginAt: at, breaks: [{ start: at }], lateBreak: { breakStart: at, expectedReturn: at, lateMinutes: 3 } })
db.settings.maintenance = { on: true, message: 'Upgrading', by: a.id, at }
db.legacyFiles = [{ path: 'uploads/a.pdf', file: { id: 'lg-f-1', name: 'a.pdf', type: 'application/pdf', size: 5, at }, kind: 'KYC' }]
db.assets = [{ id: 'as-1', tag: 'RX-AST-0001', name: 'Laptop', category: 'IT', serial: 'SN1', status: 'ASSIGNED', assignedTo: a.id, assignedOn: '2026-10-01', createdAt: at, history: [{ at, by: a.id, action: 'ADDED' }, { at, by: a.id, action: 'ASSIGNED', userId: a.id, note: 'new joiner' }] }]
db.stock = [{ id: 'st-1', name: 'A4 paper', category: 'Stationery', unit: 'ream', qty: 9, minQty: 2, createdAt: at, moves: [{ at, by: a.id, qty: 10 }, { at, by: a.id, qty: -1, issuedTo: b.id }] }]
db.expenses = [{ id: 'ex-1', date: '2026-10-10', category: 'Pantry', description: 'Tea', amount: 500, gst: 25, paidVia: 'UPI', by: a.id, createdAt: at, branchId: 'br-amd-a' }]
// October requests: booking type, commission, refunds, TDS, complimentary service, service prices, auto-assign, salary paid
Object.assign(bk, {
  bookingType: 'COMBO6', commission: { to: 'DSA', name: 'Mehul Shah', pct: 12.5, amount: 2500, by: a.id, at },
  refunds: [{ id: 'rf-1', amount: 1000, date: '2026-10-11', reason: 'Scheme closed', status: 'REFUNDED', refundedOn: '2026-10-12', mode: 'NEFT', ref: 'UTR123', by: a.id, at }, { id: 'rf-2', amount: 500, date: '2026-10-12', reason: 'Partial', status: 'PENDING', by: a.id, at }],
  services: [...(bk.services ?? []), { serviceId: db.services[1].id, name: db.services[1].name, price: 0, complimentary: true, addedBy: a.id, addedAt: at }],
})
bk.payments[0].tds = { pct: 10, amount: 450 }
// workflow automation: welcome, follow-up, Admin checklist, schemes, forms, settings
Object.assign(bk, {
  welcome: { email: { status: 'FAILED', to: 'c@x.test', attempts: 2, lastAt: at, error: 'SMTP timed out' }, whatsapp: { status: 'NOT_CONFIGURED', to: '9876500001', attempts: 0, manualAt: at, manualBy: a.id }, createdAt: at, createdBy: a.id },
  followUp: { everyDays: 15, startedOn: '2026-10-01', nextOn: '2026-10-16', lastOn: '2026-10-05', paused: true, log: [{ at, by: a.id, kind: 'NOTE', note: 'called' }, { at, by: '', kind: 'REMINDER' }] },
  adminWork: { PRECHECK: { status: 'IN_PROGRESS', assignee: a.id, ref: `${bk.bookingId}/2`, assignedBy: b.id, assignedAt: at, due: '2026-10-20', updatedAt: at, updatedBy: a.id, startedAt: at, history: [{ at, by: b.id, status: 'NOT_STARTED', note: 'Forwarded', assignee: a.id, ref: `${bk.bookingId}/2` }, { at, by: a.id, status: 'IN_PROGRESS', note: 'started' }], remindEveryDays: 4, nextRemindOn: '2026-10-22', lastFollowUpOn: '2026-10-18' }, DPR: { status: 'COMPLETED', updatedAt: at, updatedBy: a.id, doneAt: at, history: [] } },
})
Object.assign(db.schemes[0], { price: 25000, startDate: '2026-10-01', endDate: '2026-10-31', updatedAt: at, updatedBy: a.id })
db.settings.workflow = { fileReminderDays: 10, precheckDays: 4, welcomeAuto: false, welcomeEmail: { subject: 'Hi', body: 'Welcome {client_name}' }, welcomeWhatsapp: 'Hi {client_name}', schemeAlertRoles: ['admin'], opsContact: { name: 'Ops', phone: '9800000000', email: 'ops@x.test' }, whatsapp: { welcomeTemplate: 'client_welcome', invoiceTemplate: 'invoice_pdf', language: 'en' } }
bk.welcome.whatsapp.messageId = 'ik-1'
db.invoices[0].shares = [{ id: 'ish-2', at: '2026-10-13T05:30:00.000Z', by: a.id, channel: 'whatsapp', to: '9876500001', status: 'SENT', messageId: 'ik-9' }, { id: 'ish-1', at, by: a.id, channel: 'email', to: 'c@x.test', status: 'FAILED', error: 'SMTP timed out' }]
db.settings.jobs = { lastRunAt: at, summary: 'follow-ups 1' }
db.docForms = [{ id: 'frm-1', token: 'tok_ABCDEFGHIJKLMNOPQRSTUV12', name: 'KYC', description: 'd', instructions: 'i', kind: 'UPLOAD', fields: [{ id: 'f1', label: 'PAN', type: 'file', required: true }, { id: 'f2', label: 'Type', type: 'select', required: false, options: ['A', 'B'], help: 'pick' }],
  version: 2, versions: [{ version: 1, at, by: a.id, fields: [] }], status: 'PUBLISHED', bookingId: bk.id, expiresOn: '2026-12-31', verify: 'MOBILE', document: { id: 'f-doc', name: 'kyc.pdf', type: 'application/pdf', size: 9, at },
  createdBy: a.id, createdAt: at, updatedAt: at, updatedBy: a.id, views: 3, lastViewedAt: at }]
db.formSubmissions = [{ id: 'fs-1', formId: 'frm-1', formVersion: 2, bookingId: bk.id, fields: db.docForms[0].fields, answers: { f2: 'A' }, files: [{ fieldId: 'f1', file: { id: 'f-up', name: 'pan.pdf', type: 'application/pdf', size: 5, at } }], submittedAt: at, status: 'ACCEPTED', reviewedBy: a.id, reviewedAt: at, note: 'ok' }]
db.services[0].prices = { MULTIPLE: 70000, COMBO12: 60000 }
// Sales Kit: the seed list (55) plus one edited by the Operation team
assert.ok(db.salesKit.length >= 50, 'the Sales Kit list is loaded')
Object.assign(db.salesKit[0], { registrationCharge: 'Govt fee extra', updatedAt: at, updatedBy: a.id })
db.settings.leadAssign = { on: true, userIds: [a.id, b.id], next: 1 }
db.users.push({ ...b, id: 'u-left', username: 'left.person', email: 'left@example.com', active: false, exitOn: '2026-10-15' })
db.payrollRuns.push({ id: 'pr-x', month: '2026-09', status: 'PAID', provisional: false, calculatedAt: at, calculatedBy: a.id, history: [],
  rows: [{ userId: a.id, name: a.name, designation: '', department: '', gross: 30000, daysInMonth: 30, paidDays: 30, lopDays: 0, lopAmount: 0, basic: 15000, pfWages: 15000, pfEmployee: 1800, pfEmployer: 1800, pt: 200, incentive: 0, net: 28000, ctc: 30000, hra: 6000, otherAllowance: 9000, paidOn: '2026-10-01', paidRef: 'UTR9', paidBy: a.id }] })
db.leadUploads = [{ id: 'lup-1', fileName: 'leads oct.xlsx', size: 2048, totalRows: 3, imported: 1, by: a.id, at }]
Object.assign(db.leads[0], {
  altPhone: '9123456780', location: 'SG Highway', industry: 'Retail', businessType: 'Proprietor', turnover: '0-20L', fundingAmount: '25L', fundingCategory: 'Grant',
  requirement: 'Seed fund', formAt: at, extra: { 'Submitted Page': '/grants' }, uploadId: 'lup-1', assignedAt: at, seenAt: at,
  chain: [{ to: a.id, by: b.id, at, kind: 'ASSIGNED' }, { to: b.id, by: a.id, at, kind: 'FORWARDED', note: 'Gujarati speaker' }],
  history: [{ at, by: a.id, action: 'Forwarded to B', note: 'Gujarati speaker' }],
})
check('demo data', db)

const file = process.argv[2]
if (file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(raw?.app === 'rexera-crm' && !raw.encrypted, 'Pass an unencrypted Rexera CRM backup')
  check(file, upgradeDb(raw.db), raw.imports ?? [])
}
