<?php
// ลองใช้ทันที: สร้างโรงเรียนทดลองพร้อมข้อมูลตัวอย่าง ข้อมูลทดลองถูกลบเองหลัง 48 ชั่วโมง
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/terms.php';

const GUEST_MAX_LIVE = 400;
// ข้อมูลตัวอย่างที่ให้เลือกจากปุ่มหน้าแรก (name=kind) · ค่าอื่น/ไม่ส่ง = มัธยมตามเดิม · ไม่เปิด 'blank' ให้โหมดทดลอง
const GUEST_KINDS = ['sample' => 'มัธยม', 'sample-primary' => 'ประถม'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('index.php');
csrf_check();

cleanup_guests();

$kind = (string) ($_POST['kind'] ?? 'sample');
if (!isset(GUEST_KINDS[$kind]) || !in_array($kind, TEMPLATE_KINDS, true)) $kind = 'sample';

// กันสคริปต์สร้างโรงเรียนทดลองไม่จำกัดจนฐานข้อมูลเต็ม: ต่อ IP 10 ครั้ง/ชม. ทั้งระบบ 30 ครั้ง/ชม. และค้างอยู่ไม่เกิน 400 โรงเรียน
// (ทดลองหนึ่งรอบ ≈ 25 hits · เดิม 120/ชม. เต็มทั้งวัน ≈ 72k hits เกินเพดาน 50k/วันของโฮสต์ → 30/ชม. ≈ 18k/วัน)
$live = (int) db_one("SELECT COUNT(*) AS n FROM users WHERE provider = 'guest'")['n'];
if ($live >= GUEST_MAX_LIVE || rate_limited('guest:' . client_key(), 10, 3600) || rate_limited('guest:all', 30, 3600)) {
    flash('มีผู้ทดลองใช้จำนวนมากในขณะนี้ กรุณาลองใหม่ภายหลัง หรือเข้าสู่ระบบด้วย Google/LINE');
    redirect('index.php');
}

// นับว่าเลือกตัวอย่างแบบไหน (ตัวชี้วัด "ทดลองใช้ประถม") · ถัง gk: ไม่ปนกับ guest:* ที่ใช้กันสคริปต์ และถูกลบเองหลัง 1 วันเหมือนแถวอื่นใน rate_hits
db_exec('INSERT INTO rate_hits (bucket, at) VALUES (?, ?)', ['gk:' . $kind, time()]);

$user = login_user('guest', bin2hex(random_bytes(12)), 'ผู้ทดลองใช้', null, null);
// โรงเรียน + ผูกผู้ใช้ + ภาคเรียนแรก ในธุรกรรมเดียว (fsync ครั้งเดียว ไม่เหลือโรงเรียนครึ่ง ๆ ถ้าล้มกลางทาง)
db_tx(function () use ($user, $kind) {
    db_exec('INSERT INTO schools (name, tambon, amphoe, province, created_at) VALUES (?,?,?,?,?)',
        ['โรงเรียนทดลอง (ข้อมูลตัวอย่าง)', 'นาทม', 'นาทม', 'นครพนม', now()]);
    $schoolId = (int) db()->lastInsertId();
    db_exec('UPDATE users SET school_id = ? WHERE id = ?', [$schoolId, $user['id']]);
    create_term($schoolId, (int) $user['id'], $kind);
});
flash('เข้าสู่โหมดทดลองแล้ว ข้อมูลตัวอย่างโรงเรียน' . GUEST_KINDS[$kind] . 'พร้อมให้ลองจัด (ลบเองใน 2 วัน)', 'ok');
redirect(after_login('app.php'));
