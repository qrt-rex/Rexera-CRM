import type { DocForm, FileRef, FormField, FormSubmission, User } from './types'
import { effectivePerms } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { nowIso, uid } from './format'
import { formProblems } from '../../supabase/form-rules.mjs'

/**
 * Document Form Builder (Admin and the Operation team): forms with fields, or a document to download and return,
 * shared with clients through a secret link (/f/<token>). Publishing locks a version; later edits make a new version
 * and earlier answers keep the fields they were given.
 */
const need = (me: User) => { if (!effectivePerms(getDb(), me).has('forms.manage')) throw new ActionError("You don't have access to client forms.") }
const assert: (c: unknown, m: string) => asserts c = (c, m) => { if (!c) throw new ActionError(m) }
const log = (d: ReturnType<typeof getDb>, by: string, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }

/** 32 random characters — the link can't be guessed. */
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const formLink = (f: Pick<DocForm, 'token'>) => `${window.location.origin}/f/${f.token}`
export const newField = (type: FormField['type'] = 'text'): FormField => ({ id: uid('fld-'), label: '', type, required: false, ...(type === 'select' ? { options: [''] } : {}) })

export type FormInput = Pick<DocForm, 'name' | 'description' | 'instructions' | 'kind' | 'fields' | 'verify'> & { bookingId?: string; expiresOn?: string; document?: FileRef }
const tidy = (fields: FormField[]) => fields.map((f) => ({ ...f, label: f.label.trim(), help: f.help?.trim() || undefined, ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : { options: undefined }) }))
const sameFields = (a: FormField[], b: FormField[]) => JSON.stringify(a) === JSON.stringify(b)

export function saveForm(me: User, i: FormInput, id?: string) {
  need(me)
  const fields = tidy(i.kind === 'UPLOAD' && !i.fields.some((f) => f.type === 'file') ? [...i.fields, { id: uid('fld-'), label: 'Completed document', type: 'file', required: true }] : i.fields)
  const problems = formProblems({ ...i, fields })
  assert(!problems.length || !id || getDb().docForms?.find((f) => f.id === id)?.status === 'DRAFT', problems[0] ?? '')
  assert(i.name.trim(), 'Give the form a name.')
  assert(i.verify !== 'MOBILE' || i.bookingId, 'Mobile verification needs the form linked to a client file (its mobile number is checked).')
  return mutate((d) => {
    d.docForms ??= []
    const at = nowIso()
    const base = { name: i.name.trim(), description: i.description.trim(), instructions: i.instructions.trim(), kind: i.kind, verify: i.verify, bookingId: i.bookingId || undefined, expiresOn: i.expiresOn || undefined, document: i.document }
    if (id) {
      const f = d.docForms.find((x) => x.id === id)
      assert(f, 'Form not found.')
      assert(f.status !== 'ARCHIVED', 'This form is archived — copy it to make a new one.')
      // a published form keeps its answers' fields: changing the fields starts a new version
      if (f.status !== 'DRAFT' && !sameFields(f.fields, fields)) {
        assert(!problems.length, problems[0] ?? '')
        f.versions = [...f.versions, { version: f.version, at, by: me.id, fields: f.fields }]
        f.version++
      }
      Object.assign(f, base, { fields, updatedAt: at, updatedBy: me.id })
      if (!f.document) delete f.document
      log(d, me.id, 'FORM_EDIT', `${f.name} (v${f.version})`)
      return f.id
    }
    const f: DocForm = { ...base, id: uid('frm-'), token: newToken(), fields, version: 1, versions: [], status: 'DRAFT', createdBy: me.id, createdAt: at, updatedAt: at, updatedBy: me.id, views: 0 }
    if (!f.document) delete f.document
    d.docForms.unshift(f)
    log(d, me.id, 'FORM_CREATE', f.name)
    return f.id
  })
}

/** Draft → Published (link works) → Closed (link stops) → Archived (kept, hidden). Closed forms can be re-opened. */
export function setFormStatus(me: User, id: string, status: DocForm['status']) {
  need(me)
  mutate((d) => {
    const f = d.docForms?.find((x) => x.id === id)
    assert(f, 'Form not found.')
    const ok: Record<DocForm['status'], DocForm['status'][]> = { DRAFT: ['PUBLISHED', 'ARCHIVED'], PUBLISHED: ['CLOSED', 'ARCHIVED'], CLOSED: ['PUBLISHED', 'ARCHIVED'], ARCHIVED: [] }
    assert(ok[f.status].includes(status), `A ${f.status.toLowerCase()} form can't be ${status.toLowerCase()}.`)
    if (status === 'PUBLISHED') { const p = formProblems(f); assert(!p.length, p[0] ?? '') }
    f.status = status
    f.updatedAt = nowIso(); f.updatedBy = me.id
    log(d, me.id, `FORM_${status}`, `${f.name} (v${f.version})`)
  })
}
/** A new link: the old one stops working at once (e.g. it was sent to the wrong person). */
export function renewFormLink(me: User, id: string) {
  need(me)
  mutate((d) => {
    const f = d.docForms?.find((x) => x.id === id)
    assert(f, 'Form not found.')
    f.token = newToken()
    f.updatedAt = nowIso(); f.updatedBy = me.id
    log(d, me.id, 'FORM_LINK_RENEWED', f.name)
  })
}
export function reviewSubmission(me: User, id: string, status: FormSubmission['status'], note = '') {
  need(me)
  mutate((d) => {
    const s = d.formSubmissions?.find((x) => x.id === id)
    assert(s, 'Response not found.')
    assert(status !== 'REJECTED' || note.trim().length >= 3, 'Say why the response is rejected.')
    Object.assign(s, { status, reviewedBy: me.id, reviewedAt: nowIso(), note: note.trim() || s.note })
    log(d, me.id, 'FORM_RESPONSE_' + status, `${d.docForms?.find((f) => f.id === s.formId)?.name ?? s.formId}: ${s.id}`)
  })
}
/** Copies a response's files onto the client file's Documents (kept as uploaded by the client). */
export function attachSubmissionFiles(me: User, id: string) {
  need(me)
  return mutate((d) => {
    const s = d.formSubmissions?.find((x) => x.id === id)
    assert(s, 'Response not found.')
    const b = d.bookings.find((x) => x.id === s.bookingId)
    assert(b, 'Link the form to a client file first.')
    const form = d.docForms?.find((f) => f.id === s.formId)
    let n = 0
    for (const x of s.files) {
      if (b.documents.some((doc) => doc.file?.id === x.file.id)) continue
      const label = s.fields.find((f) => f.id === x.fieldId)?.label ?? 'Client upload'
      b.documents.push({ id: uid('doc-'), name: x.file.name, category: 'Client form upload', size: x.file.size, at: nowIso(), by: me.id, status: 'PENDING', file: x.file, note: `${form?.name ?? 'Form'} · ${label}` })
      n++
    }
    b.updatedAt = nowIso()
    log(d, me.id, 'FORM_FILES_TO_FILE', `${b.bookingId}: ${n} file(s) from ${form?.name ?? 'form'}`)
    return n
  })
}
