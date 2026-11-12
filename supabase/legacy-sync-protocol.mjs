/**
 * Old CRM → new CRM sync: the protocol between the new CRM's server and the connector file added to the old PHP CRM
 * (public/old-crm-connector/rexera-connector.php). Shared by the server and its tests.
 *
 *  * The connector is read-only: it never writes to the old CRM. Every request is signed with a secret both sides know
 *    (LEGACY_SYNC_SECRET on the new CRM's server = REXERA_SYNC_SECRET in the connector's config file):
 *    X-Rexera-Time: unix seconds · X-Rexera-Signature: hex HMAC-SHA256(secret, "<time>\n<action>\n<query>").
 *    The connector refuses requests older than 5 minutes or with a wrong signature.
 *  * Actions: ping · stats (storage) · fingerprint (cheap "did anything change?") · rows (a table, page by page) · file.
 *  * The import itself is the CRM's own old-CRM import (src/lib/legacyImport.ts): ids come from the old ids (lg-…), so
 *    running it again updates records instead of duplicating them; nothing in the new CRM is ever deleted by a sync.
 */
export const MAIN_TABLES = [
  'users', 'services', 'service_stage_master', 'crm', 'crm_comments', 'crm_deductions', 'crm_workflow_steps', 'employee_service_stages',
  'client_documents', 'leads', 'lead_uploads', 'lead_assignments', 'lead_activity', 'notifications',
]
/** the old billing database (staff full names, invoices) — optional */
export const BILLING_TABLES = ['users', 'invoices', 'invoice_items']
export const MAX_SKEW_SEC = 300
export const PAGE = 2000
export const INTERVALS = [15, 30, 60, 300, 900]

/** The text that is signed: time, action and the query string sorted by key (so both sides build the same text). */
export function signedText(time, action, params = {}) {
  const q = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '').sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&')
  return `${time}\n${action}\n${q}`
}
export async function hmacHex(secret, text) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Headers for one request to the connector. */
export async function signRequest(secret, action, params = {}, now = Date.now()) {
  const time = String(Math.floor(now / 1000))
  return { 'X-Rexera-Time': time, 'X-Rexera-Signature': await hmacHex(secret, signedText(time, action, params)) }
}
/** The connector's check (the PHP file does the same); also used by the test connector. */
export async function verifyRequest(secret, headers, action, params = {}, now = Date.now()) {
  const time = Number(headers['x-rexera-time'] ?? headers['X-Rexera-Time'])
  const sig = String(headers['x-rexera-signature'] ?? headers['X-Rexera-Signature'] ?? '')
  if (!Number.isFinite(time) || Math.abs(now / 1000 - time) > MAX_SKEW_SEC) return 'Request expired — check the clocks of both servers.'
  const want = await hmacHex(secret, signedText(String(time), action, params))
  if (want.length !== sig.length || !timingSafeEqual(want, sig)) return 'Wrong signature — the secret on the two servers is different.'
  return null
}
function timingSafeEqual(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

/** A secret good enough to protect client data: 32+ characters, not a word. */
export const secretProblem = (s) => (!s ? 'Not set' : s.length < 32 ? 'Too short — use at least 32 random characters' : null)

/** One text for a fingerprint answer ({ main: { table: "count:checksum" }, billing: {…} }) — equal text = nothing changed. */
export const fingerprintKey = (fp) => JSON.stringify(Object.fromEntries(Object.entries(fp ?? {}).sort(([a], [b]) => a.localeCompare(b))
  .map(([db, t]) => [db, Object.fromEntries(Object.entries(t ?? {}).sort(([a], [b]) => a.localeCompare(b)))])))

/** Which tables changed between two fingerprints (for the activity log). */
export function changedTables(before, after) {
  const out = []
  for (const db of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    for (const t of new Set([...Object.keys(before?.[db] ?? {}), ...Object.keys(after?.[db] ?? {})])) {
      if (before?.[db]?.[t] !== after?.[db]?.[t]) out.push(db === 'main' ? t : `${db}.${t}`)
    }
  }
  return out.sort()
}

/**
 * The rows to write: for each table, the rows of `next` that are new or differ from `prev` (compared as JSON, by the
 * table's conflict key). Nothing is ever deleted.
 */
export function rowsToWrite(prev, next, order) {
  const out = {}
  for (const [table, onConflict] of order) {
    const keys = onConflict.split(',')
    const keyOf = (r) => keys.map((k) => String(r[k] ?? '')).join('\u0001')
    const was = new Map((prev[table] ?? []).map((r) => [keyOf(r), JSON.stringify(r)]))
    const changed = (next[table] ?? []).filter((r) => was.get(keyOf(r)) !== JSON.stringify(r))
    if (changed.length) out[table] = changed
  }
  return out
}

/**
 * The new CRM's tables the old-CRM import fills, in write order (parents first). Nothing else is ever written by a
 * sync: roles, permissions, settings, team assignments and the rest of the new CRM stay as they are.
 */
export const SYNC_TABLES = [
  ['app_users', 'id'], ['services', 'id'], ['lead_uploads', 'id'], ['leads', 'id'], ['lead_calls', 'id'],
  ['bookings', 'id'], ['booking_payments', 'id'], ['booking_approvals', 'id'], ['booking_stage_moves', 'id'], ['booking_comments', 'id'],
  ['booking_documents', 'id'], ['booking_tasks', 'id'], ['invoices', 'id'], ['invoice_items', 'invoice_id,position'], ['notifications', 'id'],
]

/** A short, stable hash of a row (53-bit, as hex) — what the sync last wrote, to spot changes made in the new CRM. */
export function rowHash(row) {
  const s = JSON.stringify(row)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * What one sync writes. For every row the import produces:
 *  - not in the new CRM yet → added;
 *  - the same → nothing;
 *  - different: if the new CRM's row is still exactly what the sync last wrote (nobody changed it here) → updated
 *    with the old CRM's change; if someone changed it in the new CRM (or the sync never wrote it) → kept as it is,
 *    unless `prefer` is 'old' (take the old CRM's version).
 * Never deletes. `synced`: Map "table|key" → hash of what the sync last wrote. Returns the rows to write per table,
 * the hashes to remember and counts per table.
 */
export function planWrites(prev, next, synced, prefer = 'new', tables = SYNC_TABLES) {
  const writes = {}, hashes = [], counts = {}
  for (const [table, onConflict] of tables) {
    const keys = onConflict.split(',')
    const keyOf = (r) => keys.map((k) => String(r[k] ?? '')).join('|')
    const cur = new Map((prev[table] ?? []).map((r) => [keyOf(r), r]))
    const c = { added: 0, updated: 0, kept: 0, same: 0 }
    for (const row of next[table] ?? []) {
      const key = keyOf(row), have = cur.get(key), h = rowHash(row)
      const remember = () => hashes.push({ table_name: table, row_key: key, hash: h })
      if (!have) { (writes[table] ??= []).push(row); remember(); c.added++; continue }
      const hh = rowHash(have)
      if (hh === h) { c.same++; if (synced.get(`${table}|${key}`) !== h) remember(); continue }
      if (synced.get(`${table}|${key}`) === hh || prefer === 'old') { (writes[table] ??= []).push(row); remember(); c.updated++ }
      else c.kept++
    }
    if (c.added || c.updated || c.kept) counts[table] = c
  }
  return { writes, hashes, counts }
}

// ------------------------------------------------------------------ self-repair of old data the database refuses
/** links to a parent record: refused only while the parent itself is missing — never cut, saved with the parent */
const PARENT_COLS = ['booking_id', 'lead_id', 'invoice_id', 'upload_id']
/** known ranges of the new CRM's rules */
const RANGES = { stage: [1, 9], max_stage: [1, 9], gst_rate: [0, 28], success_fee_pct: [0, 100], part: [1, 1000], position: [0, 100000] }
/** the column a constraint is about: Postgres names them "<table>_<column>_check" / "<table>_<column>_fkey" */
const columnOf = (table, constraint, row, suffix) => {
  const c = constraint.startsWith(`${table}_`) && constraint.endsWith(suffix) ? constraint.slice(table.length + 1, -suffix.length) : ''
  return c && c in row ? c : null
}
/** a sensible value for an empty required column, from its name */
export function defaultFor(column) {
  if (/(_at|_on|date|time)$/.test(column)) return new Date().toISOString()
  if (/^stage$|^max_stage$|^part$/.test(column)) return 1
  if (/amount|total|pct|rate|count|price|fee|qty|position|deduction|balance|paid/.test(column)) return 0
  if (/^(is|has)_|active|enabled|verified/.test(column)) return false
  return ''
}

/**
 * One repair for a record the database refused (or null when it can't be repaired here). Changes only the one value
 * the error names; the caller retries, so several problems in one record are repaired one after the other.
 * Returns { column, to, why }.
 */
export function repairStep(table, row, message) {
  const msg = String(message ?? '')
  let m
  if ((m = msg.match(/violates foreign key constraint "([^"]+)"/))) {
    const col = columnOf(table, m[1], row, '_fkey')
    if (!col || PARENT_COLS.includes(col) || row[col] == null) return null
    return { column: col, to: null, why: 'pointed at a record that is not in the CRM (e.g. a removed user) — link left empty' }
  }
  if ((m = msg.match(/null value in column "([^"]+)"/))) {
    const col = m[1]
    return { column: col, to: defaultFor(col), why: 'empty in the old CRM — filled with a default' }
  }
  if ((m = msg.match(/value too long for type character varying\((\d+)\)/))) {
    const n = Number(m[1])
    const col = Object.keys(row).find((k) => typeof row[k] === 'string' && row[k].length > n)
    return col ? { column: col, to: row[col].slice(0, n), why: `longer than ${n} characters — shortened` } : null
  }
  if ((m = msg.match(/violates check constraint "([^"]+)"/))) {
    const col = columnOf(table, m[1], row, '_check')
    if (!col) return null
    const v = row[col]
    if (RANGES[col] && typeof v === 'number') {
      const [lo, hi] = RANGES[col]
      const to = Math.min(hi, Math.max(lo, v))
      return to !== v ? { column: col, to, why: `outside the allowed ${lo}–${hi} — set to ${to}` } : null
    }
    if (typeof v === 'number' && v < 0) return { column: col, to: 0, why: 'negative, not allowed here — set to 0' }
    if (v !== null && v !== undefined && v !== '') return { column: col, to: null, why: 'a value this field does not accept — left empty (the old value is in the log)' }
    return null
  }
  if ((m = msg.match(/invalid input (?:syntax|value) for (?:type )?[\w ]+: "([^"]*)"/)) || (m = msg.match(/(?:date\/time field value|value) out of range[^"]*"([^"]*)"/))) {
    const bad = m[1]
    const col = Object.keys(row).find((k) => row[k] != null && String(row[k]) === bad)
    return col ? { column: col, to: null, why: `"${bad}" is not a valid value for this field — left empty` } : null
  }
  return null
}

/** Repairs made before (table|key → column → {from, to}), applied again to the newly read old data while the old value is unchanged. */
export function applyRepairs(rows, repairs, tables = SYNC_TABLES) {
  let n = 0
  for (const [table, onConflict] of tables) {
    const keys = onConflict.split(',')
    for (const row of rows[table] ?? []) {
      const fix = repairs?.[`${table}|${keys.map((k) => String(row[k] ?? '')).join('|')}`]
      if (!fix) continue
      for (const [col, { from, to }] of Object.entries(fix)) if (JSON.stringify(row[col] ?? null) === JSON.stringify(from ?? null)) { row[col] = to; n++ }
    }
  }
  return n
}

/** "1.2 GB" */
export const bytesText = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}
