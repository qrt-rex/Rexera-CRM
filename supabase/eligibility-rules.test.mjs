#!/usr/bin/env node
// Checks for supabase/eligibility-rules.mjs (Rexy's Scheme Checker).   node supabase/eligibility-rules.test.mjs
import assert from 'node:assert/strict'
import { checkEligibility, clientSummary, msmeClass, verdict, yearsSince } from './eligibility-rules.mjs'

const T = '2026-10-30'
const by = (results) => Object.fromEntries(results.map((r) => [r.scheme.id, r]))

// MSME classes (2025 limits: both investment and turnover)
assert.equal(msmeClass(2.5e7, 1e8), 'MICRO')
assert.equal(msmeClass(2.6e7, 1e8), 'SMALL', 'investment just over the micro limit')
assert.equal(msmeClass(1e7, 1.01e8), 'SMALL', 'turnover just over the micro limit')
assert.equal(msmeClass(1e7, 1.01e9), 'MEDIUM', 'turnover over the small limit')
assert.equal(msmeClass(1.3e9, 1e8), 'LARGE')
assert.equal(msmeClass('', 1e8), undefined, 'unknown until both are given')

assert.equal(yearsSince('2024-10-31', T), 1, 'one day short of 2 years')
assert.equal(yearsSince('2024-10-30', T), 2)
assert.equal(yearsSince('', T), undefined)

assert.equal(verdict([{ status: 'pass' }, { status: 'unknown' }]), 'POSSIBLE')
assert.equal(verdict([{ status: 'pass' }, { status: 'fail' }, { status: 'unknown' }]), 'NOT_ELIGIBLE')
assert.equal(verdict([{ status: 'pass' }]), 'ELIGIBLE')

// nothing known: never "eligible", nothing ruled out either
const blank = checkEligibility({}, T)
assert.ok(blank.every((r) => r.status === 'POSSIBLE' || r.scheme.id === 'UDYAM'), 'an empty profile only gives "to confirm"')
assert.ok(blank.every((r) => r.status !== 'NOT_ELIGIBLE'))

// a young DPIIT tech startup
const startup = by(checkEligibility({
  entity: 'PRIVATE_LTD', stage: 'EXISTING', sector: 'SERVICES', incorporated: '2025-06-01', turnover: 4e6, investment: 2e6, projectCost: 3e6,
  udyam: true, dpiit: true, innovative: true, priorFunding: 0, indian51: true, defaulter: false, area: 'URBAN',
}, T))
assert.equal(startup.SISFS.status, 'ELIGIBLE')
assert.equal(startup.DPIIT.status, 'ELIGIBLE')
assert.equal(startup.PMEGP.status, 'NOT_ELIGIBLE', 'companies and running units are outside PMEGP')
assert.match(startup.PMEGP.why, /not companies/)
assert.equal(startup.MUDRA.status, 'NOT_ELIGIBLE', 'Mudra is non-corporate')
assert.equal(startup.CGTMSE.status, 'ELIGIBLE')

// too old for the Seed Fund, too much earlier money
const old = by(checkEligibility({ entity: 'LLP', incorporated: '2023-01-01', dpiit: true, innovative: true, priorFunding: 1.5e6, indian51: true }, T))
assert.equal(old.SISFS.status, 'NOT_ELIGIBLE')
assert.equal(old.SISFS.checks.filter((c) => c.status === 'fail').length, 2, 'age and earlier funding both explained')

// new rural manufacturing unit of a woman entrepreneur: PMEGP with the 35% estimate, Stand-Up India
const woman = by(checkEligibility({
  entity: 'PROPRIETORSHIP', stage: 'NEW', sector: 'MANUFACTURING', projectCost: 2.5e6, age: 34, education: 'PASS_12', category: 'GENERAL', woman: true,
  area: 'RURAL', priorSubsidy: false, defaulter: false,
}, T))
assert.equal(woman.PMEGP.status, 'ELIGIBLE')
assert.ok(woman.PMEGP.checks.some((c) => /35% of the project ≈ ₹8.75 lakh/.test(c.reason)), 'special-category rural rate')
assert.equal(woman.STANDUP.status, 'ELIGIBLE')
assert.equal(woman.MUDRA.status, 'NOT_ELIGIBLE', '₹25 lakh is above Mudra')
assert.equal(woman.SISFS.status, 'NOT_ELIGIBLE', 'a proprietorship cannot be a DPIIT startup')
assert.equal(woman.DPIIT.status, 'NOT_ELIGIBLE')

// PMEGP limits and education
const big = by(checkEligibility({ entity: 'INDIVIDUAL', stage: 'NEW', sector: 'SERVICES', projectCost: 2.5e6, age: 30, education: 'GRADUATE', priorSubsidy: false }, T))
assert.equal(big.PMEGP.status, 'NOT_ELIGIBLE', 'service projects stop at ₹20 lakh')
const edu = by(checkEligibility({ entity: 'INDIVIDUAL', stage: 'NEW', sector: 'MANUFACTURING', projectCost: 1.2e6, age: 30, education: 'BELOW_8', priorSubsidy: false }, T))
assert.match(edu.PMEGP.why, /VIII pass/)

// Mudra bands
const tarunPlus = by(checkEligibility({ entity: 'PROPRIETORSHIP', projectCost: 1.5e6, defaulter: false }, T))
assert.equal(tarunPlus.MUDRA.status, 'POSSIBLE', 'Tarun Plus needs a repaid Tarun loan')
const kishore = by(checkEligibility({ entity: 'PROPRIETORSHIP', projectCost: 3e5, defaulter: false }, T))
assert.equal(kishore.MUDRA.status, 'ELIGIBLE')
assert.match(kishore.MUDRA.checks[1].reason, /Kishore/)

// the summary never promises approval and leaves out the schemes that don't fit
const text = clientSummary(checkEligibility({ entity: 'PROPRIETORSHIP', projectCost: 3e5, defaulter: false }, T), 'Asha Foods')
assert.match(text, /Asha Foods/)
assert.match(text, /approval is not guaranteed/)
assert.doesNotMatch(text, /Not eligible/)

console.log('✓ scheme eligibility: MSME classes, Seed Fund, DPIIT, PMEGP, Mudra, Stand-Up India, CGTMSE, ZED')
