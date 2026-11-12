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

const CONNECTOR_VERSION = '1.1.0';
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
  $out = [];
  foreach ([(string)($config['uploads_dir'] ?? ''), __DIR__ . '/uploads', dirname(__DIR__) . '/uploads'] as $d) {
    // @: a folder outside the host's open_basedir limit warns instead of answering — a warning would break the JSON reply
    $r = $d !== '' ? @realpath($d) : false;
    if ($r !== false && @is_dir($r) && !in_array($r, $out, true)) $out[] = $r;
  }
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
  return null;
}

// ---------------------------------------------------------------------------- actions
$dirs = upload_dirs($config);
$uploads = $dirs[0] ?? false;

switch ($action) {
  case 'ping': {
    $out = ['ok' => true, 'app' => 'rexera-connector', 'version' => CONNECTOR_VERSION, 'php' => PHP_VERSION, 'name' => (string)($config['crm_name'] ?? 'Old CRM'),
      'logo' => (string)($config['logo_url'] ?? ''), 'time' => date('c'), 'databases' => [], 'uploads' => $uploads !== false];
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
    $out = ['ok' => true, 'fingerprint' => []];
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
