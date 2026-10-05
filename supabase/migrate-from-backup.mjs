#!/usr/bin/env node
/**
 * Copies a Rexera CRM backup (IT → Data Backup → Download backup) into the Supabase tables created by
 * supabase/migrations/20261006000000_rexera_schema.sql.
 *
 *   node supabase/migrate-from-backup.mjs <backup.json> [--passphrase "…"] [--dry-run] [--create-auth-users]
 *
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or from .env.local (never commit that file).
 * The secret key bypasses row-level security, so this script must only ever run on a trusted machine/server.
 * Re-runnable: every table is upserted by its primary key; the audit log is only copied into an empty table.
 * --create-auth-users creates a Supabase Auth account (no password) for each active user and links it; people
 * then set their password with "Forgot password" / an invite from the Supabase dashboard.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { APPEND_ONLY, ORDER, mapAll } from './backup-mapping.mjs'

// ------------------------------------------------------------------ config
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const flag = (n) => args.includes(`--${n}`)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
if (!file) { console.error('Usage: node supabase/migrate-from-backup.mjs <backup.json> [--passphrase "…"] [--dry-run] [--create-auth-users]'); process.exit(1) }

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SECRET_KEY
const dry = flag('dry-run')
if (!dry && (!URL_ || !/^https:\/\/.+\.supabase\.(co|in)\/?$/.test(URL_))) { console.error('Set SUPABASE_URL (https://<project-ref>.supabase.co) in .env.local'); process.exit(1) }
if (!dry && !KEY?.startsWith('sb_secret_')) { console.error('Set SUPABASE_SECRET_KEY (sb_secret_…) in .env.local'); process.exit(1) }

// ------------------------------------------------------------------ read (and decrypt) the backup
async function readBackup() {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (raw?.app !== 'rexera-crm' || raw.format !== 1) throw new Error('Not a Rexera CRM backup file.')
  if (!raw.encrypted) return raw
  const pass = opt('passphrase')
  if (!pass) throw new Error('This backup is encrypted — add --passphrase "…"')
  const b = (s) => Uint8Array.from(Buffer.from(s, 'base64'))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(raw.salt), iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  try {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(raw.iv) }, key, b(raw.data))))
  } catch { throw new Error('Wrong passphrase, or the file is damaged.') }
}


// ------------------------------------------------------------------ run
const backup = await readBackup()
const rows = mapAll(backup)
console.log(`Backup from ${backup.exportedAt} by ${backup.exportedBy} · app data version ${backup.db.version}`)
if (dry) {
  for (const [table] of ORDER) console.log(`  ${table.padEnd(26)} ${String(rows[table]?.length ?? 0).padStart(6)} rows`)
  for (const table of APPEND_ONLY) console.log(`  ${table.padEnd(26)} ${String(rows[table].length).padStart(6)} rows (only into an empty table)`)
  console.log('\nDry run — nothing was written.')
  process.exit(0)
}

const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
let total = 0
for (const [table, onConflict] of ORDER) {
  const list = rows[table] ?? []
  const target = table === 'app_users_team' ? 'app_users' : table
  for (const part of chunk(list, 500)) {
    const q = table === 'app_users_team'
      ? Promise.all(part.map((r) => sb.from('app_users').update({ team_lead_id: r.team_lead_id }).eq('id', r.id)))
      : sb.from(target).upsert(part, { onConflict })
    const res = await q
    const err = Array.isArray(res) ? res.find((x) => x.error)?.error : res.error
    if (err) { console.error(`✗ ${table}: ${err.message}`); process.exit(1) }
  }
  total += list.length
  console.log(`✓ ${table.padEnd(26)} ${list.length}`)
}
for (const table of APPEND_ONLY) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (error) { console.error(`✗ ${table}: ${error.message}`); process.exit(1) }
  if (count) { console.log(`• ${table.padEnd(26)} skipped (already has ${count} rows)`); continue }
  for (const part of chunk(rows[table], 500)) {
    const { error: e } = await sb.from(table).insert(part)
    if (e) { console.error(`✗ ${table}: ${e.message}`); process.exit(1) }
  }
  total += rows[table].length
  console.log(`✓ ${table.padEnd(26)} ${rows[table].length}`)
}

if (flag('create-auth-users')) {
  const { data: existing, error } = await sb.auth.admin.listUsers({ perPage: 1000 })
  if (error) { console.error(`✗ auth users: ${error.message}`); process.exit(1) }
  const byEmail = new Map(existing.users.map((u) => [u.email?.toLowerCase(), u.id]))
  for (const u of backup.db.users.filter((x) => x.active)) {
    let authId = byEmail.get(u.email.toLowerCase())
    if (!authId) {
      const r = await sb.auth.admin.createUser({ email: u.email.toLowerCase(), email_confirm: true, user_metadata: { name: u.name, crm_user_id: u.id } })
      if (r.error) { console.error(`✗ auth user ${u.email}: ${r.error.message}`); continue }
      authId = r.data.user.id
    }
    const { error: e } = await sb.from('app_users').update({ auth_user_id: authId }).eq('id', u.id)
    console.log(e ? `✗ link ${u.email}: ${e.message}` : `✓ auth account linked · ${u.email}`)
  }
}
console.log(`\nDone · ${total} rows written to ${new URL(URL_).host}`)
