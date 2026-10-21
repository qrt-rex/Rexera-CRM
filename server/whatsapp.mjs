// WhatsApp through Interakt (interakt.shop). A message the business starts must use a template approved by Meta in
// the Interakt dashboard; the CRM only fills its {{1}}, {{2}}… values (Workflow settings → WhatsApp). The API key stays
// on the server (INTERAKT_API_KEY) — never a VITE_ variable or browser code.
//
// "SENT" means Interakt accepted the message and gave it an id. Delivered / read receipts would come from Interakt's
// webhook, which is not connected — the CRM never shows a message as delivered or read.
import { normMobile } from '../supabase/form-rules.mjs'
import { WHATSAPP_WELCOME_VARS, templateValues } from '../supabase/workflow-rules.mjs'

const API = 'https://api.interakt.ai/v1/public/message/'
export const whatsappConfigured = (env) => !!String(env('INTERAKT_API_KEY') || '').trim()
/** Why a message can't go (no key, no template, no number) — checked before anything is uploaded or claimed. */
export function whatsappProblem(env, template, phone) {
  if (!whatsappConfigured(env)) return { status: 'NOT_CONFIGURED', error: 'WhatsApp is not set up on the server (INTERAKT_API_KEY).' }
  if (!template) return { status: 'NOT_CONFIGURED', error: 'No WhatsApp template is chosen for this message (Workflow settings → WhatsApp).' }
  if (!normMobile(phone)) return { status: 'NO_CONTACT', error: 'No valid 10-digit mobile number.' }
  return null
}

/**
 * Sends one template message: { phone, template, language, bodyValues, headerValues?, fileName?, callbackData? }.
 * Answers { status: SENT | FAILED | NOT_CONFIGURED | NO_CONTACT, to?, id?, error? } — SENT only on Interakt's yes.
 */
export async function sendTemplate(env, m, fetchImpl = fetch) {
  const problem = whatsappProblem(env, m.template, m.phone)
  if (problem) return problem
  const key = String(env('INTERAKT_API_KEY')).trim(), phone = normMobile(m.phone)
  const body = {
    countryCode: '+91', phoneNumber: phone, type: 'Template', ...(m.callbackData ? { callbackData: String(m.callbackData).slice(0, 512) } : {}),
    template: {
      name: m.template, languageCode: m.language || 'en', bodyValues: m.bodyValues ?? [],
      ...(m.headerValues?.length ? { headerValues: m.headerValues } : {}), ...(m.fileName ? { fileName: m.fileName } : {}),
    },
  }
  let res, data
  try {
    res = await fetchImpl(env('INTERAKT_API_URL') || API, {
      method: 'POST', headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    })
    data = await res.json().catch(() => ({}))
  } catch (e) {
    return { status: 'FAILED', to: phone, error: `Interakt could not be reached (${e.message}).` }
  }
  if (!res.ok || data?.result === false) {
    const why = String(data?.message || `Interakt answered ${res.status}`).slice(0, 300)
    return { status: 'FAILED', to: phone, error: res.status === 401 || res.status === 403 ? `Interakt refused the API key (${why}). Copy the key from Interakt → Settings → Developer Settings.` : why }
  }
  return { status: 'SENT', to: phone, ...(data?.id ? { id: String(data.id) } : {}) }
}

/** The welcome message's values for a bookings row (same as the email: Workflow settings → Operations contact). */
export function rowWelcomeVars(r, w, company, ops) {
  return {
    client_name: r.contact_person || r.company_name, company, service: r.service_name, reference: r.booking_code, status: 'With our Operations team',
    ops_name: w.opsContact.name || ops?.name || 'Our Operations team', ops_phone: w.opsContact.phone || ops?.phone || '', ops_email: w.opsContact.email || ops?.email || '',
  }
}

/**
 * Sends the client's WhatsApp welcome for one bookings row, once: queued (PENDING), stuck sending for 15 min, or
 * failed (up to 3 tries, 30 min apart). `now` asks for a queued one without waiting (the approving screen).
 * A sent welcome is also written to reminder_log, so a stale copy of the file can never send it a second time.
 */
export async function welcomeWhatsapp(sb, env, r, { w, company, ops, now = Date.now(), immediate = false, fetchImpl } = {}) {
  const x = r.welcome?.whatsapp
  if (!x) return null
  const stale = (iso, min) => !iso || now - new Date(iso).getTime() >= min * 60_000
  const due = (x.status === 'PENDING' && (immediate || stale(r.welcome.createdAt, 5))) || (x.status === 'SENDING' && stale(x.lastAt, 15)) || (x.status === 'FAILED' && (x.attempts ?? 0) < 3 && stale(x.lastAt, 30))
  if (!due) return null
  const at = new Date(now).toISOString(), key = `welcome-wa:${r.id}`
  const setWa = async (wa, expect) => {
    // only this channel changes: the email side may have moved on since the row was read
    const { data: cur } = await sb.from('bookings').select('welcome').eq('id', r.id).maybeSingle()
    if (!cur?.welcome) return false
    const { data } = await sb.from('bookings').update({ welcome: { ...cur.welcome, whatsapp: wa } }).eq('id', r.id).eq('welcome->whatsapp->>status', expect).select('id')
    return !!data?.length
  }
  const { data: sentBefore } = await sb.from('reminder_log').select('key').eq('key', key).maybeSingle()
  if (sentBefore) { await setWa({ ...x, status: 'SENT' }, x.status); return null }
  const claim = { ...x, status: 'SENDING', attempts: (x.attempts ?? 0) + 1, lastAt: at, to: r.mobile || x.to }
  if (!(await setWa(claim, x.status))) return null // someone else took it
  const vars = rowWelcomeVars(r, w, company, ops)
  const res = await sendTemplate(env, { phone: r.mobile, template: w.whatsapp.welcomeTemplate, language: w.whatsapp.language, bodyValues: templateValues(WHATSAPP_WELCOME_VARS, vars), callbackData: `welcome:${r.id}` }, fetchImpl)
  if (res.status === 'SENT') await sb.from('reminder_log').upsert({ key, kind: 'WELCOME_WHATSAPP', ref_id: r.id, recipients: [res.to] }, { onConflict: 'key', ignoreDuplicates: true })
  await setWa({ ...claim, status: res.status, lastAt: at, ...(res.to ? { to: res.to } : {}), ...(res.status === 'SENT' ? { sentAt: at, error: undefined, ...(res.id ? { messageId: res.id } : {}) } : { error: res.error }) }, 'SENDING')
  await sb.from('audit_log').insert({ at, by_user: null, action: `WELCOME_${res.status}`, detail: `${r.booking_code}: whatsapp → ${res.to ?? r.mobile ?? '—'}${res.error ? ` (${res.error})` : ''} (server)` })
  if (res.status === 'FAILED' && r.ops_member_id) {
    await sb.from('notifications').insert({ user_id: r.ops_member_id, title: 'Welcome WhatsApp not sent', body: `${r.booking_code} · ${r.company_name}: ${res.error} — open the file to retry`, link: `/bookings/${r.id}`, kind: 'warning', created_at: at })
  }
  return { status: res.status, to: res.to ?? r.mobile ?? '', error: res.error }
}
