/**
 * Users from a sheet (IT dashboard → Add users from a sheet): reads the company's user sheets as they are and works
 * out each person's roles, branch and what happens. Pure (no database) — shared by the app (src/lib/bulkUsers.ts) and
 * the tests. Sheets: Name · ID (email = the login) · ROLE · Provide Dashboard · PWD · Branch, any order, several
 * sheets / tables. Passwords are only checked against the rule here — never shown or kept.
 */

/** the CRM's password rule (same as PASSWORD_RULE in src/lib/actions.ts) */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/
export const PASSWORD_HINT = '8–16 characters with upper case, lower case, a number and a symbol.'
const LABEL = { superadmin: 'Super Admin', admin: 'Admin', accounts: 'Accounts', legal: 'Legal', operations: 'Operation Team', teamlead: 'Team Leader', sales: 'Sales Person', hr: 'HR', it: 'IT Support', support: 'Customer Support', branchdirector: 'Branch Director', digitalmedia: 'Digital Media' }
const DEPT = { sales: 'Sales', teamlead: 'Sales', admin: 'Administration', operations: 'Operations', hr: 'HR', legal: 'Legal', accounts: 'Accounts', superadmin: 'Management', branchdirector: 'Management', it: 'IT', support: 'Customer Support', digitalmedia: 'Digital Media' }
const rolesOf = (u) => [u.role, ...(u.extraRoles ?? [])]

const HEAD = { name: /^(full\s*)?name$/i, email: /^(id|e-?mail|email\s*id|login(\s*id)?|user\s*id)$/i, role: /^(role|designation|post)$/i, dash: /dashboard/i, pass: /^(pwd|password|pass)$/i, branch: /^branch$/i }
const EMAIL = /[^\s,;:<>()"']+@[^\s,;:<>()"']+\.[a-z]{2,}/gi
export const titleCase = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())
const key = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Branch names the sheets use for the same branch (code ↔ city). */
export const ALIASES = [
  ['AMD-A', 'Ahmedabad - A', ['AMDA', 'AHMEDABADA']],
  ['AMD-Y', 'Ahmedabad - Y', ['AMDY', 'AHMEDABADY']],
  ['BRD', 'Vadodara', ['BRD', 'VADODARA', 'BARODA']],
]

/** "Provide Dashboard" / "ROLE" words → roles (first = main role, the dashboard they land on). */
export function rolesFrom(dash, role) {
  const out = []
  const add = (r) => { if (!out.includes(r)) out.push(r) }
  for (const raw of String(dash).split(/[,/&+]|\band\b/i).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
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
  const r = String(role).trim().toLowerCase()
  if (/peon|office\s*boy|driver|housekeep/.test(r)) return { roles: [], skip: `${titleCase(role)} — no CRM login` }
  if (!out.length) {
    if (/head of the branch|branch head/.test(r)) { add('teamlead'); add('sales') }
    else if (/team\s*lead/.test(r)) add('teamlead')
    else if (/bde|bdm|sales|intern/.test(r)) add('sales')
  }
  return { roles: out }
}

/**
 * Rows of every sheet (arrays of cells) → the plan.
 * ctx: { users (with email, role, extraRoles, active, id, name), branches (id, code, name, city), me (id, role, extraRoles) }
 */
export function planUsers(sheets, ctx) {
  const rows = []
  const seen = new Map()
  const branches = new Map()
  const newBranches = new Map()
  const known = ctx.branches ?? []
  const branchKey = (v) => {
    const k = key(v)
    if (!k) return undefined
    const alias = ALIASES.find(([code, name, keys]) => keys.includes(k) || key(code) === k || key(name) === k)
    const hit = known.find((b) => [b.code ?? '', b.name, b.city].some((x) => x && (key(x) === k || (alias && (key(x) === key(alias[0]) || key(x) === key(alias[1]) || alias[2].includes(key(x)))))))
    const bkey = alias ? alias[0] : String(v).trim().toUpperCase().replace(/[_\s]+/g, '-')
    if (hit) branches.set(bkey, hit.id)
    else if (!newBranches.has(bkey)) newBranches.set(bkey, { key: bkey, code: alias ? alias[0] : bkey, name: alias ? alias[1] : bkey })
    return bkey
  }
  const active = (ctx.users ?? []).filter((u) => u.active)
  const meSA = rolesOf(ctx.me).includes('superadmin')
  for (const sheet of sheets) {
    let cols = null
    sheet.rows.forEach((cells, i) => {
      const txt = cells.map((c) => String(c ?? '').trim())
      const h = Object.fromEntries(Object.entries(HEAD).map(([k, re]) => [k, txt.findIndex((c) => re.test(c))]))
      if (h.name >= 0 && h.email >= 0) { cols = h; return }
      if (!cols || txt.every((c) => !c)) return
      const get = (k) => (cols[k] >= 0 ? txt[cols[k]] ?? '' : '')
      const rawName = get('name')
      if (!rawName) return
      const name = titleCase(rawName)
      const emails = [...new Set((get('email').match(EMAIL) ?? []).map((e) => e.toLowerCase()))]
      const dash = get('dash'), roleCell = get('role')
      const { roles, skip } = rolesFrom(dash, roleCell)
      const row = {
        line: `${sheet.name} · row ${i + 1}`, name, email: emails[0] ?? '', alsoEmails: emails.slice(1), roles,
        designation: roleCell ? (/^(bde|bdm)( intern)?$/i.test(roleCell.trim()) ? roleCell.trim().toUpperCase().replace('INTERN', 'Intern') : titleCase(roleCell)) : roles[0] ? LABEL[roles[0]] : '',
        department: DEPT[roles[0] ?? 'sales'] ?? 'Sales', password: get('pass'), action: 'create', problems: [], notes: [],
      }
      const paren = dash.match(/\(([^)]+)\)/)?.[1]
      const bv = get('branch') || (roles.includes('branchdirector') ? paren ?? '' : '')
      if (bv) row.branchKey = branchKey(bv)
      row.director = roles.includes('branchdirector')
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
        if (row.password && roles.includes('superadmin') && row.action === 'update' && !meSA) row.notes.push('Only a Super Admin can set a Super Admin’s password — the password is left as it is')
        if (!row.password && row.action === 'update') row.notes.push('No password in the sheet — their password stays')
      }
      rows.push(row)
    })
  }
  // people not in the sheet: you, IT Support accounts, and Super Admins unless a Super Admin is doing this, are kept
  const inSheet = new Set(rows.flatMap((r) => [r.email, ...r.alsoEmails]).filter(Boolean))
  const kept = (u) => u.id === ctx.me.id || rolesOf(u).includes('it') || (rolesOf(u).includes('superadmin') && !meSA)
  const remove = active.filter((u) => !kept(u) && !inSheet.has(u.email.toLowerCase()))
  const keepNote = active.filter((u) => u.id !== ctx.me.id && kept(u) && !inSheet.has(u.email.toLowerCase())).map((u) => u.name)
  return { rows, branches, newBranches: [...newBranches.values()], remove, keepNote }
}

/** A Google Sheets link → its id (and the tab, if the link names one). Only docs.google.com spreadsheet links. */
export function googleSheetId(url) {
  let u
  try { u = new URL(String(url).trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null
  const m = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)
  return m ? m[1] : null
}
