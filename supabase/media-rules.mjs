// Digital Media rules shared by the CRM (browser) and the live server: media types, accepted files, the upload and
// work statuses (Late is worked out from the deadline, so it is always up to date), form checks, and who a published
// item is shown to. Plain JavaScript, no imports.

export const MEDIA_TYPES = [
  { id: 'POST', label: 'Post' }, { id: 'FLYER', label: 'Flyer' }, { id: 'POSTER', label: 'Poster' }, { id: 'VIDEO', label: 'Video' },
  { id: 'IMAGE', label: 'Image' }, { id: 'PDF', label: 'PDF' }, { id: 'OTHER', label: 'Other' },
]
export const mediaTypeLabel = (id) => MEDIA_TYPES.find((t) => t.id === id)?.label ?? id

/** Files a media item may carry (type → extension), up to 50 MB each. */
export const MEDIA_FILE_TYPES = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
}
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024
export const MEDIA_ACCEPT = [...Object.keys(MEDIA_FILE_TYPES), ...new Set(Object.values(MEDIA_FILE_TYPES)), '.jpeg'].join(',')
const EXT_TYPE = { '.jpeg': 'image/jpeg', ...Object.fromEntries(Object.entries(MEDIA_FILE_TYPES).map(([t, e]) => [e, t])) }

/** The file's type (from its declared type, else its extension) or null when it isn't accepted. */
export function mediaFileType(name, declaredType) {
  if (MEDIA_FILE_TYPES[declaredType]) return declaredType
  const ext = '.' + String(name ?? '').split('.').pop().toLowerCase()
  return EXT_TYPE[ext] ?? null
}
/** What is wrong with a file for a media item, or null. */
export function mediaFileProblem(name, declaredType, size) {
  if (!mediaFileType(name, declaredType)) return `${name}: this file type isn't supported (images, videos, PDF, Word or PowerPoint).`
  if (!(size > 0)) return `${name} is empty.`
  if (size > MEDIA_MAX_BYTES) return `${name} is larger than 50 MB.`
  return null
}

export const UPLOAD_STATUS = { UPLOADED: { label: 'Uploaded', tone: 'green' }, NOT_UPLOADED: { label: 'Not uploaded', tone: 'gray' } }
export const WORK_STATUS = {
  PENDING: { label: 'Pending', tone: 'amber' }, LATE: { label: 'Late', tone: 'red' }, ON_HOLD: { label: 'On hold', tone: 'violet' }, COMPLETED: { label: 'Completed', tone: 'green' },
}
/** Uploaded once it has a file; separate from the work status (a file doesn't mean the work is done). */
export const uploadStatus = (m) => ((m.files ?? []).length ? 'UPLOADED' : 'NOT_UPLOADED')
/** The assignment's deadline: its date and time in India (end of the day when no time is set), or null. */
export function mediaDeadline(m) {
  if (!m.assignDate || !/^\d{4}-\d{2}-\d{2}$/.test(m.assignDate)) return null
  const t = /^\d{2}:\d{2}$/.test(m.assignTime ?? '') ? m.assignTime : '23:59'
  return new Date(`${m.assignDate}T${t}:00+05:30`)
}
/** Stored work status, with Pending shown as Late once the deadline has passed (never when on hold or completed). */
export function workStatus(m, now = new Date()) {
  if (m.workStatus !== 'PENDING') return m.workStatus
  const due = mediaDeadline(m)
  return due && now.getTime() > due.getTime() ? 'LATE' : 'PENDING'
}

/**
 * Problems with a media record before it is saved (draft) or submitted (published): field name → message.
 * Submitting also needs where it is published (internal and / or external).
 */
export function mediaProblems(m, { submit = false } = {}) {
  const e = {}
  const s = (v) => String(v ?? '').trim()
  if (s(m.schemeName).length < 2) e.schemeName = 'Enter or pick the scheme name.'
  else if (s(m.schemeName).length > 150) e.schemeName = 'Scheme name is too long.'
  if (s(m.title).length < 2) e.title = 'Give the media a title.'
  else if (s(m.title).length > 150) e.title = 'Title is too long (150 characters).'
  if (s(m.description).length > 4000) e.description = 'Description is too long (4000 characters).'
  if (!MEDIA_TYPES.some((t) => t.id === m.mediaType)) e.mediaType = 'Pick the media type.'
  if (m.assignDate && !/^\d{4}-\d{2}-\d{2}$/.test(m.assignDate)) e.assignDate = 'Pick a valid date.'
  if (m.assignTime && !/^\d{2}:\d{2}$/.test(m.assignTime)) e.assignTime = 'Pick a valid time.'
  if (m.assignTime && !m.assignDate) e.assignDate = 'Pick the date for this time.'
  if (!['PENDING', 'ON_HOLD', 'COMPLETED'].includes(m.workStatus)) e.workStatus = 'Pick the work status.'
  if (s(m.notes).length > 2000) e.notes = 'Notes are too long (2000 characters).'
  if (submit && !m.internal && !m.external) e.publication = 'Choose where it is published: Internal (company), External (clients) or both.'
  return e
}

/** A published item shows on dashboards once it has a file. */
export const isLive = (m) => !!m.submitted && (m.files ?? []).length > 0
/** Shown to a client with these CRM entries: published, external, and meant for all clients or one of theirs. */
export const forClient = (m, bookingIds) => isLive(m) && !!m.external && (!(m.clientBookingIds ?? []).length || m.clientBookingIds.some((id) => bookingIds.includes(id)))
