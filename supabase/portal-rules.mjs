// Client portal rules shared by the CRM (browser) and the live server: what a client's document status is, when they
// may upload, and how project progress is worked out. Plain JavaScript, no imports.
//
// A document the Operation team asks for is stored as ASSIGNED / UNDER_REVIEW / APPROVED / REJECTED (with the time
// it got that status). What the client and the team see follows from that and the client's uploads:
//   ASSIGNED + no upload since      → PENDING_UPLOAD
//   ASSIGNED / REJECTED + upload since → SUBMITTED (waiting for the team to review)
//   REJECTED + no upload since      → RESUBMISSION (client must upload again)
//   UNDER_REVIEW, APPROVED          → as stored
// A document is never approved just because a file was uploaded: the team reviews it first.

export const CLIENT_DOC_STATUS = {
  PENDING_UPLOAD: { label: 'Pending upload', tone: 'amber' },
  SUBMITTED: { label: 'Submitted', tone: 'blue' },
  UNDER_REVIEW: { label: 'Under review', tone: 'violet' },
  APPROVED: { label: 'Approved', tone: 'green' },
  RESUBMISSION: { label: 'Resubmission needed', tone: 'red' },
}

/** The newest upload of a category (uploads: [{ category, at, … }]). */
export const latestUpload = (uploads, cat) => (uploads ?? []).filter((u) => u.category === cat).reduce((m, u) => (!m || u.at > m.at ? u : m), null)

/** What the document's status is now (null when it isn't asked for). */
export function docStatus(item, uploads, cat) {
  if (!item || item.removed) return null
  const last = latestUpload(uploads, cat)
  const since = !!last && last.at > item.statusAt
  if (item.status === 'ASSIGNED') return since ? 'SUBMITTED' : 'PENDING_UPLOAD'
  if (item.status === 'REJECTED') return since ? 'SUBMITTED' : 'RESUBMISSION'
  return item.status // UNDER_REVIEW | APPROVED
}
/** The client may upload while it is waiting for a file, needs one again, or isn't reviewed yet (a newer file). */
export const clientMayUpload = (status) => status === 'PENDING_UPLOAD' || status === 'RESUBMISSION' || status === 'SUBMITTED'

/** Allowed review steps for the team: start review once submitted; approve / reject while under review. */
export function reviewSteps(status) {
  if (status === 'SUBMITTED') return ['START']
  if (status === 'UNDER_REVIEW') return ['APPROVE', 'REJECT']
  return []
}

/**
 * Project progress: done milestones ÷ milestones (a milestone with tasks counts its done tasks instead), as a whole
 * percentage; null when there are none. `onlyVisible` = what the client is shown.
 */
export function projectProgress(milestones, onlyVisible = false) {
  const list = (milestones ?? []).filter((m) => !onlyVisible || m.visible)
  if (!list.length) return null
  const parts = list.map((m) => (m.status === 'DONE' ? 1 : m.tasks?.length ? m.tasks.filter((t) => t.done).length / m.tasks.length : 0))
  return Math.round((parts.reduce((a, b) => a + b, 0) / list.length) * 100)
}

// ------------------------------------------------------------------ client logins (IT Support)
/** Client portal logins — create, password, link, deactivate — are IT Support's alone (the server checks the same). */
export const PORTAL_LOGIN_ROLES = ['it']
export const mayManagePortalLogins = (roles) => (roles ?? []).some((r) => PORTAL_LOGIN_ROLES.includes(r))
/** A password IT Support gives a client: 8–72 characters, letters and numbers, no spaces, not the login ID itself. */
export function portalPasswordProblem(pw, email = '') {
  const s = String(pw ?? '')
  if (s.length < 8) return 'The password needs at least 8 characters.'
  if (s.length > 72) return 'The password can be up to 72 characters.'
  if (/\s/.test(s)) return 'No spaces in the password.'
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Use both letters and numbers in the password.'
  if (email && s.toLowerCase() === String(email).trim().toLowerCase()) return 'The password can’t be the login ID.'
  return null
}
