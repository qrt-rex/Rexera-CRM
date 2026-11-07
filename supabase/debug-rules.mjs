/**
 * Auto-debug: what an error means and how it is fixed. Shared by the browser (src/lib/errorReport.ts), the server
 * (server/errors.mjs) and the tests. Each rule: a pattern, a short title, the diagnosis in plain words, how IT fixes it,
 * and — when the CRM can fix it by itself — what it does (`auto`), so the Error log can say "fixed automatically".
 */
export const SOURCES = ['browser', 'save', 'server', 'sync']

/** @type {{ code: string; test: RegExp; title: string; diagnosis: string; fix: string; auto?: string }[]} */
export const RULES = [
  { code: 'new-version', test: /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Loading chunk \S+ failed|Failed to fetch dynamically/i,
    title: 'The CRM was updated while a page was open',
    diagnosis: 'A new version was deployed; the open tab still asked for the old page files.',
    fix: 'Nothing to do — reloading the page loads the new version.',
    auto: 'Reloaded the page once with the new version.' },
  { code: 'sign-in-expired', test: /JWT expired|invalid JWT|Invalid Refresh Token|Refresh Token Not Found|session (has )?expired|Sign in again/i,
    title: 'Sign-in expired',
    diagnosis: 'The person’s sign-in session ran out (long idle, or signed out elsewhere).',
    fix: 'The person signs in again. If it happens to many people at once, check the Supabase Auth settings (JWT expiry).',
    auto: 'Renewed the sign-in session automatically where possible.' },
  { code: 'access-denied', test: /row-level security|permission denied|not allowed|You don.t have access|42501|\b403\b|managed by IT Support only/i,
    title: 'Blocked by access rules',
    diagnosis: 'Someone tried an action or opened data their role does not allow — the database refused it (data stays safe).',
    fix: 'If they should be allowed: IT dashboard → Access Control → give the role or the permission. Otherwise no action needed.' },
  { code: 'database-update-missing', test: /relation "?[\w.]+"? does not exist|column "?[\w.]+"? (of relation "?\w+"? )?does not exist|function [\w.]+\(.*\) does not exist|Could not find the '?\w+'? column|schema cache|Run the database update/i,
    title: 'A database update has not been run',
    diagnosis: 'The CRM’s code is newer than the database: a table, column or function it needs is missing.',
    fix: 'Supabase → SQL Editor → run supabase/run-now.sql (safe to run again; it only adds what is missing).' },
  { code: 'duplicate', test: /duplicate key value|already exists|23505/i,
    title: 'Duplicate record refused',
    diagnosis: 'A record with the same key already exists, so the database refused a second copy (no duplicate was made).',
    fix: 'Usually nothing: the first record is kept. If it repeats for the same record, open it and check it.' },
  { code: 'data-rule', test: /violates (foreign key|check|not-null) constraint|null value in column|invalid input (syntax|value) for|value too long|23503|23502|23514|22P02/i,
    title: 'Data that breaks a database rule',
    diagnosis: 'A value is missing, of the wrong kind, or points at a record that does not exist; the database refused just that record.',
    fix: 'Open the record named in the details and complete or correct it. The rest of the data was saved.' },
  { code: 'storage-full', test: /QuotaExceeded|exceeded the quota|out of space|The quota has been exceeded|storage.*full/i,
    title: 'Storage full',
    diagnosis: 'The browser’s storage or the Supabase plan’s storage is full.',
    fix: 'Free disk space on that computer, or check IT dashboard → Old CRM sync → Storage for the Supabase limits (upgrade the plan if needed).' },
  // old CRM sync
  { code: 'sync-wrong-secret', test: /Wrong signature/i,
    title: 'Old CRM sync: the two secrets differ',
    diagnosis: 'LEGACY_SYNC_SECRET on Render and `secret` in rexera-connector.config.php are not the same text.',
    fix: 'Copy the same secret into both places (Render → Environment, and the config file on Hostinger), then Test connection.' },
  { code: 'sync-clock', test: /Request expired/i,
    title: 'Old CRM sync: server clocks differ',
    diagnosis: 'A signed request arrived more than 5 minutes off the old CRM server’s clock.',
    fix: 'Usually passes by itself. If it keeps happening, ask Hostinger support to check the server time.',
    auto: 'Tried again on the next check.' },
  { code: 'sync-secret-missing', test: /LEGACY_SYNC_SECRET is not set/i,
    title: 'Old CRM sync: secret missing on the server',
    diagnosis: 'Render has no LEGACY_SYNC_SECRET (or it is shorter than 32 characters).',
    fix: 'Render → Rexera-CRM → Environment → add LEGACY_SYNC_SECRET (the same as in the connector config) → save.' },
  { code: 'sync-old-database', test: /Could not connect to the (main|billing) database/i,
    title: 'Old CRM sync: the connector can’t open the old database',
    diagnosis: 'The database name, user or password in rexera-connector.config.php is wrong, or the database user lost its rights.',
    fix: 'Hostinger hPanel → Databases: check the name, user and password, and put them in rexera-connector.config.php.' },
  { code: 'sync-file-missing', test: /File not found|No uploads_dir/i,
    title: 'Old CRM sync: an uploaded file is missing',
    diagnosis: 'The old CRM lists a document whose file is not in the connector’s uploads folder (wrong uploads_dir, or the file was deleted).',
    fix: 'Check uploads_dir in rexera-connector.config.php points at the old CRM’s real uploads folder. Files found later are copied by themselves.',
    auto: 'Tried again on the next copies (3 times), then set aside so the rest keeps copying.' },
  { code: 'sync-connector-missing', test: /is the connector file at that address|answered 404/i,
    title: 'Old CRM sync: connector file not found',
    diagnosis: 'Nothing answers at the connector address.',
    fix: 'Upload rexera-connector.php to the old CRM’s website and check the address in Settings.' },
  // connection problems last: other rules are more specific
  { code: 'connection', test: /Failed to fetch|NetworkError|Load failed|network (request|connection)|ERR_NETWORK|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|did not answer in time|Could not reach|fetch failed|AbortError|timed? ?out/i,
    title: 'Connection problem',
    diagnosis: 'A request could not reach the server (internet dropped, the server was waking up, or the other side was down).',
    fix: 'Usually passes by itself. If it keeps happening for everyone, check Render (service Live?) and Supabase status.',
    auto: 'Tried again automatically.' },
  { code: 'code-error', test: /Cannot read propert|undefined is not|null is not|is not a function|is not defined|is not iterable|Maximum call stack|Unexpected token|Invalid time value|toFixed is not/i,
    title: 'Program error on a page',
    diagnosis: 'A page met data it did not expect and stopped. The data itself is safe; the page showed Reload / Back to dashboard.',
    fix: 'Send the page address and the details below to the developer. Reloading usually gets the person going again.' },
]

const FALLBACK = { code: 'unknown', title: 'Unexpected error', diagnosis: 'An error the CRM has no explanation for yet.', fix: 'Look at the details and the page where it happened; send them to the developer if it repeats.' }

/** The diagnosis of one error message. */
export function diagnose(message) {
  const m = String(message ?? '')
  const r = RULES.find((x) => x.test.test(m))
  return r ? { code: r.code, title: r.title, diagnosis: r.diagnosis, fix: r.fix, auto: r.auto ?? null } : { ...FALLBACK, auto: null }
}

/** Numbers, ids, addresses and quotes taken out, so the same error always groups under one key. */
export function normalize(message) {
  return String(message ?? '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(lg|b|u|l|c|d|f|file|a|n|t|p|inv)-[\w-]{3,}/g, '<id>')
    .replace(/\b\d[\d,.:/-]*\b/g, '#')
    .replace(/"[^"]{0,80}"|'[^']{0,80}'/g, '"…"')
    .replace(/\s+/g, ' ').trim().slice(0, 300)
}
/** The page an error belongs to, without record ids (/bookings/lg-b-12 → /bookings/:id). */
export const placeOf = (p) => String(p ?? '').split('?')[0].replace(/\/(lg-|b-|l-|u-|c-|inv-)?[\w-]*\d[\w-]*(?=\/|$)/g, '/:id').slice(0, 120)

/** One key per kind of error per place (cyrb53, hex). */
export function errorKey(source, message, place) {
  const s = `${source}|${diagnose(message).code}|${normalize(message)}|${placeOf(place)}`
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** Browser noise that is not the CRM's (extensions, the browser's own layout warnings). */
export const isNoise = (message, file = '') =>
  /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|^cancelled$|AbortError: The user aborted/i.test(`${message} ${file}`)

/** A report as the server stores it (checks sizes; `autoFixed` = what the reporter already fixed). */
export function toRecord(r, userId) {
  const source = SOURCES.includes(r?.source) ? r.source : 'browser'
  const message = String(r?.message ?? '').slice(0, 2000)
  if (!message.trim()) return null
  const place = String(r?.place ?? '').slice(0, 300)
  const d = diagnose(message)
  const auto = typeof r?.autoFixed === 'string' && r.autoFixed ? r.autoFixed.slice(0, 300) : null
  return {
    p_key: errorKey(source, message, place), p_source: source, p_code: d.code, p_title: d.title, p_message: message,
    p_detail: r?.detail ? String(r.detail).slice(0, 4000) : null, p_place: placeOf(place) || null, p_user: userId ?? null,
    p_diagnosis: d.diagnosis, p_fix: d.fix, p_auto_fix: auto ?? null, p_status: auto ? 'auto_fixed' : 'open',
    p_count: Math.min(1000, Math.max(1, Number(r?.count) || 1)),
  }
}
