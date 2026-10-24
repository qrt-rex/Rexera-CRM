// The website's content, served to rexera.co.in (GET /api/site/content): only what the Super Admin has PUBLISHED in
// the CRM (Website → Content) — drafts never leave the CRM. Public and read-only; kept for 30 seconds between reads.
import { createClient } from '@supabase/supabase-js'

const KEYS = ['hero', 'banners', 'about', 'services', 'portfolio', 'sections', 'contact', 'forms', 'seo']
let cache = { at: 0, body: null }

/** { content: { hero: {…}, services: [...], … }, publishedAt } — lists keep only the items marked "show". */
export async function getSiteContent(env, { client, now = Date.now(), fresh = false } = {}) {
  if (!fresh && cache.body && now - cache.at < 30_000) return { status: 200, body: cache.body }
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL'), secret = env('SUPABASE_SECRET_KEY') || ''
  const sb = client ?? (url && secret.startsWith('sb_secret_') ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null)
  if (!sb) return { status: 503, body: { success: false, message: 'The CRM is not connected yet.' } }
  const { data, error } = await sb.from('site_content').select('key, published, published_at')
  if (error) throw new Error(`site content: ${error.message}`)
  const content = {}
  let publishedAt = null
  for (const r of data ?? []) {
    if (!KEYS.includes(r.key) || r.published == null) continue
    content[r.key] = Array.isArray(r.published) ? r.published.filter((x) => x?.active !== false) : r.published
    if (r.published_at && (!publishedAt || r.published_at > publishedAt)) publishedAt = r.published_at
  }
  const body = { success: true, content, publishedAt }
  cache = { at: now, body }
  return { status: 200, body }
}
/** After a publish the next read is fresh. */
export const clearSiteCache = () => { cache = { at: 0, body: null } }
