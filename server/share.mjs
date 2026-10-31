// Sending to clients from a CRM screen (live server, Supabase sign-in): the invoice PDF by email (attached) and by
// WhatsApp (a document template), and the WhatsApp welcome straight after Legal approval. The caller's own sign-in is
// checked and row-level security decides what they may send — an invoice they can't open can't be sent.
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { formOpen, normMobile, sniffType } from '../supabase/form-rules.mjs'
import { istToday, MAX_WHATSAPP_MESSAGE, mayWhatsappClient, WHATSAPP_FORM_VARS, WHATSAPP_INVOICE_VARS, WHATSAPP_NOTIFY_VARS, templateValues, workflowSettings } from '../supabase/workflow-rules.mjs'
import { sendTemplate, welcomeWhatsapp, whatsappProblem } from './whatsapp.mjs'

const reply = (status, body) => ({ status, body })
const no = (status, message) => reply(status, { success: false, message })
const BUCKET = 'crm-files', MAX_PDF = 5 * 1024 * 1024
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const rid = (p) => `${p}${randomBytes(9).toString('base64url')}`

/** { admin, asCaller, me } for a signed-in, active CRM user, or { error }. `clients` replaces the lookup in tests. */
export async function signedIn(env, authorization, clients) {
  if (clients) return clients
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || '', publishable = env('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !secret.startsWith('sb_secret_') || !publishable) return { error: no(503, 'Sending from the CRM needs the live server connected to Supabase (SUPABASE_URL, SUPABASE_SECRET_KEY).') }
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: no(401, 'Sign in again.') }
  const admin = createClient(url, secret, opts)
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return { error: no(401, 'Sign in again.') }
  const { data: me } = await admin.from('app_users').select('id, name, active').eq('auth_user_id', user.id).maybeSingle()
  if (!me?.active) return { error: no(403, 'Your sign-in is not linked to an active CRM account.') }
  return { admin, asCaller: createClient(url, publishable, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } }), me }
}

// 40 sends per person per hour (each one may reach a client)
const sends = new Map()
function limited(userId, now) {
  const list = (sends.get(userId) ?? []).filter((t) => now - t < 3600_000)
  list.push(now)
  sends.set(userId, list)
  return list.length > 40
}

/**
 * POST /api/invoices/send — { invoiceId, pdf (base64), fileName, email?: ClientEmailRequest, whatsapp?: { phone, values } }.
 * `deliverEmail(request, attachments)` sends one client email ({ success, message, configured? }). Every result is
 * logged in invoice_shares (the CRM shows them on the invoice) and the audit log.
 */
export async function sendInvoice(env, authorization, raw, { clients, deliverEmail, fetchImpl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller, me } = auth
  if (typeof p.invoiceId !== 'string' || !p.invoiceId) return no(422, 'Which invoice?')
  if (!p.email && !p.whatsapp) return no(422, 'Choose email, WhatsApp or both.')
  if (limited(me.id, now)) return no(429, 'Too many invoices sent in the last hour — please try again later.')
  const { data: inv } = await asCaller.from('invoices').select('id, number, type, client, status').eq('id', p.invoiceId).maybeSingle()
  if (!inv) return no(403, 'You can’t open this invoice.')
  if (inv.status === 'CANCELLED') return no(422, 'This invoice is cancelled.')
  const pdf = Buffer.from(String(p.pdf ?? ''), 'base64')
  if (!pdf.length || sniffType(pdf) !== 'application/pdf') return no(422, 'The invoice PDF is missing or damaged — try again.')
  if (pdf.length > MAX_PDF) return no(413, 'The invoice PDF is larger than 5 MB.')
  const fileName = `${String(p.fileName || inv.number).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'invoice'}.pdf`
  // a double click (or a second screen) must not send the same invoice to the same person twice
  const { data: sent } = await admin.from('invoice_shares').select('channel, to_addr, status, sent_at').eq('invoice_id', inv.id)
  const twice = (channel, to) => (sent ?? []).some((s) => s.channel === channel && s.status === 'SENT' && String(s.to_addr).toLowerCase() === String(to ?? '').trim().toLowerCase() && now - new Date(s.sent_at).getTime() < 2 * 60_000)
  if ((p.email && twice('email', p.email.to)) || (p.whatsapp && twice('whatsapp', normMobile(p.whatsapp.phone) || p.whatsapp.phone))) {
    return no(409, 'This invoice was sent to the same recipient a moment ago — check the “Sent to the client” list before sending again.')
  }
  const at = new Date(now).toISOString(), out = {}

  if (p.email) {
    const r = await deliverEmail(p.email, [{ filename: fileName, content: pdf.toString('base64'), contentType: 'application/pdf' }])
    out.email = { status: r.success ? 'SENT' : r.configured === false ? 'NOT_CONFIGURED' : 'FAILED', to: String(p.email.to ?? ''), ...(r.success ? {} : { error: r.message || 'Sending failed.' }) }
  }
  if (p.whatsapp) {
    const { data: ws } = await admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle()
    const w = workflowSettings(ws?.value ?? undefined)
    const problem = whatsappProblem(env, w.whatsapp.invoiceTemplate, p.whatsapp.phone)
    if (problem) out.whatsapp = { ...problem, to: String(p.whatsapp.phone ?? '') }
    else {
      // Interakt fetches the document from a link: a private copy with a 7-day signed link (never a public file)
      const path = `${rid('invoice-')}.pdf`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      const { data: signed } = upErr ? { data: null } : await admin.storage.from(BUCKET).createSignedUrl(path, 7 * 24 * 3600)
      if (!signed?.signedUrl) out.whatsapp = { status: 'FAILED', to: String(p.whatsapp.phone), error: `Could not prepare the PDF for WhatsApp${upErr ? ` (${upErr.message})` : ''}.` }
      else {
        const res = await sendTemplate(env, {
          phone: p.whatsapp.phone, template: w.whatsapp.invoiceTemplate, language: w.whatsapp.language, headerValues: [signed.signedUrl], fileName,
          bodyValues: templateValues(WHATSAPP_INVOICE_VARS, p.whatsapp.values ?? {}), callbackData: `invoice:${inv.id}`,
        }, fetchImpl)
        out.whatsapp = { status: res.status, to: res.to ?? String(p.whatsapp.phone), ...(res.id ? { messageId: res.id } : {}), ...(res.error ? { error: res.error } : {}) }
      }
    }
  }

  const rows = Object.entries(out).map(([channel, r]) => ({ id: rid('ish-'), invoice_id: inv.id, sent_at: at, sent_by: me.id, channel, to_addr: r.to, status: r.status, error: r.error ?? null, message_id: r.messageId ?? null }))
  const { error: logErr } = await admin.from('invoice_shares').insert(rows)
  if (logErr) console.error(`[invoice send] log: ${logErr.message}`)
  await admin.from('audit_log').insert({ at, by_user: me.id, action: 'INVOICE_SENT', detail: `${inv.number}: ${Object.entries(out).map(([c, r]) => `${c} → ${r.to || '—'} ${r.status}`).join(' · ')}` })
  return reply(200, { success: Object.values(out).some((r) => r.status === 'SENT'), ...out })
}

/**
 * POST /api/forms/share — { formId, phone, clientName }: a Document Form Builder link by WhatsApp (Interakt form-link
 * template). Only staff who can manage the form (row-level security) can send it, and only while the link works.
 * `appUrl` is the CRM's own address (APP_URL, else the request's host) — the link always points at this CRM.
 */
export async function sendFormLink(env, authorization, raw, { clients, fetchImpl, appUrl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller, me } = auth
  if (typeof p.formId !== 'string' || !p.formId) return no(422, 'Which form?')
  if (limited(me.id, now)) return no(429, 'Too many messages in the last hour — please try again later.')
  const { data: f } = await asCaller.from('doc_forms').select('id, token, name, status, expires_on, booking_id').eq('id', p.formId).maybeSingle()
  if (!f) return no(403, 'You can’t send this form.')
  if (!formOpen({ status: f.status, expiresOn: f.expires_on }, istToday(now))) return no(422, 'This form’s link isn’t live — publish it (or make a new link) first.')
  const [{ data: ws }, { data: co }] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'company').maybeSingle(),
  ])
  const w = workflowSettings(ws?.value ?? undefined)
  const link = `${String(env('APP_URL') || appUrl || '').replace(/\/+$/, '')}/f/${f.token}`
  const res = await sendTemplate(env, {
    phone: p.phone, template: w.whatsapp.formTemplate, language: w.whatsapp.language, callbackData: `form:${f.id}`,
    bodyValues: templateValues(WHATSAPP_FORM_VARS, { client_name: String(p.clientName ?? '').slice(0, 120) || 'Sir / Madam', form: f.name, link, company: co?.value?.name || 'Rexera' }),
  }, fetchImpl)
  await admin.from('audit_log').insert({ at: new Date(now).toISOString(), by_user: me.id, action: `FORM_LINK_WHATSAPP_${res.status}`, detail: `${f.name} → ${res.to ?? p.phone ?? '—'}${res.error ? ` (${res.error})` : ''}` })
  return reply(200, { success: res.status === 'SENT', ...res })
}

/**
 * POST /api/whatsapp/notify — { bookingId, message }: a message to the entry's client on WhatsApp (Interakt client
 * notification template). Only the Operation, Admin and Legal teams, and only for an entry they can open; the number is
 * always the one saved on the entry. Without a template the answer is NOT_CONFIGURED and the screen opens WhatsApp instead.
 */
export async function sendClientWhatsapp(env, authorization, raw, { clients, fetchImpl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller, me } = auth
  const [{ data: u }, { data: extra }] = await Promise.all([
    admin.from('app_users').select('role').eq('id', me.id).maybeSingle(),
    admin.from('user_extra_roles').select('role').eq('user_id', me.id),
  ])
  if (!mayWhatsappClient([u?.role, ...(extra ?? []).map((x) => x.role)])) return no(403, 'Only the Operation, Admin and Legal teams can message clients on WhatsApp.')
  if (typeof p.bookingId !== 'string' || !p.bookingId) return no(422, 'Which file?')
  const message = String(p.message ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim()
  if (message.length < 3) return no(422, 'Write the message first.')
  if (message.length > MAX_WHATSAPP_MESSAGE) return no(422, `Keep the message under ${MAX_WHATSAPP_MESSAGE} characters.`)
  const { data: b } = await asCaller.from('bookings').select('id, booking_code, company_name, contact_person, mobile').eq('id', p.bookingId).maybeSingle()
  if (!b) return no(403, 'You can’t open this file.')
  if (limited(me.id, now)) return no(429, 'Too many messages in the last hour — please try again later.')
  const [{ data: ws }, { data: co }] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'company').maybeSingle(),
  ])
  const w = workflowSettings(ws?.value ?? undefined)
  const problem = whatsappProblem(env, w.whatsapp.notifyTemplate, b.mobile)
  if (problem) return reply(200, { success: false, ...problem, to: b.mobile ?? '' })
  const res = await sendTemplate(env, {
    phone: b.mobile, template: w.whatsapp.notifyTemplate, language: w.whatsapp.language, callbackData: `notify:${b.id}`,
    bodyValues: templateValues(WHATSAPP_NOTIFY_VARS, { client_name: b.contact_person || b.company_name, reference: b.booking_code, message, company: co?.value?.name || 'Rexera' }),
  }, fetchImpl)
  await admin.from('audit_log').insert({ at: new Date(now).toISOString(), by_user: me.id, action: `CLIENT_WHATSAPP_${res.status}`, detail: `${b.booking_code} → ${res.to ?? b.mobile ?? '—'}: ${message.slice(0, 120)}${res.error ? ` (${res.error})` : ''}` })
  return reply(200, { success: res.status === 'SENT', ...res })
}

/** POST /api/whatsapp/welcome — { bookingId }: send the queued WhatsApp welcome now (the job would within 15 min). */
export async function sendWelcomeNow(env, authorization, raw, { clients, fetchImpl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller } = auth
  if (typeof p.bookingId !== 'string' || !p.bookingId) return no(422, 'Which file?')
  const { data: seen } = await asCaller.from('bookings').select('id').eq('id', p.bookingId).maybeSingle()
  if (!seen) return no(403, 'You can’t open this file.')
  const { data: r } = await admin.from('bookings').select('id, booking_code, company_name, contact_person, mobile, service_name, ops_member_id, welcome').eq('id', p.bookingId).maybeSingle()
  if (!r?.welcome) return reply(200, { success: true, result: null })
  const [{ data: ws }, { data: co }, { data: ops }] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'company').maybeSingle(),
    r.ops_member_id ? admin.from('app_users').select('name, phone, email').eq('id', r.ops_member_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const result = await welcomeWhatsapp(admin, env, r, { w: workflowSettings(ws?.value ?? undefined), company: co?.value?.name || 'Rexera', ops, now, immediate: true, fetchImpl })
  return reply(200, { success: true, result })
}
