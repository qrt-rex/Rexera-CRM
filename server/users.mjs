// Passwords with Supabase sign-in (VITE_DATA_BACKEND=supabase): HR / access managers set a person's password, which
// creates that person's Supabase sign-in account the first time. Shared by server.mjs (live) and the Vite dev server.
// Needs SUPABASE_SECRET_KEY, which bypasses row-level security — server only, never a VITE_ variable.
import { createClient } from '@supabase/supabase-js'

const reply = (status, body) => ({ status, body })
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/

/** POST /api/users/password — `env` reads a setting, `authorization` is the request's header. */
export async function setPassword(env, authorization, body) {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
  const secret = env('SUPABASE_SECRET_KEY') || '', publishable = env('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !secret.startsWith('sb_secret_') || !publishable) return reply(503, { success: false, message: 'Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server (Render → Environment).' })
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  const { userId, password } = body ?? {}
  if (typeof userId !== 'string' || !userId) return reply(422, { success: false, message: 'Missing user.' })
  if (typeof password !== 'string' || !PASSWORD_RULE.test(password)) return reply(422, { success: false, message: 'Password: 8–16 characters with upper case, lower case, a number and a symbol.' })

  const opts = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(url, secret, opts)
  const { data: { user: caller } } = await admin.auth.getUser(token)
  if (!caller) return reply(401, { success: false, message: 'Sign in again.' })

  const rolesOf = async (id) => {
    const [{ data: u }, { data: extra }] = await Promise.all([
      admin.from('app_users').select('role').eq('id', id).maybeSingle(),
      admin.from('user_extra_roles').select('role').eq('user_id', id),
    ])
    return [u?.role, ...(extra ?? []).map((x) => x.role)]
  }
  const { data: me } = await admin.from('app_users').select('id').eq('auth_user_id', caller.id).maybeSingle()
  if (!me) return reply(403, { success: false, message: 'Your sign-in is not linked to a CRM account.' })
  if ((await rolesOf(userId)).includes('superadmin') && !(await rolesOf(me.id)).includes('superadmin')) {
    return reply(403, { success: false, message: "Only a Super Admin can set a Super Admin's password." })
  }
  // row-level security decides: the caller's own sign-in may change this row only if they manage people (or it's them)
  const asCaller = createClient(url, publishable, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: rows, error } = await asCaller.from('app_users').update({ needs_password_reset: false }).eq('id', userId).select('id, email, name, auth_user_id')
  if (error || !rows?.length) return reply(403, { success: false, message: error?.message || "You can't set this person's password." })
  const target = rows[0]

  if (target.auth_user_id) {
    const { error: e } = await admin.auth.admin.updateUserById(target.auth_user_id, { password })
    if (e) return reply(400, { success: false, message: e.message })
  } else {
    const { data, error: e } = await admin.auth.admin.createUser({ email: target.email, password, email_confirm: true, user_metadata: { name: target.name, crm_user_id: target.id } })
    if (e) return reply(400, { success: false, message: /registered|exists/i.test(e.message) ? `A sign-in account already exists for ${target.email} — link it in Supabase or use another email.` : e.message })
    const { error: e2 } = await admin.from('app_users').update({ auth_user_id: data.user.id }).eq('id', target.id)
    if (e2) return reply(500, { success: false, message: e2.message })
  }
  return reply(200, { success: true })
}

/**
 * The CRM user behind a Supabase sign-in (Authorization: Bearer <access token>), or null. Lets the server check who is
 * calling (dialer, IVR) without per-computer access keys once the CRM signs in with Supabase.
 */
export async function crmUser(env, authorization) {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
  const secret = env('SUPABASE_SECRET_KEY') || ''
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  if (!url || !secret.startsWith('sb_secret_') || !token) return null
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return null
  const { data: me } = await admin.from('app_users').select('id, email, role, active').eq('auth_user_id', user.id).maybeSingle()
  if (!me?.active) return null
  const { data: extra } = await admin.from('user_extra_roles').select('role').eq('user_id', me.id)
  return { id: me.id, email: me.email, roles: [me.role, ...(extra ?? []).map((x) => x.role)] }
}
