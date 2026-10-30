import type { DB, EligibilityCondition, EligibilityRule, EligibilityScheme, User } from './types'
import { canEditSchemeRules } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { nowIso, uid } from './format'
import { DEFAULT_SCHEMES, FIELDS, schemeProblems } from '../../supabase/eligibility-rules.mjs'

/**
 * Rexy's Scheme Checker rules (table eligibility_schemes). Everyone on the staff reads them; only Super Admin and the
 * Operation team change them (canEditSchemeRules — the database checks the same). While nothing has been saved the
 * built-in schemes are used; the first change saves the built-in set, then applies the change.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const need = (me: User) => assert(canEditSchemeRules(getDb(), me), 'Only Super Admin and the Operation team can change the Scheme Checker rules.')

const byPosition = (a: EligibilityScheme, b: EligibilityScheme) => a.position - b.position || a.name.localeCompare(b.name)
/** True while the built-in schemes are in use (nothing saved yet). */
export const usingBuiltInSchemes = (d: DB) => !d.eligibilitySchemes?.length
/** The schemes the checker uses, in their order (inactive ones included — the checker leaves them out). */
export const checkerSchemes = (d: DB): EligibilityScheme[] => (usingBuiltInSchemes(d) ? DEFAULT_SCHEMES : [...d.eligibilitySchemes!].sort(byPosition))

function audit(d: DB, me: User, action: string, detail: string) {
  d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action, detail })
  if (d.audit.length > 1000) d.audit.length = 1000
}
/** Saves the built-in set the first time anything is changed, so every scheme is then a row of its own. */
function materialise(d: DB, me: User) {
  if (d.eligibilitySchemes?.length) return
  const at = nowIso()
  d.eligibilitySchemes = structuredClone(DEFAULT_SCHEMES).map((s) => ({ ...s, updatedAt: at, updatedBy: me.id }))
}

const cleanRule = (r: EligibilityRule): EligibilityRule => {
  const t = FIELDS[r.field]?.type
  if (r.op === 'in' || r.op === 'not_in') return { field: r.field, op: r.op, values: [...new Set(r.values ?? [])] }
  if (r.op === 'is' || t === 'bool') return { field: r.field, op: 'is', value: r.value === true }
  return { field: r.field, op: r.op, value: Number(r.value), ...(r.op === 'between' ? { value2: Number(r.value2) } : {}) }
}
const cleanCondition = (c: EligibilityCondition): EligibilityCondition => ({
  ...cleanRule(c), id: c.id || uid('c'), label: c.label.trim(), otherwise: c.otherwise,
  ...(c.when?.length ? { when: c.when.map(cleanRule) } : {}),
  ...(c.pass?.trim() ? { pass: c.pass.trim() } : {}), ...(c.fail?.trim() ? { fail: c.fail.trim() } : {}), ...(c.ask?.trim() ? { ask: c.ask.trim() } : {}),
})
const cleanLines = (v: string[]) => v.map((x) => x.trim()).filter(Boolean)

export type SchemeInput = Omit<EligibilityScheme, 'id' | 'position' | 'updatedAt' | 'updatedBy'>
/** Adds a scheme, or saves the changes to one (id). Answers its id. */
export function saveEligibilityScheme(me: User, x: SchemeInput, id?: string) {
  need(me)
  const v: SchemeInput = {
    ...x, name: x.name.trim(), kind: x.kind.trim(), agency: x.agency.trim(), url: x.url.trim(), serviceMatch: x.serviceMatch.trim(), statusNote: x.statusNote.trim(), summary: x.summary.trim(),
    benefits: cleanLines(x.benefits), documents: cleanLines(x.documents), process: cleanLines(x.process),
  }
  const problems = schemeProblems(v)
  assert(!problems.length, problems.slice(0, 3).join(' '))
  v.conditions = v.conditions.map(cleanCondition)
  if (!v.subsidy) delete v.subsidy
  if (!v.bands?.items.length) delete v.bands
  else v.bands = { field: v.bands.field, items: v.bands.items.map((b) => ({ max: Number(b.max), label: b.label.trim() })).sort((a, b) => a.max - b.max) }
  return mutate((d) => {
    materialise(d, me)
    const list = d.eligibilitySchemes!
    assert(!list.some((s) => s.id !== id && s.name.toLowerCase() === v.name.toLowerCase()), 'A scheme with this name is already there.')
    const at = nowIso()
    if (id) {
      const cur = list.find((s) => s.id === id)
      assert(cur, 'Scheme not found — it may have been removed.')
      Object.assign(cur, v, { updatedAt: at, updatedBy: me.id })
      if (!v.subsidy) delete cur.subsidy
      if (!v.bands) delete cur.bands
      audit(d, me, 'SCHEME_RULES_EDIT', `${cur.name} · ${cur.conditions.length} conditions${cur.active ? '' : ' · hidden'}`)
      return cur.id
    }
    const s: EligibilityScheme = { ...v, id: uid('es-'), position: 1 + Math.max(0, ...list.map((y) => y.position)), updatedAt: at, updatedBy: me.id }
    list.push(s)
    audit(d, me, 'SCHEME_RULES_ADD', `${s.name} · ${s.conditions.length} conditions`)
    return s.id
  })
}

export function deleteEligibilityScheme(me: User, id: string) {
  need(me)
  mutate((d) => {
    materialise(d, me)
    const cur = d.eligibilitySchemes!.find((s) => s.id === id)
    assert(cur, 'Scheme not found.')
    assert(d.eligibilitySchemes!.length > 1, 'Keep at least one scheme — hide it instead of removing the last one.')
    d.eligibilitySchemes = d.eligibilitySchemes!.filter((s) => s.id !== id)
    audit(d, me, 'SCHEME_RULES_DELETE', cur.name)
  })
}

/** Shown to sales people or hidden (kept for later). */
export function setEligibilitySchemeActive(me: User, id: string, active: boolean) {
  need(me)
  mutate((d) => {
    materialise(d, me)
    const cur = d.eligibilitySchemes!.find((s) => s.id === id)
    assert(cur, 'Scheme not found.')
    cur.active = active
    cur.updatedAt = nowIso(); cur.updatedBy = me.id
    audit(d, me, 'SCHEME_RULES_EDIT', `${cur.name} ${active ? 'shown' : 'hidden'}`)
  })
}

/** Moves a scheme up or down the list (the order sales people see for equal results). */
export function moveEligibilityScheme(me: User, id: string, dir: -1 | 1) {
  need(me)
  mutate((d) => {
    materialise(d, me)
    const list = [...d.eligibilitySchemes!].sort(byPosition)
    const i = list.findIndex((s) => s.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j]!, list[i]!]
    list.forEach((s, k) => { const row = d.eligibilitySchemes!.find((y) => y.id === s.id)!; if (row.position !== k + 1) row.position = k + 1 })
  })
}

/** Built-in schemes: add the ones that are missing, or put every scheme back to the built-in set ('all'). */
export function restoreBuiltInSchemes(me: User, mode: 'missing' | 'all') {
  need(me)
  return mutate((d) => {
    const at = nowIso()
    const fresh = structuredClone(DEFAULT_SCHEMES).map((s) => ({ ...s, updatedAt: at, updatedBy: me.id }))
    if (mode === 'all' || !d.eligibilitySchemes?.length) {
      d.eligibilitySchemes = fresh
      audit(d, me, 'SCHEME_RULES_RESET', `Back to the ${fresh.length} built-in schemes`)
      return fresh.length
    }
    const have = new Set(d.eligibilitySchemes.map((s) => s.id))
    const add = fresh.filter((s) => !have.has(s.id))
    let pos = Math.max(0, ...d.eligibilitySchemes.map((s) => s.position))
    for (const s of add) d.eligibilitySchemes.push({ ...s, position: ++pos })
    if (add.length) audit(d, me, 'SCHEME_RULES_ADD', `Built-in schemes added back: ${add.map((s) => s.name).join(', ')}`)
    return add.length
  })
}
