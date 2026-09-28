<?php
// หน้าทดสอบโฮสติ้ง: เช็กว่า PHP ทำงาน และเชื่อมต่อ MySQL ได้ (ถ้ามี config.php)
declare(strict_types=1);
date_default_timezone_set('Asia/Bangkok');

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");

$db = ['state' => 'skip', 'detail' => 'ยังไม่ได้ตั้งค่า config.php'];
$configFile = __DIR__ . '/config.php';
$cfg = is_file($configFile) ? (array) require $configFile : [];

// รายละเอียด (เวอร์ชัน PHP/cURL/SQLite, สถานะ DB) เปิดเผยเฉพาะผู้ที่รู้คีย์: /status.php?k=<status_key ใน config.php>
// ไม่มีคีย์หรือคีย์ผิด → แสดงแค่ว่าเว็บออนไลน์ ไม่บอกเวอร์ชันซอฟต์แวร์ และไม่แตะฐานข้อมูล (กันการยิงหน้าให้ INSERT ซ้ำ ๆ)
$key = (string) ($cfg['status_key'] ?? '');
$full = strlen($key) >= 16 && hash_equals($key, (string) ($_GET['k'] ?? ''));

if ($full && isset($cfg['host'])) {
    try {
        $pdo = new PDO(
            "mysql:host={$cfg['host']};dbname={$cfg['name']};charset=utf8mb4",
            $cfg['user'],
            $cfg['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]
        );
        $pdo->exec('CREATE TABLE IF NOT EXISTS visits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            visited_at DATETIME NOT NULL
        ) CHARACTER SET utf8mb4');
        $pdo->prepare('INSERT INTO visits (visited_at) VALUES (?)')->execute([date('Y-m-d H:i:s')]);
        $count = (int) $pdo->query('SELECT COUNT(*) FROM visits')->fetchColumn();
        $version = $pdo->query('SELECT VERSION()')->fetchColumn();
        $db = ['state' => 'ok', 'detail' => "MySQL {$version} · เข้าชมแล้ว {$count} ครั้ง"];
    } catch (Throwable $e) {
        // ไม่แสดงข้อความ error จริงต่อสาธารณะ
        error_log('DB error: ' . $e->getMessage());
        $db = ['state' => 'fail', 'detail' => 'เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจค่าใน config.php'];
    }
}

$checks = !$full ? [
    ['เว็บไซต์', 'ok', 'ออนไลน์'],
    ['HTTPS', !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'ok' : 'skip',
        !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'เปิดใช้งาน' : 'ยังไม่เปิด SSL'],
] : [
    ['PHP', 'ok', 'PHP ' . PHP_VERSION],
    ['เวลาเซิร์ฟเวอร์', 'ok', date('j/n/Y H:i:s') . ' (Asia/Bangkok)'],
    ['HTTPS', !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'ok' : 'skip',
        !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'เปิดใช้งาน' : 'ยังไม่เปิด SSL'],
    ['ฐานข้อมูล', $db['state'], $db['detail']],
    ['SQLite', extension_loaded('pdo_sqlite') ? 'ok' : 'fail', extension_loaded('pdo_sqlite') ? 'pdo_sqlite ' . (class_exists('SQLite3') ? SQLite3::version()['versionString'] : '') : 'ไม่รองรับ'],
    ['cURL', function_exists('curl_init') ? 'ok' : 'fail', function_exists('curl_init') ? 'curl ' . (curl_version()['version'] ?? '') : 'ไม่รองรับ'],
    ['OpenSSL', extension_loaded('openssl') ? 'ok' : 'fail', extension_loaded('openssl') ? 'ใช้ได้' : 'ไม่รองรับ'],
];
$icon = ['ok' => '✅', 'skip' => '⏳', 'fail' => '❌'];
?>
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ศรีโค้ดบูรณ์ · ทดสอบระบบ</title>
<link rel="preload" href="/assets/fonts/IBMPlexSansThai-400-thai.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ChakraPetch-700-thai.woff2" as="font" type="font/woff2" crossorigin>
<style><?php readfile(__DIR__ . '/assets/fonts/fonts.css'); ?></style>
<style>
  :root { --ink:#0F2438; --gold:#E3B85A; --blue:#7FB0E8; --mist:#F2F4F1; --muted:#9FB0B5; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--ink); color:var(--mist);
         font-family:"IBM Plex Sans Thai",system-ui,sans-serif; display:grid; place-items:center; padding:24px 16px; }
  main { width:100%; max-width:560px; display:grid; gap:20px; }
  h1 { font-family:"Chakra Petch",sans-serif; font-size:clamp(2rem,8vw,3rem); margin:0; line-height:1.1; }
  h1 .b { font-family:"JetBrains Mono",monospace; color:var(--gold); }
  h1 .c { color:var(--blue); }
  .tag { color:var(--muted); margin:6px 0 0; }
  ul { list-style:none; margin:0; padding:0; border-top:1px solid #22343F; }
  li { display:grid; grid-template-columns:28px 120px 1fr; gap:8px; padding:12px 0; border-bottom:1px solid #22343F; }
  li b { font-weight:500; }
  li span:last-child { color:var(--muted); overflow-wrap:anywhere; }
  footer { font-size:.85rem; color:var(--muted); }
  footer b { color:var(--gold); font-weight:500; }
</style>
</head>
<body>
<main>
  <div>
    <h1>ศรี<span class="b">{</span><span class="c">โค้ด</span><span class="b">}</span>บูรณ์</h1>
    <p class="tag">โค้ดครบ งานบริบูรณ์ · เขียนให้ใช้ได้ สอนให้ใช้เป็น</p>
  </div>
  <ul>
    <?php foreach ($checks as [$label, $state, $detail]): ?>
      <li><span><?= $icon[$state] ?></span><b><?= htmlspecialchars($label) ?></b><span><?= htmlspecialchars($detail) ?></span></li>
    <?php endforeach; ?>
  </ul>
  <footer>หน้าทดสอบโฮสติ้ง · <b>ครูแจ็ก</b> · นาทม นครพนม</footer>
</main>
</body>
</html>
