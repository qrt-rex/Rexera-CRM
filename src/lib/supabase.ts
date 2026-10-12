import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser connection to Supabase. Uses ONLY the publishable key (row-level security protects the data).
 * The secret key (sb_secret_…) must never reach the browser — if someone puts it here, we refuse to connect.
 * Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env, then restart `npm run dev`.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || ''

export type CloudState = { status: 'not-configured' } | { status: 'unsafe-key' } | { status: 'ready'; url: string }

export function cloudConfig(): CloudState {
  if (key.startsWith('sb_secret_') || key.startsWith('eyJ') && key.includes('service_role')) return { status: 'unsafe-key' }
  if (!url || !key) return { status: 'not-configured' }
  return { status: 'ready', url }
}

let client: Promise<SupabaseClient> | null = null
/** Lazily loads the Supabase library only when the cloud database is actually used. */
export function getSupabase(): Promise<SupabaseClient> {
  const cfg = cloudConfig()
  if (cfg.status === 'unsafe-key') return Promise.reject(new Error('A secret key is set for the browser. Use the publishable key (sb_publishable_…) instead.'))
  if (cfg.status !== 'ready') return Promise.reject(new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).'))
  client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }))
  return client
}

/** Reachability check: the tables answer (and, signed out, return nothing — row-level security at work). */
export async function pingCloud(): Promise<{ ok: boolean; detail: string }> {
  const cfg = cloudConfig()
  if (cfg.status === 'unsafe-key') return { ok: false, detail: 'A secret key is configured for the browser — replace it with the publishable key now.' }
  if (cfg.status === 'not-configured') return { ok: false, detail: 'Not connected yet — add the project URL and publishable key to .env' }
  try {
    const sb = await getSupabase()
    const { error } = await sb.from('app_settings').select('key', { head: true, count: 'exact' })
    if (error) return { ok: false, detail: `Reached ${new URL(cfg.url).host}, but: ${error.message}${/relation|does not exist/i.test(error.message) ? ' — run the schema SQL first' : ''}` }
    return { ok: true, detail: `Connected to ${new URL(cfg.url).host} · schema found` }
  } catch (e) {
    return { ok: false, detail: `Can't reach Supabase: ${e instanceof Error ? e.message : 'network error'}` }
  }
}

/** Sends a password reset email using Supabase Auth */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const cfg = cloudConfig()
  if (cfg.status !== 'ready') {
    throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.')
  }
  const sb = await getSupabase()
  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo })
  if (error) throw new Error(error.message)
}

/** Completes password update for the recovery session in Supabase Auth */
export async function completePasswordReset(newPassword: string): Promise<{ email?: string }> {
  const cfg = cloudConfig()
  if (cfg.status !== 'ready') {
    throw new Error('Supabase is not configured.')
  }
  const sb = await getSupabase()
  const { data, error } = await sb.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
  return { email: data.user?.email }
}

