/**
 * HR → Import employees from a sheet (the company's attendance / salary register). Pure — shared by the app
 * (src/lib/employeeImport.ts) and the tests (employee-sheet-rules.test.mjs).
 * Reads every row as it is: Name, DOJ, DEP, Designation, Branch, CTC, Gender, official / personal mobile, office /
 * personal mail, address, bank name / account / IFSC, Basic, PT, PF, HRA, Allow, and the day columns 1…31 (P / A / H).
 * Cleans what such sheets contain: "#N/A", "NA", "-" as empty; "02-0ct -26" dates; "99980 18201" mobiles; stray spaces.
 * Matches people already in the CRM by office email, else by name (only when exactly one person has it).
 */

const EMPTY = /^(#?n\/?a|na|nil|none|-+|0)$/i
/** a cell as text: trimmed, single-spaced, "" for #N/A / NA / - */
export const cell = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return EMPTY.test(s) && s !== '0' ? '' : s === '0' ? '0' : s }
const text = (v) => { const s = cell(v); return s === '0' ? '' : s }
export const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())

/** "08-Sep-25", "8-Oct-26", "02-0ct -26", "2026-10-08", "08/10/2026", an Excel day number → yyyy-mm-dd (or ''). */
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export function dateOf(v) {
  const raw = String(v ?? '').trim()
  if (/^\d{5}(\.\d+)?$/.test(raw)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86_400_000); return d.toISOString().slice(0, 10) }
  const s = raw.toLowerCase().replace(/(\d)\s*-\s*0ct/, '$1-oct').replace(/\s+/g, '')
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  if ((m = s.match(/^(\d{1,2})[-/.]([a-z]{3,9})[-/.,]?(\d{2,4})$/))) {
    const i = MON.indexOf(m[2].slice(0, 3))
    if (i < 0) return ''
    return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(i + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}
/** a 10-digit Indian mobile, or '' ("99980 18201", "+91 98…", "0 98…") */
export function mobileOf(v) {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}
export const emailOf = (v) => { const m = String(v ?? '').trim().toLowerCase().match(/[^\s,;<>()"']+@[^\s,;<>()"']+\.[a-z]{2,}/); return m ? m[0] : '' }
export const moneyOf = (v) => { const s = String(v ?? '').replace(/[,₹\s]/g, ''); if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null; return Number(s) }
/** bank account numbers are kept as text (leading zeros matter); only digits (and letters for a few banks) */
export const accountOf = (v) => { const s = text(v).replace(/\s+/g, ''); return /^[0-9A-Z]{6,20}$/i.test(s) ? s.toUpperCase() : '' }
/** IFSC: 4 letters, 0, 6 letters / digits — sheets often type O for 0 in the 5th place ("BARBOBGGBXX") */
export function ifscOf(v) {
  let s = text(v).replace(/\s+/g, '').toUpperCase()
  if (s.length === 11 && s[4] === 'O') s = s.slice(0, 4) + '0' + s.slice(5)
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? s : ''
}
export const genderOf = (v) => { const s = text(v).toLowerCase(); return s.startsWith('f') ? 'Female' : s.startsWith('m') ? 'Male' : '' }
export const branchKeyOf = (v) => { const s = text(v).toUpperCase().replace(/[\s_]+/g, '-').replace(/-+$/, ''); return s }

const HEAD = {
  name: /^name$/i, doj: /^(doj|date of joining|joining date)$/i, dep: /^(dep|dept|department)$/i, designation: /^designation$/i, branch: /^branch$/i,
  ctc: /^ctc$/i, gender: /^gender$/i, officialMobile: /off(i)?cial mobile/i, personalMobile: /personal mobile/i, officeMail: /office mail/i, personalMail: /personal mail/i,
  address: /address/i, bankName: /^bank name/i, bankAccount: /bank a\/?c|account no/i, ifsc: /ifsc/i,
  basic: /^basic$/i, pt: /^pt$/i, pf: /^pf$/i, hra: /^hra$/i, allowance: /^allow/i, paid: /actual paid/i,
}
/** The header row's columns, including the day columns 1…31. */
export function columnsOf(row) {
  const cells = row.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())
  const out = {}
  for (const [k, re] of Object.entries(HEAD)) { const i = cells.findIndex((c) => re.test(c)); if (i >= 0) out[k] = i }
  const days = {}
  cells.forEach((c, i) => { if (/^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 31 && days[Number(c)] === undefined) days[Number(c)] = i })
  return { ...out, days }
}

/** The month of the attendance columns from a file name / title: "… NOV-26" → 2026-11. */
export function monthOf(name) {
  const m = String(name ?? '').toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-_']*(\d{2,4})\b/)
  if (!m) return ''
  const y = m[2].length === 2 ? `20${m[2]}` : m[2]
  return `${y}-${String(MON.indexOf(m[1]) + 1).padStart(2, '0')}`
}

/**
 * Sheets → one row per person: the cleaned values, attendance marks for `month`, and what happens (new / update /
 * same / skip) against the people in the CRM. `ctx`: { users, privates (by userId), month, monthDays }.
 */
export function planEmployees(sheets, ctx) {
  const rows = []
  const active = (ctx.users ?? []).filter((u) => !u.deletedAt)
  const byEmail = new Map(active.map((u) => [String(u.email).toLowerCase().replace(/#removed-.*$/, ''), u]))
  const byName = new Map()
  for (const u of active) { const k = titleCase(u.name); byName.set(k, byName.has(k) ? null : u) }
  const seenEmail = new Set(), seenName = new Set()
  for (const sheet of sheets) {
    let cols = null
    sheet.rows.forEach((cells, i) => {
      const c = columnsOf(cells)
      if (c.name !== undefined && (c.doj !== undefined || c.designation !== undefined)) { cols = c; return }
      if (!cols) return
      const get = (k) => (cols[k] !== undefined ? cells[cols[k]] : '')
      const name = titleCase(text(get('name')))
      if (!name || /^\d+$/.test(name)) return
      const v = {
        name, joinedOn: dateOf(get('doj')), department: titleCase(text(get('dep'))), designation: text(get('designation')).replace(/\s+/g, ' '),
        branchKey: branchKeyOf(get('branch')), ctc: moneyOf(get('ctc')), gender: genderOf(get('gender')),
        phone: mobileOf(get('officialMobile')), personalPhone: mobileOf(get('personalMobile')), email: emailOf(get('officeMail')), personalEmail: emailOf(get('personalMail')),
        address: text(String(get('address') ?? '').replace(/\s*\n\s*/g, ', ')).replace(/,\s*,/g, ',').replace(/,$/, ''), bankName: (() => { const b = text(get('bankName')); return b.length <= 5 ? b.toUpperCase() : titleCase(b) })(), bankAccount: accountOf(get('bankAccount')), bankIfsc: ifscOf(get('ifsc')),
        basic: moneyOf(get('basic')), hra: moneyOf(get('hra')), allowance: moneyOf(get('allowance')), pf: moneyOf(get('pf')), pt: moneyOf(get('pt')),
      }
      // attendance: P / A / H in the day columns of the chosen month (blank = no mark)
      const marks = []
      if (ctx.month) for (const [day, col] of Object.entries(cols.days)) {
        const d = Number(day)
        if (d > (ctx.monthDays ?? 31)) continue
        const m = text(cells[col]).toUpperCase()
        const mark = m === 'P' ? 'P' : m === 'A' ? 'A' : m === 'H' || m === 'HD' || m === '1/2' ? 'H' : m === 'L' || m === 'CL' || m === 'SL' ? 'L' : ''
        if (mark) marks.push({ date: `${ctx.month}-${String(d).padStart(2, '0')}`, mark })
      }
      const row = { line: `${sheet.name} · row ${i + 1}`, v, marks, action: 'new', changes: [], problems: [], notes: [] }
      // problems that make a value unusable (the rest of the row still comes in)
      if (!v.joinedOn && text(get('doj'))) row.notes.push(`Joining date “${text(get('doj'))}” not understood — left as it is`)
      if (text(get('officialMobile')) && !v.phone) row.notes.push(`Official mobile “${text(get('officialMobile'))}” is not a 10-digit number — left out`)
      if (text(get('bankAccount')) && !v.bankAccount) row.notes.push('Bank account number not understood — left out')
      if (text(get('ifsc')) && !v.bankIfsc) row.notes.push(`IFSC “${text(get('ifsc'))}” is not a valid IFSC — left out`)
      // who it is
      let u = v.email ? byEmail.get(v.email) : undefined
      if (!u) { const n = byName.get(name); if (n) { u = n; if (v.email && n.email.toLowerCase() !== v.email) row.notes.push(`Matched by name — their CRM login stays ${n.email}`) } }
      if (v.email && seenEmail.has(v.email)) { row.action = 'skip'; row.problems.push(`Same office email as an earlier row (${v.email})`) }
      else if (!v.email && seenName.has(name)) { row.action = 'skip'; row.problems.push('Same name as an earlier row') }
      if (v.email) seenEmail.add(v.email); seenName.add(name)
      if (row.action !== 'skip' && u) {
        row.userId = u.id
        const p = (ctx.privates ?? {})[u.id] ?? {}
        const diff = (label, a, b) => { if (b !== '' && b !== null && b !== undefined && String(a ?? '') !== String(b)) row.changes.push(label) }
        diff('joining date', u.joinedOn, v.joinedOn); diff('department', u.department, v.department); diff('designation', u.designation, v.designation)
        diff('salary (CTC)', u.salary, v.ctc); diff('mobile', u.phone, v.phone); diff('address', u.address?.line, v.address)
        diff('gender', p.gender, v.gender); diff('personal mobile', p.personalPhone, v.personalPhone); diff('personal email', p.personalEmail, v.personalEmail)
        diff('bank', `${p.bankName ?? ''}|${p.bankAccount ?? ''}|${p.bankIfsc ?? ''}`, v.bankAccount || v.bankIfsc || v.bankName ? `${v.bankName}|${v.bankAccount}|${v.bankIfsc}` : '')
        diff('salary breakup', [p.basic, p.hra, p.allowance, p.pf, p.pt].join('|'), v.basic === null && v.hra === null ? '' : [v.basic, v.hra, v.allowance, v.pf, v.pt].map((x) => x ?? '').join('|'))
        row.action = row.changes.length || marks.length ? 'update' : 'same'
        if (!u.active) row.notes.push('Removed from the CRM — the record is updated but they stay removed')
      }
      if (row.action === 'new' && !v.joinedOn) row.problems.push('No joining date')
      rows.push(row)
    })
  }
  return rows
}
