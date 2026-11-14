// Old CRM sync end to end, without a database: a test connector (the same signed protocol as the PHP file) serves a
// small old CRM; the sync reads it page by page, the real old-CRM import maps it, and planWrites decides what to
// write — first copy, nothing changed, a change in the old CRM, a change made in the new CRM.
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync } from 'node:fs'
import { verifyRequest } from '../supabase/legacy-sync-protocol.mjs'
import { mapAll, rowsToDb } from '../supabase/backup-mapping.mjs'
import { planWrites } from '../supabase/legacy-sync-protocol.mjs'

if (!existsSync(new URL('./dist/legacy-import.mjs', import.meta.url))) {
  console.log('• old CRM sync end to end: skipped (run `npm run build` first — it makes server/dist/legacy-import.mjs)')
  process.exit(0)
}
const { forTests } = await import('./legacySync.mjs')
const { buildImport } = await import('./dist/legacy-import.mjs')

const SECRET = 'test-secret-'.padEnd(40, 'x')
const old = {
  users: [
    { id: '1', name: 'Asha Mehta', email: 'asha@old.test', role: 'sales', status: 'active', created_at: '2026-01-02 10:00:00' },
    { id: '2', name: 'Ravi Shah', email: 'ravi@old.test', role: 'operation', status: 'active', created_at: '2026-01-02 10:00:00' },
  ],
  crm: [
    { id: '11', company_name: 'Alpha Foods Pvt Ltd', contact_person: 'Kiran Alpha', company_mobile: '9876500011', company_email: 'a@alpha.test', service: 'Seed Fund', status: 'Stage 2', submitted_by: '1', lead_closed_by_email: 'asha@old.test', assigned_to: '2', advance_amount: '10000', advance_with_gst: '11800', payment_date: '2026-01-05', created_at: '2026-01-05 11:00:00' },
    { id: '12', company_name: 'Beta Tech LLP', contact_person: 'Meera Beta', company_mobile: '9876500012', company_email: 'b@beta.test', service: 'Trademark', status: 'Pending', submitted_by: '1', lead_closed_by_email: 'asha@old.test', advance_amount: '5000', advance_with_gst: '5900', payment_date: '2026-01-06', created_at: '2026-01-06 12:00:00' },
  ],
}
// the old uploads folder (connector 1.2 `files` / `file`)
const disk = {
  'screenshots/SS_6ae5ab71d09c9_pay.jpeg': 'jpeg-bytes',
  'client_documents/9876500011/doc_9876500011_20260105_110245_aa.pdf': 'pdf-bytes',
  'client_documents/9876500011/extra_photo.jpg': 'jpg-bytes',
  'approved_pdfs/AlphaFoodsPvtLtd_SeedFund.pdf': 'agreement-bytes',
  'misc/orphan.png': 'png-bytes',
}
let filesApi = false
let calls = 0, refused = 0
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const action = u.searchParams.get('action') ?? ''
  const params = Object.fromEntries([...u.searchParams].filter(([k]) => k !== 'action'))
  const bad = await verifyRequest(SECRET, req.headers, action, params)
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (bad) { refused++; return send(401, { ok: false, error: bad }) }
  calls++
  if (action === 'ping') return send(200, { ok: true, app: 'rexera-connector', databases: { main: { tables: Object.keys(old) } }, ...(filesApi ? { files: true } : {}) })
  if (action === 'files') return send(200, { ok: true, total: Object.keys(disk).length, files: Object.entries(disk).slice(Number(params.offset), Number(params.offset) + Number(params.limit)).map(([path, b]) => ({ path, size: b.length, mtime: 1767600000 })) })
  if (action === 'file') {
    const p = String(params.path).replace(/^uploads\//, '')
    if (!(p in disk)) return send(404, { ok: false, error: 'File not found.' })
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(disk[p])
  }
  if (action === 'fingerprint') return send(200, { ok: true, fingerprint: { main: Object.fromEntries(Object.entries(old).map(([t, r]) => [t, `${r.length}:${JSON.stringify(r).length}`])) } })
  if (action === 'rows') {
    const rows = old[params.table] ?? []
    const off = Number(params.offset), lim = Number(params.limit)
    return send(200, { ok: true, columns: Object.keys(rows[0] ?? {}), rows: rows.slice(off, off + lim), total: rows.length })
  }
  send(400, { ok: false, error: 'Unknown action.' })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const env = (k) => ({ LEGACY_SYNC_SECRET: SECRET }[k])
const cfg = { url: `http://127.0.0.1:${server.address().port}/rexera-connector.php` }

// a wrong secret is refused by the connector
await assert.rejects(forTests.call((k) => ({ LEGACY_SYNC_SECRET: 'z'.repeat(40) }[k]), cfg, 'ping'), /Wrong signature/)
assert.equal(refused, 1)

/** one sync against an in-memory "new CRM" (the tables as Supabase would hold them) */
// a new CRM with nothing in it yet (a real one always has its incentive rules)
const emptyCrm = () => rowsToDb({ incentive_rule_versions: [{ version: 1, rules: {}, updated_at: '2026-01-01T00:00:00.000Z', updated_by: null }] }).db
async function sync(store, synced, prefer = 'new') {
  const ping = await forTests.call(env, cfg, 'ping')
  const { tables, rows } = await forTests.readOld(env, cfg, 'main', ping.databases.main.tables, () => false)
  const current = rowsToDb(store).db
  const { next } = buildImport(tables, current, { replaceSampleData: false })
  const nextRows = mapAll({ db: rowsToDb(mapAll({ db: next })).db })
  const plan = planWrites(mapAll({ db: current }), nextRows, synced, prefer)
  for (const [table, list] of Object.entries(plan.writes)) {
    const key = table === 'invoice_items' ? (r) => `${r.invoice_id}|${r.position}` : (r) => r.id
    const byKey = new Map((store[table] ?? []).map((r) => [key(r), r]))
    for (const r of list) byKey.set(key(r), r)
    store[table] = [...byKey.values()]
  }
  for (const h of plan.hashes) synced.set(`${h.table_name}|${h.row_key}`, h.hash)
  return { plan, rows }
}

const store = mapAll({ db: emptyCrm() }), synced = new Map()
// 1. first copy: both client files and their payments arrive, nothing kept or updated
let r = await sync(store, synced)
assert.equal(r.rows, 4, 'both tables read')
assert.deepEqual(store.bookings.map((b) => b.id).sort(), ['lg-b-11', 'lg-b-12'])
assert.ok(store.booking_payments.some((p) => p.booking_id === 'lg-b-11'), 'payment copied')
assert.equal(r.plan.counts.bookings.added, 2)
// 2. nothing changed in the old CRM → nothing written (no duplicates)
r = await sync(store, synced)
assert.deepEqual(r.plan.writes, {}, 'second run writes nothing')
// 3. the old CRM changes a client's email → applied (nobody touched it here)
old.crm[1].company_email = 'new@beta.test'
r = await sync(store, synced)
assert.equal(r.plan.counts.bookings.updated, 1)
assert.equal(store.bookings.find((b) => b.id === 'lg-b-12').email, 'new@beta.test')
// 4. someone edits the same client file in the new CRM, then the old CRM changes it again → the new CRM's work is kept
store.bookings = store.bookings.map((b) => (b.id === 'lg-b-12' ? { ...b, priority: 'HIGH' } : b))
old.crm[1].company_email = 'again@beta.test'
r = await sync(store, synced)
assert.equal(r.plan.counts.bookings.kept, 1)
assert.equal(store.bookings.find((b) => b.id === 'lg-b-12').priority, 'HIGH', 'new-CRM edit kept')
// 5. a new client in the old CRM → added, the others untouched
old.crm.push({ ...old.crm[0], id: '13', company_name: 'Gamma Agro', company_email: 'g@gamma.test', company_mobile: '9876500013' })
r = await sync(store, synced)
assert.equal(r.plan.counts.bookings.added, 1)
assert.equal(store.bookings.length, 3, 'never duplicated, never deleted')

// 6. self-repair: a database that refuses like Supabase does — bad values are repaired one by one and saved, a
//    payment whose client file is missing waits for it, and repairs are remembered for the next copy
const saved = {}
const users = new Set(['lg-u-1'])
const fakeDb = {
  from: (table) => ({
    upsert: async (rows) => {
      for (const r of rows) {
        if (table === 'bookings' && r.created_by && !users.has(r.created_by)) return { error: { message: 'insert or update on table "bookings" violates foreign key constraint "bookings_created_by_fkey"' } }
        if (table === 'bookings' && (r.stage < 1 || r.stage > 9)) return { error: { message: 'new row for relation "bookings" violates check constraint "bookings_stage_check"' } }
        if (table === 'bookings' && r.mode == null) return { error: { message: 'null value in column "mode" of relation "bookings" violates not-null constraint' } }
        if (table === 'booking_payments' && !saved.bookings?.some((b) => b.id === r.booking_id)) return { error: { message: 'insert or update on table "booking_payments" violates foreign key constraint "booking_payments_booking_id_fkey"' } }
      }
      ;(saved[table] ??= []).push(...rows)
      return { error: null }
    },
  }),
}
const repairs = {}, repaired = []
const bad = await forTests.writeRows(fakeDb, 'bookings', 'id', [
  { id: 'lg-b-1', created_by: 'lg-u-1', stage: 2, mode: 'Refundable' },
  { id: 'lg-b-2', created_by: 'lg-u-404', stage: 14, mode: null },   // three problems in one record
], repairs, repaired)
assert.deepEqual(bad, [], 'every record saved')
assert.deepEqual(saved.bookings.find((b) => b.id === 'lg-b-2'), { id: 'lg-b-2', created_by: null, stage: 9, mode: '' })
assert.deepEqual(repaired.map((x) => x.column).sort(), ['created_by', 'mode', 'stage'])
assert.deepEqual(repairs['bookings|lg-b-2'].stage, { from: 14, to: 9 }, 'remembered for the next copy')
const badPay = await forTests.writeRows(fakeDb, 'booking_payments', 'id', [{ id: 'lg-p-1', booking_id: 'lg-b-1' }, { id: 'lg-p-9', booking_id: 'lg-b-missing' }], repairs, repaired)
assert.equal(badPay.length, 1); assert.equal(badPay[0].parent, 'lg-b-missing', 'a payment never loses its client file — it waits for it')

// 7. files (connector 1.2): every upload copied once and linked where it belongs
filesApi = true
old.crm[0].payment_screenshot = 'SS_6ae5ab71d09c9_pay.jpeg'
old.client_documents = [{ id: '501', crm_id: '11', doc_type: 'KYC', doc_title: 'PAN card', original_file_name: 'pan.pdf', file_path: 'uploads/client_documents/9876500011/doc_9876500011_20260105_110245_aa.pdf', file_size: '9', uploaded_at: '2026-01-05 11:02:45', uploaded_by: '1' }]
await sync(store, synced)
const { syncUploads, fileLinkWrites } = await import('./legacySync.mjs')
const lib = await import('./dist/legacy-import.mjs')
const bucket = new Map()
async function files() {
  const current = rowsToDb(store).db
  const { next } = lib.buildImport((await forTests.readOld(env, cfg, 'main', Object.keys(old), () => false)).tables, current, { replaceSampleData: false })
  const list = await forTests.listOldFiles(env, cfg)
  const up = await syncUploads({
    list, lib, next, stored: new Set(bucket.keys()),
    fetchFile: (path) => forTests.call(env, cfg, 'file', { path }, { raw: true }),
    upload: async (id, buf, type) => { bucket.set(id, { buf: String(buf), type }) },
  })
  const w = fileLinkWrites(current, next, mapAll)
  // apply as the server does: only the proof / file columns, new documents, the unlinked list
  for (const p of w.payments) Object.assign(store.booking_payments.find((x) => x.id === p.id), { proof: p.proof, proof_name: p.proof_name })
  for (const d of w.docUpdates) Object.assign(store.booking_documents.find((x) => x.id === d.id), { file: d.file, size_bytes: d.size_bytes })
  store.booking_documents.push(...w.newDocs)
  store.legacy_files = [...(store.legacy_files ?? []).filter((x) => !w.archive.some((a) => a.path === x.path)), ...w.archive]
  return { up, w }
}
let f = await files()
assert.equal(f.up.copied, 5, 'every file in the uploads folder copied'); assert.equal(bucket.size, 5)
assert.equal(f.w.payments.length, 1, 'screenshot → the advance payment (found by name in a sub-folder)')
const pay = store.booking_payments.find((p) => p.id === 'lg-p-11-1')
assert.ok(pay.proof?.id.startsWith('lg-f-')); assert.equal(bucket.get(pay.proof.id).buf, 'jpeg-bytes'); assert.equal(pay.proof.type, 'image/jpeg')
const doc = store.booking_documents.find((d) => d.id === 'lg-d-501')
assert.equal(bucket.get(doc.file.id).buf, 'pdf-bytes', 'client document → its own record')
const added = store.booking_documents.filter((d) => d.booking_id === 'lg-b-11' && /^lg-d-(ag|up)-/.test(d.id))
assert.ok(added.some((d) => d.category === 'Agreement'), 'signed agreement → the client file'); assert.ok(added.some((d) => /^lg-d-up-/.test(d.id)), 'other upload in the client folder → the client file')
assert.deepEqual(store.legacy_files.map((x) => x.path), ['misc/orphan.png'], 'nothing lost: the rest kept as unlinked old files')
// again: nothing copied twice, nothing written twice; the import keeps the links
f = await files()
assert.equal(f.up.copied, 0); assert.deepEqual([f.w.payments.length, f.w.docUpdates.length, f.w.newDocs.length, f.w.archive.length], [0, 0, 0, 0])
r = await sync(store, synced)
assert.ok(store.booking_payments.find((p) => p.id === 'lg-p-11-1').proof, 'a later copy keeps the screenshot')
// a proof someone attached by hand in the new CRM is never replaced
store.booking_payments.find((p) => p.id === 'lg-p-11-1').proof = { id: 'file-hand', name: 'x.png', type: 'image/png', size: 1, at: '2026-01-01T00:00:00Z' }
f = await files()
assert.equal(f.w.payments.length, 0, 'hand-attached proof kept')

server.close()
console.log(`✓ old CRM sync end to end: signed reads (${calls} calls, wrong secret refused), first copy, no duplicates, old-CRM change applied, new-CRM work kept, new client added, refused data repaired and saved, every uploaded file copied once and linked (screenshots, documents, agreements, client folders, the rest kept)`)
