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
bk.documents.push({ id: 'doc-x', name: 'pan.pdf', category: 'KYC', size: 10, at, by: a.id, status: 'PENDING', file: { id: 'f-1', name: 'pan.pdf', type: 'application/pdf', size: 10, at }, note: 'front side' })
db.sessions.push({ id: 'ds-x', userId: a.id, date: '2026-10-12', loginAt: at, breaks: [{ start: at }], lateBreak: { breakStart: at, expectedReturn: at, lateMinutes: 3 } })
db.settings.maintenance = { on: true, message: 'Upgrading', by: a.id, at }
db.legacyFiles = [{ path: 'uploads/a.pdf', file: { id: 'lg-f-1', name: 'a.pdf', type: 'application/pdf', size: 5, at }, kind: 'KYC' }]
db.assets = [{ id: 'as-1', tag: 'RX-AST-0001', name: 'Laptop', category: 'IT', serial: 'SN1', status: 'ASSIGNED', assignedTo: a.id, assignedOn: '2026-10-01', createdAt: at, history: [{ at, by: a.id, action: 'ADDED' }, { at, by: a.id, action: 'ASSIGNED', userId: a.id, note: 'new joiner' }] }]
db.stock = [{ id: 'st-1', name: 'A4 paper', category: 'Stationery', unit: 'ream', qty: 9, minQty: 2, createdAt: at, moves: [{ at, by: a.id, qty: 10 }, { at, by: a.id, qty: -1, issuedTo: b.id }] }]
db.expenses = [{ id: 'ex-1', date: '2026-10-10', category: 'Pantry', description: 'Tea', amount: 500, gst: 25, paidVia: 'UPI', by: a.id, createdAt: at }]
check('demo data', db)

const file = process.argv[2]
if (file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(raw?.app === 'rexera-crm' && !raw.encrypted, 'Pass an unencrypted Rexera CRM backup')
  check(file, upgradeDb(raw.db), raw.imports ?? [])
}
