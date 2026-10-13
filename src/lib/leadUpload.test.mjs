#!/usr/bin/env node
/** Check for src/lib/leadUpload.ts (lead sheet upload).   node src/lib/leadUpload.test.mjs */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { autoMap, checkRows, cleanPhone, sheetTime } = await vite.ssrLoadModule('/src/lib/leadUpload.ts')
await vite.close()

// columns from the old CRM's web-form sheets map by name
const headers = ['Time Stamp', 'Client Name', 'Phone / Mobile', 'Email Address', 'Company', 'Business Type', 'Industry', 'Annual Turnover', 'Funding Amount', 'Funding Category', 'Message / Notes', 'IP Address', 'Submitted Page']
const m = autoMap(headers)
assert.deepEqual([m.formAt, m.name, m.phone, m.email, m.company, m.businessType, m.industry, m.turnover, m.fundingAmount, m.fundingCategory, m.notes],
  ['Time Stamp', 'Client Name', 'Phone / Mobile', 'Email Address', 'Company', 'Business Type', 'Industry', 'Annual Turnover', 'Funding Amount', 'Funding Category', 'Message / Notes'])

// an unnamed column full of phone numbers is found by its values
const odd = autoMap(['Person', 'Col B'], [{ Person: 'A', 'Col B': '9876543210' }, { Person: 'B', 'Col B': '+91 98765 43211' }])
assert.equal(odd.phone, 'Col B')

// phones end up as the CRM's 10 digits
assert.equal(cleanPhone('+91 98765-43210'), '9876543210')
assert.equal(cleanPhone('09876543210'), '9876543210')
assert.equal(cleanPhone('9.87654321E+09'), '9876543210')
assert.equal(cleanPhone('12345'), '')
assert.equal(cleanPhone('5876543210'), '') // Indian mobiles start 6–9

// sheet dates: Excel serial numbers and Indian day/month order
assert.equal(sheetTime('46000')?.slice(0, 10), '2025-12-09') // Excel day 45658 = 1 Jan 2025
assert.equal(new Date(sheetTime('13/10/2026 10:15')).getDate(), 13)
assert.equal(sheetTime('not a date'), undefined)

// rows: valid · invalid · duplicate (in the CRM, or earlier in the file); extra columns kept, IP dropped
const rows = [
  { 'Client Name': 'Amit', 'Phone / Mobile': '9876543210', 'Email Address': 'NA', Industry: 'Retail', 'IP Address': '1.2.3.4', 'Submitted Page': '/grants' },
  { 'Client Name': 'Repeat', 'Phone / Mobile': '+91 9876543210' },
  { 'Client Name': '', 'Phone / Mobile': '9876500000' },
  { 'Client Name': 'Old', 'Phone / Mobile': '9000000001' },
  { 'Client Name': 'Bad', 'Phone / Mobile': '12' },
]
const out = checkRows(rows, m, { phones: new Set(['9000000001']), emails: new Set() }, 'leads oct.xlsx')
assert.deepEqual(out.map((r) => r.status), ['Valid', 'Duplicate', 'Invalid', 'Duplicate', 'Invalid'])
assert.equal(out[0].lead.email, '', 'placeholder emails are dropped, not invalid')
assert.equal(out[0].lead.source, 'Uploaded: leads oct', 'source defaults to the file')
assert.deepEqual(out[0].lead.extra, { 'Submitted Page': '/grants' }, 'unmapped columns kept, IP left out')
assert.match(out[0].lead.requirement, /Industry: Retail/)
console.log('✓ lead upload: columns, phones, dates and row checks')
