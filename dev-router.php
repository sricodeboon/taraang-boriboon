<?php
// router สำหรับทดสอบในเครื่อง: php -S 127.0.0.1:8080 -t htdocs dev-router.php
// ทำตัวเหมือน Apache บนโฮสต์ — ไฟล์ที่ไม่มีอยู่ตอบ 404 จริง (php -S ปกติจะส่ง index.php แทน)
$root = __DIR__ . '/htdocs';
$path = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$file = realpath($root . $path);
if ($file !== false && str_starts_with($file, $root)) {
    if (is_file($file)) {
        // ไฟล์ข้อความบีบอัด gzip เหมือนโฮสต์จริง (InfinityFree/openresty บีบ br/gzip) ให้ผล Lighthouse ในเครื่องใกล้ของจริง
        $types = ['js' => 'text/javascript', 'mjs' => 'text/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml', 'json' => 'application/json', 'txt' => 'text/plain', 'xml' => 'application/xml'];
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (!isset($types[$ext])) return false;
        header('Content-Type: ' . $types[$ext] . '; charset=utf-8');
        header('Cache-Control: public, max-age=31536000');
        ob_start('ob_gzhandler');
        readfile($file);
        return true;
    }
    if (is_dir($file) && (is_file($file . '/index.php') || is_file($file . '/index.html'))) return false;
}
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
readfile($root . '/404.html');
