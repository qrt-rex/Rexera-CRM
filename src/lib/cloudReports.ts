/**
 * Reports calculated in Supabase, fetched through the server relay (/api/incentive-report: vite.config.ts locally,
 * server.mjs live). The secret key stays on the server; the live server also asks for the reports access key.
 */
export interface CloudIncentiveRow {
  user_id: string; name: string; email: string; role: string; salary: number
  /** ½ when the deal is shared by a different submitter and lead closer */
  deals_closed: number; quoted: number; payments: number; collected: number; collected_with_gst: number
  /** part of `collected` that came from payments shared 50/50 with another person */
  shared_collected: number
  eligible_at: number; eligible: boolean; monthly_at: number
  daily_incentive: number; weekly_incentive: number; monthly_pct: number; monthly_incentive: number
  auto_incentive: number; manual_incentive: number; total_incentive: number
  days: { date: string; amount: number; incentive: number }[]
  weeks: { week: string; amount: number; incentive: number }[]
}
export interface CloudIncentiveRules {
  version: number; eligibilityMultiple: number; dailyThreshold: number; dailyPct: number
  weeklyThreshold: number; weeklyPct: number; monthlyMultiple: number; slabs: { upTo: number | null; pct: number }[]
}
/** A person's monthly target from the team scorecard (user_id is empty for people not in the CRM yet). */
export interface CloudTarget { name: string; team: string; user_id: string | null; target: number; reported_collection: number | null; scorecard_rank: number | null }
export interface CloudIncentiveReport {
  month: string; months: string[]; rules: CloudIncentiveRules | null; rows: CloudIncentiveRow[]
  targets: CloudTarget[]; targetsReady: boolean; project: string; at: string
}

export class ReportError extends Error { constructor(message: string, public code?: string) { super(message) } }

const KEY = 'rexera-reports-key'
/** The access key this computer sends to the live server (not needed on npm run dev). */
export const reportsKey = {
  get: () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } },
  set: (k: string) => { try { localStorage.setItem(KEY, k.trim()) } catch { /* ignore */ } },
}

// numeric columns arrive from PostgREST as numbers or strings; make them numbers
const NUM = ['salary', 'deals_closed', 'shared_collected', 'quoted', 'collected', 'collected_with_gst', 'eligible_at', 'monthly_at', 'daily_incentive', 'weekly_incentive', 'monthly_pct', 'monthly_incentive', 'auto_incentive', 'manual_incentive', 'total_incentive'] as const

export async function fetchIncentiveReport(month?: string): Promise<CloudIncentiveReport> {
  const headers: Record<string, string> = import.meta.env.DEV ? {} : { 'X-Reports-Key': reportsKey.get() }
  let res: Response
  try { res = await fetch(`/api/incentive-report${month ? `?month=${encodeURIComponent(month)}` : ''}`, { headers }) }
  catch { throw new ReportError('Could not reach the server.', 'OFFLINE') }
  const j = await res.json().catch(() => null) as { success?: boolean; message?: string; code?: string; data?: CloudIncentiveReport } | null
  if (!res.ok || !j?.success || !j.data) throw new ReportError(j?.message || `Report failed (${res.status}).`, j?.code)
  const data = j.data
  data.rows = data.rows.map((r) => {
    const x = { ...r } as CloudIncentiveRow
    for (const k of NUM) (x[k] as number) = Number(r[k] ?? 0)
    x.days = (r.days ?? []).map((d) => ({ ...d, amount: Number(d.amount), incentive: Number(d.incentive) }))
    x.weeks = (r.weeks ?? []).map((w) => ({ ...w, amount: Number(w.amount), incentive: Number(w.incentive) }))
    return x
  })
  data.targets = (data.targets ?? []).map((t) => ({ ...t, target: Number(t.target), reported_collection: t.reported_collection == null ? null : Number(t.reported_collection) }))
  return data
}
