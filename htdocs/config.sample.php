<?php
// คัดลอกไฟล์นี้เป็น config.php แล้วใส่ค่าจากหน้า MySQL Databases ของ InfinityFree
// (ห้ามอัปโหลด config.php ขึ้น GitHub)
return [
    'host' => 'sqlXXX.infinityfree.com',   // MySQL Hostname
    'name' => 'if0_XXXXXXXX_demo',         // MySQL Database Name
    'user' => 'if0_XXXXXXXX',              // MySQL Username
    'pass' => 'รหัสผ่านบัญชีโฮสติ้ง',       // MySQL Password (vPanel password)
    // คีย์ดูรายละเอียดหน้า /status.php?k=... (สุ่มยาว ≥16 ตัว เช่น php -r 'echo bin2hex(random_bytes(16));') เว้นว่าง = ปิดรายละเอียด
    'status_key' => '',
];
