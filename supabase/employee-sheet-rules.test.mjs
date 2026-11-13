import assert from 'node:assert/strict'
import { accountOf, dateOf, emailOf, genderOf, ifscOf, mobileOf, monthOf, planEmployees } from './employee-sheet-rules.mjs'

// cleaning what HR registers contain
assert.equal(dateOf('08-Sep-25'), '2025-09-08'); assert.equal(dateOf('8-Oct-26'), '2026-10-08'); assert.equal(dateOf('02-0ct -26'), '2026-10-02', 'zero typed for O')
assert.equal(dateOf('2026-11-02'), '2026-11-02'); assert.equal(dateOf('05/10/2026'), '2026-10-05'); assert.equal(dateOf('#N/A'), '')
assert.equal(mobileOf('99980 18201'), '9998018201'); assert.equal(mobileOf('+91 98765 43210'), '9876543210'); assert.equal(mobileOf('-'), ''); assert.equal(mobileOf('NA'), '')
assert.equal(emailOf(' Some.One@Example.TEST  '), 'some.one@example.test'); assert.equal(emailOf('NA'), '')
assert.equal(accountOf('0289104000241762'), '0289104000241762', 'leading zeros kept'); assert.equal(accountOf('#N/A'), '')
assert.equal(ifscOf(' sbin0016044 '), 'SBIN0016044'); assert.equal(ifscOf('BARBOBGGBXX'), 'BARB0BGGBXX', 'O typed for 0'); assert.equal(ifscOf('ICICI0000003'), '')
assert.equal(genderOf('FEMALE '), 'Female'); assert.equal(genderOf('MALE'), 'Male'); assert.equal(genderOf(''), '')
assert.equal(monthOf('REXERA ATTENDANCE REPORT - NOV-26.csv'), '2026-11'); assert.equal(monthOf('register oct 2026'), '2026-10')

// a register like the company's (made-up people): a totals row above the headings, day columns 1…5
const head = ['SR. NO.', 'NAME', 'DOJ', 'DEP', 'DESIGNATION', 'BRANCH', 'CTC', 'GENDER', 'OFFCIAL MOBILE NO.', 'PERSONAL MOBILE NO.', 'OFFICE MAIL ID', "PERSONAL MAIL I'D", 'CURRENT ADDRESS', 'BANK NAME ', 'BANK A/C NO.', 'IFSC CODE', 'BASIC', 'PT', 'PF', 'HRA', 'ALLOW', 'ACTUAL PAID SALARY', '1', '2', '3', '4', '5', 'WORKING DAYS']
const sheets = [{ name: 'Sheet1', rows: [
  ['', '', '', '', '', '', '2321400'],
  head,
  ['1', 'TEST PERSON ONE', '08-Sep-25', 'SALES', 'BDM', 'AMD-A', '30000', 'MALE', '98765 43210', '9123456789', 'one@example.test', 'one.home@example.test', '12 Test Road\nAhmedabad', 'AXIS', '917010000000001', 'UTIB0000449', '15000', '200', '1800', '6000', '9000', '27610', 'P', 'P', 'A', 'H', '', '30'],
  ['2', 'TEST PERSON TWO', '02-0ct -26', 'ADMIN', 'OFFICE BOY', 'BRD ', '15000', 'MALE', 'NA', '', 'NA', '#N/A', '#N/A', '', '', '', '14000', '200', '1680', '5600', '8400', '11440', 'P', '', 'P', 'P', 'P', '30'],
  ['3', 'Existing Person', '01-Oct-25', 'SALES', 'BDE', 'AMD-Y', '25000', 'FEMALE', '9000000001', '', 'existing@example.test', '', '', 'SBI', '41286009603', 'SBIN0016044', '14000', '200', '1680', '5600', '8400', '22606', 'P', 'P', 'P', 'P', 'P', '30'],
  ['4', 'TEST PERSON ONE', '08-Sep-25', 'SALES', 'BDM', 'AMD-A', '30000', 'MALE', '', '', 'one@example.test', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
] }]
const users = [{ id: 'u-x', name: 'Existing Person', email: 'existing@example.test', active: true, joinedOn: '2025-10-01', department: 'Sales', designation: 'BDE', salary: 20000, phone: '9000000001' }]
const rows = planEmployees(sheets, { users, privates: {}, month: '2026-11', monthDays: 30 })
assert.equal(rows.length, 4, 'the totals row and the headings are not people')
const [one, two, ex, dup] = rows
assert.equal(one.action, 'new'); assert.equal(one.v.name, 'Test Person One'); assert.equal(one.v.joinedOn, '2025-09-08'); assert.equal(one.v.phone, '9876543210')
assert.equal(one.v.address, '12 Test Road, Ahmedabad'); assert.equal(one.v.bankIfsc, 'UTIB0000449'); assert.equal(one.v.ctc, 30000); assert.equal(one.v.basic, 15000)
assert.deepEqual(one.marks, [{ date: '2026-11-01', mark: 'P' }, { date: '2026-11-02', mark: 'P' }, { date: '2026-11-03', mark: 'A' }, { date: '2026-11-04', mark: 'H' }], 'blank day = no mark')
assert.equal(two.v.joinedOn, '2026-10-02'); assert.equal(two.v.email, ''); assert.equal(two.v.branchKey, 'BRD'); assert.equal(two.v.phone, '')
assert.equal(ex.action, 'update'); assert.equal(ex.userId, 'u-x'); assert.ok(ex.changes.includes('salary (CTC)')); assert.ok(ex.changes.includes('bank')); assert.ok(!ex.changes.includes('mobile'), 'same mobile is not a change')
assert.equal(dup.action, 'skip'); assert.match(dup.problems[0], /Same office email/)
// nothing changed and no marks → unchanged
const same = planEmployees([{ name: 'S', rows: [head, ['1', 'Existing Person', '01-Oct-25', 'SALES', 'BDE', '', '20000', '', '9000000001', '', 'existing@example.test']] }], { users, privates: {}, month: '2026-11' })
assert.equal(same[0].action, 'same')

console.log('✓ employees from HR register: dates, mobiles, emails, bank / IFSC, headings found, attendance marks, matched by email, duplicates, unchanged')
