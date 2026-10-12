/**
 * Sales incentive report from Supabase: GET /api/incentive-report?month=YYYY-MM. Shared by the local dev server
 * (vite.config.ts) and the live server (server.mjs). Uses SUPABASE_SECRET_KEY, so it only ever runs on the server;
 * the browser gets the finished report. The numbers come from public.sales_incentive_report (see
 * supabase/migrations/20261012020000_sales_incentive_report.sql).
 */

/** SUPABASE_URL when it is a real project URL, else VITE_SUPABASE_URL (the same project). */
export function reportConfig(get) {
  const pick = [get('SUPABASE_URL'), get('VITE_SUPABASE_URL')].map((v) => (v ?? '').trim().replace(/\/+$/, '')).find((v) => /^https:\/\/[^/]+\.supabase\.(co|in)$/.test(v))
  const key = (get('SUPABASE_SECRET_KEY') ?? '').trim()
  return { url: pick ?? '', key: key.startsWith('sb_secret_') ? key : '' }
}

export async function incentiveReport(query, cfg) {
  if (!cfg.url || !cfg.key) return { status: 503, body: { success: false, code: 'NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.' } }
  const month = String(query.get('month') ?? '')
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { status: 400, body: { success: false, message: 'month must look like 2026-09' } }
  const headers = { apikey: cfg.key, 'Content-Type': 'application/json' }
  const get = async (path) => {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, { headers })
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
  try {
    // months that have collections, newest first (to pick a default and fill the month list)
    const today = new Date().toISOString().slice(0, 10), thisMonth = today.slice(0, 7)
    const dates = await get(`booking_payments?select=paid_on&paid_on=lte.${today}&order=paid_on.desc&limit=5000`)   // future-dated typos don't add months
    // the latest month with team targets opens first (that's the month being scored); else the latest month with collections
    const tm = await fetch(`${cfg.url}/rest/v1/sales_targets?select=month&order=month.desc&limit=1`, { headers })
    const targetMonth = tm.ok ? (await tm.json())[0]?.month : undefined
    const months = [...new Set([...(targetMonth ? [targetMonth] : []), ...dates.map((d) => String(d.paid_on).slice(0, 7))])].sort().reverse()
    const use = month || targetMonth || months[0] || thisMonth
    const res = await fetch(`${cfg.url}/rest/v1/rpc/sales_incentive_report`, { method: 'POST', headers, body: JSON.stringify({ p_month: use }) })
    if (res.status === 404) return { status: 503, body: { success: false, code: 'NO_FUNCTION', message: 'Run supabase/migrations/20261012020000_sales_incentive_report.sql in the Supabase SQL Editor first.' } }
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const rows = await res.json()
    const [rules] = await get('incentive_rule_versions?select=version,rules&order=version.desc&limit=1')
    // monthly targets from the team scorecards (table added by 20261012030000_sales_targets.sql; empty until it exists)
    const t = await fetch(`${cfg.url}/rest/v1/sales_targets?select=name,team,user_id,target,reported_collection,scorecard_rank&month=eq.${use}&order=team,scorecard_rank`, { headers })
    const targets = t.ok ? await t.json() : []
    return { status: 200, body: { success: true, data: { month: use, months, rules: rules ? { version: rules.version, ...rules.rules } : null, rows, targets, targetsReady: t.ok, project: new URL(cfg.url).host, at: new Date().toISOString() } } }
  } catch (err) {
    return { status: 502, body: { success: false, message: err instanceof Error ? err.message : 'Supabase request failed' } }
  }
}
