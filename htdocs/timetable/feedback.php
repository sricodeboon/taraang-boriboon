<?php
// รับข้อเสนอแนะจากฟอร์ม #feedback (feedback_html() ใน lib/layout.php) — ผู้ไม่ล็อกอิน/โหมดทดลองส่งได้ จึงไม่อยู่ใน api.php (require_school ปิดไว้)
// POST: csrf, kind (bug|feature|praise|other), message (10–2,000 ตัวอักษร), contact (ไม่บังคับ ≤200), website (honeypot ต้องว่าง), page (≤100)
// Accept: application/json → {ok:true,msg} / {ok:false,error} · ฟอร์มธรรมดา (ไม่มี JS) → กลับหน้าเดิมพร้อม flash
// กันสแปมแบบฟรี ไม่มี CAPTCHA: honeypot + time-trap ($_SESSION['fb_t'] ตั้งตอนแสดงฟอร์ม ≥4 วิ) + rate limit 3 ชั้น + ลิงก์ >2 ลิงก์
// บอต (honeypot/เร็วเกิน/ลิงก์เยอะ) ได้คำตอบ "สำเร็จ" หลอกแต่ไม่บันทึก — ไม่บอกว่าถูกจับได้ด้วยอะไร
require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow');

const FB_KINDS = ['bug', 'feature', 'praise', 'other']; // ชื่อไทยอยู่ที่ FEEDBACK_KIND ใน lib/admin.php
const FB_MIN_SEC = 4;
const FB_MAX_BODY = 8192;
const FB_OK = 'ได้รับแล้ว ขอบคุณครับ ครูแจ็กอ่านทุกข้อความ ถ้าฝากช่องทางไว้จะตอบกลับช่วงเย็นหลังเลิกสอน (ไม่มีอีเมลยืนยันอัตโนมัติ)';

$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

/** ตอบกลับทั้งสองแบบ: JSON ให้สคริปต์ในหน้า · ฟอร์มธรรมดา → flash แล้วกลับไปที่ฟอร์มในหน้าเดิม */
function fb_reply(bool $ok, string $text, int $status = 200): never {
    global $wantsJson;
    if ($wantsJson) json_out($ok ? ['ok' => true, 'msg' => $text] : ['ok' => false, 'error' => $text], $status);
    flash($text, $ok ? 'ok' : 'warn');
    redirect(back_path() . '#feedback');
}

/** ข้อความบรรทัดเดียว: ตัดอักขระควบคุม ช่องว่างซ้อน แล้วตัดความยาว */
function fb_line(mixed $v, int $max): string {
    $s = is_string($v) ? $v : '';
    $s = trim((string) preg_replace('/[\p{Cc}\p{Cf}\s]+/u', ' ', $s));
    return mb_substr($s, 0, $max);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    if ($wantsJson) json_out(['ok' => false, 'error' => 'ส่งข้อความผ่านฟอร์มเท่านั้น'], 405);
    redirect('index.php#feedback');
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > FB_MAX_BODY) fb_reply(false, 'ข้อความยาวเกินไป กรุณาย่อให้สั้นลง', 413);
if (!csrf_valid()) fb_reply(false, 'หน้านี้เปิดค้างไว้นานจนหมดเวลา กรุณารีเฟรชหน้าแล้วส่งอีกครั้ง', 419);

// ชั้น 1–2: honeypot ต้องว่าง · ต้องเปิดฟอร์มมาแล้วอย่างน้อย 4 วินาที (ไม่มีค่า fb_t = ไม่ได้เปิดฟอร์มจากหน้าเว็บเรา)
$shownAt = (int) ($_SESSION['fb_t'] ?? 0);
if (trim((string) ($_POST['website'] ?? '')) !== '' || $shownAt <= 0 || time() - $shownAt < FB_MIN_SEC) fb_reply(true, FB_OK);

// ตรวจค่า (ข้อผิดพลาดของคนจริง → บอกตรง ๆ ให้แก้)
$kind = (string) ($_POST['kind'] ?? '');
if (!in_array($kind, FB_KINDS, true)) fb_reply(false, 'กรุณาเลือกเรื่องที่อยากบอก (ติดปัญหา / อยากได้ฟีเจอร์ / ชมเชย / อื่น ๆ)', 422);
$message = trim(str_replace("\r\n", "\n", is_string($_POST['message'] ?? null) ? $_POST['message'] : ''));
$message = (string) preg_replace('/[^\P{Cc}\n\t]/u', '', $message); // คงขึ้นบรรทัดใหม่/แท็บ ตัดอักขระควบคุมอื่น
$len = mb_strlen($message);
if ($len < 10) fb_reply(false, 'เล่าเพิ่มอีกนิดครับ (อย่างน้อย 10 ตัวอักษร)', 422);
if ($len > 2000) fb_reply(false, 'ข้อความยาวเกิน 2,000 ตัวอักษร กรุณาย่อให้สั้นลง', 422);
$contactRaw = is_string($_POST['contact'] ?? null) ? trim($_POST['contact']) : '';
if (mb_strlen($contactRaw) > 200) fb_reply(false, 'ช่องทางติดต่อกลับยาวเกิน 200 ตัวอักษร', 422);
$contact = fb_line($contactRaw, 200);
$page = fb_line($_POST['page'] ?? '', 100);

// ชั้น 3: ลิงก์เกิน 2 ลิงก์ = ลักษณะสแปมโฆษณา → ตอบสำเร็จแต่ไม่บันทึก
if (preg_match_all('~https?://|www\.~i', $message . ' ' . $contact) > 2) fb_reply(true, FB_OK);

// ชั้น 4: rate limit (เครื่องเดียว 5 ข้อความ/วัน · session เดียว 1 ข้อความ/นาที · ทั้งระบบ 200/วัน) — คนจริงที่ส่งถี่ได้คำแนะนำให้รอ
// ถังต่อ session ใส่ก่อน: กดส่งซ้ำรัว ๆ ไม่กินโควตารายวันของเครื่อง
// (แฮช session id ก่อนใช้เป็นชื่อถัง — ไม่เก็บ session id ดิบลงฐาน)
if (rate_limited('fb:s:' . substr(hash('sha256', 'fb-s|' . session_id()), 0, 32), 1, 60)) fb_reply(false, 'เพิ่งส่งไปเมื่อสักครู่ รอประมาณ 1 นาทีแล้วส่งข้อความถัดไปได้ครับ', 429);
if (rate_limited('fb:' . client_key(), 5, 86400)) fb_reply(false, 'วันนี้ส่งข้อความครบ 5 ข้อความแล้ว พรุ่งนี้ส่งเพิ่มได้ หรือทักเพจ Facebook ศรีโค้ดบูรณ์ได้เลยครับ', 429);
if (rate_limited('fb:all', 200, 86400)) fb_reply(false, 'วันนี้มีข้อความเข้ามามากเป็นพิเศษ กรุณาส่งใหม่พรุ่งนี้ หรือทักเพจ Facebook ศรีโค้ดบูรณ์ได้เลยครับ', 429);

$me = current_user(); // ไม่บังคับล็อกอิน · guest = โหมดทดลอง (แอดมินเห็นป้าย "ทดลอง")
db_exec('INSERT INTO feedback (created_at, kind, message, contact, page, school_id, user_id, provider, ua, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    now(), $kind, $message, $contact !== '' ? $contact : null, $page,
    $me && $me['school_id'] ? (int) $me['school_id'] : null, $me ? (int) $me['id'] : null,
    $me ? (string) $me['provider'] : '', fb_line($_SERVER['HTTP_USER_AGENT'] ?? '', 160), 'new',
]);
// เก็บไม่เกิน 1 ปี (privacy.php ข้อ 4) — โฮสต์ไม่มี cron จึงลบของเก่าตอนมีข้อความใหม่ (ตารางเล็ก ข้อความวันละไม่กี่แถว)
try { db_exec('DELETE FROM feedback WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 365 * 86400)]); }
catch (PDOException $e) { error_log('feedback purge: ' . $e->getMessage()); }
$_SESSION['fb_t'] = time(); // ข้อความถัดไปจากหน้าเดิม (ไม่รีเฟรช) ต้องรออีก 4 วิ เช่นกัน
fb_reply(true, FB_OK);
