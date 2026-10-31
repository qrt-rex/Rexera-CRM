// Client messages from a CRM screen (live server, Supabase sign-in): POST /api/client-message.
// One message, one channel — WhatsApp (Interakt, the approved "client update" template) or email — to the client of one
// CRM entry or client entry. The server, not the browser, decides everything that matters:
//  * who may send it (supabase/message-rules.mjs: the sender's team, their own clients for sales) and whether it is
//    open at this step of the file;
//  * where it goes — the email / mobile saved on the record, never an address from the browser;
//  * no duplicates — the same request id is answered once, and the same message to the same client on the same
//    channel within 2 minutes is refused;
//  * every attempt is recorded in client_messages (content, sender, recipient, channel, time, status, error).
// "manual": the sender sent it from their own WhatsApp / mail app (nothing is sent here) — it is only recorded.
import { randomBytes } from 'node:crypto'
import { normMobile } from '../supabase/form-rules.mjs'
import { templateValues, WHATSAPP_NOTIFY_VARS, workflowSettings } from '../supabase/workflow-rules.mjs'
import { DUPLICATE_WINDOW_MS, messageProblem, oneLine, stageClosed, stageDenied, stageOf } from '../supabase/message-rules.mjs'
import { sendTemplate, whatsappProblem } from './whatsapp.mjs'
import { signedIn } from './share.mjs'

const reply = (status, body) => ({ status, body })
const no = (status, message) => reply(status, { success: false, message })
const rid = () => `cm-${randomBytes(9).toString('base64url')}`
const isEmail = (s) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(String(s ?? '')) && String(s).length <= 254

// 60 messages per person per hour (each one reaches a client)
const sends = new Map()
function limited(userId, now) {
  const list = (sends.get(userId) ?? []).filter((t) => now - t < 3600_000)
  list.push(now)
  sends.set(userId, list)
  return list.length > 60
}

const TEAM = { sales: 'Sales Team', teamlead: 'Sales Team', accounts: 'Accounts Team', legal: 'Legal Team', operations: 'Operation Team', admin: 'Admin Team', superadmin: 'Management', it: 'Support' }

/**
 * { stage, channel, bookingId | clientEntryId, subject?, body, requestId?, manual? } → { success, status, message, log }.
 * `deliverEmail(request)` sends one client email ({ success, message, configured? }). `clients` / `fetchImpl` for tests.
 */
export async function sendClientMessage(env, authorization, raw, { clients, deliverEmail, fetchImpl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const problem = messageProblem(p)
  if (problem) return no(422, problem)
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller, me } = auth
  const id = typeof p.requestId === 'string' && /^cm-[\w-]{6,40}$/.test(p.requestId) ? p.requestId : rid()

  // the same request again (double click, retry after a timeout): the first answer, nothing sent twice
  const { data: again } = await admin.from('client_messages').select('*').eq('id', id).maybeSingle()
  if (again) return reply(200, { success: again.status === 'SENT' || again.status === 'MANUAL', status: again.status, message: 'Already sent — this is the same message.', log: again, duplicate: true })

  const [{ data: urow }, { data: extra }] = await Promise.all([
    admin.from('app_users').select('role, phone, email').eq('id', me.id).maybeSingle(),
    admin.from('user_extra_roles').select('role').eq('user_id', me.id),
  ])
  const roles = [urow?.role, ...(extra ?? []).map((x) => x.role)].filter(Boolean)

  // the record, read AS THE SENDER: what they can't open, they can't message
  let rec, to
  if (p.bookingId) {
    const { data: b } = await asCaller.from('bookings').select('id, booking_code, company_name, contact_person, email, mobile, payment_email, payment_contact, status, stage, created_by, team_lead_id').eq('id', p.bookingId).maybeSingle()
    if (!b) return no(403, 'You can’t open this CRM entry.')
    rec = { kind: 'booking', status: b.status, stage: b.stage, ownerId: b.created_by, teamLeadId: b.team_lead_id ?? undefined, name: b.contact_person, ref: b.booking_code }
    to = p.channel === 'EMAIL' ? (isEmail(b.email) ? b.email : isEmail(b.payment_email) ? b.payment_email : '') : normMobile(b.mobile) || normMobile(b.payment_contact)
  } else {
    const { data: e } = await asCaller.from('client_entries').select('id, client_name, company_name, phone, email, status, owner_id').eq('id', p.clientEntryId).maybeSingle()
    if (!e) return no(403, 'You can’t open this client entry.')
    const { data: owner } = await admin.from('app_users').select('team_lead_id').eq('id', e.owner_id).maybeSingle()
    rec = { kind: 'entry', status: e.status, ownerId: e.owner_id, teamLeadId: owner?.team_lead_id ?? undefined, name: e.client_name, ref: e.company_name }
    to = p.channel === 'EMAIL' ? (isEmail(e.email) ? e.email : '') : normMobile(e.phone)
  }
  const denied = stageDenied(p.stage, roles, me.id, rec)
  if (denied) return no(403, denied)
  const closed = stageClosed(p.stage, rec)
  if (closed) return no(422, closed)
  if (!to) return no(422, p.channel === 'EMAIL' ? 'No email address is saved for this client — add it to the record first.' : 'No valid 10-digit mobile number is saved for this client.')

  // the same message to the same client on the same channel a moment ago
  const since = new Date(now - DUPLICATE_WINDOW_MS).toISOString()
  const { data: recent } = await admin.from('client_messages').select('id, sent_at').eq(p.bookingId ? 'booking_id' : 'client_entry_id', p.bookingId || p.clientEntryId)
    .eq('stage', p.stage).eq('channel', p.channel).in('status', ['SENT', 'MANUAL']).gte('sent_at', since).limit(1)
  if (recent?.length) return no(409, `This ${stageOf(p.stage).label.toLowerCase()} message was sent on ${p.channel === 'EMAIL' ? 'email' : 'WhatsApp'} a moment ago — check the message log before sending it again.`)
  if (limited(me.id, now)) return no(429, 'Too many messages in the last hour — please try again later.')

  const { data: co } = await admin.from('app_settings').select('value').eq('key', 'company').maybeSingle()
  const company = co?.value?.name || 'Rexera'
  const team = TEAM[roles.find((r) => stageOf(p.stage).teams.includes(r)) ?? roles[0]] ?? 'Team'
  const body = String(p.body).trim(), subject = p.channel === 'EMAIL' ? String(p.subject).trim() : null
  let status, error = null, providerId = null

  if (p.manual) status = 'MANUAL'
  else if (p.channel === 'EMAIL') {
    if (!deliverEmail) return no(503, 'Email sending is not available on this server.')
    const r = await deliverEmail({ to, subject, heading: subject, message: body, company, sender: { name: me.name, role: team, ...(urow?.phone ? { phone: String(urow.phone).slice(0, 20) } : {}), ...(isEmail(urow?.email) ? { email: urow.email } : {}) }, ...(isEmail(urow?.email) ? { replyTo: urow.email } : {}) })
    status = r.success ? 'SENT' : r.configured === false ? 'NOT_CONFIGURED' : 'FAILED'
    if (!r.success) error = String(r.message || 'Sending failed.').slice(0, 500)
  } else {
    const { data: ws } = await admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle()
    const w = workflowSettings(ws?.value ?? undefined)
    const prob = whatsappProblem(env, w.whatsapp.notifyTemplate, to)
    if (prob) { status = prob.status === 'NO_CONTACT' ? 'FAILED' : 'NOT_CONFIGURED'; error = prob.status === 'NOT_CONFIGURED' && !w.whatsapp.notifyTemplate && env('INTERAKT_API_KEY') ? 'No WhatsApp template is chosen for client messages (Workflow settings → WhatsApp → Client notification template).' : prob.error }
    else {
      const r = await sendTemplate(env, { phone: to, template: w.whatsapp.notifyTemplate, language: w.whatsapp.language, bodyValues: templateValues(WHATSAPP_NOTIFY_VARS, { client_name: rec.name, reference: rec.kind === 'booking' ? rec.ref : 'your enquiry', message: oneLine(body), company }), callbackData: `msg:${id}` }, fetchImpl)
      status = r.status === 'SENT' ? 'SENT' : r.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED'
      error = r.error ?? null
      providerId = r.id ?? null
    }
  }

  const log = {
    id, booking_id: p.bookingId ?? null, client_entry_id: p.clientEntryId ?? null, stage: p.stage, channel: p.channel, to_addr: to, subject, body,
    status, error, sent_by: me.id, sent_at: new Date(now).toISOString(), provider_id: providerId,
  }
  const { error: logErr } = await admin.from('client_messages').insert(log)
  if (logErr) console.error(`[client message] log: ${logErr.message}`)
  await admin.from('audit_log').insert({ at: log.sent_at, by_user: me.id, action: 'CLIENT_MESSAGE', detail: `${stageOf(p.stage).label} · ${p.channel === 'EMAIL' ? 'email' : 'WhatsApp'} → ${to} · ${status}${rec.ref ? ` · ${rec.ref}` : ''}` })
  const ok = status === 'SENT' || status === 'MANUAL'
  const where = p.channel === 'EMAIL' ? `email ${to}` : `WhatsApp +91 ${to}`
  return reply(ok ? 200 : status === 'NOT_CONFIGURED' ? 503 : 502, {
    success: ok, status, log,
    message: ok ? (status === 'MANUAL' ? `Recorded as sent from your own ${p.channel === 'EMAIL' ? 'mail app' : 'WhatsApp'} to ${where}.` : `Sent to ${where}.`) : error || 'Sending failed.',
  })
}
