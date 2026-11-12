import assert from 'node:assert/strict'
import { googleSheetId, planUsers, rolesFrom } from './user-sheet-rules.mjs'

// dashboards → roles (first = main)
assert.deepEqual(rolesFrom('Team Leader Dashbord', 'TEAM LEADER').roles, ['teamlead'])
assert.deepEqual(rolesFrom('Sales Dashboard', 'BDE INTERN').roles, ['sales'])
assert.deepEqual(rolesFrom('Admin , hr , legal , OT ,Accounts', '').roles, ['admin', 'hr', 'legal', 'operations', 'accounts'])
assert.deepEqual(rolesFrom('OT ,admin', '').roles, ['operations', 'admin'])
assert.deepEqual(rolesFrom('TL , Sales person', 'HEAD OF THE BRANCH').roles, ['teamlead', 'sales'])
assert.deepEqual(rolesFrom('Branch dashboard (Vadodara)', '').roles, ['branchdirector'])
assert.deepEqual(rolesFrom('Super Admin', '').roles, ['superadmin'])
assert.ok(rolesFrom('Sales Dashboard', 'PEON').skip, 'a peon gets no login')

// a sheet like the company's: several tables, header rows repeated
const sheets = [{ name: 'AMD_A', rows: [
  ['Name', 'ID', 'ROLE', 'Provide Dashboard', 'PWD', 'branch'],
  ['RAJ TEST', 'raj@example.test', 'TEAM LEADER', 'Team Leader Dashbord', 'Ab_Test@444', 'AMD_A'],
  ['SAM TEST', 'sam@example.test', 'BDE', 'Sales Dashboard', 'Ab_Test@333', 'AMD_A'],
  ['NO PASS', 'nopass@example.test', 'BDE', 'Sales Dashboard', '', 'AMD_A'],
  ['WEAK PASS', 'weak@example.test', 'BDE', 'Sales Dashboard', 'ALLUPPER@99', 'AMD_A'],
  ['', '', '', '', '', ''],
  ['Name', 'ID', 'Provide Dashboard', 'PWD'],
  ['TWO MAILS', 'two@example.test , old@example.test', 'Admin , OT', 'Ab_Test@1234'],
  ['DUP', 'sam@example.test', 'Admin', 'Ab_Test@1234'],
  ['DIRECTOR', 'dir@example.test', 'Branch dashboard (Vadodara)', 'Ab_Test@1234'],
  ['EXISTING', 'old@example.test', 'Admin', ''],
] }]
const users = [
  { id: 'u-old', name: 'Old', email: 'old@example.test', role: 'sales', extraRoles: [], active: true },
  { id: 'u-gone', name: 'Gone', email: 'gone@example.test', role: 'sales', extraRoles: [], active: true },
  { id: 'u-it', name: 'IT', email: 'it@example.test', role: 'it', extraRoles: [], active: true },
  { id: 'u-sa', name: 'SA', email: 'sa@example.test', role: 'superadmin', extraRoles: [], active: true },
]
const plan = planUsers(sheets, { users, branches: [{ id: 'br-1', code: 'AMD-A', name: 'Ahmedabad - A', city: 'Ahmedabad' }], me: { id: 'u-it', role: 'it', extraRoles: [] } })
const row = (n) => plan.rows.find((r) => r.name === n)
assert.equal(row('Raj Test').action, 'create'); assert.equal(row('Raj Test').branchKey, 'AMD-A'); assert.equal(plan.branches.get('AMD-A'), 'br-1', 'existing branch matched by code')
assert.equal(row('Sam Test').designation, 'BDE')
assert.match(row('No Pass').problems[0], /No password/)
assert.match(row('Weak Pass').problems[0], /doesn't meet the rule/)
assert.equal(row('Two Mails').email, 'two@example.test'); assert.match(row('Two Mails').notes[0], /old@example.test stays a separate existing login/)
assert.match(row('Dup').problems[0], /Same email as Sam Test/)
assert.equal(row('Director').director, true); assert.equal(row('Director').branchKey, 'BRD')
assert.deepEqual(plan.newBranches, [{ key: 'BRD', code: 'BRD', name: 'Vadodara' }], 'missing branch added with its city')
assert.equal(row('Existing').action, 'update'); assert.equal(row('Existing').existingId, 'u-old')
// not in the sheet: removed, except IT, the person doing it, and (for IT) Super Admins
assert.deepEqual(plan.remove.map((u) => u.id), ['u-gone'])
assert.deepEqual(plan.keepNote, ['SA'])
// never a password in a message
assert.ok(!JSON.stringify(plan.rows.map((r) => [r.problems, r.notes])).includes('ALLUPPER'))

// Google Sheets links only
assert.equal(googleSheetId('https://docs.google.com/spreadsheets/d/1aVBrQ-kag93OAG-vZSu1Nf-lf-00hU_jc1BtLselZlI/edit?usp=sharing'), '1aVBrQ-kag93OAG-vZSu1Nf-lf-00hU_jc1BtLselZlI')
assert.equal(googleSheetId('http://docs.google.com/spreadsheets/d/1aVBrQ-kag93OAG-vZSu1Nf-lf-00hU_jc1BtLselZlI/edit'), null, 'https only')
assert.equal(googleSheetId('https://evil.example/spreadsheets/d/1aVBrQ-kag93OAG-vZSu1Nf-lf-00hU_jc1BtLselZlI'), null)
assert.equal(googleSheetId('https://docs.google.com/document/d/1aVBrQ-kag93OAG-vZSu1Nf-lf-00hU_jc1BtLselZlI'), null)

console.log('✓ users from a sheet: dashboards → roles, branches, skips with reasons, duplicates, existing users, who is removed, Google links')
