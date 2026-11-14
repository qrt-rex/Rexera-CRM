import type { Branch, DB, User } from './types'
import { getDb } from './store'
import { createUser, removeEmployee, resetUserPassword, saveBranches, updateUser } from './actions'
import { roleLabel, rolesOf } from './rbac'
import { today, uid } from './format'
import { googleSheetId, planUsers as plan0, type Plan } from '../../supabase/user-sheet-rules.mjs'
import { getSupabase } from './supabase'
import { CLOUD } from './cloud'

export type { Plan, PlanRow, NewBranch } from '../../supabase/user-sheet-rules.mjs'

/**
 * IT Support → Add users from a sheet. Reads the company's user sheets as they are (Name · ID (email) · ROLE ·
 * Provide Dashboard · PWD · Branch — any order, several sheets / tables), works out each person's roles, branch and
 * what happens (new / update / skipped, and why — supabase/user-sheet-rules.mjs), and applies it. People not in the
 * sheet can be removed (reversible: Employees → Restore). Passwords go straight to Supabase sign-in (encrypted) and are
 * never shown or stored here.
 */
export const planUsers = (sheets: { name: string; rows: unknown[][] }[], d: DB, me: User): Plan =>
  plan0(sheets, { users: d.users, branches: d.settings.branches ?? [], me })

/** A Google Sheets link → the same sheets, read by the CRM server (the sheet must be shared "anyone with the link"). */
export async function readGoogleSheet(url: string, purpose: 'users' | 'schemes' | 'employees' = 'users'): Promise<{ name: string; rows: unknown[][] }[]> {
  if (!googleSheetId(url)) throw new Error('Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…).')
  if (!CLOUD) throw new Error('Reading a Google Sheet goes through the live CRM server — on this copy, download the sheet as .xlsx and choose the file.')
  const token = (await (await getSupabase()).auth.getSession()).data.session?.access_token ?? ''
  const res = await fetch('/api/users/sheet', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url, purpose }) }).catch(() => null)
  const j = (await res?.json().catch(() => null)) as { success?: boolean; message?: string; xlsx?: string } | null
  if (!res?.ok || !j?.success || !j.xlsx) throw new Error(j?.message || 'Could not read the Google Sheet.')
  const bytes = Uint8Array.from(atob(j.xlsx), (c) => c.charCodeAt(0))
  return readSheets(new File([bytes], 'google-sheet.xlsx'))
}
/** Reads an .xlsx / .xls / .csv file into sheets of cell rows. */
export async function readSheets(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import('xlsx')
  // a CSV is read as written: the library would read "12/01/2024" as 1 December (US); our rules read dd/mm (India)
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', ...(/\.(csv|txt|tsv)$/i.test(file.name) ? { raw: true } : {}) })
  return wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, defval: '', blankrows: false }) }))
}

export interface ApplyResult { line: string; name: string; ok: boolean; message: string }
const usernameFor = (d: DB, email: string) => {
  const base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user'
  const taken = new Set(d.users.filter((u) => u.active).map((u) => u.username.toLowerCase()))
  let n = base, i = 2
  while (taken.has(n)) n = `${base}${i++}`
  return n
}

/**
 * Applies the plan: new branches, each person (new / update), team leaders per branch, then removes the people chosen.
 * One person failing never stops the rest; every result is listed.
 */
export async function applyUsers(me: User, plan: Plan, opts: { removeIds: string[]; teamLeads: Record<string, string>; welcome: boolean }, progress: (done: number, total: number) => void): Promise<ApplyResult[]> {
  const out: ApplyResult[] = []
  const todo = plan.rows.filter((r) => r.action !== 'skip')
  const total = todo.length + opts.removeIds.length + (plan.newBranches.length ? 1 : 0)
  let done = 0
  // 1. branches the sheet names that the CRM doesn't have yet
  const branchId = new Map(plan.branches)
  if (plan.newBranches.length) {
    const cur = getDb().settings.branches ?? []
    const made: Branch[] = plan.newBranches.map((b) => ({ id: uid('br-'), name: b.name, code: b.code, address: '', city: b.name === b.code ? '' : b.name.replace(/\s*-\s*\w$/, ''), state: b.name === b.code ? '' : 'Gujarat', pin: '', gstin: '', phone: '', email: '' }))
    try { saveBranches(me, [...cur, ...made]); made.forEach((b, i) => branchId.set(plan.newBranches[i]!.key, b.id)); out.push({ line: 'Branches', name: made.map((b) => b.code).join(', '), ok: true, message: 'Branch added (add its address and GSTIN in Access → Settings)' }) }
    catch (e) { out.push({ line: 'Branches', name: plan.newBranches.map((b) => b.code).join(', '), ok: false, message: (e as Error).message }) }
    progress(++done, total)
  }
  // 2. each person
  for (const r of todo) {
    const [main, ...extra] = r.roles
    const bid = r.branchKey ? branchId.get(r.branchKey) : undefined
    const place = { branchId: bid, ...(r.director && bid ? { branchIds: [bid] } : {}) }
    try {
      if (r.action === 'create') {
        await createUser(me, { name: r.name, username: usernameFor(getDb(), r.email), email: r.email, phone: '', role: main!, department: r.department, designation: r.designation, ...place }, r.password, undefined, { phoneOptional: true, noWelcome: !opts.welcome })
        const u = getDb().users.find((x) => x.active && x.email.toLowerCase() === r.email)
        if (u && extra.length) updateUser(me, u.id, { extraRoles: extra })
        out.push({ line: r.line, name: r.name, ok: true, message: `Created · ${r.roles.map(roleLabel).join(' + ')}` })
      } else {
        const u = getDb().users.find((x) => x.id === r.existingId)!
        updateUser(me, u.id, { name: r.name, role: main!, extraRoles: extra, department: r.department, designation: r.designation, ...place })
        const pw = r.password && !(rolesOf({ ...u, role: main!, extraRoles: extra }).includes('superadmin') && !rolesOf(me).includes('superadmin'))
        if (pw) await resetUserPassword(me, u.id, r.password)
        out.push({ line: r.line, name: r.name, ok: true, message: `Updated · ${r.roles.map(roleLabel).join(' + ')}${pw ? ' · new password' : ''}` })
      }
    } catch (e) { out.push({ line: r.line, name: r.name, ok: false, message: (e as Error).message }) }
    progress(++done, total)
  }
  // 3. team leader for the sales people of each branch (only those without one)
  for (const [bkey, tlEmail] of Object.entries(opts.teamLeads)) {
    if (!tlEmail) continue
    const d = getDb()
    const tl = d.users.find((u) => u.active && u.email.toLowerCase() === tlEmail)
    const bid = branchId.get(bkey)
    if (!tl || !bid) continue
    let n = 0
    for (const r of todo.filter((x) => x.branchKey === bkey && x.roles[0] === 'sales')) {
      const u = getDb().users.find((x) => x.active && x.email.toLowerCase() === r.email)
      if (u && !u.teamLeadId && u.id !== tl.id) { try { updateUser(me, u.id, { teamLeadId: tl.id }); n++ } catch { /* listed below if it matters */ } }
    }
    out.push({ line: `Team ${bkey}`, name: tl.name, ok: true, message: `Team Leader of ${n} sales person(s) in ${bkey}` })
  }
  // 4. people not in the sheet (reversible: Employees → Restore)
  for (const id of opts.removeIds) {
    const u = getDb().users.find((x) => x.id === id)
    try { if (u?.active) removeEmployee(me, id, today(), 'Not in the new user list (bulk import)'); out.push({ line: 'Removed', name: u?.name ?? id, ok: true, message: 'Removed — can be restored in Employees' }) }
    catch (e) { out.push({ line: 'Removed', name: u?.name ?? id, ok: false, message: (e as Error).message }) }
    progress(++done, total)
  }
  return out
}
