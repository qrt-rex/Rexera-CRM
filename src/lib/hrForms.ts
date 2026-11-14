import type { DB, FileRef, HrAnswer, HrForm, HrFormAssign, HrFormField, HrFormSubmission, HrSubStatus, User } from './types'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { fmtDate, fmtDateTime, nowIso, today, uid } from './format'
import { effectivePerms, isMaster, rolesOf } from './rbac'
import { branchName } from './branches'
import { deleteFile, saveHrFormFile } from './files'
import {
  answerProblems, answerText, assignees, canFill, canStep, dueSoon, FILE_TYPES, fileProblem, formProblems, isAssigned, SENT, STATUS_LABEL,
  tidyField, type ResponseRow,
} from '../../supabase/hr-form-rules.mjs'

/**
 * HR Form Builder (HR Dashboard → HR Form Builder / Form Responses) and My Forms (every employee).
 *  - HR (hrforms.manage — HR by default; Super Admin and IT always; IT can give it to anyone in Access Control) makes
 *    forms, publishes them to employees, departments, branches or role groups, and reviews what comes back.
 *  - Each employee fills their own (one submission per form), uploads files (private: only they and HR can open them),
 *    saves a draft when the form allows it, submits, and sees the status. The database checks every step
 *    (supabase/migrations/20261116000000_hr_forms.sql); the rules are in supabase/hr-form-rules.mjs.
 *  - A published form edited later starts a new version; every submission keeps the fields it was filled with.
 *  - Notifications: new form assigned, deadline coming up, submitted (to HR), approved / rejected / correction asked.
 *  - Every step goes to the activity log.
 */
export const canManageHrForms = (d: DB, me: User) => isMaster(me) || effectivePerms(d, me).has('hrforms.manage')
const live = (u?: User) => !!u && u.active && !u.deletedAt
const need = (me: User) => { if (!canManageHrForms(getDb(), me)) throw new ActionError('The HR Form Builder is for HR (and Super Admin / IT).') }
const assert: (c: unknown, m: string) => asserts c = (c, m) => { if (!c) throw new ActionError(m) }
const log = (d: DB, by: string, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }
function notify(d: DB, userIds: (string | undefined)[], title: string, body: string, link: string, kind: 'info' | 'success' | 'warning' | 'action' = 'info', id?: (u: string) => string) {
  for (const u of new Set(userIds.filter(Boolean) as string[])) {
    const nid = id ? id(u) : uid('n-')
    if (d.notices.some((n) => n.id === nid)) continue
    d.notices.unshift({ id: nid, userId: u, title, body, link, at: nowIso(), read: false, kind })
  }
  if (d.notices.length > 600) d.notices.length = 600
}
/** The HR people who review a form's submissions: the ones chosen on the form, else everyone with the HR role. */
export function reviewersOf(d: DB, form: HrForm): string[] {
  const chosen = form.reviewerIds.filter((id) => live(d.users.find((u) => u.id === id)))
  if (chosen.length) return chosen
  const hr = d.users.filter((u) => live(u) && rolesOf(u).includes('hr') && canManageHrForms(d, u))
  return (hr.length ? hr : d.users.filter((u) => live(u) && canManageHrForms(d, u) && !rolesOf(u).includes('it'))).map((u) => u.id)
}
/** People HR can choose as reviewers. */
export const hrManagers = (d: DB) => d.users.filter((u) => live(u) && canManageHrForms(d, u)).sort((a, b) => a.name.localeCompare(b.name))

// ------------------------------------------------------------------ forms (HR)
export const newHrField = (type: HrFormField['type'] = 'text'): HrFormField => ({
  id: uid('hf-'), type, label: '', required: false,
  ...(['select', 'multiselect', 'checkbox', 'radio'].includes(type) ? { options: ['Option 1', 'Option 2'] } : {}),
  ...(FILE_TYPES.includes(type) ? { maxSizeMb: 10, ...(type === 'files' ? { maxFiles: 5 } : {}) } : {}),
})
export interface HrFormInput { title: string; description?: string; fields: HrFormField[]; assign: HrFormAssign; deadline?: string; allowDraft: boolean; reviewerIds: string[] }
export const emptyHrForm = (): HrFormInput => ({ title: '', description: '', fields: [], assign: {}, deadline: '', allowDraft: true, reviewerIds: [] })
const tidyAssign = (a: HrFormAssign): HrFormAssign => ({
  ...(a.everyone ? { everyone: true } : {}),
  ...(a.userIds?.length ? { userIds: [...new Set(a.userIds)] } : {}), ...(a.departments?.length ? { departments: [...new Set(a.departments)] } : {}),
  ...(a.branchIds?.length ? { branchIds: [...new Set(a.branchIds)] } : {}), ...(a.roles?.length ? { roles: [...new Set(a.roles)] } : {}),
})

/** Saves a form (new = Draft). A published form whose fields change gets a new version; new assignees are told. */
export function saveHrForm(me: User, i: HrFormInput, id?: string) {
  need(me)
  const fields = i.fields.map(tidyField)
  const draft = { title: i.title.trim(), description: i.description?.trim() || undefined, fields, assign: tidyAssign(i.assign), deadline: i.deadline || undefined, allowDraft: i.allowDraft, reviewerIds: [...new Set(i.reviewerIds)] }
  assert(draft.title, 'Give the form a name.')
  return mutate((d) => {
    d.hrForms ??= []
    const at = nowIso()
    if (!id) {
      const f: HrForm = { id: uid('hrf-'), ...draft, status: 'DRAFT', version: 1, versions: [], createdBy: me.id, createdAt: at, updatedAt: at, updatedBy: me.id }
      d.hrForms.unshift(f)
      log(d, me.id, 'HRFORM_CREATE', `${f.title} (draft, ${fields.length} field(s))`)
      return f.id
    }
    const f = d.hrForms.find((x) => x.id === id)
    assert(f, 'Form not found.')
    assert(f.status !== 'ARCHIVED', 'This form is archived — restore it or duplicate it to change it.')
    if (f.status !== 'DRAFT') {
      const p = formProblems({ ...f, ...draft }, { today: today() })
      assert(!p.length, p[0] ?? '')
    }
    const before = d.users.filter((u) => isAssigned(f, u)).map((u) => u.id)
    if (f.status !== 'DRAFT' && JSON.stringify(f.fields) !== JSON.stringify(fields)) {
      f.versions = [...f.versions, { version: f.version, at, by: me.id, fields: f.fields }]
      f.version++
    }
    Object.assign(f, draft, { updatedAt: at, updatedBy: me.id })
    if (!f.description) delete f.description
    if (!f.deadline) delete f.deadline
    if (f.status === 'PUBLISHED') {
      const added = d.users.filter((u) => isAssigned(f, u) && !before.includes(u.id)).map((u) => u.id)
      notify(d, added, `New form to fill: ${f.title}`, f.deadline ? `Please fill it by ${fmtDate(f.deadline)}.` : 'Please fill it in My Forms.', `/my-forms?open=${f.id}`, 'action')
    }
    log(d, me.id, 'HRFORM_EDIT', `${f.title} (v${f.version})`)
    return f.id
  })
}

const STEPS: Record<HrForm['status'], HrForm['status'][]> = { DRAFT: ['PUBLISHED', 'ARCHIVED'], PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'], UNPUBLISHED: ['PUBLISHED', 'ARCHIVED'], ARCHIVED: ['UNPUBLISHED'] }
/** Draft → Published (employees see and fill it) ⇄ Unpublished (hidden, answers kept) → Archived (kept, restorable). */
export function setHrFormStatus(me: User, id: string, status: HrForm['status']) {
  need(me)
  mutate((d) => {
    const f = d.hrForms?.find((x) => x.id === id)
    assert(f, 'Form not found.')
    assert(STEPS[f.status].includes(status), `A ${f.status.toLowerCase()} form can't be ${status.toLowerCase()}.`)
    if (status === 'PUBLISHED') { const p = formProblems(f, { today: today() }); assert(!p.length, p[0] ?? '') }
    const at = nowIso()
    const first = status === 'PUBLISHED' && !f.publishedAt
    f.status = status; f.updatedAt = at; f.updatedBy = me.id
    if (status === 'PUBLISHED') {
      f.publishedAt ??= at
      // everyone it is assigned to who hasn't sent it yet
      const subs = d.hrFormSubmissions ?? []
      const who = assignees(f, d.users).filter((u) => !SENT.includes(subs.find((s) => s.formId === f.id && s.userId === u.id)?.status as HrSubStatus)).map((u) => u.id)
      notify(d, who, `${first ? 'New form to fill' : 'Form open again'}: ${f.title}`, f.deadline ? `Please fill it by ${fmtDate(f.deadline)}.` : 'Please fill it in My Forms.', `/my-forms?open=${f.id}`, 'action')
    }
    log(d, me.id, `HRFORM_${status}`, `${f.title} (v${f.version})`)
  })
}
/** A copy as a new draft ("Copy of …"), same fields and settings, no answers. */
export function duplicateHrForm(me: User, id: string) {
  need(me)
  return mutate((d) => {
    const f = d.hrForms?.find((x) => x.id === id)
    assert(f, 'Form not found.')
    const at = nowIso()
    const copy: HrForm = {
      id: uid('hrf-'), title: `Copy of ${f.title}`, description: f.description, status: 'DRAFT', fields: f.fields.map((x) => ({ ...x, id: uid('hf-') })),
      version: 1, versions: [], assign: { ...f.assign }, deadline: undefined, allowDraft: f.allowDraft, reviewerIds: [...f.reviewerIds], createdBy: me.id, createdAt: at, updatedAt: at, updatedBy: me.id,
    }
    if (!copy.description) delete copy.description
    delete copy.deadline
    d.hrForms!.unshift(copy)
    log(d, me.id, 'HRFORM_DUPLICATE', `${f.title} → ${copy.title}`)
    return copy.id
  })
}

// ------------------------------------------------------------------ My Forms (employees)
/** The forms someone sees in My Forms: assigned and published, plus any they have already started or sent. */
export function myForms(d: DB, me: User) {
  const subs = (d.hrFormSubmissions ?? []).filter((s) => s.userId === me.id)
  return (d.hrForms ?? []).filter((f) => f.status !== 'DRAFT' && ((f.status === 'PUBLISHED' && isAssigned(f, me)) || subs.some((s) => s.formId === f.id)))
    .map((form) => ({ form, sub: subs.find((s) => s.formId === form.id) }))
}
/** Uploads one file into a field (checked against the field's types and size first). */
export async function uploadHrFile(me: User, field: HrFormField, file: File): Promise<FileRef> {
  const p = fileProblem(field, file)
  if (p) throw new ActionError(p)
  return saveHrFormFile(file, me.id)
}
/** Removes a file the person added but hasn't saved yet (a saved one is removed when the form is saved without it). */
export async function discardHrFile(me: User, ref: FileRef, formId: string) {
  const sub = getDb().hrFormSubmissions?.find((s) => s.formId === formId && s.userId === me.id)
  const saved = sub ? Object.values(sub.answers).some((v) => Array.isArray(v) && (v as FileRef[]).some((x) => typeof x === 'object' && x?.id === ref.id)) : false
  if (!saved && ref.id.startsWith(`hrf-${me.id}~`)) await deleteFile(ref.id).catch(() => undefined)
}
const filesIn = (answers: Record<string, HrAnswer>) => Object.values(answers).flatMap((v) => (Array.isArray(v) ? v.filter((x): x is FileRef => typeof x === 'object' && !!x && 'id' in x) : []))

/**
 * Saves the person's answers: a draft (submit false) or sent to HR (submit true — every answer is checked first).
 * Files dropped since the last save are removed from storage.
 */
export async function saveHrSubmission(me: User, formId: string, answers: Record<string, HrAnswer>, submit: boolean) {
  const d0 = getDb()
  const form = d0.hrForms?.find((f) => f.id === formId)
  assert(form, 'Form not found.')
  const before = d0.hrFormSubmissions?.find((s) => s.formId === formId && s.userId === me.id)
  assert(canFill(form, before, today()), before && SENT.includes(before.status) ? 'This form was already sent to HR.' : form.deadline && form.deadline < today() ? 'The deadline for this form has passed.' : 'This form is not open.')
  assert(isAssigned(form, me) || before, 'This form is not assigned to you.')
  // a correction keeps the version it was filled with; otherwise the form as it is now
  const fields = before?.status === 'CHANGES_REQUESTED' ? before.fields : form.fields
  const clean: Record<string, HrAnswer> = {}
  for (const f of fields) if (answers[f.id] !== undefined) clean[f.id] = answers[f.id]!
  if (submit) {
    const p = answerProblems(fields, clean, { users: d0.users })
    const first = Object.values(p)[0]
    assert(!first, first ?? '')
  } else assert(form.allowDraft || before?.status === 'CHANGES_REQUESTED', 'This form has to be filled and submitted in one go (drafts are off).')
  const dropped = before ? filesIn(before.answers).filter((x) => !filesIn(clean).some((y) => y.id === x.id)) : []
  const id = mutate((d) => {
    d.hrFormSubmissions ??= []
    const at = nowIso()
    let s = d.hrFormSubmissions.find((x) => x.formId === formId && x.userId === me.id)
    const status: HrSubStatus = submit ? 'SUBMITTED' : s?.status === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : 'IN_PROGRESS'
    if (!s) {
      s = { id: uid('hfs-'), formId, formVersion: form.version, userId: me.id, status, fields, answers: clean, startedAt: at, updatedAt: at, history: [] }
      d.hrFormSubmissions.unshift(s)
    } else {
      assert(canStep(s.status, status, false), 'This form was already sent to HR.')
      Object.assign(s, { status, fields, answers: clean, updatedAt: at, ...(s.status === 'CHANGES_REQUESTED' ? {} : { formVersion: form.version }) })
    }
    s.history = [...s.history, { at, by: me.id, action: submit ? (before?.status === 'CHANGES_REQUESTED' ? 'Corrected and submitted' : 'Submitted') : 'Draft saved' }]
    if (submit) {
      s.submittedAt = at
      notify(d, reviewersOf(d, form), `Form submitted: ${form.title}`, `${me.name} ${before?.status === 'CHANGES_REQUESTED' ? 'sent the corrections' : 'submitted the form'}.`, `/hr-forms?tab=responses&open=${s.id}`, 'action')
    }
    log(d, me.id, submit ? 'HRFORM_SUBMIT' : 'HRFORM_DRAFT', `${form.title} (v${s.formVersion})`)
    return s.id
  })
  for (const f of dropped) await deleteFile(f.id).catch(() => undefined)
  return id
}

// ------------------------------------------------------------------ review (HR)
const REVIEW_TEXT: Partial<Record<HrSubStatus, [string, string, 'success' | 'warning' | 'action' | 'info']>> = {
  APPROVED: ['approved', 'Your form was approved', 'success'], REJECTED: ['rejected', 'Your form was rejected', 'warning'],
  CHANGES_REQUESTED: ['sent back for corrections', 'Please correct your form', 'action'], UNDER_REVIEW: ['under review', 'Your form is being reviewed', 'info'],
}
/** Under review / approve / reject / ask for corrections (a reason is needed to reject or ask for corrections). */
export function reviewHrSubmission(me: User, id: string, to: HrSubStatus, note = '') {
  need(me)
  mutate((d) => {
    const s = d.hrFormSubmissions?.find((x) => x.id === id)
    assert(s, 'Submission not found.')
    assert(canStep(s.status, to, true), `A ${STATUS_LABEL[s.status].toLowerCase()} form can't be moved to ${STATUS_LABEL[to].toLowerCase()}.`)
    const why = note.trim()
    assert(!['REJECTED', 'CHANGES_REQUESTED'].includes(to) || why.length >= 3, to === 'REJECTED' ? 'Say why it is rejected.' : 'Say what the employee has to correct.')
    const form = d.hrForms?.find((f) => f.id === s.formId)
    const at = nowIso()
    Object.assign(s, { status: to, reviewedBy: me.id, reviewedAt: at, updatedAt: at, ...(why ? { reviewNote: why } : to === 'APPROVED' ? { reviewNote: undefined } : {}) })
    if (!s.reviewNote) delete s.reviewNote
    s.history = [...s.history, { at, by: me.id, action: STATUS_LABEL[to], ...(why ? { note: why } : {}) }]
    const t = REVIEW_TEXT[to]
    if (t) notify(d, [s.userId], `${t[1]}: ${form?.title ?? 'form'}`, why || `HR marked it ${t[0]}.`, `/my-forms?open=${s.formId}`, t[2])
    log(d, me.id, `HRFORM_${to}`, `${form?.title ?? s.formId} — ${d.users.find((u) => u.id === s.userId)?.name ?? s.userId}${why ? `: ${why}` : ''}`)
  })
}
/** HR's internal comment (never shown to the employee). */
export function addHrNote(me: User, submissionId: string, text: string) {
  need(me)
  const t = text.trim()
  assert(t, 'Write the comment first.')
  mutate((d) => {
    d.hrFormNotes ??= []
    assert(d.hrFormSubmissions?.some((s) => s.id === submissionId), 'Submission not found.')
    d.hrFormNotes.push({ id: uid('hfn-'), submissionId, by: me.id, at: nowIso(), text: t })
    log(d, me.id, 'HRFORM_NOTE', `Internal comment on ${submissionId}`)
  })
}
/** Reminds one person about a form they haven't sent (HR's "Remind"). */
export function remindHrForm(me: User, formId: string, userIds: string[]) {
  need(me)
  mutate((d) => {
    const f = d.hrForms?.find((x) => x.id === formId)
    assert(f && f.status === 'PUBLISHED', 'Only a published form can be reminded about.')
    notify(d, userIds, `Reminder: ${f.title}`, f.deadline ? `Please fill it by ${fmtDate(f.deadline)}.` : 'Please fill it in My Forms.', `/my-forms?open=${f.id}`, 'action')
    log(d, me.id, 'HRFORM_REMIND', `${f.title}: ${userIds.length} person(s)`)
  })
}

/** In each person's own browser, once a day: forms due within 2 days that they haven't sent yet. */
export function runHrFormReminders(me: User) {
  const d0 = getDb()
  const t = today()
  const due = dueSoon({ forms: d0.hrForms ?? [], subs: d0.hrFormSubmissions ?? [], user: me, today: t })
  const fresh = due.filter((f) => !d0.notices.some((n) => n.id === `n-hrf-${f.id}-${me.id}-${t}`))
  if (!fresh.length) return
  mutate((d) => {
    for (const f of fresh) notify(d, [me.id], `Due ${f.deadline === t ? 'today' : `on ${fmtDate(f.deadline)}`}: ${f.title}`, 'Please fill and submit it in My Forms before the deadline.', `/my-forms?open=${f.id}`, 'warning', (u) => `n-hrf-${f.id}-${u}-${t}`)
  })
}

// ------------------------------------------------------------------ exports
const branchOf = (d: DB, u: User) => (u.branchId ? branchName(d, u.branchId) : '')
const baseRow = (d: DB, r: ResponseRow) => ({
  Form: r.form.title, Employee: r.user.name, 'Employee ID': r.user.username, Department: r.user.department ?? '', Branch: branchOf(d, r.user),
  Status: STATUS_LABEL[r.status] + (r.overdue ? ' (overdue)' : ''), Submitted: r.sub?.submittedAt ? fmtDateTime(r.sub.submittedAt) : '',
  'Reviewed by': r.sub?.reviewedBy ? d.users.find((u) => u.id === r.sub!.reviewedBy)?.name ?? '' : '', 'HR note': r.sub?.reviewNote ?? '', Attachments: r.files,
})
/** Excel: a summary sheet, and one sheet per form with every answer (field labels as columns). */
export async function exportResponsesXlsx(rows: ResponseRow[], name = `form-responses-${today()}.xlsx`) {
  const d = getDb()
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => baseRow(d, r))), 'Responses')
  const used = new Set<string>()
  for (const form of [...new Map(rows.map((r) => [r.form.id, r.form])).values()]) {
    const mine = rows.filter((r) => r.form.id === form.id)
    // every field any submission has (older versions too), in the form's order
    const cols: HrFormField[] = []
    for (const f of [...form.fields, ...mine.flatMap((r) => r.sub?.fields ?? [])]) if (!cols.some((c) => c.id === f.id)) cols.push(f)
    const data = mine.map((r) => ({ ...baseRow(d, r), ...Object.fromEntries(cols.map((c) => [c.label || c.id, r.sub ? answerText(c, r.sub.answers[c.id], { users: d.users }) : ''])) }))
    let sheet = form.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Form'
    for (let i = 2; used.has(sheet); i++) sheet = `${sheet.slice(0, 25)} ${i}`
    used.add(sheet)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheet)
  }
  XLSX.writeFile(wb, name)
}
/** PDF: the response list (A4 landscape), or one full submission when given one row. */
export async function exportResponsesPdf(rows: ResponseRow[], title = 'Form responses') {
  const d = getDb()
  const { jsPDF } = await import('jspdf')
  const one = rows.length === 1 && rows[0]!.sub
  const pdf = new jsPDF({ orientation: one ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight()
  let y = 16
  const line = (text: string, x: number, size = 9, bold = false, width = W - 2 * x) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size)
    const parts = pdf.splitTextToSize(text || '—', width) as string[]
    for (const p of parts) { if (y > H - 14) { pdf.addPage(); y = 16 } pdf.text(p, x, y); y += size * 0.45 }
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(one ? rows[0]!.form.title : title, 14, y); y += 6
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110); pdf.text(`Rexera CRM · exported ${fmtDateTime(nowIso())}`, 14, y); pdf.setTextColor(0); y += 8
  if (one) {
    const r = rows[0]!, s = r.sub!
    for (const [k, v] of Object.entries(baseRow(d, r)).filter(([k]) => k !== 'Form')) { line(`${k}: ${v}`, 14, 9.5) ; y += 0.6 }
    y += 3; pdf.setDrawColor(200); pdf.line(14, y, W - 14, y); y += 6
    for (const f of s.fields) {
      line(f.label, 14, 10, true); y += 0.5
      line(answerText(f, s.answers[f.id], { users: d.users }), 14, 9.5); y += 3
    }
  } else {
    const cols: [string, number][] = [['Form', 46], ['Employee', 40], ['Employee ID', 30], ['Department', 30], ['Branch', 36], ['Status', 30], ['Submitted', 34], ['Files', 12]]
    const head = () => { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); let x = 14; for (const [c, w] of cols) { pdf.text(c, x, y); x += w } y += 2; pdf.setDrawColor(180); pdf.line(14, y, W - 14, y); y += 4 }
    head()
    pdf.setFont('helvetica', 'normal')
    for (const r of rows) {
      if (y > H - 12) { pdf.addPage(); y = 16; head(); pdf.setFont('helvetica', 'normal') }
      const b = baseRow(d, r)
      const vals = [b.Form, b.Employee, b['Employee ID'], b.Department, b.Branch, b.Status, b.Submitted, String(b.Attachments)]
      let x = 14
      pdf.setFontSize(8)
      vals.forEach((v, i) => { const w = cols[i]![1]; pdf.text((pdf.splitTextToSize(String(v || '—'), w - 2) as string[])[0] ?? '', x, y); x += w })
      y += 5.5
    }
  }
  pdf.save(one ? `${rows[0]!.form.title.replace(/[^\w-]+/g, '-')}-${rows[0]!.user.username}.pdf` : `form-responses-${today()}.pdf`)
}
