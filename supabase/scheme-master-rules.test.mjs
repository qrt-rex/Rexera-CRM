import assert from 'node:assert/strict'
import { buildMaster, findMaster, masterProblem, normName, renameInTitle } from './scheme-master-rules.mjs'

assert.equal(normName('Startup India – Seed Fund!'), 'startup india seed fund')
assert.equal(normName('R&D Grant'), 'r and d grant')

// building the master list from the names already in the CRM: same names → one scheme, linked to each list
let n = 0
const id = () => `ms-${++n}`
const sources = [
  { kind: 'service', items: [{ id: 'svc-1', name: 'Seed Fund', category: 'Funding' }, { id: 'svc-2', name: 'PMEGP', category: 'Funding' }, { id: 'svc-3', name: 'ISO 9001', category: 'Certification' }] },
  { kind: 'salesKit', items: [{ id: 'sk-1', name: 'Seed  Fund', category: 'Grant' }, { id: 'sk-2', name: 'Global Impact Challenge', category: 'Grant' }] },
  { kind: 'scheme', items: [{ id: 'sc-1', name: 'pmegp', category: 'Subsidy' }] },
  { kind: 'checker', items: [{ id: 'es-1', name: 'Seed Fund' }] },
]
const r = buildMaster([], sources, id, '2026-11-12T00:00:00Z')
assert.equal(r.added, 4); assert.equal(r.linked, 7)
const seed = findMaster(r.master, 'SEED FUND')
assert.deepEqual([seed.name, seed.category, seed.serviceIds, seed.salesKitIds, seed.checkerIds], ['Seed Fund', 'Grant', ['svc-1'], ['sk-1'], ['es-1']], 'Sales Kit name and category win')
assert.deepEqual(findMaster(r.master, 'PMEGP').schemeIds, ['sc-1'])
// running it again links only what is new
const again = buildMaster(r.master, [...sources, { kind: 'service', items: [{ id: 'svc-4', name: 'Mudra Loan' }] }], id, 'x')
assert.equal(again.added, 1); assert.equal(again.linked, 1); assert.equal(again.master.length, 5)
// old names still find the scheme
assert.equal(findMaster([{ ...seed, name: 'Startup India Seed Fund', aliases: ['Seed Fund'] }], 'seed fund')?.id, seed.id)

// renaming inside CRM entry service names: only whole names
assert.equal(renameInTitle('Seed Fund + PMEGP', 'PMEGP', 'PMEGP 2.0'), 'Seed Fund + PMEGP 2.0')
assert.equal(renameInTitle('Combo 6 months: Seed Fund + PMEGP', 'seed fund', 'Startup India Seed Fund'), 'Combo 6 months: Startup India Seed Fund + PMEGP')
assert.equal(renameInTitle('Seed Fund Plus', 'Seed Fund', 'X'), 'Seed Fund Plus', 'never a part of another name')
assert.equal(renameInTitle('', 'A', 'B'), '')

// names are unique, old names included
const m = [{ id: 'a', name: 'Seed Fund', aliases: ['SISFS'], category: 'Grant' }]
assert.match(masterProblem({ name: 'seed fund', category: 'Grant' }, m), /already has this name/)
assert.match(masterProblem({ name: 'SISFS', category: 'Grant' }, m), /old name/)
assert.equal(masterProblem({ name: 'Seed Fund', category: 'Grant' }, m, 'a'), null, 'its own name is fine')
assert.match(masterProblem({ name: 'X', category: 'Grant' }, m), /name/)

console.log('✓ Scheme Kit master list: names compared, built from the CRM lists, linked once, renamed inside CRM entry names, unique names')
