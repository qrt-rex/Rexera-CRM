#!/usr/bin/env node
/**
 * Uploads the old CRM's files (payment screenshots, agreements, client documents) to the private "crm-files" bucket,
 * so client files imported from the old CRM open on every computer once the CRM runs on Supabase.
 *
 *   node supabase/upload-old-crm-files.mjs <folder> [--dry-run]
 *
 * <folder> is the same folder chosen in IT → Legacy import → old CRM files: the export folder (scarp_data), its
 * all_uploads_raw folder, or the old server's uploads folder. Each file gets the id the CRM already uses for it
 * (lg-f-…, from its path), so the links in the client files work as they are. Files already uploaded are skipped,
 * so it can be run again after an interruption.
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or .env / .env.local — run it on a trusted computer.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const folder = args.find((a) => !a.startsWith('--'))
const dry = args.includes('--dry-run')
if (!folder || !existsSync(folder)) { console.error('Usage: node supabase/upload-old-crm-files.mjs <old CRM uploads folder> [--dry-run]'); process.exit(1) }

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY
if (!dry && (!URL_ || !KEY?.startsWith('sb_secret_'))) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_…) in .env'); process.exit(1) }

// the same path → id rules the app used when it linked these files (src/lib/legacyFiles.ts)
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { legacyFileId, uploadsPaths, mimeOf } = await vite.ssrLoadModule('/src/lib/legacyFiles.ts')
await vite.close()

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const disk = walk(folder)
// paths as a browser gives them for a chosen folder: "<folder name>/sub/file"
const paths = uploadsPaths(disk.map((p) => `${basename(folder)}/${relative(folder, p)}`.replace(/\\/g, '/')))
const todo = disk.map((p, i) => ({ file: p, path: paths[i] })).filter((x) => x.path).map((x) => ({ ...x, id: legacyFileId(x.path), size: statSync(x.file).size }))
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`
console.log(`${todo.length} old CRM files in ${folder} (${mb(todo.reduce((s, x) => s + x.size, 0))})`)
if (dry) { for (const x of todo.slice(0, 5)) console.log(`  ${x.id}  ${x.path}`); console.log('Dry run — nothing was uploaded.'); process.exit(0) }

const store = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from('crm-files')
const have = new Set()
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await store.list('', { limit: 1000, offset, search: 'lg-f-' })
  if (error) { console.error(`✗ listing the bucket: ${error.message}`); process.exit(1) }
  for (const o of data) have.add(o.name)
  if (data.length < 1000) break
}
const left = todo.filter((x) => !have.has(x.id))
console.log(`${todo.length - left.length} already uploaded · ${left.length} to go`)

let done = 0, failed = 0
const worker = async () => {
  for (let x = left.shift(); x; x = left.shift()) {
    const { error } = await store.upload(x.id, readFileSync(x.file), { contentType: mimeOf(x.path), upsert: false })
    if (error && !/exists|duplicate/i.test(error.message)) { failed++; console.error(`✗ ${x.path}: ${error.message}`) } else done++
    if (done % 100 === 0) console.log(`  ${done} uploaded…`)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log(`\nDone · ${done} uploaded${failed ? ` · ${failed} failed (run again to retry)` : ''}`)
process.exit(failed ? 1 : 0)
