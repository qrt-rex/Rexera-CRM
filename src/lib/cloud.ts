import type { SupabaseClient } from '@supabase/supabase-js'
import type { DB } from './types'
import { cloudConfig, getSupabase } from './supabase'
import { mapAll, rowsToDb, type Row, type Tables } from '../../supabase/backup-mapping.mjs'

/**
 * Supabase as the CRM's database. The app keeps working on one in-memory DB document (lib/store.ts); this file
 * fills it from the tables after sign-in, writes every change back to the tables it touched, and reloads tables
 * that other people changed (Supabase Realtime). Row-level security decides what each person can read and write.
 *
 * On only when VITE_DATA_BACKEND=supabase (and the Supabase URL + publishable key are set); otherwise the CRM
 * keeps its data in the browser as before.
 */
export const CLOUD = import.meta.env.VITE_DATA_BACKEND === 'supabase' && cloudConfig().status === 'ready'

type Mode = 'id' | 'replace' | 'append' | 'insertNew'
interface Child { prop: string | string[]; table: string; fk: string; mode: Mode; order: [string, boolean]; newestFirst?: boolean }
/** once: rows are written once under a fixed id (e.g. one break reminder per person per day); an id already in the table is skipped, not an error */
interface Spec { key: keyof DB; table: string; idProp?: string; idCol?: string; order: [string, boolean]; limit?: number; children?: Child[]; once?: boolean }

/** Each array in the DB document, its table and child tables — parents before the tables that refer to them. */
const SPECS: Spec[] = [
  { key: 'users', table: 'app_users', order: ['created_at', true], children: [
    { prop: 'extraRoles', table: 'user_extra_roles', fk: 'user_id', mode: 'replace', order: ['role', true] },
    { prop: ['grants', 'denies'], table: 'user_permission_overrides', fk: 'user_id', mode: 'replace', order: ['permission', true] },
  ] },
  { key: 'services', table: 'services', order: ['name', true] },
  { key: 'leadUploads', table: 'lead_uploads', order: ['uploaded_at', false] },
  { key: 'leads', table: 'leads', order: ['created_at', false], children: [
    { prop: 'calls', table: 'lead_calls', fk: 'lead_id', mode: 'id', order: ['called_at', false] },
  ] },
  { key: 'bookings', table: 'bookings', order: ['created_at', false], children: [
    { prop: 'payments', table: 'booking_payments', fk: 'booking_id', mode: 'id', order: ['part', true] },
    { prop: 'approvals', table: 'booking_approvals', fk: 'booking_id', mode: 'id', order: ['decided_at', true] },
    { prop: 'stageHistory', table: 'booking_stage_moves', fk: 'booking_id', mode: 'replace', order: ['moved_at', true] },
    { prop: 'comments', table: 'booking_comments', fk: 'booking_id', mode: 'id', order: ['created_at', true] },
    { prop: 'documents', table: 'booking_documents', fk: 'booking_id', mode: 'id', order: ['uploaded_at', true] },
    { prop: 'clientEmails', table: 'booking_client_emails', fk: 'booking_id', mode: 'id', order: ['sent_at', false] },
    { prop: 'tasks', table: 'booking_tasks', fk: 'booking_id', mode: 'id', order: ['created_at', true] },
    { prop: 'refunds', table: 'booking_refunds', fk: 'booking_id', mode: 'id', order: ['created_at', true] },
  ] },
  { key: 'invoices', table: 'invoices', order: ['issued_on', false], children: [
    { prop: 'items', table: 'invoice_items', fk: 'invoice_id', mode: 'replace', order: ['position', true] },
    // written only by the live server (sends to the client); the CRM reads it and never changes it
    { prop: 'shares', table: 'invoice_shares', fk: 'invoice_id', mode: 'id', order: ['sent_at', false] },
  ] },
  { key: 'schemes', table: 'schemes', order: ['created_at', false] },
  { key: 'posts', table: 'posts', order: ['created_at', false] },
  { key: 'broadcasts', table: 'broadcasts', order: ['created_at', false], children: [
    { prop: 'acks', table: 'broadcast_acks', fk: 'broadcast_id', mode: 'insertNew', order: ['acked_at', true] },
  ] },
  { key: 'events', table: 'events', order: ['event_date', true] },
  { key: 'leaves', table: 'leave_requests', order: ['created_at', false] },
  { key: 'sessions', table: 'day_sessions', order: ['work_date', true] },
  // the Super Admin's browser writes other people's reminders but can't see them, so it may write one twice
  { key: 'notices', table: 'notifications', order: ['created_at', false], once: true },
  { key: 'messages', table: 'messages', order: ['sent_at', true] },
  { key: 'templates', table: 'message_templates', order: ['name', true] },
  { key: 'payrollRuns', table: 'payroll_runs', order: ['month', false], children: [
    { prop: 'rows', table: 'payroll_rows', fk: 'run_id', mode: 'replace', order: ['name', true] },
    { prop: 'history', table: 'payroll_history', fk: 'run_id', mode: 'append', order: ['id', true] },
  ] },
  { key: 'pfAccounts', table: 'pf_accounts', idProp: 'userId', idCol: 'user_id', order: ['user_id', true] },
  { key: 'manualIncentives', table: 'manual_incentives', order: ['added_at', false] },
  { key: 'apiKeys', table: 'api_keys', order: ['created_at', false] },
  { key: 'backupLog', table: 'backup_log', order: ['at', false] },
  { key: 'emails', table: 'emails', order: ['sent_at', false] },
  { key: 'emailAutomations', table: 'email_automations', idProp: 'key', idCol: 'key', order: ['key', true] },
  { key: 'candidateForms', table: 'candidate_forms', order: ['created_at', false] },
  { key: 'candidates', table: 'candidate_applications', order: ['submitted_at', false] },
  { key: 'legacyFiles', table: 'legacy_files', idProp: 'path', idCol: 'path', order: ['path', true] },
  { key: 'assets', table: 'company_assets', order: ['created_at', false], children: [
    { prop: 'history', table: 'asset_events', fk: 'asset_id', mode: 'append', order: ['id', false], newestFirst: true },
  ] },
  { key: 'stock', table: 'stock_items', order: ['created_at', false], children: [
    { prop: 'moves', table: 'stock_moves', fk: 'item_id', mode: 'append', order: ['id', false], newestFirst: true },
  ] },
  { key: 'expenses', table: 'company_expenses', order: ['created_at', false] },
  { key: 'docForms', table: 'doc_forms', order: ['created_at', false] },
  { key: 'formSubmissions', table: 'doc_form_submissions', order: ['submitted_at', false] },
]
/** Tables that aren't one array of the document. The audit log loads its newest 1000 entries (the app keeps 1000). */
const OTHER_TABLES: [string, [string, boolean], number?][] = [
  ['app_settings', ['key', true]], ['role_permissions', ['role', true]], ['incentive_rule_versions', ['version', true]], ['audit_log', ['id', false], 1000],
]
const SETTING_FIELDS = ['settings', 'counters', 'pfSettings', 'version', 'upgrades'] as const

let sb: SupabaseClient | null = null
const client = async () => (sb ??= await getSupabase())
let cache: Tables = {}
let meId: string | null = null
/** The signed-in person's CRM user id (their app_users row), or null when signed out. */
export const cloudUserId = () => meId

// ------------------------------------------------------------------ load
async function fetchAll(table: string, [col, asc]: [string, boolean], limit?: number): Promise<Row[]> {
  const s = await client()
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from(table).select('*').order(col, { ascending: asc }).range(from, from + 999)
    if (error) { console.warn(`[cloud] ${table}: ${error.message}`); return out }
    out.push(...(data as Row[]))
    if (data.length < 1000 || (limit && out.length >= limit)) break
  }
  // the audit log is fetched newest first; the tables are kept oldest first
  return table === 'audit_log' ? out.slice(0, limit).reverse() : out
}
const ALL_TABLES: [string, [string, boolean], number?][] = [
  ...SPECS.flatMap((s) => [[s.table, s.order] as [string, [string, boolean]], ...(s.children ?? []).map((c) => [c.table, c.order] as [string, [string, boolean]])]),
  ...OTHER_TABLES,
]
// newest-first children are loaded newest first; the app keeps them that way too
async function loadTables(names: string[]) {
  await Promise.all(ALL_TABLES.filter(([t]) => names.includes(t)).map(async ([t, order, limit]) => { cache[t] = await fetchAll(t, order, limit) }))
}

/** Reads every table this person may see. Returns the DB document built from them (without app defaults). */
export async function loadCloud(): Promise<DB> {
  const s = await client()
  // the saved session is enough here: the database checks its token on every request
  const { data: { session } } = await s.auth.getSession()
  const user = session?.user
  if (user) {
    // who is signed in stays known while the data reloads (a gap here signed people out)
    const { data } = await s.from('app_users').select('id').eq('auth_user_id', user.id).maybeSingle()
    meId = (data?.id as string | undefined) ?? null
    await loadTables(ALL_TABLES.map(([t]) => t))
  } else {
    meId = null
    // signed out: only the public job application forms are readable
    cache = {}
    await loadTables(['candidate_forms'])
  }
  return rowsToDb(cache).db
}

// ------------------------------------------------------------------ sign in / out
export async function cloudSignIn(login: string, password: string) {
  const s = await client()
  let email = login.trim().toLowerCase()
  if (!email.includes('@')) {
    const { data } = await s.rpc('login_email', { login: email })
    email = (data as string | null) ?? ''
  }
  if (!email) return false
  const { error } = await s.auth.signInWithPassword({ email, password })
  return !error
}
export async function cloudSignOut() {
  meId = null
  cache = {}
  await (await client()).auth.signOut().catch(() => undefined)
}
export async function cloudSetOwnPassword(password: string) {
  const { error } = await (await client()).auth.updateUser({ password })
  if (error) throw new Error(error.message)
}
/** Asks the server to set another person's password (creating their Supabase sign-in account if they have none). */
export async function cloudSetPassword(userId: string, password: string) {
  const { data: { session } } = await (await client()).auth.getSession()
  const res = await fetch('/api/users/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ userId, password }),
  }).catch(() => null)
  const j = await res?.json().catch(() => null) as { success?: boolean; message?: string } | null
  if (!res?.ok || !j?.success) throw new Error(j?.message || 'Could not reach the server to set the password.')
}

// ------------------------------------------------------------------ write changes
type Op = () => PromiseLike<{ error: { message: string } | null }>
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const EMPTY = Object.fromEntries(SPECS.map((s) => [s.key, []]))
/** Table rows for some records of one collection (mapAll needs the whole user list to keep user references,
 *  so for users it maps everyone and the caller picks the changed rows). */
function rowsFor(next: DB, key: keyof DB, records: unknown[]): Tables {
  return mapAll({ db: { ...EMPTY, audit: [], ...pick(next, ['users', 'settings', 'counters', 'pfSettings', 'incentiveRules', 'version', 'upgrades']), incentiveHistory: [], rolePerms: {}, loginFails: {}, ...(key === 'users' ? {} : { [key]: records }) } as unknown as DB })
}
const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, o[k]]))
const idOf = (s: Spec, rec: unknown) => (rec as Record<string, unknown>)[s.idProp ?? 'id'] as string
const quoted = (ids: string[]) => `(${ids.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')})`
/** app_users rows carry the team lead separately in mapAll's output */
function withTeam(t: Tables): Row[] {
  const team = new Map((t.app_users_team ?? []).map((r) => [r.id, r.team_lead_id]))
  return (t.app_users ?? []).map((r) => ({ ...r, team_lead_id: team.get(r.id) ?? null }))
}

/** The writes that turn `prev` into `next` in the tables, in an order the foreign keys accept (exported for the check). */
export function plan(prev: DB, next: DB, s: SupabaseClient): Op[][] {
  const steps: Op[][] = []
  for (const spec of SPECS) {
    const a = (prev[spec.key] ?? []) as unknown[], b = (next[spec.key] ?? []) as unknown[]
    if (a === b) continue
    const before = new Map(a.map((r) => [idOf(spec, r), r]))
    const after = new Set(b.map((r) => idOf(spec, r)))
    const changed = b.filter((r) => before.get(idOf(spec, r)) !== r)
    const removed = [...before.keys()].filter((id) => !after.has(id))
    const idCol = spec.idCol ?? 'id'
    if (changed.length) {
      const t = rowsFor(next, spec.key, changed)
      const ids = new Set(changed.map((r) => idOf(spec, r)))
      const parentRows = (spec.table === 'app_users' ? withTeam(t) : t[spec.table] ?? []).filter((r) => ids.has(r[idCol] as string))
      const isNew = (id: string) => !before.has(id)
      const inserts = parentRows.filter((r) => isNew(r[idCol] as string)), updates = parentRows.filter((r) => !isNew(r[idCol] as string))
      steps.push([
        ...chunk(inserts, 500).map((part) => () => (spec.once ? s.from(spec.table).upsert(part, { onConflict: idCol, ignoreDuplicates: true }) : s.from(spec.table).insert(part))),
        ...updates.map((r) => () => s.from(spec.table).update(r).eq(idCol, r[idCol] as string)),
      ])
      const childOps: Op[] = []
      for (const c of spec.children ?? []) {
        const props = Array.isArray(c.prop) ? c.prop : [c.prop]
        for (const rec of changed) {
          const old = before.get(idOf(spec, rec)) as Record<string, unknown> | undefined
          const cur = rec as Record<string, unknown>
          if (old && props.every((p) => old[p] === cur[p])) continue
          const id = idOf(spec, rec)
          const rows = (t[c.table] ?? []).filter((r) => r[c.fk] === id)
          if (c.mode === 'replace') {
            childOps.push(async () => {
              const del = await s.from(c.table).delete().eq(c.fk, id)
              return del.error ? del : rows.length ? s.from(c.table).insert(rows) : del
            })
          } else if (c.mode === 'insertNew') {
            const had = new Set((old?.[props[0]] as unknown[] | undefined) ?? [])
            const fresh = ((cur[props[0]] as unknown[]) ?? []).filter((x) => !had.has(x))
            const add = rows.filter((r) => fresh.includes(r.user_id))
            if (add.length) childOps.push(() => s.from(c.table).upsert(add, { onConflict: `${c.fk},user_id`, ignoreDuplicates: true }))
          } else if (c.mode === 'append') {
            const list = (cur[props[0]] as unknown[]) ?? []
            const had = new Set((old?.[props[0]] as unknown[] | undefined) ?? [])
            // rows come out in the array's order, so the n-th row is the n-th entry
            let add = rows.filter((_, i) => !had.has(list[i]))
            if (c.newestFirst) add = add.reverse()
            if (add.length) childOps.push(() => s.from(c.table).insert(add))
          } else {
            const oldList = (old?.[props[0]] as { id: string }[] | undefined) ?? []
            const oldById = new Map(oldList.map((x) => [x.id, x]))
            const curList = (cur[props[0]] as { id: string }[] | undefined) ?? []
            const curIds = new Set(curList.map((x) => x.id))
            const rowById = new Map(rows.map((r) => [r.id as string, r]))
            const add = curList.filter((x) => !oldById.has(x.id)).map((x) => rowById.get(x.id)).filter(Boolean) as Row[]
            const upd = curList.filter((x) => oldById.has(x.id) && oldById.get(x.id) !== x).map((x) => rowById.get(x.id)).filter(Boolean) as Row[]
            const gone = oldList.filter((x) => !curIds.has(x.id)).map((x) => x.id)
            if (add.length) childOps.push(() => s.from(c.table).insert(add))
            for (const r of upd) childOps.push(() => s.from(c.table).update(r).eq('id', r.id as string))
            if (gone.length) childOps.push(() => s.from(c.table).delete().in('id', gone))
          }
        }
      }
      if (childOps.length) steps.push(childOps)
    }
    if (removed.length) steps.push(chunk(removed, 200).map((part) => () => s.from(spec.table).delete().filter(idCol, 'in', quoted(part))))
  }

  // settings rows: only the keys whose value changed
  if (SETTING_FIELDS.some((f) => prev[f] !== next[f])) {
    const was = new Map(rowsFor(prev, 'users', prev.users).app_settings.map((r) => [r.key, JSON.stringify(r.value)]))
    const rows = rowsFor(next, 'users', next.users).app_settings.filter((r) => was.get(r.key) !== JSON.stringify(r.value))
    if (rows.length) steps.push([() => s.from('app_settings').upsert(rows, { onConflict: 'key' })])
  }
  // role permissions: rewrite the roles that changed
  if (prev.rolePerms !== next.rolePerms) {
    const roles = Object.keys(next.rolePerms).filter((r) => prev.rolePerms[r as keyof DB['rolePerms']] !== next.rolePerms[r as keyof DB['rolePerms']])
    for (const role of roles) {
      const rows = [...new Set(next.rolePerms[role as keyof DB['rolePerms']])].map((permission) => ({ role, permission }))
      steps.push([async () => {
        const del = await s.from('role_permissions').delete().eq('role', role)
        return del.error ? del : s.from('role_permissions').insert(rows)
      }])
    }
  }
  // incentive rules: each saved version is kept
  if (prev.incentiveRules !== next.incentiveRules || prev.incentiveHistory !== next.incentiveHistory) {
    const had = new Set([...prev.incentiveHistory, prev.incentiveRules].map((v) => v?.version))
    const rows = mapAll({ db: { ...EMPTY, audit: [], ...pick(next, ['users', 'settings', 'counters', 'pfSettings', 'incentiveRules', 'incentiveHistory', 'version', 'upgrades']), rolePerms: {}, loginFails: {} } as unknown as DB })
      .incentive_rule_versions.filter((r) => !had.has(r.version as number))
    if (rows.length) steps.push([() => s.from('incentive_rule_versions').insert(rows)])
  }
  // audit log: new entries only (the app adds them at the front)
  if (prev.audit !== next.audit) {
    const had = new Set(prev.audit)
    const fresh = next.audit.filter((x) => !had.has(x))
    if (fresh.length) {
      const rows = mapAll({ db: { ...EMPTY, ...pick(next, ['users', 'settings', 'counters', 'pfSettings', 'incentiveRules', 'version', 'upgrades']), incentiveHistory: [], rolePerms: {}, loginFails: {}, audit: fresh } as unknown as DB }).audit_log
      steps.push([() => s.from('audit_log').insert(rows)])
    }
  }
  return steps
}

/** Writes the difference between two DB documents. Resolves with the error messages (empty when all saved). */
export async function pushChanges(prev: DB, next: DB): Promise<string[]> {
  const s = await client()
  const errors: string[] = []
  for (const step of plan(prev, next, s)) {
    const res = await Promise.all(step.map((op) => Promise.resolve(op()).then((r) => r, (e: unknown) => ({ error: { message: e instanceof Error ? e.message : String(e) } }))))
    for (const r of res) if (r.error) errors.push(r.error.message)
    if (errors.length) break // later steps may depend on this one
  }
  return errors
}

// ------------------------------------------------------------------ other people's changes
const tableKeys = new Set(ALL_TABLES.map(([t]) => t))
let channel: ReturnType<SupabaseClient['channel']> | null = null
/** Calls `onChange` with a freshly built DB document whenever someone changes a table this person can see. */
export async function watchCloud(onChange: (db: DB) => void) {
  const s = await client()
  if (channel) await s.removeChannel(channel)
  const dirty = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  channel = s.channel('crm-db').on('postgres_changes', { event: '*', schema: 'public' }, (p) => {
    if (!tableKeys.has(p.table)) return
    dirty.add(p.table)
    if (timer) clearTimeout(timer)
    // a burst of changes (one save touches several tables) reloads once
    timer = setTimeout(async () => {
      const names = [...dirty]; dirty.clear()
      await loadTables(names)
      onChange(rowsToDb(cache).db)
    }, 600)
  }).subscribe()
}
export async function unwatchCloud() {
  if (channel && sb) await sb.removeChannel(channel)
  channel = null
}
