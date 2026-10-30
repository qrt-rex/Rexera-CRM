// Scheduled jobs for the live CRM (Supabase): welcome-email retries, 15-day file follow-ups, Pitch Deck reminders
// and the one-day-before scheme expiry alert. Called every 15 minutes by a Render Cron Job (POST /api/jobs/run with
// JOBS_SECRET) — they don't depend on anyone having the CRM open.
//
// Every reminder is recorded once in reminder_log (unique key), and a file's next date is only moved on when it is
// still the date that was read — so two runs (or a run and a browser) never send the same reminder twice.
import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  ACTIVE_FILE_STATUSES, addDays, adminStatusLabel, fillTemplate, followUpDue, istToday, nextAfter, precheckDue, schemeAlertDue, workflowSettings,
} from '../supabase/workflow-rules.mjs'
import { rowWelcomeVars, welcomeWhatsapp } from './whatsapp.mjs'

const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}
const fmt = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const STAGES = ['Data Collection', 'Data Received', 'Document In-process / In-review', 'Document Approved', 'Ready to Submit', 'Submission', 'Company Information Under Process', 'Approved / Rejected / Re-submission / Hold']
const stageText = (r) => `${r.stage}. ${STAGES[r.stage - 1] ?? ''}`

/** A booking row as the shared rules read it. */
const asFile = (r) => ({ id: r.id, status: r.status, adminId: r.admin_id, followUp: r.follow_up, adminWork: r.admin_work })

/** Takes the reminder key; false when it was already taken (sent before). */
async function once(sb, key, kind, refId, recipients) {
  const { data, error } = await sb.from('reminder_log').upsert({ key, kind, ref_id: refId, recipients }, { onConflict: 'key', ignoreDuplicates: true }).select('key')
  if (error) throw new Error(`reminder_log: ${error.message}`)
  return !!data?.length
}
async function notify(sb, ids, title, body, link, kind = 'warning') {
  const users = [...new Set(ids.filter(Boolean))]
  if (!users.length) return 0
  const at = new Date().toISOString()
  const { error } = await sb.from('notifications').insert(users.map((user_id) => ({ user_id, title, body, link, kind, created_at: at })))
  if (error) throw new Error(`notifications: ${error.message}`)
  return users.length
}
const audit = (sb, action, detail) => sb.from('audit_log').insert({ at: new Date().toISOString(), by_user: null, action, detail })

/**
 * Runs everything that is due. `send(body)` delivers one client email ({ success, message, configured? }).
 * Returns what was done, for the server log and Admin → Workflow settings.
 */
export async function runJobs(env, { send, now = Date.now(), client, fetchImpl } = {}) {
  const sb = client ?? admin(env)
  if (!sb) return { ok: false, message: 'Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.' }
  const t = istToday(now)
  const { data: ws } = await sb.from('app_settings').select('value').eq('key', 'workflow').maybeSingle()
  const w = workflowSettings(ws?.value ?? undefined)
  const out = { ok: true, at: new Date(now).toISOString(), today: t, welcome: { sent: 0, failed: 0, whatsappSent: 0, whatsappFailed: 0 }, followUps: 0, precheck: 0, schemes: 0, errors: [] }
  const step = async (name, fn) => { try { await fn() } catch (e) { out.errors.push(`${name}: ${e.message}`) } }

  // ---------------------------------------------------------------- active files
  let files = []
  await step('files', async () => {
    const { data, error } = await sb.from('bookings').select('id, booking_code, company_name, contact_person, email, mobile, status, stage, service_name, ops_member_id, admin_id, follow_up, admin_work, welcome')
      .in('status', ACTIVE_FILE_STATUSES)
    if (error) throw new Error(error.message)
    files = data ?? []
  })
  const people = new Map()
  await step('users', async () => {
    const { data } = await sb.from('app_users').select('id, name, phone, email, role, active')
    for (const u of data ?? []) people.set(u.id, u)
  })
  const name = (id) => people.get(id)?.name ?? '—'
  // Automation Center: a built-in automation IT Support switched off is skipped here too (no table yet = all on)
  const off = new Set()
  try {
    const { data, error } = await sb.from('automation_rules').select('id, enabled').like('id', 'builtin:%')
    if (!error) for (const r of data ?? []) if (r.enabled === false) off.add(r.id.slice('builtin:'.length))
  } catch { /* older database: everything stays on */ }
  out.skipped = [...off]

  // ---------------------------------------------------------------- 15-day follow-ups
  if (!off.has('file-follow-ups')) for (const r of files) {
    if (!followUpDue(asFile(r), t)) continue
    await step(`follow-up ${r.booking_code}`, async () => {
      const f = r.follow_up, was = f.nextOn
      const to = [r.ops_member_id, r.admin_id]
      if (!(await once(sb, `followup:${r.id}:${was}`, 'FOLLOW_UP', r.id, to.filter(Boolean)))) return
      const next = { ...f, nextOn: nextAfter(was, f.everyDays, t), log: [{ at: new Date(now).toISOString(), by: '', kind: 'REMINDER', note: `Due ${was} · next ${nextAfter(was, f.everyDays, t)} (server)` }, ...(f.log ?? [])].slice(0, 200) }
      // only if nobody moved it meanwhile
      const { data } = await sb.from('bookings').update({ follow_up: next }).eq('id', r.id).eq('follow_up->>nextOn', was).select('id')
      if (!data?.length) return
      await notify(sb, to, `Follow-up due: ${r.company_name}`, `${r.booking_code} · ${r.company_name} · ${stageText(r)} · last follow-up ${fmt(f.lastOn)} · next ${fmt(next.nextOn)} · ${name(r.ops_member_id)} — follow up with the client and record it on the file`, `/bookings/${r.id}`)
      out.followUps++
    })
  }

  // ---------------------------------------------------------------- Pitch Deck (every 3 or 4 days)
  if (!off.has('pitch-deck-reminders')) for (const r of files) {
    if (!precheckDue(asFile(r), t)) continue
    await step(`pitch deck ${r.booking_code}`, async () => {
      const pc = r.admin_work.PRECHECK, was = pc.nextRemindOn
      const to = [pc.assignee ?? r.admin_id, r.ops_member_id]
      if (!(await once(sb, `precheck:${r.id}:${was}`, 'PRECHECK', r.id, to.filter(Boolean)))) return
      const every = pc.remindEveryDays ?? w.precheckDays
      const nextOn = nextAfter(was, every, t)
      const work = { ...r.admin_work, PRECHECK: { ...pc, nextRemindOn: nextOn, history: [...(pc.history ?? []), { at: new Date(now).toISOString(), by: '', status: pc.status, note: `Reminder (due ${was}) · next ${nextOn} (server)` }].slice(-200) } }
      const { data } = await sb.from('bookings').update({ admin_work: work }).eq('id', r.id).eq('admin_work->PRECHECK->>nextRemindOn', was).select('id')
      if (!data?.length) return
      await notify(sb, to, `Pitch Deck follow-up: ${r.company_name}`, `${r.booking_code} · ${r.company_name} · ${adminStatusLabel(pc.status)} · last follow-up ${fmt(pc.lastFollowUpOn)} · next ${fmt(nextOn)} — follow up and record it`, `/bookings/${r.id}`)
      out.precheck++
    })
  }

  // ---------------------------------------------------------------- scheme ends tomorrow
  if (!off.has('scheme-expiry-alerts')) await step('schemes', async () => {
    const { data: schemes, error } = await sb.from('schemes').select('id, title, active, end_date').eq('active', true).eq('end_date', addDays(t, 1))
    if (error) throw new Error(error.message)
    if (!schemes?.length) return
    const { data: extra } = await sb.from('user_extra_roles').select('user_id, role')
    const roles = w.schemeAlertRoles
    const to = [...people.values()].filter((u) => u.active && (roles.includes(u.role) || (extra ?? []).some((e) => e.user_id === u.id && roles.includes(e.role)))).map((u) => u.id)
    for (const s of schemes) {
      if (!schemeAlertDue({ active: s.active, endDate: s.end_date }, t)) continue
      if (!(await once(sb, `scheme:${s.id}:${s.end_date}`, 'SCHEME_EXPIRY', s.id, to))) continue
      await notify(sb, to, `Scheme ends tomorrow: ${s.title}`, `Ends ${fmt(s.end_date)} — update or close it`, '/schemes')
      // the browser fallback looks for this entry, so it never repeats the alert
      await audit(sb, 'SCHEME_EXPIRY_ALERT', `${s.id}|${s.end_date}|${s.title}`)
      out.schemes++
    }
  })

  // ---------------------------------------------------------------- welcome messages the approving screen didn't send
  const { data: co } = await sb.from('app_settings').select('value').eq('key', 'company').maybeSingle()
  const company = co?.value?.name || 'Rexera'
  if (send && !off.has('welcome-messages')) {
    const stale = (iso, min) => !iso || now - new Date(iso).getTime() >= min * 60_000
    for (const r of files) {
      const e = r.welcome?.email
      if (!e) continue
      // queued for 5 min (the screen closed), stuck sending for 15 min, or failed (up to 3 tries, 30 min apart)
      const due = (e.status === 'PENDING' && stale(r.welcome.createdAt, 5)) || (e.status === 'SENDING' && stale(e.lastAt, 15)) || (e.status === 'FAILED' && e.attempts < 3 && stale(e.lastAt, 30))
      if (!due || !r.email) continue
      await step(`welcome ${r.booking_code}`, async () => {
        const claim = { ...r.welcome, email: { ...e, status: 'SENDING', attempts: e.attempts + 1, lastAt: new Date(now).toISOString(), to: r.email } }
        const { data } = await sb.from('bookings').update({ welcome: claim }).eq('id', r.id).eq('welcome->email->>status', e.status).select('id')
        if (!data?.length) return // someone else took it
        const vars = rowWelcomeVars(r, w, company, people.get(r.ops_member_id))
        const subject = fillTemplate(w.welcomeEmail.subject, vars)
        const res = await send({
          to: r.email, subject, heading: 'Your file is with our Operations team', message: fillTemplate(w.welcomeEmail.body, vars), company,
          details: [['Reference', r.booking_code], ['Company', r.company_name], ['Service', r.service_name], ['Current status', vars.status], ['Operations contact', [vars.ops_name, vars.ops_phone].filter(Boolean).join(' · ')]],
          sender: { name: vars.ops_name, role: 'Operations', ...(vars.ops_phone ? { phone: vars.ops_phone } : {}), ...(vars.ops_email ? { email: vars.ops_email } : {}) },
          ...(vars.ops_email ? { replyTo: vars.ops_email } : {}),
        })
        // the run's own time: the 30-minute retry gap is measured from it
        const at = new Date(now).toISOString()
        const status = res.success ? 'SENT' : res.configured === false ? 'NOT_CONFIGURED' : 'FAILED'
        const result = { ...claim, email: { ...claim.email, status, lastAt: at, ...(res.success ? { sentAt: at, error: undefined } : { error: res.message }) } }
        await sb.from('bookings').update({ welcome: result }).eq('id', r.id)
        r.welcome = result
        if (status === 'SENT' || status === 'FAILED') await sb.from('booking_client_emails').insert({ id: `ce-job-${r.id}-${claim.email.attempts}`, booking_id: r.id, sent_by: null, sent_at: at, to_email: r.email, cc: [], subject, template: 'welcome', status, error: res.success ? null : res.message })
        await audit(sb, `WELCOME_${status}`, `${r.booking_code}: email → ${r.email}${res.success ? '' : ` (${res.message})`} (server)`)
        if (res.success) out.welcome.sent++
        else { out.welcome.failed++; await notify(sb, [r.ops_member_id], 'Welcome email not sent', `${r.booking_code} · ${r.company_name}: ${res.message} — open the file to retry`, `/bookings/${r.id}`) }
      })
    }
  }
  // WhatsApp (Interakt): queued for 5 min, stuck, or failed — sent at most once per file (reminder_log)
  if (!off.has('welcome-messages')) for (const r of files) {
    if (!r.welcome?.whatsapp) continue
    await step(`welcome WhatsApp ${r.booking_code}`, async () => {
      const res = await welcomeWhatsapp(sb, env, r, { w, company, ops: people.get(r.ops_member_id), now, fetchImpl })
      if (res?.status === 'SENT') out.welcome.whatsappSent++
      else if (res?.status === 'FAILED') out.welcome.whatsappFailed++
    })
  }

  // the CRM shows when the job last ran (and stops its own browser fallback while it runs)
  const summary = `follow-ups ${out.followUps} · pitch deck ${out.precheck} · schemes ${out.schemes} · welcome sent ${out.welcome.sent}, failed ${out.welcome.failed} · WhatsApp sent ${out.welcome.whatsappSent}, failed ${out.welcome.whatsappFailed}${out.errors.length ? ` · ${out.errors.length} error(s)` : ''}`
  await sb.from('app_settings').upsert({ key: 'jobs', value: { lastRunAt: out.at, summary } }, { onConflict: 'key' })
  return { ...out, summary }
}

/** POST /api/jobs/run: only with the right secret (header X-Jobs-Secret or ?key=), at least 16 characters. */
export const jobsAuthorized = (env, headerKey, queryKey) => {
  const want = Buffer.from(env('JOBS_SECRET') || ''), got = Buffer.from(String(headerKey || queryKey || ''))
  return want.length >= 16 && got.length === want.length && timingSafeEqual(got, want)
}
