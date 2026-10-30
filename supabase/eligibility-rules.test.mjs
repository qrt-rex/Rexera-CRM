#!/usr/bin/env node
// Checks for supabase/eligibility-rules.mjs (Rexy's Scheme Checker).   node supabase/eligibility-rules.test.mjs
import assert from 'node:assert/strict'
import { checkEligibility, checkScheme, clientSummary, DEFAULT_SCHEMES, evaluateCondition, msmeClass, schemeProblems, verdict, yearsSince } from './eligibility-rules.mjs'

const T = '2026-10-30'
const by = (results) => Object.fromEntries(results.map((r) => [r.scheme.id.replace('es-', '').toUpperCase(), r]))

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
assert.equal(verdict([{ status: 'pass' }, { status: 'info' }]), 'ELIGIBLE', 'information lines never change the result')
assert.equal(verdict([]), 'POSSIBLE', 'a scheme without conditions is never "eligible"')

// every built-in scheme can be saved as it is (same checks as the editor)
for (const s of DEFAULT_SCHEMES) assert.deepEqual(schemeProblems(s), [], s.name)

// the condition engine: when-rules, unknown values, own texts with {value}
const c = { id: 'x', label: 'Cost', field: 'projectCost', op: 'lte', value: 2e6, otherwise: 'fail', when: [{ field: 'sector', op: 'in', values: ['SERVICES'] }], fail: '{value} is too much' }
assert.equal(evaluateCondition(c, { sector: 'MANUFACTURING', projectCost: 3e6 }, T), null, 'skipped when the when-rule does not hold')
assert.equal(evaluateCondition(c, { sector: 'SERVICES', projectCost: 3e6 }, T).status, 'fail')
assert.equal(evaluateCondition(c, { sector: 'SERVICES', projectCost: 3e6 }, T).reason, '₹30 lakh is too much')
assert.equal(evaluateCondition(c, { projectCost: 3e6 }, T).status, 'unknown', 'while the when-field is unknown a fail is only "to confirm"')
assert.equal(evaluateCondition(c, { sector: 'SERVICES' }, T).status, 'unknown')
assert.equal(evaluateCondition({ ...c, when: [], fail: '' }, { projectCost: 1e6 }, T).reason, '₹10 lakh — Project cost / loan needed at most ₹20 lakh', 'default wording')

// an empty profile never gives "eligible" and rules nothing out
const blank = checkEligibility({}, T)
assert.ok(blank.every((r) => r.status === 'POSSIBLE'))

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
assert.equal(old.SISFS.checks.filter((x) => x.status === 'fail').length, 2, 'age and earlier funding both explained')

// new rural manufacturing unit of a woman entrepreneur: PMEGP with the 35% estimate, Stand-Up India
const woman = by(checkEligibility({
  entity: 'PROPRIETORSHIP', stage: 'NEW', sector: 'MANUFACTURING', projectCost: 2.5e6, age: 34, education: 'PASS_12', category: 'GENERAL', woman: true,
  area: 'RURAL', priorSubsidy: false, defaulter: false,
}, T))
assert.equal(woman.PMEGP.status, 'ELIGIBLE')
assert.ok(woman.PMEGP.checks.some((x) => x.status === 'info' && /35% of ₹25 lakh ≈ ₹8.75 lakh/.test(x.reason)), 'special-category rural rate')
assert.equal(woman.STANDUP.status, 'ELIGIBLE')
assert.equal(woman.MUDRA.status, 'NOT_ELIGIBLE', '₹25 lakh is above Mudra')
assert.equal(woman.SISFS.status, 'NOT_ELIGIBLE', 'a proprietorship cannot be a DPIIT startup')

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
assert.ok(kishore.MUDRA.checks.some((x) => x.status === 'info' && /Kishore/.test(x.reason)))

// the editor's checks
const bad = { name: 'X', summary: 'short', verifiedOn: '', url: 'ftp://x', conditions: [{ label: '', field: 'projectCost', op: 'between', value: 5, value2: 1, otherwise: 'maybe' }] }
const probs = schemeProblems(bad)
for (const re of [/scheme name/, /summary/, /http/, /last checked/, /short name/, /second number/, /mismatch/]) assert.ok(probs.some((x) => re.test(x)), `expected a problem matching ${re}`)
assert.ok(schemeProblems({ ...DEFAULT_SCHEMES[0], conditions: [{ label: 'Bad', field: 'nope', op: 'is', value: true, otherwise: 'fail' }] }).some((x) => /pick what to check/.test(x)))
// an edited copy is checked with its own conditions; inactive schemes are left out
const edited = { ...DEFAULT_SCHEMES[4], conditions: [{ id: 'k', label: 'Loan', field: 'projectCost', op: 'lte', value: 1e6, otherwise: 'fail' }] }
assert.equal(checkScheme(edited, { projectCost: 1.5e6 }, T).status, 'NOT_ELIGIBLE')
assert.equal(checkEligibility({}, T, [{ ...edited, active: false }]).length, 0)
// a limit changed in the editor: the built-in wording follows it ({limit}), nothing still says the old amount
const pmegp = structuredClone(DEFAULT_SCHEMES.find((s) => s.id === 'es-pmegp'))
pmegp.conditions.find((x) => x.field === 'projectCost' && x.when?.[0]?.values?.[0] === 'MANUFACTURING' && x.when[0].op === 'in').value = 6e6
const raised = checkScheme(pmegp, { entity: 'PROPRIETORSHIP', stage: 'NEW', sector: 'MANUFACTURING', projectCost: 5.5e6, age: 30, education: 'GRADUATE', priorSubsidy: false }, T)
assert.equal(raised.status, 'ELIGIBLE')
assert.ok(raised.checks.some((x) => x.reason === '₹55 lakh — within ₹60 lakh (manufacturing)'), 'the text shows the new limit')
for (const s of DEFAULT_SCHEMES) for (const x of s.conditions) assert.ok(!/\{(?!value|limit)/.test(`${x.pass ?? ''}${x.fail ?? ''}${x.ask ?? ''}`), `${s.name}: only {value} and {limit} placeholders`)

// the summary never promises approval and leaves out the schemes that don't fit
const text = clientSummary(checkEligibility({ entity: 'PROPRIETORSHIP', projectCost: 3e5, defaulter: false }, T), 'Asha Foods')
assert.match(text, /Asha Foods/)
assert.match(text, /approval is not guaranteed/)
assert.doesNotMatch(text, /Not eligible/)

console.log('✓ scheme eligibility: condition engine, editor checks, MSME classes, Seed Fund, DPIIT, PMEGP, Mudra, Stand-Up India, CGTMSE, ZED')
