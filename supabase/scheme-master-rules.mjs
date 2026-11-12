/**
 * The Scheme Kit's master list: one record per scheme, the only place its name is set. Pure — shared by the app
 * (src/lib/schemeMaster.ts) and the tests (scheme-master-rules.test.mjs).
 *  - Every list that names schemes is linked to it: Services (and through them the Scheme dropdown of client entries
 *    and every CRM entry's service name), the Sales Kit, Schemes and the Scheme Checker; Digital Media by name.
 *  - Renaming a scheme in the Scheme Kit renames it in all of them (old names are kept as aliases, so links by name
 *    still find it). Issued invoices are never changed.
 */

/** names compared without case, spaces or punctuation: "Startup India – Seed Fund" = "startup india seed fund" */
export const normName = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

/** The master scheme a name belongs to (its name or one of its old names). */
export function findMaster(master, name) {
  const k = normName(name)
  if (!k) return undefined
  return master.find((m) => normName(m.name) === k || (m.aliases ?? []).some((a) => normName(a) === k))
}

/**
 * Builds (or completes) the master list from the names already in the CRM. Each source: { kind, items: [{ id, name,
 * category? }] } with kind 'service' | 'salesKit' | 'scheme' | 'checker'. Names that are the same (normName) become
 * one scheme, linked to every item with that name. Items already linked are left alone. Answers { master, added, linked }.
 */
const LINK = { service: 'serviceIds', salesKit: 'salesKitIds', scheme: 'schemeIds', checker: 'checkerIds' }
export function buildMaster(existing, sources, newId, now) {
  const master = existing.map((m) => ({ ...m, serviceIds: [...(m.serviceIds ?? [])], salesKitIds: [...(m.salesKitIds ?? [])], schemeIds: [...(m.schemeIds ?? [])], checkerIds: [...(m.checkerIds ?? [])], aliases: [...(m.aliases ?? [])] }))
  const linked = new Set(master.flatMap((m) => Object.values(LINK).flatMap((f) => m[f].map((id) => `${f}:${id}`))))
  let added = 0, links = 0
  // the Sales Kit first: its names and categories are the ones sales already use
  for (const kind of ['salesKit', 'scheme', 'checker', 'service']) {
    for (const it of sources.filter((s) => s.kind === kind).flatMap((s) => s.items ?? [])) {
      const field = LINK[kind]
      if (!it?.name?.trim() || linked.has(`${field}:${it.id}`)) continue
      let m = findMaster(master, it.name)
      if (!m) {
        m = { id: newId(), name: it.name.trim().replace(/\s+/g, ' '), category: it.category?.trim() || 'Other', active: it.active !== false, aliases: [], serviceIds: [], salesKitIds: [], schemeIds: [], checkerIds: [], position: master.length + 1, createdAt: now }
        master.push(m); added++
      } else if (m.category === 'Other' && it.category?.trim()) m.category = it.category.trim()
      m[field].push(it.id); linked.add(`${field}:${it.id}`); links++
    }
  }
  return { master, added, linked: links }
}

/**
 * A CRM entry's service name with one scheme renamed: "Seed Fund + PMEGP", "Combo 6 months: Seed Fund + PMEGP" — only
 * whole names are replaced (never a part of another name).
 */
export function renameInTitle(title, oldName, newName) {
  const t = String(title ?? '')
  const m = t.match(/^(Combo [^:]+: )?(.*)$/s)
  const prefix = m[1] ?? '', names = m[2] ? m[2].split(' + ') : []
  const k = normName(oldName)
  let changed = false
  const out = names.map((n) => { if (normName(n) === k) { changed = true; return newName } return n })
  return changed ? prefix + out.join(' + ') : t
}

/**
 * A new item in one of the lists (a Sales Kit scheme, a service, a scheme, a Scheme Checker scheme): linked to the
 * master scheme with its name, or a new master scheme is made for it. Nothing happens while the master list hasn't
 * been built yet (it links everything when it is). Changes `master` in place; answers the master record (or null).
 */
export function linkNew(master, kind, item, newId, now) {
  if (!master.length || !item?.name?.trim()) return null
  const field = LINK[kind]
  let m = findMaster(master, item.name)
  if (!m) {
    m = { id: newId(), name: item.name.trim().replace(/\s+/g, ' '), category: item.category?.trim() || 'Other', active: true, aliases: [], serviceIds: [], salesKitIds: [], schemeIds: [], checkerIds: [], position: 1 + Math.max(0, ...master.map((x) => x.position ?? 0)), createdAt: now }
    master.push(m)
  }
  if (!m[field].includes(item.id)) m[field].push(item.id)
  return m
}
/** The master scheme an item is linked to (by its id in that list). */
export const linkedMaster = (master, kind, id) => master.find((m) => (m[LINK[kind]] ?? []).includes(id))

/** A scheme name: 2–120 characters, not the name (or old name) of another scheme. */
export function masterProblem(v, master, id) {
  const name = String(v.name ?? '').trim()
  if (name.length < 2) return 'Enter the scheme name.'
  if (name.length > 120) return 'Keep the name under 120 characters.'
  const other = master.find((m) => m.id !== id && (normName(m.name) === normName(name) || (m.aliases ?? []).some((a) => normName(a) === normName(name))))
  if (other) return `“${other.name}” already has this name${normName(other.name) === normName(name) ? '' : ' as an old name'} — merge them instead.`
  if (!String(v.category ?? '').trim()) return 'Pick the category.'
  return null
}
