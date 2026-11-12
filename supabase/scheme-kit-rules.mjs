/**
 * Schemes everywhere (Sales Kit, Schemes, Scheme Checker): who edits them, the advanced filters, Scheme Kits and the
 * scheme sheet import. Pure — shared by the app (src/lib/schemeKit.ts, pages) and the tests (scheme-kit-rules.test.mjs).
 *  - Editing schemes: the Operation Team, IT Support and Super Admin only (the database checks the same:
 *    app.can_edit_schemes()); nobody else, whatever their own permissions.
 *  - Scheme Kit: a named list of schemes — picked by hand and / or "every scheme matching these filters" — personal, or
 *    shared with everyone (shared kits are made and changed by the scheme editors).
 */
export const SCHEME_EDITORS = ['operations', 'it', 'superadmin']
export const canEditSchemes = (roles) => (roles ?? []).some((r) => SCHEME_EDITORS.includes(r))

// ------------------------------------------------------------------ reading the scheme text
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n) => String(n).padStart(2, '0')
/** The last date as yyyy-mm-dd: "18 Nov 2026", "18-Nov-26", "18/11/2026", "2026-11-18"; null for "Rolling basis" etc. */
export function lastDateOf(text) {
  const s = String(text ?? '').trim()
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})/))) {
    const i = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (i >= 0) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(i + 1)}-${pad(m[1])}`
  }
  if ((m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return null
}
const daysTo = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
/** open / closing within 7 days / within 30 days / closed / rolling (no date) */
export function closingOf(item, today) {
  const d = lastDateOf(item.lastDate)
  if (!d) return /rolling|ongoing|open|always|throughout/i.test(item.lastDate ?? '') || !String(item.lastDate ?? '').trim() ? 'rolling' : 'unknown'
  const left = daysTo(today, d)
  return left < 0 ? 'closed' : left <= 7 ? 'week' : left <= 30 ? 'month' : 'open'
}
export const CLOSING = [['open', 'Open'], ['week', 'Closes within 7 days'], ['month', 'Closes within 30 days'], ['rolling', 'Rolling / no last date'], ['closed', 'Closed']]

/** The biggest rupee amount the benefits mention (₹1.5 Cr, Rs 50 lakh, INR 10,00,000, 25 Lakhs …), or null. */
export function amountOf(text) {
  let best = null
  const re = /(?:₹|rs\.?|inr|rupees)?\s*(\d+(?:[.,]\d+)*)\s*(crores?|cr\.?|lakhs?|lacs?|l\b|k\b|thousand)?/gi
  for (const m of String(text ?? '').matchAll(re)) {
    const raw = m[1].replace(/,/g, '')
    let v = Number(raw)
    if (!Number.isFinite(v)) continue
    const unit = (m[2] ?? '').toLowerCase()
    const hasRupee = /₹|rs|inr|rupee/i.test(m[0])
    if (/^cr/.test(unit)) v *= 1e7
    else if (/^(lakh|lac|l)/.test(unit)) v *= 1e5
    else if (unit === 'k' || unit === 'thousand') v *= 1e3
    else if (!hasRupee || v < 1000) continue           // a bare number (stage 1, 18%) is not an amount
    if (best === null || v > best) best = v
  }
  return best
}
export const AMOUNT_BANDS = [['', 'Any amount'], ['lt10l', 'Up to ₹10 lakh'], ['10l-1cr', '₹10 lakh – ₹1 crore'], ['1cr-10cr', '₹1 – 10 crore'], ['gt10cr', 'Above ₹10 crore']]
export function inAmountBand(v, band) {
  if (!band) return true
  if (v == null) return false
  return band === 'lt10l' ? v <= 1e6 : band === '10l-1cr' ? v > 1e6 && v <= 1e7 : band === '1cr-10cr' ? v > 1e7 && v <= 1e8 : v > 1e8
}

/** Lines / bullets / commas of a text field → the options people filter by ("Pan India", "Gujarat", "Agriculture"). */
export function tokens(text) {
  return [...new Set(String(text ?? '').split(/\n|●|•|▪|►|>>|;|,|\|/).map((x) => x.replace(/^[\s\-–*:.)(\d]+/, '').replace(/\s+/g, ' ').trim())
    .filter((x) => x.length >= 2 && x.length <= 60).map((x) => x[0].toUpperCase() + x.slice(1)))]
}
/** Every option of a field across the schemes, most used first. */
export function optionsOf(items, field) {
  const n = new Map()
  for (const x of items) for (const t of field === 'category' || field === 'schemeType' || field === 'organisation' ? [String(x[field] ?? '').trim()].filter(Boolean) : tokens(x[field])) {
    const k = t.toLowerCase(); const cur = n.get(k)
    n.set(k, { label: cur?.label ?? t, count: (cur?.count ?? 0) + 1 })
  }
  return [...n.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

// ------------------------------------------------------------------ advanced filter
/** An empty filter (everything matches). */
export const emptyFilter = () => ({ q: '', categories: [], types: [], orgs: [], places: [], sectors: [], entities: [], closing: [], amount: '', charge: '' })
export const filterCount = (f) => (f.q?.trim() ? 1 : 0) + ['categories', 'types', 'orgs', 'places', 'sectors', 'entities', 'closing'].reduce((n, k) => n + ((f[k] ?? []).length ? 1 : 0), 0) + (f.amount ? 1 : 0) + (f.charge ? 1 : 0)
const hasAny = (field, wanted) => { if (!wanted?.length) return true; const t = tokens(field).map((x) => x.toLowerCase()); return wanted.some((w) => t.includes(String(w).toLowerCase()) || String(field ?? '').toLowerCase().includes(String(w).toLowerCase())) }
const oneOf = (v, wanted) => !wanted?.length || wanted.some((w) => String(v ?? '').trim().toLowerCase() === String(w).toLowerCase())
/** charge bands on "INR 10,000 + 18% GST" (first rupee number) */
export const chargeOf = (text) => { const m = String(text ?? '').replace(/,/g, '').match(/(\d{3,})/); return m ? Number(m[1]) : null }
export const CHARGE_BANDS = [['', 'Any charge'], ['free', 'No upfront charge'], ['lt10k', 'Up to ₹10,000'], ['10k-25k', '₹10,000 – 25,000'], ['25k-50k', '₹25,000 – 50,000'], ['gt50k', 'Above ₹50,000']]
export function inChargeBand(text, band) {
  if (!band) return true
  const v = chargeOf(text)
  if (band === 'free') return v === null || v === 0
  if (v === null) return false
  return band === 'lt10k' ? v <= 10000 : band === '10k-25k' ? v > 10000 && v <= 25000 : band === '25k-50k' ? v > 25000 && v <= 50000 : v > 50000
}
/** Does a scheme match the filter? */
export function matches(item, f, today) {
  if (!f) return true
  const q = (f.q ?? '').trim().toLowerCase()
  if (q && !q.split(/\s+/).every((w) => `${item.name} ${item.category} ${item.benefits} ${item.sectors} ${item.eligibility} ${item.organisation} ${item.applicableFor} ${item.schemeType} ${item.minCharge} ${item.lastDate}`.toLowerCase().includes(w))) return false
  return oneOf(item.category, f.categories) && oneOf(item.schemeType, f.types) && oneOf(item.organisation, f.orgs)
    && hasAny(item.applicableFor, f.places) && hasAny(item.sectors, f.sectors) && hasAny(item.eligibility, f.entities)
    && (!f.closing?.length || f.closing.includes(closingOf(item, today)))
    && inAmountBand(amountOf(item.benefits), f.amount) && inChargeBand(item.minCharge, f.charge)
}
export const SORTS = [['', 'Category order'], ['name', 'Name A–Z'], ['closing', 'Last date (soonest first)'], ['amount', 'Benefit (highest first)'], ['charge-asc', 'Our charge (low to high)'], ['charge-desc', 'Our charge (high to low)']]
export function sortItems(list, sort, today) {
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    closing: (a, b) => (lastDateOf(a.lastDate) ?? '9999') .localeCompare(lastDateOf(b.lastDate) ?? '9999') || a.name.localeCompare(b.name),
    amount: (a, b) => (amountOf(b.benefits) ?? -1) - (amountOf(a.benefits) ?? -1),
    'charge-asc': (a, b) => (chargeOf(a.minCharge) ?? Infinity) - (chargeOf(b.minCharge) ?? Infinity),
    'charge-desc': (a, b) => (chargeOf(b.minCharge) ?? -1) - (chargeOf(a.minCharge) ?? -1),
  }[sort]
  void today
  return by ? [...list].sort(by) : list
}

// ------------------------------------------------------------------ Scheme Kits
/** The schemes in a kit: picked by hand, plus (if the kit has a filter) every scheme matching it; minus the hidden ones. */
export function kitItems(kit, items, today) {
  const picked = new Set(kit.schemeIds ?? [])
  const hidden = new Set(kit.excludedIds ?? [])
  const useFilter = kit.filter && filterCount(kit.filter) > 0
  const out = items.filter((x) => !hidden.has(x.id) && (picked.has(x.id) || (useFilter && matches(x, kit.filter, today))))
  const order = new Map((kit.schemeIds ?? []).map((id, i) => [id, i]))
  return out.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
}
/** A kit name: 2–60 characters, not used by another kit of the same person (or another shared kit). */
export function kitProblem(kit, kits) {
  const name = String(kit.name ?? '').trim()
  if (name.length < 2) return 'Give the kit a name.'
  if (name.length > 60) return 'Keep the name under 60 characters.'
  if (kits.some((k) => k.id !== kit.id && k.name.trim().toLowerCase() === name.toLowerCase() && (k.shared ? kit.shared : !kit.shared && k.ownerId === kit.ownerId))) return 'A kit with this name already exists.'
  if (!(kit.schemeIds ?? []).length && !(kit.filter && filterCount(kit.filter) > 0)) return 'Pick schemes, or save the kit with filters.'
  return null
}

// ------------------------------------------------------------------ importing a scheme sheet
const COLS = {
  name: /^(scheme(\s*name)?|name(\s*of\s*(the\s*)?scheme)?|title|programme|program)$/i,
  category: /^(category|funding\s*category|type\s*of\s*funding|funding)$/i,
  benefits: /benefit|support|assistance|amount|quantum|what you get/i,
  sectors: /sector|industr|focus/i,
  eligibility: /eligib|who can apply|criteria/i,
  lastDate: /last\s*date|deadline|closing|due\s*date|valid/i,
  organisation: /organi[sz]ation|ministry|department|agency|implemented|funding\s*body|by$/i,
  schemeType: /type\s*of\s*scheme|scheme\s*type|^type$|nature/i,
  applicableFor: /applicable|state|location|region|pan\s*india/i,
  minCharge: /our\s*(min(imum)?\s*)?charge|min(imum)?\s*charge|charges?|fee|price|upfront/i,
  registrationCharge: /registration|govt\s*charge|government\s*charge/i,
}
const FIELDS = Object.keys(COLS)
/** Header cells → which column holds which field (most specific first, each column used once). */
export function columnsOf(header) {
  const cells = header.map((c) => String(c ?? '').trim())
  const out = {}, used = new Set()
  for (const f of ['name', 'registrationCharge', 'schemeType', 'lastDate', 'eligibility', 'sectors', 'applicableFor', 'organisation', 'minCharge', 'category', 'benefits']) {
    const i = cells.findIndex((c, j) => !used.has(j) && c && COLS[f].test(c))
    if (i >= 0) { out[f] = i; used.add(i) }
  }
  return out
}
const clean = (v) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
/**
 * Sheets → the schemes they hold, and what happens to each: new, update (with the fields that change) or same.
 * The category comes from a Category column, else the sheet's name (the Sales Kit file has one sheet per category).
 * Matched to the schemes already in the CRM by name (and category when two share a name).
 */
/** a tab name that says nothing about the category (“Sheet1”, “Copy of …”) */
export const genericSheet = (name) => /^(sheet|tab|page|copy of|data|schemes?|list|untitled)\b\s*\d*$/i.test(String(name ?? '').trim()) || /^sheet\s*\d+$/i.test(String(name ?? '').trim())
export function planSchemeImport(sheets, existing, opts = {}) {
  const fallback = opts.defaultCategory || 'Grant'
  const rows = []
  const byName = new Map()
  for (const x of existing) { const k = x.name.trim().toLowerCase(); byName.set(k, [...(byName.get(k) ?? []), x]) }
  const seen = new Set()
  for (const sheet of sheets) {
    let cols = null
    sheet.rows.forEach((cells, i) => {
      const txt = cells.map((c) => String(c ?? '').trim())
      const c = columnsOf(txt)
      if (c.name !== undefined && Object.keys(c).length >= 3) { cols = c; return }
      if (!cols || txt.every((x) => !x)) return
      const get = (f) => (cols[f] !== undefined ? clean(cells[cols[f]]) : '')
      const name = get('name').replace(/\s+/g, ' ')
      if (!name || /^(s\.?\s*no|sr\.?\s*no|#)$/i.test(name)) return
      const fromDefault = !get('category') && genericSheet(sheet.name)
      const v = { category: get('category') || (fromDefault ? fallback : String(sheet.name).trim()), name, benefits: get('benefits'), sectors: get('sectors'), eligibility: get('eligibility'), lastDate: get('lastDate') || 'Rolling basis', organisation: get('organisation'), schemeType: get('schemeType'), applicableFor: get('applicableFor') || 'Pan India', minCharge: get('minCharge'), ...(get('registrationCharge') ? { registrationCharge: get('registrationCharge') } : {}) }
      // an Excel date number in the last-date column → "18 Nov 2026"
      if (/^\d{5}(\.\d+)?$/.test(v.lastDate)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(v.lastDate) * 86_400_000); v.lastDate = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}` }
      const k = `${v.category.toLowerCase()}|${name.toLowerCase()}`
      if (seen.has(k)) { rows.push({ line: `${sheet.name} · row ${i + 1}`, v, action: 'skip', changes: [], problem: 'Listed twice in the sheet', fromDefault }); return }
      seen.add(k)
      const same = byName.get(name.toLowerCase()) ?? []
      const cur = same.length > 1 ? same.find((x) => x.category.toLowerCase() === v.category.toLowerCase()) ?? same[0] : same[0]
      if (!cur) { rows.push({ line: `${sheet.name} · row ${i + 1}`, v, action: 'new', changes: [], fromDefault }); return }
      // only fields the sheet has: an empty cell never wipes what the team wrote
      // the category of an existing scheme is not changed by a generic tab name
      // only columns the sheet has (a category from the tab name never moves an existing scheme)
      const changes = FIELDS.filter((f) => f !== 'name' && cols[f] !== undefined && v[f] && clean(cur[f]) !== v[f])
      rows.push({ line: `${sheet.name} · row ${i + 1}`, v, id: cur.id, action: changes.length ? 'update' : 'same', changes, fromDefault })
    })
  }
  return rows
}
