// Government scheme eligibility — the rules behind Rexy's Scheme Checker (sales people check a client on the call).
// A PRELIMINARY check: it says which schemes the client looks eligible for, may be eligible for (something is not
// known yet), or is not eligible for — and why. The bank / agency decides; nothing here guarantees approval.
//
// The schemes are DATA, edited by Super Admin and the Operation team in Scheme Checker Rules (table
// eligibility_schemes). Each scheme has conditions — "field op value" (e.g. project cost ≤ ₹50 lakh), optionally only
// when other conditions hold (e.g. only for manufacturing) — plus benefits, documents, how to apply, a subsidy
// calculator and loan bands. DEFAULT_SCHEMES below is the built-in set the CRM starts with, as the government
// published it when checked on DEFAULTS_CHECKED:
//  * MSME classes — S.O. 1364(E), 21 Mar 2025, from 1 Apr 2025: micro ≤ ₹2.5 cr investment and ≤ ₹10 cr turnover,
//    small ≤ ₹25 cr / ₹100 cr, medium ≤ ₹125 cr / ₹500 cr (exports left out of turnover).
//  * DPIIT startup — G.S.R. 108(E), 4 Feb 2026: up to 10 years from incorporation (deep tech 20), turnover ≤ ₹200 cr
//    (deep tech ₹300 cr); private limited, LLP, registered partnership and co-operative society.
//  * Seed Fund (SISFS) — DPIIT-recognised, incorporated < 2 years before applying, technology in the core product,
//    ≤ ₹10 lakh earlier government money; grant ≤ ₹20 lakh, debt / convertibles ≤ ₹50 lakh, through incubators.
//  * PMEGP (KVIC) — new units; project ≤ ₹50 lakh manufacturing / ≤ ₹20 lakh service; VIII pass above ₹10 / ₹5 lakh;
//    margin money 15 / 25 % (general, urban / rural), 25 / 35 % (special categories).
//  * PM Mudra — non-corporate micro units; Shishu ≤ ₹50k, Kishore ≤ ₹5 lakh, Tarun ≤ ₹10 lakh, Tarun Plus
//    ₹10–20 lakh (only after repaying a Tarun loan).
//  * Stand-Up India — SC / ST and / or woman, 18+, greenfield, ₹10 lakh – ₹1 crore, 51 % holding in a firm / company.
//  * CGTMSE — micro and small enterprises, collateral-free credit guaranteed up to ₹10 crore (from 1 Apr 2025).
//  * MSME ZED — Udyam-registered MSMEs; subsidy on certification cost 80 / 60 / 50 % (micro / small / medium).
export const DEFAULTS_CHECKED = '2026-10-30'

const LAKH = 1e5, CRORE = 1e7
export const ENTITIES = [
  { id: 'INDIVIDUAL', label: 'Individual (no business yet)' }, { id: 'PROPRIETORSHIP', label: 'Proprietorship' },
  { id: 'PARTNERSHIP', label: 'Registered partnership' }, { id: 'LLP', label: 'LLP' }, { id: 'PRIVATE_LTD', label: 'Private limited company' },
  { id: 'PUBLIC_LTD', label: 'Public limited company' }, { id: 'COOPERATIVE', label: 'Co-operative society' }, { id: 'OTHER', label: 'Trust / society / other' },
]
export const SECTORS = [{ id: 'MANUFACTURING', label: 'Manufacturing' }, { id: 'SERVICES', label: 'Services' }, { id: 'TRADING', label: 'Trading' }, { id: 'AGRI_ALLIED', label: 'Agri-allied (dairy, poultry, fisheries…)' }]
export const STAGES = [{ id: 'IDEA', label: 'Idea / not started' }, { id: 'NEW', label: 'New unit being set up' }, { id: 'EXISTING', label: 'Running business' }]
export const EDUCATION = [{ id: 'BELOW_8', label: 'Below VIII' }, { id: 'PASS_8', label: 'VIII pass' }, { id: 'PASS_10', label: 'X pass' }, { id: 'PASS_12', label: 'XII pass' }, { id: 'GRADUATE', label: 'Graduate or above' }]
export const CATEGORIES = [
  { id: 'GENERAL', label: 'General' }, { id: 'OBC', label: 'OBC' }, { id: 'SC', label: 'SC' }, { id: 'ST', label: 'ST' }, { id: 'MINORITY', label: 'Minority' },
  { id: 'EX_SERVICEMEN', label: 'Ex-servicemen' }, { id: 'PWD', label: 'Person with disability' }, { id: 'TRANSGENDER', label: 'Transgender' },
]
export const AREAS = [{ id: 'URBAN', label: 'Urban' }, { id: 'RURAL', label: 'Rural' }]
export const MSME_CLASSES = [{ id: 'MICRO', label: 'Micro' }, { id: 'SMALL', label: 'Small' }, { id: 'MEDIUM', label: 'Medium' }, { id: 'LARGE', label: 'Large (above MSME limits)' }]
/** Special categories for PMEGP-style subsidies (a woman entrepreneur counts too). */
export const SPECIAL_CATEGORIES = ['OBC', 'SC', 'ST', 'MINORITY', 'EX_SERVICEMEN', 'PWD', 'TRANSGENDER']
export const STATUS = {
  ELIGIBLE: { label: 'Eligible', tone: 'green' },
  POSSIBLE: { label: 'Potentially eligible', tone: 'amber' },
  NOT_ELIGIBLE: { label: 'Not eligible', tone: 'red' },
}

/**
 * What a condition can test: the details the sales person fills in, plus a few worked out from them (derived).
 * money is in rupees (typed in lakh), years in whole years.
 */
export const FIELDS = {
  entity: { label: 'Entity type', type: 'select', options: ENTITIES },
  stage: { label: 'Stage', type: 'select', options: STAGES },
  sector: { label: 'Activity', type: 'select', options: SECTORS },
  area: { label: 'Location', type: 'select', options: AREAS },
  education: { label: 'Education', type: 'select', options: EDUCATION },
  category: { label: 'Social category', type: 'select', options: CATEGORIES },
  msmeClass: { label: 'MSME class (from investment and turnover)', type: 'select', options: MSME_CLASSES, derived: true },
  udyam: { label: 'Udyam registered', type: 'bool' },
  dpiit: { label: 'DPIIT recognised', type: 'bool' },
  innovative: { label: 'Innovative / tech-based product', type: 'bool' },
  woman: { label: 'Woman entrepreneur', type: 'bool' },
  reserved51: { label: 'SC / ST / women hold 51%+', type: 'bool' },
  indian51: { label: 'Indian promoters hold 51%+', type: 'bool' },
  priorSubsidy: { label: 'Took a government subsidy before', type: 'bool' },
  defaulter: { label: 'Loan default', type: 'bool' },
  individual: { label: 'Individual / proprietor (not a firm or company)', type: 'bool', derived: true },
  womanOrScSt: { label: 'Woman or SC / ST entrepreneur', type: 'bool', derived: true },
  turnover: { label: 'Annual turnover', type: 'money' },
  investment: { label: 'Investment in machinery / equipment', type: 'money' },
  projectCost: { label: 'Project cost / loan needed', type: 'money' },
  priorFunding: { label: 'Government money received before', type: 'money' },
  age: { label: 'Promoter age', type: 'years' },
  businessAge: { label: 'Years since incorporation', type: 'years', derived: true },
}
export const OPS = {
  select: [{ id: 'in', label: 'is one of' }, { id: 'not_in', label: 'is not one of' }],
  bool: [{ id: 'is', label: 'is' }],
  money: [{ id: 'lte', label: 'at most' }, { id: 'lt', label: 'below' }, { id: 'gte', label: 'at least' }, { id: 'gt', label: 'above' }, { id: 'between', label: 'between' }],
  years: [{ id: 'lte', label: 'at most' }, { id: 'lt', label: 'below' }, { id: 'gte', label: 'at least' }, { id: 'gt', label: 'above' }, { id: 'between', label: 'between' }],
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const has = (v) => v !== undefined && v !== null && v !== ''
export const inr = (n) => n >= CRORE ? `₹${+(n / CRORE).toFixed(2)} crore` : n >= LAKH ? `₹${+(n / LAKH).toFixed(2)} lakh` : `₹${Math.round(n).toLocaleString('en-IN')}`
/** Whole years from a YYYY-MM-DD date to `today`. */
export function yearsSince(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return undefined
  const [y, m, d] = date.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}
/** Micro / small / medium by both investment and turnover (2025 limits); LARGE above; undefined while unknown. */
export function msmeClass(investment, turnover) {
  const i = num(investment), t = num(turnover)
  if (i === undefined || t === undefined) return undefined
  if (i <= 2.5 * CRORE && t <= 10 * CRORE) return 'MICRO'
  if (i <= 25 * CRORE && t <= 100 * CRORE) return 'SMALL'
  if (i <= 125 * CRORE && t <= 500 * CRORE) return 'MEDIUM'
  return 'LARGE'
}

/** The value of a field for this client (undefined = not known yet). */
export function fieldValue(p, field, today) {
  const f = FIELDS[field]
  if (!f) return undefined
  switch (field) {
    case 'msmeClass': return msmeClass(p.investment, p.turnover)
    case 'individual': return has(p.entity) ? p.entity === 'INDIVIDUAL' || p.entity === 'PROPRIETORSHIP' : undefined
    case 'womanOrScSt': return p.woman === true || p.category === 'SC' || p.category === 'ST' ? true : p.woman === false && has(p.category) ? false : undefined
    case 'businessAge': return yearsSince(p.incorporated, today)
  }
  if (f.type === 'money' || f.type === 'years') return num(p[field])
  if (f.type === 'bool') return p[field] === true ? true : p[field] === false ? false : undefined
  return has(p[field]) ? p[field] : undefined
}
const optLabel = (field, id) => FIELDS[field]?.options?.find((o) => o.id === id)?.label ?? id
/** A value as people read it: ₹15 lakh, 3 years, Yes, Proprietorship. */
export function showValue(field, v) {
  const t = FIELDS[field]?.type
  if (v === undefined) return 'not known'
  if (t === 'money') return inr(v)
  if (t === 'years') return `${v} year${v === 1 ? '' : 's'}`
  if (t === 'bool') return v ? 'Yes' : 'No'
  return optLabel(field, v)
}
/** The rule in words: "Project cost / loan needed at most ₹50 lakh". */
export function describeRule(c) {
  const f = FIELDS[c.field]
  if (!f) return c.field
  const amount = (n) => (f.type === 'money' ? inr(Number(n) || 0) : `${n} year${Number(n) === 1 ? '' : 's'}`)
  switch (c.op) {
    case 'in': return `${f.label}: ${(c.values ?? []).map((x) => optLabel(c.field, x)).join(' / ')}`
    case 'not_in': return `${f.label} not ${(c.values ?? []).map((x) => optLabel(c.field, x)).join(' / ')}`
    case 'is': return `${f.label}: ${c.value ? 'Yes' : 'No'}`
    case 'lte': return `${f.label} at most ${amount(c.value)}`
    case 'lt': return `${f.label} below ${amount(c.value)}`
    case 'gte': return `${f.label} at least ${amount(c.value)}`
    case 'gt': return `${f.label} above ${amount(c.value)}`
    case 'between': return `${f.label} ${amount(c.value)} – ${amount(c.value2)}`
  }
  return f.label
}
/** Does a known value meet the rule? */
export function testRule(c, v) {
  switch (c.op) {
    case 'in': return (c.values ?? []).includes(v)
    case 'not_in': return !(c.values ?? []).includes(v)
    case 'is': return v === c.value
    case 'lte': return v <= Number(c.value)
    case 'lt': return v < Number(c.value)
    case 'gte': return v >= Number(c.value)
    case 'gt': return v > Number(c.value)
    case 'between': return v >= Number(c.value) && v <= Number(c.value2)
  }
  return false
}
/** The rule's own limit in words: ₹50 lakh · 10 years · ₹10 lakh – ₹1 crore (so texts stay right when a limit is edited). */
export function showLimit(c) {
  const t = FIELDS[c.field]?.type
  const one = (n) => (t === 'money' ? inr(Number(n) || 0) : `${n} year${Number(n) === 1 ? '' : 's'}`)
  if (t !== 'money' && t !== 'years') return describeRule(c)
  return c.op === 'between' ? `${one(c.value)} – ${one(c.value2)}` : one(c.value)
}
// {value} = the client's value, {limit} = the condition's limit
const fill = (text, c, v) => text.replace(/\{value\}/g, showValue(c.field, v)).replace(/\{limit\}/g, showLimit(c))

/**
 * One condition for one client: pass / fail / unknown, with the reason. A condition only counts when its `when`
 * rules hold; while a `when` field is not known, a fail only counts as "to confirm".
 */
export function evaluateCondition(c, p, today) {
  let open = false
  for (const w of c.when ?? []) {
    const wv = fieldValue(p, w.field, today)
    if (wv === undefined) { open = true; continue }
    if (!testRule(w, wv)) return null
  }
  const v = fieldValue(p, c.field, today)
  const rule = describeRule(c)
  if (v === undefined) return { label: c.label, status: 'unknown', reason: c.ask?.trim() ? fill(c.ask, c, v) : `To confirm — ${rule}` }
  if (testRule(c, v)) return { label: c.label, status: 'pass', reason: c.pass?.trim() ? fill(c.pass, c, v) : `${showValue(c.field, v)} — ${rule}` }
  const reason = c.fail?.trim() ? fill(c.fail, c, v) : `${showValue(c.field, v)} — needs ${rule[0].toLowerCase()}${rule.slice(1)}`
  if (c.otherwise === 'unknown' || open) return { label: c.label, status: 'unknown', reason: open && c.otherwise !== 'unknown' ? `${reason} (if ${(c.when ?? []).map(describeRule).join(' and ')})` : (c.ask?.trim() ? fill(c.ask, c, v) : reason) }
  return { label: c.label, status: 'fail', reason }
}

/** Information lines: subsidy estimate and loan band (never change the result). */
function extras(s, p, today) {
  const out = []
  const sub = s.subsidy
  if (sub) {
    const base = fieldValue(p, sub.field || 'projectCost', today)
    if (base !== undefined && has(p.area)) {
      const special = SPECIAL_CATEGORIES.includes(p.category) || p.woman === true
      const rate = Number(special ? (p.area === 'RURAL' ? sub.specialRural : sub.specialUrban) : (p.area === 'RURAL' ? sub.generalRural : sub.generalUrban)) || 0
      out.push({ label: 'Subsidy estimate', status: 'info', reason: `${rate}% of ${inr(base)} ≈ ${inr((base * rate) / 100)} (${special ? 'special category' : 'general'}, ${p.area === 'RURAL' ? 'rural' : 'urban'}) — the final amount is set by the bank / agency` })
    }
  }
  const bands = s.bands
  if (bands?.items?.length) {
    const v = fieldValue(p, bands.field || 'projectCost', today)
    const band = v === undefined ? undefined : [...bands.items].sort((a, b) => a.max - b.max).find((b) => v <= b.max)
    if (band) out.push({ label: 'Band', status: 'info', reason: `${inr(v)} — ${band.label}` })
  }
  return out
}

/** Overall result: any fail → not eligible; all pass → eligible; else (or no conditions) potentially eligible. */
export function verdict(checks) {
  const real = checks.filter((c) => c.status !== 'info')
  if (real.some((c) => c.status === 'fail')) return 'NOT_ELIGIBLE'
  if (real.length && real.every((c) => c.status === 'pass')) return 'ELIGIBLE'
  return 'POSSIBLE'
}

/** One scheme for one client. */
export function checkScheme(s, profile, today) {
  const p = profile || {}
  const checks = [...(s.conditions ?? []).map((c) => evaluateCondition(c, p, today)).filter(Boolean), ...extras(s, p, today)]
  const status = verdict(checks)
  const failed = checks.filter((c) => c.status === 'fail'), open = checks.filter((c) => c.status === 'unknown')
  const why = status === 'ELIGIBLE' ? 'Meets every condition checked here'
    : status === 'NOT_ELIGIBLE' ? failed.map((c) => c.reason).join(' · ')
      : open.length ? `To confirm: ${open.map((c) => c.label).join(', ')}` : 'No conditions set for this scheme — check the official site'
  return { scheme: s, status, checks, why }
}

/** Every active scheme checked against the client's details, eligible first. `today` is YYYY-MM-DD (India). */
export function checkEligibility(profile, today, schemes = DEFAULT_SCHEMES) {
  const order = { ELIGIBLE: 0, POSSIBLE: 1, NOT_ELIGIBLE: 2 }
  return schemes.filter((s) => s.active !== false).map((s) => checkScheme(s, profile, today))
    .sort((a, b) => order[a.status] - order[b.status] || (a.scheme.position ?? 0) - (b.scheme.position ?? 0))
}

/** How many details are filled in (to nudge the sales person to fill more for sharper results). */
export const PROFILE_KEYS = ['entity', 'stage', 'sector', 'incorporated', 'turnover', 'investment', 'projectCost', 'area', 'udyam', 'dpiit', 'innovative', 'age', 'education', 'category', 'woman', 'reserved51', 'indian51', 'priorFunding', 'priorSubsidy', 'defaulter']
export const filledCount = (p) => PROFILE_KEYS.filter((k) => has(p?.[k])).length

/** A short WhatsApp-friendly summary for the client (eligible and potentially eligible schemes only). */
export function clientSummary(results, clientName) {
  const lines = [`Government schemes${clientName ? ` for ${clientName}` : ''} — preliminary check`, '']
  const shown = results.filter((r) => r.status !== 'NOT_ELIGIBLE')
  if (!shown.length) lines.push('No scheme matched on the details shared so far. Let us discuss your plans in more detail.')
  for (const r of shown) {
    lines.push(`${r.status === 'ELIGIBLE' ? '✅' : '🟡'} ${r.scheme.name} (${STATUS[r.status].label})`, `   ${r.scheme.summary}`)
    if (r.status === 'POSSIBLE') lines.push(`   ${r.why}`)
  }
  lines.push('', 'This is a preliminary check on the details shared. The final decision is made by the bank / government agency after verifying documents — approval is not guaranteed.')
  return lines.join('\n')
}

// ------------------------------------------------------------------ checks on a scheme being saved
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')
function ruleProblem(c, what) {
  const f = FIELDS[c.field]
  if (!f) return `${what}: pick what to check`
  if (!OPS[f.type].some((o) => o.id === c.op)) return `${what}: pick how to compare`
  if (c.op === 'in' || c.op === 'not_in') {
    if (!Array.isArray(c.values) || !c.values.length) return `${what}: tick at least one option`
    if (!c.values.every((x) => f.options.some((o) => o.id === x))) return `${what}: an option is not in the list`
  } else if (c.op === 'is') {
    if (typeof c.value !== 'boolean') return `${what}: pick Yes or No`
  } else {
    if (!Number.isFinite(Number(c.value)) || Number(c.value) < 0 || c.value === '' || c.value == null) return `${what}: enter a number (0 or more)`
    if (c.op === 'between' && (!Number.isFinite(Number(c.value2)) || c.value2 === '' || c.value2 == null || Number(c.value2) < Number(c.value))) return `${what}: the second number must be at least the first`
  }
  return null
}
const lines = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length <= 600) && v.length <= 40
/** What is wrong with a scheme before it is saved (empty when it can be saved). */
export function schemeProblems(s) {
  const p = []
  if (!s || typeof s !== 'object') return ['Nothing to save.']
  if (!s.name || s.name.trim().length < 3) p.push('Enter the scheme name.')
  if (s.name && s.name.length > 160) p.push('Keep the name under 160 characters.')
  if (!s.summary || s.summary.trim().length < 10) p.push('Write a one-line summary (what the scheme gives).')
  if (s.url && !/^https?:\/\/\S+$/i.test(s.url.trim())) p.push('The official site must start with http:// or https://')
  if (!isDate(s.verifiedOn)) p.push('Enter the date the rules were last checked.')
  for (const [k, label] of [['benefits', 'Benefits'], ['documents', 'Documents'], ['process', 'How to apply']]) if (!lines(s[k] ?? [])) p.push(`${label}: up to 40 lines of 600 characters.`)
  const conds = s.conditions ?? []
  if (!Array.isArray(conds) || conds.length > 40) p.push('Up to 40 conditions.')
  else conds.forEach((c, i) => {
    const what = `Condition ${i + 1}${c.label ? ` (${c.label})` : ''}`
    if (!c.label || !c.label.trim()) p.push(`${what}: give it a short name`)
    const r = ruleProblem(c, what); if (r) p.push(r)
    if (c.otherwise !== 'fail' && c.otherwise !== 'unknown') p.push(`${what}: pick what a mismatch means`)
    ;(c.when ?? []).forEach((w, j) => { const r2 = ruleProblem(w, `${what}, only-when rule ${j + 1}`); if (r2) p.push(r2) })
  })
  if (s.subsidy) {
    const r = ['generalUrban', 'generalRural', 'specialUrban', 'specialRural'].map((k) => Number(s.subsidy[k]))
    if (!r.every((x) => Number.isFinite(x) && x >= 0 && x <= 100)) p.push('Subsidy rates must be 0 to 100%.')
    if (FIELDS[s.subsidy.field || 'projectCost']?.type !== 'money') p.push('The subsidy is worked out on an amount.')
  }
  if (s.bands) {
    const it = s.bands.items ?? []
    if (!it.length || !it.every((b) => b.label?.trim() && Number.isFinite(Number(b.max)) && Number(b.max) > 0)) p.push('Each band needs a name and an upper limit.')
    if (FIELDS[s.bands.field || 'projectCost']?.type !== 'money') p.push('Bands are set on an amount.')
  }
  return p
}

// ------------------------------------------------------------------ the built-in schemes
const RECOGNISABLE = ['PRIVATE_LTD', 'LLP', 'PARTNERSHIP', 'COOPERATIVE']
let n = 0
const C = (label, field, op, x, more = {}) => ({ id: `c${++n}`, label, field, op, ...(op === 'in' || op === 'not_in' ? { values: x } : op === 'between' ? { value: x[0], value2: x[1] } : { value: x }), otherwise: 'fail', ...more })
const S = (x) => ({ active: true, verifiedOn: DEFAULTS_CHECKED, statusNote: '', ...x })

export const DEFAULT_SCHEMES = [
  S({
    id: 'es-udyam', position: 1, name: 'Udyam Registration (MSME)', kind: 'Registration', agency: 'Ministry of MSME', url: 'https://udyamregistration.gov.in', serviceMatch: 'udyam',
    summary: 'Free, paperless MSME registration — the key that opens most MSME schemes, bank priority lending and payment protection.',
    benefits: ['Recognised as a micro, small or medium enterprise', 'Needed for CGTMSE collateral-free loans, ZED subsidy and many state incentives', 'Priority-sector bank lending', 'Buyers must pay MSMEs within 45 days (MSMED Act)'],
    documents: ['Aadhaar of the proprietor / managing partner / director', 'PAN of the enterprise (GSTIN if registered)', 'Bank account details', 'Investment and turnover (taken from ITR / GST where filed)'],
    process: ['Go to udyamregistration.gov.in (no fee)', 'Verify Aadhaar with OTP, then PAN', 'Fill the business details, activity (NIC code) and bank details', 'Udyam certificate is issued online; update it every year'],
    conditions: [
      C('Enterprise', 'entity', 'not_in', ['INDIVIDUAL'], { otherwise: 'unknown', ask: 'Udyam is for an enterprise — register once the business is set up', fail: 'Udyam is for an enterprise — register once the business is set up' }),
      C('Business started', 'stage', 'not_in', ['IDEA'], { otherwise: 'unknown', fail: 'Still an idea — register once the business is set up' }),
      C('MSME limits', 'msmeClass', 'in', ['MICRO', 'SMALL', 'MEDIUM'], { pass: '{value} enterprise by investment and turnover (2025 limits)', fail: 'Investment / turnover above the medium limit (₹125 crore / ₹500 crore)', ask: 'Enter investment in plant / machinery / equipment and turnover to see the class' }),
    ],
  }),
  S({
    id: 'es-dpiit', position: 2, name: 'DPIIT Startup Recognition', kind: 'Recognition', agency: 'DPIIT, Ministry of Commerce & Industry', url: 'https://www.startupindia.gov.in', serviceMatch: 'dpiit',
    summary: 'Government recognition as a startup — needed for Seed Fund, tax holiday (80-IAC), patent and procurement benefits.',
    benefits: ['Income-tax holiday for 3 of the first 10 years (80-IAC — separate approval, turnover ≤ ₹100 crore)', 'Self-certification under labour and environment laws', 'Fast-track patent examination and up to 80% rebate on patent fees', 'Relaxed prior-experience / turnover conditions in government tenders', 'Access to Seed Fund, Fund of Funds and credit guarantee for startups'],
    documents: ['Certificate of incorporation / registration', 'PAN of the entity', 'Short write-up of the innovation (pitch deck, website or video)', 'Details of directors / partners'],
    process: ['Register on startupindia.gov.in', 'Fill the recognition form (entity, innovation, team)', 'Upload the incorporation certificate and write-up', 'DPIIT reviews and issues the certificate online (no fee)'],
    conditions: [
      C('Entity type', 'entity', 'in', RECOGNISABLE, { fail: 'Only private limited, LLP, registered partnership or co-operative society — incorporate first (we can help)' }),
      C('Age', 'businessAge', 'lt', 10, { pass: 'Incorporated {value} ago — within {limit}', fail: 'Incorporated {value} ago — the limit is {limit} (deep tech startups up to 20 years — check)', ask: 'Enter the date of incorporation (up to 10 years; deep tech up to 20)' }),
      C('Turnover', 'turnover', 'lte', 200 * CRORE, { pass: 'Turnover {value} — within {limit}', fail: 'Turnover {value} — above {limit} (deep tech up to ₹300 crore)' }),
      C('Innovation', 'innovative', 'is', true, { pass: 'Works on an innovative / improved product, process or scalable model', fail: 'Must work on innovation, improvement or a scalable, job-creating model — a plain trading or routine business is not recognised', ask: 'Does the business develop a new / improved product, service or process?' }),
    ],
  }),
  S({
    id: 'es-sisfs', position: 3, name: 'Startup India Seed Fund Scheme', kind: 'Grant / debt', agency: 'DPIIT, through selected incubators', url: 'https://seedfund.startupindia.gov.in', serviceMatch: 'seed fund',
    statusNote: 'Approved for 2021–22 to 2024–25 — confirm the call is open on seedfund.startupindia.gov.in before applying.',
    summary: 'Early money for a young startup: a grant for proof of concept / prototype and debt for market entry, given through incubators.',
    benefits: ['Grant up to ₹20 lakh for proof of concept, prototype or product trials', 'Up to ₹50 lakh as convertible debentures / debt for market entry, commercialisation or scaling', 'Mentoring and support from the incubator'],
    documents: ['DPIIT recognition certificate', 'Certificate of incorporation', 'Pitch deck and business plan with use of funds', 'Founder / team details and shareholding (cap table)', 'PAN, bank details, prototype photos / video if any'],
    process: ['Apply on seedfund.startupindia.gov.in and pick up to 3 incubators', 'Incubator screening, then a pitch to its Seed Management Committee', 'Agreement with the incubator', 'Money released in milestone-linked instalments'],
    conditions: [
      C('Entity type', 'entity', 'in', RECOGNISABLE, { fail: 'Must be a DPIIT-recognised startup — a private limited company, LLP, registered partnership or co-operative society (incorporate first)' }),
      C('DPIIT recognition', 'dpiit', 'is', true, { otherwise: 'unknown', pass: 'DPIIT-recognised', fail: 'Needs DPIIT recognition first — apply for it, then for the Seed Fund', ask: 'Is the startup DPIIT-recognised?' }),
      C('Age', 'businessAge', 'lt', 2, { pass: 'Incorporated {value} ago — within {limit}', fail: 'Incorporated {value} ago — the limit is {limit}', ask: 'Must be incorporated not more than 2 years before applying' }),
      C('Technology', 'innovative', 'is', true, { pass: 'Technology is used in the core product / service', fail: 'Technology must be used in the core product, service or business model', ask: 'Is technology used in the core product or service?' }),
      C('Earlier government money', 'priorFunding', 'lte', 10 * LAKH, { pass: '{value} received — within {limit}', fail: '{value} received — above the {limit} limit', ask: 'Must not have received more than {limit} from other central / state schemes (prizes, subsidised space and lab access don’t count)' }),
      C('Indian promoters', 'indian51', 'is', true, { pass: 'Indian promoters hold at least 51% (confirm in the current guidelines)', fail: 'Indian promoters should hold at least 51%', ask: 'Do Indian promoters hold 51% or more? (confirm in the current guidelines)' }),
    ],
  }),
  S({
    id: 'es-pmegp', position: 4, name: 'PMEGP — Prime Minister’s Employment Generation Programme', kind: 'Loan + subsidy', agency: 'KVIC, KVIB and District Industries Centres', url: 'https://www.kviconline.gov.in/pmegpeportal', serviceMatch: 'pmegp',
    summary: 'Bank loan for a NEW micro unit with a government margin-money subsidy of 15–35% of the project cost.',
    benefits: ['Subsidy (margin money) of 15–35% of the project cost — 15% urban / 25% rural (general), 25% urban / 35% rural (special categories)', 'Own contribution only 10% (general) or 5% (special categories); the bank lends the rest', 'Projects up to ₹50 lakh (manufacturing) or ₹20 lakh (service / business)'],
    documents: ['Aadhaar and PAN', 'Project report with cost and quotations', 'Education certificate (VIII pass, for projects above ₹10 lakh manufacturing / ₹5 lakh service)', 'Caste / special-category certificate if claimed', 'Rural area certificate if claimed', 'Bank details; EDP training certificate (after sanction)'],
    process: ['Apply online on the PMEGP e-portal (kviconline.gov.in)', 'KVIC / KVIB / DIC scrutiny and task-force interview', 'Bank appraises and sanctions the loan', 'Complete the EDP training', 'Subsidy is kept as a 3-year deposit, then adjusted to the loan'],
    conditions: [
      C('Applicant', 'entity', 'in', ['INDIVIDUAL', 'PROPRIETORSHIP', 'COOPERATIVE', 'OTHER'], { pass: 'Applicant type is covered', fail: 'PMEGP is for individuals, SHGs, societies, co-operatives and trusts — not companies, LLPs or partnership firms' }),
      C('Age', 'age', 'gte', 18, { when: [{ field: 'individual', op: 'is', value: true }], pass: '{value}', fail: 'Must be {limit} or older' }),
      C('New unit', 'stage', 'not_in', ['EXISTING'], { pass: 'A new unit', fail: 'Only new units — an existing business is not covered (except a 2nd loan for an existing PMEGP / MUDRA unit)' }),
      C('Project cost', 'projectCost', 'lte', 50 * LAKH, { when: [{ field: 'sector', op: 'in', values: ['MANUFACTURING'] }], pass: '{value} — within {limit} (manufacturing)', fail: '{value} — above the {limit} limit for manufacturing' }),
      C('Project cost', 'projectCost', 'lte', 20 * LAKH, { when: [{ field: 'sector', op: 'not_in', values: ['MANUFACTURING'] }], pass: '{value} — within {limit} (service / business)', fail: '{value} — above the {limit} limit for service / business' }),
      C('Education', 'education', 'not_in', ['BELOW_8'], { when: [{ field: 'sector', op: 'in', values: ['MANUFACTURING'] }, { field: 'projectCost', op: 'gt', value: 10 * LAKH }], pass: 'VIII pass or above', fail: 'VIII pass is needed above ₹10 lakh (manufacturing)', ask: 'VIII pass needed for this project size' }),
      C('Education', 'education', 'not_in', ['BELOW_8'], { when: [{ field: 'sector', op: 'not_in', values: ['MANUFACTURING'] }, { field: 'projectCost', op: 'gt', value: 5 * LAKH }], pass: 'VIII pass or above', fail: 'VIII pass is needed above ₹5 lakh (service / business)', ask: 'VIII pass needed for this project size' }),
      C('Earlier subsidy', 'priorSubsidy', 'is', false, { pass: 'No earlier government subsidy', fail: 'Units that already took a government subsidy under another scheme are not covered', ask: 'Has the applicant taken a government subsidy before?' }),
    ],
    subsidy: { field: 'projectCost', generalUrban: 15, generalRural: 25, specialUrban: 25, specialRural: 35 },
  }),
  S({
    id: 'es-mudra', position: 5, name: 'PM Mudra Yojana', kind: 'Collateral-free loan', agency: 'Banks, NBFCs and MFIs (MUDRA)', url: 'https://www.mudra.org.in', serviceMatch: 'mudra',
    summary: 'Collateral-free business loans for non-corporate micro enterprises — Shishu, Kishore, Tarun and Tarun Plus.',
    benefits: ['No collateral', 'Shishu up to ₹50,000 · Kishore up to ₹5 lakh · Tarun up to ₹10 lakh', 'Tarun Plus ₹10–20 lakh for borrowers who repaid a Tarun loan', 'Term loan and / or working capital (Mudra card)'],
    documents: ['KYC: Aadhaar, PAN, photo', 'Proof of business address / registration (Udyam, GST, shop licence)', 'Quotations for machinery / items to buy', 'Last 2 years’ balance sheet and ITR (Kishore and above)', 'Bank statement (last 6 months); caste certificate if any'],
    process: ['Apply at a bank / NBFC / MFI branch, or online on jansamarth.in / udyamimitra.in', 'Bank appraises the business and repayment capacity', 'Loan sanctioned without collateral'],
    conditions: [
      C('Applicant', 'entity', 'not_in', ['PRIVATE_LTD', 'PUBLIC_LTD'], { pass: 'Non-corporate enterprise', fail: 'Companies are not covered — Mudra is for non-corporate units' }),
      C('Loan needed', 'projectCost', 'lte', 20 * LAKH, { pass: '{value} — within Mudra limits', fail: '{value} — above the {limit} Mudra limit (look at CGTMSE or Stand-Up India)', ask: 'Up to ₹10 lakh (₹20 lakh under Tarun Plus after repaying a Tarun loan)' }),
      C('Tarun Plus', 'projectCost', 'lte', 10 * LAKH, { otherwise: 'unknown', when: [{ field: 'projectCost', op: 'lte', value: 20 * LAKH }], pass: '{value} — Shishu / Kishore / Tarun', fail: '{value} — Tarun Plus: only for borrowers who took and repaid a Tarun loan', ask: 'Tarun Plus (₹10–20 lakh) only after repaying a Tarun loan' }),
      C('Credit history', 'defaulter', 'is', false, { pass: 'No loan default', fail: 'Defaulters are not covered', ask: 'Any default with a bank / NBFC?' }),
    ],
    bands: { field: 'projectCost', items: [{ max: 50000, label: 'Shishu' }, { max: 5 * LAKH, label: 'Kishore' }, { max: 10 * LAKH, label: 'Tarun' }, { max: 20 * LAKH, label: 'Tarun Plus (after repaying a Tarun loan)' }] },
  }),
  S({
    id: 'es-standup', position: 6, name: 'Stand-Up India', kind: 'Bank loan', agency: 'Scheduled commercial banks (SIDBI portal)', url: 'https://www.standupmitra.in', serviceMatch: 'stand',
    statusNote: 'Extended up to FY 2025 — confirm with the bank or standupmitra.in that it is still open.',
    summary: 'Bank loans of ₹10 lakh – ₹1 crore for a new enterprise of an SC / ST and / or woman entrepreneur.',
    benefits: ['Composite loan (term loan + working capital) of ₹10 lakh to ₹1 crore', 'For a greenfield enterprise in manufacturing, services, trading or agri-allied activities', 'Repayment up to 7 years with up to 18 months moratorium', 'Hand-holding through standupmitra.in'],
    documents: ['KYC: Aadhaar, PAN, photo', 'Caste certificate (SC / ST) where applicable', 'Project report and quotations', 'Proof of business premises', 'For a firm / company: partnership deed or MOA / AOA showing the 51% holding'],
    process: ['Register on standupmitra.in or visit a bank branch', 'Submit the project report and documents', 'Bank appraisal and sanction'],
    conditions: [
      C('Entrepreneur', 'womanOrScSt', 'is', true, { when: [{ field: 'individual', op: 'is', value: true }], pass: 'SC / ST and / or woman entrepreneur', fail: 'Only for SC / ST and / or women entrepreneurs', ask: 'For SC / ST and / or women entrepreneurs' }),
      C('Age', 'age', 'gte', 18, { when: [{ field: 'individual', op: 'is', value: true }], pass: '{value}', fail: 'Must be {limit} or older' }),
      C('Shareholding', 'reserved51', 'is', true, { when: [{ field: 'individual', op: 'is', value: false }], pass: 'SC / ST and / or women hold at least 51%', fail: 'In a firm / company, SC / ST and / or women must hold at least 51% and control', ask: 'Do SC / ST and / or women hold 51% or more?' }),
      C('Greenfield', 'stage', 'not_in', ['EXISTING'], { pass: 'New enterprise', fail: 'Only a new (first-time) enterprise — not an existing business' }),
      C('Loan size', 'projectCost', 'between', [10 * LAKH, CRORE], { pass: '{value} — within {limit}', fail: '{value} — the loan must be {limit}' }),
      C('Credit history', 'defaulter', 'is', false, { pass: 'No default', fail: 'Must not be a defaulter to any bank / financial institution', ask: 'Any default with a bank / NBFC?' }),
    ],
  }),
  S({
    id: 'es-cgtmse', position: 7, name: 'CGTMSE — Credit Guarantee for Micro & Small Enterprises', kind: 'Loan guarantee', agency: 'CGTMSE (SIDBI & Ministry of MSME), through banks', url: 'https://www.cgtmse.in', serviceMatch: 'cgtmse',
    summary: 'Collateral-free bank credit for micro and small enterprises — the government trust guarantees the loan.',
    benefits: ['Loans without collateral or third-party guarantee, up to ₹10 crore', 'The trust covers most of the bank’s risk (cover depends on the loan and borrower)', 'For new and existing units; term loan and working capital'],
    documents: ['Udyam certificate', 'KYC of promoters and entity PAN', 'Project report / CMA data for the loan', 'Last 2–3 years’ financials and ITR (existing units)', 'Bank statements'],
    process: ['Apply for the loan at a bank / NBFC that is a CGTMSE member lending institution', 'The lender applies to CGTMSE for the guarantee cover', 'The annual guarantee fee is charged by the lender'],
    conditions: [
      C('Micro / small', 'msmeClass', 'in', ['MICRO', 'SMALL'], { pass: '{value} enterprise', fail: '{value} — only micro and small enterprises are covered', ask: 'Only micro and small enterprises — enter investment and turnover' }),
      C('Udyam', 'udyam', 'is', true, { otherwise: 'unknown', pass: 'Udyam-registered', fail: 'Needs Udyam registration (free) before the loan', ask: 'Needs Udyam registration (free) before the loan' }),
      C('Activity', 'sector', 'not_in', ['AGRI_ALLIED'], { otherwise: 'unknown', pass: '{value} activity', fail: 'Farm / agri-allied activities are generally outside CGTMSE — check with the bank' }),
      C('Loan size', 'projectCost', 'lte', 10 * CRORE, { pass: '{value} — within {limit}', fail: '{value} — above the {limit} guarantee limit' }),
      C('Credit history', 'defaulter', 'is', false, { pass: 'No default', fail: 'The bank will not lend to a defaulter', ask: 'Any default with a bank / NBFC?' }),
    ],
  }),
  S({
    id: 'es-zed', position: 8, name: 'MSME Sustainable ZED Certification', kind: 'Certification subsidy', agency: 'Ministry of MSME (QCI)', url: 'https://zed.msme.gov.in', serviceMatch: 'zed',
    summary: 'Quality & sustainability certification (Bronze, Silver, Gold) with most of the cost paid by the government.',
    benefits: ['Subsidy on the certification cost: 80% micro, 60% small, 50% medium', 'Extra support for women / SC-ST owned MSMEs and units in NER, hill and aspirational districts', '₹10,000 joining reward after the ZED pledge', 'Better standing with banks, buyers and in many state incentive schemes'],
    documents: ['Udyam certificate', 'Basic unit details and photos', 'Process / quality records for the assessment'],
    process: ['Register on the ZED portal with the Udyam number', 'Take the ZED pledge', 'Apply for Bronze (then Silver / Gold)', 'Assessment, then certificate; subsidy applied on the fee'],
    conditions: [
      C('Udyam', 'udyam', 'is', true, { otherwise: 'unknown', pass: 'Udyam-registered', fail: 'Needs Udyam registration first (free)', ask: 'Needs Udyam registration first (free)' }),
      C('MSME', 'msmeClass', 'in', ['MICRO', 'SMALL', 'MEDIUM'], { pass: '{value} — 80 / 60 / 50% subsidy for micro / small / medium', fail: 'Above MSME limits', ask: 'Must be an MSME — enter investment and turnover' }),
      C('Activity', 'sector', 'in', ['MANUFACTURING'], { otherwise: 'unknown', pass: 'Manufacturing MSME', fail: 'ZED is built for manufacturing MSMEs — check the portal for service-sector coverage' }),
      C('Running unit', 'stage', 'in', ['EXISTING'], { otherwise: 'unknown', pass: 'A running unit can be assessed', fail: 'Certification needs a running unit — apply once production starts' }),
    ],
  }),
]
