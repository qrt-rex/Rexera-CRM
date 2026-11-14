import type { AttendanceMark, Branch, DB, EmployeePrivate, Role, User } from './types'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { effectivePerms, isMaster } from './rbac'
import { nowIso, uid } from './format'
import { branchKeyOf, planEmployees, planSheet } from '../../supabase/employee-sheet-rules.mjs'

/**
 * HR → Import employees from a sheet (HR's attendance / salary register). The preview (planEmployeeImport) shows every
 * person — new, update (with the fields that change) or unchanged — and their attendance marks; Apply writes it in
 * one save: employee details on the person, private details (gender, personal contacts, bank, salary parts) in the
 * private register, attendance marks for the month. Roles and logins are never changed; new people get no login
 * (IT gives a password when they need one). HR (employees.manage), Super Admin, IT Support.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
export const canImportEmployees = (d: DB, me: User) => isMaster(me) || effectivePerms(d, me).has('employees.manage')

export type EmployeeRow = ReturnType<typeof planEmployees>[number]
export type EmployeePlan = ReturnType<typeof planSheet>
const daysIn = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()

/** The preview: every person, every column and where it goes, and the custom fields (existing + new). */
export function planEmployeeImport(sheets: { name: string; rows: unknown[][] }[], d: DB, month: string): EmployeePlan {
  const privates = Object.fromEntries((d.employeePrivate ?? []).map((p) => [p.userId, p]))
  const uans = Object.fromEntries((d.pfAccounts ?? []).filter((a) => a.uan).map((a) => [a.userId, a.uan]))
  return planSheet(sheets, { users: d.users, privates, uans, fields: d.settings.employeeFields ?? [], month, monthDays: month ? daysIn(month) : 31 })
}

/** Branch codes in the sheet → the CRM's branches (a branch not there yet is added: AMD-A, AMD-Y, BRD …). */
const BRANCH_NAMES: Record<string, string> = { 'AMD-A': 'Ahmedabad-A (Head Office)', 'AMD-Y': 'Ahmedabad - Y', BRD: 'Vadodara' }
/** other names a sheet uses for a branch: the head office (AMD) is Ahmedabad-A */
const SAME_AS: Record<string, string> = { AMD: 'AMD-A', 'HEAD-OFFICE': 'AMD-A', 'AHMEDABAD-HEAD-OFFICE': 'AMD-A', 'AMD-HEAD-OFFICE': 'AMD-A' }
export const canonBranch = (k: string) => SAME_AS[k] ?? k
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
export function branchPlan(d: DB, rows: EmployeeRow[]) {
  const known = d.settings.branches ?? []
  const keys = [...new Set(rows.map((r) => r.v.branchKey).filter(Boolean))]
  const found = new Map<string, string>(), missing: string[] = []
  for (const k of keys) {
    const c = canonBranch(k)
    const hit = known.find((b) => [b.code ?? '', b.name].some((x) => key(x) === key(c) || (BRANCH_NAMES[c] && key(x) === key(BRANCH_NAMES[c]!))))
    if (hit) found.set(k, hit.id); else if (!missing.includes(c)) missing.push(c)
  }
  return { found, missing }
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'employee'

/**
 * Applies the preview. `roleFor`: the CRM role a new person is given, by department (they can't sign in until IT gives
 * them a password, so the role only matters then). Answers what was done.
 */
export function applyEmployeeImport(me: User, plan: EmployeePlan, month: string, roleFor: Record<string, Role>) {
  const d0 = getDb()
  assert(canImportEmployees(d0, me), 'Importing employees is for HR, Super Admin and IT Support.')
  const todo = plan.rows.filter((r) => r.action === 'new' || r.action === 'update')
  const { found, missing } = branchPlan(d0, todo)
  // UAN goes to PF Management when the importer may change PF records; otherwise it is kept as a custom field
  const pfOk = isMaster(me) || effectivePerms(d0, me).has('payroll.manage')
  return mutate((d) => {
    const at = nowIso()
    // custom fields: the new ones are added, existing ones learn the headings used this time (never duplicated)
    const fields = [...(d.settings.employeeFields ?? [])]
    let newFields = 0
    for (const f of plan.fields) {
      const cur = fields.find((x) => x.key === f.key)
      if (cur) { const aliases = [...new Set([...(cur.aliases ?? []), ...f.aliases])]; if (aliases.length !== (cur.aliases ?? []).length) Object.assign(cur, { aliases }) }
      else { fields.push({ key: f.key, label: f.label, type: f.type, aliases: f.aliases, createdAt: at, createdBy: me.id }); newFields++ }
    }
    if (!pfOk && todo.some((r) => r.v.uan) && !fields.some((x) => x.key === 'uan')) { fields.push({ key: 'uan', label: 'UAN (PF)', type: 'text', aliases: ['uan'], createdAt: at, createdBy: me.id }); newFields++ }
    if (JSON.stringify(fields) !== JSON.stringify(d.settings.employeeFields ?? [])) d.settings.employeeFields = fields
    // branches the sheet names that the CRM doesn't have yet
    if (missing.length) {
      const made: Branch[] = missing.map((k) => ({ id: uid('br-'), code: k, name: BRANCH_NAMES[k] ?? k, address: '', city: (BRANCH_NAMES[k] ?? '').replace(/\s*[-(].*$/, ''), state: BRANCH_NAMES[k] ? 'Gujarat' : '', pin: '', gstin: '', phone: '', email: '' }))
      d.settings.branches = [...(d.settings.branches ?? []), ...made]
      made.forEach((b, i) => found.set(missing[i]!, b.id))
      // the sheet's other names for a branch just added (AMD → AMD-A)
      for (const r of todo) { const k = r.v.branchKey; if (k && !found.has(k) && found.has(canonBranch(k))) found.set(k, found.get(canonBranch(k))!) }
    }
    d.employeePrivate ??= []
    d.attendanceMarks ??= []
    const usernames = new Set(d.users.map((u) => u.username.toLowerCase()))
    const emails = new Set(d.users.map((u) => u.email.toLowerCase()))
    let added = 0, updated = 0, marks = 0
    for (const r of todo) {
      const v = r.v
      let u = r.userId ? d.users.find((x) => x.id === r.userId) : undefined
      if (!u) {
        // a new employee: no login until IT gives a password; office email, or a marked placeholder
        let base = slug(v.email ? v.email.split('@')[0]! : v.name), name = base, i = 2
        while (usernames.has(name)) name = `${base}${i++}`
        usernames.add(name)
        let email = v.email || `${slug(v.name)}@no-email.local`
        for (let j = 2; emails.has(email); j++) email = `${slug(v.name)}${j}@no-email.local`
        emails.add(email)
        const role = roleFor[v.department] ?? (/sales/i.test(v.department) ? 'sales' : 'support')
        u = {
          id: uid('u-'), name: v.name, username: name, email, phone: v.phone, role, extraRoles: [], grants: [], denies: [],
          department: v.department || 'General', designation: v.designation, joinedOn: v.joinedOn || at.slice(0, 10), active: true, passHash: '', needsPasswordReset: true,
        }
        d.users.push(u)
        added++
      } else updated++
      // employee details (roles, login and email never change here)
      if (v.joinedOn) u.joinedOn = v.joinedOn
      if (v.department) u.department = v.department
      if (v.designation) u.designation = v.designation
      if (v.phone) u.phone = v.phone
      if (v.ctc != null) u.salary = v.ctc
      if (v.address) u.address = { line: v.address, city: u.address?.city ?? '', state: u.address?.state ?? '', pin: u.address?.pin ?? '', country: u.address?.country ?? 'India' }
      const b = v.branchKey ? found.get(branchKeyOf(v.branchKey)) ?? found.get(v.branchKey) : undefined
      if (b) u.branchId = b
      // private details: only what the sheet has (an empty cell never wipes)
      let p = d.employeePrivate.find((x) => x.userId === u!.id)
      if (!p) { p = { userId: u.id }; d.employeePrivate.push(p) }
      const put = <K extends keyof EmployeePrivate>(k: K, val: EmployeePrivate[K] | null | '') => { if (val !== null && val !== '' && val !== undefined) p![k] = val as EmployeePrivate[K] }
      put('gender', v.gender); put('personalPhone', v.personalPhone); put('personalEmail', v.personalEmail)
      put('bankName', v.bankName); put('bankAccount', v.bankAccount); put('bankIfsc', v.bankIfsc)
      put('ctc', v.ctc); put('basic', v.basic); put('hra', v.hra); put('allowance', v.allowance); put('pf', v.pf); put('pt', v.pt)
      // every other column of the sheet (custom fields); an empty cell never wipes what is there
      const extra = { ...v.custom, ...(v.uan && !pfOk ? { uan: v.uan } : {}) }
      if (Object.keys(extra).length) p.custom = { ...(p.custom ?? {}), ...extra }
      p.updatedAt = at; p.updatedBy = me.id
      if (v.uan && pfOk) {
        d.pfAccounts ??= []
        const a = d.pfAccounts.find((x) => x.userId === u!.id)
        if (a) a.uan = v.uan; else d.pfAccounts.push({ userId: u.id, uan: v.uan, enrolled: true })
      }
      // attendance marks of the month (a blank day leaves what is there)
      for (const m of r.marks) {
        const id = `${u.id}|${m.date}`
        const cur = d.attendanceMarks.find((x) => x.id === id)
        if (cur) { if (cur.mark !== m.mark) { cur.mark = m.mark; cur.source = 'import'; cur.updatedAt = at; cur.updatedBy = me.id; marks++ } }
        else { d.attendanceMarks.push({ id, userId: u.id, date: m.date, mark: m.mark, source: 'import', updatedAt: at, updatedBy: me.id } as AttendanceMark); marks++ }
      }
    }
    d.audit.unshift({ id: uid('a-'), at, by: me.id, action: 'EMPLOYEE_IMPORT', detail: `Employees from HR's register: ${added} added, ${updated} updated, ${marks} attendance mark(s) for ${month || '—'}${newFields ? ` · ${newFields} new employee field(s): ${plan.fields.filter((f) => f.isNew).map((f) => f.label).join(', ')}` : ''}${missing.length ? ` · branches added: ${missing.join(', ')}` : ''}` })
    return { added, updated, marks, branches: missing, newFields }
  })
}
