import type { Branch, DB, Role, User } from './types'
import { getDb } from './store'
import { createUser, PASSWORD_HINT, PASSWORD_RULE, removeEmployee, resetUserPassword, saveBranches, updateUser } from './actions'
import { roleLabel, rolesOf } from './rbac'
import { today, uid } from './format'

/**
 * IT Support → Add users from a sheet. Reads the company's user sheets as they are (Name · ID (email) · ROLE ·
 * Provide Dashboard · PWD · Branch — any order, several sheets / tables), works out each person's roles, branch and
 * what happens (new / update / skipped, and why), and applies it. People not in the sheet can be removed (reversible:
 * Employees → Restore). Passwords go straight to Supabase sign-in (encrypted) and are never shown or stored here.
 */
export interface PlanRow {
  line: string; name: string; email: string; alsoEmails: string[]
  roles: Role[]; designation: string; department: string
  branchKey?: string; director?: boolean
  password: string; action: 'create' | 'update' | 'skip'; existingId?: string
  problems: string[]; notes: string[]
}
export interface NewBranch { key: string; code: string; name: string }
export interface Plan { rows: PlanRow[]; branches: Map<string, string>; newBranches: NewBranch[]; remove: User[]; keepNote: string[] }

const HEAD = { name: /^(full\s*)?name$/i, email: /^(id|e-?mail|email\s*id|login(\s*id)?|user\s*id)$/i, role: /^(role|designation|post)$/i, dash: /dashboard/i, pass: /^(pwd|password|pass)$/i, branch: /^branch$/i }
const EMAIL = /[^\s,;:<>()"']+@[^\s,;:<>()"']+\.[a-z]{2,}/gi
const titleCase = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Branch names the sheets use for the same branch (code ↔ city). */
const ALIASES: [string, string, string[]][] = [
  ['AMD-A', 'Ahmedabad - A', ['AMDA', 'AHMEDABADA']],
  ['AMD-Y', 'Ahmedabad - Y', ['AMDY', 'AHMEDABADY']],
  ['BRD', 'Vadodara', ['BRD', 'VADODARA', 'BARODA']],
]

/** "Provide Dashboard" / "ROLE" words → roles (first = main role, the dashboard they land on). */
function rolesFrom(dash: string, role: string): { roles: Role[]; skip?: string } {
  const out: Role[] = []
  const add = (r: Role) => { if (!out.includes(r)) out.push(r) }
  for (const raw of dash.split(/[,/&+]|\band\b/i).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const t = raw.replace(/\(.*\)/, '').trim()
    if (/super\s*admin/.test(t)) add('superadmin')
    else if (/branch/.test(t)) add('branchdirector')
    else if (/team\s*lead|^tl$/.test(t)) add('teamlead')
    else if (/sales/.test(t)) add('sales')
    else if (/^admin/.test(t)) add('admin')
    else if (/^hr\b|human/.test(t)) add('hr')
    else if (/legal/.test(t)) add('legal')
    else if (/^ot$|operation/.test(t)) add('operations')
    else if (/account/.test(t)) add('accounts')
    else if (/^it\b/.test(t)) add('it')
    else if (/support/.test(t)) add('support')
    else if (/digital|media/.test(t)) add('digitalmedia')
  }
  const r = role.trim().toLowerCase()
  if (/peon|office\s*boy|driver|housekeep/.test(r)) return { roles: [], skip: `${titleCase(role)} — no CRM login` }
  if (!out.length) {
    if (/head of the branch|branch head/.test(r)) { add('teamlead'); add('sales') }
    else if (/team\s*lead/.test(r)) add('teamlead')
    else if (/bde|bdm|sales|intern/.test(r)) add('sales')
  }
  return { roles: out }
}
const DEPT: Partial<Record<Role, string>> = { sales: 'Sales', teamlead: 'Sales', admin: 'Administration', operations: 'Operations', hr: 'HR', legal: 'Legal', accounts: 'Accounts', superadmin: 'Management', branchdirector: 'Management', it: 'IT', support: 'Customer Support', digitalmedia: 'Digital Media' }

/** Rows of every sheet (arrays of cells) → the plan. */
export function planUsers(sheets: { name: string; rows: unknown[][] }[], d: DB, me: User): Plan {
  const rows: PlanRow[] = []
  const seen = new Map<string, string>()
  const branches = new Map<string, string>()       // branch key → existing branch id
  const newBranches = new Map<string, NewBranch>()
  const known = d.settings.branches ?? []
  const branchKey = (v: string) => {
    const k = key(v)
    if (!k) return undefined
    const alias = ALIASES.find(([code, name, keys]) => keys.includes(k) || key(code) === k || key(name) === k)
    const hit = known.find((b) => [b.code ?? '', b.name, b.city].some((x) => x && (key(x) === k || (alias && (key(x) === key(alias[0]) || key(x) === key(alias[1]) || alias[2].includes(key(x)))))))
    const bkey = alias ? alias[0] : v.trim().toUpperCase().replace(/[_\s]+/g, '-')
    if (hit) branches.set(bkey, hit.id)
    else if (!newBranches.has(bkey)) newBranches.set(bkey, { key: bkey, code: alias ? alias[0] : bkey, name: alias ? alias[1] : bkey })
    return bkey
  }
  const active = d.users.filter((u) => u.active)
  for (const sheet of sheets) {
    let cols: Record<keyof typeof HEAD, number> | null = null
    sheet.rows.forEach((cells, i) => {
      const txt = cells.map((c) => String(c ?? '').trim())
      // a header row (each table in the sheet can start with its own)
      const h = Object.fromEntries(Object.entries(HEAD).map(([k, re]) => [k, txt.findIndex((c) => re.test(c))])) as Record<keyof typeof HEAD, number>
      if (h.name >= 0 && h.email >= 0) { cols = h; return }
      if (!cols || txt.every((c) => !c)) return
      const c = cols as Record<keyof typeof HEAD, number>
      const get = (k: keyof typeof HEAD) => (c[k] >= 0 ? txt[c[k]] ?? '' : '')
      const rawName = get('name')
      if (!rawName) return
      const name = titleCase(rawName)
      const emails = [...new Set((get('email').match(EMAIL) ?? []).map((e) => e.toLowerCase()))]
      const dash = get('dash'), roleCell = get('role')
      const { roles, skip } = rolesFrom(dash, roleCell)
      const row: PlanRow = {
        line: `${sheet.name} · row ${i + 1}`, name, email: emails[0] ?? '', alsoEmails: emails.slice(1), roles,
        designation: roleCell ? (/^(bde|bdm)( intern)?$/i.test(roleCell.trim()) ? roleCell.trim().toUpperCase().replace('INTERN', 'Intern') : titleCase(roleCell)) : roles[0] ? roleLabel(roles[0]) : '',
        department: DEPT[roles[0] ?? 'sales'] ?? 'Sales', password: get('pass'), action: 'create', problems: [], notes: [],
      }
      // branch: the Branch column, or "(Vadodara)" in "Branch dashboard (Vadodara)"
      const paren = dash.match(/\(([^)]+)\)/)?.[1]
      const bv = get('branch') || (roles.includes('branchdirector') ? paren ?? '' : '')
      if (bv) row.branchKey = branchKey(bv)
      row.director = roles.includes('branchdirector')
      // checks
      if (skip) { row.action = 'skip'; row.problems.push(skip) }
      else if (!row.email) { row.action = 'skip'; row.problems.push(`No login email (“${get('email') || 'empty'}”)`) }
      else if (!roles.length) { row.action = 'skip'; row.problems.push(`Can't tell the dashboard from “${dash || roleCell}”`) }
      else if (seen.has(row.email)) { row.action = 'skip'; row.problems.push(`Same email as ${seen.get(row.email)} — one email is one login; give this person their own email`) }
      if (row.action !== 'skip') {
        seen.set(row.email, `${name} (${row.line})`)
        const ex = active.find((u) => u.email.toLowerCase() === row.email)
        if (ex) { row.action = 'update'; row.existingId = ex.id }
        if (row.alsoEmails.length) row.notes.push(`Also listed: ${row.alsoEmails.join(', ')} — logs in with ${row.email}; ${row.alsoEmails.map((e) => active.some((u) => u.email.toLowerCase() === e) ? `${e} stays a separate existing login` : `${e} is not used`).join('; ')}`)
        if (row.password && !PASSWORD_RULE.test(row.password)) { row.problems.push(`Password doesn't meet the rule (${PASSWORD_HINT}) — change it in the sheet`); row.action = 'skip' }
        else if (!row.password && row.action === 'create') { row.problems.push('No password in the sheet'); row.action = 'skip' }
        const isSA = rolesOf(me).includes('superadmin')
        if (row.password && roles.includes('superadmin') && row.action === 'update' && !isSA) row.notes.push('Only a Super Admin can set a Super Admin’s password — the password is left as it is')
        if (!row.password && row.action === 'update') row.notes.push('No password in the sheet — their password stays')
      }
      rows.push(row)
    })
  }
  // people not in the sheet (IT Support accounts and you are always kept)
  const inSheet = new Set(rows.flatMap((r) => [r.email, ...r.alsoEmails]).filter(Boolean))
  // kept: you, IT Support accounts, and Super Admins unless a Super Admin is doing this (only they can remove one)
  const meSA = rolesOf(me).includes('superadmin')
  const kept = (u: User) => u.id === me.id || rolesOf(u).includes('it') || (rolesOf(u).includes('superadmin') && !meSA)
  const remove = active.filter((u) => !kept(u) && !inSheet.has(u.email.toLowerCase()))
  const keepNote = active.filter((u) => u.id !== me.id && kept(u) && !inSheet.has(u.email.toLowerCase())).map((u) => u.name)
  return { rows, branches, newBranches: [...newBranches.values()], remove, keepNote }
}

/** Reads an .xlsx / .xls / .csv file into sheets of cell rows. */
export async function readSheets(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
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
