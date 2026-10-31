import type { CandidateApplication, CandidateLetter, DB, User } from './types'
import { flushSaves, getDb, mutate } from './store'
import { ActionError } from './actions'
import { effectivePerms } from './rbac'
import { CLOUD } from './cloud'
import { getSupabase } from './supabase'
import { normPhone, nowIso, today, uid } from './format'
import type { LetterData } from './letters'

/**
 * HR Dashboard → Candidates: pick candidates for an offer / joining letter, then send the letter PDF by email or
 * WhatsApp. The live server sends and records every letter (server/hrLetters.mjs), and only to a selected candidate.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const isEmail = (s?: string) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

export type LetterChoice = 'OFFER' | 'JOINING'
export const LETTER_CHOICES: { id: LetterChoice; kind: 'offer' | 'joining'; label: string }[] = [
  { id: 'OFFER', kind: 'offer', label: 'Offer letter' },
  { id: 'JOINING', kind: 'joining', label: 'Joining letter' },
]
export const mayHire = (d: DB, me: User) => effectivePerms(d, me).has('recruitment.manage')

/** Tick (or untick) a candidate for letters. Unticking takes them off the selected list; letters already sent stay logged. */
export function selectCandidate(me: User, id: string, on: boolean) {
  assert(mayHire(getDb(), me), 'Only HR selects candidates.')
  mutate((d) => {
    const c = d.candidates.find((x) => x.id === id)
    assert(c, 'Application not found.')
    if (!!c.selected === on) return
    c.selected = on
    c.selectedAt = nowIso()
    c.selectedBy = me.id
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: on ? 'CANDIDATE_SELECTED' : 'CANDIDATE_UNSELECTED', detail: `${c.name}${c.position ? ` · ${c.position}` : ''}` })
  })
}

/** The letter's details, filled from the application (HR checks and completes them before sending). */
export function letterDataFor(d: DB, me: User, c: CandidateApplication): LetterData {
  const start = new Date(`${today()}T00:00:00`)
  start.setDate(start.getDate() + 7)
  const salary = Number(String(c.expectedSalary ?? '').replace(/[^\d.]/g, ''))
  return {
    company: d.settings.companyName, companyLine: [d.settings.supplierState, d.settings.companyGstin ? `GSTIN ${d.settings.companyGstin}` : ''].filter(Boolean).join(' · '),
    refNo: '', date: today(), name: c.name, address: c.city ?? '', designation: c.position ?? '', department: '', location: c.branch ?? '',
    startDate: start.toISOString().slice(0, 10), endDate: '', amount: salary > 1000 && salary < 10_000_000 ? Math.round(salary > 200_000 ? salary / 12 : salary) : 0,
    probationMonths: 3, reportingTo: '', signatory: me.name, signatoryTitle: 'Human Resources',
  }
}

export const lettersFor = (d: DB, candidateId: string) => (d.candidateLetters ?? []).filter((l) => l.candidateId === candidateId)
export const newLetterRequestId = () => `cl-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
export const contactOfCandidate = (c: CandidateApplication) => ({ email: isEmail(c.email) ? c.email.trim() : undefined, phone: normPhone(c.phone) || undefined })

const toBase64 = (b: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(new Error('Could not read the letter PDF.')); r.readAsDataURL(b) })

export interface LetterSend { kind: LetterChoice; channel: CandidateLetter['channel']; subject?: string; body: string; pdf?: Blob; fileName: string; manual?: boolean; requestId: string }
export interface LetterResult { ok: boolean; status: CandidateLetter['status'] | 'ERROR'; message: string }

/** Sends one letter on one channel. Browser mode (no live server): only recorded here, nothing is sent. */
export async function sendCandidateLetter(me: User, c: CandidateApplication, x: LetterSend): Promise<LetterResult> {
  if (!mayHire(getDb(), me)) return { ok: false, status: 'ERROR', message: 'Only HR sends letters.' }
  if (!getDb().candidates.find((y) => y.id === c.id)?.selected) return { ok: false, status: 'ERROR', message: 'Select the candidate first.' }
  const to = x.channel === 'EMAIL' ? contactOfCandidate(c).email : contactOfCandidate(c).phone
  if (!to) return { ok: false, status: 'ERROR', message: x.channel === 'EMAIL' ? 'The candidate has no valid email address.' : 'The candidate has no valid 10-digit mobile number.' }
  if (x.body.trim().length < 3) return { ok: false, status: 'ERROR', message: 'Write a short message to go with the letter.' }
  if (x.channel === 'EMAIL' && (x.subject ?? '').trim().length < 3) return { ok: false, status: 'ERROR', message: 'Write the email subject.' }

  if (!CLOUD) {
    const status: CandidateLetter['status'] = x.manual ? 'MANUAL' : 'NOT_CONFIGURED'
    mutate((d) => {
      const l: CandidateLetter = { id: x.requestId, candidateId: c.id, kind: x.kind, channel: x.channel, to, ...(x.channel === 'EMAIL' ? { subject: x.subject?.trim() } : {}), body: x.body.trim(), status, ...(x.manual ? {} : { error: 'Sending needs the live CRM server.' }), by: me.id, at: nowIso() }
      if (!(d.candidateLetters ?? []).some((y) => y.id === l.id)) d.candidateLetters = [l, ...(d.candidateLetters ?? [])]
    })
    return x.manual ? { ok: true, status, message: 'Recorded.' } : { ok: false, status, message: 'Sending works on the live CRM. Here, use “Send from my WhatsApp” / “Send from my mail app”.' }
  }
  try {
    // a selection made a moment ago must reach the server first (it checks the candidate is selected)
    await flushSaves()
    const pdf = x.manual || !x.pdf ? undefined : await toBase64(x.pdf)
    const { data: { session } } = await (await getSupabase()).auth.getSession()
    const res = await fetch('/api/hr/letter', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ candidateId: c.id, kind: x.kind, channel: x.channel, subject: x.channel === 'EMAIL' ? x.subject : undefined, body: x.body, pdf, fileName: x.fileName, manual: !!x.manual, requestId: x.requestId }),
    })
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return { ok: false, status: 'ERROR', message: 'This copy of the CRM has no server for sending.' }
    const j = await res.json().catch(() => ({})) as { success?: boolean; status?: CandidateLetter['status']; message?: string }
    return { ok: !!j.success, status: j.status ?? 'ERROR', message: j.message ?? `The server answered ${res.status}.` }
  } catch {
    // the server may still have sent it: the same request id is answered once if it is tried again
    return { ok: false, status: 'ERROR', message: 'The CRM server could not be reached — check the letters list before trying again.' }
  }
}
