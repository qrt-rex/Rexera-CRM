import type { DB, SalesKitItem, SchemeMaster, User } from './types'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { canEditSchemesUser } from './rbac'
import { nowIso, uid } from './format'
import { checkerSchemes, materialise } from './eligibility'
import { buildMaster, findMaster, masterProblem, normName, renameInTitle, type MasterSource } from '../../supabase/scheme-master-rules.mjs'

/**
 * The Scheme Kit's master list — the one place a scheme's name is set (supabase/scheme-master-rules.mjs).
 * Renaming a scheme here renames it everywhere it appears: Services (so the Scheme dropdown of client entries and the
 * service on CRM entries), every CRM entry's service name and services, client entries, the Sales Kit, Schemes, the
 * Scheme Checker and Digital Media. Issued invoices are never changed. Operation Team, IT Support, Super Admin only.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const need = (me: User) => assert(canEditSchemesUser(me), 'Only the Operation Team, IT Support and Super Admin manage the Scheme Kit.')
const audit = (d: DB, me: User, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action, detail }) }

export const masterList = (d: DB): SchemeMaster[] => [...(d.schemeMaster ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
/** Active scheme names, A–Z — every scheme-name dropdown uses this list. */
export const masterNames = (d: DB) => masterList(d).filter((m) => m.active).map((m) => m.name).sort((a, b) => a.localeCompare(b))

/** The CRM's lists that name schemes, for building / completing the master list. */
function sources(d: DB): MasterSource[] {
  return [
    { kind: 'salesKit', items: (d.salesKit ?? []).map((x) => ({ id: x.id, name: x.name, category: x.category })) },
    { kind: 'scheme', items: d.schemes.map((x) => ({ id: x.id, name: x.title, category: x.category, active: x.active })) },
    { kind: 'checker', items: checkerSchemes(d).map((x) => ({ id: x.id, name: x.name, active: x.active })) },
    { kind: 'service', items: d.services.map((x) => ({ id: x.id, name: x.name, category: x.category, active: x.active })) },
  ]
}
/** Names in the CRM that are not in the Scheme Kit yet (an editor adds them with one click). */
export function unlinkedCount(d: DB) {
  const m = d.schemeMaster ?? []
  const linked = new Set(m.flatMap((x) => [...x.serviceIds, ...x.salesKitIds, ...x.schemeIds, ...x.checkerIds]))
  return sources(d).reduce((n, s) => n + s.items.filter((i) => i.name?.trim() && !linked.has(i.id)).length, 0)
}

/** Builds the master list from the names already in the CRM, or adds the ones not in it yet. */
export function buildSchemeMaster(me: User) {
  need(me)
  return mutate((d) => {
    const at = nowIso()
    const r = buildMaster(d.schemeMaster ?? [], sources(d), () => uid('ms-'), at)
    d.schemeMaster = r.master
    audit(d, me, 'SCHEME_KIT_BUILD', `Scheme Kit: ${r.added} scheme(s) added, ${r.linked} link(s) to Services / Sales Kit / Schemes / Scheme Checker`)
    return { added: r.added, linked: r.linked }
  })
}

/** Where a scheme appears (counts) — shown on the Scheme Kit and before a rename. */
export function usageOf(d: DB, m: SchemeMaster) {
  const svc = new Set(m.serviceIds)
  const names = new Set([m.name, ...m.aliases].map(normName))
  return {
    services: d.services.filter((s) => svc.has(s.id)).length,
    bookings: d.bookings.filter((b) => svc.has(b.serviceId) || (b.services ?? []).some((x) => svc.has(x.serviceId))).length,
    clientEntries: (d.clientEntries ?? []).filter((e) => svc.has(e.serviceId)).length,
    salesKit: (d.salesKit ?? []).filter((x) => m.salesKitIds.includes(x.id)).length,
    schemes: d.schemes.filter((x) => m.schemeIds.includes(x.id)).length,
    checker: checkerSchemes(d).filter((x) => m.checkerIds.includes(x.id)).length,
    media: (d.mediaItems ?? []).filter((x) => names.has(normName(x.schemeName))).length,
  }
}
export const USAGE_LABELS: [keyof ReturnType<typeof usageOf>, string][] = [
  ['services', 'Services'], ['bookings', 'CRM entries'], ['clientEntries', 'Client entries'], ['salesKit', 'Sales Kit'], ['schemes', 'Schemes'], ['checker', 'Scheme Checker'], ['media', 'Digital Media'],
]

/** The new name everywhere the scheme appears. Answers what changed. */
function renameEverywhere(d: DB, me: User, m: SchemeMaster, oldNames: string[], name: string) {
  const svc = new Set(m.serviceIds)
  const olds = new Set(oldNames.map(normName))
  const c = { services: 0, bookings: 0, clientEntries: 0, salesKit: 0, schemes: 0, checker: 0, media: 0 }
  for (const s of d.services) if (svc.has(s.id) && s.name !== name) { s.name = name; c.services++ }
  for (const b of d.bookings) {
    let hit = svc.has(b.serviceId)
    for (const x of b.services ?? []) if (svc.has(x.serviceId) && x.name !== name) { x.name = name; hit = true }
    if (!hit) continue
    const before = b.serviceName
    for (const o of oldNames) b.serviceName = renameInTitle(b.serviceName, o, name)
    if (!b.services?.length && svc.has(b.serviceId) && olds.has(normName(b.serviceName))) b.serviceName = name
    if (b.serviceName !== before || hit) { b.updatedAt = nowIso(); c.bookings++ }
  }
  for (const e of d.clientEntries ?? []) if (svc.has(e.serviceId) && e.scheme !== name) { e.scheme = name; c.clientEntries++ }
  for (const x of d.salesKit ?? []) if (m.salesKitIds.includes(x.id) && x.name !== name) { x.name = name; x.updatedAt = nowIso(); x.updatedBy = me.id; c.salesKit++ }
  for (const x of d.schemes) if (m.schemeIds.includes(x.id) && x.title !== name) { x.title = name; x.updatedAt = nowIso(); x.updatedBy = me.id; c.schemes++ }
  if (m.checkerIds.length) {
    if (checkerSchemes(d).some((x) => m.checkerIds.includes(x.id) && x.name !== name)) materialise(d, me)
    for (const x of d.eligibilitySchemes ?? []) if (m.checkerIds.includes(x.id) && x.name !== name) { x.name = name; x.updatedAt = nowIso(); x.updatedBy = me.id; c.checker++ }
  }
  for (const x of d.mediaItems ?? []) if (olds.has(normName(x.schemeName)) && x.schemeName !== name) { x.schemeName = name; c.media++ }
  return c
}
const changedText = (c: Record<string, number>) => Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${USAGE_LABELS.find(([x]) => x === k)?.[1] ?? k} ${n}`).join(', ') || 'nothing else used it'

export interface MasterInput { name: string; category: string; active: boolean; description?: string }
/** Adds a scheme, or saves one — a new name is applied everywhere the scheme appears. Answers its id and what changed. */
export function saveMasterScheme(me: User, v: MasterInput, id?: string) {
  need(me)
  const name = v.name.trim().replace(/\s+/g, ' '), category = v.category.trim()
  const problem = masterProblem({ name, category }, getDb().schemeMaster ?? [], id)
  assert(!problem, problem ?? '')
  return mutate((d) => {
    d.schemeMaster ??= []
    const at = nowIso()
    if (!id) {
      const m: SchemeMaster = { id: uid('ms-'), name, category, active: v.active, description: v.description?.trim() || undefined, aliases: [], serviceIds: [], salesKitIds: [], schemeIds: [], checkerIds: [], position: 1 + Math.max(0, ...d.schemeMaster.map((x) => x.position)), createdAt: at, updatedAt: at, updatedBy: me.id }
      d.schemeMaster.push(m)
      audit(d, me, 'SCHEME_KIT_ADD', `${name} (${category})`)
      return { id: m.id, changed: '' }
    }
    const m = d.schemeMaster.find((x) => x.id === id)
    assert(m, 'Scheme not found.')
    const old = m.name
    let changed = ''
    if (name !== old) {
      // the old name is kept, so anything that still says it is found (and renamed) too
      const olds = [old, ...m.aliases]
      m.aliases = [...new Set([...m.aliases.filter((a) => normName(a) !== normName(name)), ...(normName(old) !== normName(name) ? [old] : [])])]
      m.name = name
      changed = changedText(renameEverywhere(d, me, m, olds, name))
    }
    // the Sales Kit groups its schemes by the same category
    if (category !== m.category) for (const x of d.salesKit ?? []) if (m.salesKitIds.includes(x.id)) x.category = category
    Object.assign(m, { category, active: v.active, description: v.description?.trim() || undefined, updatedAt: at, updatedBy: me.id })
    audit(d, me, name !== old ? 'SCHEME_KIT_RENAME' : 'SCHEME_KIT_EDIT', name !== old ? `“${old}” → “${name}” · renamed in: ${changed}` : `${name} (${category}${v.active ? '' : ', inactive'})`)
    return { id: m.id, changed }
  })
}

/** Two records for the same scheme: everything linked to `dropId` moves to `keepId`, and takes its name. */
export function mergeMasterSchemes(me: User, keepId: string, dropId: string) {
  need(me)
  assert(keepId !== dropId, 'Pick another scheme.')
  return mutate((d) => {
    const keep = d.schemeMaster?.find((x) => x.id === keepId), drop = d.schemeMaster?.find((x) => x.id === dropId)
    assert(keep && drop, 'Scheme not found.')
    for (const f of ['serviceIds', 'salesKitIds', 'schemeIds', 'checkerIds'] as const) keep[f] = [...new Set([...keep[f], ...drop[f]])]
    keep.aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter((a) => normName(a) !== normName(keep.name))
    const changed = changedText(renameEverywhere(d, me, keep, [drop.name, ...drop.aliases], keep.name))
    keep.updatedAt = nowIso(); keep.updatedBy = me.id
    d.schemeMaster = d.schemeMaster!.filter((x) => x.id !== dropId)
    // kits that listed the merged scheme now list the kept one
    for (const k of d.schemeKits ?? []) if (k.schemeIds.includes(dropId)) k.schemeIds = [...new Set(k.schemeIds.map((x) => (x === dropId ? keepId : x)))]
    audit(d, me, 'SCHEME_KIT_MERGE', `“${drop.name}” merged into “${keep.name}” · renamed in: ${changed}`)
    return changed
  })
}

/**
 * The Scheme Kit's view of each scheme: its master name and category, with the Sales Kit's details (benefits,
 * sectors, eligibility, last date, charges) when it has them — what the advanced filters and Scheme Kits work on.
 */
export function schemeView(d: DB): SalesKitItem[] {
  const kit = new Map((d.salesKit ?? []).map((x) => [x.id, x]))
  return masterList(d).map((m) => {
    const sk = m.salesKitIds.map((id) => kit.get(id)).find(Boolean)
    return {
      id: m.id, name: m.name, category: m.category, position: m.position,
      benefits: sk?.benefits ?? m.description ?? '', sectors: sk?.sectors ?? '', eligibility: sk?.eligibility ?? '', lastDate: sk?.lastDate ?? '',
      organisation: sk?.organisation ?? '', schemeType: sk?.schemeType ?? '', applicableFor: sk?.applicableFor ?? '', minCharge: sk?.minCharge ?? '',
      registrationCharge: sk?.registrationCharge, updatedAt: m.updatedAt, updatedBy: m.updatedBy,
    }
  })
}
/** A kit that still lists Sales Kit ids (made before the Scheme Kit had its own list) → the master ids. */
export function kitIdsToMaster(d: DB, ids: string[]) {
  const byKit = new Map((d.schemeMaster ?? []).flatMap((m) => m.salesKitIds.map((k) => [k, m.id] as const)))
  return [...new Set(ids.map((x) => byKit.get(x) ?? x))]
}
export { findMaster }
