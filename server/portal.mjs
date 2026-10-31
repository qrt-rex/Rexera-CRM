// Client portal on the live server (SUPABASE_SECRET_KEY, server only). Clients never read a table or a file
// themselves: every answer here is built from the CRM entries linked to their own account, and staff-only parts
// (internal notes, staff history, who did what) never leave the server.
//  * /api/portal-admin/<action> — IT Support only: create a client's login (ID + password) or invite them by email,
//    set a new password, link CRM entries, approve (re-enable) or deactivate, sign them out everywhere, assign a team member.
//  * /api/portal/<action> — the client, with their own Supabase sign-in: their projects, documents (upload / open),
//    milestones and progress, updates, notices, activity, and their profile.
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_STAGES } from '../supabase/workflow-rules.mjs'
import { fileProblem } from '../supabase/form-rules.mjs'
import { clientMayUpload, docStatus, mayManagePortalLogins, portalPasswordProblem, projectProgress } from '../supabase/portal-rules.mjs'
import { forClient } from '../supabase/media-rules.mjs'

const BUCKET = 'crm-files'
const reply = (status, body) => ({ status, body })
const fail = (status, message, extra = {}) => reply(status, { success: false, message, ...extra })
const newId = (p) => `${p}${randomBytes(9).toString('base64url')}`
const normEmail = (v) => String(v ?? '').trim().toLowerCase()
const isEmail = (s) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s) && s.length <= 254
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
/** what a client is shown from their own activity (staff-side entries stay in the CRM) */
const CLIENT_SEES = { INVITED: 'Invited to the portal', CREATED: 'Portal login created', ACTIVATED: 'Portal account set up', SIGNED_IN: 'Signed in', UPLOADED: 'Uploaded a document', PROFILE: 'Profile updated', REQUEST: 'Message sent to the team', ACCESS_RESET: 'Password reset link sent', PASSWORD_SET: 'Password changed by REXERA' }

export const portalClientFor = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

async function rows(q) {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}
const rowsIn = (sb, table, col, values, cols = '*') => (values.length ? rows(sb.from(table).select(cols).in(col, values)) : Promise.resolve([]))
async function one(q) {
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
async function write(q) {
  const { error } = await q
  if (error) throw new Error(error.message)
}
const activity = (sb, acct, at, action, detail, extra = {}) => write(sb.from('client_activity').insert({ id: newId('cact-'), account_id: acct.id, at, action, detail: detail ?? null, booking_id: extra.bookingId ?? null, by_user: extra.by ?? null }))
const audit = (sb, at, by, action, detail) => sb.from('audit_log').insert({ at, by_user: by, action, detail }).then(() => undefined, () => undefined)
const notify = (sb, to, at, title, body, link) => {
  const list = [...new Set(to.filter(Boolean))]
  return list.length ? sb.from('notifications').insert(list.map((user_id) => ({ id: newId('n-'), user_id, title, body, link, kind: 'action', created_at: at }))).then(() => undefined, () => undefined) : Promise.resolve()
}

/** Client logins (create, password, link, deactivate) are IT Support's alone — not even the Super Admin's. */
export const mayManagePortal = (who) => !!who && mayManagePortalLogins(who.roles)

// ======================================================================================== Super Admin side
/**
 * POST /api/portal-admin/<action>. `who` = crmUser(...) (null when not signed in). `deps`: { client, now, appUrl,
 * sendEmail(body, { button }) → { success, message } }.
 */
export async function portalAdmin(env, who, action, body, deps = {}) {
  const sb = deps.client ?? portalClientFor(env)
  if (!sb) return fail(503, 'The client portal needs SUPABASE_URL and SUPABASE_SECRET_KEY on the server.')
  if (!who) return fail(401, 'Sign in again.')
  if (!mayManagePortal(who)) return fail(403, 'Only IT Support creates and manages client portal logins.')
  const ctx = { sb, who, body: body ?? {}, at: (deps.now ?? new Date()).toISOString(), appUrl: String(env('APP_URL') || deps.appUrl || '').replace(/\/+$/, ''), sendEmail: deps.sendEmail ?? (async () => ({ success: false, message: 'Email is not set up.' })) }
  const fn = ADMIN_ACTIONS[action]
  return fn ? fn(ctx) : fail(404, 'Unknown action.')
}

async function accountOf(sb, accountId) {
  if (typeof accountId !== 'string' || !accountId) return null
  return one(sb.from('client_accounts').select('*').eq('id', accountId))
}
/** Checks a set of CRM entries for an account: they exist, the email matches theirs (unless confirmed), none is in another account. */
async function checkEntries(sb, ids, email, override, accountId) {
  if (!ids.length) return { error: fail(422, 'Pick at least one CRM entry.') }
  if (ids.length > 20) return { error: fail(422, 'Up to 20 CRM entries per account.') }
  const bookings = await rowsIn(sb, 'bookings', 'id', ids, 'id, booking_code, company_name, contact_person, email, payment_email, mobile, ops_member_id')
  if (bookings.length !== ids.length) return { error: fail(404, 'A CRM entry was not found.') }
  if (!override) {
    const other = bookings.filter((b) => ![b.email, b.payment_email].map(normEmail).includes(email))
    if (other.length) return { error: fail(409, `${email} isn't the email saved on ${other.map((b) => b.booking_code).join(', ')}. Check it, or confirm to go ahead anyway.`, { code: 'EMAIL_MISMATCH' }) }
  }
  const accounts = await rows(sb.from('client_accounts').select('id, email, booking_ids'))
  const taken = bookings.filter((b) => accounts.some((a) => a.id !== accountId && (a.booking_ids ?? []).includes(b.id)))
  if (taken.length) return { error: fail(409, `${taken.map((b) => b.booking_code).join(', ')} is already linked to another client's portal account.`, { code: 'TAKEN' }) }
  return { bookings, accounts }
}
const sender = (who) => ({ name: 'Rexera Client Desk', role: 'Client portal', ...(isEmail(who?.email ?? '') ? { email: who.email } : {}) })

/** A sign-in link for the account (invite while it was never used, else a password reset) and the email with it. */
async function sendAccessLink(ctx, acct, kind) {
  const { sb, appUrl } = ctx
  const redirectTo = `${appUrl}/portal/welcome${kind === 'recovery' ? '?reset=1' : ''}`
  let r = await sb.auth.admin.generateLink({ type: kind, email: acct.email, options: { redirectTo } })
  // an invited person who already confirmed: a reset link does the same job
  if (r.error && kind === 'invite') r = await sb.auth.admin.generateLink({ type: 'recovery', email: acct.email, options: { redirectTo: `${appUrl}/portal/welcome?reset=1` } })
  if (r.error) return { error: r.error.message }
  const link = r.data?.properties?.action_link
  const invite = kind === 'invite'
  const mail = await ctx.sendEmail({
    to: acct.email, subject: invite ? 'Your Rexera client portal account' : 'Reset your Rexera client portal password',
    heading: invite ? 'Welcome to your client portal' : 'Reset your portal password',
    message: invite
      ? `Dear ${acct.name},\n\nYou can now follow your project with Rexera online: see your documents and what is still needed, upload files, and track milestones and updates.\n\nUse the button below to set your password. The link works once and expires after a short time — ask us for a new one if it has expired.`
      : `Dear ${acct.name},\n\nUse the button below to choose a new password for your client portal. If you didn't ask for this, you can ignore this email.`,
    sender: sender(ctx.who), company: 'Rexera',
  }, { button: { label: invite ? 'Set my password' : 'Choose a new password', url: link } })
  return { userId: r.data?.user?.id, mail }
}

/** The checks "create" and "invite" share — email, CRM entries, one account per email, not a staff email — and the new account row. */
async function newAccount(ctx) {
  const { sb, who, body, at } = ctx
  const email = normEmail(body.email)
  if (!isEmail(email)) return { error: fail(422, 'Enter the client’s email address (their login ID).') }
  const ids = [...new Set((Array.isArray(body.bookingIds) ? body.bookingIds : []).filter((x) => typeof x === 'string' && x))]
  const chk = await checkEntries(sb, ids, email, !!body.override)
  if (chk.error) return chk
  if (chk.accounts.some((a) => normEmail(a.email) === email)) return { error: fail(409, 'This client already has a portal account — link the entry to that account instead.', { code: 'EXISTS', accountId: chk.accounts.find((a) => normEmail(a.email) === email).id }) }
  if (await one(sb.from('app_users').select('id').eq('email', email))) return { error: fail(409, 'This email belongs to a CRM staff login — use the client’s own email.') }
  if (body.assignedTo && !(await one(sb.from('app_users').select('id').eq('id', body.assignedTo).eq('active', true)))) return { error: fail(422, 'Pick an active team member.') }
  const first = chk.bookings[0]
  return {
    bookings: chk.bookings,
    acct: {
      id: newId('ca-'), email, name: clean(body.name, 80) || first.contact_person || first.company_name, phone: /^\d{10}$/.test(String(body.phone ?? '')) ? body.phone : first.mobile ?? null,
      booking_ids: ids, status: 'INVITED', invited_at: at, invited_by: who.id, assigned_to: body.assignedTo || first.ops_member_id || null,
    },
  }
}
/** Saves the new account; if that fails, the sign-in made for it is removed again. */
async function insertAccount(sb, acct) {
  const { error } = await sb.from('client_accounts').insert(acct)
  if (!error) return null
  if (acct.auth_user_id) await sb.auth.admin.deleteUser(acct.auth_user_id).catch(() => undefined)
  return fail(409, /duplicate|unique|already linked/i.test(error.message) ? 'This client or entry was just linked by someone else — refresh and try again.' : error.message)
}
const signInTaken = (msg) => /registered|exists/i.test(msg) ? 'A sign-in already exists for this email (perhaps a staff login) — use another email.' : msg

const ADMIN_ACTIONS = {
  /**
   * { email (the login ID), password, name?, phone?, bookingIds[], assignedTo?, override? } — IT Support gives the client
   * their login: it works at once, no email needed. The password is never stored or logged here; the client can change it.
   */
  async create(ctx) {
    const { sb, who, body, at } = ctx
    const bad = portalPasswordProblem(body.password, normEmail(body.email))
    if (bad) return fail(422, bad)
    const r = await newAccount(ctx)
    if (r.error) return r.error
    const { acct, bookings } = r
    const { data, error } = await sb.auth.admin.createUser({ email: acct.email, password: String(body.password), email_confirm: true, app_metadata: { portal: true } })
    if (error) return fail(409, signInTaken(error.message))
    acct.auth_user_id = data?.user?.id ?? null
    const failed = await insertAccount(sb, acct)
    if (failed) return failed
    await activity(sb, acct, at, 'CREATED', `Login created by IT Support — ID ${acct.email}`, { by: who.id, bookingId: acct.booking_ids[0] })
    await audit(sb, at, who.id, 'PORTAL_CREATE', `${acct.email} · ${bookings.map((b) => b.booking_code).join(', ')}`)
    return reply(200, { success: true, accountId: acct.id, message: `Login created for ${acct.email} — share the ID and password with the client.` })
  },

  /** { accountId, password } — IT Support sets a new password; the client is signed out on their other devices. */
  async password(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    if (!acct.auth_user_id) return fail(409, 'This account has no sign-in yet — create the login again.')
    const bad = portalPasswordProblem(body.password, acct.email)
    if (bad) return fail(422, bad)
    const { error } = await sb.auth.admin.updateUserById(acct.auth_user_id, { password: String(body.password), email_confirm: true })
    if (error) return fail(502, error.message)
    await sb.rpc('portal_revoke_sessions', { uid: acct.auth_user_id }).then(() => undefined, () => undefined)
    await activity(sb, acct, at, 'PASSWORD_SET', 'New password set by IT Support — signed out on other devices', { by: who.id })
    await audit(sb, at, who.id, 'PORTAL_PASSWORD', acct.email)
    return reply(200, { success: true, message: `New password saved for ${acct.email} — share it with the client.` })
  },

  /** { email, name?, phone?, bookingIds[], assignedTo?, override? } — the client sets their own password from an email link */
  async invite(ctx) {
    const { sb, who, at } = ctx
    const r = await newAccount(ctx)
    if (r.error) return r.error
    const { acct, bookings } = r
    const email = acct.email
    const sent = await sendAccessLink(ctx, acct, 'invite')
    if (sent.error) return fail(400, signInTaken(sent.error))
    acct.auth_user_id = sent.userId ?? null
    const failed = await insertAccount(sb, acct)
    if (failed) return failed
    await activity(sb, acct, at, 'INVITED', `Invited by email to ${email}${sent.mail?.success ? '' : ' (email not sent)'}`, { by: who.id, bookingId: acct.booking_ids[0] })
    await audit(sb, at, who.id, 'PORTAL_INVITE', `${email} · ${bookings.map((b) => b.booking_code).join(', ')}`)
    return reply(200, { success: true, accountId: acct.id, emailed: !!sent.mail?.success, message: sent.mail?.success ? `Invite sent to ${email}.` : `Account created, but the email could not be sent: ${sent.mail?.message ?? 'unknown error'} — use “Send link again”.` })
  },

  /** { accountId } — invite again (never signed in) or a password reset link (account in use) */
  async 'send-link'(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    if (acct.status === 'DISABLED') return fail(409, 'This account is deactivated — approve it again first.')
    const kind = acct.activated_at ? 'recovery' : 'invite'
    const sent = await sendAccessLink(ctx, acct, kind)
    if (sent.error) return fail(400, sent.error)
    if (!acct.auth_user_id && sent.userId) await write(sb.from('client_accounts').update({ auth_user_id: sent.userId }).eq('id', acct.id))
    await activity(sb, acct, at, kind === 'invite' ? 'INVITED' : 'ACCESS_RESET', `${kind === 'invite' ? 'Invite sent again' : 'Password reset link sent'}${sent.mail?.success ? '' : ' (email not sent)'}`, { by: who.id })
    return sent.mail?.success ? reply(200, { success: true, message: `Link sent to ${acct.email}.` }) : fail(502, `The email could not be sent: ${sent.mail?.message ?? 'unknown error'}`)
  },

  /** { accountId, active: boolean } — approve (re-enable) or deactivate; deactivating also ends every session */
  async status(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    const active = body.active === true
    if (acct.auth_user_id) {
      const { error } = await sb.auth.admin.updateUserById(acct.auth_user_id, { ban_duration: active ? 'none' : '876000h' })
      if (error) return fail(502, error.message)
      if (!active) await sb.rpc('portal_revoke_sessions', { uid: acct.auth_user_id }).then(() => undefined, () => undefined)
    }
    const status = active ? (acct.activated_at ? 'ACTIVE' : 'INVITED') : 'DISABLED'
    await write(sb.from('client_accounts').update({ status, disabled_at: active ? null : at }).eq('id', acct.id))
    await activity(sb, acct, at, active ? 'APPROVED' : 'DEACTIVATED', active ? 'Access approved' : 'Access deactivated — signed out everywhere', { by: who.id })
    await audit(sb, at, who.id, active ? 'PORTAL_APPROVE' : 'PORTAL_DEACTIVATE', acct.email)
    return reply(200, { success: true, status })
  },

  /** { accountId } — sign the client out on every device */
  async revoke(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    if (!acct.auth_user_id) return fail(409, 'This client has not signed in yet.')
    const { error } = await sb.rpc('portal_revoke_sessions', { uid: acct.auth_user_id })
    if (error) return fail(502, `Could not end the sessions: ${error.message}`)
    await activity(sb, acct, at, 'SESSIONS_REVOKED', 'Signed out on every device', { by: who.id })
    await audit(sb, at, who.id, 'PORTAL_REVOKE', acct.email)
    return reply(200, { success: true })
  },

  /** { accountId, bookingIds[] (the full list), override? } */
  async link(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    const ids = [...new Set((Array.isArray(body.bookingIds) ? body.bookingIds : []).filter((x) => typeof x === 'string' && x))]
    const added = ids.filter((x) => !acct.booking_ids.includes(x)), removed = acct.booking_ids.filter((x) => !ids.includes(x))
    if (!added.length && !removed.length) return reply(200, { success: true })
    const chk = await checkEntries(sb, ids, normEmail(acct.email), true, acct.id)
    if (chk.error) return chk.error
    // only the newly linked entries need the email check
    if (added.length && !body.override) { const c = await checkEntries(sb, added, normEmail(acct.email), false, acct.id); if (c.error) return c.error }
    const { error } = await sb.from('client_accounts').update({ booking_ids: ids }).eq('id', acct.id)
    if (error) return fail(409, /already linked/i.test(error.message) ? 'An entry is already linked to another client’s account.' : error.message)
    const codes = new Map((await rowsIn(sb, 'bookings', 'id', [...added, ...removed], 'id, booking_code')).map((b) => [b.id, b.booking_code]))
    await activity(sb, acct, at, 'LINKED', [added.length && `Linked ${added.map((x) => codes.get(x)).join(', ')}`, removed.length && `Unlinked ${removed.map((x) => codes.get(x)).join(', ')}`].filter(Boolean).join(' · '), { by: who.id, bookingId: added[0] ?? removed[0] })
    await audit(sb, at, who.id, 'PORTAL_LINK', `${acct.email}: ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}`)
    return reply(200, { success: true })
  },

  /** { accountId, userId | null } — the client's contact person in the team */
  async assign(ctx) {
    const { sb, who, body, at } = ctx
    const acct = await accountOf(sb, body.accountId)
    if (!acct) return fail(404, 'Portal account not found.')
    const u = body.userId ? await one(sb.from('app_users').select('id, name').eq('id', body.userId).eq('active', true)) : null
    if (body.userId && !u) return fail(422, 'Pick an active team member.')
    await write(sb.from('client_accounts').update({ assigned_to: u?.id ?? null }).eq('id', acct.id))
    await activity(sb, acct, at, 'ASSIGNED', u ? `Assigned to ${u.name}` : 'Team member removed', { by: who.id })
    if (u) await notify(sb, [u.id], at, 'Client portal: client assigned to you', `${acct.name} · ${acct.email}`, '/client-portal')
    return reply(200, { success: true })
  },
}

// ======================================================================================== client side
const limits = new Map()
function limited(key, max, ms, now = Date.now()) {
  const list = (limits.get(key) ?? []).filter((t) => now - t < ms)
  list.push(now)
  limits.set(key, list)
  if (limits.size > 5000) for (const [k, v] of limits) if (!v.some((t) => now - t < 3600_000)) limits.delete(k)
  return list.length > max
}

/** The portal account behind a client's sign-in, or an error answer. Staff sign-ins and deactivated accounts are refused. */
async function signedInClient(sb, authorization) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: fail(401, 'Please sign in.') }
  const { data: { user } = {} } = await sb.auth.getUser(token)
  if (!user) return { error: fail(401, 'Your session has ended — please sign in again.') }
  const acct = await one(sb.from('client_accounts').select('*').eq('auth_user_id', user.id))
  if (!acct) return { error: fail(403, 'This sign-in has no client portal account.') }
  if (acct.status === 'DISABLED') return { error: fail(403, 'Your portal access is switched off — please contact us.', { code: 'DISABLED' }) }
  return { acct }
}

/**
 * /api/portal/<action> for a signed-in client. `deps`: { client, now, appUrl, sendEmail }.
 * GET me · POST session · POST upload · GET file?id= · POST profile · POST forgot (no sign-in)
 */
export async function portalClient(env, authorization, action, body, ip, deps = {}) {
  const sb = deps.client ?? portalClientFor(env)
  if (!sb) return fail(503, 'The client portal is not available right now.')
  const at = (deps.now ?? new Date()).toISOString()
  if (action === 'forgot') return forgot(env, sb, body ?? {}, ip, at, deps)
  if (limited(`p:${ip}`, 300, 600_000)) return fail(429, 'Too many requests — please wait a few minutes.')
  const r = await signedInClient(sb, authorization)
  if (r.error) return r.error
  const acct = r.acct
  if (action === 'me') return reply(200, { success: true, ...(await clientView(sb, acct, at)) })
  if (action === 'session') {
    const patch = { last_login_at: at, ...(acct.status === 'INVITED' ? { status: 'ACTIVE', activated_at: at } : {}) }
    await write(sb.from('client_accounts').update(patch).eq('id', acct.id))
    // one sign-in entry per 10 minutes (the page also calls this when it reopens)
    if (acct.status === 'INVITED') await activity(sb, acct, at, 'ACTIVATED', 'First sign-in — account active')
    else if (!acct.last_login_at || Date.parse(at) - Date.parse(acct.last_login_at) > 600_000) await activity(sb, acct, at, 'SIGNED_IN', ip ? `from ${ip}` : null)
    return reply(200, { success: true })
  }
  if (action === 'upload') return upload(sb, acct, body ?? {}, at)
  if (action === 'file') return openFile(sb, acct, String(body?.id ?? ''))
  if (action === 'profile') return profile(sb, acct, body ?? {}, at)
  return fail(404, 'Unknown action.')
}

/** Everything the client may see, from their own linked entries only. */
export async function clientView(sb, acct, at) {
  const ids = acct.booking_ids ?? []
  const [bookings, uploads, acts, media] = await Promise.all([
    rowsIn(sb, 'bookings', 'id', ids, 'id, booking_code, company_name, service_name, booking_date, created_at, client_docs, milestones, client_updates, ops_member_id'),
    rowsIn(sb, 'client_doc_uploads', 'booking_id', ids, 'id, booking_id, category, file, at, note'),
    rows(sb.from('client_activity').select('id, at, action, detail, booking_id').eq('account_id', acct.id)),
    clientMedia(sb, ids),
  ])
  const staff = await rowsIn(sb, 'app_users', 'id', [...new Set([acct.assigned_to, ...bookings.map((b) => b.ops_member_id)].filter(Boolean))], 'id, name, email, phone')
  const person = (uid) => { const u = staff.find((x) => x.id === uid); return u ? { name: u.name, email: u.email || null, phone: u.phone || null } : null }
  const recent = (iso) => Date.parse(at) - Date.parse(iso) < 14 * 86400_000
  const notices = []
  const projects = ids.map((bid) => bookings.find((b) => b.id === bid)).filter(Boolean).map((b) => {
    const ups = uploads.filter((u) => u.booking_id === b.id)
    const docs = ADMIN_STAGES.flatMap((s) => {
      const item = b.client_docs?.[s.id], status = docStatus(item, ups, s.id)
      if (!status) return []
      if (status === 'PENDING_UPLOAD') notices.push({ at: item.assignedAt, tone: 'amber', text: `Please upload your ${s.short} (${b.booking_code}).` })
      if (status === 'RESUBMISSION') notices.push({ at: item.statusAt, tone: 'red', text: `${s.short} needs to be uploaded again${item.clientRemark ? `: ${item.clientRemark}` : '.'}` })
      if (status === 'APPROVED' && recent(item.statusAt)) notices.push({ at: item.statusAt, tone: 'green', text: `${s.short} was approved.` })
      return [{
        category: s.id, label: s.short, status, remark: item.clientRemark || null, canUpload: clientMayUpload(status),
        files: ups.filter((u) => u.category === s.id).sort((x, y) => y.at.localeCompare(x.at)).map((u) => ({ id: u.file?.id, name: u.file?.name, size: u.file?.size, at: u.at })),
        history: (item.history ?? []).filter((h) => h.client).map((h) => ({ at: h.at, action: h.action, note: h.note ?? null })),
      }]
    })
    const milestones = (b.milestones ?? []).filter((m) => m.visible).map((m) => ({ id: m.id, title: m.title, due: m.due ?? null, status: m.status, doneAt: m.doneAt ?? null, tasksDone: (m.tasks ?? []).filter((t) => t.done).length, tasksTotal: (m.tasks ?? []).length }))
    const updates = [...(b.client_updates ?? [])].sort((x, y) => y.at.localeCompare(x.at)).map((u) => ({ id: u.id, at: u.at, title: u.title, text: u.text, file: u.file ? { id: u.file.id, name: u.file.name, size: u.file.size } : null }))
    for (const u of updates) if (recent(u.at)) notices.push({ at: u.at, tone: 'blue', text: `New update: ${u.title}` })
    return { id: b.id, code: b.booking_code, company: b.company_name, service: b.service_name, since: b.booking_date ?? b.created_at, contact: person(acct.assigned_to) ?? person(b.ops_member_id), progress: projectProgress(b.milestones, true), docs, milestones, updates }
  })
  for (const m of media) if (m.submitted_at && recent(m.submitted_at)) notices.push({ at: m.submitted_at, tone: 'blue', text: `New from Rexera: ${m.title}` })
  return {
    account: { name: acct.name, email: acct.email, phone: acct.phone ?? null, status: acct.status, lastLoginAt: acct.last_login_at ?? null },
    contact: person(acct.assigned_to),
    projects,
    notices: notices.sort((x, y) => String(y.at).localeCompare(String(x.at))),
    // Digital Media published for clients (External): what it is and its files only — never company notes or staff
    media: media.map((m) => ({ id: m.id, title: m.title, description: m.description || null, scheme: m.scheme_name, type: m.media_type, at: m.submitted_at, files: (m.files ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })) })),
    activity: acts.filter((a) => CLIENT_SEES[a.action]).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 50)
      .map((a) => ({ at: a.at, text: CLIENT_SEES[a.action], detail: a.action === 'UPLOADED' || a.action === 'REQUEST' ? a.detail : null })),
  }
}

/** { bookingId, category, uploadId, note?, file: { name, type, data (base64) } } — never approves anything: the team reviews it. */
async function upload(sb, acct, p, at) {
  if (!/^cu-[A-Za-z0-9_-]{10,40}$/.test(String(p.uploadId ?? ''))) return fail(400, 'Bad request.')
  const again = await one(sb.from('client_doc_uploads').select('id, account_id').eq('id', p.uploadId))
  if (again) return again.account_id === acct.id ? reply(200, { success: true, duplicate: true }) : fail(409, 'Bad request.')
  // an entry that isn't linked to this account answers exactly like one that doesn't exist
  if (!acct.booking_ids.includes(p.bookingId)) return fail(404, 'Project not found.')
  const stage = ADMIN_STAGES.find((s) => s.id === p.category)
  if (!stage) return fail(404, 'Document not found.')
  const b = await one(sb.from('bookings').select('id, booking_code, company_name, client_docs, ops_member_id').eq('id', p.bookingId))
  if (!b) return fail(404, 'Project not found.')
  const ups = await rows(sb.from('client_doc_uploads').select('category, at').eq('booking_id', b.id))
  const item = b.client_docs?.[stage.id]
  const status = docStatus(item, ups, stage.id)
  if (!status) return fail(404, 'Document not found.')
  if (!clientMayUpload(status)) return fail(409, status === 'APPROVED' ? `${stage.short} is already approved.` : `${stage.short} is being reviewed — you can upload again if the team asks for it.`)
  const f = p.file ?? {}
  const bytes = Buffer.from(String(f.data ?? ''), 'base64')
  const name = String(f.name ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file'
  const bad = fileProblem(name, String(f.type ?? ''), bytes.length, bytes)
  if (bad) return fail(422, bad)
  const ref = { id: newId('file-'), name, type: f.type, size: bytes.length, at }
  const { error: upErr } = await sb.storage.from(BUCKET).upload(ref.id, bytes, { contentType: f.type, upsert: false })
  if (upErr) throw new Error(`upload: ${upErr.message}`)
  const { error } = await sb.from('client_doc_uploads').insert({ id: p.uploadId, booking_id: b.id, category: stage.id, file: ref, at, account_id: acct.id, note: clean(p.note, 500) || null })
  if (error) { await sb.storage.from(BUCKET).remove([ref.id]).catch(() => undefined); throw new Error(error.message) }
  await activity(sb, acct, at, 'UPLOADED', `${stage.short}: ${name}`, { bookingId: b.id })
  await notify(sb, [item.assignee, b.ops_member_id, acct.assigned_to], at, `Client uploaded: ${stage.short}`, `${b.booking_code} · ${b.company_name} · ${name} — waiting for review`, `/bookings/${b.id}?tab=workflow`)
  await audit(sb, at, null, 'PORTAL_UPLOAD', `${b.booking_code} · ${stage.short} · ${name} · by ${acct.email}`)
  return reply(200, { success: true, status: 'SUBMITTED', message: 'Uploaded — the team will review it.' })
}

/** Published external Digital Media meant for a client with these CRM entries (all clients, or one of theirs), newest first. */
async function clientMedia(sb, bookingIds) {
  const list = await rows(sb.from('media_items').select('id, title, description, scheme_name, media_type, files, external, submitted, submitted_at, client_booking_ids').eq('external', true).eq('submitted', true))
  return list.filter((m) => forClient({ ...m, clientBookingIds: m.client_booking_ids }, bookingIds)).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
}

/** A short-lived link to one of the client's own files (their uploads, a file in an update to them, or media for them). */
async function openFile(sb, acct, fileId) {
  if (/^media-[A-Za-z0-9_-]{6,40}$/.test(fileId)) {
    const ref = (await clientMedia(sb, acct.booking_ids ?? [])).flatMap((m) => m.files ?? []).find((f) => f?.id === fileId)
    if (!ref) return fail(404, 'File not found.')
    const { data, error } = await sb.storage.from('media-files').createSignedUrl(ref.id, 300, { download: ref.name })
    if (error || !data?.signedUrl) return fail(502, 'The file could not be opened — please try again.')
    return reply(200, { success: true, url: data.signedUrl, name: ref.name })
  }
  if (!/^file-[A-Za-z0-9_-]{6,40}$/.test(fileId)) return fail(404, 'File not found.')
  const ids = acct.booking_ids ?? []
  const [ups, bookings] = await Promise.all([rowsIn(sb, 'client_doc_uploads', 'booking_id', ids, 'file'), rowsIn(sb, 'bookings', 'id', ids, 'client_updates')])
  const ref = ups.map((u) => u.file).concat(bookings.flatMap((b) => (b.client_updates ?? []).map((u) => u.file))).find((f) => f?.id === fileId)
  if (!ref) return fail(404, 'File not found.')
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ref.id, 300, { download: ref.name })
  if (error || !data?.signedUrl) return fail(502, 'The file could not be opened — please try again.')
  return reply(200, { success: true, url: data.signedUrl, name: ref.name })
}

/** { name, phone?, message? } — the client's own name and mobile; a message goes to their team member. */
async function profile(sb, acct, p, at) {
  const name = clean(p.name, 80), phone = String(p.phone ?? '').replace(/\D/g, ''), message = clean(p.message, 1000)
  if (name.length < 2) return fail(422, 'Enter your name.')
  if (phone && !/^[6-9]\d{9}$/.test(phone)) return fail(422, 'Enter a 10-digit mobile number.')
  if (name !== acct.name || (phone || null) !== (acct.phone ?? null)) {
    await write(sb.from('client_accounts').update({ name, phone: phone || null }).eq('id', acct.id))
    await activity(sb, acct, at, 'PROFILE', `Name / mobile updated`)
  }
  if (message) {
    if (limited(`msg:${acct.id}`, 10, 3600_000)) return fail(429, 'Too many messages — please try again later.')
    const bs = await rowsIn(sb, 'bookings', 'id', acct.booking_ids, 'ops_member_id')
    await activity(sb, acct, at, 'REQUEST', message)
    await notify(sb, [acct.assigned_to, ...bs.map((b) => b.ops_member_id)], at, `Message from client: ${name}`, message.slice(0, 200), '/client-portal')
  }
  return reply(200, { success: true, message: message ? 'Saved — your message was sent to the team.' : 'Saved.' })
}

/** { email } — a password reset link by email; always answers the same, so it can't be used to find accounts. */
async function forgot(env, sb, p, ip, at, deps) {
  const ok = reply(200, { success: true, message: 'If this email has a portal account, a reset link is on its way.' })
  const email = normEmail(p.email)
  if (!isEmail(email)) return fail(422, 'Enter your email address.')
  if (limited(`f:${ip}`, 5, 3600_000) || limited(`fe:${email}`, 3, 3600_000)) return fail(429, 'Too many requests — please try again later.')
  const acct = await one(sb.from('client_accounts').select('*').eq('email', email))
  if (!acct || acct.status === 'DISABLED') return ok
  const ctx = { sb, who: null, at, appUrl: String(env('APP_URL') || deps.appUrl || '').replace(/\/+$/, ''), sendEmail: deps.sendEmail ?? (async () => ({ success: false })) }
  const sent = await sendAccessLink(ctx, acct, acct.activated_at ? 'recovery' : 'invite')
  if (!sent.error) await activity(sb, acct, at, 'ACCESS_RESET', 'Reset link requested from the sign-in page')
  return ok
}
