<?php
// แกนกลางของระบบ: โหลดค่าตั้ง, session, ฐานข้อมูล, ตัวช่วยทั่วไป
declare(strict_types=1);

date_default_timezone_set('Asia/Bangkok');
// บีบอัด HTML/JSON ด้วย gzip (โฮสต์ฟรีบางที่ไม่บีบให้ และ php -S ไม่บีบเลย) — ob_gzhandler ดู Accept-Encoding เอง
if (PHP_SAPI !== 'cli' && extension_loaded('zlib') && !ini_get('zlib.output_compression')) ob_start('ob_gzhandler');
define('APP_ROOT', dirname(__DIR__));

$configFile = APP_ROOT . '/config.php';
$GLOBALS['CFG'] = is_file($configFile) ? require $configFile : require APP_ROOT . '/config.sample.php';

function cfg(string $path, $default = null) {
    $v = $GLOBALS['CFG'];
    foreach (explode('.', $path) as $k) {
        if (!is_array($v) || !array_key_exists($k, $v)) return $default;
        $v = $v[$k];
    }
    return $v;
}

function base_url(string $path = ''): string {
    // php -S (ทดสอบในเครื่อง) ใช้ host ที่เปิดอยู่ ไม่พาไปโดเมนจริง
    $base = PHP_SAPI === 'cli-server' ? '' : rtrim((string) cfg('base_url', ''), '/');
    if ($base === '') {
        $https = !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
        $dir = preg_replace('#/(auth|lib)$#', '', $dir);
        $base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
    }
    return $base . ($path === '' ? '' : '/' . ltrim($path, '/'));
}

// ---------- session ----------
if (session_status() !== PHP_SESSION_ACTIVE) {
    $secure = !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('ttsid');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => parse_url(base_url(), PHP_URL_PATH) ?: '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

// ---------- helpers ----------
function h(?string $s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

function redirect(string $to): never {
    header('Location: ' . (preg_match('#^https?://#', $to) ? $to : base_url($to)));
    exit;
}

function json_out($data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function csrf_valid(): bool {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    return is_string($sent) && $sent !== '' && hash_equals(csrf_token(), $sent);
}

function csrf_check(): void {
    if (csrf_valid()) return;
    if (str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'json') || isset($_SERVER['HTTP_X_CSRF_TOKEN'])) {
        json_out(['error' => 'หมดเวลาการใช้งาน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง', 'csrf' => true], 419);
    }
    // ฟอร์มปกติ: หน้าเปิดค้างไว้นานจน session หมดอายุ (หรือออก/เข้าระบบจากแท็บอื่น) → กลับไปหน้าเดิมที่มี token ใหม่ แทนหน้าข้อความตัน
    flash('หน้านี้เปิดค้างไว้นานจนหมดเวลา กรุณากดอีกครั้ง');
    redirect(back_path());
}

/** หน้าก่อนหน้าในเว็บเดียวกันเท่านั้น (กัน open redirect) · ไม่มี/ต่างโดเมน → หน้าแรกของระบบ */
function back_path(): string {
    $ref = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    $base = parse_url(base_url(), PHP_URL_PATH) ?: '/';
    $u = parse_url($ref);
    $host = ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
    if (!$u || $host !== ($_SERVER['HTTP_HOST'] ?? '') || !str_starts_with($u['path'] ?? '', rtrim($base, '/') . '/')) return 'index.php';
    $rel = ltrim(substr($u['path'], strlen(rtrim($base, '/'))), '/');
    return preg_match('#^[a-z]+\.php$#', $rel) ? $rel : 'index.php';
}

function flash(?string $msg = null): ?string {
    if ($msg !== null) { $_SESSION['flash'] = $msg; return null; }
    $m = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $m;
}

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
