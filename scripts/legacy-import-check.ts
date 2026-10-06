// Runs the real importer (src/lib/legacyImport.ts) on an old-CRM .sql dump without a browser and prints the
// verification report — the same checks the Import screen shows. Usage:
//   npx rolldown scripts/legacy-import-check.ts --platform node --format esm -o .tmp/legacy-check.mjs && node .tmp/legacy-check.mjs <dump.sql>
import { readFileSync } from 'node:fs'
import { buildSeed } from '../src/lib/seed'
import { upgradeDb } from '../src/lib/hrsuite'
import { buildImport, parseDump } from '../src/lib/legacyImport'

const file = process.argv[2]
if (!file) { console.error('Usage: node .tmp/legacy-check.mjs <dump.sql>'); process.exit(1) }
const tables = parseDump(readFileSync(file, 'utf8'))
const current = upgradeDb(await buildSeed())
const { next, report } = buildImport(tables, current, { replaceSampleData: true })

console.log('CHECKS')
for (const c of report.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(46)} old: ${c.legacy.padEnd(18)} new: ${c.imported}`)
console.log('\nIMPORTED', JSON.stringify(report.imported))
console.log('\nSTATUS MAP'); for (const s of report.statusMap) console.log(`  ${String(s.count).padStart(5)}  ${s.legacy.padEnd(42)} → ${s.becomes}`)
console.log('\nROLE MAP'); for (const r of report.roleMap) console.log(`  ${String(r.count).padStart(5)}  ${r.legacy.padEnd(30)} → ${r.becomes}`)
console.log('\nNOTES'); for (const n of report.notes) console.log('  - ' + n)
console.log('\nSKIPPED'); for (const s of report.skipped) console.log('  - ' + s)
// spot-check: every original column is still on the record, unchanged
const sample = next.bookings.filter((b) => b.legacy).slice(0, 500)
const lossless = sample.every((b) => tables.crm!.rows.some((r) => r.id === String(b.legacyId) && JSON.stringify(r) === JSON.stringify(b.legacy!.crm)))
console.log(`\nLOSSLESS original rows kept on records (500 checked): ${lossless ? 'yes' : 'NO'}`)
console.log(`DATA SIZE after import: ${(JSON.stringify(next).length / 1048576).toFixed(1)} MB · users ${next.users.length} · client files ${next.bookings.length}`)
console.log(`USERS needing a password reset: ${next.users.filter((u) => u.needsPasswordReset).length}`)
const noOwner = next.bookings.filter((b) => !b.createdBy).length
console.log(`FILES without a known sales owner: ${noOwner}`)
