// Public job applications (/apply/<token>) on the live CRM: the server saves the application with SUPABASE_SECRET_KEY,
// so a candidate (not signed in) never writes to a table directly — and HR is told even though the candidate can't see
// who HR is. The resume was already uploaded to the private "crm-files" bucket by the form page; it is checked here
// (it must exist, and really be a PDF or Word file).
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { applicationProblems, candidateTypeLabel, formPositions, MAX_UPLOAD_BYTES, normMobile, RESUME_MIME, sniffType } from '../supabase/form-rules.mjs'

const BUCKET = 'crm-files'
const reply = (status, body) => ({ status, body })
const no = (status, message, extra = {}) => reply(status, { success: false, message, ...extra })
const admin = (env) => {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  return url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max)

// spam guard per address: 10 applications an hour
const hits = new Map()
function limited(ip, now = Date.now()) {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k)
  return list.length > 10
}

/** POST /api/apply/<token> — { application: {name, email, phone, branch, …}, resume: FileRef }. */
export async function submitJobApplication(env, token, raw, ip, client) {
  if (limited(`a:${ip}`)) return no(429, 'Too many applications from this connection — please try again later.')
  let p
  try { p = JSON.parse(raw || '{}') } catch { return no(400, 'Bad request.') }
  const sb = client ?? admin(env)
  if (!sb) return no(503, 'Applications can’t be received right now — please try again later.')
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return no(404, 'This link is not valid.')
  // all columns: an older database may not have the positions column yet
  const { data: form, error: formErr } = await sb.from('candidate_forms').select('*').eq('token', token).maybeSingle()
  if (formErr) throw new Error(formErr.message)
  if (!form) return no(404, 'This link is not valid. Please check it with the person who sent it to you.')
  if (!form.active) return no(410, 'Applications for this role are closed.')

  const a = p.application ?? {}
  const errors = applicationProblems(a, Date.now(), formPositions(form))
  if (Object.keys(errors).length) return no(422, Object.values(errors)[0], { errors })
  const email = text(a.email, 200).toLowerCase()
  const { data: dup } = await sb.from('candidate_applications').select('id').eq('form_id', form.id).eq('email', email).maybeSingle()
  if (dup) return no(409, 'You have already applied for this role with this email.')

  // the resume the page uploaded: it must be there, be ours (file-…), and really be a PDF / Word file
  const r = p.resume ?? {}
  if (typeof r.id !== 'string' || !/^file-[A-Za-z0-9_-]{4,64}$/.test(r.id)) return no(422, 'Upload your resume (PDF or Word).', { errors: { resume: 'Upload your resume.' } })
  const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(r.id)
  if (dlErr || !blob) return no(422, 'Your resume didn’t upload completely — please choose the file again.', { errors: { resume: 'Choose the file again.' } })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const kind = sniffType(bytes)
  if (!kind || !RESUME_MIME.includes(kind) || bytes.length > MAX_UPLOAD_BYTES) {
    await sb.storage.from(BUCKET).remove([r.id]).catch(() => undefined)
    return no(422, 'The resume must be a PDF or Word file up to 5 MB.', { errors: { resume: 'PDF or Word, up to 5 MB.' } })
  }
  const at = new Date().toISOString()
  const resume = { id: r.id, name: text(r.name, 120).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'resume', type: kind, size: bytes.length, at: typeof r.at === 'string' ? r.at : at }

  const row = {
    id: `cand-${randomBytes(9).toString('base64url')}`, form_id: form.id, name: text(a.name, 120), email, phone: normMobile(a.phone), city: text(a.city, 80),
    dob: /^\d{4}-\d{2}-\d{2}$/.test(String(a.dob ?? '')) ? a.dob : null, qualification: text(a.qualification, 200), college: text(a.college, 200) || null,
    experience: text(a.experience, 40) || 'Fresher', current_company: text(a.currentCompany, 200) || null, expected_salary: text(a.expectedSalary, 60) || null,
    notice_period: text(a.noticePeriod, 60) || null, linkedin: /^https?:\/\//i.test(text(a.linkedin)) ? text(a.linkedin) : null, message: text(a.message, 4000) || null,
    branch: a.branch, position: text(a.position, 120), candidate_type: a.candidateType, interview_at: a.interviewAt,
    current_ctc: text(a.currentCtc, 60) || null,
    resume, status: 'NEW', notes: null, submitted_at: at,
  }
  let { error } = await sb.from('candidate_applications').insert(row)
  // the database update with the new columns isn't run yet: keep the application, those answers in the message
  const NEW_COLS = { branch: 'Branch', position: 'Position', candidate_type: 'Applying as', interview_at: 'Preferred interview', current_ctc: 'Current CTC' }
  if (error && Object.keys(NEW_COLS).some((c) => error.message.includes(`'${c}'`))) {
    const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !(k in NEW_COLS)))
    const lines = Object.entries(NEW_COLS).filter(([k]) => row[k]).map(([k, label]) => `${label}: ${k === 'candidate_type' ? candidateTypeLabel(row[k]) : row[k]}`)
    ;({ error } = await sb.from('candidate_applications').insert({ ...rest, message: [...lines, rest.message].filter(Boolean).join('\n') }))
  }
  if (error) throw new Error(`saving the application: ${error.message}`)

  // tell HR (and anyone who runs recruitment)
  const [{ data: users }, { data: extra }] = await Promise.all([
    sb.from('app_users').select('id, role, active'), sb.from('user_extra_roles').select('user_id, role'),
  ])
  const hr = new Set([...(users ?? []).filter((u) => u.active && u.role === 'hr').map((u) => u.id), ...(extra ?? []).filter((x) => x.role === 'hr').map((x) => x.user_id)])
  const active = new Set((users ?? []).filter((u) => u.active).map((u) => u.id))
  const to = [...hr].filter((id) => active.has(id))
  if (to.length) await sb.from('notifications').insert(to.map((user_id) => ({ user_id, title: 'New application', body: `${row.name} · ${row.position || form.title} · ${a.branch} · ${candidateTypeLabel(a.candidateType)} · interview ${String(a.interviewAt).replace('T', ' ')}`, link: '/candidates', kind: 'action', created_at: at })))
  return reply(200, { success: true, message: 'Application received.' })
}
