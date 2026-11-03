<?php
/* ============================================================
   Waiting copies nobody will collect.
   Every message gets one copy per login of the receiver (the phone the
   account was made on, phones logged in later, the web panel). A login that
   is no longer used (app reinstalled, browser closed for good) never takes
   its copy, so it waits up to 30 days. Here: list them, and remove the ones
   whose person has already used ANOTHER login since the copy was made - they
   got the message there (and the sender already saw "delivered").
   Copies held because nothing is signed in ('#hold') are never touched.
   ============================================================ */
if (!defined('DB_HOST')) { http_response_code(404); exit; }

/**
 * Every login that has waiting copies: who, which login, when it was last
 * used, how many copies wait and how many of them are stuck.
 */
function queueLogins(PDO $pdo, int $idleSecs): array {
  $rows = $pdo->query("SELECT q.to_id, q.dev, COUNT(*) AS n, MIN(q.created_at) AS oldest,
        u.username, u.name, u.main_seen, d.name AS dname, d.last_seen AS dseen,
        (d.id IS NULL AND q.dev NOT IN ('', '#hold')) AS orphan
      FROM k_queue q
      LEFT JOIN k_users u ON u.kal_id = q.to_id
      LEFT JOIN k_devices d ON d.id = q.dev
      GROUP BY q.to_id, q.dev, u.username, u.name, u.main_seen, d.name, d.last_seen, d.id
      ORDER BY n DESC")->fetchAll();
  $out = [];
  foreach ($rows as $r) {
    $used = $r['dev'] === '' ? $r['main_seen'] : $r['dseen'];
    $out[] = [
      'to_id' => $r['to_id'], 'dev' => $r['dev'],
      'username' => $r['username'], 'name' => $r['name'],
      'login' => $r['dev'] === '' ? 'First phone (sign-up login)'
               : ($r['dev'] === '#hold' ? 'Held - not signed in anywhere'
               : ($r['orphan'] ? 'Removed login' : ($r['dname'] ?: 'Device'))),
      'last_used' => $used, 'waiting' => (int)$r['n'], 'oldest' => $r['oldest'],
      'stuck' => stuckCount($pdo, $r['to_id'], $r['dev'], $idleSecs),
    ];
  }
  return $out;
}

/** When the person last used any login other than $dev (null = never). */
function otherLoginSeen(PDO $pdo, string $kal, string $dev): ?string {
  $st = $pdo->prepare("SELECT MAX(last_seen) FROM k_devices WHERE kal_id = ? AND id <> ?");
  $st->execute([$kal, $dev]);
  $best = $st->fetchColumn() ?: null;
  if ($dev !== '') {
    $st = $pdo->prepare('SELECT main_seen FROM k_users WHERE kal_id = ?');
    $st->execute([$kal]);
    $m = $st->fetchColumn() ?: null;
    if ($m && (!$best || $m > $best)) $best = $m;
  }
  return $best;
}

/** This login has not been used for $idleSecs (or no longer exists). */
function loginIdle(PDO $pdo, string $kal, string $dev, int $idleSecs): bool {
  if ($dev === '#hold') return false;
  if ($dev === '') {
    $st = $pdo->prepare('SELECT main_seen IS NULL OR main_seen < (NOW() - INTERVAL ? SECOND) FROM k_users WHERE kal_id = ?');
    $st->execute([$idleSecs, $kal]);
  } else {
    $st = $pdo->prepare('SELECT last_seen < (NOW() - INTERVAL ? SECOND) FROM k_devices WHERE id = ?');
    $st->execute([$idleSecs, $dev]);
  }
  $v = $st->fetchColumn();
  return $v === false ? true : (bool)$v;   // no row = removed login
}

function stuckCount(PDO $pdo, string $kal, string $dev, int $idleSecs): int {
  if (!loginIdle($pdo, $kal, $dev, $idleSecs)) return 0;
  $other = otherLoginSeen($pdo, $kal, $dev);
  if (!$other) return 0;
  $st = $pdo->prepare('SELECT COUNT(*) FROM k_queue WHERE to_id = ? AND dev = ? AND created_at < ?');
  $st->execute([$kal, $dev, $other]);
  return (int)$st->fetchColumn();
}

/** Remove stuck copies; returns how many. */
function clearStuckCopies(PDO $pdo, int $idleSecs): int {
  $n = 0;
  $pairs = $pdo->query("SELECT DISTINCT to_id, dev FROM k_queue WHERE dev <> '#hold'")->fetchAll();
  foreach ($pairs as $p) {
    if (!loginIdle($pdo, $p['to_id'], $p['dev'], $idleSecs)) continue;
    $other = otherLoginSeen($pdo, $p['to_id'], $p['dev']);
    if (!$other) continue;
    $st = $pdo->prepare('DELETE FROM k_queue WHERE to_id = ? AND dev = ? AND created_at < ?');
    $st->execute([$p['to_id'], $p['dev'], $other]);
    $n += $st->rowCount();
  }
  return $n;
}
