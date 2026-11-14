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

// ---------------------------------------------------------------- any sheet: every column kept (custom fields)
const { planSheet, detectType, valueFor, splitDelimited, columnsOf, fieldKey } = await import('./employee-sheet-rules.mjs')
assert.equal(columnsOf(['Employee Name', 'Date of Joining', 'Contact No.', 'Email ID', 'A/C No.', 'IFSC Code', 'Location']).officialMobile, 2)
assert.deepEqual(Object.keys(columnsOf(['S.No', 'Full Name', 'Dept', 'Role'])).filter((k) => !['days', 'other', 'serial'].includes(k)).sort(), ['dep', 'designation', 'name'], '"Role" is the designation when there is none')
assert.equal(detectType('Date of Birth', ['12/03/1995', '1-Jan-90', '']), 'date')
assert.equal(detectType('Aadhaar No', ['1234 5678 9012', '234567890123']), 'text', 'id numbers stay text')
assert.equal(detectType('Experience (years)', ['3', '5.5', '']), 'number')
assert.equal(detectType('Emergency Contact', ['98765 43210', '9123456789']), 'phone')
assert.equal(detectType('Blood Group', ['B+', 'O-']), 'text')
assert.deepEqual(valueFor('date', 'not sure'), ['not sure', false], 'a value that does not fit is kept as written')
assert.deepEqual(valueFor('date', '12/03/1995'), ['1995-03-12', true])
assert.equal(fieldKey('Date of Birth (DD/MM)'), 'date_of_birth_dd_mm')
const other = [{ name: 'Staff', rows: [
  ['Company staff list'], [],
  ['S.No', 'First Name', 'Last Name', 'Emp ID', 'Dept', 'Designation', 'Date of Birth', 'Contact No.', 'Email ID', 'Blood Group', 'Aadhaar No', 'Emergency Contact', 'UAN', '', 'Permanent Address'],
  ['1', 'nina', 'shah', 'RX-101', 'sales', 'BDE', '05-Jun-1996', '98250 11111', 'nina@example.test', 'B+', '1234 5678 9012', '9123456789', '100200300400', 'night shift', 'Plot 4, Test Nagar'],
  ['2', 'Existing', 'Person', 'RX-102', 'Sales', 'BDE', 'not sure', '9000000001', 'existing@example.test', 'O+', '', '', '', '', ''],
  ['', 'Total', '', '', '', '', '', '', '', '', '', '', '', '', ''],
] }]
const known = [{ key: 'blood_group', label: 'Blood group', type: 'text', aliases: ['bloodgroup'] }]
const p2 = planSheet(other, { users, privates: { 'u-x': { custom: { blood_group: 'O+' } } }, fields: known, month: '' })
assert.equal(p2.rows.length, 2, 'heading found below a title; the Total row is not a person')
const [nina, exi] = p2.rows
assert.equal(nina.v.name, 'Nina Shah', 'first + last name'); assert.equal(nina.v.phone, '9825011111'); assert.equal(nina.v.email, 'nina@example.test'); assert.equal(nina.v.uan, '100200300400')
assert.deepEqual(nina.v.custom, { emp_id: 'RX-101', date_of_birth: '1996-06-05', blood_group: 'B+', aadhaar_no: '1234 5678 9012', emergency_contact: '9123456789', column_n: 'night shift', permanent_address: 'Plot 4, Test Nagar' })
assert.equal(exi.userId, 'u-x'); assert.equal(exi.v.custom.date_of_birth, 'not sure'); assert.ok(exi.notes.some((n) => /Kept as written.*Date Of Birth/i.test(n)))
assert.ok(!exi.changes.includes('Blood group'), 'same value: no change'); assert.ok(exi.changes.includes('Emp ID'))
const byHeading = Object.fromEntries(p2.columns.map((c) => [c.heading, c]))
assert.equal(byHeading['Blood Group'].isNew, false, 'an existing field is reused, never duplicated'); assert.equal(byHeading['Blood Group'].key, 'blood_group')
assert.equal(byHeading['Date of Birth'].type, 'date'); assert.equal(byHeading['Date of Birth'].isNew, true)
assert.equal(byHeading['Column N'].to, 'custom', 'a column with data but no heading is kept too')
assert.equal(byHeading['S.No'].to, 'serial'); assert.equal(byHeading['Contact No.'].to, 'crm'); assert.equal(byHeading.UAN.key, 'uan')
assert.equal(p2.fields.filter((f) => f.key === 'blood_group').length, 1)
assert.deepEqual(p2.fields.find((f) => f.key === 'blood_group').aliases, ['bloodgroup'])
// a later sheet names the same details differently: the same fields are filled, none duplicated
const later = planSheet([{ name: 'S2', rows: [['Name', 'Department', 'DOB', 'Employee ID', 'Blood Grp'], ['Nina Shah', 'Sales', '1996-06-05', 'RX-101', 'B+']] }], { users, fields: p2.fields, month: '' })
assert.deepEqual(later.columns.filter((c) => c.to === 'custom').map((c) => `${c.heading}→${c.key}:${c.isNew}`), ['DOB→date_of_birth:false', 'Employee ID→emp_id:false', 'Blood Grp→blood_group:false'])
assert.equal(later.fields.length, p2.fields.length, 'no new fields')
// ";" CSV that arrives as one column
const semi = splitDelimited([['Name;Department;Mobile'], ['"Shah, Ravi";Sales;9876500000']])
assert.deepEqual(semi[1], ['Shah, Ravi', 'Sales', '9876500000'])
assert.equal(planSheet([{ name: 'csv', rows: [['Name;Department;Mobile'], ['Ravi Shah;Sales;9876500000']] }], { users, month: '' }).rows[0].v.phone, '9876500000')

console.log('✓ employees from HR register: dates, mobiles, emails, bank / IFSC, headings found, attendance marks, matched by email, duplicates, unchanged')
console.log('✓ any employee sheet: heading found, CRM fields under many names, every other column a custom field (typed, reused, kept as written), ; CSV')
