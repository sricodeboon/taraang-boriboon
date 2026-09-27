<?php
// ลองใช้ทันที: สร้างโรงเรียนทดลองพร้อมข้อมูลตัวอย่าง ข้อมูลทดลองถูกลบเองหลัง 48 ชั่วโมง
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/terms.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('index.php');
csrf_check();

cleanup_guests();

$user = login_user('guest', bin2hex(random_bytes(12)), 'ผู้ทดลองใช้', null, null);
db_exec('INSERT INTO schools (name, tambon, amphoe, province, created_at) VALUES (?,?,?,?,?)',
    ['โรงเรียนทดลอง (ข้อมูลตัวอย่าง)', 'นาทม', 'นาทม', 'นครพนม', now()]);
$schoolId = (int) db()->lastInsertId();
db_exec('UPDATE users SET school_id = ? WHERE id = ?', [$schoolId, $user['id']]);
create_term($schoolId, (int) $user['id'], 'sample');
redirect('app.php');

function cleanup_guests(): void {
    $cutoff = date('Y-m-d H:i:s', time() - 48 * 3600);
    $old = db_all("SELECT id, school_id FROM users WHERE provider = 'guest' AND created_at < ? LIMIT 100", [$cutoff]);
    foreach ($old as $g) {
        if ($g['school_id']) {
            db_exec('DELETE FROM terms WHERE school_id = ?', [$g['school_id']]);
            db_exec('DELETE FROM schools WHERE id = ?', [$g['school_id']]);
        }
        db_exec('DELETE FROM users WHERE id = ?', [$g['id']]);
    }
}
