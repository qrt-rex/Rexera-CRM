#!/usr/bin/env node
/**
 * Sets a person's CRM sign-in password directly in Supabase (no email needed) — for the first Super Admin after the
 * switch-over, or anyone locked out. Everyone else can then get their password from Employees → Set password.
 *
 *   node supabase/set-password.mjs <email>
 *
 * The person must already be a CRM user in Supabase (npm run db:migrate). Creates their sign-in account if missing
 * and links it. The password is typed at the prompt, not on the command line. Reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY from the environment or .env / .env.local — run it on a trusted computer.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const email = (process.argv[2] ?? '').trim().toLowerCase()
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY
if (!email.includes('@')) { console.error('Usage: node supabase/set-password.mjs <email>'); process.exit(1) }
if (!URL_ || !KEY?.startsWith('sb_secret_')) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_…) in .env'); process.exit(1) }

const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: crm, error } = await sb.from('app_users').select('id, name, email, active, auth_user_id').ilike('email', email).maybeSingle()
if (error) { console.error(`✗ ${error.message}`); process.exit(1) }
if (!crm) { console.error(`✗ No CRM user with the email ${email} in Supabase. Copy the data first: npm run db:migrate -- backup.json --create-auth-users`); process.exit(1) }
if (!crm.active) { console.error(`✗ ${crm.name}'s account is deactivated in the CRM.`); process.exit(1) }

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = (await rl.question(`New password for ${crm.name} (8–16 chars, upper + lower case, a number and a symbol): `)).trim()
rl.close()
if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/.test(password)) { console.error('✗ Use 8–16 characters with upper case, lower case, a number and a symbol.'); process.exit(1) }

let authId = crm.auth_user_id
if (authId) {
  const { error: e } = await sb.auth.admin.updateUserById(authId, { password, email_confirm: true })
  if (e) { console.error(`✗ ${e.message}`); process.exit(1) }
} else {
  const { data, error: e } = await sb.auth.admin.createUser({ email: crm.email, password, email_confirm: true, user_metadata: { name: crm.name, crm_user_id: crm.id } })
  if (e && !/registered|exists/i.test(e.message)) { console.error(`✗ ${e.message}`); process.exit(1) }
  if (e) {
    // a sign-in account with this email exists but isn't linked yet: link it and set its password
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
    authId = list?.users.find((u) => u.email?.toLowerCase() === crm.email.toLowerCase())?.id
    if (!authId) { console.error(`✗ ${e.message}`); process.exit(1) }
    const { error: e3 } = await sb.auth.admin.updateUserById(authId, { password, email_confirm: true })
    if (e3) { console.error(`✗ ${e3.message}`); process.exit(1) }
  } else authId = data.user.id
  const { error: e2 } = await sb.from('app_users').update({ auth_user_id: authId }).eq('id', crm.id)
  if (e2) { console.error(`✗ ${e2.message}`); process.exit(1) }
}
console.log(`✓ ${crm.name} can now sign in with ${crm.email} and that password.`)
