import type { BComment, BDoc, Booking, BookingStatus, DB, Invoice, Lead, LeadStatus, LegacyRow, Notice, Payment, Role, Service, StageMove, User, Approval } from './types'
import { invoiceTotals, normPhone, round2 } from './format'
import { PRESET_USERS } from './seed'
import { guessCategory, STAGES, stageLabel } from './workflow'

/**
 * Import from the old PHP CRM (phpMyAdmin / MariaDB .sql dump).
 *  - Lossless: every original column of every client file is kept on the record (booking.legacy) and shown on
 *    the file page, so nothing is lost even where the new CRM has no matching field.
 *  - Smart mapping: free-text statuses → status + stage, approval columns → approval timeline, payment parts →
 *    instalments, workflow timestamps → stage history, remarks → comments, documents → file list.
 *  - Times: TIMESTAMP columns are UTC in the dump; DATETIME columns are the old server's local time (IST).
 *  - Never imported: passwords (stored as plain text in the old system), login tokens, magic links, OTP codes.
 *  - Re-runnable: ids are derived from old ids (lg-…), so importing again updates instead of duplicating.
 */

// ================================================================== dump parser
export type DumpTables = Record<string, { columns: string[]; rows: LegacyRow[] }>

export function parseDump(sql: string): DumpTables {
  const tables: DumpTables = {}
  for (const m of sql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\)[^;]*;/g)) {
    tables[m[1]!] = { columns: [...m[2]!.matchAll(/^\s*`([^`]+)`/gm)].map((c) => c[1]!), rows: [] }
  }
  // phpMyAdmin writes the column list (INSERT INTO `t` (`a`, `b`) VALUES …); mysqldump leaves it out (INSERT INTO `t` VALUES …)
  const re = /INSERT INTO `([^`]+)`\s*(?:\(([^)]*)\)\s*)?VALUES\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    const table = m[1]!
    const names = m[2] != null ? m[2].split(',').map((s) => s.trim().replace(/`/g, '')) : tables[table]?.columns ?? []
    if (!names.length) throw new Error(`The dump inserts into “${table}” without a column list or a CREATE TABLE.`)
    const target = (tables[table] ??= { columns: names, rows: [] })
    let i = re.lastIndex
    while (i < sql.length) {
      while (i < sql.length && /[\s,]/.test(sql[i]!)) i++
      if (sql[i] === ';') { i++; break }
      if (sql[i] !== '(') throw new Error(`Could not read the dump near “${sql.slice(i, i + 30)}” (table ${table}).`)
      i++
      const vals: (string | null)[] = []
      let cur = '', inStr = false, quoted = false
      for (; i < sql.length; i++) {
        const ch = sql[i]!
        if (inStr) {
          if (ch === '\\') {
            const n = sql[++i]!
            cur += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '0' ? '\0' : n === 'Z' ? '\x1a' : n
          } else if (ch === "'" && sql[i + 1] === "'") { cur += "'"; i++ }
          else if (ch === "'") inStr = false
          else cur += ch
        } else if (ch === "'") { inStr = true; quoted = true; cur = '' }
        else if (ch === ',' || ch === ')') {
          const raw = cur.trim()
          vals.push(quoted ? cur : raw.toUpperCase() === 'NULL' ? null : raw)
          cur = ''; quoted = false
          if (ch === ')') { i++; break }
        } else cur += ch
      }
      const row: LegacyRow = {}
      names.forEach((n, k) => (row[n] = vals[k] ?? null))
      target.rows.push(row)
    }
    re.lastIndex = i
  }
  return tables
}

// ================================================================== helpers
/** Old CRM stages 1–9 → the new 11-stage list ("Company Information Under Process" was inserted at 8). */
// old: 1 Data Collection · 2 Data Received · 3 In-process · 4 In-review · 5 Approved · 6 Ready to submit · 7 Submission
//      8 Approved / Rejection · 9 Re-submission
// new: 1 · 2 · 3 In-process / In-review · 4 Approved · 5 Ready · 6 Submission · 7 Company info · 8 Approved / Rejected / Re-submission / Hold
const newStage = (n: number) => [1, 2, 3, 3, 4, 5, 6, 8, 8][n - 1] ?? Math.min(n, 8)
const newOutcome = (n: number) => (n === 3 ? 'IN_PROCESS' : n === 4 ? 'IN_REVIEW' : n === 9 ? 'RESUBMISSION' : undefined)
const blank = (v: string | null | undefined) => v == null || v.trim() === '' || /^0000-00-00/.test(v)
const num = (v: string | null | undefined) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : 0 }
/** TIMESTAMP columns: the dump was written with time_zone = +00:00. */
const utc = (v: string | null | undefined) => (blank(v) ? undefined : new Date(v!.trim().replace(' ', 'T') + 'Z').toISOString())
/** DATETIME columns: the old server's local time (India). */
const ist = (v: string | null | undefined) => (blank(v) ? undefined : new Date(v!.trim().replace(' ', 'T') + '+05:30').toISOString())
const day = (v: string | null | undefined) => (blank(v) ? undefined : v!.trim().slice(0, 10))
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
/** Common surnames, to split run-together names from the old CRM ("sudhanshusingh" → "Sudhanshu Singh"). */
const SURNAMES = ['agarwal', 'agrawal', 'ahir', 'anand', 'arya', 'bhandari', 'bhanushali', 'bhatt', 'bhavaiya', 'bhavsar', 'bhatia', 'brahmbhatt', 'chauhan', 'chouhan', 'chaudhary', 'chudasama',
  'dalsaniya', 'darji', 'dave', 'desai', 'dixit', 'doshi', 'gandhi', 'gohil', 'gupta', 'hadole', 'jadeja', 'jadav', 'jain', 'jambhulkar', 'jariwala', 'zariwala', 'jivani', 'joshi', 'kamble', 'kaur', 'khaire',
  'khan', 'kumar', 'macwan', 'makwana', 'mathur', 'mehta', 'mishra', 'modi', 'nair', 'pandey', 'pandya', 'panchal', 'parekh', 'parikh', 'parmar', 'patel', 'patidar', 'pathak', 'prajapati', 'rana',
  'raval', 'rathod', 'rathore', 'ramani', 'rohit', 'sahani', 'sharma', 'shah', 'shrimali', 'singh', 'sisodiya', 'solanki', 'soni', 'srivastava', 'tapodhan', 'thakkar', 'thakor', 'tiwari', 'trivedi', 'tyagi',
  'upadhyay', 'vaghela', 'vasava', 'verma', 'vyas', 'watkar', 'yadav', 'zala', 'mehra', 'kapoor', 'malhotra', 'reddy', 'rao', 'iyer', 'pillai', 'das', 'ghosh', 'bose', 'sen', 'roy']
  .sort((a, b) => b.length - a.length)
/** "sudhanshu.singh" / "sudhanshusingh" → "Sudhanshu Singh"; unknown run-together names just get a capital letter. */
export function personName(raw: string) {
  const s = raw.trim().replace(/[._-]+/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim()
  if (s.includes(' ')) return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  const low = s.toLowerCase()
  const sur = SURNAMES.find((x) => low.endsWith(x) && low.length - x.length >= 3)
  const parts = sur ? [low.slice(0, -sur.length), sur] : [low]
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}
/** "M/S Edu-Teach LLP" →"msedutteachllp": how the old CRM named agreement PDFs, and a loose company match. */
export const squash = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
/** First two digits of a GSTIN / the old invoice's state code. */
const GST_STATE: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}
/** Old invoice branch codes → the branches under Access → Settings. Plain "ahmedabad" is ambiguous (two Ahmedabad branches). */
const BRANCH: Record<string, string> = { ahmedabad_a: 'br-amd-a', ahmedabad_y: 'br-amd-y', baroda: 'br-vdr', vadodara: 'br-vdr' }

export const ROLE_MAP: Record<string, { role: Role; department: string; designation: string }> = {
  'super admin': { role: 'superadmin', department: 'Management', designation: 'Super Admin' },
  admin: { role: 'admin', department: 'Administration', designation: 'Admin' },
  manager: { role: 'teamlead', department: 'Sales', designation: 'Sales Manager' },
  'admin member': { role: 'operations', department: 'Operations', designation: 'Processing Executive' },
  accountant: { role: 'accounts', department: 'Accounts', designation: 'Accountant' },
  employee: { role: 'sales', department: 'Sales', designation: 'Business Development Executive' },
  'public relationship manager': { role: 'support', department: 'Customer Support', designation: 'Public Relationship Manager' },
  legal: { role: 'legal', department: 'Legal', designation: 'Legal Executive' },
}
const DOC_CAT: Record<string, string> = {
  kyc: 'KYC', 'company documents': 'Company documents', 'government certificate': 'Government certificates', 'pitch deck dpr': 'Pitch deck',
  'financial documents': 'Financial', agreement: 'Agreement', general: 'Other', other: 'Other',
}
/** Old document → the matching Document Forms slot, from its title and file name (e.g. “cio”, “udyam”, “aadhar card”). */
const docCategory = (d: LegacyRow) => guessCategory(`${d.doc_title ?? ''} ${d.original_file_name ?? ''}`, DOC_CAT[norm(d.doc_type ?? 'other')] ?? 'Other')
const PAY_MODE: Record<string, string> = { upi: 'UPI', neft: 'NEFT', imps: 'IMPS', rtgs: 'RTGS', payment_link: 'Payment link', check: 'Cheque', cheque: 'Cheque', cash: 'Cash' }
const payMode = (v: string | null) => (v ? PAY_MODE[v.toLowerCase()] ?? (v.toLowerCase().startsWith('cash') ? 'Cash' : v) : 'Not recorded')
function serviceCategory(name: string) {
  const n = name.toLowerCase()
  if (/grant|scheme|seed|fund|subsid|pmegp|pmfme|nidhi|tide|msme|startup india seed/.test(n)) return 'Government Grants & Schemes'
  if (/loan|cgtmse|mudra|invest|pitch|dpr|angel|finance/.test(n)) return 'Funding & Investment'
  if (/website|digital|marketing|seo|social|app dev|logo|branding/.test(n)) return 'Digital Services'
  if (/incorporat|private limited|pvt|llp|company|roc|compliance|opc/.test(n)) return 'Company Services'
  return 'Certifications & Registrations'
}

/**
 * Documents made by the file step: agreements (`lg-d-ag-…`), payment screenshots without a payment (`lg-d-shot-…`)
 * and client uploads found by the client's phone number (`lg-d-up-…`).
 */
export const FILE_DOC = /^lg-d-(ag|shot|up)-/

// ================================================================== mapping
export interface ImportOptions {
  replaceSampleData: boolean
  /** the old billing database (u417368936_bill): staff full names and invoices */
  billing?: DumpTables
}

/** Newest `created_at` in a dump's crm table (to tell an older export from a newer one). */
const latestCrm = (t: DumpTables) => (t.crm?.rows ?? []).reduce((m, r) => ((r.created_at ?? '') > m ? r.created_at! : m), '')
const isBilling = (t: DumpTables) => !!t.invoices?.rows.length || !!t.users?.columns.includes('full_name')

/**
 * Several dumps chosen together (e.g. u417368936_crm.sql + u417368936_bill_full.sql): client files come from the dump
 * with the newest client file; the billing dump adds staff names and invoices.
 */
export function pickDumps(list: { name: string; tables: DumpTables }[]) {
  const crm = list.filter((x) => x.tables.crm?.rows.length).sort((a, b) => latestCrm(b.tables).localeCompare(latestCrm(a.tables)))
  const main = crm[0]
  if (!main) throw new Error('None of these files has the old CRM client files (the “crm” table).')
  const billing = list.filter((x) => isBilling(x.tables)).sort((a, b) => latestCrm(b.tables).localeCompare(latestCrm(a.tables)))[0]
  const notes = list.filter((x) => x !== main && x !== billing).map((x) => `${x.name} was not used: ${main.name} has newer client files (latest ${latestCrm(main.tables).slice(0, 10)}).`)
  if (billing && billing !== main && latestCrm(billing.tables) && latestCrm(billing.tables) < latestCrm(main.tables)) notes.push(`${billing.name} is an older export (client files up to ${latestCrm(billing.tables).slice(0, 10)}); only its staff names and invoices are used — client files come from ${main.name} (up to ${latestCrm(main.tables).slice(0, 10)}).`)
  return { main, billing: billing && billing !== main ? billing : undefined, notes }
}
export interface ImportReport {
  source: Record<string, number>
  imported: Record<string, number>
  checks: { label: string; legacy: string; imported: string; ok: boolean }[]
  statusMap: { legacy: string; count: number; becomes: string }[]
  roleMap: { legacy: string; count: number; becomes: string }[]
  notes: string[]
  skipped: string[]
}

export function buildImport(tables: DumpTables, current: DB, opts: ImportOptions): { next: DB; report: ImportReport } {
  const T = (name: string) => tables[name]?.rows ?? []
  const crm = T('crm')
  if (!crm.length || !T('users').length) throw new Error('This file does not look like the old Rexera CRM (no “crm” or “users” table).')
  const notes: string[] = []
  const skipped: string[] = []
  const now = new Date().toISOString()

  // ---------------------------------------------------------- start from current data (optionally without sample data)
  // sample people from the demo seed (the 9 company logins are kept; accounts people created themselves are kept)
  const SAMPLE_ONLY = new Set(['u-ad2', 'u-acc', 'u-op2', 'u-tl1', 'u-tl2', 'u-s2', 'u-s3', 'u-s4', 'u-s5'])
  const keepUser = (u: User) => !opts.replaceSampleData || PRESET_USERS.has(u.username) || !SAMPLE_ONLY.has(u.id) || u.legacyId != null
  const users: User[] = current.users.filter(keepUser).map((u) => ({ ...u }))
  const keptIds = new Set(users.map((u) => u.id))
  const base: DB = opts.replaceSampleData ? {
    ...current, users,
    leads: current.leads.filter((l) => l.id.startsWith('lg-')), bookings: current.bookings.filter((b) => b.id.startsWith('lg-')),
    invoices: [], schemes: [], posts: [], broadcasts: [], events: [], leaves: [], sessions: current.sessions.filter((s) => keptIds.has(s.userId)),
    notices: [], messages: [], emails: [], payrollRuns: [], manualIncentives: [], pfAccounts: current.pfAccounts.filter((a) => keptIds.has(a.userId)),
    audit: current.audit.filter((a) => keptIds.has(a.by)),
  } : { ...current, users }

  // ---------------------------------------------------------- users (match by email; never import passwords)
  const byEmail = new Map(base.users.map((u) => [u.email.toLowerCase(), u]))
  const legacyUser = new Map<string, User>()     // old id → user
  const usernames = new Set(base.users.map((u) => u.username.toLowerCase()))
  const roleCount = new Map<string, number>()
  let created = 0, merged = 0
  const manager = T('users').find((u) => (u.role ?? '').trim().toLowerCase() === 'manager')
  // The old users table has no names; every client file records the closer's name next to their email.
  // Use the most frequent spelling per email.
  const nameVotes = new Map<string, Map<string, number>>()
  for (const r of crm) {
    const e = (r.lead_closed_by_email ?? '').trim().toLowerCase(), n = (r.lead_closed_by ?? '').trim().replace(/\s+/g, ' ')
    if (!e || n.length < 2 || /@/.test(n)) continue
    const v = nameVotes.get(e) ?? new Map<string, number>(); v.set(n, (v.get(n) ?? 0) + 1); nameVotes.set(e, v)
  }
  // the billing database has a full_name per person — it wins over the closer names on client files
  const bill = opts.billing ?? (isBilling(tables) ? tables : undefined)
  const fullNames = new Map((bill?.users?.rows ?? []).map((u) => [(u.email ?? '').trim().toLowerCase(), (u.full_name ?? '').trim().replace(/\s+/g, ' ')] as const)
    .filter(([, n]) => n.length > 1 && !/@/.test(n)))
  const realName = (email: string) => { const f = fullNames.get(email); if (f) return f; const v = nameVotes.get(email); return v ? [...v].sort((a, b) => b[1] - a[1])[0]![0] : undefined }
  // most old names are the email name run together ("sudhanshusingh"); those are split at a known surname
  const isRunTogether = (name: string, email: string) => !name.trim().includes(' ') && squash(name) === squash(email.split('@')[0])
  const bestName = (email: string) => personName(realName(email) ?? email.split('@')[0] ?? '')
  /** names an earlier import may have given (so a name someone typed in Employees is never overwritten) */
  const earlierNames = (email: string) => {
    const local = email.split('@')[0] ?? ''
    return new Set([titleCase(local.replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim() || local), ...[...(nameVotes.get(email)?.keys() ?? [])].map((n) => titleCase(n.toLowerCase())), ...(fullNames.has(email) ? [titleCase(fullNames.get(email)!.toLowerCase())] : [])])
  }
  let namesFound = 0, namesSplit = 0, renamed = 0
  for (const r of T('users')) {
    const email = (r.email ?? '').trim().toLowerCase()
    const legacyRole = (r.role ?? '').trim()
    roleCount.set(legacyRole, (roleCount.get(legacyRole) ?? 0) + 1)
    const map = ROLE_MAP[legacyRole.toLowerCase()] ?? ROLE_MAP.employee!
    const existing = byEmail.get(email)
    if (existing) {
      existing.legacyId = Number(r.id); existing.legacyRole = legacyRole
      // a person an earlier import named "Sudhanshusingh" becomes "Sudhanshu Singh"; names changed by hand stay
      if (existing.id.startsWith('lg-u-') && earlierNames(email).has(existing.name) && existing.name !== bestName(email)) { existing.name = bestName(email); renamed++ }
      legacyUser.set(r.id!, existing); merged++
      if (existing.role !== map.role) {
        // the old Manager leads every sales person: they need team-leader rights to see the team and approve new files
        if (map.role === 'teamlead' && !existing.extraRoles.includes('teamlead')) {
          existing.extraRoles = [...existing.extraRoles, 'teamlead']
          notes.push(`${email} was the “${legacyRole}” in the old CRM: kept as ${existing.role} and given Team Leader as an extra role, so they see their team and approve its new files.`)
        } else notes.push(`${email} was “${legacyRole}” in the old CRM; kept as ${existing.role} here (your current setting) — add an extra role in Access if they still do that work.`)
      }
      continue
    }
    const local = email.split('@')[0] ?? `user${r.id}`
    let username = local.replace(/[^a-z0-9._-]/gi, '').toLowerCase() || `user${r.id}`
    while (usernames.has(username)) username = `${username}.${r.id}`
    usernames.add(username)
    const found = realName(email)
    const name = bestName(email)
    if (found && !isRunTogether(found, email)) namesFound++
    else if (name.includes(' ')) namesSplit++
    const u: User = {
      id: `lg-u-${r.id}`, name, username, email, phone: '',
      role: map.role, extraRoles: [], grants: [], denies: [], department: map.department, designation: map.designation,
      joinedOn: day(utc(r.created_at)) ?? now.slice(0, 10), active: true, passHash: '', needsPasswordReset: true,
      legacyId: Number(r.id), legacyRole,
    }
    base.users.push(u); byEmail.set(email, u); legacyUser.set(r.id!, u); created++
  }
  if (created) notes.push(`The old CRM keeps names as the email name run together (e.g. “sudhanshusingh”). Of ${created} new users, ${namesFound} had a proper name, ${namesSplit} were split at a common surname (“Sudhanshu Singh”) and ${created - namesFound - namesSplit} keep one word — check names in Employees.`)
  if (renamed) notes.push(`${renamed} user(s) imported earlier get the better name (names you changed yourself are kept).`)
  const managerUser = manager ? legacyUser.get(manager.id!) : undefined
  const allIds = new Set(base.users.map((u) => u.id))
  for (const u of base.users) {
    if (u.teamLeadId && !allIds.has(u.teamLeadId)) u.teamLeadId = undefined          // sample team leader removed
    if (!u.teamLeadId && managerUser && u.id !== managerUser.id && (u.role === 'sales' || u.legacyRole?.toLowerCase() === 'employee')) u.teamLeadId = managerUser.id
  }
  const userFromEmail = (e: string | null | undefined) => (e ? byEmail.get(e.trim().toLowerCase()) : undefined)
  const userFromId = (id: string | null | undefined) => (id ? legacyUser.get(id.trim()) : undefined)

  // ---------------------------------------------------------- services (merge by name)
  const services: Service[] = base.services.map((s) => ({ ...s }))
  const svcByName = new Map(services.map((s) => [norm(s.name), s]))
  let svcAdded = 0
  for (const r of T('services')) {
    const name = (r.name ?? '').trim()
    if (!name || svcByName.has(norm(name))) continue
    const s: Service = { id: `lg-svc-${r.id}`, name, category: serviceCategory(name), price: 0, gstRate: 18, deduction: 0, active: true }
    services.push(s); svcByName.set(norm(name), s); svcAdded++
  }
  // The old CRM's file service text is free-form: "combo (1.Seed Fund)", "Startup India Certificate\r\n+ DSC", "Seed Fund".
  // Link each file to the best service (exact → core name → one unambiguous close match → new service); the file's
  // own service text is never changed.
  let svcFuzzy = 0
  const listed = new Set(svcByName.keys())
  const findService = (raw: string): Service | undefined => {
    if (!raw.trim()) return undefined
    if (!listed.has(norm(raw))) svcFuzzy++
    const exact = svcByName.get(norm(raw))
    if (exact) return exact
    let core = raw.trim()
    const combo = core.match(/^combo\s*\(\s*\d+\s*\.\s*([\s\S]+?)\s*\)\s*$/i)
    if (combo) core = combo[1]!
    core = core.split(/\r?\n/)[0]!.trim() || raw.trim()
    const key = norm(core)
    const byCore = svcByName.get(key)
    if (byCore) return byCore
    const close = services.filter((s) => { const n = norm(s.name); return n.startsWith(key + ' ') || key.startsWith(n + ' ') })
    if (close.length === 1) return close[0]
    const s: Service = { id: `lg-svc-x-${key.replace(/ /g, '-').slice(0, 60)}`, name: core, category: serviceCategory(core), price: 0, gstRate: 18, deduction: 0, active: true }
    services.push(s); svcByName.set(key, s); svcAdded++
    return s
  }

  // ---------------------------------------------------------- client files
  const workflow = new Map(T('crm_workflow_steps').map((w) => [w.crm_id!, w]))
  const deductions = new Map<string, LegacyRow[]>()
  for (const d of T('crm_deductions')) deductions.set(d.crm_id!, [...(deductions.get(d.crm_id!) ?? []), d])
  const comments = new Map<string, LegacyRow[]>()
  for (const c of T('crm_comments')) comments.set(c.crm_id!, [...(comments.get(c.crm_id!) ?? []), c])
  const docs = new Map<string, LegacyRow[]>()
  for (const d of T('client_documents')) if (d.crm_id) docs.set(d.crm_id, [...(docs.get(d.crm_id) ?? []), d])

  const statusCount = new Map<string, { count: number; becomes: string }>()
  let missingAssignee = 0, gstEstimated = 0, paymentsMade = 0, unknownStatus = 0, withGstNoAmount = 0, undated = 0, ownerUnknown = 0, futureDated = 0
  const estimatedIds = new Set<string>()
  const bookings: Booking[] = []
  const previous = new Map(current.bookings.filter((b) => b.id.startsWith('lg-')).map((b) => [b.id, b]))
  let filesKept = 0
  for (const r of crm) {
    const id = `lg-b-${r.id}`
    const wf = workflow.get(r.id!)
    const owner = userFromEmail(r.lead_closed_by_email) ?? userFromId(r.submitted_by)
    const assignee = userFromId(r.assigned_to)
    if (!assignee && !blank(r.assigned_to)) missingAssignee++
    const ops = assignee && assignee.role === 'operations' ? assignee : undefined
    const createdAt = utc(r.created_at) ?? now

    // stage history from the workflow timestamps
    const stageHistory: StageMove[] = []
    if (wf) for (let n = 1; n <= 9; n++) {
      const key = Object.keys(wf).find((k) => k.startsWith(`stage_${n}_`))
      const at = key ? utc(wf[key]) : undefined
      if (at) stageHistory.push({ stage: newStage(n), outcome: newOutcome(n), at, by: ops?.id ?? owner?.id ?? '', note: `Stage ${n} (old CRM)` })
    }
    stageHistory.sort((a, b) => a.at.localeCompare(b.at))
    const highestStage = stageHistory.reduce((m, s) => Math.max(m, s.stage), 0)

    // status: free text in the old CRM → status + stage (original text is kept and shown)
    const raw = (r.status ?? '').trim()
    let status: BookingStatus, stage = Math.max(1, highestStage), holdReason: string | undefined, holdFrom: BookingStatus | undefined
    let stageOutcome = [...stageHistory].reverse().find((h) => h.stage === stage)?.outcome
    const stageMatch = raw.match(/^stage\s*-?\s*([1-9])(?:\s*-|\s*$)/i)
    if (stageMatch) { status = 'IN_OPERATIONS'; stage = newStage(Number(stageMatch[1])); stageOutcome = newOutcome(Number(stageMatch[1])) }
    else if (/^company\s+inc/i.test(raw)) { status = 'IN_OPERATIONS'; stage = STAGES.indexOf('Company Information Under Process') + 1 }
    else if (/^approved$/i.test(raw)) status = r.legal_approved_at ? 'IN_OPERATIONS' : 'PENDING_LEGAL'
    else if (/^rejected$/i.test(raw)) status = 'REJECTED'
    else if (/^pending$/i.test(raw) || raw === '') status = r.approved_at ? 'PENDING_LEGAL' : 'PENDING_TL'
    else { status = 'ON_HOLD'; holdReason = raw; holdFrom = 'IN_OPERATIONS'; if (!/hold|pending|under process|not complete|kyc|waiting/i.test(raw)) unknownStatus++ }
    const becomes = status === 'IN_OPERATIONS' ? `With Operations · stage ${stageLabel(stage, stageOutcome)}` : status === 'ON_HOLD' ? `On hold · “${raw}”` : status === 'PENDING_LEGAL' ? 'Pending Legal' : status === 'REJECTED' ? 'Rejected' : status
    const key = `${raw}\u0000${becomes}`
    const sc = statusCount.get(key) ?? { count: 0, becomes }
    sc.count++; statusCount.set(key, sc)
    const maxMatch = (r.max_allowed_step ?? '').match(/stage\s*-\s*(\d)/i)
    const maxStage = Math.max(stage, maxMatch ? newStage(Number(maxMatch[1])) : STAGES.length)

    // approvals timeline
    const approvals: Approval[] = []
    if (r.approved_at) {
      const by = userFromEmail(r.approved_by) ?? managerUser
      approvals.push({ id: `lg-a-${r.id}-tl`, level: 'Team Leader', action: 'APPROVED', by: by?.id ?? '', at: ist(r.approved_at)!, remark: userFromEmail(r.approved_by) ? 'Approved in the old CRM' : `Approved in the old CRM by ${r.approved_by ?? 'unknown'}` })
    }
    if (r.account_approved_at) approvals.push({ id: `lg-a-${r.id}-acc`, level: 'Accounts', action: 'APPROVED', by: userFromEmail(r.account_approved_by)?.id ?? '', at: ist(r.account_approved_at)!, remark: 'Approved in the old CRM' })
    if (r.legal_approved_at) approvals.push({ id: `lg-a-${r.id}-leg`, level: 'Legal', action: 'APPROVED', by: userFromEmail(r.legal_approved_by)?.id ?? '', at: ist(r.legal_approved_at)!, remark: (r.legal_remark ?? '').trim() || 'Approved in the old CRM' })
    if (status === 'REJECTED') approvals.push({ id: `lg-a-${r.id}-rej`, level: 'Old CRM', action: 'REJECTED', by: '', at: ist(r.legal_approved_at) ?? createdAt, remark: (r.legal_remark || r.remark || 'Rejected in the old CRM')!.trim() })

    // payments: advance + parts 2–4, with-GST amounts kept exactly as recorded
    const payments: Payment[] = []
    const parts: [string | null, string | null, string | null, string][] = [
      [r.advance_amount, r.advance_with_gst, r.payment_date, r.payment_screenshot || 'Recorded in the old CRM'],
      [r.payment_part_2_amount, r.payment_part_2_with_gst, r.payment_part_2_date, 'Recorded in the old CRM'],
      [r.payment_part_3_amount, r.payment_part_3_with_gst, r.payment_part_3_date, 'Recorded in the old CRM'],
      [r.payment_part_4_amount, r.payment_part_4_with_gst, r.payment_part_4_date, 'Recorded in the old CRM'],
    ]
    parts.forEach(([amount, withGst, date, proof], k) => {
      const a = num(amount)
      const w = num(withGst)
      if (a === 0) { if (w !== 0) withGstNoAmount++; return }
      // tiny negative amounts (−₹0.01 / −₹0.02) were rounding adjustments in the old CRM — kept exactly
      const adjustment = a < 0
      let gst: number
      if (w !== 0) gst = round2(w - a)
      else if (adjustment) gst = 0
      else { gst = round2(a * 0.18); gstEstimated++; estimatedIds.add(`lg-p-${r.id}-${k + 1}`) }
      if (!day(date)) undated++
      else if (day(date)! > now.slice(0, 10)) futureDated++
      payments.push({ id: `lg-p-${r.id}-${k + 1}`, part: payments.length + 1, amount: a, gst, total: round2(a + gst), date: day(date) ?? createdAt.slice(0, 10), dateUnknown: !day(date) || undefined, mode: adjustment ? 'Adjustment' : payMode(r.booking_mode), proofName: adjustment ? 'Rounding adjustment (old CRM)' : proof, recordedBy: owner?.id ?? '', verified: true })
      paymentsMade++
    })
    const firstWith = num(r.advance_with_gst), firstAmt = num(r.advance_amount)
    const gstRate = firstAmt > 0 && firstWith > 0 && Math.abs(firstWith / firstAmt - 1.18) > 0.005 ? round2((firstWith / firstAmt - 1) * 100) : 18

    // comments & remarks (verbatim)
    const timeline: BComment[] = []
    for (const c of comments.get(r.id!) ?? []) timeline.push({ id: `lg-c-${c.id}`, by: userFromId(c.user_id)?.id ?? '', at: utc(c.created_at) ?? createdAt, text: c.comment_text ?? '', kind: c.comment_type === 'mr' ? 'PR / MR' : 'Admin' })
    const remark = (field: string, kind: string, by: string | undefined, at: string | undefined) => {
      const v = (r[field] ?? '').trim()
      if (v) timeline.push({ id: `lg-r-${r.id}-${field}`, by: by ?? '', at: at ?? createdAt, text: v, kind })
    }
    remark('remark', 'Remark (old CRM)', owner?.id, createdAt)
    remark('bde_remark', 'BDE remark (old CRM)', owner?.id, createdAt)
    remark('admin_remark', 'Admin remark (old CRM)', ops?.id, createdAt)
    remark('remark_public_relation', 'PR remark (old CRM)', undefined, createdAt)
    timeline.sort((a, b) => a.at.localeCompare(b.at))

    // documents (metadata; the files themselves stay on the old server)
    const documents: BDoc[] = (docs.get(r.id!) ?? []).map((d) => ({
      id: `lg-d-${d.id}`, name: (d.doc_title || d.original_file_name || d.stored_file_name || 'Document')!.trim(), category: docCategory(d),
      size: num(d.file_size), at: utc(d.uploaded_at) ?? createdAt, by: userFromId(d.uploaded_by)?.id ?? '', legacyPath: d.file_path ?? d.stored_file_name ?? undefined,
    }))
    if (!blank(r.agreement_pdf)) documents.push({ id: `lg-d-agreement-${r.id}`, name: 'Signed agreement (old CRM)', category: 'Other', size: 0, at: ist(r.legal_approved_at) ?? createdAt, by: '', legacyPath: r.agreement_pdf!, status: 'VERIFIED' })

    const ded = deductions.get(r.id!)
    const svc = findService(r.service ?? '')
    if (!owner) ownerUnknown++
    const txt = (v: string | null | undefined) => (v ?? '').trim()
    const billing = { name: txt(r.invoice_company_name), pan: txt(r.invoice_pan).toUpperCase(), gstin: txt(r.invoice_gst).toUpperCase(), contact: txt(r.invoice_contact), email: txt(r.invoice_email) }
    // only keep invoice-to details when they say something the file doesn't already
    const billingDiffers = (billing.name && billing.name !== txt(r.company_name)) || (billing.pan && billing.pan !== txt(r.company_pan).toUpperCase()) || (billing.gstin && billing.gstin !== txt(r.gst_no).toUpperCase())
      || (billing.contact && normPhone(billing.contact) !== normPhone(r.company_mobile ?? '')) || (billing.email && billing.email.toLowerCase() !== txt(r.company_email).toLowerCase())
    const updatedAt = [createdAt, ...approvals.map((a) => a.at), ...stageHistory.map((s) => s.at)].sort().at(-1)!
    const bk: Booking = {
      id, bookingId: (r.booking_id ?? '').trim() || `LEGACY-${r.id}`, companyName: r.company_name ?? '', contactPerson: r.contact_person ?? '',
      mobile: normPhone(r.company_mobile ?? ''), email: (r.company_email ?? '').trim(), pan: (r.company_pan ?? '').trim().toUpperCase(), gstin: (r.gst_no ?? '').trim().toUpperCase(),
      city: r.city ?? '', state: r.state ?? '', industry: r.industry ?? r.sector ?? '', serviceId: svc?.id ?? '', serviceName: r.service ?? '',
      mode: r.mode === 'Refundable' ? 'Refundable' : 'Non-Refundable', successFeePct: num(r.percentage), totalQuoted: num(r.total_quoted), gstRate,
      deduction: ded ? round2(ded.reduce((s, d) => s + num(d.deducted_amount), 0)) : 0, payments,
      createdBy: owner?.id ?? '', teamLeadId: managerUser?.id, status, holdFrom, holdReason, approvals,
      opsMemberId: status === 'IN_OPERATIONS' || status === 'ON_HOLD' ? ops?.id : undefined, stage, maxStage, stageHistory, ...(stageOutcome ? { stageOutcome } : {}),
      comments: timeline, documents, tasks: [], priority: 'MEDIUM', deadline: '', createdAt, updatedAt,
      address: txt(r.address) || undefined, website: txt(r.website) || undefined, cin: txt(r.cin_llp) || undefined,
      startupContact: txt(r.startup_contact) || txt(r.startup_email) ? { phone: txt(r.startup_contact), email: txt(r.startup_email) } : undefined,
      billing: billingDiffers ? billing : undefined,
      ownerName: owner ? undefined : txt(r.lead_closed_by) || undefined,
      legacyId: Number(r.id), legacy: { crm: r, workflow: wf, deductions: ded },
    }
    // files attached from the old uploads folder (step 4) stay attached when the dump is imported again
    const before = previous.get(id)
    if (before) {
      for (const p of bk.payments) { const o = before.payments.find((x) => x.id === p.id); if (o?.proof) { p.proof = o.proof; filesKept++ } }
      for (const doc of bk.documents) { const o = before.documents.find((x) => x.id === doc.id); if (o?.file) { doc.file = o.file; doc.size = o.file.size; filesKept++ } }
      for (const o of before.documents) if (FILE_DOC.test(o.id) && !bk.documents.some((x) => x.id === o.id)) { bk.documents.push(o); filesKept++ }
    }
    bookings.push(bk)
  }
  if (filesKept) notes.push(`${filesKept} file(s) already attached from the old uploads folder stay attached.`)
  if (svcFuzzy) notes.push(`${svcFuzzy} file(s) wrote the service differently from the services list (e.g. “combo (1.Seed Fund)”); each is linked to the matching service and keeps its original text.`)
  if (missingAssignee) notes.push(`${missingAssignee} file(s) were assigned to a processing user who no longer exists in the old CRM (shown as “unassigned”; the old id is kept on the record).`)
  if (gstEstimated) notes.push(`${gstEstimated} payment(s) had no with-GST amount in the old CRM; GST was calculated at 18% for them.`)
  if (withGstNoAmount) notes.push(`${withGstNoAmount} payment part(s) had a with-GST figure but no base amount in the old CRM; they were not turned into payments (the figures are kept in the original record).`)
  if (undated) notes.push(`${undated} payment(s) have no date in the old CRM; they are dated on the booking day and marked “date not recorded”.`)
  if (futureDated) notes.push(`${futureDated} payment(s) are dated after today in the old CRM (probably typing mistakes); they are kept as recorded — check them under CRM Entries.`)
  if (ownerUnknown) notes.push(`${ownerUnknown} file(s) were closed by someone who isn't a user in the old CRM; the closer's name is shown on the file.`)
  if (unknownStatus) notes.push(`${unknownStatus} file(s) had an unusual status text; they are “On hold” with the original text as the reason.`)

  // ---------------------------------------------------------- leads (+ assignment & activity)
  const assignments = new Map<string, LegacyRow>()
  for (const a of T('lead_assignments')) if ((a.assignment_status ?? 'Active') === 'Active') assignments.set(a.lead_id!, a)
  const activity = new Map<string, LegacyRow[]>()
  for (const a of T('lead_activity')) activity.set(a.lead_id!, [...(activity.get(a.lead_id!) ?? []), a])
  const DISP: Record<string, LeadStatus> = { new: 'NEW', intro: 'ATTEMPTED', contacted: 'ATTEMPTED', 'call back': 'CALL_BACK', callback: 'CALL_BACK', interested: 'INTERESTED', 'not interested': 'NOT_INTERESTED', converted: 'CONVERTED', closed: 'NOT_INTERESTED' }
  const phones = new Set(base.leads.filter((l) => !l.id.startsWith('lg-')).map((l) => l.phone))
  const leads: Lead[] = []
  let leadsSkipped = 0
  for (const r of T('leads')) {
    const phone = normPhone(r.phone ?? r.alternate_phone ?? '')
    if (!/^[6-9]\d{9}$/.test(phone) || phones.has(phone)) { leadsSkipped++; continue }
    phones.add(phone)
    const a = assignments.get(r.id!)
    const log = (activity.get(r.id!) ?? []).map((x) => `• ${x.created_at ?? ''} ${x.action ?? ''}${x.new_value ? `: ${x.new_value}` : ''}${x.notes ? ` — ${x.notes}` : ''}`)
    leads.push({
      id: `lg-l-${r.id}`, code: (r.lead_code ?? '').trim() || `LG-${r.id}`, name: r.name ?? '', company: r.company_name ?? '', phone, email: r.email ?? '',
      city: r.city ?? '', state: r.state ?? '', service: r.product_service ?? '', source: r.lead_source ?? 'Old CRM',
      price: a && num(a.conversion_value) > 0 ? num(a.conversion_value) : undefined,
      status: (a ? DISP[(a.disposition_status ?? 'new').toLowerCase()] : undefined) ?? (r.status === 'Converted' ? 'CONVERTED' : r.status === 'Closed' ? 'NOT_INTERESTED' : 'NEW'),
      followUp: day(a?.follow_up_date), notes: [r.requirement, r.notes, a?.disposition_notes, log.length ? `Old CRM activity:\n${log.join('\n')}` : ''].filter((x) => x && x.trim()).join('\n\n'),
      assignedTo: userFromId(a?.employee_id)?.id, createdBy: userFromId(r.created_by)?.id ?? '', createdAt: ist(r.created_at) ?? now, calls: [], legacy: r,
    })
  }
  if (leadsSkipped) notes.push(`${leadsSkipped} lead(s) skipped: no valid 10-digit phone, or the number is already a lead.`)

  // ---------------------------------------------------------- notifications
  const notices: Notice[] = T('notifications').filter((n) => userFromId(n.user_id)).map((n) => ({
    id: `lg-n-${n.id}`, userId: userFromId(n.user_id)!.id, title: n.title || 'Notification (old CRM)', body: n.message ?? '',
    at: utc(n.created_at) ?? now, read: n.is_read === '1', kind: (['info', 'success', 'warning', 'action'].includes(n.type ?? '') ? n.type : 'info') as Notice['kind'],
  }))

  // ---------------------------------------------------------- invoices (billing database)
  const invItems = new Map<string, LegacyRow[]>()
  for (const it of bill?.invoice_items?.rows ?? []) invItems.set(it.invoice_id!, [...(invItems.get(it.invoice_id!) ?? []), it])
  const branchIds = new Set((base.settings.branches ?? []).map((b) => b.id))
  const billUser = new Map((bill?.users?.rows ?? []).map((u) => [u.id!, (u.email ?? '').trim().toLowerCase()]))
  const byCompany = new Map<string, Booking[]>()
  for (const b of bookings) { const k = squash(b.companyName); if (k) byCompany.set(k, [...(byCompany.get(k) ?? []), b]) }
  let invoicesLinked = 0
  const invoices: Invoice[] = (bill?.invoices?.rows ?? []).map((r) => {
    const cg = num(r.cgst_rate), sg = num(r.sgst_rate), ig = num(r.igst_rate)
    const gstin = (r.client_gstin || r.gst || '').trim().toUpperCase()
    const code = ((r.client_state_code || r.billing_state_code || '').trim() || gstin.slice(0, 2)).padStart(2, '0')
    const state = GST_STATE[code] ?? (ig > 0 ? '' : cg + sg > 0 ? base.settings.supplierState : '')
    const client = (r.billing_name || r.company_name || '').trim()
    // linked by crm_id when the old invoice had one, otherwise by an unambiguous company name
    const byName = byCompany.get(squash(client)) ?? byCompany.get(squash(r.company_name))
    const booking = (r.crm_id && bookings.find((b) => b.legacyId === Number(r.crm_id))) || (byName && new Set(byName.map((b) => b.companyName)).size === 1 ? byName.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined)
    if (booking) invoicesLinked++
    const by = userFromEmail(billUser.get(r.generated_by_user_id ?? ''))
    const items = (invItems.get(r.id!) ?? []).map((it) => ({
      desc: (it.particulars || it.description || 'Consultancy Services')!.trim(), sac: (it.hsn || it.hsn_sac || '998312')!.trim(),
      // the amount the old invoice charged (some were saved with ₹0 — kept as ₹0, like the old grand total)
      qty: num(it.quantity) || 1, rate: blank(it.amount) ? num(it.mrp) : round2(num(it.amount) / (num(it.quantity) || 1)), gstRate: round2(cg + sg + ig),
    }))
    const branch = BRANCH[(r.invoice_branch ?? '').trim().toLowerCase()]
    return {
      id: `lg-inv-${r.id}`, number: (r.invoice_number ?? '').trim() || `OLD-${r.id}`, type: /proforma/i.test(r.invoice_type ?? '') ? 'PROFORMA' : 'TAX',
      bookingId: booking?.id, client, gstin, state, items, paid: 0, status: 'ISSUED', date: day(r.invoice_date) ?? day(ist(r.created_at)) ?? now.slice(0, 10),
      due: day(r.invoice_date) ?? now.slice(0, 10), salesPerson: by?.id ?? booking?.createdBy, createdBy: by?.id ?? '',
      branchId: branch && branchIds.has(branch) ? branch : undefined, clientAddress: (r.billing_address ?? '').trim() || undefined, clientPan: (r.pan ?? '').trim().toUpperCase() || undefined,
    } satisfies Invoice
  })
  if (invoices.length) {
    notes.push(`${invoices.length} invoice(s) from the old billing system keep their old numbers; ${invoicesLinked} are linked to a client file by company name (the old invoices had no client-file link). Payments received against them weren't recorded there, so they show as issued.`)
    const zero = invoices.filter((i) => i.items.every((x) => x.rate === 0)).length
    if (zero) notes.push(`${zero} old invoice(s) were saved with a ₹0 amount in the old billing system (probably unfinished); they are kept as ₹0.`)
    const unbranched = invoices.filter((i) => !i.branchId).length
    if (unbranched) notes.push(`${unbranched} old invoice(s) say only “Ahmedabad” or an unknown branch — Accounts can pick the branch on the invoice.`)
  }

  // ---------------------------------------------------------- assemble (lg-* records replace earlier imports)
  const next: DB = {
    ...base,
    invoices: [...base.invoices.filter((i) => !i.id.startsWith('lg-')), ...invoices],
    services,
    bookings: [...base.bookings.filter((b) => !b.id.startsWith('lg-')), ...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    leads: [...base.leads.filter((l) => !l.id.startsWith('lg-')), ...leads],
    notices: [...base.notices.filter((n) => !n.id.startsWith('lg-')), ...notices],
    pfAccounts: [...base.pfAccounts, ...base.users.filter((u) => !base.pfAccounts.some((p) => p.userId === u.id)).map((u) => ({ userId: u.id, uan: '', enrolled: true }))],
  }
  next.audit = [{ id: `lg-audit-${Date.now()}`, at: now, by: '', action: 'LEGACY_IMPORT', detail: `${bookings.length} client files, ${created} new + ${merged} matched users, ${leads.length} leads imported from the old CRM` }, ...next.audit]

  // ---------------------------------------------------------- verification against the dump
  const sumLegacyQuoted = round2(crm.reduce((s, r) => s + num(r.total_quoted), 0))
  const sumImportedQuoted = round2(bookings.reduce((s, b) => s + b.totalQuoted, 0))
  const legacyBase = round2(crm.reduce((s, r) => s + num(r.advance_amount) + num(r.payment_part_2_amount) + num(r.payment_part_3_amount) + num(r.payment_part_4_amount), 0))
  const importedBase = round2(bookings.reduce((s, b) => s + b.payments.reduce((x, p) => x + p.amount, 0), 0))
  // with-GST: compare the parts that had both a base amount and a with-GST figure in the old CRM
  const pairs: [string, string][] = [['advance_amount', 'advance_with_gst'], ['payment_part_2_amount', 'payment_part_2_with_gst'], ['payment_part_3_amount', 'payment_part_3_with_gst'], ['payment_part_4_amount', 'payment_part_4_with_gst']]
  const legacyWithGst = round2(crm.reduce((s, r) => s + pairs.reduce((x, [a, w]) => x + (num(r[a]) !== 0 && num(r[w]) !== 0 ? num(r[w]) : 0), 0), 0))
  const importedWithGstRecorded = round2(bookings.reduce((s, b) => s + b.payments.filter((p) => !estimatedIds.has(p.id)).reduce((x, p) => x + p.total, 0), 0))
  const legacyStages = T('crm_workflow_steps').reduce((s, w) => s + Object.keys(w).filter((k) => /^stage_\d_/.test(k) && !blank(w[k])).length, 0)
  const lakh = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const fieldMismatch = bookings.filter((b) => b.companyName !== (b.legacy!.crm.company_name ?? '') || b.bookingId !== ((b.legacy!.crm.booking_id ?? '').trim() || `LEGACY-${b.legacyId}`) || b.serviceName !== (b.legacy!.crm.service ?? '')).length
  const checks = [
    { label: 'Client files', legacy: String(crm.length), imported: String(bookings.length), ok: crm.length === bookings.length },
    { label: 'Unique booking ids', legacy: String(new Set(crm.map((r) => r.booking_id)).size), imported: String(new Set(bookings.map((b) => b.bookingId)).size), ok: new Set(crm.map((r) => r.booking_id)).size === new Set(bookings.map((b) => b.bookingId)).size },
    { label: 'Company, booking id & service text identical', legacy: `${crm.length} files`, imported: `${crm.length - fieldMismatch} identical`, ok: fieldMismatch === 0 },
    { label: 'Total quoted (before GST)', legacy: lakh(sumLegacyQuoted), imported: lakh(sumImportedQuoted), ok: Math.abs(sumLegacyQuoted - sumImportedQuoted) < 0.01 },
    { label: 'Payments received (before GST)', legacy: lakh(legacyBase), imported: lakh(importedBase), ok: Math.abs(legacyBase - importedBase) < 0.01 },
    { label: 'Payments with GST (as recorded)', legacy: lakh(legacyWithGst), imported: lakh(importedWithGstRecorded), ok: Math.abs(legacyWithGst - importedWithGstRecorded) < 0.01 },
    { label: 'Stage timestamps → stage history', legacy: String(legacyStages), imported: String(bookings.reduce((s, b) => s + b.stageHistory.length, 0)), ok: legacyStages === bookings.reduce((s, b) => s + b.stageHistory.length, 0) },
    { label: 'Comments', legacy: String(T('crm_comments').length), imported: String(bookings.reduce((s, b) => s + b.comments.filter((c) => c.id.startsWith('lg-c-')).length, 0)), ok: T('crm_comments').length === bookings.reduce((s, b) => s + b.comments.filter((c) => c.id.startsWith('lg-c-')).length, 0) },
    { label: 'Client documents', legacy: String(T('client_documents').length), imported: String(bookings.reduce((s, b) => s + b.documents.filter((d) => /^lg-d-\d+$/.test(d.id)).length, 0)), ok: T('client_documents').length === bookings.reduce((s, b) => s + b.documents.filter((d) => /^lg-d-\d+$/.test(d.id)).length, 0) },
    { label: 'Deductions', legacy: String(T('crm_deductions').length), imported: String(bookings.reduce((s, b) => s + (b.legacy?.deductions?.length ?? 0), 0)), ok: T('crm_deductions').length === bookings.reduce((s, b) => s + (b.legacy?.deductions?.length ?? 0), 0) },
    { label: 'Users', legacy: String(T('users').length), imported: `${created} new + ${merged} matched`, ok: created + merged === T('users').length },
  ]
  if (bill?.invoices?.rows.length) {
    const legacyGrand = round2(bill.invoices.rows.reduce((s, r) => s + num(r.grand_total), 0))
    const importedGrand = round2(invoices.reduce((s, i) => s + invoiceTotals(i, next.settings.supplierState).grand, 0))
    checks.push(
      { label: 'Invoices (billing)', legacy: String(bill.invoices.rows.length), imported: String(invoices.length), ok: bill.invoices.rows.length === invoices.length },
      { label: 'Invoice line items', legacy: String(bill.invoice_items?.rows.length ?? 0), imported: String(invoices.reduce((s, i) => s + i.items.length, 0)), ok: (bill.invoice_items?.rows.length ?? 0) === invoices.reduce((s, i) => s + i.items.length, 0) },
      { label: 'Invoice grand totals', legacy: lakh(legacyGrand), imported: lakh(importedGrand), ok: Math.abs(legacyGrand - importedGrand) < 0.05 },
    )
  }

  for (const t of ['login_tokens', 'magic_links', 'trusted_ips']) if (tables[t]) skipped.push(`${t} (${T(t).length} rows) — sign-in secrets are never carried over`)
  skipped.push('users.password, otp_code — the old system stored passwords as plain text; everyone gets a new password')
  for (const [t, v] of Object.entries(tables)) if (!v.rows.length) skipped.push(`${t} — empty in the old CRM`)
  if (T('service_stage_master').length || T('employee_service_stages').length) notes.push('Per-service stage lists (Startup India Certificate, 6 stages) are kept in the original records; the new CRM uses its 9-stage pipeline.')
  notes.push('Uploaded files (payment screenshots, documents, agreements) are not inside the .sql file — after importing, attach them from the old uploads folder in step 4.')

  const report: ImportReport = {
    source: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.rows.length])),
    imported: { clientFiles: bookings.length, payments: paymentsMade, users: created, usersMatched: merged, services: svcAdded, leads: leads.length, notifications: notices.length, documents: bookings.reduce((s, b) => s + b.documents.length, 0), ...(invoices.length ? { invoices: invoices.length } : {}) },
    checks, notes, skipped,
    statusMap: [...statusCount].map(([key, v]) => ({ legacy: key.split('\u0000')[0] || '(empty)', count: v.count, becomes: v.becomes })).sort((a, b) => b.count - a.count),
    roleMap: [...roleCount].map(([legacy, count]) => ({ legacy, count, becomes: ROLE_MAP[legacy.toLowerCase()]?.role ?? 'sales' })).sort((a, b) => b.count - a.count),
  }
  return { next, report }
}
