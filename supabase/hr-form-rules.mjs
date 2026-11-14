/**
 * HR Form Builder — the rules (pure, no database): field types and their settings, checking a form before it is
 * published, who a form is assigned to, checking an employee's answers (frontend; the database guards the status
 * steps), statuses, the response list with its filters, and the analytics. Shared by the app (src/lib/hrForms.ts,
 * the HR pages and My Forms) and the tests (hr-form-rules.test.mjs).
 */

/** Field types: [type, label, group] */
export const FIELD_TYPES = [
  ['text', 'Short text', 'Text'], ['textarea', 'Long text', 'Text'], ['email', 'Email', 'Text'], ['phone', 'Phone number', 'Text'],
  ['number', 'Number', 'Text'], ['date', 'Date', 'Text'],
  ['select', 'Dropdown', 'Choice'], ['multiselect', 'Multi-select dropdown', 'Choice'], ['checkbox', 'Checkboxes', 'Choice'], ['radio', 'Radio buttons', 'Choice'],
  ['file', 'File upload', 'Files'], ['files', 'Multiple file upload', 'Files'], ['image', 'Image upload', 'Files'],
  ['employee', 'Employee selection', 'People'],
]
export const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map(([t, l]) => [t, l]))
export const CHOICE_TYPES = ['select', 'multiselect', 'checkbox', 'radio']
export const MULTI_TYPES = ['multiselect', 'checkbox']
export const FILE_TYPES = ['file', 'files', 'image']
export const TEXT_TYPES = ['text', 'textarea', 'email', 'phone']

/** File formats HR can allow: [key, label, extensions, MIME prefixes] */
export const FORMATS = [
  ['pdf', 'PDF', ['pdf'], ['application/pdf']],
  ['word', 'Word', ['doc', 'docx'], ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml']],
  ['excel', 'Excel', ['xls', 'xlsx', 'csv'], ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml', 'text/csv']],
  ['image', 'Images (JPG / PNG)', ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp']],
]
export const MAX_FILE_MB = 25
export const DEFAULT_FILE_MB = 10
export const MAX_FILES = 20

export const STATUS_LABEL = {
  PENDING: 'Pending', IN_PROGRESS: 'In Progress', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under Review',
  CHANGES_REQUESTED: 'Correction requested', APPROVED: 'Approved', REJECTED: 'Rejected',
}
/** statuses an employee can still change their answers in */
export const EDITABLE = ['IN_PROGRESS', 'CHANGES_REQUESTED']
/** statuses that count as sent to HR */
export const SENT = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']

const blank = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length) || v === false
const num = (v) => (v === '' || v == null ? undefined : Number(v))
const extOf = (name) => (String(name ?? '').split('.').pop() ?? '').toLowerCase()

/** The formats a file field accepts (an image field: images only). */
export const formatsOf = (f) => (f.type === 'image' ? ['image'] : f.accept?.length ? f.accept : FORMATS.map((x) => x[0]))
/** The `accept` attribute for a file input. */
export const acceptAttr = (f) => formatsOf(f).flatMap((k) => FORMATS.find((x) => x[0] === k)?.[2] ?? []).map((e) => '.' + e).join(',')
export const maxFilesOf = (f) => (f.type === 'files' ? Math.min(MAX_FILES, Math.max(1, f.maxFiles ?? 5)) : 1)
export const maxMbOf = (f) => Math.min(MAX_FILE_MB, Math.max(1, f.maxSizeMb ?? DEFAULT_FILE_MB))

/** Is this file allowed in this field? null = yes, else the reason. */
export function fileProblem(f, file) {
  const ext = extOf(file.name)
  // by the file's extension (what people see; browsers report MIME types inconsistently)
  const ok = formatsOf(f).some((k) => FORMATS.find((y) => y[0] === k)?.[2].includes(ext))
  if (!ok) return `${file.name}: this file type isn't allowed here (${formatsOf(f).map((k) => FORMATS.find((x) => x[0] === k)?.[1]).join(', ')}).`
  if (file.size > maxMbOf(f) * 1048576) return `${file.name} is too large (max ${maxMbOf(f)} MB).`
  return null
}

/** A field cleaned for saving: trimmed, only the settings its type uses. */
export function tidyField(f) {
  const out = { id: f.id, type: f.type, label: String(f.label ?? '').trim(), required: !!f.required }
  const ph = String(f.placeholder ?? '').trim(); if (ph && !FILE_TYPES.includes(f.type) && !CHOICE_TYPES.includes(f.type)) out.placeholder = ph
  if (f.type === 'select' && ph) out.placeholder = ph
  const help = String(f.help ?? '').trim(); if (help) out.help = help
  if (TEXT_TYPES.includes(f.type) || MULTI_TYPES.includes(f.type) || f.type === 'number') {
    const lo = num(f.minLength), hi = num(f.maxLength)
    if (lo != null && Number.isFinite(lo)) out.minLength = Math.max(0, Math.round(lo))
    if (hi != null && Number.isFinite(hi)) out.maxLength = Math.max(0, Math.round(hi))
  }
  if (f.type === 'number') { const lo = num(f.min), hi = num(f.max); if (lo != null && Number.isFinite(lo)) out.min = lo; if (hi != null && Number.isFinite(hi)) out.max = hi; delete out.minLength; delete out.maxLength }
  if (f.type === 'text' || f.type === 'textarea') { const p = String(f.pattern ?? '').trim(); if (p) { out.pattern = p; const m = String(f.patternMessage ?? '').trim(); if (m) out.patternMessage = m } }
  if (CHOICE_TYPES.includes(f.type)) out.options = (f.options ?? []).map((o) => String(o).trim()).filter(Boolean)
  if (FILE_TYPES.includes(f.type)) {
    out.maxSizeMb = maxMbOf(f)
    if (f.type !== 'image') out.accept = (f.accept ?? []).filter((k) => FORMATS.some((x) => x[0] === k))
    if (f.type !== 'image' && !out.accept.length) delete out.accept
    if (f.type === 'files') out.maxFiles = maxFilesOf(f)
  }
  return out
}

/** What stops a form from being published (empty = ready). */
export function formProblems(form, { forPublish = true, today } = {}) {
  const p = []
  if (!String(form.title ?? '').trim()) p.push('Give the form a name.')
  if (!form.fields?.length) p.push('Add at least one field.')
  const ids = new Set()
  for (const [i, f] of (form.fields ?? []).entries()) {
    const name = String(f.label ?? '').trim() || `Field ${i + 1}`
    if (!String(f.label ?? '').trim()) p.push(`Field ${i + 1} needs a name.`)
    if (!TYPE_LABEL[f.type]) p.push(`${name}: unknown field type.`)
    if (ids.has(f.id)) p.push(`${name}: duplicate field.`); ids.add(f.id)
    if (CHOICE_TYPES.includes(f.type)) {
      const opts = (f.options ?? []).map((o) => String(o).trim()).filter(Boolean)
      if (!opts.length) p.push(`${name}: add at least one option.`)
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) p.push(`${name}: the options must be different.`)
    }
    const lo = num(f.type === 'number' ? f.min : f.minLength), hi = num(f.type === 'number' ? f.max : f.maxLength)
    if (lo != null && hi != null && lo > hi) p.push(`${name}: the minimum is more than the maximum.`)
    if (f.pattern) { try { new RegExp(f.pattern) } catch { p.push(`${name}: the validation pattern is not valid.`) } }
  }
  if (forPublish) {
    const a = form.assign ?? {}
    if (!a.everyone && !a.userIds?.length && !a.departments?.length && !a.branchIds?.length && !a.roles?.length) p.push('Choose who fills the form (employees, departments, branches or groups).')
    if (form.deadline && today && form.deadline < today) p.push('The deadline is already past.')
  }
  return p
}

const live = (u) => !!u && u.active === true && !u.deletedAt
const rolesOfUser = (u) => [u.role, ...(u.extraRoles ?? [])]
/** Is this form assigned to this person? */
export function isAssigned(form, u) {
  if (!live(u)) return false
  const a = form.assign ?? {}
  if (a.everyone) return true
  if (a.userIds?.includes(u.id)) return true
  if (u.department && a.departments?.some((d) => d.toLowerCase() === u.department.toLowerCase())) return true
  if (u.branchId && a.branchIds?.includes(u.branchId)) return true
  if (a.roles?.length && rolesOfUser(u).some((r) => a.roles.includes(r))) return true
  return false
}
export const assignees = (form, users) => users.filter((u) => isAssigned(form, u))

/** The status an employee sees for a form: their submission's, or Pending. */
export const statusOf = (sub) => (sub ? sub.status : 'PENDING')
export const isOverdue = (form, sub, today) => !!form.deadline && form.deadline < today && !SENT.includes(statusOf(sub))
/** Can the employee open the form to fill / change it? */
export function canFill(form, sub, today) {
  if (form.status !== 'PUBLISHED') return sub?.status === 'CHANGES_REQUESTED' && form.status !== 'ARCHIVED'
  if (sub && !EDITABLE.includes(sub.status)) return false
  // after the deadline only a correction HR asked for can be sent
  if (form.deadline && form.deadline < today && sub?.status !== 'CHANGES_REQUESTED') return false
  return true
}

/** One answer checked against its field: null = fine, else the message. ctx: { users } for employee fields. */
export function answerProblem(f, v, ctx = {}) {
  const name = f.label || 'This field'
  if (blank(v)) return f.required ? `${name} is required.` : null
  const s = typeof v === 'string' ? v.trim() : v
  switch (f.type) {
    case 'text': case 'textarea': case 'email': case 'phone': {
      if (typeof s !== 'string') return `${name}: enter text.`
      if (f.minLength != null && s.length < f.minLength) return `${name}: at least ${f.minLength} characters.`
      if (f.maxLength != null && s.length > f.maxLength) return `${name}: at most ${f.maxLength} characters.`
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return `${name}: enter a valid email address.`
      if (f.type === 'phone' && !/^\+?\d{10,15}$/.test(s.replace(/[\s()-]/g, ''))) return `${name}: enter a valid phone number (10–15 digits).`
      if (f.pattern) { let re; try { re = new RegExp(`^(?:${f.pattern})$`) } catch { re = null } if (re && !re.test(s)) return f.patternMessage || `${name}: not in the expected format.` }
      return null
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      if (!Number.isFinite(n)) return `${name}: enter a number.`
      if (f.min != null && n < f.min) return `${name}: at least ${f.min}.`
      if (f.max != null && n > f.max) return `${name}: at most ${f.max}.`
      return null
    }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? null : `${name}: enter a valid date.`
    case 'select': case 'radio': return (f.options ?? []).includes(s) ? null : `${name}: pick one of the options.`
    case 'multiselect': case 'checkbox': {
      const list = Array.isArray(v) ? v : [v]
      if (list.some((x) => !(f.options ?? []).includes(x))) return `${name}: pick from the options.`
      if (f.minLength != null && list.length < f.minLength) return `${name}: pick at least ${f.minLength}.`
      if (f.maxLength != null && list.length > f.maxLength) return `${name}: pick at most ${f.maxLength}.`
      return null
    }
    case 'file': case 'files': case 'image': {
      const list = Array.isArray(v) ? v : []
      if (list.length > maxFilesOf(f)) return `${name}: at most ${maxFilesOf(f)} file(s).`
      for (const file of list) { const p = fileProblem(f, file); if (p) return p }
      return null
    }
    case 'employee': return (ctx.users ?? []).some((u) => u.id === s && live(u)) ? null : `${name}: pick an active employee.`
    default: return null
  }
}
/** Every problem in a set of answers: { fieldId: message } (empty = can be submitted). */
export function answerProblems(fields, answers, ctx = {}) {
  const out = {}
  for (const f of fields) { const p = answerProblem(f, answers?.[f.id], ctx); if (p) out[f.id] = p }
  return out
}
/** How much of a form is filled (0–100) — for "In Progress". */
export function progressOf(fields, answers) {
  const req = fields.filter((f) => f.required)
  const list = req.length ? req : fields
  if (!list.length) return 0
  return Math.round((list.filter((f) => !blank(answers?.[f.id])).length / list.length) * 100)
}

/** Answer shown as text (lists, files, employees, yes / no). */
export function answerText(f, v, ctx = {}) {
  if (blank(v)) return ''
  if (FILE_TYPES.includes(f.type)) return (Array.isArray(v) ? v : []).map((x) => x.name).join(', ')
  if (f.type === 'employee') { const u = (ctx.users ?? []).find((x) => x.id === v); return u ? `${u.name} (${u.username})` : String(v) }
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

/**
 * The response list: every assigned employee of every form that isn't a draft (Pending when they haven't started),
 * plus submissions of people no longer assigned (never lost). Newest activity first.
 */
export function responseRows({ forms, subs, users, today }) {
  const byKey = new Map(subs.map((s) => [`${s.formId}|${s.userId}`, s]))
  const rows = [], seen = new Set()
  for (const form of forms) {
    if (form.status === 'DRAFT') continue
    for (const u of users) {
      if (!isAssigned(form, u)) continue
      const sub = byKey.get(`${form.id}|${u.id}`)
      // an archived or unpublished form: only people who started it still count
      if (form.status !== 'PUBLISHED' && !sub) continue
      seen.add(`${form.id}|${u.id}`)
      rows.push(row(form, u, sub, today))
    }
  }
  for (const s of subs) {
    const k = `${s.formId}|${s.userId}`
    if (seen.has(k)) continue
    const form = forms.find((f) => f.id === s.formId), u = users.find((x) => x.id === s.userId)
    if (form && u) rows.push(row(form, u, s, today))
  }
  return rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}
const row = (form, user, sub, today) => ({
  key: `${form.id}|${user.id}`, form, user, sub, status: statusOf(sub), overdue: isOverdue(form, sub, today),
  at: sub?.submittedAt ?? sub?.updatedAt ?? form.publishedAt ?? form.createdAt,
  files: sub ? fileCount(sub) : 0,
})
export const fileCount = (sub) => sub.fields.filter((f) => FILE_TYPES.includes(f.type)).reduce((s, f) => s + (Array.isArray(sub.answers?.[f.id]) ? sub.answers[f.id].length : 0), 0)

/**
 * Filters: q (name / employee ID / email), formId, department, branchId, status (one status, or 'OPEN' = not sent,
 * 'DONE' = sent), from / to (yyyy-mm-dd, on the submission date), sort 'new' | 'old'.
 */
export function filterRows(rows, f = {}) {
  const q = String(f.q ?? '').trim().toLowerCase()
  const out = rows.filter((r) => {
    if (q && !`${r.user.name} ${r.user.username} ${r.user.email}`.toLowerCase().includes(q)) return false
    if (f.formId && r.form.id !== f.formId) return false
    if (f.department && (r.user.department ?? '') !== f.department) return false
    if (f.branchId && (r.user.branchId ?? '') !== f.branchId) return false
    if (f.status === 'OPEN' && SENT.includes(r.status)) return false
    if (f.status === 'DONE' && !SENT.includes(r.status)) return false
    if (f.status === 'OVERDUE' && !r.overdue) return false
    if (f.status && !['OPEN', 'DONE', 'OVERDUE'].includes(f.status) && r.status !== f.status) return false
    const day = (r.sub?.submittedAt ?? '').slice(0, 10)
    if (f.from && (!day || day < f.from)) return false
    if (f.to && (!day || day > f.to)) return false
    return true
  })
  return f.sort === 'old' ? out.reverse() : out
}

/** The summary cards and the department / branch progress. */
export function analytics({ forms, rows }) {
  const count = (st) => rows.filter((r) => r.status === st).length
  const group = (keyOf) => {
    const m = new Map()
    for (const r of rows) {
      const k = keyOf(r) || '—'
      const x = m.get(k) ?? { key: k, assigned: 0, sent: 0, approved: 0 }
      x.assigned++; if (SENT.includes(r.status)) x.sent++; if (r.status === 'APPROVED') x.approved++
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => b.assigned - a.assigned)
  }
  return {
    totalForms: forms.length, activeForms: forms.filter((f) => f.status === 'PUBLISHED').length,
    assigned: rows.length, pending: rows.filter((r) => !SENT.includes(r.status)).length, completed: rows.filter((r) => SENT.includes(r.status)).length,
    approved: count('APPROVED'), rejected: count('REJECTED'), underReview: count('UNDER_REVIEW') + count('SUBMITTED'), overdue: rows.filter((r) => r.overdue).length,
    byDepartment: group((r) => r.user.department), byBranch: group((r) => r.user.branchId),
  }
}

/** Status steps: who may move a submission from → to. */
export const EMPLOYEE_STEPS = { IN_PROGRESS: ['IN_PROGRESS', 'SUBMITTED'], CHANGES_REQUESTED: ['CHANGES_REQUESTED', 'SUBMITTED'] }
export const HR_STEPS = { SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'], UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'], APPROVED: ['UNDER_REVIEW'], REJECTED: ['UNDER_REVIEW'], CHANGES_REQUESTED: ['UNDER_REVIEW'] }
export const canStep = (from, to, hr) => (hr ? HR_STEPS[from] ?? [] : EMPLOYEE_STEPS[from] ?? []).includes(to)

/** Forms whose deadline is within `days` days (today counts) and the person hasn't sent yet — for reminders. */
export function dueSoon({ forms, subs, user, today, days = 2 }) {
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + days)
  const last = end.toISOString().slice(0, 10)
  return forms.filter((f) => f.status === 'PUBLISHED' && f.deadline && f.deadline >= today && f.deadline <= last && isAssigned(f, user)
    && !SENT.includes(statusOf(subs.find((s) => s.formId === f.id && s.userId === user.id))))
}
