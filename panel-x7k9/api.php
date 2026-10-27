<?php
/* ============================================================
   BharatApp Chat ADMIN API — separate from the public api/.
   Password-protected. Controls users: list / enable / disable / delete.
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require __DIR__ . '/../api/config.php';

/* Admin credentials — override in config.local.php on the server via ADMIN_USER / ADMIN_PASS_HASH.
   Default password is 'Kalisi@Admin2026' (CHANGE IT). Hash = sha256 of the password. */
if (!defined('ADMIN_USER'))       define('ADMIN_USER', 'someswara');
if (!defined('ADMIN_PASS_HASH'))  define('ADMIN_PASS_HASH', hash('sha256', 'Kalisi@Admin2026'));

set_error_handler(function($no,$str){ throw new ErrorException($str,0,$no); });

try {
  $pdo = new PDO('mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4', DB_USER, DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) { out(false, ['error' => 'db_connect_failed']); }

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? '';

/* login issues a short-lived admin token (stored server-side in k_admin_sessions) */
try {
  if ($action === 'login') { adminLogin($pdo, $in); }
  $admin = adminAuth($pdo, $in);   // all other actions require valid admin token
  switch ($action) {
    case 'stats':        adminStats($pdo); break;
    case 'list_users':   listUsers($pdo, $in); break;
    case 'set_disabled': setDisabled($pdo, $in); break;
    case 'delete_user':  deleteUser($pdo, $in); break;
    case 'create_user':  createUser($pdo, $in); break;
    case 'list_groups':  listGroups($pdo); break;
    case 'trace':        traceForward($pdo, $in); break;
    case 'wipe_all':     wipeAll($pdo); break;
    case 'logout':       $pdo->prepare('DELETE FROM k_admin_sessions WHERE token = ?')->execute([$in['token'] ?? '']); out(true, ['bye'=>1]); break;
    default:             out(false, ['error' => 'unknown_action']);
  }
} catch (Throwable $e) {
  out(false, ['error' => 'server_error', 'detail' => $e->getMessage()]);
}

/* ---------------- auth ---------------- */
function adminMigrate(PDO $pdo): void {
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_admin_sessions (
    token VARCHAR(64) PRIMARY KEY,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function adminLogin(PDO $pdo, array $in): void {
  adminMigrate($pdo);
  $u = (string)($in['user'] ?? '');
  $p = (string)($in['pass'] ?? '');
  if ($u !== ADMIN_USER || !hash_equals(ADMIN_PASS_HASH, hash('sha256', $p))) {
    usleep(400000); // slow brute force
    out(false, ['error' => 'bad_credentials']);
  }
  $token = bin2hex(random_bytes(24));
  $pdo->prepare('INSERT INTO k_admin_sessions (token, created_at) VALUES (?, NOW())')->execute([$token]);
  // clean sessions older than 12h
  $pdo->prepare('DELETE FROM k_admin_sessions WHERE created_at < (NOW() - INTERVAL 12 HOUR)')->execute();
  out(true, ['token' => $token]);
}
function adminAuth(PDO $pdo, array $in): bool {
  adminMigrate($pdo);
  $token = (string)($in['token'] ?? '');
  if ($token === '') out(false, ['error' => 'admin_auth_required']);
  $st = $pdo->prepare('SELECT 1 FROM k_admin_sessions WHERE token = ? AND created_at > (NOW() - INTERVAL 12 HOUR)');
  $st->execute([$token]);
  if (!$st->fetch()) out(false, ['error' => 'admin_auth_failed']);
  return true;
}

/* ---------------- actions ---------------- */
function adminStats(PDO $pdo): void {
  $u = (int)$pdo->query("SELECT COUNT(*) c FROM k_users")->fetch()['c'];
  $active = (int)$pdo->query("SELECT COUNT(*) c FROM k_users WHERE last_seen > (NOW() - INTERVAL 7 DAY)")->fetch()['c'];
  $disabled = (int)$pdo->query("SELECT COUNT(*) c FROM k_users WHERE disabled = 1")->fetch()['c'];
  $queue = (int)$pdo->query("SELECT COUNT(*) c FROM k_queue")->fetch()['c'];
  $groups = 0; try { $groups = (int)$pdo->query("SELECT COUNT(*) c FROM k_groups")->fetch()['c']; } catch (Throwable $e) {}
  out(true, ['stats' => ['users'=>$u,'active7d'=>$active,'disabled'=>$disabled,'queued'=>$queue,'groups'=>$groups]]);
}
function listUsers(PDO $pdo, array $in): void {
  $q = trim((string)($in['q'] ?? ''));
  $limit = min(500, max(10, (int)($in['limit'] ?? 200)));
  if ($q !== '') {
    $st = $pdo->prepare("SELECT kal_id, username, name, email, disabled, created_at, last_seen
                         FROM k_users WHERE username LIKE ? OR name LIKE ? OR kal_id LIKE ? OR email LIKE ?
                         ORDER BY last_seen DESC LIMIT $limit");
    $like = '%'.$q.'%'; $st->execute([$like,$like,$like,$like]);
  } else {
    $st = $pdo->query("SELECT kal_id, username, name, email, disabled, created_at, last_seen
                       FROM k_users ORDER BY last_seen DESC LIMIT $limit");
  }
  $rows = array_map(fn($r)=>[
    'kal_id'=>$r['kal_id'],'username'=>$r['username'],'name'=>$r['name'],
    'email'=>$r['email'] ?? null,
    'disabled'=>(int)$r['disabled'],
    'created_at'=>$r['created_at'],'last_seen'=>$r['last_seen']
  ], $st->fetchAll());
  out(true, ['users' => $rows]);
}
function setDisabled(PDO $pdo, array $in): void {
  $kid = strtoupper(trim((string)($in['kal_id'] ?? '')));
  $val = (int)($in['disabled'] ?? 1) ? 1 : 0;
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $kid)) out(false, ['error' => 'bad_id']);
  $pdo->prepare('UPDATE k_users SET disabled = ? WHERE kal_id = ?')->execute([$val, $kid]);
  out(true, ['kal_id' => $kid, 'disabled' => $val]);
}
/**
 * Make an account directly (e.g. a Play Store reviewer account, or a user who
 * can't receive email). The panel derives the key from the password in the
 * browser, exactly like sign-up, and sends only the public key, salt and
 * verifier. Any @username is allowed here, including letters-only names.
 * Leave the Gmail empty for an account that signs in with password alone.
 */
function createUser(PDO $pdo, array $in): void {
  $u = strtolower(trim((string)($in['username'] ?? ''), " @"));
  $name = trim((string)($in['name'] ?? ''));
  $email = strtolower(trim((string)($in['email'] ?? '')));
  $pub = $in['pubkey'] ?? null;
  $verifier = (string)($in['verifier'] ?? '');
  $salt = (string)($in['salt'] ?? '');
  if (!preg_match('/^[a-z0-9_]{3,30}$/', $u)) out(false, ['error' => 'bad_username']);
  if ($name === '' || mb_strlen($name) > 24) out(false, ['error' => 'bad_name']);
  if (!is_array($pub) || $verifier === '' || $salt === '' || strlen($verifier) > 128 || strlen($salt) > 128) out(false, ['error' => 'bad_input']);
  if ($email !== '') {
    // same form the sign-up stores, so Gmail login codes find the account
    if (!preg_match('/^([a-z0-9.+_-]{1,64})@(gmail\.com|googlemail\.com)$/', $email, $m)) out(false, ['error' => 'bad_email']);
    $email = str_replace('.', '', explode('+', $m[1], 2)[0]) . '@gmail.com';
  }
  $st = $pdo->prepare('SELECT 1 FROM k_users WHERE username = ?'); $st->execute([$u]);
  if ($st->fetch()) out(false, ['error' => 'username_taken']);
  if ($email !== '') {
    $st = $pdo->prepare('SELECT 1 FROM k_users WHERE email = ?'); $st->execute([$email]);
    if ($st->fetch()) out(false, ['error' => 'email_in_use']);
  }
  unset($pub['d']);
  $a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for ($i = 0; $i < 8; $i++) {
    $kid = 'KAL-';
    for ($j = 0; $j < 9; $j++) $kid .= $j === 4 ? '-' : $a[random_int(0, strlen($a) - 1)];
    try {
      $pdo->prepare('INSERT INTO k_users (kal_id, username, key_username, name, pubkey, token, email, verifier, salt, created_at, last_seen)
                     VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())')
          ->execute([$kid, $u, $u, $name, json_encode($pub), bin2hex(random_bytes(24)),
                     $email === '' ? null : $email, password_hash($verifier, PASSWORD_DEFAULT), $salt]);
      out(true, ['kal_id' => $kid, 'username' => $u]);
    } catch (PDOException $e) { /* id clash, try another */ }
  }
  out(false, ['error' => 'id_gen_failed']);
}

function deleteUser(PDO $pdo, array $in): void {
  $kid = strtoupper(trim((string)($in['kal_id'] ?? '')));
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $kid)) out(false, ['error' => 'bad_id']);
  $pdo->prepare('DELETE FROM k_users WHERE kal_id = ?')->execute([$kid]);
  $pdo->prepare('DELETE FROM k_queue WHERE to_id = ? OR from_id = ?')->execute([$kid,$kid]);
  $pdo->prepare('DELETE FROM k_status WHERE kal_id = ?')->execute([$kid]);
  $pdo->prepare('DELETE FROM k_blocks WHERE blocker = ? OR blocked = ?')->execute([$kid,$kid]);
  try { $pdo->prepare('DELETE FROM k_devices WHERE kal_id = ?')->execute([$kid]); } catch (Throwable $e) {}
  out(true, ['deleted' => $kid]);
}
function wipeAll(PDO $pdo): void {
  foreach (['k_queue','k_receipts','k_users','k_contacts','k_status','k_status_views','k_status_reacts','k_blocks','k_groups','k_fwd_log','k_email_otp','k_otp_log','k_devices'] as $t) {
    try { $pdo->exec("DELETE FROM $t"); } catch (Throwable $e) {}
  }
  out(true, ['wiped' => true]);
}
function listGroups(PDO $pdo): void {
  $rows = [];
  try {
    $st = $pdo->query("SELECT gid, name, owner, members, created_at FROM k_groups ORDER BY created_at DESC LIMIT 200");
    $rows = array_map(fn($r)=>[
      'gid'=>$r['gid'],'name'=>$r['name'],'owner'=>$r['owner'],
      'members'=>count(json_decode($r['members'],true) ?: []),'created_at'=>$r['created_at']
    ], $st->fetchAll());
  } catch (Throwable $e) {}
  out(true, ['groups' => $rows]);
}

/* Who first put a forwarded message into circulation. Takes the message text
   (fingerprinted exactly as the app does) or a 64-char fingerprint.
   The first row's received_from — or, if empty, its kal_id — is the
   earliest known originator. */
function fwdHash(string $kind, string $content): string {
  if ($kind === 'text') {
    $content = preg_replace('/(*UCP)\s+/u', ' ', preg_replace('/(*UCP)^\s+|\s+$/u', '', $content));
  }
  return hash('sha256', "kalisi-fwd-v1\n" . $kind . "\n" . $content);
}
function traceForward(PDO $pdo, array $in): void {
  $hash = strtolower(trim((string)($in['hash'] ?? '')));
  $text = (string)($in['text'] ?? '');
  if (!preg_match('/^[a-f0-9]{64}$/', $hash)) {
    if (trim($text) === '') out(false, ['error' => 'need_text_or_hash']);
    $hash = fwdHash('text', $text);
  }
  $rows = [];
  try {
    $st = $pdo->prepare("SELECT f.created_at, f.kal_id, u.username, u.email,
                                f.received_from, r.username AS from_username, r.email AS from_email
                         FROM k_fwd_log f
                         LEFT JOIN k_users u ON u.kal_id = f.kal_id
                         LEFT JOIN k_users r ON r.kal_id = f.received_from
                         WHERE f.hash = ? ORDER BY f.id ASC LIMIT 500");
    $st->execute([$hash]);
    $rows = $st->fetchAll();
  } catch (Throwable $e) {}
  $origin = null;
  if ($rows) {
    $f = $rows[0];
    $origin = $f['received_from'] !== ''
      ? ['kal_id'=>$f['received_from'],'username'=>$f['from_username'],'email'=>$f['from_email']]
      : ['kal_id'=>$f['kal_id'],'username'=>$f['username'],'email'=>$f['email']];
  }
  out(true, ['hash'=>$hash, 'origin'=>$origin, 'forwards'=>$rows]);
}

function out(bool $ok, array $data = []): void { echo json_encode(['ok' => $ok] + $data); exit; }
