// Offer / joining letters to a selected candidate (HR Dashboard → Candidates): the letter PDF by email (attached) or by
// WhatsApp (the client notification template with a 7-day private link to the PDF). Only people who can open the
// candidate (recruitment.manage, row-level security) may send, only to a candidate HR has selected, and only to the email
// / mobile saved on the application. Every send — and every refusal by a provider — is logged in candidate_letters.
import { randomBytes } from 'node:crypto'
import { normMobile, sniffType } from '../supabase/form-rules.mjs'
import { templateValues, WHATSAPP_NOTIFY_VARS, workflowSettings } from '../supabase/workflow-rules.mjs'
import { signedIn } from './share.mjs'
import { sendTemplate, whatsappProblem } from './whatsapp.mjs'

const reply = (status, body) => ({ status, body })
const no = (status, message) => reply(status, { success: false, message })
const rid = () => `cl-${randomBytes(9).toString('base64url')}`
const isEmail = (s) => typeof s === 'string' && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s.trim())
const BUCKET = 'crm-files', MAX_PDF = 5 * 1024 * 1024
export const LETTER_LABEL = { OFFER: 'offer letter', JOINING: 'joining letter' }
/** the same letter to the same candidate on the same channel within 2 minutes is refused */
export const LETTER_REPEAT_MS = 120_000

// 30 letters per person per hour
const sends = new Map()
function limited(userId, now) {
  const list = (sends.get(userId) ?? []).filter((t) => now - t < 3600_000)
  list.push(now)
  sends.set(userId, list)
  return list.length > 30
}

/** What is wrong with a send request, or null. */
export function letterProblem(p) {
  if (!p || typeof p.candidateId !== 'string' || !p.candidateId) return 'Which candidate?'
  if (!LETTER_LABEL[p.kind]) return 'Choose the offer letter or the joining letter.'
  if (p.channel !== 'EMAIL' && p.channel !== 'WHATSAPP') return 'Send by email or WhatsApp.'
  const body = String(p.body ?? '').trim()
  if (body.length < 3 || body.length > 2000) return 'Write a short message to go with the letter (up to 2000 characters).'
  if (p.channel === 'EMAIL' && !(String(p.subject ?? '').trim().length >= 3 && String(p.subject).length <= 200)) return 'Write the email subject.'
  return null
}

/**
 * POST /api/hr/letter — { candidateId, kind: OFFER|JOINING, channel: EMAIL|WHATSAPP, subject?, body, pdf (base64),
 * fileName?, requestId?, manual? }. `manual`: sent from HR's own WhatsApp / mail app — only recorded.
 */
export async function sendHrLetter(env, authorization, raw, { clients, deliverEmail, fetchImpl, now = Date.now() } = {}) {
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const problem = letterProblem(p)
  if (problem) return no(422, problem)
  const auth = await signedIn(env, authorization, clients)
  if (auth.error) return auth.error
  const { admin, asCaller, me } = auth
  const id = typeof p.requestId === 'string' && /^cl-[\w-]{6,40}$/.test(p.requestId) ? p.requestId : rid()

  // the same request again (double click, retry): the first answer, nothing sent twice
  const { data: again } = await admin.from('candidate_letters').select('*').eq('id', id).maybeSingle()
  if (again) return reply(200, { success: again.status === 'SENT' || again.status === 'MANUAL', status: again.status, log: again, duplicate: true, message: 'Already sent — this is the same letter.' })

  // read AS THE SENDER: only HR (recruitment.manage) can open applications
  const { data: c } = await asCaller.from('candidate_applications').select('id, name, email, phone, position, selected').eq('id', p.candidateId).maybeSingle()
  if (!c) return no(403, 'You can’t open this candidate.')
  if (c.selected !== true) return no(422, 'Select the candidate first — letters go to selected candidates only.')
  const to = p.channel === 'EMAIL' ? (isEmail(c.email) ? c.email.trim().toLowerCase() : '') : normMobile(c.phone)
  if (!to) return no(422, p.channel === 'EMAIL' ? 'The candidate has no valid email address.' : 'The candidate has no valid 10-digit mobile number.')

  const since = new Date(now - LETTER_REPEAT_MS).toISOString()
  const { data: recent } = await admin.from('candidate_letters').select('id').eq('candidate_id', c.id).eq('kind', p.kind).eq('channel', p.channel).in('status', ['SENT', 'MANUAL']).gte('sent_at', since).limit(1)
  if (recent?.length) return no(409, `This ${LETTER_LABEL[p.kind]} was sent on ${p.channel === 'EMAIL' ? 'email' : 'WhatsApp'} a moment ago — check the letters list before sending it again.`)
  if (limited(me.id, now)) return no(429, 'Too many letters sent in the last hour — please try again later.')

  const pdf = p.manual ? null : Buffer.from(String(p.pdf ?? ''), 'base64')
  if (pdf && (!pdf.length || sniffType(pdf) !== 'application/pdf')) return no(422, 'The letter PDF is missing or damaged — try again.')
  if (pdf && pdf.length > MAX_PDF) return no(413, 'The letter PDF is larger than 5 MB.')
  const fileName = `${String(p.fileName || `${LETTER_LABEL[p.kind]} ${c.name}`).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 80)}.pdf`
  const { data: co } = await admin.from('app_settings').select('value').eq('key', 'company').maybeSingle()
  const company = co?.value?.name || 'Rexera'
  const { data: urow } = await admin.from('app_users').select('phone, email').eq('id', me.id).maybeSingle()
  const body = String(p.body).trim(), subject = p.channel === 'EMAIL' ? String(p.subject).trim() : null
  let status, error = null

  if (p.manual) status = 'MANUAL'
  else if (p.channel === 'EMAIL') {
    if (!deliverEmail) return no(503, 'Email sending is not available on this server.')
    const r = await deliverEmail(
      { to, subject, heading: subject, message: body, company, sender: { name: me.name, role: 'Human Resources', ...(urow?.phone ? { phone: String(urow.phone).slice(0, 20) } : {}), ...(isEmail(urow?.email) ? { email: urow.email } : {}) }, ...(isEmail(urow?.email) ? { replyTo: urow.email } : {}) },
      [{ filename: fileName, content: pdf.toString('base64'), contentType: 'application/pdf' }],
    )
    status = r.success ? 'SENT' : r.configured === false ? 'NOT_CONFIGURED' : 'FAILED'
    if (!r.success) error = String(r.message || 'Sending failed.').slice(0, 500)
  } else {
    const { data: ws } = await admin.from('app_settings').select('value').eq('key', 'workflow').maybeSingle()
    const w = workflowSettings(ws?.value ?? undefined)
    const prob = whatsappProblem(env, w.whatsapp.notifyTemplate, to)
    if (prob) { status = prob.status === 'NO_CONTACT' ? 'FAILED' : 'NOT_CONFIGURED'; error = prob.error }
    else {
      // Interakt can't attach a file to this template: a private copy of the PDF with a 7-day signed link
      const path = `hr-letters/${rid()}.pdf`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      const { data: signed } = upErr ? { data: null } : await admin.storage.from(BUCKET).createSignedUrl(path, 7 * 24 * 3600)
      if (!signed?.signedUrl) { status = 'FAILED'; error = `Could not prepare the PDF for WhatsApp${upErr ? ` (${upErr.message})` : ''}.` }
      else {
        // the link first, so a long note can't cut it off
        const text = `Your ${LETTER_LABEL[p.kind]} (valid 7 days): ${signed.signedUrl} — ${body.replace(/\s+/g, ' ')}`.slice(0, 900)
        const r = await sendTemplate(env, { phone: to, template: w.whatsapp.notifyTemplate, language: w.whatsapp.language, bodyValues: templateValues(WHATSAPP_NOTIFY_VARS, { client_name: c.name, reference: c.position || 'your application', message: text, company }), callbackData: `letter:${id}` }, fetchImpl)
        status = r.status === 'SENT' ? 'SENT' : r.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED'
        error = r.error ?? null
      }
    }
  }

  const log = { id, candidate_id: c.id, kind: p.kind, channel: p.channel, to_addr: to, subject, body, status, error, sent_by: me.id, sent_at: new Date(now).toISOString() }
  const { error: logErr } = await admin.from('candidate_letters').insert(log)
  if (logErr) console.error(`[hr letter] log: ${logErr.message}`)
  await admin.from('audit_log').insert({ at: log.sent_at, by_user: me.id, action: 'HR_LETTER', detail: `${LETTER_LABEL[p.kind]} · ${c.name} · ${p.channel === 'EMAIL' ? 'email' : 'WhatsApp'} → ${to} · ${status}` })
  const ok = status === 'SENT' || status === 'MANUAL'
  const where = p.channel === 'EMAIL' ? `email ${to}` : `WhatsApp +91 ${to}`
  return reply(ok ? 200 : status === 'NOT_CONFIGURED' ? 503 : 502, {
    success: ok, status, log,
    message: ok ? (status === 'MANUAL' ? `Recorded as sent from your own ${p.channel === 'EMAIL' ? 'mail app' : 'WhatsApp'} to ${where}.` : `The ${LETTER_LABEL[p.kind]} was sent to ${where}.`) : error || 'Sending failed.',
  })
}
