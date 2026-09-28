<?php
// แกนกลางของระบบ: โหลดค่าตั้ง, session, ฐานข้อมูล, ตัวช่วยทั่วไป
declare(strict_types=1);

date_default_timezone_set('Asia/Bangkok');
// ไม่แสดง error/stack trace ให้ผู้ใช้เห็น (โฮสต์ฟรีบางที่เปิด display_errors ไว้) — เก็บลง error log แทน
ini_set('display_errors', '0');
ini_set('log_errors', '1');
set_exception_handler(function (Throwable $e): void {
    error_log('Uncaught ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
    }
    echo 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง';
});
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

// ---------- security headers ----------
/** nonce ของ CSP ต่อคำขอ: ใส่ใน <script nonce="…"> ทุกตัวที่เขียนในหน้า (inline + importmap) */
function csp_nonce(): string {
    static $n = null;
    return $n ??= base64_encode(random_bytes(16));
}

if (PHP_SAPI !== 'cli' && !headers_sent()) {
    $isHttps = !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    // สคริปต์: ไฟล์ในเว็บเดียวกัน + cdnjs (pdfmake/ExcelJS) + inline ที่มี nonce เท่านั้น → HTML ที่ถูกฉีดเข้ามารันสคริปต์ไม่ได้
    // style ยังต้อง 'unsafe-inline' (หน้าใช้ style="" และ <style> ฝังในหน้าเยอะ) + cdnjs เฉพาะ CSS ของ SweetAlert2 (มี SRI) · รูป: https: สำหรับรูปโปรไฟล์ Google/LINE
    // วิดีโอคู่มือ (assets/guide/*.mp4) ใช้ default-src 'self' · ไม่มี 'unsafe-eval'
    header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-" . csp_nonce() . "' https://cdnjs.cloudflare.com; "
        . "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' data: blob:; "
        . "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if ($isHttps) header('Strict-Transport-Security: max-age=15552000');
}

// ---------- session ----------
if (session_status() !== PHP_SESSION_ACTIVE) {
    $secure = !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    // ไม่รับ session id ที่เซิร์ฟเวอร์ไม่ได้สร้างเอง (กัน session fixation) — ไม่กระทบอายุ session
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
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

/** ข้อความแจ้งครั้งเดียวข้ามหน้า · kind: info|ok|warn|error (หน้าแสดงด้วย SweetAlert2 ผ่าน flash_html()) */
function flash(?string $msg = null, string $kind = 'warn'): ?string {
    if ($msg !== null) { $_SESSION['flash'] = $msg; $_SESSION['flash_kind'] = $kind; return null; }
    $m = $_SESSION['flash'] ?? null;
    $GLOBALS['FLASH_KIND'] = $_SESSION['flash_kind'] ?? 'warn';
    unset($_SESSION['flash'], $_SESSION['flash_kind']);
    return $m;
}
/** ชนิดของข้อความที่ flash() อ่านล่าสุด */
function flash_kind(): string {
    $k = $GLOBALS['FLASH_KIND'] ?? 'warn';
    return in_array($k, ['info', 'ok', 'warn', 'error'], true) ? $k : 'warn';
}

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
