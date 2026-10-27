<?php
/* ============================================================
   Kalisi Relay API v1 — relay-and-delete message queue
   The server stores ONLY: kalisi IDs, public keys, and
   encrypted blobs it cannot read — deleted on delivery.
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

set_error_handler(function($no,$str){ throw new ErrorException($str,0,$no); });
require __DIR__ . '/config.php';

try {
  $pdo = new PDO('mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4', DB_USER, DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) { out(false, ['error' => 'db_connect_failed']); }

migrate($pdo);

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? ($_GET['action'] ?? '');

try {
  switch ($action) {
    case 'email_otp_send': emailOtpSend($pdo, $in); break;
    case 'login_otp_send':   loginOtpSend($pdo, $in); break;
    case 'login_otp_verify': loginOtpVerify($pdo, $in); break;
    case 'device_list':   deviceList($pdo, $in); break;
    case 'account_delete': accountDelete($pdo, $in); break;
    case 'device_remove': deviceRemove($pdo, $in); break;
    case 'register':  register($pdo, $in); break;
    case 'lookup':    lookup($pdo, $in); break;
    case 'send':      send($pdo, $in); break;
    case 'fetch':     fetchMsgs($pdo, $in); break;
    case 'check':     checkUsername($pdo, $in); break;
    case 'change_username': changeUsername($pdo, $in); break;
    case 'recover_salt':  recoverSalt($pdo, $in); break;
    case 'recover_login': recoverLogin($pdo, $in); break;
    case 'profile_update': profileUpdate($pdo, $in); break;
    case 'contacts_profiles': contactsProfiles($pdo, $in); break;
    case 'block':     blockUser($pdo, $in); break;
    case 'unblock':   unblockUser($pdo, $in); break;
    case 'status_post':   statusPost($pdo, $in); break;
    case 'status_feed':   statusFeed($pdo, $in); break;
    case 'group_create':  groupCreate($pdo, $in); break;
    case 'group_send':    groupSend($pdo, $in); break;
    case 'group_info':    groupInfo($pdo, $in); break;
    case 'group_update':  groupUpdate($pdo, $in); break;
    case 'req_send':      reqSend($pdo, $in); break;
    case 'req_list':      reqList($pdo, $in); break;
    case 'req_act':       reqAct($pdo, $in); break;
    case 'contacts_state': contactsState($pdo, $in); break;
    case 'presence':      presence($pdo, $in); break;
    case 'fcm_register':  fcmRegister($pdo, $in); break;
    case 'status_view':   statusView($pdo, $in); break;
    case 'status_viewers': statusViewers($pdo, $in); break;
    case 'status_delete':  statusDelete($pdo, $in); break;
    case 'status_react':   statusReact($pdo, $in); break;
    case 'status_reactions': statusReactions($pdo, $in); break;
    case 'ping':      out(true, ['pong' => time()]); break;
    case 'push_check': pushCheck($pdo, $in); break;
    case 'push_test':  pushTest($pdo, $in); break;
    default:          out(false, ['error' => 'unknown_action']);
  }
} catch (Throwable $e) {
  out(false, ['error' => 'server_error', 'detail' => $e->getMessage()]);
}

/* ---------------- endpoints ---------------- */

function register(PDO $pdo, array $in): void {
  $name = trim((string)($in['name'] ?? ''));
  $username = strtolower(trim((string)($in['username'] ?? ''), " @"));
  $pubkey = $in['pubkey'] ?? null; // JWK (public only)
  if ($name === '' || mb_strlen($name) > 24 || !is_array($pubkey)) out(false, ['error' => 'bad_input']);
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $username)) out(false, ['error' => 'bad_username']);
  // Every new account is tied to a verified Gmail address. It is kept on the
  // server only — lookups, profiles and contacts never return it. A persona
  // made from an account that is already signed in takes that account's email.
  $email = registrationEmail($pdo, $in);
  $st = $pdo->prepare('SELECT kal_id, last_seen FROM k_users WHERE username = ?'); $st->execute([$username]);
  if ($ex = $st->fetch()) {
    if (strtotime($ex['last_seen']) < time() - 90*86400) {
      // inactive 90+ days: release the handle (account keeps its KAL-ID)
      $pdo->prepare("UPDATE k_users SET username = '' WHERE kal_id = ?")->execute([$ex['kal_id']]);
    } else {
      out(false, ['error' => 'username_taken']);
    }
  }
  unset($pubkey['d']); // never accept private material

  // Optional account recovery. The app derives its key from the password, so
  // we only ever store a hash to check against — never the password, never
  // anything that could decrypt a message.
  $verifier = (string)($in['verifier'] ?? '');
  $salt     = (string)($in['salt'] ?? '');
  if ($verifier !== '') {
    if (strlen($verifier) > 128 || strlen($salt) > 128) {
      out(false, ['error' => 'bad_input']);
    }
    try { $pdo->exec("ALTER TABLE k_users ADD COLUMN verifier VARCHAR(160) NULL"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE k_users ADD COLUMN salt VARCHAR(160) NULL"); } catch (Throwable $e) {}
  }

  $token = bin2hex(random_bytes(24));
  for ($i = 0; $i < 8; $i++) {
    $kid = kalId();
    try {
      if ($verifier !== '') {
        $st = $pdo->prepare('INSERT INTO k_users (kal_id, username, name, pubkey, token, email, verifier, salt, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())');
        $st->execute([$kid, $username, $name, json_encode($pubkey), $token, $email,
                      password_hash($verifier, PASSWORD_DEFAULT), $salt]);
      } else {
        $st = $pdo->prepare('INSERT INTO k_users (kal_id, username, name, pubkey, token, email, created_at, last_seen) VALUES (?,?,?,?,?,?,NOW(),NOW())');
        $st->execute([$kid, $username, $name, json_encode($pubkey), $token, $email]);
      }
      // the code has done its job — it can't be used for a second account
      if ($email !== null && !empty($in['email_code'])) {
        $pdo->prepare('DELETE FROM k_email_otp WHERE email = ?')->execute([$email]);
      }
      out(true, ['kal_id' => $kid, 'username' => $username, 'token' => $token]);
    } catch (PDOException $e) { /* duplicate id, retry */ }
  }
  out(false, ['error' => 'id_gen_failed']);
}

function lookup(PDO $pdo, array $in): void {
  $h = trim((string)($in['handle'] ?? ($in['kal_id'] ?? '')));
  if (preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/i', $h)) {
    $st = $pdo->prepare('SELECT kal_id, username, name, pubkey FROM k_users WHERE kal_id = ?');
    $st->execute([strtoupper($h)]);
  } else {
    $u = strtolower(trim($h, " @"));
    if (!preg_match('/^[a-z0-9_]{3,20}$/', $u)) out(false, ['error' => 'bad_id']);
    $st = $pdo->prepare('SELECT kal_id, username, name, pubkey FROM k_users WHERE username = ?');
    $st->execute([$u]);
  }
  $u = $st->fetch();
  if (!$u) out(false, ['error' => 'not_found']);
  $avatar = null;
  try {
    $av = $pdo->prepare('SELECT avatar FROM k_users WHERE kal_id = ?');
    $av->execute([$u['kal_id']]);
    $val = $av->fetchColumn();
    if ($val) $avatar = $val;
  } catch (Throwable $e) { /* column not created yet — ignore */ }
  out(true, ['user' => ['kal_id' => $u['kal_id'], 'username' => $u['username'], 'name' => $u['name'], 'pubkey' => json_decode($u['pubkey'], true), 'avatar' => $avatar]]);
}

function send(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $to = strtoupper(trim((string)($in['to'] ?? '')));
  $blob = (string)($in['blob'] ?? '');       // base64 AES-GCM ciphertext — opaque to server
  $iv = (string)($in['iv'] ?? '');
  $cid = substr((string)($in['client_id'] ?? ''), 0, 32); // sender's message id, for receipt matching
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $to) || $blob === '' || strlen($blob) > 900000) out(false, ['error' => 'bad_input']);
  $st = $pdo->prepare('SELECT 1 FROM k_users WHERE kal_id = ?'); $st->execute([$to]);
  if (!$st->fetch()) out(false, ['error' => 'recipient_not_found']);
  $st = $pdo->prepare('SELECT 1 FROM k_blocks WHERE blocker = ? AND blocked = ?'); $st->execute([$to, $me['kal_id']]);
  if ($st->fetch()) { out(true, ['queued' => true]); } // silently drop (blocked)
  // contact-request gate: must be accepted in either direction (groups bypass via gid handled in group_send)
  $st = $pdo->prepare("SELECT status FROM k_contacts WHERE (a=? AND b=?) OR (a=? AND b=?) LIMIT 1");
  $st->execute([$me['kal_id'],$to,$to,$me['kal_id']]);
  $rel = $st->fetch();
  if (!$rel || $rel['status'] !== 'accepted') out(false, ['error' => 'not_connected']);
  deliver($pdo, $to, $me['kal_id'], $cid, $iv, $blob);
  if (!empty($in['echo'])) echoToMyDevices($pdo, $me, $to, $cid, $iv, $blob);
  logForward($pdo, $in, $me['kal_id']);
  // best-effort push (content stays private — generic text only)
  $sname = '';
  $us = $pdo->prepare('SELECT username FROM k_users WHERE kal_id=?'); $us->execute([$me['kal_id']]);
  $u = $us->fetch(); $sname = $u && $u['username'] ? '@'.$u['username'] : 'Someone';
  // A call offer must wake the phone; ordinary messages get the usual alert.
  $hint = (string)($in['push'] ?? 'message');   // app says what this is
  if (str_starts_with($hint, 'call')) {
    if ($hint === 'call-offer') {
      sendPush($pdo, $to, $sname, 'Incoming voice call', $me['kal_id'], 'call');
    }
    // other call signalling is silent — the app is already awake by then
  } else {
    sendPush($pdo, $to, 'Kalisi', $sname.' sent you a message', $me['kal_id']);
  }
  out(true, ['queued' => true]);
}

function fetchMsgs(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $out = ['messages' => [], 'receipts' => []];

  // 1) drain my incoming messages, deleting each and issuing a deletion receipt to the sender
  // Each logged-in device has its own copy, so the phone and the browser
  // both get every message.
  $st = $pdo->prepare('SELECT * FROM k_queue WHERE to_id = ? AND dev = ? ORDER BY id ASC LIMIT 100');
  $st->execute([$me['kal_id'], $me['dev']]);
  $rows = $st->fetchAll();
  foreach ($rows as $r) {
    $pdo->prepare('DELETE FROM k_queue WHERE id = ?')->execute([$r['id']]);
    $receipt = hash('sha256', $r['id'].'|'.$r['payload'].'|'.microtime(true).'|deleted');
    if ($r['peer'] !== '') {
      // a message I sent from another of my devices — "to" says which chat
      $out['messages'][] = ['from' => $r['from_id'], 'to' => $r['peer'], 'iv' => $r['iv'], 'blob' => $r['payload'], 'ts' => strtotime($r['created_at']) * 1000];
      continue;
    }
    // receipt back to the sender once the last device has its copy:
    // proof the relay destroyed every copy (contains no content)
    $left = $pdo->prepare("SELECT 1 FROM k_queue WHERE to_id = ? AND from_id = ? AND client_id = ? AND peer = '' LIMIT 1");
    $left->execute([$r['to_id'], $r['from_id'], $r['client_id']]);
    if (!$left->fetch()) {
      $ins = $pdo->prepare('INSERT INTO k_receipts (to_id, dev, client_id, receipt, created_at) VALUES (?,?,?,?,NOW())');
      foreach (deviceIds($pdo, $r['from_id']) as $d) $ins->execute([$r['from_id'], $d, $r['client_id'], $receipt]);
    }
    $out['messages'][] = ['from' => $r['from_id'], 'iv' => $r['iv'], 'blob' => $r['payload'], 'ts' => strtotime($r['created_at']) * 1000, 'receipt' => $receipt];
  }

  // 2) drain deletion receipts addressed to me (for messages I sent)
  $st = $pdo->prepare('SELECT * FROM k_receipts WHERE to_id = ? AND dev = ? ORDER BY id ASC LIMIT 200');
  $st->execute([$me['kal_id'], $me['dev']]);
  $recs = $st->fetchAll();
  foreach ($recs as $r) {
    $pdo->prepare('DELETE FROM k_receipts WHERE id = ?')->execute([$r['id']]);
    $out['receipts'][] = ['client_id' => $r['client_id'], 'receipt' => $r['receipt']];
  }

  $pdo->prepare('UPDATE k_users SET last_seen = NOW() WHERE kal_id = ?')->execute([$me['kal_id']]);
  if ($me['dev'] !== '') {
    $pdo->prepare('UPDATE k_devices SET last_seen = NOW() WHERE id = ?')->execute([$me['dev']]);
  }
  out(true, $out);
}

function contactsProfiles(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $ids = $in['ids'] ?? [];
  if (!is_array($ids)) $ids = [];
  $ids = array_values(array_filter($ids,
      fn($x) => preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', (string)$x)));
  if (!$ids) out(true, ['users' => []]);
  $ids = array_slice($ids, 0, 200);
  $ph = implode(',', array_fill(0, count($ids), '?'));
  $rows = [];
  try {
    $st = $pdo->prepare("SELECT kal_id, username, name, avatar FROM k_users WHERE kal_id IN ($ph)");
    $st->execute($ids);
    $rows = $st->fetchAll();
  } catch (Throwable $e) {
    // avatar column not created yet — fall back without it
    $st = $pdo->prepare("SELECT kal_id, username, name FROM k_users WHERE kal_id IN ($ph)");
    $st->execute($ids);
    $rows = $st->fetchAll();
  }
  out(true, ['users' => $rows]);
}

function profileUpdate(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  // make sure the columns exist (safe to run repeatedly)
  try { $pdo->exec("ALTER TABLE k_users ADD COLUMN avatar MEDIUMTEXT NULL"); } catch (Throwable $e) {}

  $sets = []; $args = [];
  if (isset($in['name'])) {
    $name = trim((string)$in['name']);
    if ($name === '' || mb_strlen($name) > 40) out(false, ['error' => 'bad_name']);
    $sets[] = 'name = ?'; $args[] = $name;
  }
  if (isset($in['avatar'])) {
    $av = (string)$in['avatar'];
    // '' clears the picture; otherwise cap the size
    if ($av !== '' && strlen($av) > 250000) out(false, ['error' => 'avatar_too_big']);
    $sets[] = 'avatar = ?'; $args[] = ($av === '' ? null : $av);
  }
  if (!$sets) out(false, ['error' => 'nothing_to_update']);

  $args[] = $me['kal_id'];
  $pdo->prepare('UPDATE k_users SET ' . implode(', ', $sets) . ' WHERE kal_id = ?')
      ->execute($args);
  out(true, ['updated' => true]);
}

/* Step 1 of signing in on a new phone: hand back the salt for a username so
   the app can derive the same key from the password. Returns nothing useful
   to an attacker — the salt alone can't unlock anything. */
function recoverSalt(PDO $pdo, array $in): void {
  $u = strtolower(trim((string)($in['username'] ?? ''), " @"));
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $u)) out(false, ['error' => 'bad_username']);
  try {
    $st = $pdo->prepare('SELECT salt, verifier FROM k_users WHERE username = ?');
    $st->execute([$u]);
    $r = $st->fetch();
    if (!$r || empty($r['verifier'])) out(false, ['error' => 'no_recovery']);
    out(true, ['salt' => (string)$r['salt']]);
  } catch (Throwable $e) {
    out(false, ['error' => 'no_recovery']);
  }
}

/* Step 2: check the verifier the app derived from the password. On success
   the account is handed back — same KAL-ID, same username, a fresh token.
   The public key is replaced, since the app rebuilt the key pair. */
function recoverLogin(PDO $pdo, array $in): void {
  $u = strtolower(trim((string)($in['username'] ?? ''), " @"));
  $verifier = (string)($in['verifier'] ?? '');
  $pubkey = $in['pubkey'] ?? null;
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $u) || $verifier === '' || !is_array($pubkey)) {
    out(false, ['error' => 'bad_input']);
  }
  $st = $pdo->prepare('SELECT kal_id, name, verifier FROM k_users WHERE username = ?');
  $st->execute([$u]);
  $r = $st->fetch();
  if (!$r || empty($r['verifier'])) out(false, ['error' => 'no_recovery']);

  // slow down guessing
  usleep(300000);
  if (!password_verify($verifier, $r['verifier'])) out(false, ['error' => 'wrong_password']);

  unset($pubkey['d']);
  $token = bin2hex(random_bytes(24));
  $pdo->prepare('UPDATE k_users SET pubkey = ?, token = ?, last_seen = NOW() WHERE kal_id = ?')
      ->execute([json_encode($pubkey), $token, $r['kal_id']]);

  out(true, [
    'kal_id'   => $r['kal_id'],
    'username' => $u,
    'name'     => $r['name'],
    'token'    => $token,
  ]);
}

/* ---------------- Gmail verification ---------------- */

/* Gmail only. Gmail ignores dots and anything after '+' in the name, so we
   store the canonical form — one inbox, one address, however it was typed. */
function normalizeGmail(string $raw): ?string {
  $e = strtolower(trim($raw));
  if (!preg_match('/^([a-z0-9.+_-]{1,64})@(gmail\.com|googlemail\.com)$/', $e, $m)) return null;
  $local = explode('+', $m[1], 2)[0];
  $local = str_replace('.', '', $local);
  if (!preg_match('/^[a-z0-9]{6,30}$/', $local)) return null;
  return $local . '@gmail.com';
}

function clientIp(): string {
  return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/* Email a 6-digit code. The code is stored hashed, lives 10 minutes and
   allows 5 tries. Sending is rate limited per address and per IP. */
function emailOtpSend(PDO $pdo, array $in): void {
  $email = normalizeGmail((string)($in['email'] ?? ''));
  if ($email === null) out(false, ['error' => 'bad_email']);
  issueCode($pdo, $email);
  out(true, ['sent' => true, 'email' => $email]);
}

function issueCode(PDO $pdo, string $email): void {
  $ip = clientIp();

  $st = $pdo->prepare('SELECT MAX(created_at) AS last, COUNT(*) AS n FROM k_otp_log
                       WHERE email = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
  $st->execute([$email]); $r = $st->fetch();
  if ($r['last'] && strtotime($r['last']) > time() - 60) {
    out(false, ['error' => 'too_soon', 'wait' => 60 - (time() - strtotime($r['last']))]);
  }
  if ((int)$r['n'] >= 5) out(false, ['error' => 'too_many']);
  $st = $pdo->prepare('SELECT COUNT(*) FROM k_otp_log WHERE ip = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
  $st->execute([$ip]);
  if ((int)$st->fetchColumn() >= 15) out(false, ['error' => 'too_many']);

  $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
  $pdo->prepare('INSERT INTO k_email_otp (email, code_hash, attempts, expires_at) VALUES (?,?,0,NOW() + INTERVAL 10 MINUTE)
                 ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0, expires_at = VALUES(expires_at)')
      ->execute([$email, password_hash($code, PASSWORD_DEFAULT)]);
  $pdo->prepare('INSERT INTO k_otp_log (email, ip, created_at) VALUES (?,?,NOW())')->execute([$email, $ip]);
  $pdo->exec('DELETE FROM k_otp_log WHERE created_at < (NOW() - INTERVAL 1 DAY)');

  if (!sendOtpMail($email, $code)) out(false, ['error' => 'email_send_failed']);
}

/* ---------------- login on another device ----------------
   Username + the account's Gmail must match before a code is sent. The code
   logs a new device in alongside the others — nobody is logged out. The
   device then rebuilds the account key from the password (salt is returned)
   and checks it against the account's public key, so the password itself
   never reaches the server. */
function loginAccount(PDO $pdo, array $in): array {
  $u = strtolower(trim((string)($in['username'] ?? ''), " @"));
  $email = normalizeGmail((string)($in['email'] ?? ''));
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $u)) out(false, ['error' => 'bad_username']);
  if ($email === null) out(false, ['error' => 'bad_email']);
  $st = $pdo->prepare('SELECT kal_id, username, name, pubkey, email, salt, verifier, disabled FROM k_users WHERE username = ?');
  $st->execute([$u]);
  $r = $st->fetch();
  // same answer for "no such user" and "wrong email", so neither can be probed
  if (!$r || empty($r['email']) || !hash_equals((string)$r['email'], $email)) out(false, ['error' => 'no_match']);
  if ((int)$r['disabled'] === 1) out(false, ['error' => 'account_disabled']);
  return $r + ['_email' => $email];
}

function loginOtpSend(PDO $pdo, array $in): void {
  $r = loginAccount($pdo, $in);
  usleep(200000);
  issueCode($pdo, $r['_email']);
  out(true, ['sent' => true]);
}

function loginOtpVerify(PDO $pdo, array $in): void {
  $r = loginAccount($pdo, $in);
  checkEmailCode($pdo, $r['_email'], trim((string)($in['code'] ?? '')));
  $pdo->prepare('DELETE FROM k_email_otp WHERE email = ?')->execute([$r['_email']]);

  // keep at most 5 extra devices — the longest-unused one makes room
  $st = $pdo->prepare('SELECT id FROM k_devices WHERE kal_id = ? ORDER BY last_seen DESC');
  $st->execute([$r['kal_id']]);
  foreach (array_slice(array_column($st->fetchAll(), 'id'), 4) as $old) dropDevice($pdo, $old);

  $id = bin2hex(random_bytes(8));
  $token = bin2hex(random_bytes(24));
  $name = mb_substr(trim((string)($in['device'] ?? '')), 0, 40) ?: 'Device';
  $pdo->prepare('INSERT INTO k_devices (id, kal_id, token, name, created_at, last_seen) VALUES (?,?,?,?,NOW(),NOW())')
      ->execute([$id, $r['kal_id'], $token, $name]);
  out(true, [
    'kal_id'       => $r['kal_id'],
    'username'     => $r['username'],
    'name'         => $r['name'],
    'token'        => $token,
    'pubkey'       => json_decode($r['pubkey'], true),
    'salt'         => (string)($r['salt'] ?? ''),
    'has_password' => !empty($r['verifier']),
  ]);
}

/* Delete my account and everything the server holds for it. The user types
   their @username to confirm. Fingerprints of messages they forwarded are
   kept until they expire (FWD_RETENTION_DAYS) for lawful requests, without
   the email or username. */
function accountDelete(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $kid = $me['kal_id'];
  $st = $pdo->prepare('SELECT username, email FROM k_users WHERE kal_id = ?');
  $st->execute([$kid]); $u = $st->fetch();
  if (strtolower(trim((string)($in['confirm'] ?? ''), " @")) !== (string)$u['username']) {
    out(false, ['error' => 'confirm_mismatch']);
  }
  // their status files on disk
  try {
    $q = $pdo->prepare("SELECT payload FROM k_status WHERE kal_id = ? AND payload LIKE 'file:%'");
    $q->execute([$kid]);
    foreach ($q->fetchAll() as $r) {
      $path = __DIR__ . '/media/status/' . basename((string)$r['payload']);
      if (is_file($path)) @unlink($path);
    }
  } catch (Throwable $e) {}
  $del = [
    'DELETE FROM k_queue WHERE to_id = ? OR from_id = ?' => 2,
    'DELETE FROM k_receipts WHERE to_id = ?' => 1,
    'DELETE FROM k_status_views WHERE viewer = ? OR status_id IN (SELECT id FROM k_status WHERE kal_id = ?)' => 2,
    'DELETE FROM k_status_reacts WHERE reactor = ? OR status_id IN (SELECT id FROM k_status WHERE kal_id = ?)' => 2,
    'DELETE FROM k_status WHERE kal_id = ?' => 1,
    'DELETE FROM k_contacts WHERE a = ? OR b = ?' => 2,
    'DELETE FROM k_blocks WHERE blocker = ? OR blocked = ?' => 2,
    'DELETE FROM k_devices WHERE kal_id = ?' => 1,
    'DELETE FROM k_fcm WHERE kal_id = ?' => 1,
  ];
  foreach ($del as $sql => $n) {
    try { $pdo->prepare($sql)->execute(array_fill(0, $n, $kid)); } catch (Throwable $e) {}
  }
  if (!empty($u['email'])) {
    try { $pdo->prepare('DELETE FROM k_email_otp WHERE email = ?')->execute([$u['email']]); } catch (Throwable $e) {}
  }
  $pdo->prepare('DELETE FROM k_users WHERE kal_id = ?')->execute([$kid]);
  out(true, ['deleted' => true]);
}

function deviceList(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $st = $pdo->prepare('SELECT id, name, created_at, last_seen FROM k_devices WHERE kal_id = ? ORDER BY last_seen DESC');
  $st->execute([$me['kal_id']]);
  out(true, ['devices' => $st->fetchAll(), 'this' => $me['dev']]);
}

/* Log a device out — your own, or another of yours by id. */
function deviceRemove(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $id = (string)($in['id'] ?? $me['dev']);
  $st = $pdo->prepare('SELECT 1 FROM k_devices WHERE id = ? AND kal_id = ?');
  $st->execute([$id, $me['kal_id']]);
  if (!$st->fetch()) out(false, ['error' => 'not_found']);
  dropDevice($pdo, $id);
  out(true, ['removed' => $id]);
}

function dropDevice(PDO $pdo, string $id): void {
  $pdo->prepare('DELETE FROM k_devices WHERE id = ?')->execute([$id]);
  $pdo->prepare('DELETE FROM k_queue WHERE dev = ?')->execute([$id]);
  $pdo->prepare('DELETE FROM k_receipts WHERE dev = ?')->execute([$id]);
}

/* Every device of an account: '' is the phone it was created on, plus any
   device logged in since (unused for 30 days = dropped). */
function deviceIds(PDO $pdo, string $kalId): array {
  static $cache = [];
  if (isset($cache[$kalId])) return $cache[$kalId];
  $st = $pdo->prepare('SELECT id FROM k_devices WHERE kal_id = ? AND last_seen < (NOW() - INTERVAL 30 DAY)');
  $st->execute([$kalId]);
  foreach (array_column($st->fetchAll(), 'id') as $old) dropDevice($pdo, $old);
  $st = $pdo->prepare('SELECT id FROM k_devices WHERE kal_id = ?');
  $st->execute([$kalId]);
  return $cache[$kalId] = array_merge([''], array_column($st->fetchAll(), 'id'));
}

/* Queue one copy per device of the recipient. */
function deliver(PDO $pdo, string $to, string $from, string $cid, string $iv, string $blob): void {
  $ins = $pdo->prepare("INSERT INTO k_queue (to_id, dev, from_id, peer, client_id, iv, payload, created_at) VALUES (?,?,?,'',?,?,?,NOW())");
  foreach (deviceIds($pdo, $to) as $d) $ins->execute([$to, $d, $from, $cid, $iv, $blob]);
}

/* A copy of what I just sent, for my other devices, so the chat looks the
   same everywhere. Same ciphertext — every device holds the same key. */
function echoToMyDevices(PDO $pdo, array $me, string $peer, string $cid, string $iv, string $blob): void {
  $ins = $pdo->prepare('INSERT INTO k_queue (to_id, dev, from_id, peer, client_id, iv, payload, created_at) VALUES (?,?,?,?,?,?,?,NOW())');
  foreach (deviceIds($pdo, $me['kal_id']) as $d) {
    if ($d === $me['dev']) continue;
    $ins->execute([$me['kal_id'], $d, $me['kal_id'], $peer, $cid, $iv, $blob]);
  }
}

function sendOtpMail(string $to, string $code): bool {
  $from = defined('MAIL_FROM') ? MAIL_FROM : 'no-reply@bharatapp.chat';
  $subject = 'Your Kalisi code: ' . $code;
  $body = "Your Kalisi verification code is:\r\n\r\n    $code\r\n\r\n"
        . "It expires in 10 minutes. If you didn't ask for it, ignore this email.\r\n\r\n"
        . "Your email is never shown to your contacts.\r\n— Kalisi";
  $headers = "From: Kalisi <$from>\r\nReply-To: support@bharatapp.chat\r\n"
           . "Content-Type: text/plain; charset=utf-8\r\n";
  try { return @mail($to, $subject, $body, $headers, '-f' . $from); }
  catch (Throwable $e) { return false; }
}

/* Check a code without using it up (so a taken username can be retried).
   Ends the request with an error when it doesn't match. */
function checkEmailCode(PDO $pdo, string $email, string $code): void {
  $st = $pdo->prepare('SELECT code_hash, attempts, expires_at FROM k_email_otp WHERE email = ?');
  $st->execute([$email]); $r = $st->fetch();
  if (!$r || strtotime($r['expires_at']) < time()) out(false, ['error' => 'code_expired']);
  if ((int)$r['attempts'] >= 5) out(false, ['error' => 'too_many']);
  usleep(200000);
  if (!preg_match('/^\d{6}$/', $code) || !password_verify($code, $r['code_hash'])) {
    $pdo->prepare('UPDATE k_email_otp SET attempts = attempts + 1 WHERE email = ?')->execute([$email]);
    out(false, ['error' => 'wrong_code']);
  }
}

/* The verified email a new account is registered under. Either a fresh
   email + code, or an already signed-in account making another persona. */
function registrationEmail(PDO $pdo, array $in): ?string {
  $required = !defined('REQUIRE_EMAIL') || REQUIRE_EMAIL;

  if (!empty($in['parent_kal_id']) || !empty($in['parent_token'])) {
    $parent = auth($pdo, ['kal_id' => $in['parent_kal_id'] ?? '', 'token' => $in['parent_token'] ?? '']);
    $st = $pdo->prepare('SELECT email FROM k_users WHERE kal_id = ?');
    $st->execute([$parent['kal_id']]);
    $email = $st->fetchColumn() ?: null;
    if ($email === null && $required) out(false, ['error' => 'email_required']);
    return $email;
  }

  $raw = (string)($in['email'] ?? '');
  if ($raw === '') {
    if ($required) out(false, ['error' => 'email_required']);
    return null;
  }
  $email = normalizeGmail($raw);
  if ($email === null) out(false, ['error' => 'bad_email']);
  checkEmailCode($pdo, $email, trim((string)($in['email_code'] ?? '')));

  $st = $pdo->prepare('SELECT COUNT(*) FROM k_users WHERE email = ?');
  $st->execute([$email]);
  if ((int)$st->fetchColumn() >= 5) out(false, ['error' => 'email_limit']);
  return $email;
}

/* ---------------- forwarded-message tracing ----------------
   When a message is forwarded the app sends a SHA-256 fingerprint of its
   content (never the content) and who it got the message from. Ordinary,
   non-forwarded messages are never fingerprinted. On a lawful order the
   admin panel can match a fingerprint to the earliest account that put it
   into circulation. Rows are dropped after FWD_RETENTION_DAYS. */
function logForward(PDO $pdo, array $in, string $kalId): void {
  $hash = strtolower((string)($in['fwd_hash'] ?? ''));
  if (!preg_match('/^[a-f0-9]{64}$/', $hash)) return;
  $from = strtoupper(trim((string)($in['fwd_from'] ?? '')));
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $from)) $from = '';
  try {
    $pdo->prepare('INSERT INTO k_fwd_log (hash, kal_id, received_from, created_at) VALUES (?,?,?,NOW())')
        ->execute([$hash, $kalId, $from]);
    if (random_int(1, 200) === 1) {
      $days = defined('FWD_RETENTION_DAYS') ? (int)FWD_RETENTION_DAYS : 180;
      $pdo->prepare('DELETE FROM k_fwd_log WHERE created_at < (NOW() - INTERVAL ? DAY)')->execute([$days]);
    }
  } catch (Throwable $e) { /* never block a message over the log */ }
}

function changeUsername(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $new = strtolower(trim((string)($in['username'] ?? ''), " @"));
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $new)) out(false, ['error' => 'bad_username']);
  // rate limit: once per 30 days
  try { $pdo->exec("ALTER TABLE k_users ADD COLUMN username_changed_at DATETIME NULL"); } catch (Throwable $e) {}
  $st = $pdo->prepare('SELECT username, username_changed_at FROM k_users WHERE kal_id = ?');
  $st->execute([$me['kal_id']]); $u = $st->fetch();
  if ($u['username'] === $new) out(false, ['error' => 'same_username']);
  if (!empty($u['username_changed_at']) && strtotime($u['username_changed_at']) > time() - 30*86400) {
    $days = ceil((strtotime($u['username_changed_at']) + 30*86400 - time()) / 86400);
    out(false, ['error' => 'too_soon', 'days' => $days]);
  }
  // availability (respect 90-day reclaim)
  $st = $pdo->prepare('SELECT last_seen FROM k_users WHERE username = ? AND kal_id <> ?');
  $st->execute([$new, $me['kal_id']]); $ex = $st->fetch();
  if ($ex && strtotime($ex['last_seen']) > time() - 90*86400) out(false, ['error' => 'username_taken']);
  if ($ex) $pdo->prepare("UPDATE k_users SET username='' WHERE username=?")->execute([$new]);
  $pdo->prepare('UPDATE k_users SET username = ?, username_changed_at = NOW() WHERE kal_id = ?')
      ->execute([$new, $me['kal_id']]);
  out(true, ['username' => $new]);
}

function checkUsername(PDO $pdo, array $in): void {
  $u = strtolower(trim((string)($in['username'] ?? ''), " @"));
  if (!preg_match('/^[a-z0-9_]{3,20}$/', $u)) out(true, ['available' => false, 'reason' => 'invalid']);
  $st = $pdo->prepare('SELECT last_seen FROM k_users WHERE username = ?'); $st->execute([$u]);
  $ex = $st->fetch();
  $avail = !$ex || strtotime($ex['last_seen']) < time() - 90*86400;
  out(true, ['available' => $avail]);
}

function reqSend(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $to = strtoupper(trim((string)($in['to'] ?? '')));
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $to) || $to === $me['kal_id']) out(false, ['error' => 'bad_id']);
  $st = $pdo->prepare('SELECT 1 FROM k_users WHERE kal_id = ?'); $st->execute([$to]);
  if (!$st->fetch()) out(false, ['error' => 'not_found']);
  // blocked?
  $st = $pdo->prepare('SELECT 1 FROM k_blocks WHERE blocker=? AND blocked=?'); $st->execute([$to,$me['kal_id']]);
  if ($st->fetch()) out(true, ['sent' => true]); // pretend, but drop
  // already a relation?
  $st = $pdo->prepare("SELECT status,a,b FROM k_contacts WHERE (a=? AND b=?) OR (a=? AND b=?) LIMIT 1");
  $st->execute([$me['kal_id'],$to,$to,$me['kal_id']]);
  $ex = $st->fetch();
  if ($ex) {
    if ($ex['status']==='accepted') out(true, ['already'=>'accepted']);
    if ($ex['status']==='pending' && $ex['a']===$to) {
      // they already requested me → accept automatically
      $pdo->prepare("UPDATE k_contacts SET status='accepted' WHERE a=? AND b=?")->execute([$to,$me['kal_id']]);
      out(true, ['auto_accepted'=>true]);
    }
    out(true, ['already'=>$ex['status']]);
  }
  $pdo->prepare("INSERT INTO k_contacts (a,b,status,created_at) VALUES (?,?,'pending',NOW())")->execute([$me['kal_id'],$to]);
  out(true, ['sent' => true]);
}
function reqList(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  // incoming pending requests to me
  $st = $pdo->prepare("SELECT c.a AS from_id, u.username, u.name, c.created_at
                       FROM k_contacts c JOIN k_users u ON u.kal_id=c.a
                       WHERE c.b=? AND c.status='pending' ORDER BY c.created_at DESC LIMIT 100");
  $st->execute([$me['kal_id']]);
  out(true, ['requests' => $st->fetchAll()]);
}
function reqAct(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $from = strtoupper(trim((string)($in['from'] ?? '')));
  $act = ($in['act'] ?? '') === 'accept' ? 'accept' : 'reject';
  if ($act === 'accept') {
    $pdo->prepare("UPDATE k_contacts SET status='accepted' WHERE a=? AND b=?")->execute([$from,$me['kal_id']]);
  } else {
    $pdo->prepare("DELETE FROM k_contacts WHERE a=? AND b=?")->execute([$from,$me['kal_id']]);
  }
  out(true, ['ok'=>true, 'act'=>$act]);
}
function contactsState(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $st = $pdo->prepare("SELECT a,b,status FROM k_contacts WHERE a=? OR b=?");
  $st->execute([$me['kal_id'],$me['kal_id']]);
  $accepted=[]; $pendingOut=[];
  foreach ($st->fetchAll() as $r) {
    $other = $r['a']===$me['kal_id'] ? $r['b'] : $r['a'];
    if ($r['status']==='accepted') $accepted[]=$other;
    elseif ($r['a']===$me['kal_id']) $pendingOut[]=$other;
  }
  out(true, ['accepted'=>$accepted, 'pending_out'=>$pendingOut]);
}

function fcmRegister(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $tok = substr(trim((string)($in['fcm_token'] ?? '')), 0, 300);
  if ($tok==='') out(false,['error'=>'bad_token']);
  try { $pdo->exec("CREATE TABLE IF NOT EXISTS k_fcm (kal_id VARCHAR(14) NOT NULL, token VARCHAR(300) NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY(kal_id,token)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"); } catch (Throwable $e) {}
  $pdo->prepare("INSERT INTO k_fcm (kal_id,token,updated_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE updated_at=NOW()")
      ->execute([$me['kal_id'],$tok]);
  out(true,['registered'=>true]);
}

/* Send an FCM push to a recipient (best-effort; silent on failure).
   Requires FCM_PROJECT_ID + a service-account JSON in config.local.php (FCM_SA_JSON). */
/* Why isn't push working? Reports each step without exposing the key. */
function pushCheck(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $r = [];

  $keyPath = __DIR__ . '/fcm-key.json';
  $r['key_file_present']  = is_readable($keyPath);
  $r['key_file_path']     = $keyPath;
  $sa = fcmServiceAccount();
  $r['key_file_valid']    = (bool)$sa;
  $r['project_id']        = $sa['project_id'] ?? null;
  $r['client_email_tail'] = isset($sa['client_email'])
      ? substr($sa['client_email'], -28) : null;

  try {
    $st = $pdo->prepare("SELECT token, updated_at FROM k_fcm WHERE kal_id=?");
    $st->execute([$me['kal_id']]);
    $rows = $st->fetchAll();
    $r['devices_registered'] = count($rows);
    $r['token_updated']      = $rows[0]['updated_at'] ?? null;
    $r['token_tail']         = isset($rows[0]['token'])
        ? substr($rows[0]['token'], -12) : null;
  } catch (Throwable $e) {
    $r['devices_registered'] = 0;
    $r['fcm_table_error']    = $e->getMessage();
  }

  if ($sa) {
    $tok = fcmAccessToken();
    $r['google_auth_ok'] = (bool)$tok;
    if (!$tok) $r['google_auth_hint'] =
        'Could not get a token from Google — check the key and the server clock';
  }

  $r['ready'] = ($r['key_file_valid'] ?? false)
      && ($r['devices_registered'] ?? 0) > 0
      && ($r['google_auth_ok'] ?? false);
  out(true, $r);
}

/* Send a push to yourself and report what FCM said. */
function pushTest(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $result = sendPush($pdo, $me['kal_id'], 'Kalisi', 'Test notification',
                     $me['kal_id'], 'message', true);
  out(true, ['sent' => $result]);
}

function sendPush(PDO $pdo, string $toKal, string $title, string $body, string $fromKal = '', string $type = 'message', bool $report = false) {
  $sa = fcmServiceAccount();
  if (!$sa) return $report ? ['ok'=>false,'why'=>'no_key_file'] : null;
  try {
    $st = $pdo->prepare("SELECT token FROM k_fcm WHERE kal_id=?"); $st->execute([$toKal]);
    $tokens = array_column($st->fetchAll(), 'token');
    if (!$tokens) return $report ? ['ok'=>false,'why'=>'no_device_registered'] : null;
    $access = fcmAccessToken();
    if (!$access) return $report ? ['ok'=>false,'why'=>'google_auth_failed'] : null;
    $project = defined('FCM_PROJECT_ID') ? FCM_PROJECT_ID : ($sa['project_id'] ?? '');
    if ($project === '') return $report ? ['ok'=>false,'why'=>'no_project_id'] : null;
    $url = 'https://fcm.googleapis.com/v1/projects/'.$project.'/messages:send';
    $results = [];
    foreach ($tokens as $t) {
      $msg = ['message'=>[
        'token'=>$t,
        'notification'=>['title'=>$title,'body'=>$body],
        'android'=>[
          'priority'=>'high',
          'ttl'=> ($type === 'call' ? '45s' : '86400s'),
          'notification'=>[
            'sound'=>'default',
            'channel_id'=> ($type === 'call' ? 'kalisi_calls' : 'kalisi_messages_v2'),
          ],
        ],
        'data'=>['type'=>$type,'sender'=>$fromKal,'click_action'=>'FLUTTER_NOTIFICATION_CLICK']
      ]];
      $ch = curl_init($url);
      curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>6,
        CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$access,'Content-Type: application/json'],
        CURLOPT_POSTFIELDS=>json_encode($msg)]);
      $body = curl_exec($ch);
      $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $err  = curl_error($ch);
      curl_close($ch);

      // Only 404 (UNREGISTERED) means the token itself is dead. A 400 means
      // the payload was malformed — deleting the token then just unregisters
      // healthy devices, which is exactly what happened with the reserved
      // 'from' key.
      if ($code === 404) {
        try {
          $pdo->prepare("DELETE FROM k_fcm WHERE token=?")->execute([$t]);
        } catch (Throwable $e) {}
      }
      $results[] = ['http'=>$code, 'error'=>$err ?: null,
                    'body'=>$code >= 300 ? substr((string)$body, 0, 300) : null];
    }
    if ($report) {
      return ['ok' => !empty($results) && ($results[0]['http'] ?? 0) === 200,
              'attempts' => $results];
    }
  } catch (Throwable $e) {
    if ($report) return ['ok'=>false,'why'=>'exception','detail'=>$e->getMessage()];
  }
  return $report ? ['ok'=>false,'why'=>'no_attempts'] : null;
}
/* Load the Firebase service account, from api/fcm-key.json if it's there,
   otherwise from an FCM_SA_JSON constant. Returns null when neither exists,
   which simply leaves push disabled. */
function fcmServiceAccount(): ?array {
  static $cached = false, $value = null;
  if ($cached) return $value;
  $cached = true;

  $path = __DIR__ . '/fcm-key.json';
  if (is_readable($path)) {
    $j = json_decode((string)file_get_contents($path), true);
    if ($j && !empty($j['client_email']) && !empty($j['private_key'])) {
      $value = $j;
      return $value;
    }
  }
  if (defined('FCM_SA_JSON')) {
    $j = json_decode(FCM_SA_JSON, true);
    if ($j && !empty($j['client_email']) && !empty($j['private_key'])) {
      $value = $j;
      return $value;
    }
  }
  return null;
}

function fcmAccessToken(): ?string {
  $sa = fcmServiceAccount();
  if (!$sa) return null;
  $now = time();
  $header = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])), '+/', '-_'), '=');
  $claim = rtrim(strtr(base64_encode(json_encode([
    'iss'=>$sa['client_email'],'scope'=>'https://www.googleapis.com/auth/firebase.messaging',
    'aud'=>'https://oauth2.googleapis.com/token','iat'=>$now,'exp'=>$now+3600
  ])), '+/', '-_'), '=');
  $sig=''; openssl_sign($header.'.'.$claim, $sig, $sa['private_key'], 'sha256WithRSAEncryption');
  $jwt = $header.'.'.$claim.'.'.rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
  $ch = curl_init('https://oauth2.googleapis.com/token');
  curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>4,
    CURLOPT_POSTFIELDS=>http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt])]);
  $res = curl_exec($ch); curl_close($ch);
  $j = json_decode($res, true);
  return $j['access_token'] ?? null;
}

function presence(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $kid = strtoupper(trim((string)($in['kal_id'] ?? '')));
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $kid)) out(false, ['error'=>'bad_id']);
  $st = $pdo->prepare('SELECT last_seen FROM k_users WHERE kal_id = ?'); $st->execute([$kid]);
  $u = $st->fetch();
  if (!$u) out(false, ['error'=>'not_found']);
  out(true, ['last_seen' => strtotime($u['last_seen'])*1000]);
}

function statusView(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $sid = (int)($in['status_id'] ?? 0);
  if ($sid<=0) out(false,['error'=>'bad_input']);
  $pdo->prepare("INSERT IGNORE INTO k_status_views (status_id, viewer, created_at) VALUES (?,?,NOW())")
      ->execute([$sid, $me['kal_id']]);
  out(true, ['viewed'=>true]);
}
function statusViewers(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $sid = (int)($in['status_id'] ?? 0);
  // only the owner can see viewers
  $st = $pdo->prepare("SELECT kal_id FROM k_status WHERE id=?"); $st->execute([$sid]);
  $o = $st->fetch();
  if (!$o || $o['kal_id'] !== $me['kal_id']) out(false, ['error'=>'not_owner']);
  $st = $pdo->prepare("SELECT v.viewer, v.created_at, u.username, u.name FROM k_status_views v
                       JOIN k_users u ON u.kal_id=v.viewer WHERE v.status_id=? ORDER BY v.created_at DESC");
  $st->execute([$sid]);
  out(true, ['viewers' => $st->fetchAll()]);
}
function statusDelete(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $sid = (int)($in['status_id'] ?? 0);
  // remove the stored file too, if this status had one
  try {
    $q = $pdo->prepare("SELECT payload FROM k_status WHERE id=? AND kal_id=?");
    $q->execute([$sid, $me['kal_id']]);
    $p = (string)($q->fetchColumn() ?: '');
    if (str_starts_with($p, 'file:')) {
      $path = __DIR__ . '/media/status/' . basename($p);
      if (is_file($path)) @unlink($path);
    }
  } catch (Throwable $e) {}
  $pdo->prepare("DELETE FROM k_status WHERE id=? AND kal_id=?")->execute([$sid, $me['kal_id']]);
  $pdo->prepare("DELETE FROM k_status_views WHERE status_id=?")->execute([$sid]);
  out(true, ['deleted'=>$sid]);
}

function statusReact(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $sid = (int)($in['status_id'] ?? 0);
  $emoji = substr(trim((string)($in['emoji'] ?? '❤')), 0, 8);
  if ($sid<=0) out(false,['error'=>'bad_input']);
  // toggle: if same reaction exists remove it, else set
  $st=$pdo->prepare("SELECT emoji FROM k_status_reacts WHERE status_id=? AND reactor=?");
  $st->execute([$sid,$me['kal_id']]); $ex=$st->fetch();
  if ($ex && $ex['emoji']===$emoji) {
    $pdo->prepare("DELETE FROM k_status_reacts WHERE status_id=? AND reactor=?")->execute([$sid,$me['kal_id']]);
    out(true,['toggled'=>'off']);
  }
  $pdo->prepare("INSERT INTO k_status_reacts (status_id,reactor,emoji,created_at) VALUES (?,?,?,NOW())
                 ON DUPLICATE KEY UPDATE emoji=VALUES(emoji), created_at=NOW()")
      ->execute([$sid,$me['kal_id'],$emoji]);
  out(true,['toggled'=>'on','emoji'=>$emoji]);
}
function statusReactions(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $sid = (int)($in['status_id'] ?? 0);
  $st=$pdo->prepare("SELECT r.emoji, r.reactor, u.username, u.name FROM k_status_reacts r
                     JOIN k_users u ON u.kal_id=r.reactor WHERE r.status_id=? ORDER BY r.created_at DESC");
  $st->execute([$sid]);
  $rows=$st->fetchAll();
  $mine=null; foreach($rows as $r){ if($r['reactor']===$me['kal_id'])$mine=$r['emoji']; }
  out(true,['reactions'=>$rows,'mine'=>$mine,'count'=>count($rows)]);
}

function blockUser(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $t = strtoupper(trim((string)($in['kal_id'] ?? '')));
  if (!preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $t)) out(false, ['error' => 'bad_id']);
  $pdo->prepare('INSERT IGNORE INTO k_blocks (blocker, blocked, created_at) VALUES (?,?,NOW())')->execute([$me['kal_id'], $t]);
  out(true, ['blocked' => $t]);
}
function unblockUser(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $t = strtoupper(trim((string)($in['kal_id'] ?? '')));
  $pdo->prepare('DELETE FROM k_blocks WHERE blocker = ? AND blocked = ?')->execute([$me['kal_id'], $t]);
  out(true, ['unblocked' => $t]);
}

function statusPost(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $type = in_array(($in['type'] ?? ''), ['text','photo','voice','video'])
      ? $in['type'] : 'text';
  $payload = (string)($in['payload'] ?? '');
  if ($payload === '') out(false, ['error' => 'bad_input']);

  // Video (and anything large) is written to disk and only its URL is stored,
  // so the row stays small and the 1.5MB inline limit doesn't apply.
  $limit = ($type === 'video') ? 26000000 : 1500000;   // ~26MB of base64 ≈ 19MB
  if (strlen($payload) > $limit) out(false, ['error' => 'too_large']);

  if ($type === 'video' || strlen($payload) > 900000) {
    $stored = storeStatusFile($payload, $type);
    if ($stored === null) out(false, ['error' => 'store_failed']);
    $payload = $stored;   // 'file:<url>'
  }
  $allowShare = !empty($in['allow_share']) ? 1 : 0;
  try { $pdo->exec("ALTER TABLE k_status ADD COLUMN allow_share TINYINT NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
  $pdo->prepare('INSERT INTO k_status (kal_id, type, payload, allow_share, created_at) VALUES (?,?,?,?,NOW())')
      ->execute([$me['kal_id'], $type, $payload, $allowShare]);
  // keep only last 24h per user, removing any stored files first
  pruneStatusFiles($pdo);
  $pdo->prepare('DELETE FROM k_status WHERE created_at < (NOW() - INTERVAL 24 HOUR)')->execute();
  out(true, ['posted' => true]);
}
/* Write a base64 data URL to disk under api/media/status and return
   'file:<absolute url>'. Returns null if it can't be written. */
function storeStatusFile(string $dataUrl, string $type): ?string {
  $dir = __DIR__ . '/media/status';
  if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return null;

  $comma = strpos($dataUrl, ',');
  $meta  = $comma === false ? '' : substr($dataUrl, 0, $comma);
  $b64   = $comma === false ? $dataUrl : substr($dataUrl, $comma + 1);
  $bytes = base64_decode($b64, true);
  if ($bytes === false || strlen($bytes) < 32) return null;

  $ext = 'bin';
  if (stripos($meta, 'mp4') !== false)       $ext = 'mp4';
  elseif (stripos($meta, 'webm') !== false)  $ext = 'webm';
  elseif (stripos($meta, 'jpeg') !== false || stripos($meta, 'jpg') !== false) $ext = 'jpg';
  elseif (stripos($meta, 'png') !== false)   $ext = 'png';
  elseif (stripos($meta, 'audio') !== false) $ext = 'm4a';

  $name = bin2hex(random_bytes(12)) . '.' . $ext;
  if (@file_put_contents($dir . '/' . $name, $bytes) === false) return null;

  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host   = $_SERVER['HTTP_HOST'] ?? 'bharatapp.chat';
  $base   = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'), '/');
  return 'file:' . $scheme . '://' . $host . $base . '/media/status/' . $name;
}

/* Delete stored files for statuses that have expired. */
function pruneStatusFiles(PDO $pdo): void {
  try {
    $st = $pdo->query("SELECT payload FROM k_status
                       WHERE created_at < (NOW() - INTERVAL 24 HOUR)
                         AND payload LIKE 'file:%'");
    foreach ($st->fetchAll() as $r) {
      $name = basename((string)$r['payload']);
      $path = __DIR__ . '/media/status/' . $name;
      if ($name !== '' && is_file($path)) @unlink($path);
    }
  } catch (Throwable $e) {}
}

function statusFeed(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $ids = $in['contacts'] ?? [];   // list of KAL-IDs the user follows (their contacts)
  if (!is_array($ids)) $ids = [];
  $ids[] = $me['kal_id'];
  $ids = array_values(array_unique(array_filter($ids, fn($x)=>preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', (string)$x))));
  if (!$ids) out(true, ['status' => []]);
  $ph = implode(',', array_fill(0, count($ids), '?'));
  $st = $pdo->prepare("SELECT s.id, s.kal_id, s.type, s.payload, s.created_at, u.username, u.name,
                       s.allow_share,
                       (SELECT COUNT(*) FROM k_status_views v WHERE v.status_id=s.id) AS views
                       FROM k_status s JOIN k_users u ON u.kal_id = s.kal_id
                       WHERE s.kal_id IN ($ph) AND s.created_at > (NOW() - INTERVAL 24 HOUR)
                       ORDER BY s.created_at DESC LIMIT 200");
  $st->execute($ids);
  $rows = array_map(fn($r)=>[
    'id'=>(int)$r['id'],'kal_id'=>$r['kal_id'],'username'=>$r['username'],'name'=>$r['name'],
    'type'=>$r['type'],'payload'=>$r['payload'],'ts'=>strtotime($r['created_at'])*1000,
    'views'=>(int)$r['views'],'allow_share'=>(int)($r['allow_share']??0)
  ], $st->fetchAll());
  out(true, ['status' => $rows]);
}

function groupCreate(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $name = trim((string)($in['name'] ?? ''));
  $members = $in['members'] ?? [];
  if ($name === '' || mb_strlen($name) > 40 || !is_array($members)) out(false, ['error' => 'bad_input']);
  $gid = 'GRP-'.substr(bin2hex(random_bytes(6)),0,10);
  $members[] = $me['kal_id'];
  $members = array_values(array_unique(array_filter($members, fn($x)=>preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', (string)$x))));
  $pdo->prepare('INSERT INTO k_groups (gid, name, owner, members, created_at) VALUES (?,?,?,?,NOW())')
      ->execute([$gid, $name, $me['kal_id'], json_encode($members)]);
  out(true, ['gid' => $gid, 'name' => $name, 'members' => $members]);
}
/* Add/remove members, rename, or leave a group.
   Only the owner may add, remove or rename; anyone may leave. */
function groupUpdate(PDO $pdo, array $in): void {
  $me  = auth($pdo, $in);
  $gid = (string)($in['gid'] ?? '');
  $act = (string)($in['act'] ?? '');

  $st = $pdo->prepare('SELECT * FROM k_groups WHERE gid = ?');
  $st->execute([$gid]);
  $g = $st->fetch();
  if (!$g) out(false, ['error' => 'group_not_found']);

  $members = json_decode($g['members'], true);
  if (!is_array($members)) $members = [];
  if (!in_array($me['kal_id'], $members, true)) out(false, ['error' => 'not_a_member']);

  $isOwner = ($g['owner'] === $me['kal_id']);

  if ($act === 'leave') {
    $members = array_values(array_filter($members, fn($m) => $m !== $me['kal_id']));
    if (!$members) {
      $pdo->prepare('DELETE FROM k_groups WHERE gid = ?')->execute([$gid]);
      out(true, ['left' => true, 'deleted' => true]);
    }
    // hand ownership on if the owner leaves
    $owner = $isOwner ? $members[0] : $g['owner'];
    $pdo->prepare('UPDATE k_groups SET members = ?, owner = ? WHERE gid = ?')
        ->execute([json_encode($members), $owner, $gid]);
    out(true, ['left' => true, 'members' => $members]);
  }

  if (!$isOwner) out(false, ['error' => 'owner_only']);

  if ($act === 'rename') {
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 60) out(false, ['error' => 'bad_name']);
    $pdo->prepare('UPDATE k_groups SET name = ? WHERE gid = ?')->execute([$name, $gid]);
    out(true, ['renamed' => true, 'name' => $name]);
  }

  if ($act === 'add') {
    $add = $in['members'] ?? [];
    if (!is_array($add)) $add = [];
    foreach ($add as $m) {
      $m = (string)$m;
      if (preg_match('/^KAL-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $m)
          && !in_array($m, $members, true)) {
        $members[] = $m;
      }
    }
    if (count($members) > 256) out(false, ['error' => 'group_full']);
    $pdo->prepare('UPDATE k_groups SET members = ? WHERE gid = ?')
        ->execute([json_encode($members), $gid]);
    out(true, ['members' => $members]);
  }

  if ($act === 'remove') {
    $drop = (string)($in['member'] ?? '');
    if ($drop === $g['owner']) out(false, ['error' => 'cannot_remove_owner']);
    $members = array_values(array_filter($members, fn($m) => $m !== $drop));
    $pdo->prepare('UPDATE k_groups SET members = ? WHERE gid = ?')
        ->execute([json_encode($members), $gid]);
    out(true, ['members' => $members]);
  }

  out(false, ['error' => 'bad_act']);
}

function groupInfo(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $gid = (string)($in['gid'] ?? '');
  $st = $pdo->prepare('SELECT * FROM k_groups WHERE gid = ?'); $st->execute([$gid]);
  $g = $st->fetch();
  if (!$g) out(false, ['error' => 'group_not_found']);
  out(true, ['group' => ['gid'=>$g['gid'],'name'=>$g['name'],'owner'=>$g['owner'],'members'=>json_decode($g['members'],true)]]);
}
function groupSend(PDO $pdo, array $in): void {
  $me = auth($pdo, $in);
  $gid = (string)($in['gid'] ?? '');
  $text = (string)($in['text'] ?? '');   // server-relayed simple group: fan-out plaintext-in-transit blob
  $iv = (string)($in['iv'] ?? '');
  $blob = (string)($in['blob'] ?? '');
  $cid = substr((string)($in['client_id'] ?? ''), 0, 32);
  if ($blob === '' || strlen($blob) > 900000) out(false, ['error' => 'bad_input']);
  $st = $pdo->prepare('SELECT members FROM k_groups WHERE gid = ?'); $st->execute([$gid]);
  $g = $st->fetch();
  if (!$g) out(false, ['error' => 'group_not_found']);
  $members = json_decode($g['members'], true) ?: [];
  foreach ($members as $mm) {
    if ($mm === $me['kal_id']) continue;
    deliver($pdo, $mm, $me['kal_id'], $cid, $iv, $blob);
  }
  if (!empty($in['echo'])) echoToMyDevices($pdo, $me, $gid, $cid, $iv, $blob);
  logForward($pdo, $in, $me['kal_id']);
  out(true, ['sent' => true, 'gid' => $gid]);
}

/* ---------------- helpers ---------------- */

function auth(PDO $pdo, array $in): array {
  $kid = strtoupper(trim((string)($in['kal_id'] ?? '')));
  $token = (string)($in['token'] ?? '');
  if ($kid === '' || $token === '') out(false, ['error' => 'auth_required']);
  $st = $pdo->prepare("SELECT kal_id, disabled, '' AS dev FROM k_users WHERE kal_id = ? AND token = ?");
  $st->execute([$kid, $token]);
  $u = $st->fetch();
  if (!$u) {
    $st = $pdo->prepare('SELECT u.kal_id, u.disabled, d.id AS dev FROM k_devices d
                         JOIN k_users u ON u.kal_id = d.kal_id WHERE d.kal_id = ? AND d.token = ?');
    $st->execute([$kid, $token]);
    $u = $st->fetch();
  }
  if (!$u) out(false, ['error' => 'auth_failed']);
  if ((int)($u['disabled'] ?? 0) === 1) out(false, ['error' => 'account_disabled']);
  return $u;
}

function kalId(): string {
  $a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  $p = function ($n) use ($a) { $s = ''; for ($i = 0; $i < $n; $i++) $s .= $a[random_int(0, strlen($a) - 1)]; return $s; };
  return 'KAL-'.$p(4).'-'.$p(4);
}

function migrate(PDO $pdo): void {
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_users (
    kal_id VARCHAR(14) PRIMARY KEY,
    username VARCHAR(20) NOT NULL DEFAULT '',
    name VARCHAR(48) NOT NULL,
    pubkey TEXT NOT NULL,
    token VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    last_seen DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  try { $pdo->exec("ALTER TABLE k_users ADD COLUMN username VARCHAR(20) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
  try { $pdo->exec("CREATE UNIQUE INDEX idx_username ON k_users (username)"); } catch (Throwable $e) {}
  try { $pdo->exec("ALTER TABLE k_users ADD COLUMN disabled TINYINT NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
  try { $pdo->exec("ALTER TABLE k_users ADD COLUMN email VARCHAR(254) NULL"); } catch (Throwable $e) {}
  try { $pdo->exec("CREATE INDEX idx_email ON k_users (email)"); } catch (Throwable $e) {}
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_email_otp (
    email VARCHAR(254) PRIMARY KEY,
    code_hash VARCHAR(255) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_otp_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_email (email), KEY idx_ip (ip)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_devices (
    id VARCHAR(16) PRIMARY KEY,
    kal_id VARCHAR(14) NOT NULL,
    token VARCHAR(64) NOT NULL,
    name VARCHAR(40) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    KEY idx_kal (kal_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_fwd_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    hash CHAR(64) NOT NULL,
    kal_id VARCHAR(14) NOT NULL,
    received_from VARCHAR(14) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    KEY idx_hash (hash), KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_blocks (
    blocker VARCHAR(14) NOT NULL,
    blocked VARCHAR(14) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (blocker, blocked)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_status (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kal_id VARCHAR(14) NOT NULL,
    type VARCHAR(8) NOT NULL DEFAULT 'text',
    payload MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_kal (kal_id), KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_contacts (
    a VARCHAR(14) NOT NULL,
    b VARCHAR(14) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (a,b), KEY idx_b (b)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_status_views (
    status_id BIGINT NOT NULL,
    viewer VARCHAR(14) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (status_id, viewer)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_status_reacts (
    status_id BIGINT NOT NULL,
    reactor VARCHAR(14) NOT NULL,
    emoji VARCHAR(8) NOT NULL DEFAULT '❤',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (status_id, reactor)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_groups (
    gid VARCHAR(16) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    owner VARCHAR(14) NOT NULL,
    members MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    to_id VARCHAR(14) NOT NULL,
    from_id VARCHAR(14) NOT NULL,
    client_id VARCHAR(32) NOT NULL DEFAULT '',
    iv VARCHAR(64) NOT NULL DEFAULT '',
    payload MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_to (to_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  try { $pdo->exec("ALTER TABLE k_queue ADD COLUMN dev VARCHAR(16) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
  try { $pdo->exec("ALTER TABLE k_queue ADD COLUMN peer VARCHAR(16) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
  $pdo->exec("CREATE TABLE IF NOT EXISTS k_receipts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    to_id VARCHAR(14) NOT NULL,
    client_id VARCHAR(32) NOT NULL,
    receipt VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_to (to_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  try { $pdo->exec("ALTER TABLE k_receipts ADD COLUMN dev VARCHAR(16) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
}

function out(bool $ok, array $data = []): void {
  echo json_encode(['ok' => $ok] + $data);
  exit;
}
