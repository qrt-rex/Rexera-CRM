// Public client forms (/f/<token>): the live server reads the form and stores the answers with SUPABASE_SECRET_KEY,
// so clients never need an account and never get direct access to any table or file. Uploaded files go to the
// private "crm-files" bucket; the form's own document is shared through a one-hour signed link.
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { checkAnswers, fileProblem, formOpen, normMobile } from '../supabase/form-rules.mjs'
import { istToday } from '../supabase/workflow-rules.mjs'

const BUCKET = 'crm-files'
const reply = (status, body) => ({ status, body })
const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}
const id = (p) => `${p}${randomBytes(9).toString('base64url')}`

// spam guard per address: 120 views / 10 min, 10 submissions / hour
const hits = new Map()
function limited(key, max, ms, now = Date.now()) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms)
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k)
  return list.length > max
}

/** The form row for a token when it may be shown: { form } or an error answer. */
async function openForm(sb, token, mobile) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: reply(404, { success: false, message: 'This link is not valid.' }) }
  const { data: f, error } = await sb.from('doc_forms').select('*').eq('token', token).maybeSingle()
  if (error) throw new Error(error.message)
  if (!f) return { error: reply(404, { success: false, message: 'This link is not valid or was replaced by a new one.' }) }
  if (!formOpen({ status: f.status, expiresOn: f.expires_on }, istToday())) {
    return { error: reply(410, { success: false, message: f.status === 'PUBLISHED' ? 'This link has expired — please ask us for a new one.' : 'This form is closed — please contact us.' }) }
  }
  if (f.verify === 'MOBILE') {
    const m = normMobile(mobile)
    if (!m) return { error: reply(401, { success: false, verify: true, name: f.name, message: 'Enter the mobile number registered with us to open this form.' }) }
    const { data: b } = f.booking_id ? await sb.from('bookings').select('mobile, payment_contact').eq('id', f.booking_id).maybeSingle() : { data: null }
    if (!b || ![b.mobile, b.payment_contact].includes(m)) return { error: reply(403, { success: false, verify: true, name: f.name, message: 'That mobile number doesn’t match our records.' }) }
  }
  return { form: f }
}

/** GET /api/forms/<token>?mobile= — the form for the client (fields, instructions, document link). */
export async function getPublicForm(env, token, mobile, ip, client) {
  if (limited(`v:${ip}`, 120, 600_000)) return reply(429, { success: false, message: 'Too many requests — please try again in a few minutes.' })
  const sb = client ?? admin(env)
  if (!sb) return reply(503, { success: false, message: 'Forms are not available right now.' })
  const r = await openForm(sb, token, mobile)
  if (r.error) return r.error
  const f = r.form
  let document = null
  if (f.kind === 'UPLOAD' && f.document?.id) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.document.id, 3600, { download: f.document.name })
    if (data?.signedUrl) document = { name: f.document.name, url: data.signedUrl }
  }
  await sb.from('doc_forms').update({ views: (f.views ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', f.id)
  return reply(200, { success: true, form: { name: f.name, description: f.description, instructions: f.instructions, kind: f.kind, fields: f.fields, version: f.version, document } })
}

/**
 * POST /api/forms/<token>/submit — { answers, files: [{ fieldId, name, type, data (base64) }], mobile }.
 * Every answer and file is checked here (type, size, content) before anything is stored.
 */
export async function submitPublicForm(env, token, raw, ip, client) {
  if (limited(`s:${ip}`, 10, 3600_000)) return reply(429, { success: false, message: 'Too many submissions — please try again later.' })
  let p
  try { p = JSON.parse(raw || '{}') } catch { return reply(400, { success: false, message: 'Bad request.' }) }
  const sb = client ?? admin(env)
  if (!sb) return reply(503, { success: false, message: 'Forms are not available right now.' })
  const r = await openForm(sb, token, p.mobile)
  if (r.error) return r.error
  const f = r.form
  const files = (Array.isArray(p.files) ? p.files : []).slice(0, 10).map((x) => {
    const bytes = Buffer.from(String(x?.data ?? ''), 'base64')
    return { fieldId: String(x?.fieldId ?? ''), name: String(x?.name ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120), type: String(x?.type ?? ''), size: bytes.length, bytes }
  })
  const { errors, clean } = checkAnswers(f.fields ?? [], p.answers ?? {}, files)
  for (const x of files) { const bad = fileProblem(x.name, x.type, x.size, x.bytes); if (bad) errors[x.fieldId || '_files'] = bad }
  if (Object.keys(errors).length) return reply(422, { success: false, message: 'Please correct the highlighted fields.', errors })

  const at = new Date().toISOString(), stored = []
  try {
    for (const x of files) {
      const ref = { id: id('file-'), name: x.name, type: x.type, size: x.size, at }
      const { error } = await sb.storage.from(BUCKET).upload(ref.id, x.bytes, { contentType: x.type, upsert: false })
      if (error) throw new Error(`upload: ${error.message}`)
      stored.push({ fieldId: x.fieldId, file: ref })
    }
    const sub = { id: id('fs-'), form_id: f.id, form_version: f.version, booking_id: f.booking_id, fields: f.fields ?? [], answers: clean, files: stored, submitted_at: at, status: 'NEW' }
    const { error } = await sb.from('doc_form_submissions').insert(sub)
    if (error) throw new Error(`saving the answers: ${error.message}`)
    // tell whoever made the form and the file's Operations person
    const { data: b } = f.booking_id ? await sb.from('bookings').select('booking_code, company_name, ops_member_id').eq('id', f.booking_id).maybeSingle() : { data: null }
    const to = [...new Set([f.created_by, b?.ops_member_id].filter(Boolean))]
    if (to.length) await sb.from('notifications').insert(to.map((user_id) => ({ user_id, title: `Form returned: ${f.name}`, body: `${b ? `${b.booking_code} · ${b.company_name} · ` : ''}${stored.length} file(s)`, link: `/forms?tab=responses&form=${f.id}`, kind: 'action', created_at: at })))
    await sb.from('audit_log').insert({ at, by_user: null, action: 'FORM_SUBMITTED', detail: `${f.name} (v${f.version})${b ? ` · ${b.booking_code}` : ''} · ${stored.length} file(s) · from ${ip || '?'}` })
    return reply(200, { success: true, reference: sub.id, message: 'Thank you — we have received your form.' })
  } catch (e) {
    // nothing half-saved: remove files already uploaded
    if (stored.length) await sb.storage.from(BUCKET).remove(stored.map((x) => x.file.id)).catch(() => undefined)
    throw e
  }
}
