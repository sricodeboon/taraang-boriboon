<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/oauth.php';

$p = $_GET['p'] ?? '';
try {
    if (isset($_GET['error'])) throw new RuntimeException('ยกเลิกการเข้าสู่ระบบ');
    $info = oauth_finish($p, (string) ($_GET['code'] ?? ''), (string) ($_GET['state'] ?? ''));
    $user = login_user($p, $info['uid'], $info['name'], $info['email'], $info['avatar']);
    redirect($user['school_id'] ? 'app.php' : 'signup.php');
} catch (Throwable $e) {
    error_log('OAuth callback: ' . $e->getMessage());
    // PDOException เป็นลูกของ RuntimeException — ห้ามโชว์ข้อความฐานข้อมูล (มี SQL/พาธไฟล์) ให้ผู้ใช้เห็น
    flash($e instanceof RuntimeException && !$e instanceof PDOException ? $e->getMessage() : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    redirect('index.php');
}
