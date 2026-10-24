import type { SiteContent, SiteKey, User } from './types'
import { effectivePerms } from './rbac'
import { getDb, mutate } from './store'
import { ActionError } from './actions'
import { nowIso, uid } from './format'

/**
 * Website content managed from the CRM (Super Admin): each part of rexera.co.in has a draft (edited here) and a
 * published copy (what the live website reads from GET /api/site/content). Nothing reaches the website until it is
 * published; every publish is kept so an earlier version can be restored.
 */
export type FieldType = 'text' | 'textarea' | 'url' | 'image' | 'toggle' | 'email' | 'phone'
export interface SiteField { name: string; label: string; type: FieldType; hint?: string }
export interface SiteSection { key: SiteKey; label: string; desc: string; kind: 'object' | 'list'; item?: string; fields: SiteField[] }

export const SITE_SECTIONS: SiteSection[] = [
  { key: 'hero', label: 'Homepage hero', desc: 'The first thing visitors see on the homepage', kind: 'object', fields: [
    { name: 'title', label: 'Headline', type: 'text' }, { name: 'subtitle', label: 'Sub-headline', type: 'textarea' },
    { name: 'ctaText', label: 'Button text', type: 'text' }, { name: 'ctaLink', label: 'Button link', type: 'url' }, { name: 'image', label: 'Background / hero image', type: 'image' },
  ] },
  { key: 'banners', label: 'Banners', desc: 'Offer and announcement banners (slider / strip)', kind: 'list', item: 'banner', fields: [
    { name: 'title', label: 'Title', type: 'text' }, { name: 'text', label: 'Text', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' },
    { name: 'link', label: 'Link', type: 'url' }, { name: 'active', label: 'Show on the website', type: 'toggle' },
  ] },
  { key: 'about', label: 'About us', desc: 'Who Rexera is', kind: 'object', fields: [
    { name: 'heading', label: 'Heading', type: 'text' }, { name: 'body', label: 'Text', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' },
  ] },
  { key: 'services', label: 'Services & offerings', desc: 'What you offer (grants, loans, certifications …)', kind: 'list', item: 'service', fields: [
    { name: 'title', label: 'Service name', type: 'text' }, { name: 'summary', label: 'Short summary', type: 'textarea' }, { name: 'details', label: 'Details', type: 'textarea' },
    { name: 'price', label: 'Price / fee (optional)', type: 'text' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'link', label: 'Link (optional)', type: 'url' },
    { name: 'active', label: 'Show on the website', type: 'toggle' },
  ] },
  { key: 'portfolio', label: 'Portfolio & case studies', desc: 'Client success stories', kind: 'list', item: 'project', fields: [
    { name: 'title', label: 'Project / case study', type: 'text' }, { name: 'client', label: 'Client (or "A Gujarat food startup")', type: 'text' },
    { name: 'category', label: 'Category', type: 'text' }, { name: 'summary', label: 'Story / result', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' },
    { name: 'link', label: 'Link (optional)', type: 'url' }, { name: 'active', label: 'Show on the website', type: 'toggle' },
  ] },
  { key: 'sections', label: 'Other page sections', desc: 'Any other text / image blocks your website shows (by a key the website uses)', kind: 'list', item: 'section', fields: [
    { name: 'id', label: 'Key used by the website', type: 'text', hint: 'e.g. why-us, faq-intro' }, { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'body', label: 'Text', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'active', label: 'Show on the website', type: 'toggle' },
  ] },
  { key: 'contact', label: 'Contact details', desc: 'Phone, email, address and social links', kind: 'object', fields: [
    { name: 'phone', label: 'Phone', type: 'phone' }, { name: 'whatsapp', label: 'WhatsApp number', type: 'phone' }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Address', type: 'textarea' }, { name: 'hours', label: 'Working hours', type: 'text' }, { name: 'mapUrl', label: 'Google Maps link', type: 'url' },
    { name: 'instagram', label: 'Instagram', type: 'url' }, { name: 'facebook', label: 'Facebook', type: 'url' }, { name: 'linkedin', label: 'LinkedIn', type: 'url' },
  ] },
  { key: 'forms', label: 'Website forms', desc: 'Lead forms on the website — each submission arrives in CRM Leads with this form name', kind: 'list', item: 'form', fields: [
    { name: 'id', label: 'Form name (sent with each lead)', type: 'text', hint: 'e.g. contact, grant-enquiry' }, { name: 'title', label: 'Title shown on the website', type: 'text' },
    { name: 'fields', label: 'Fields (one per line)', type: 'textarea', hint: 'Name, Mobile, Email, Company, Service, Message' },
    { name: 'successMessage', label: 'Thank-you message', type: 'text' }, { name: 'active', label: 'Form is on', type: 'toggle' },
  ] },
  { key: 'seo', label: 'SEO', desc: 'Title and description search engines show', kind: 'object', fields: [
    { name: 'title', label: 'Site title', type: 'text' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Share image', type: 'image' },
  ] },
]
export const siteSection = (k: SiteKey) => SITE_SECTIONS.find((s) => s.key === k)!
export const emptyContent = (s: SiteSection): unknown => (s.kind === 'list' ? [] : {})
/** The row for a part of the website (an empty draft when it was never saved). */
export const siteRow = (rows: SiteContent[] | undefined, k: SiteKey): SiteContent | undefined => rows?.find((r) => r.key === k)
export const isChanged = (r?: SiteContent) => !!r && JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null)

const need = (me: User) => { if (!effectivePerms(getDb(), me).has('website.manage')) throw new ActionError('Only the Super Admin can change the website.') }
const assert: (c: unknown, m: string) => asserts c = (c, m) => { if (!c) throw new ActionError(m) }
const log = (d: ReturnType<typeof getDb>, by: string, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }
const URL_RE = /^(https?:\/\/\S+|\/\S*|#\S*|mailto:\S+|tel:\S+)$/i

/** Checks a draft against its section's fields (links must be links, list items need a title / key). */
export function contentProblems(s: SiteSection, v: unknown): string[] {
  const out: string[] = []
  const check = (o: Record<string, unknown>, where: string) => {
    for (const f of s.fields) {
      const x = o[f.name]
      if (x == null || x === '') continue
      if ((f.type === 'url' || f.type === 'image') && !URL_RE.test(String(x))) out.push(`${where}${f.label}: enter a full link (https://…).`)
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x))) out.push(`${where}${f.label}: not a valid email.`)
    }
  }
  if (s.kind === 'list') {
    assert(Array.isArray(v), 'Wrong content.')
    ;(v as Record<string, unknown>[]).forEach((o, i) => {
      if (!String(o.title ?? o.id ?? '').trim()) out.push(`${s.item ?? 'Item'} ${i + 1}: give it a ${s.fields[0]!.label.toLowerCase()}.`)
      check(o, `${s.item ?? 'Item'} ${i + 1} · `)
    })
    if (s.key === 'forms' || s.key === 'sections') {
      const ids = (v as Record<string, unknown>[]).map((o) => String(o.id ?? '').trim())
      if (ids.some((x) => !/^[a-z0-9][a-z0-9-]{0,40}$/.test(x))) out.push('Keys / form names: lower-case letters, numbers and - only (e.g. grant-enquiry).')
      if (new Set(ids).size !== ids.length) out.push('Two items have the same key / form name.')
    }
  } else check((v ?? {}) as Record<string, unknown>, '')
  return out
}

/** Saves a draft (the live website doesn't change until it is published). */
export function saveSiteDraft(me: User, key: SiteKey, draft: unknown) {
  need(me)
  const s = siteSection(key)
  const clean = s.kind === 'list' ? (draft as Record<string, unknown>[]).map((o) => ({ ...o, id: String(o.id ?? '').trim() || uid(`${key.slice(0, 3)}-`) })) : draft
  const problems = contentProblems(s, clean)
  assert(!problems.length, problems[0] ?? '')
  mutate((d) => {
    d.siteContent ??= []
    const at = nowIso(), r = d.siteContent.find((x) => x.key === key)
    if (r) Object.assign(r, { draft: clean, updatedAt: at, updatedBy: me.id })
    else d.siteContent.push({ key, draft: clean, updatedAt: at, updatedBy: me.id })
    log(d, me.id, 'SITE_DRAFT', `${s.label}: draft saved`)
  })
}
/** Puts drafts live (all changed parts, or the given ones) and keeps each published version. */
export function publishSite(me: User, keys?: SiteKey[]) {
  need(me)
  mutate((d) => {
    const at = nowIso()
    const rows = (d.siteContent ?? []).filter((r) => (!keys || keys.includes(r.key)) && isChanged(r))
    assert(rows.length, 'Nothing to publish — every part of the website is up to date.')
    for (const r of rows) {
      const problems = contentProblems(siteSection(r.key), r.draft)
      assert(!problems.length, `${siteSection(r.key).label}: ${problems[0]}`)
      r.published = structuredClone(r.draft)
      r.publishedAt = at; r.publishedBy = me.id
      ;(d.siteHistory ??= []).unshift({ id: uid('sh-'), key: r.key, content: structuredClone(r.draft), at, by: me.id })
    }
    if (d.siteHistory && d.siteHistory.length > 300) d.siteHistory.length = 300
    log(d, me.id, 'SITE_PUBLISH', rows.map((r) => siteSection(r.key).label).join(', '))
  })
}
/** Drops the unpublished changes of a part (back to what is live). */
export function discardSiteDraft(me: User, key: SiteKey) {
  need(me)
  mutate((d) => {
    const r = d.siteContent?.find((x) => x.key === key)
    assert(r && isChanged(r), 'There are no unpublished changes here.')
    r.draft = structuredClone(r.published ?? emptyContent(siteSection(key)))
    r.updatedAt = nowIso(); r.updatedBy = me.id
    log(d, me.id, 'SITE_DISCARD', siteSection(key).label)
  })
}
/** Brings back an earlier published version as the draft (publish it to put it live). */
export function restoreSiteVersion(me: User, historyId: string) {
  need(me)
  mutate((d) => {
    const h = d.siteHistory?.find((x) => x.id === historyId)
    assert(h, 'Version not found.')
    d.siteContent ??= []
    const r = d.siteContent.find((x) => x.key === h.key), at = nowIso()
    if (r) Object.assign(r, { draft: structuredClone(h.content), updatedAt: at, updatedBy: me.id })
    else d.siteContent.push({ key: h.key, draft: structuredClone(h.content), updatedAt: at, updatedBy: me.id })
    log(d, me.id, 'SITE_RESTORE', `${siteSection(h.key).label}: version of ${h.at}`)
  })
}
