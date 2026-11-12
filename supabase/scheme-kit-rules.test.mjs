import assert from 'node:assert/strict'
import {
  amountOf, canEditSchemes, chargeOf, closingOf, columnsOf, emptyFilter, filterCount, inAmountBand, inChargeBand, kitItems, kitProblem,
  lastDateOf, matches, optionsOf, planSchemeImport, sortItems, tokens,
} from './scheme-kit-rules.mjs'

// who edits schemes: the Operation Team, IT Support, Super Admin — nobody else
assert.ok(canEditSchemes(['operations'])); assert.ok(canEditSchemes(['it'])); assert.ok(canEditSchemes(['sales', 'superadmin']))
assert.ok(!canEditSchemes(['admin'])); assert.ok(!canEditSchemes(['sales', 'teamlead'])); assert.ok(!canEditSchemes([]))

// last dates
assert.equal(lastDateOf('18 Nov 2026'), '2026-11-18'); assert.equal(lastDateOf('5th March, 2027'), '2027-03-05')
assert.equal(lastDateOf('18/11/2026'), '2026-11-18'); assert.equal(lastDateOf('2026-11-18'), '2026-11-18'); assert.equal(lastDateOf('Rolling basis'), null)
const T = '2026-11-12'
assert.equal(closingOf({ lastDate: '15 Nov 2026' }, T), 'week'); assert.equal(closingOf({ lastDate: '1 Dec 2026' }, T), 'month')
assert.equal(closingOf({ lastDate: '1 Jan 2027' }, T), 'open'); assert.equal(closingOf({ lastDate: '1 Nov 2026' }, T), 'closed')
assert.equal(closingOf({ lastDate: 'Rolling basis' }, T), 'rolling')

// amounts and charges
assert.equal(amountOf('Grant up to ₹1.5 Cr (USD 200K); Stage 3: ₹14 Cr'), 14e7)
assert.equal(amountOf('Loan up to Rs 50 lakh at 18% p.a.'), 50e5)
assert.equal(amountOf('INR 10,00,000 seed support'), 1e6)
assert.equal(amountOf('Stage 1 and 2 support'), null, 'bare numbers are not amounts')
assert.ok(inAmountBand(14e7, 'gt10cr')); assert.ok(inAmountBand(50e5, '10l-1cr')); assert.ok(!inAmountBand(50e5, 'lt10l')); assert.ok(!inAmountBand(null, 'lt10l'))
assert.equal(chargeOf('INR 10,000 + 18% GST'), 10000)
assert.ok(inChargeBand('INR 10,000 + 18% GST', 'lt10k')); assert.ok(inChargeBand('', 'free')); assert.ok(!inChargeBand('INR 60,000', '25k-50k'))

// options from free text
assert.deepEqual(tokens('Socially Impactful areas\n● Agriculture/Food Security\n● Health'), ['Socially Impactful areas', 'Agriculture/Food Security', 'Health'])
const items = [
  { id: 'a', category: 'Grant', name: 'Seed Fund', benefits: 'Grant up to ₹20 lakh', sectors: '● Agriculture\n● Health', eligibility: 'Private Limited\nLLP', lastDate: '15 Nov 2026', organisation: 'DPIIT', schemeType: 'Central', applicableFor: 'Pan India', minCharge: 'INR 10,000 + 18% GST', position: 1 },
  { id: 'b', category: 'Loan', name: 'Mudra Loan', benefits: 'Loan up to ₹10 lakh', sectors: 'Manufacturing, Trading', eligibility: 'Proprietorship', lastDate: 'Rolling basis', organisation: 'SIDBI', schemeType: 'Central', applicableFor: 'Pan India', minCharge: 'INR 25,000', position: 1 },
  { id: 'c', category: 'Grant', name: 'Gujarat Startup Grant', benefits: '₹30 lakh', sectors: 'Health', eligibility: 'Private Limited', lastDate: '1 Nov 2026', organisation: 'Govt of Gujarat', schemeType: 'State', applicableFor: 'Gujarat', minCharge: 'INR 15,000', position: 2 },
]
assert.deepEqual(optionsOf(items, 'sectors').map((o) => o.label).slice(0, 2), ['Health', 'Agriculture'])

// advanced filter
const f = (p) => ({ ...emptyFilter(), ...p })
const ids = (p) => items.filter((x) => matches(x, f(p), T)).map((x) => x.id)
assert.deepEqual(ids({}), ['a', 'b', 'c'])
assert.deepEqual(ids({ categories: ['Grant'] }), ['a', 'c'])
assert.deepEqual(ids({ sectors: ['Health'], places: ['Gujarat'] }), ['c'])
assert.deepEqual(ids({ entities: ['Proprietorship'] }), ['b'])
assert.deepEqual(ids({ closing: ['week', 'rolling'] }), ['a', 'b'])
assert.deepEqual(ids({ amount: 'lt10l' }), ['b'])
assert.deepEqual(ids({ charge: 'lt10k' }), ['a'])
assert.deepEqual(ids({ q: 'startup gujarat' }), ['c'], 'every word must match')
assert.equal(filterCount(f({ q: 'x', sectors: ['Health'], amount: 'lt10l' })), 3)
assert.deepEqual(sortItems(items, 'closing', T).map((x) => x.id), ['c', 'a', 'b'])
assert.deepEqual(sortItems(items, 'charge-asc', T).map((x) => x.id), ['a', 'c', 'b'])

// kits: picked by hand + by filter − hidden, in the order picked
assert.deepEqual(kitItems({ schemeIds: ['c', 'a'] }, items, T).map((x) => x.id), ['c', 'a'])
assert.deepEqual(kitItems({ schemeIds: [], filter: f({ categories: ['Grant'] }), excludedIds: ['c'] }, items, T).map((x) => x.id), ['a'])
assert.deepEqual(kitItems({ schemeIds: ['b'], filter: f({ categories: ['Grant'] }) }, items, T).map((x) => x.id), ['b', 'a', 'c'])
assert.match(kitProblem({ name: 'x', schemeIds: ['a'] }, []), /name/)
assert.match(kitProblem({ name: 'Startups', schemeIds: [] }, []), /Pick schemes/)
assert.match(kitProblem({ name: 'Startups', schemeIds: ['a'], shared: true }, [{ id: 'k1', name: 'startups', shared: true, ownerId: 'u1', schemeIds: [] }]), /already exists/)
assert.equal(kitProblem({ name: 'Startups', schemeIds: ['a'], shared: false, ownerId: 'u2' }, [{ id: 'k1', name: 'Startups', shared: false, ownerId: 'u1', schemeIds: [] }]), null, 'two people may each have a kit with the same name')

// importing a sheet like the Sales Kit file (one sheet per category; headings in the first row)
assert.deepEqual(Object.keys(columnsOf(['S.No', 'Scheme Name', 'Benefits', 'Focus Sectors', 'Eligibility Criteria', 'Last Date', 'Funding Organisation', 'Type of Scheme', 'Applicable For', 'Our Minimum Charge (Upfront)'])).sort(),
  ['applicableFor', 'benefits', 'eligibility', 'lastDate', 'minCharge', 'name', 'organisation', 'schemeType', 'sectors'].sort())
const sheet = { name: 'Grant', rows: [
  ['S.No', 'Scheme Name', 'Benefits', 'Focus Sectors', 'Eligibility Criteria', 'Last Date', 'Funding Organisation', 'Type of Scheme', 'Applicable For', 'Our Minimum Charge'],
  [1, 'Seed Fund', 'Grant up to ₹20 lakh', '● Agriculture\n● Health', 'Private Limited\nLLP', '15 Nov 2026', 'DPIIT', 'Central', 'Pan India', 'INR 10,000 + 18% GST'],
  [2, 'Gujarat Startup Grant', '₹40 lakh', 'Health', 'Private Limited', 46357, 'Govt of Gujarat', 'State', 'Gujarat', 'INR 15,000'],
  [3, 'New Scheme', 'Grant ₹5 Cr', '', '', '', 'NITI', '', '', ''],
  [4, 'New Scheme', 'again', '', '', '', '', '', '', ''],
] }
const plan = planSchemeImport([sheet], items)
const by = (n) => plan.find((r) => r.v.name === n && r.action !== 'skip')
assert.equal(by('Seed Fund').action, 'same')
assert.equal(by('Gujarat Startup Grant').action, 'update'); assert.deepEqual(by('Gujarat Startup Grant').changes.sort(), ['benefits', 'lastDate'].sort())
assert.equal(by('Gujarat Startup Grant').v.lastDate, '1 Dec 2026', 'Excel date numbers become dates (46357 = 1 Dec 2026)')
assert.equal(by('New Scheme').action, 'new'); assert.equal(by('New Scheme').v.category, 'Grant', 'category from the sheet name'); assert.equal(by('New Scheme').v.lastDate, 'Rolling basis')
assert.equal(plan.filter((r) => r.action === 'skip').length, 1, 'listed twice')
// a tab called "Sheet1" says nothing: the category picked in the preview is used; an existing scheme keeps its category
const generic = planSchemeImport([{ ...sheet, name: 'Sheet1' }], items, { defaultCategory: 'Loan' })
assert.equal(generic.find((r) => r.v.name === 'New Scheme' && r.action === 'new').v.category, 'Loan')
assert.ok(generic.find((r) => r.v.name === 'New Scheme' && r.action === 'new').fromDefault)
assert.ok(!generic.find((r) => r.v.name === 'Gujarat Startup Grant').changes.includes('category'))

console.log('✓ schemes: only Operations / IT / Super Admin edit, last dates, amounts, charges, advanced filters, sorting, Scheme Kits, sheet import')
