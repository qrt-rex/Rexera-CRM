// Client form rules shared by the public form page (/f/<token>), the staff Form Builder and the live server, so a
// form is checked the same way everywhere. Plain JavaScript, no imports.

export const FIELD_TYPES = [
  { id: 'text', label: 'Short text' }, { id: 'textarea', label: 'Long text' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' },
  { id: 'date', label: 'Date' }, { id: 'number', label: 'Number' }, { id: 'select', label: 'Dropdown' }, { id: 'checkbox', label: 'Checkbox' },
  { id: 'file', label: 'File upload' },
]
/** What clients may upload: PDF, images, Word. 5 MB each, 15 MB in one submission. */
export const UPLOAD_TYPES = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_SUBMISSION_BYTES = 15 * 1024 * 1024
export const MAX_FIELDS = 40

/** The first bytes of each allowed type — a renamed .exe isn't accepted as a PDF. */
export function sniffType(bytes) {
  const b = bytes
  const starts = (...sig) => sig.every((x, i) => b[i] === x)
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'application/msword'
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return null
}
/** A Word .docx is a zip; an .xlsx would match too, so the declared type must also be one we accept. */
export function fileProblem(name, declaredType, size, bytes) {
  if (!UPLOAD_TYPES[declaredType]) return `${name}: this file type isn't allowed (PDF, image or Word only).`
  if (size > MAX_UPLOAD_BYTES) return `${name} is larger than 5 MB.`
  if (sniffType(bytes) !== declaredType) return `${name} doesn't look like a ${UPLOAD_TYPES[declaredType]} file.`
  return null
}

/** Problems with a form definition (staff side), or [] when it can be published. */
export function formProblems(f) {
  const out = []
  if (!f.name?.trim()) out.push('Give the form a name.')
  if (f.kind === 'UPLOAD' && !f.document) out.push('Upload the document the client should download.')
  if (f.kind === 'ONLINE' && !f.fields?.length) out.push('Add at least one field.')
  if ((f.fields?.length ?? 0) > MAX_FIELDS) out.push(`Up to ${MAX_FIELDS} fields.`)
  const ids = new Set()
  for (const [i, x] of (f.fields ?? []).entries()) {
    if (!x.label?.trim()) out.push(`Field ${i + 1} needs a label.`)
    if (!FIELD_TYPES.some((t) => t.id === x.type)) out.push(`Field ${i + 1} has an unknown type.`)
    if (x.type === 'select' && !(x.options ?? []).filter((o) => o.trim()).length) out.push(`“${x.label || `Field ${i + 1}`}” needs at least one choice.`)
    if (ids.has(x.id)) out.push('Two fields have the same id.')
    ids.add(x.id)
  }
  if (f.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.expiresOn)) out.push('The expiry date is not valid.')
  return out
}

const PHONE = /^[6-9]\d{9}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 10-digit Indian mobile from what the client typed (+91 / 0 / spaces allowed), or ''. */
export const normMobile = (v) => { let d = String(v ?? '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return PHONE.test(d) ? d : '' }

/**
 * Checks a client's answers against the form's fields. `files` = [{ fieldId, name, type, size }]. Returns
 * { errors: { fieldId: message }, clean: { fieldId: value } } — clean values are trimmed / normalised.
 */
export function checkAnswers(fields, answers, files = []) {
  const errors = {}, clean = {}
  for (const f of fields) {
    const raw = answers?.[f.id]
    if (f.type === 'file') {
      const mine = files.filter((x) => x.fieldId === f.id)
      if (f.required && !mine.length) errors[f.id] = 'Attach a file.'
      continue
    }
    if (f.type === 'checkbox') {
      const v = raw === true || raw === 'true' || raw === 'on'
      if (f.required && !v) errors[f.id] = 'Please tick this.'
      clean[f.id] = v
      continue
    }
    const s = String(raw ?? '').trim().slice(0, f.type === 'textarea' ? 4000 : 500)
    if (!s) { if (f.required) errors[f.id] = 'Required.'; continue }
    if (f.type === 'email' && !EMAIL.test(s)) errors[f.id] = 'Enter a valid email.'
    else if (f.type === 'phone' && !normMobile(s)) errors[f.id] = 'Enter a valid 10-digit mobile number.'
    else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.id] = 'Enter a valid date.'
    else if (f.type === 'number' && !Number.isFinite(Number(s))) errors[f.id] = 'Enter a number.'
    else if (f.type === 'select' && !(f.options ?? []).includes(s)) errors[f.id] = 'Pick one of the choices.'
    clean[f.id] = f.type === 'number' ? Number(s) : f.type === 'phone' ? normMobile(s) : s
  }
  const total = files.reduce((t, x) => t + (x.size ?? 0), 0)
  if (total > MAX_SUBMISSION_BYTES) errors._files = 'Files add up to more than 15 MB — send fewer or smaller files.'
  for (const x of files) if (!fields.some((f) => f.id === x.fieldId && f.type === 'file')) errors._files = 'A file was attached to a field that doesn’t take files.'
  return { errors, clean }
}

/** Open to clients: published, not past its expiry day (India time). */
export const formOpen = (f, today) => f.status === 'PUBLISHED' && (!f.expiresOn || today <= f.expiresOn)
