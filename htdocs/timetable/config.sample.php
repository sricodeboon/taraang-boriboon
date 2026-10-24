<?php
// คัดลอกเป็น config.php แล้วกรอกค่า (ห้ามอัปโหลด config.php ขึ้น GitHub)
return [
    // URL เต็มของระบบ ไม่มี / ปิดท้าย (ใช้สร้าง redirect URI ของ Google/LINE)
    'base_url' => 'https://sricodeboon.infinityfreeapp.com/timetable',

    // ฐานข้อมูล: 'sqlite' (ค่าเริ่มต้น ไม่ต้องใช้รหัสผ่าน) หรือ 'mysql'
    'db' => [
        'driver' => 'sqlite',
        'sqlite_path' => __DIR__ . '/storage/timetable.sqlite',
        // โหมด journal: 'wal' (ค่าเริ่มต้น ถ้าโฮสต์ใช้ไม่ได้ระบบถอยไป delete เอง) · ตั้ง 'delete' ถ้าเจอ error เกี่ยวกับไฟล์ -wal/-shm บนโฮสต์
        // 'sqlite_journal' => 'wal',
        // สำหรับ mysql:
        'host' => '', 'name' => '', 'user' => '', 'pass' => '',
    ],

    // Google: https://console.cloud.google.com/apis/credentials → OAuth client ID (Web application)
    // Authorized redirect URI: {base_url}/auth/callback.php?p=google
    'google' => ['client_id' => '', 'client_secret' => ''],

    // LINE: https://developers.line.biz/console/ → LINE Login channel
    // Callback URL: {base_url}/auth/callback.php?p=line
    // email: ตั้ง true หลังยื่นขอสิทธิ์อีเมลใน LINE Developers (แท็บ OpenID Connect) และได้รับอนุมัติแล้ว
    'line' => ['channel_id' => '', 'channel_secret' => '', 'email' => false],

    // ผู้ดูแลระบบที่เปิดหน้า admin.php ได้ (ต้องล็อกอินด้วย Google ด้วยอีเมลเหล่านี้) · ไม่ใส่ = ใช้ค่าเริ่มต้นในโค้ด
    // 'admin_emails' => ['sricodeboon@gmail.com', 'dev.nathom@gmail.com'],

    // กล่อง "เลี้ยงโอวัลตินครูแจ็กสักแก้ว" (พร้อมเพย์) · ไม่ใส่คีย์ = ใช้ค่าเริ่มต้นในโค้ด (lib/layout.php) · ตั้ง promptpay เป็น '' = ปิดกล่อง
    // รูป QR ใน assets/brand/promptpay-qr.* เป็นของเบอร์ 0930732896 เท่านั้น ใส่เบอร์อื่นจะแสดงแค่เบอร์ + ปุ่มคัดลอก
    'donate' => ['promptpay' => '0930732896', 'name' => 'รัชเดช ศรีแก้ว'],

    // ช่องทางติดต่อ (ใต้ฟอร์มข้อเสนอแนะ + ท้ายหน้า) · ตั้งเป็น '' = ไม่แสดงช่องนั้น
    'contact' => ['facebook' => 'https://www.facebook.com/sricodeboon', 'email' => 'sricodeboon@gmail.com'],
];
