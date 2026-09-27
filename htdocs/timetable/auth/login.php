<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/oauth.php';

$p = $_GET['p'] ?? '';
$ready = providers_ready();
if (!in_array($p, ['google', 'line'], true) || empty($ready[$p])) {
    flash('ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยช่องทางนี้');
    redirect('index.php');
}
oauth_start($p);
