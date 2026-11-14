<?php
/**
 * Rexera CRM 2.0 — connector for the old PHP CRM (read-only).
 *
 * Put this file and rexera-connector.config.php (made from rexera-connector.config.sample.php) in a folder of the
 * old CRM's website, e.g. public_html/rexera-sync/. The new CRM's server then reads the old CRM's data through it
 * and copies it into the new CRM — IT Support controls it from the new CRM (IT dashboard → Old CRM sync).
 *
 *  - Read-only: it only runs SELECT / CHECKSUM queries and reads files. Nothing in the old CRM is ever changed.
 *  - Every request must be signed with the shared secret (HMAC-SHA256) and be less than 5 minutes old.
 *  - Only the tables the import needs can be read, and only files inside the configured uploads folder.
 *  - Database passwords and the secret live in rexera-connector.config.php, never in this file.
 */
declare(strict_types=1);

const CONNECTOR_VERSION = '1.2.0';
const INDEX_TTL = 600; // the list of uploaded files is rebuilt at most every 10 minutes
const MAX_LIST = 5000;
const MAX_SKEW_SEC = 300;
const MAX_PAGE = 2000;
const MAX_FILE_BYTES = 52428800; // 50 MB
const MAIN_TABLES = ['users', 'services', 'service_stage_master', 'crm', 'crm_comments', 'crm_deductions', 'crm_workflow_steps', 'employee_service_stages',
  'client_documents', 'leads', 'lead_uploads', 'lead_assignments', 'lead_activity', 'notifications'];
const BILLING_TABLES = ['users', 'invoices', 'invoice_items'];

// PHP warnings never go into a reply (they would break the JSON and could show server paths)
ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function reply(int $status, array $body): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function fail(int $status, string $message): void { reply($status, ['ok' => false, 'error' => $message]); }

// ---------------------------------------------------------------------------- config
$configFile = __DIR__ . '/rexera-connector.config.php';
if (!is_file($configFile)) fail(500, 'rexera-connector.config.php is missing next to the connector.');
$config = require $configFile;
$secret = (string)($config['secret'] ?? '');
if (strlen($secret) < 32) fail(500, 'The secret in rexera-connector.config.php must be at least 32 characters.');
if (!empty($config['allowed_ips']) && !in_array($_SERVER['REMOTE_ADDR'] ?? '', (array)$config['allowed_ips'], true)) fail(403, 'This address may not use the connector.');

// ---------------------------------------------------------------------------- signature (same text as legacy-sync-protocol.mjs)
/** encodeURIComponent, as JavaScript does it */
function js_encode(string $s): string {
  return strtr(rawurlencode($s), ['%21' => '!', '%27' => "'", '%28' => '(', '%29' => ')', '%2A' => '*']);
}
$action = (string)($_GET['action'] ?? '');
$params = $_GET;
unset($params['action']);
$params = array_filter($params, fn($v) => $v !== '' && $v !== null);
ksort($params, SORT_STRING);
$query = implode('&', array_map(fn($k, $v) => js_encode((string)$k) . '=' . js_encode((string)$v), array_keys($params), $params));
$time = (int)($_SERVER['HTTP_X_REXERA_TIME'] ?? 0);
$sig = (string)($_SERVER['HTTP_X_REXERA_SIGNATURE'] ?? '');
if (!$time || abs(time() - $time) > MAX_SKEW_SEC) fail(401, 'Request expired — check the clocks of both servers.');
if (!hash_equals(hash_hmac('sha256', $time . "\n" . $action . "\n" . $query, $secret), $sig)) fail(401, 'Wrong signature — the secret on the two servers is different.');

// ---------------------------------------------------------------------------- databases
function db(array $config, string $which): ?PDO {
  static $cache = [];
  if (isset($cache[$which])) return $cache[$which];
  $c = $config[$which] ?? null;
  if (!$c || empty($c['name'])) return null;
  $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'] ?? 'localhost', (int)($c['port'] ?? 3306), $c['name']);
  try {
    // every value comes back as text (NULL stays null), the same as in a .sql export
    $pdo = new PDO($dsn, $c['user'] ?? '', $c['pass'] ?? '', [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => true, PDO::ATTR_STRINGIFY_FETCHES => true,
    ]);
  } catch (Throwable $e) {
    fail(502, "Could not connect to the $which database — check rexera-connector.config.php.");
  }
  // an extra guard where MySQL supports it (5.6.5+): this session can't write, whatever the user's rights
  try { $pdo->exec('SET SESSION TRANSACTION READ ONLY'); } catch (Throwable $e) { /* older MySQL: the connector only reads anyway */ }
  return $cache[$which] = $pdo;
}
function tables_of(string $which): array { return $which === 'billing' ? BILLING_TABLES : MAIN_TABLES; }
function existing_tables(PDO $pdo, array $allowed): array {
  $have = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
  return array_values(array_intersect($allowed, $have));
}
function primary_key(PDO $pdo, string $table): ?string {
  $st = $pdo->prepare("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION LIMIT 1");
  $st->execute([$table]);
  $c = $st->fetchColumn();
  return $c ? (string)$c : null;
}
function folder_size(string $dir): array {
  // cached for 10 minutes: walking a large uploads folder on every request is slow
  $cache = sys_get_temp_dir() . '/rexera-connector-size-' . md5($dir) . '.json';
  if (is_file($cache) && filemtime($cache) > time() - 600) { $c = json_decode((string)file_get_contents($cache), true); if (is_array($c)) return $c; }
  $bytes = 0; $files = 0;
  if (is_dir($dir)) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) if ($f->isFile()) { $bytes += $f->getSize(); $files++; }
  }
  $out = ['bytes' => $bytes, 'files' => $files, 'at' => date('c')];
  @file_put_contents($cache, json_encode($out));
  return $out;
}

// ---------------------------------------------------------------------------- uploaded files
/**
 * The old CRM's uploads folder(s): the one in the config, and — found by itself, so a wrong uploads_dir doesn't stop
 * the copy — an "uploads" folder next to this file or one level up. Only these folders can be read.
 */
function upload_dirs(array $config): array {
  $cands = [];
  $conf = (string)($config['uploads_dir'] ?? '');
  if ($conf !== '') {
    $cands[] = $conf;
    // a config pointing inside the uploads folder (e.g. uploads/client_documents): the uploads folder itself
    $p = $conf;
    for ($i = 0; $i < 4; $i++) { $p = dirname($p); if (strtolower(basename($p)) === 'uploads') { $cands[] = $p; break; } }
  }
  $root = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
  if ($root !== '') { $cands[] = $root . '/uploads'; $cands[] = $root . '/public_html/uploads'; }
  $cands[] = __DIR__ . '/uploads';
  $cands[] = dirname(__DIR__) . '/uploads';
  $cands[] = dirname(__DIR__, 2) . '/uploads';
  $out = [];
  foreach ($cands as $d) {
    // @: a folder outside the host's open_basedir limit warns instead of answering — a warning would break the JSON reply
    $r = @realpath($d);
    if ($r !== false && @is_dir($r) && !in_array($r, $out, true)) $out[] = $r;
  }
  // the folder with the most files first (the real uploads folder, when the config points at a wrong or empty one)
  usort($out, fn($a, $b) => folder_size($b)['files'] <=> folder_size($a)['files']);
  return $out;
}
/**
 * Every uploaded file in the main uploads folder: [path inside it, size, modified time], cached for INDEX_TTL seconds.
 * The new CRM matches these to the old client files (payment screenshots, documents, signed agreements, other uploads).
 */
function upload_index(string $dir): array {
  $cache = sys_get_temp_dir() . '/rexera-connector-index-' . md5($dir) . '.json';
  if (is_file($cache) && filemtime($cache) > time() - INDEX_TTL) { $c = json_decode((string)file_get_contents($cache), true); if (is_array($c)) return $c; }
  $out = [];
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $f) {
    if (!$f->isFile() || !readable_file($f->getPathname())) continue;
    $rel = str_replace('\\', '/', substr($f->getPathname(), strlen($dir) + 1));
    $out[] = [$rel, (int)$f->getSize(), (int)$f->getMTime()];
  }
  usort($out, fn($a, $b) => strcmp($a[0], $b[0]));
  @file_put_contents($cache, json_encode($out));
  return $out;
}
/** Never handed out, whatever the path: code and settings files (this connector's config holds passwords). */
function readable_file(string $full): bool {
  return !preg_match('/\.(php\d?|phtml|phar|inc|ini|env|htaccess|htpasswd|sql|log|sh|py|pl|cgi)$/i', $full) && basename($full)[0] !== '.';
}
/** A requested path (as the old CRM stored it, e.g. "uploads/client_documents/…") → the file, inside an uploads folder only. */
function find_upload(array $dirs, string $rel): ?string {
  $rel = ltrim(str_replace('\\', '/', $rel), '/');
  if ($rel === '' || strpos($rel, "\0") !== false) return null;
  $tries = [$rel, (string)preg_replace('#^\.?/?uploads/#i', '', $rel)];
  foreach ($dirs as $base) foreach (array_unique($tries) as $t) {
    $full = @realpath($base . '/' . $t);
    if ($full !== false && strpos($full, $base . DIRECTORY_SEPARATOR) === 0 && @is_file($full) && readable_file($full)) return $full;
  }
  // the old CRM often stored only the file name (payment screenshots): find it anywhere in the uploads folder
  $name = strtolower(basename($rel));
  if ($dirs && $name !== '') {
    foreach (upload_index($dirs[0]) as $f) {
      if (strtolower(basename($f[0])) !== $name) continue;
      $full = @realpath($dirs[0] . '/' . $f[0]);
      if ($full !== false && strpos($full, $dirs[0] . DIRECTORY_SEPARATOR) === 0 && @is_file($full) && readable_file($full)) return $full;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------- actions
$dirs = upload_dirs($config);
$uploads = $dirs[0] ?? false;

switch ($action) {
  case 'ping': {
    $out = ['ok' => true, 'app' => 'rexera-connector', 'version' => CONNECTOR_VERSION, 'php' => PHP_VERSION, 'name' => (string)($config['crm_name'] ?? 'Old CRM'),
      'logo' => (string)($config['logo_url'] ?? ''), 'time' => date('c'), 'databases' => [], 'uploads' => $uploads !== false, 'files' => true];
    foreach (['main', 'billing'] as $which) {
      $pdo = db($config, $which);
      if ($pdo) $out['databases'][$which] = ['mysql' => $pdo->query('SELECT VERSION()')->fetchColumn(), 'tables' => existing_tables($pdo, tables_of($which))];
    }
    reply(200, $out);
  }

  case 'stats': {
    $out = ['ok' => true, 'databases' => []];
    foreach (['main', 'billing'] as $which) {
      $pdo = db($config, $which);
      if (!$pdo) continue;
      $rows = $pdo->query('SELECT TABLE_NAME AS name, TABLE_ROWS AS rows_estimate, DATA_LENGTH AS data, INDEX_LENGTH AS idx FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')->fetchAll();
      $tables = []; $total = 0;
      foreach ($rows as $r) { $size = (int)$r['data'] + (int)$r['idx']; $total += $size; $tables[] = ['name' => $r['name'], 'rows' => (int)$r['rows_estimate'], 'bytes' => $size]; }
      usort($tables, fn($a, $b) => $b['bytes'] <=> $a['bytes']);
      $out['databases'][$which] = ['bytes' => $total, 'tables' => $tables];
    }
    // the uploads folder with the most files (the real one, when the config points at a wrong or empty folder)
    $best = null;
    foreach ($dirs as $d) { $s = folder_size($d) + ['dir' => basename($d)]; if (!$best || $s['files'] > $best['files']) $best = $s; }
    if ($best) $out['files'] = $best;
    $base = $uploads !== false ? $uploads : __DIR__;
    $free = @disk_free_space($base); $all = @disk_total_space($base);
    $out['disk'] = ['free' => $free === false ? null : (float)$free, 'total' => $all === false ? null : (float)$all];
    reply(200, $out);
  }

  case 'fingerprint': {
    // per table "rows:checksum" — the new CRM copies again only when something changed
    // the version too: a new connector makes the new CRM copy again (e.g. files it could not find before)
    $out = ['ok' => true, 'version' => CONNECTOR_VERSION, 'fingerprint' => []];
    foreach (['main', 'billing'] as $which) {
      $pdo = db($config, $which);
      if (!$pdo) continue;
      foreach (existing_tables($pdo, tables_of($which)) as $t) {
        $count = (int)$pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        $sum = '';
        try { $c = $pdo->query("CHECKSUM TABLE `$t`")->fetch(); $sum = (string)($c['Checksum'] ?? ''); } catch (Throwable $e) { $sum = ''; }
        $out['fingerprint'][$which][$t] = $count . ':' . $sum;
      }
    }
    reply(200, $out);
  }

  case 'rows': {
    $which = ($_GET['db'] ?? 'main') === 'billing' ? 'billing' : 'main';
    $table = (string)($_GET['table'] ?? '');
    if (!in_array($table, tables_of($which), true)) fail(400, 'This table can not be read.');
    $pdo = db($config, $which);
    if (!$pdo) fail(400, "No $which database in the config.");
    if (!in_array($table, existing_tables($pdo, [$table]), true)) reply(200, ['ok' => true, 'columns' => [], 'rows' => [], 'total' => 0]);
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $limit = min(MAX_PAGE, max(1, (int)($_GET['limit'] ?? MAX_PAGE)));
    $pk = primary_key($pdo, $table);
    $cols = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
    $order = $pk ? "`$pk`" : '`' . $cols[0] . '`';
    $rows = $pdo->query("SELECT * FROM `$table` ORDER BY $order LIMIT $limit OFFSET $offset")->fetchAll();
    $total = (int)$pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
    reply(200, ['ok' => true, 'columns' => $cols, 'rows' => $rows, 'total' => $total]);
  }

  case 'files': {
    // every uploaded file (path inside the uploads folder, size, modified), page by page
    if (!$dirs) fail(400, 'No uploads_dir in the config, and no uploads folder next to the connector.');
    $all = upload_index($dirs[0]);
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $limit = min(MAX_LIST, max(1, (int)($_GET['limit'] ?? MAX_LIST)));
    $page = array_map(fn($f) => ['path' => $f[0], 'size' => $f[1], 'mtime' => $f[2]], array_slice($all, $offset, $limit));
    reply(200, ['ok' => true, 'dir' => basename($dirs[0]), 'total' => count($all), 'files' => $page]);
  }

  case 'file': {
    if (!$dirs) fail(400, 'No uploads_dir in the config, and no uploads folder next to the connector.');
    // only inside an uploads folder, never code or settings files
    $full = find_upload($dirs, (string)($_GET['path'] ?? ''));
    if ($full === null) fail(404, 'File not found.');
    $size = filesize($full);
    if ($size === false || $size > MAX_FILE_BYTES) fail(413, 'File too large to copy (over 50 MB).');
    $type = function_exists('mime_content_type') ? (mime_content_type($full) ?: 'application/octet-stream') : 'application/octet-stream';
    header('Content-Type: ' . $type);
    header('Content-Length: ' . $size);
    readfile($full);
    exit;
  }

  default:
    fail(400, 'Unknown action.');
}
