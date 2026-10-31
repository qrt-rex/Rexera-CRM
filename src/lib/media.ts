import type { DB, FileRef, MediaItem, MediaType, MediaWork, User } from './types'
import { effectivePerms } from './rbac'
import { getDb, mutate } from './store'
import { ActionError, userName } from './actions'
import { deleteFile } from './files'
import { nowIso, uid } from './format'
import { isLive, mediaFileProblem, mediaProblems, mediaTypeLabel } from '../../supabase/media-rules.mjs'
import { archiveDeleted } from './recycle'

/**
 * Digital Media Dashboard → Media Function. One record per piece of media, shown wherever it is published: company
 * dashboards (Internal) and / or client portals (External) — never copied. Media managers (media.manage) create,
 * assign, edit, publish and delete; the person a record is assigned to uploads its files and updates its work.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const has = (me: User, p: 'media.manage' | 'media.view') => effectivePerms(getDb(), me).has(p)
export const canManageMedia = (me: User) => has(me, 'media.manage')
/** Media is assigned only to people who can open the Digital Media section (the Digital Media team, Super Admin / IT). */
export const mayTakeMedia = (d: DB, u: User) => effectivePerms(d, u).has('media.manage')
/** The record's own work: managers, or the person it is assigned to. */
export const canWorkMedia = (me: User, m: MediaItem) => canManageMedia(me) || m.assignedTo === me.id

/** Records someone sees in the Media Function table: managers all; others theirs plus published company media. */
export function visibleMedia(d: DB, me: User): MediaItem[] {
  const all = d.mediaItems ?? []
  if (canManageMedia(me)) return all
  const company = has(me, 'media.view')
  return all.filter((m) => m.assignedTo === me.id || m.createdBy === me.id || (company && m.internal && isLive(m)))
}
/** Company dashboards: published internal media with a file, newest first. */
export const companyMedia = (d: DB, me: User) => (has(me, 'media.view') || canManageMedia(me) ? (d.mediaItems ?? []).filter((m) => m.internal && isLive(m)) : [])
  .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))

export interface MediaForm {
  schemeName: string; title: string; description: string; mediaType: MediaType
  internal: boolean; external: boolean; clientBookingIds: string[]
  assignDate: string; assignTime: string; assignedTo: string; workStatus: MediaWork; notes: string
}
const tidy = (f: MediaForm) => ({
  schemeName: f.schemeName.trim(), title: f.title.trim(), description: f.description.trim(), mediaType: f.mediaType,
  internal: f.internal, external: f.external, clientBookingIds: f.external ? [...new Set(f.clientBookingIds)] : [],
  assignDate: f.assignDate || undefined, assignTime: f.assignTime || undefined, assignedTo: f.assignedTo || undefined,
  workStatus: f.workStatus, notes: f.notes.trim() || undefined,
})
const problem = (f: ReturnType<typeof tidy>, submit: boolean) => Object.values(mediaProblems(f, { submit }))[0]
function notifyAssignee(d: DB, me: User, m: MediaItem) {
  if (!m.assignedTo || m.assignedTo === me.id) return
  d.notices.unshift({ id: uid('n-'), userId: m.assignedTo, title: `Media assigned to you: #${m.serial}`, body: `${m.title} · ${m.schemeName}${m.assignDate ? ` · by ${m.assignDate}${m.assignTime ? ` ${m.assignTime}` : ''}` : ''}`, link: `/digital-media?open=${m.id}`, at: nowIso(), read: false, kind: 'action' })
}
const log = (d: DB, by: string, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }

/**
 * Create Media: Save keeps it as a draft, Submit publishes it (it appears on dashboards once it has a file). `files`
 * were uploaded first (saveMediaFile). Answers the new record's id; its serial number is the next one.
 */
export function createMedia(me: User, form: MediaForm, files: FileRef[], submit: boolean) {
  assert(canManageMedia(me), 'Only media managers can create media.')
  const f = tidy(form)
  const bad = problem(f, submit)
  assert(!bad, bad ?? '')
  for (const x of files) { const p = mediaFileProblem(x.name, x.type, x.size); assert(!p, p ?? '') }
  return mutate((d) => {
    assert(!f.assignedTo || d.users.some((u) => u.id === f.assignedTo && u.active && mayTakeMedia(d, u)), 'Pick an active member of the Digital Media team.')
    d.mediaItems ??= []
    // one more than the counter or the highest serial in use, so a serial is never given twice
    const serial = Math.max(d.counters.media ?? 0, ...d.mediaItems.map((m) => m.serial)) + 1
    d.counters.media = serial
    const at = nowIso()
    const m: MediaItem = {
      id: uid('med-'), serial, ...f, files, submitted: submit, ...(submit ? { submittedAt: at, submittedBy: me.id } : {}),
      ...(f.workStatus === 'COMPLETED' ? { completedAt: at } : {}),
      createdAt: at, createdBy: me.id, updatedAt: at, updatedBy: me.id,
      history: [
        { at, by: me.id, action: submit ? 'Created and submitted (published)' : 'Created (draft)' },
        ...(files.length ? [{ at, by: me.id, action: `Uploaded ${files.map((x) => x.name).join(', ')}` }] : []),
        ...(f.assignedTo ? [{ at, by: me.id, action: `Assigned to ${userName(d, f.assignedTo)}` }] : []),
      ],
    }
    d.mediaItems.unshift(m)
    notifyAssignee(d, me, m)
    log(d, me.id, submit ? 'MEDIA_PUBLISH' : 'MEDIA_CREATE', `#${serial} ${m.title} (${mediaTypeLabel(m.mediaType)})${submit ? ` → ${[m.internal && 'internal', m.external && 'external'].filter(Boolean).join(' + ')}` : ''}`)
    return m.id
  })
}

/** Edit (managers: every field; Submit publishes a draft). Changes are written to the record's history. */
export function updateMedia(me: User, id: string, form: MediaForm, submit: boolean) {
  assert(canManageMedia(me), 'Only media managers can edit this record.')
  const f = tidy(form)
  mutate((d) => {
    const m = d.mediaItems?.find((x) => x.id === id)
    assert(m, 'Media record not found.')
    const publish = submit || m.submitted
    const bad = problem(f, publish)
    assert(!bad, bad ?? '')
    assert(!f.assignedTo || f.assignedTo === m.assignedTo || d.users.some((u) => u.id === f.assignedTo && u.active && mayTakeMedia(d, u)), 'Pick an active member of the Digital Media team.')
    const at = nowIso()
    const changed = (Object.keys(f) as (keyof typeof f)[]).filter((k) => JSON.stringify(m[k] ?? null) !== JSON.stringify(f[k] ?? null))
    const reassigned = changed.includes('assignedTo')
    Object.assign(m, f)
    if (submit && !m.submitted) { m.submitted = true; m.submittedAt = at; m.submittedBy = me.id }
    if (changed.includes('workStatus')) m.completedAt = m.workStatus === 'COMPLETED' ? at : undefined
    if (!changed.length && !(submit && m.submittedAt === at)) return
    m.updatedAt = at; m.updatedBy = me.id
    m.history.push({ at, by: me.id, action: submit && m.submittedAt === at ? 'Submitted (published)' : 'Edited', ...(changed.length ? { note: `Changed: ${changed.join(', ')}` } : {}) })
    if (reassigned) { m.history.push({ at, by: me.id, action: m.assignedTo ? `Assigned to ${userName(d, m.assignedTo)}` : 'Unassigned' }); notifyAssignee(d, me, m) }
    log(d, me.id, submit && m.submittedAt === at ? 'MEDIA_PUBLISH' : 'MEDIA_EDIT', `#${m.serial} ${m.title}`)
  })
}

/** Stop showing it on dashboards / portals (managers); it goes back to a draft. */
export function unpublishMedia(me: User, id: string) {
  assert(canManageMedia(me), 'Only media managers can unpublish.')
  mutate((d) => {
    const m = d.mediaItems?.find((x) => x.id === id)
    assert(m && m.submitted, 'This record isn’t published.')
    const at = nowIso()
    Object.assign(m, { submitted: false, submittedAt: undefined, submittedBy: undefined, updatedAt: at, updatedBy: me.id })
    m.history.push({ at, by: me.id, action: 'Unpublished (back to draft)' })
    log(d, me.id, 'MEDIA_UNPUBLISH', `#${m.serial} ${m.title}`)
  })
}

/** Files uploaded for a record (managers or its assignee). Uploading doesn't complete the work. */
export function addMediaFiles(me: User, id: string, files: FileRef[]) {
  assert(files.length, 'Choose a file.')
  for (const x of files) { const p = mediaFileProblem(x.name, x.type, x.size); assert(!p, p ?? '') }
  mutate((d) => {
    const m = d.mediaItems?.find((x) => x.id === id)
    assert(m, 'Media record not found.')
    assert(canWorkMedia(me, m), 'Only media managers and the person this is assigned to can upload here.')
    const at = nowIso()
    m.files = [...m.files, ...files]
    m.updatedAt = at; m.updatedBy = me.id
    m.history.push({ at, by: me.id, action: `Uploaded ${files.map((x) => x.name).join(', ')}` })
    if (m.createdBy !== me.id) d.notices.unshift({ id: uid('n-'), userId: m.createdBy, title: `Media uploaded: #${m.serial}`, body: `${m.title} · ${files.length} file(s) by ${me.name}`, link: `/digital-media?open=${m.id}`, at, read: false, kind: 'info' })
  })
}
/** Removes one file from a record (and from storage). */
export async function removeMediaFile(me: User, id: string, fileId: string) {
  const m0 = getDb().mediaItems?.find((x) => x.id === id)
  assert(m0, 'Media record not found.')
  assert(canWorkMedia(me, m0), 'Only media managers and the person this is assigned to can remove files.')
  const file = m0.files.find((x) => x.id === fileId)
  assert(file, 'File not found.')
  mutate((d) => {
    const m = d.mediaItems!.find((x) => x.id === id)!
    const at = nowIso()
    archiveDeleted(d, me.id, { module: 'Digital Media', kind: 'File', label: `${file.name} · #${m.serial} ${m.title}`, data: { media: `#${m.serial} ${m.title}`, ...file } })
    m.files = m.files.filter((x) => x.id !== fileId)
    m.updatedAt = at; m.updatedBy = me.id
    m.history.push({ at, by: me.id, action: `Removed ${file.name}` })
  })
  // the stored file stays until IT Support deletes the backup (Deleted files)
}

/** Work status: the assignee marks Pending / Completed; On hold (pause) and back is for media managers. */
export function setMediaWork(me: User, id: string, status: MediaWork, note = '') {
  mutate((d) => {
    const m = d.mediaItems?.find((x) => x.id === id)
    assert(m, 'Media record not found.')
    assert(canWorkMedia(me, m), 'Only media managers and the person this is assigned to can change its status.')
    assert(['PENDING', 'ON_HOLD', 'COMPLETED'].includes(status), 'Unknown status.')
    assert(canManageMedia(me) || (status !== 'ON_HOLD' && m.workStatus !== 'ON_HOLD'), 'Only a media manager can put work on hold or take it off hold.')
    if (m.workStatus === status) return
    const at = nowIso()
    m.workStatus = status
    m.completedAt = status === 'COMPLETED' ? at : undefined
    m.updatedAt = at; m.updatedBy = me.id
    m.history.push({ at, by: me.id, action: { PENDING: 'Marked pending', ON_HOLD: 'Put on hold', COMPLETED: 'Marked completed' }[status], ...(note.trim() ? { note: note.trim() } : {}) })
    if (status === 'COMPLETED' && m.createdBy !== me.id) d.notices.unshift({ id: uid('n-'), userId: m.createdBy, title: `Media completed: #${m.serial}`, body: `${m.title} · by ${me.name}`, link: `/digital-media?open=${m.id}`, at, read: false, kind: 'success' })
  })
}

/** Deletes a record and its files (managers). */
export async function deleteMedia(me: User, id: string) {
  assert(canManageMedia(me), 'Only media managers can delete media.')
  const m = getDb().mediaItems?.find((x) => x.id === id)
  assert(m, 'Media record not found.')
  mutate((d) => {
    archiveDeleted(d, me.id, { module: 'Digital Media', kind: 'Media', label: `#${m.serial} ${m.title}`, data: m })
    d.mediaItems = (d.mediaItems ?? []).filter((x) => x.id !== id)
    log(d, me.id, 'MEDIA_DELETE', `#${m.serial} ${m.title}`)
  })
  // the stored files stay until IT Support deletes the backup (Deleted files)
}
