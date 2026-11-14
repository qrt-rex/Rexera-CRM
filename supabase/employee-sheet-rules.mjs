/**
 * HR → Import employees from a sheet (the company's attendance / salary register). Pure — shared by the app
 * (src/lib/employeeImport.ts) and the tests (employee-sheet-rules.test.mjs).
 * Reads any employee sheet: the heading row is found by itself; the CRM's own fields are recognised under many names
 * (KNOWN — Name / Employee Name / First + Last name, DOJ / Date of Joining, Mobile / Contact No., Email ID, A/C No. …),
 * the day columns 1…31 are attendance, and EVERY other column becomes a custom employee field (an existing one when the
 * heading was seen before, else a new one with the type its values have: date, number, email, phone or text).
 * Nothing is dropped: a value that doesn't fit its type is kept as written. Only a row-number column is not stored.
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

/** a heading made comparable: "OFFCIAL MOBILE NO." → "offcialmobileno" */
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
/**
 * The CRM's own employee fields and the many ways sheets name them (tested on the normalised heading). The first
 * column that claims a field wins; a second one (e.g. two "Mobile" columns) becomes its own custom field — nothing
 * is dropped. [field, label, pattern]
 */
export const KNOWN = [
  ['name', 'Name', /^((employee|emp|staff|full|candidate)name|name|nameofemployee|nameofthe(employee|staff))$/],
  ['firstName', 'First name', /^(first|given)name$/],
  ['middleName', 'Middle name', /^middlename$/],
  ['lastName', 'Last name', /^(last|sur|family)name$|^surname$/],
  ['doj', 'Joining date', /^(doj|dateofjoining|joiningdate|joinedon|joindate|dateofjoin|joining)$/],
  ['dep', 'Department', /^(dep|dept|department|departmentname|division|team)$/],
  ['designation', 'Designation', /^(designation|position|jobtitle|title|post|jobrole|designationname)$/],
  ['role', 'Designation (from "Role")', /^role$/],
  ['branch', 'Branch', /^(branch|branchname|branchcode|office|location|worklocation|officelocation)$/],
  ['ctc', 'CTC / salary', /^(ctc|monthlyctc|ctcmonthly|salary|monthlysalary|grosssalary|gross|grosspay)$/],
  ['gender', 'Gender', /^(gender|sex)$/],
  ['officialMobile', 'Mobile (official)', /^(off?i?cial|office|work|company)?(mobile|phone|contact|cell|mob)(no|number|num)?$/],
  ['personalMobile', 'Personal mobile', /^(personal|alternate|alt|other|second|home)(mobile|phone|contact|cell|mob)(no|number|num)?$/],
  ['officeMail', 'Office email', /^(office|official|offcial|work|company)?(e?mail)(id|address)?$/],
  ['personalMail', 'Personal email', /^(personal|alternate|other|home)(e?mail)(id|address)?$/],
  ['address', 'Address', /^(current|residential|present|correspondence)?address$/],
  ['bankName', 'Bank name', /^(bank|bankname|nameofbank)$/],
  ['bankAccount', 'Bank account no.', /^(bank)?(ac|acc|account)(no|number|num)?$|^bankaccount(no|number)?$|^accountno$/],
  ['ifsc', 'IFSC', /^(bank)?ifsc(code)?$/],
  ['basic', 'Basic', /^basic(salary|pay)?$/],
  ['pt', 'Professional tax', /^(pt|professionaltax|proftax)$/],
  ['pf', 'PF', /^(pf|providentfund|epf|pfdeduction)$/],
  ['hra', 'HRA', /^hra$/],
  ['allowance', 'Allowance', /^(allow|allowance|allowances|otherallowance|otherallowances|specialallowance)$/],
  ['uan', 'UAN (PF)', /^(uan|uanno|uannumber|pfuan)$/],
]
/** a row-number column: not employee data, shown in the preview as not stored */
const SERIAL = /^(sr|s|sl|serial)?no$|^(srno|sno|slno|serialno|serialnumber|rowno|sr|sno)$/
export const isDayColumn = (h) => /^\d{1,2}$/.test(String(h ?? '').trim()) && Number(String(h).trim()) >= 1 && Number(String(h).trim()) <= 31

/** The heading row's columns: the CRM fields found, the day columns 1…31, and every other heading (custom). */
export function columnsOf(row) {
  const cells = row.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())
  const out = {}, days = {}, other = [], serial = []
  cells.forEach((c, i) => {
    if (!c) return
    if (isDayColumn(c)) { if (days[Number(c)] === undefined) days[Number(c)] = i; else other.push(i); return }
    const n = norm(c)
    if (SERIAL.test(n)) { serial.push(i); return }
    const hit = KNOWN.find(([k, , re]) => re.test(n) && out[k] === undefined)
    if (hit) out[hit[0]] = i
    else other.push(i)
  })
  // "Role" is the designation only when there is no designation column
  if (out.role !== undefined && out.designation === undefined) { out.designation = out.role; delete out.role } else if (out.role !== undefined) { other.push(out.role); delete out.role }
  return { ...out, days, other, serial }
}
/** Is this the heading row? A name column and at least one more CRM field (or a few headings). */
const isHeading = (c, row) => (c.name !== undefined || (c.firstName !== undefined && c.lastName !== undefined))
  && (Object.keys(c).filter((k) => !['days', 'other', 'serial', 'name', 'firstName', 'lastName', 'middleName'].includes(k)).length >= 1 || row.filter((x) => String(x ?? '').trim()).length >= 3)

// ------------------------------------------------------------------ custom fields
export const FIELD_TYPES = ['text', 'number', 'date', 'email', 'phone']
/** "Date of Birth (DD/MM)" → key "date_of_birth_dd_mm", label "Date Of Birth (DD/MM)" kept as written */
export const fieldKey = (label) => String(label ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field'
const niceLabel = (h) => { const s = String(h ?? '').replace(/\s+/g, ' ').trim(); return s === s.toUpperCase() && /[A-Z]/.test(s) ? titleCase(s).replace(/\bId\b/g, 'ID').replace(/\b(Pan|Uan|Ifsc|Dob|Ctc|Hra)\b/g, (m) => m.toUpperCase()) : s }
/** the type a column's values have (most of them), helped by its heading */
export function detectType(heading, values) {
  const h = norm(heading)
  const vals = values.map((v) => String(v ?? '').trim()).filter((v) => v && cell(v))
  if (!vals.length) return /date|dob|birth/.test(h) ? 'date' : 'text'
  const share = (f) => vals.filter(f).length / vals.length
  // the heading says what it is: half the values fitting is enough (the rest are kept as written)
  if (/date|dob|birth|dt$|anniversary|expiry|validity/.test(h) && share((v) => !!dateOf(v)) >= 0.5) return 'date'
  if (share((v) => /[a-z]/i.test(v) && /\d/.test(v) && !!dateOf(v)) >= 0.8) return 'date'
  if (share((v) => !!emailOf(v) && emailOf(v) === v.toLowerCase()) >= 0.8) return 'email'
  if (/mobile|phone|contact|cell|whatsapp/.test(h) && share((v) => !!mobileOf(v)) >= 0.5) return 'phone'
  // ids, account / Aadhaar / card numbers stay text (leading zeros, no sums)
  if (!/(no|number|id|code|aadha?ar|pan|account|card|pin)$/.test(h) && share((v) => moneyOf(v) !== null) >= 0.8) return 'number'
  return 'text'
}
/** one value cleaned for its field's type; a value that doesn't fit is kept as written (never dropped) → [value, fits] */
export function valueFor(type, raw) {
  const s = cell(raw)
  if (!s) return ['', true]
  if (type === 'date') { const d = dateOf(raw); return d ? [d, true] : [s, false] }
  if (type === 'email') { const e = emailOf(s); return e ? [e, true] : [s, false] }
  if (type === 'phone') { const m = mobileOf(s); return m ? [m, true] : [s, false] }
  if (type === 'number') { const n = moneyOf(s); return n !== null ? [String(n), true] : [s, false] }
  return [s, true]
}
/** different headings for the same employee detail (normalised) — they fill one field, never two */
export const SYNONYMS = [
  ['dob', 'dateofbirth', 'birthdate', 'birthday', 'dobddmmyyyy', 'dateofbirthddmmyyyy'],
  ['empid', 'empcode', 'employeeid', 'employeecode', 'employeeno', 'empno', 'staffid', 'staffcode', 'employeenumber', 'ecode'],
  ['bloodgroup', 'bloodgrp', 'bloodtype'],
  ['fathername', 'fathersname', 'nameoffather', 'fatherhusbandname', 'fathershusbandsname'],
  ['emergencycontact', 'emergencycontactno', 'emergencycontactnumber', 'emergencyno', 'emergencynumber', 'emergencymobile', 'emergencyphone'],
  ['aadhaar', 'aadhar', 'aadhaarno', 'aadharno', 'aadhaarnumber', 'aadharnumber', 'aadhaarcard', 'aadharcard', 'aadharcardno', 'aadhaarcardno', 'uidai'],
  ['pan', 'panno', 'pannumber', 'pancard', 'pancardno'],
  ['permanentaddress', 'permaddress', 'nativeaddress', 'homeaddress'],
  ['maritalstatus', 'married'],
  ['qualification', 'education', 'highestqualification', 'educationalqualification'],
  ['experience', 'experienceyears', 'totalexperience', 'exp', 'workexperience', 'experienceinyears'],
  ['reportingmanager', 'reportingto', 'reportsto', 'manager'],
  ['dateofleaving', 'dol', 'leavingdate', 'lastworkingday', 'exitdate', 'relievingdate'],
]
const groupOf = (n) => SYNONYMS.find((g) => g.includes(n))
/** a field already in the CRM for this heading: same key, same label, a heading seen before, or a synonym of one */
export const findField = (fields, heading) => {
  const k = fieldKey(heading), n = norm(heading), g = groupOf(n)
  return (fields ?? []).find((f) => f.key === k || norm(f.label) === n || (f.aliases ?? []).includes(n))
    ?? (g ? (fields ?? []).find((f) => [norm(f.label), ...(f.aliases ?? [])].some((a) => g.includes(a))) : undefined)
}
/** a column letter: 0 → A, 27 → AB */
export const colLetter = (i) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

/**
 * A sheet saved with ";" / tab / "|" between values arrives as one column per row: split it (simple quoting).
 */
export function splitDelimited(rows) {
  const filled = rows.filter((r) => r.some((c) => String(c ?? '').trim())).slice(0, 15)
  if (!filled.length || !filled.every((r) => r.filter((c) => String(c ?? '').trim()).length === 1)) return rows
  const firsts = filled.map((r) => String(r.find((c) => String(c ?? '').trim())))
  const delim = [';', '\t', '|'].find((d) => firsts.filter((t) => t.includes(d)).length >= Math.ceil(firsts.length * 0.8))
  if (!delim) return rows
  const split = (t) => { const out = []; let cur = '', q = false; for (const ch of t) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
  return rows.map((r) => { const t = r.find((c) => String(c ?? '').trim()); return t === undefined ? r : split(String(t)) })
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
export const planEmployees = (sheets, ctx) => planSheet(sheets, ctx).rows

/**
 * The whole import: { rows, columns, fields }.
 *  - columns: every column of every sheet and where it goes — a CRM field, a custom field (existing or new, with its
 *    type), the attendance day columns, or the row number (not stored). Nothing else is left out.
 *  - fields: the custom fields after this import (existing ones reused, new ones added).
 * ctx: { users, privates (by userId, with .custom), fields (the custom fields already in the CRM), month, monthDays }.
 */
export function planSheet(sheets, ctx) {
  const rows = [], columns = []
  const fields = (ctx.fields ?? []).map((f) => ({ ...f, aliases: [...(f.aliases ?? [])] }))
  const active = (ctx.users ?? []).filter((u) => !u.deletedAt)
  const byEmail = new Map(active.map((u) => [String(u.email).toLowerCase().replace(/#removed-.*$/, ''), u]))
  const byName = new Map()
  for (const u of active) { const k = titleCase(u.name); byName.set(k, byName.has(k) ? null : u) }
  const seenEmail = new Set(), seenName = new Set()
  for (const sheet of sheets) {
    const data = splitDelimited(sheet.rows ?? [])
    const at = data.findIndex((r, i) => i < 25 && isHeading(columnsOf(r), r))
    if (at < 0) continue
    const head = data[at], cols = columnsOf(head)
    const body = data.slice(at + 1)
    // every other column → a custom field: an existing one (same heading) or a new one with the type its values have
    const custom = []
    const width = Math.max(head.length, ...body.map((r) => r.length))
    const headless = []
    for (let i = 0; i < width; i++) if (!String(head[i] ?? '').trim() && body.some((r) => cell(r[i]))) headless.push(i)
    for (const i of [...cols.other, ...headless].sort((a, b) => a - b)) {
      const heading = String(head[i] ?? '').replace(/\s+/g, ' ').trim() || `Column ${colLetter(i)}`
      let f = findField(fields, heading)
      const isNew = !f
      if (!f) {
        let key = fieldKey(heading)
        for (let n = 2; fields.some((x) => x.key === key); n++) key = `${fieldKey(heading)}_${n}`
        f = { key, label: niceLabel(heading), type: detectType(heading, body.map((r) => r[i])), aliases: [norm(heading)], isNew: true }
        fields.push(f)
      } else if (!f.aliases.includes(norm(heading))) f.aliases.push(norm(heading))
      custom.push({ i, field: f })
      columns.push({ sheet: sheet.name, col: colLetter(i), heading, to: 'custom', key: f.key, label: f.label, type: f.type, isNew })
    }
    for (const [k, label] of KNOWN) if (cols[k] !== undefined) columns.push({ sheet: sheet.name, col: colLetter(cols[k]), heading: String(head[cols[k]]).trim(), to: 'crm', key: k, label: k === 'role' ? 'Designation' : label })
    const dayCols = Object.keys(cols.days)
    if (dayCols.length) columns.push({ sheet: sheet.name, col: `${colLetter(Math.min(...Object.values(cols.days)))}–${colLetter(Math.max(...Object.values(cols.days)))}`, heading: `Days ${Math.min(...dayCols.map(Number))}–${Math.max(...dayCols.map(Number))}`, to: 'attendance', label: 'Attendance (P / A / H / L)' })
    for (const i of cols.serial) columns.push({ sheet: sheet.name, col: colLetter(i), heading: String(head[i]).trim(), to: 'serial', label: 'Row number — not stored' })

    body.forEach((cells, j) => {
      const i = at + 1 + j
      const get = (k) => (cols[k] !== undefined ? cells[cols[k]] : '')
      const joined = [get('firstName'), get('middleName'), get('lastName')].map(text).filter(Boolean).join(' ')
      const name = titleCase(text(get('name')) || joined)
      if (!name || /^\d+$/.test(name) || /^(total|grand total|sub ?total)$/i.test(name)) return
      const v = {
        name, joinedOn: dateOf(get('doj')), department: titleCase(text(get('dep'))), designation: text(get('designation')).replace(/\s+/g, ' '),
        branchKey: branchKeyOf(get('branch')), ctc: moneyOf(get('ctc')), gender: genderOf(get('gender')),
        phone: mobileOf(get('officialMobile')), personalPhone: mobileOf(get('personalMobile')), email: emailOf(get('officeMail')), personalEmail: emailOf(get('personalMail')),
        address: text(String(get('address') ?? '').replace(/\s*\n\s*/g, ', ')).replace(/,\s*,/g, ',').replace(/,$/, ''), bankName: (() => { const b = text(get('bankName')); return b.length <= 5 ? b.toUpperCase() : titleCase(b) })(), bankAccount: accountOf(get('bankAccount')), bankIfsc: ifscOf(get('ifsc')),
        basic: moneyOf(get('basic')), hra: moneyOf(get('hra')), allowance: moneyOf(get('allowance')), pf: moneyOf(get('pf')), pt: moneyOf(get('pt')),
        uan: text(get('uan')).replace(/\s+/g, ''), custom: {},
      }
      const unfit = []
      for (const { i: ci, field } of custom) {
        const [val, fits] = valueFor(field.type, cells[ci])
        if (!val) continue
        v.custom[field.key] = val
        if (!fits) unfit.push(field.label)
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
      if (unfit.length) row.notes.push(`Kept as written (not the usual format): ${unfit.join(', ')}`)
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
        diff('UAN', (ctx.uans ?? {})[u.id], v.uan)
        for (const { field } of custom) diff(field.label, (p.custom ?? {})[field.key], v.custom[field.key])
        row.action = row.changes.length || marks.length ? 'update' : 'same'
        if (!u.active) row.notes.push('Removed from the CRM — the record is updated but they stay removed')
      }
      if (row.action === 'new' && !v.joinedOn) row.problems.push('No joining date')
      rows.push(row)
    })
  }
  return { rows, columns, fields }
}
