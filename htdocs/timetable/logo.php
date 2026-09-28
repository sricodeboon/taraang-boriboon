<?php
// ส่งรูปโลโก้ของโรงเรียนที่ล็อกอินอยู่เท่านั้น (ไม่มีทางขอโลโก้ของโรงเรียนอื่น)
// เรียกเป็น logo.php?v=<logo_rev> → แคชได้นาน เพราะเปลี่ยนรูปแล้ว v เปลี่ยนตาม
require __DIR__ . '/lib/bootstrap.php';

[, $school] = require_school(true);
$row = db_one('SELECT logo FROM schools WHERE id = ?', [(int) $school['id']]);
if (!$row || !$row['logo'] || !preg_match('#^data:(image/(?:png|jpeg));base64,(.+)$#', $row['logo'], $m)) {
    http_response_code(404);
    exit;
}
$bin = base64_decode($m[2], true);
if ($bin === false) { http_response_code(404); exit; }
while (ob_get_level()) ob_end_clean(); // PNG/JPEG บีบอัดอยู่แล้ว ไม่ต้องผ่าน gzip ของ bootstrap
header('Content-Type: ' . $m[1]);
header('Content-Length: ' . strlen($bin));
header('X-Content-Type-Options: nosniff');
// ถ้ามีไฟล์ polyglot (รูปที่มี HTML ซ่อน) หลุดมา ก็รันอะไรไม่ได้เมื่อเปิดตรง ๆ
header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
header('Content-Disposition: inline; filename="logo.' . ($m[1] === 'image/png' ? 'png' : 'jpg') . '"');
header('Cache-Control: private, max-age=31536000, immutable');
echo $bin;
