<?php
/* Push diagnostics.
 *
 * Open this in a browser to see, in plain terms, whether push can work:
 *   https://bharatapp.chat/api/pushcheck.php
 *
 * It reports configuration only. It never prints the key, and it can't read
 * any message — it just answers "is push set up, and are devices registered".
 */
header('Content-Type: text/plain; charset=utf-8');

echo "BHARATAPP PUSH CHECK\n";
echo "=================\n\n";

// 1. the service account file
$keyPath = __DIR__ . '/fcm-key.json';
if (!file_exists($keyPath)) {
    echo "[FAIL] api/fcm-key.json is NOT there.\n";
    echo "       Upload the Firebase service-account JSON to the api folder,\n";
    echo "       named exactly fcm-key.json. Push cannot work without it.\n";
    exit;
}
if (!is_readable($keyPath)) {
    echo "[FAIL] api/fcm-key.json exists but PHP cannot read it.\n";
    echo "       Set its permissions to 644.\n";
    exit;
}
$sa = json_decode((string)file_get_contents($keyPath), true);
if (!$sa || empty($sa['client_email']) || empty($sa['private_key'])) {
    echo "[FAIL] api/fcm-key.json is not a valid service-account file.\n";
    echo "       Re-download it from Firebase Console > Project settings >\n";
    echo "       Service accounts > Generate new private key.\n";
    exit;
}
echo "[ok]   Key file found.\n";
echo "       project: " . ($sa['project_id'] ?? '?') . "\n";
echo "       account: " . substr((string)($sa['client_email'] ?? ''), 0, 28) . "...\n\n";

// 2. can we get a Google access token
require_once __DIR__ . '/config.php';
$token = null;
{
    // signed here rather than reusing the app's helper, so the failure
    // reason can be shown
    $now = time();
    $claim = [
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ];
    $b64 = fn($d) => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
    $jwt = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])) . '.' . $b64(json_encode($claim));
    $sig = '';
    $ok  = @openssl_sign($jwt, $sig, $sa['private_key'], 'sha256WithRSAEncryption');
    if (!$ok) {
        echo "[FAIL] Could not sign with the private key.\n";
        echo "       The key may have been reformatted on upload — the \\n\n";
        echo "       sequences inside private_key must stay intact.\n";
        exit;
    }
    $jwt .= '.' . $b64($sig);

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) {
        echo "[FAIL] Cannot reach Google from this server: $err\n";
        echo "       Hostinger may be blocking outbound HTTPS.\n";
        exit;
    }
    $j = json_decode((string)$res, true);
    $token = $j['access_token'] ?? null;
    if (!$token) {
        echo "[FAIL] Google refused the key (HTTP $code).\n";
        echo "       " . substr((string)$res, 0, 240) . "\n";
        echo "       Usually means the key was revoked, or the Firebase\n";
        echo "       Cloud Messaging API is not enabled for the project.\n";
        exit;
    }
}
echo "[ok]   Google accepted the key — push can be sent.\n\n";


// 3. registered devices
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $n = (int)$pdo->query("SELECT COUNT(*) FROM k_fcm")->fetchColumn();
    if ($n === 0) {
        echo "[FAIL] No devices are registered.\n";
        echo "       Open the app on a phone, allow notifications when asked,\n";
        echo "       then reload this page. If it stays 0, the app is not\n";
        echo "       reaching the server or the notification permission was\n";
        echo "       denied.\n";
    } else {
        echo "[ok]   $n device(s) registered.\n";
        $rows = $pdo->query("SELECT kal_id, updated_at FROM k_fcm ORDER BY updated_at DESC LIMIT 10")->fetchAll();
        foreach ($rows as $r) {
            echo "       " . $r['kal_id'] . "  last seen " . $r['updated_at'] . "\n";
        }
    }
} catch (Throwable $e) {
    echo "[FAIL] Database problem: " . $e->getMessage() . "\n";
}

// 4. actually send one, and show exactly what FCM says
$target = isset($_GET['to']) ? strtoupper(trim((string)$_GET['to'])) : '';
if ($target === '') {
    echo "\nTo send a real test notification, add ?to=KAL-XXXX-XXXX to this\n";
    echo "page's address, using the id of the phone you want to ring.\n";
    exit;
}

echo "\nSENDING A TEST TO $target\n";
echo "----------------------------------------\n";

try {
    $st = $pdo->prepare("SELECT token, updated_at FROM k_fcm WHERE kal_id=? ORDER BY updated_at DESC");
    $st->execute([$target]);
    $rows = $st->fetchAll();
} catch (Throwable $e) {
    echo "[FAIL] " . $e->getMessage() . "\n";
    exit;
}

if (!$rows) {
    echo "[FAIL] That id has no registered device.\n";
    echo "       Open the app on that phone once, then try again.\n";
    exit;
}

echo count($rows) . " token(s) on file for this id.\n\n";

$project = $sa['project_id'] ?? '';
$url = 'https://fcm.googleapis.com/v1/projects/' . $project . '/messages:send';

foreach ($rows as $i => $r) {
    $msg = ['message' => [
        'token' => $r['token'],
        'notification' => ['title' => 'BharatApp', 'body' => 'Test notification'],
        'android' => [
            'priority' => 'high',
            'notification' => ['sound' => 'default', 'channel_id' => 'kalisi_messages_v2'],
        ],
        'data' => ['type' => 'message', 'sender' => $target],
    ]];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($msg),
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $n = $i + 1;
    echo "token #$n (registered " . $r['updated_at'] . ")\n";
    if ($code === 200) {
        echo "  [ok]   FCM accepted it. If the phone stayed silent, the phone\n";
        echo "         is dropping it — battery optimisation or notifications off.\n";
    } else {
        echo "  [FAIL] HTTP $code\n";
        echo "         " . substr((string)$res, 0, 260) . "\n";
        if ($code === 404) {
            echo "         This token is dead — that phone reinstalled or cleared data.\n";
        }
    }
    echo "\n";
}

echo "If a token was accepted but nothing arrived, the phone is the cause.\n";
echo "If every token failed, the message above says why.\n";
