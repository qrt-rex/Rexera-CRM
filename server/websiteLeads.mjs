// Website enquiries (rexera.co.in) → CRM leads.
// The site's contact / enquiry form posts here (JSON or a normal HTML form). The lead is saved in Supabase straight
// away (SUPABASE_SECRET_KEY, server only) with source "Website (rexera.co.in)", shared out in turn when the Super Admin
// has automatic assignment on, and the Super Admins (and the person who got it) are notified.
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const WEBSITE_SOURCE = 'Website (rexera.co.in)'

/** Form field names differ between site builders (WordPress, Elementor, Contact Form 7, custom): accept the usual ones. */
const ALIASES = {
  name: ['name', 'full_name', 'fullname', 'your-name', 'your_name', 'fname', 'first_name', 'contact_name'],
  phone: ['phone', 'mobile', 'mobile_number', 'phone_number', 'contact', 'contact_number', 'your-phone', 'tel', 'whatsapp'],
  email: ['email', 'your-email', 'your_email', 'email_address', 'mail'],
  company: ['company', 'company_name', 'business', 'business_name', 'organisation', 'organization', 'firm'],
  city: ['city', 'location', 'town', 'your-city'],
  state: ['state', 'region'],
  service: ['service', 'services', 'scheme', 'interest', 'interested_in', 'product', 'subject', 'your-subject'],
  business_type: ['business_type', 'businesstype', 'business_category', 'industry_type'],
  requirement: ['requirement', 'requirements', 'funding_requirement', 'funding_amount', 'amount', 'loan_amount'],
  message: ['message', 'your-message', 'your_message', 'msg', 'notes', 'comments', 'comment', 'query', 'details', 'description'],
  page: ['page', 'page_url', 'source_url', 'url', 'form_name', 'form'],
}
const pick = (o, keys) => { for (const k of keys) { const v = o[k] ?? o[k.toLowerCase()]; if (v != null && String(v).trim()) return String(v).trim().slice(0, 2000) } return '' }

/** 10-digit Indian mobile (drops +91 / 91 / 0 in front and any spaces or dashes), or '' when it isn't one. */
export function normMobile(v) {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}

/** Reads a JSON or form-encoded body into the lead fields. */
export function parseEnquiry(contentType, raw) {
  let o = {}
  if (/json/i.test(contentType ?? '')) { try { o = JSON.parse(raw || '{}') } catch { return { error: 'Bad JSON' } } }
  else o = Object.fromEntries(new URLSearchParams(raw ?? ''))
  // some builders nest the fields: { fields: {...} } / { form_fields: {...} }
  const flat = { ...o, ...(typeof o.fields === 'object' ? o.fields : {}), ...(typeof o.form_fields === 'object' ? o.form_fields : {}) }
  const lower = Object.fromEntries(Object.entries(flat).map(([k, v]) => [k.toLowerCase(), typeof v === 'object' && v ? (v.value ?? JSON.stringify(v)) : v]))
  const f = Object.fromEntries(Object.entries(ALIASES).map(([k, keys]) => [k, pick(lower, keys)]))
  f.phone = normMobile(f.phone)
  f.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? f.email.toLowerCase() : ''
  // a filled hidden "honeypot" field means a spam bot
  f.spam = !!pick(lower, ['website', '_hp', 'hp', 'honeypot', 'fax'])
  f.key = pick(lower, ['key', 'crm_key'])
  f.redirect = pick(lower, ['_redirect', 'redirect', 'thank_you_url'])
  const known = new Set(Object.values(ALIASES).flat().concat(['website', '_hp', 'hp', 'honeypot', 'fax', 'key', 'crm_key', '_redirect', 'redirect', 'thank_you_url', 'fields', 'form_fields']))
  f.extra = Object.fromEntries(Object.entries(lower).filter(([k, v]) => !known.has(k) && v != null && String(v).trim()).slice(0, 30).map(([k, v]) => [k, String(v).slice(0, 500)]))
  return { lead: f }
}

const sameKey = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }

// at most 20 enquiries per 10 minutes from one address (spam guard)
const hits = new Map()
function limited(ip, now = Date.now()) {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000)
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 600_000)) hits.delete(k)
  return list.length > 20
}

/** Start of today in India (the "New since before today" rule), whatever the server's clock zone. */
const istMidnight = (now = Date.now()) => { const ist = new Date(now + 5.5 * 3600_000); return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000 }

/**
 * Handles one enquiry. Returns { status, body } (and `redirect` for a plain HTML form that asked for a thank-you page).
 * `env(name)` reads the server's environment.
 */
export async function receiveWebsiteLead(env, { contentType, raw, ip, headerKey }, client) {
  const parsed = parseEnquiry(contentType, raw)
  if (parsed.error) return { status: 400, body: { success: false, message: parsed.error } }
  const x = parsed.lead
  const key = env('WEBSITE_LEAD_KEY')
  if (key && !sameKey(headerKey || x.key, key)) return { status: 401, body: { success: false, message: 'Wrong or missing form key.' } }
  const done = { status: 200, body: { success: true, message: 'Thank you — our team will call you shortly.' }, redirect: /^https:\/\//i.test(x.redirect) ? x.redirect : undefined }
  if (limited(ip || 'unknown')) return { status: 429, body: { success: false, message: 'Too many enquiries from this connection — please try again later.' } }

  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  const sb = client ?? (url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null)
  if (x.spam) { await logAttempt(sb, x, 'SPAM'); return done } // bots get a normal answer and nothing is saved
  if (!x.phone) { await logAttempt(sb, x, 'INVALID', { error: 'No valid 10-digit mobile number' }); return { status: 422, body: { success: false, message: 'Please enter a valid 10-digit mobile number.' } } }
  if (!sb) return { status: 503, body: { success: false, message: 'The CRM is not connected yet (SUPABASE_URL and SUPABASE_SECRET_KEY on the server).' } }
  if (x.name.length < 2) x.name = x.company || 'Website enquiry'
  try {
    const r = await saveLead(sb, x)
    await logAttempt(sb, x, r.existing ? 'EXISTING' : 'SAVED', { leadId: r.id })
    return done
  } catch (e) {
    // kept in the log with every field, so the Super Admin can retry it from Website → Leads
    await logAttempt(sb, x, 'FAILED', { error: e.message })
    throw e
  }
}

/** The fields of an enquiry worth keeping (never the form key or the redirect). */
const keep = (x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => !['key', 'redirect', 'spam'].includes(k) && v !== '' && v != null))
/** One line in the website lead log (Website → Leads). A failure to write the log never loses the enquiry itself. */
async function logAttempt(sb, x, status, extra = {}) {
  const row = {
    id: `wl-${crypto.randomUUID().slice(0, 12)}`, at: new Date().toISOString(), status, form: x.page || null, name: x.name || null, phone: x.phone || null,
    email: x.email || null, error: extra.error ?? null, lead_id: extra.leadId ?? null, fields: status === 'SPAM' ? null : keep(x),
  }
  if (sb) try { await sb.from('website_lead_log').insert(row) } catch { /* the lead flow goes on */ }
  return row
}

/**
 * POST /api/website-lead/retry — { id, phone? }: saves a failed (or phone-less) website enquiry as a lead again.
 * `who` is the signed-in CRM user; only the Super Admin / IT may do it.
 */
export async function retryWebsiteLead(sb, who, body) {
  if (!who || !who.roles.some((r) => r === 'superadmin' || r === 'it')) return { status: 403, body: { success: false, message: 'Only the Super Admin can retry website leads.' } }
  const { data: row } = await sb.from('website_lead_log').select('*').eq('id', String(body?.id ?? '')).maybeSingle()
  if (!row) return { status: 404, body: { success: false, message: 'Not found.' } }
  if (!['FAILED', 'INVALID'].includes(row.status)) return { status: 409, body: { success: false, message: 'This enquiry is already in CRM Leads.' } }
  const x = { ...(row.fields ?? {}), extra: row.fields?.extra ?? {} }
  if (body?.phone) x.phone = normMobile(body.phone)
  if (!x.phone) return { status: 422, body: { success: false, message: 'Enter a valid 10-digit mobile number to save it.' } }
  if (!x.name || x.name.length < 2) x.name = x.company || 'Website enquiry'
  try {
    const r = await saveLead(sb, x)
    await sb.from('website_lead_log').update({ status: r.existing ? 'EXISTING' : 'SAVED', lead_id: r.id ?? null, phone: x.phone, error: null, retried_at: new Date().toISOString(), retried_by: who.id }).eq('id', row.id)
    return { status: 200, body: { success: true, message: r.existing ? 'Added to the existing lead with this number.' : 'Saved as a new lead.' } }
  } catch (e) {
    await sb.from('website_lead_log').update({ error: e.message, retried_at: new Date().toISOString(), retried_by: who.id }).eq('id', row.id)
    return { status: 502, body: { success: false, message: `Still not saved: ${e.message}` } }
  }
}

/** Saves the enquiry: a new lead (auto-assigned when that is on), or a note on the existing lead with this number. */
export async function saveLead(sb, x, now = new Date()) {
  const at = now.toISOString()
  const note = [x.service && `Interested in: ${x.service}`, x.requirement && `Requirement: ${x.requirement}`, x.message].filter(Boolean).join('\n')
  const event = { at, by: '', action: 'Website form', note: [x.page, x.service].filter(Boolean).join(' · ') || 'rexera.co.in' }
  const superAdmins = async () => ((await sb.from('app_users').select('id').eq('role', 'superadmin').eq('active', true)).data ?? []).map((u) => u.id)
  const notify = async (rows) => { if (rows.length) await sb.from('notifications').insert(rows.map((r) => ({ ...r, kind: 'action', created_at: at }))) }

  const { data: old } = await sb.from('leads').select('id, name, assigned_to, history, notes').eq('phone', x.phone).maybeSingle()
  if (old) {
    await sb.from('leads').update({ history: [{ ...event, action: 'Filled the website form again' }, ...(old.history ?? [])].slice(0, 200), notes: [old.notes, note].filter(Boolean).join('\n').slice(0, 8000) }).eq('id', old.id)
    const ids = old.assigned_to ? [old.assigned_to] : await superAdmins()
    await notify(ids.map((user_id) => ({ user_id, title: 'Website enquiry from an existing lead', body: `${old.name} · ${x.phone}${x.service ? ` — ${x.service}` : ''}`, link: old.assigned_to ? '/dialer' : '/leads' })))
    return { id: old.id, existing: true }
  }

  const owner = await nextOwner(sb, now)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: s } = await sb.from('app_settings').select('value').eq('key', 'counters').maybeSingle()
    const counters = s?.value ?? { booking: 1, lead: 1, invoice: 1 }
    const id = `lead-web-${crypto.randomUUID().slice(0, 12)}`
    const row = {
      id, code: `LD-${counters.lead}`, name: x.name, phone: x.phone, email: x.email || null, company: x.company, city: x.city, state: x.state, service: x.service,
      requirement: x.requirement || null, ...(x.business_type ? { business_type: x.business_type } : {}), source: WEBSITE_SOURCE, status: 'NEW', notes: note, created_at: at, form_at: at,
      extra: Object.keys(x.extra ?? {}).length || x.page ? { ...(x.extra ?? {}), ...(x.page ? { page: x.page } : {}) } : null,
      history: owner ? [{ at, by: '', action: `Assigned to ${owner.name} (round robin)`, note: 'Auto-assigned' }, event] : [event],
      ...(owner ? { assigned_to: owner.id, assigned_at: at, chain: [{ to: owner.id, by: '', at, kind: 'ASSIGNED', note: 'Auto-assigned (website)' }] } : {}),
    }
    const { error } = await sb.from('leads').insert(row)
    if (!error) {
      await sb.from('app_settings').upsert({ key: 'counters', value: { ...counters, lead: counters.lead + 1 } }, { onConflict: 'key' })
      if (owner) await sb.from('app_settings').upsert({ key: 'leadAssign', value: owner.settings }, { onConflict: 'key' })
      const sa = await superAdmins()
      await notify([
        ...sa.map((user_id) => ({ user_id, title: 'New website enquiry', body: `${x.name} · ${x.phone}${x.service ? ` — ${x.service}` : ''}${owner ? ` · given to ${owner.name}` : ' — assign it from CRM Leads → Unassigned'}`, link: '/leads' })),
        ...(owner && !sa.includes(owner.id) ? [{ user_id: owner.id, title: 'New lead assigned to you', body: `${x.name} · website enquiry${x.service ? ` — ${x.service}` : ''}`, link: '/dialer' }] : []),
      ])
      return { id, existing: false, owner: owner?.id }
    }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`saving the website lead: ${error.message}`)
    if (/phone/i.test(error.message)) return { existing: true } // the same number arrived meanwhile
    await sb.from('app_settings').upsert({ key: 'counters', value: { ...counters, lead: counters.lead + 1 } }, { onConflict: 'key' })
  }
  throw new Error('Could not number the website lead — try again.')
}

/** Round robin (same rule as the CRM): next active sales person / team leader in the list without overdue "New" leads. */
async function nextOwner(sb, now) {
  const { data: s } = await sb.from('app_settings').select('value').eq('key', 'leadAssign').maybeSingle()
  const rr = s?.value
  if (!rr?.on || !rr.userIds?.length) return null
  const [{ data: users }, { data: extra }] = await Promise.all([
    sb.from('app_users').select('id, name, role, active').in('id', rr.userIds),
    sb.from('user_extra_roles').select('user_id, role').in('user_id', rr.userIds),
  ])
  const sales = new Set((users ?? []).filter((u) => u.active && (['sales', 'teamlead'].includes(u.role) || (extra ?? []).some((e) => e.user_id === u.id && ['sales', 'teamlead'].includes(e.role)))).map((u) => u.id))
  const { data: stale } = await sb.from('leads').select('assigned_to').in('assigned_to', [...sales]).eq('status', 'NEW').lt('assigned_at', new Date(istMidnight(now.getTime())).toISOString())
  const blocked = new Set((stale ?? []).map((l) => l.assigned_to))
  const n = rr.userIds.length
  for (let k = 0; k < n; k++) {
    const i = (((rr.next ?? 0) + k) % n + n) % n
    const id = rr.userIds[i]
    if (sales.has(id) && !blocked.has(id)) return { id, name: (users ?? []).find((u) => u.id === id)?.name ?? 'sales', settings: { ...rr, next: (i + 1) % n } }
  }
  return null
}
