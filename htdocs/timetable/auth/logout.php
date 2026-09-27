<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // session หมดอายุไปแล้ว (ไม่ได้อยู่ในระบบ) → ถือว่าออกแล้ว ไม่ต้องแจ้ง error
    if (current_user()) {
        csrf_check();
        logout_user();
    }
}
redirect('index.php');
