import type { BDoc, Booking, DB, FileRef, LegacyFile } from './types'
import { normPhone } from './format'
import { FILE_DOC, squash } from './legacyImport'
import { guessCategory } from './workflow'

/**
 * Files from the old CRM's uploads folder (the export's 04_FILES_AND_ATTACHMENTS/all_uploads_raw, or the server's
 * public_html/uploads) → the right place in the imported client files:
 *  - payment screenshot of the advance (crm.payment_screenshot) → proof of payment part 1
 *  - client documents (client_documents.file_path) → that document, in its Document Forms slot
 *  - signed agreements (approved_pdfs/<Company>_<Service>.pdf, “…_combo.pdf” for combo bookings) → an Agreement document
 *  - other uploads in a client's phone folder → a document on that client's latest file
 *  - everything else is kept in an archive (IT → Import from old CRM) so nothing is lost.
 * Pure: plans from file names and sizes only; the page copies the bytes.
 */

export interface DiskFile { path: string; size: number; lastModified?: number }
export type LinkKind = 'proof' | 'shot' | 'doc' | 'agreement' | 'upload'
export interface FileLink { kind: LinkKind; bookingId: string; targetId: string; exact: boolean }
export interface PlannedFile { id: string; path: string; name: string; size: number; type: string; at: string; links: FileLink[]; archive?: string }
export interface FilePlan {
  files: PlannedFile[]
  stats: {
    onDisk: number; bytes: number; duplicates: number
    proofs: number; proofsExpected: number; shotDocs: number
    docs: number; docsExpected: number; uploads: number
    agreements: number; agreementsExact: number; agreementsByCompany: number; agreementLinks: number
    archived: number; archivedBytes: number
  }
  missing: { bookingId: string; what: string; ref: string }[]
  notes: string[]
}

const JUNK = /(^|\/)(\.htaccess|index\.html?|thumbs\.db|\.ds_store|desktop\.ini)$|\.php\d?$/i
const MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain',
}
export const mimeOf = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'
const base = (p: string) => p.split('/').pop() ?? p

/** Same file path → same id, so copying again skips what is already stored. */
export function legacyFileId(path: string) {
  const s = path.toLowerCase()
  let a = 0x811c9dc5, b = 0x9747b28c ^ s.length
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822507) }
  return `lg-f-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

/**
 * Paths as the browser gives them for a chosen folder ("scarp_data/04_FILES_AND_ATTACHMENTS/all_uploads_raw/ss_1.jpg")
 * → path inside the uploads folder ("ss_1.jpg"), or null for files that aren't uploads (dumps, JSON, CSV, junk).
 */
export function uploadsPaths(rel: string[]): (string | null)[] {
  const norm = rel.map((p) => p.replace(/\\/g, '/'))
  const after = (p: string, marker: string) => { const i = p.toLowerCase().lastIndexOf(marker); return i < 0 ? null : p.slice(i + marker.length) }
  const pick = norm.some((p) => /(^|\/)all_uploads_raw\//i.test(p)) ? (p: string) => after('/' + p, '/all_uploads_raw/')
    : norm.some((p) => /(^|\/)uploads\//i.test(p)) ? (p: string) => after('/' + p, '/uploads/')
      : (p: string) => (p.includes('/') ? p.slice(p.indexOf('/') + 1) : p)   // the chosen folder is the uploads folder
  return norm.map((p) => { const r = pick(p); return r && !JUNK.test(r) ? r : null })
}

/** Upload time from the old CRM's file names: uniqid (ss_68cd2f80…, payment_69ec8728…) or doc_<phone>_20260702_101214_…. */
export function uploadedAt(name: string, fallback: string) {
  const u = name.match(/^(?:ss|payment)_([0-9a-f]{8})[0-9a-f]{5}/i)
  if (u) { const t = parseInt(u[1]!, 16) * 1000; if (t > Date.UTC(2020, 0) && t < Date.UTC(2035, 0)) return new Date(t).toISOString() }
  const d = name.match(/_(20\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/)
  if (d) { const t = new Date(`${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}+05:30`); if (!Number.isNaN(t.getTime())) return t.toISOString() }
  return fallback
}

export function planFiles(db: DB, disk: DiskFile[], now = new Date().toISOString()): FilePlan {
  const files = new Map<string, PlannedFile>()
  const byPath = new Map<string, PlannedFile>()
  const byName = new Map<string, PlannedFile[]>()
  for (const f of disk) {
    const path = f.path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!path || JUNK.test(path) || byPath.has(path.toLowerCase())) continue
    const name = base(path)
    const pf: PlannedFile = { id: legacyFileId(path), path, name, size: f.size, type: mimeOf(name), at: uploadedAt(name, f.lastModified ? new Date(f.lastModified).toISOString() : now), links: [] }
    files.set(pf.id, pf); byPath.set(path.toLowerCase(), pf)
    const k = name.toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), pf])
  }
  // a name in the uploads root wins over a copy in a sub-folder (screenshots/ holds duplicates of some screenshots)
  for (const list of byName.values()) list.sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  const find = (ref: string) => {
    const p = ref.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^(public_html\/)?uploads\//i, '')
    return byPath.get(p.toLowerCase()) ?? byName.get(base(p).toLowerCase())?.[0]
  }
  const link = (f: PlannedFile, l: FileLink) => { if (!f.links.some((x) => x.bookingId === l.bookingId && x.targetId === l.targetId)) f.links.push(l) }

  const legacy = db.bookings.filter((b) => b.legacy?.crm && b.legacyId != null)
  const missing: FilePlan['missing'] = []
  let proofsExpected = 0, docsExpected = 0
  for (const b of legacy) {
    const shot = (b.legacy!.crm.payment_screenshot ?? '').trim()
    if (shot) {
      proofsExpected++
      const f = find(shot)
      // the screenshot belongs to the advance; with no advance recorded, to the first payment there is
      const pay = b.payments.find((p) => p.id === `lg-p-${b.legacyId}-1`) ?? b.payments.find((p) => p.mode !== 'Adjustment')
      if (!f) missing.push({ bookingId: b.id, what: 'Payment screenshot', ref: shot })
      else if (pay) link(f, { kind: 'proof', bookingId: b.id, targetId: pay.id, exact: true })
      else link(f, { kind: 'shot', bookingId: b.id, targetId: `lg-d-shot-${b.legacyId}`, exact: true })
    }
    for (const d of b.documents) {
      if (!d.legacyPath || FILE_DOC.test(d.id)) continue
      docsExpected++
      const f = find(d.legacyPath)
      if (f) link(f, { kind: 'doc', bookingId: b.id, targetId: d.id, exact: true })
      else missing.push({ bookingId: b.id, what: d.name, ref: d.legacyPath })
    }
  }

  // signed agreements: <Company>_<Service>.pdf with everything but letters and digits removed
  const byCompany = new Map<string, Booking[]>()
  for (const b of legacy) { const k = squash(b.companyName); if (k) byCompany.set(k, [...(byCompany.get(k) ?? []), b]) }
  let agreements = 0, agreementsExact = 0, agreementsByCompany = 0
  for (const f of files.values()) {
    if (!/(^|\/)approved_pdfs\//i.test(f.path) || f.links.length) continue
    const stem = f.name.replace(/\.pdf$/i, '')
    const cut = stem.lastIndexOf('_')
    const comp = squash(cut > 0 ? stem.slice(0, cut) : stem), svc = squash(cut > 0 ? stem.slice(cut + 1) : '')
    const all = byCompany.get(comp) ?? []
    if (!all.length) continue
    let hit = all.filter((b) => squash(b.serviceName) === svc)
    const exact = hit.length > 0
    if (!exact && svc === 'combo') hit = all.filter((b) => /^\s*combo/i.test(b.serviceName))
    if (!hit.length && svc) hit = all.filter((b) => { const s = squash(b.serviceName); return s.startsWith(svc) || svc.startsWith(s) || s.includes(svc) })
    if (!hit.length) hit = all
    agreements++
    if (exact) agreementsExact++; else agreementsByCompany++
    for (const b of hit) link(f, { kind: 'agreement', bookingId: b.id, targetId: `lg-d-ag-${b.legacyId}-${f.id.slice(5)}`, exact })
  }

  // other uploads in a client's phone-number folder (e.g. added after the dump was taken) → that client's latest file
  const byPhone = new Map<string, Booking>()
  for (const b of legacy) { const p = normPhone(b.mobile); const cur = byPhone.get(p); if (p && (!cur || cur.createdAt < b.createdAt)) byPhone.set(p, b) }
  let uploads = 0
  for (const f of files.values()) {
    const m = f.path.match(/^client_documents\/(\d{10})\//i)
    if (!m || f.links.length) continue
    const b = byPhone.get(m[1]!)
    if (!b) continue
    uploads++
    link(f, { kind: 'upload', bookingId: b.id, targetId: `lg-d-up-${b.legacyId}-${f.id.slice(5)}`, exact: false })
  }

  // exact copies (same name and size) of a file that is already linked — e.g. screenshots/ repeats some uploads — are skipped
  let duplicates = 0
  for (const list of byName.values()) {
    const kept = list.filter((f) => f.links.length)
    for (const f of list) if (!f.links.length && kept.some((k) => k.size === f.size)) { files.delete(f.id); duplicates++ }
  }

  // the rest: kept in the archive, with a hint of what it is
  let archived = 0, archivedBytes = 0
  for (const f of files.values()) {
    if (f.links.length) continue
    f.archive = /(^|\/)approved_pdfs\//i.test(f.path) ? 'Agreement PDF — client not found'
      : /^client_documents\//i.test(f.path) ? `Client document — no client file with phone ${f.path.split('/')[1] ?? ''}`
        : /^(ss|payment)_/i.test(f.name) ? 'Payment screenshot — no client file refers to it'
          : /(^|\/)screenshots\//i.test(f.path) ? 'Screenshot' : 'Other upload'
    archived++; archivedBytes += f.size
  }

  const list = [...files.values()]
  /** links, not files: split combo bookings (CRM…_1, CRM…_2) share one screenshot */
  const count = (k: LinkKind) => list.reduce((s, f) => s + f.links.filter((l) => l.kind === k).length, 0)
  const notes: string[] = []
  if (duplicates) notes.push(`${duplicates} file(s) are exact copies of another upload (same name and size) and are skipped.`)
  if (agreementsByCompany) notes.push(`${agreementsByCompany} agreement PDF(s) name the client but not the exact service (e.g. “…_combo.pdf”); they are attached to that client's combo file, or to all of the client's files when it isn't clear which one.`)
  if (uploads) notes.push(`${uploads} upload(s) in a client's phone-number folder had no document row (often added after the dump was taken); they are added to that client's latest file.`)
  if (archived) notes.push(`${archived} file(s) aren't referred to by any client file (replaced or deleted entries in the old CRM); they are kept under “Unlinked old CRM files” below.`)
  return {
    files: list, missing, notes,
    stats: {
      onDisk: list.length, bytes: list.reduce((s, f) => s + f.size, 0), duplicates,
      proofs: count('proof'), proofsExpected, shotDocs: count('shot'), docs: count('doc'), docsExpected, uploads,
      agreements, agreementsExact, agreementsByCompany, agreementLinks: list.reduce((s, f) => s + f.links.filter((l) => l.kind === 'agreement').length, 0),
      archived, archivedBytes,
    },
  }
}

export const refOf = (f: PlannedFile): FileRef => ({ id: f.id, name: f.name, type: f.type, size: f.size, at: f.at })

/** Links the stored files into the client files (inside `mutate`). Files someone attached by hand are never replaced. */
export function applyFiles(d: DB, plan: FilePlan, stored: Set<string>) {
  const bookings = new Map(d.bookings.map((b) => [b.id, b]))
  const archive = new Map((d.legacyFiles ?? []).map((x) => [x.path.toLowerCase(), x]))
  let linked = 0, kept = 0
  for (const f of plan.files) {
    if (!stored.has(f.id)) continue
    const ref = refOf(f)
    if (!f.links.length) { archive.set(f.path.toLowerCase(), { path: f.path, file: ref, kind: f.archive ?? 'Other upload' } satisfies LegacyFile); kept++; continue }
    archive.delete(f.path.toLowerCase())
    for (const l of f.links) {
      const b = bookings.get(l.bookingId)
      if (!b) continue
      if (l.kind === 'proof') {
        const p = b.payments.find((x) => x.id === l.targetId)
        if (p && (!p.proof || p.proof.id.startsWith('lg-f-'))) { p.proof = ref; p.proofName = f.name; linked++ }
      } else if (l.kind === 'doc') {
        const doc = b.documents.find((x) => x.id === l.targetId)
        if (doc && (!doc.file || doc.file.id.startsWith('lg-f-'))) { doc.file = ref; doc.size = f.size; linked++ }
      } else {
        const doc: BDoc = {
          id: l.targetId, file: ref, size: f.size, at: f.at, by: '', legacyPath: `uploads/${f.path}`,
          ...(l.kind === 'agreement' ? { name: f.name, category: 'Agreement', status: 'VERIFIED' as const, note: l.exact ? 'Signed agreement from the old CRM' : 'Signed agreement from the old CRM — matched by company name' }
            : l.kind === 'shot' ? { name: 'Payment screenshot (old CRM)', category: 'Payment receipt', note: 'The old CRM had this screenshot but no payment amount on the file' }
              : { name: f.name, category: guessCategory(f.name, 'Other'), note: 'Found in the client\'s folder in the old CRM uploads' }),
        }
        const i = b.documents.findIndex((x) => x.id === doc.id)
        if (i >= 0) b.documents[i] = { ...b.documents[i]!, ...doc }; else b.documents.push(doc)
        linked++
      }
    }
  }
  d.legacyFiles = [...archive.values()].sort((a, b) => b.file.at.localeCompare(a.file.at))
  return { linked, archived: kept }
}
