<?php
// ลองใช้ทันที: สร้างโรงเรียนทดลองพร้อมข้อมูลตัวอย่าง ข้อมูลทดลองถูกลบเองหลัง 48 ชั่วโมง
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/terms.php';

const GUEST_MAX_LIVE = 400;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('index.php');
csrf_check();

cleanup_guests();

// กันสคริปต์สร้างโรงเรียนทดลองไม่จำกัดจนฐานข้อมูลเต็ม: ต่อ IP 10 ครั้ง/ชม. ทั้งระบบ 120 ครั้ง/ชม. และค้างอยู่ไม่เกิน 400 โรงเรียน
$live = (int) db_one("SELECT COUNT(*) AS n FROM users WHERE provider = 'guest'")['n'];
if ($live >= GUEST_MAX_LIVE || rate_limited('guest:' . client_key(), 10, 3600) || rate_limited('guest:all', 120, 3600)) {
    flash('มีผู้ทดลองใช้จำนวนมากในขณะนี้ กรุณาลองใหม่ภายหลัง หรือเข้าสู่ระบบด้วย Google/LINE');
    redirect('index.php');
}

$user = login_user('guest', bin2hex(random_bytes(12)), 'ผู้ทดลองใช้', null, null);
// โรงเรียน + ผูกผู้ใช้ + ภาคเรียนแรก ในธุรกรรมเดียว (fsync ครั้งเดียว ไม่เหลือโรงเรียนครึ่ง ๆ ถ้าล้มกลางทาง)
db_tx(function () use ($user) {
    db_exec('INSERT INTO schools (name, tambon, amphoe, province, created_at) VALUES (?,?,?,?,?)',
        ['โรงเรียนทดลอง (ข้อมูลตัวอย่าง)', 'นาทม', 'นาทม', 'นครพนม', now()]);
    $schoolId = (int) db()->lastInsertId();
    db_exec('UPDATE users SET school_id = ? WHERE id = ?', [$schoolId, $user['id']]);
    create_term($schoolId, (int) $user['id'], 'sample');
});
redirect('app.php');
