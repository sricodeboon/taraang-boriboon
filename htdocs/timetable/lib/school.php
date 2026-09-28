<?php
// ข้อมูลโรงเรียน: ตรวจค่าที่แก้ไข และตรวจรูปโลโก้ก่อนบันทึก
declare(strict_types=1);

const LOGO_MAX_BYTES = 200_000;   // ขนาดไฟล์รูปหลังถอด base64 (เบราว์เซอร์ย่อเหลือ ~20–60KB อยู่แล้ว)
const LOGO_MAX_SIDE = 512;

/** คืนข้อความผิดพลาด หรือ null ถ้าผ่าน · $v ถูกตัดช่องว่างและแปลงค่าว่างเป็น null */
function validate_school(array &$v): ?string {
    foreach (['name', 'code', 'tambon', 'amphoe', 'province'] as $k) $v[$k] = trim((string) ($v[$k] ?? ''));
    if (mb_strlen($v['name']) < 3) return 'กรุณากรอกชื่อโรงเรียน';
    if (mb_strlen($v['name']) > 200) return 'ชื่อโรงเรียนยาวเกินไป';
    if ($v['province'] === '') return 'กรุณาเลือกจังหวัด';
    foreach (['province', 'amphoe', 'tambon'] as $k) if (mb_strlen($v[$k]) > 100) return 'ชื่อพื้นที่ยาวเกินไป';
    if (mb_strlen($v['code']) > 20) return 'รหัสโรงเรียนยาวเกินไป';
    foreach (['code', 'tambon', 'amphoe'] as $k) if ($v[$k] === '') $v[$k] = null;
    return null;
}

/**
 * ตรวจ data URL ของโลโก้: ต้องเป็น PNG หรือ JPEG จริง (อ่านหัวไฟล์ด้วย GD/getimagesize) ขนาดไม่เกินกำหนด
 * ไม่รับ SVG เพราะฝังสคริปต์ได้ · คืน [data URL ที่สะอาด, null] หรือ [null, ข้อความผิดพลาด]
 */
function validate_logo(string $dataUrl): array {
    if (!preg_match('#^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m)) return [null, 'รองรับเฉพาะรูป PNG หรือ JPG'];
    $bin = base64_decode($m[2], true);
    if ($bin === false || $bin === '') return [null, 'ไฟล์รูปเสียหาย'];
    if (strlen($bin) > LOGO_MAX_BYTES) return [null, 'รูปใหญ่เกินไป (ไม่เกิน 200KB หลังย่อ)'];
    $info = @getimagesizefromstring($bin);
    $want = $m[1] === 'png' ? IMAGETYPE_PNG : IMAGETYPE_JPEG;
    if (!$info || $info[2] !== $want) return [null, 'ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง'];
    if ($info[0] < 16 || $info[1] < 16 || $info[0] > LOGO_MAX_SIDE || $info[1] > LOGO_MAX_SIDE) return [null, 'ขนาดรูปต้องอยู่ระหว่าง 16–512 พิกเซล'];
    // เข้ารหัสรูปใหม่ด้วย GD (ถ้ามี): ตัดข้อมูลแฝงท้ายไฟล์/chunk แปลก ๆ ทิ้ง เหลือแต่พิกเซล กันไฟล์ polyglot
    if (function_exists('imagecreatefromstring')) {
        $im = @imagecreatefromstring($bin);
        if ($im === false) return [null, 'ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง'];
        ob_start();
        if ($m[1] === 'png') { imagealphablending($im, false); imagesavealpha($im, true); imagepng($im, null, 9); }
        else imagejpeg($im, null, 90);
        $clean = (string) ob_get_clean();
        if ($clean !== '' && strlen($clean) <= LOGO_MAX_BYTES) $bin = $clean;
    }
    return ['data:image/' . $m[1] . ';base64,' . base64_encode($bin), null];
}
