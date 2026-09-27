# ตารางบริบูรณ์ · ระบบจัดตารางเรียนตารางสอนออนไลน์

ระบบจัดตารางเรียนตารางสอนสำหรับโรงเรียนไทย ใช้ผ่านเบราว์เซอร์ ใช้ฟรี โดย **ศรีโค้ดบูรณ์** (ครูแจ็ก อ.นาทม จ.นครพนม)

**ใช้งานจริง:** https://sricodeboon.infinityfreeapp.com/timetable/ · [คู่มือการใช้งาน](https://sricodeboon.infinityfreeapp.com/timetable/guide.php)

เครื่องมืออื่นในเว็บเดียวกัน: **[DPA พร้อมส่ง](https://github.com/sricodeboon/dpa-phrom-song)** ย่อไฟล์วิดีโอการสอนและรวม PDF สำหรับยื่นประเมินวิทยฐานะ (โฟลเดอร์ `htdocs/dpa/` แยกเป็น repo ของตัวเอง)

## ความสามารถ

- เข้าสู่ระบบด้วย Google หรือ LINE แต่ละโรงเรียนเห็นและแก้ได้เฉพาะข้อมูลของตัวเอง
- ลงทะเบียนโรงเรียนพร้อมค้นหาชื่อโรงเรียน จังหวัด อำเภอ ตำบล จากข้อมูลเปิดของกระทรวงศึกษาธิการ
- ตั้งโครงคาบ วันเรียน ช่วงพัก และคาบล็อก (ลูกเสือ ชุมนุม แนะแนว ฯลฯ)
- รายวิชาพื้นฐานตามรูปแบบรหัสหลักสูตรแกนกลางฯ ป.1–ม.6 และข้อมูลตัวอย่างโรงเรียนประถมและมัธยม
- จัดตารางอัตโนมัติ (ทำงานในเบราว์เซอร์ด้วย Web Worker) และลากวางพร้อมตรวจคาบชนทันที
- ส่งออก Excel (มีเส้นตาราง สีวิชา โลโก้โรงเรียน) และ PDF (รายห้อง รายครู ตารางรวม)
- หลายภาคเรียนต่อโรงเรียน ทำสำเนาภาคเรียน สำรองและนำเข้าข้อมูล

## โครงสร้าง

```
htdocs/                  = โฟลเดอร์เว็บบนโฮสต์
├── index.php            หน้าแรกเว็บศรีโค้ดบูรณ์
└── timetable/           ระบบจัดตาราง (อ่าน timetable/SPEC.md)
    ├── api.php          JSON API
    ├── lib/             แกนระบบ PHP (ฐานข้อมูล สิทธิ์ OAuth)
    ├── assets/          หน้าแอป (JavaScript โมดูล ไม่ต้อง build) + solver/
    ├── data/            ข้อมูลภูมิศาสตร์ รายชื่อโรงเรียน รายวิชา (ดู data/SOURCES.md)
    ├── tools/           สคริปต์สร้างข้อมูล (Node.js)
    └── tests/           ทดสอบตัวจัดตาราง
```

- PHP 8.4 ล้วน ไม่ใช้ไลบรารีภายนอกฝั่งเซิร์ฟเวอร์ · ฐานข้อมูล SQLite (สลับเป็น MySQL ได้ใน config)
- ฝั่งหน้าเว็บเป็น JavaScript ล้วน โหลด ExcelJS และ pdfmake จาก cdnjs เฉพาะตอนส่งออก

## รันในเครื่อง

```bash
cp htdocs/timetable/config.sample.php htdocs/timetable/config.php   # ใส่ client id/secret ของ Google และ LINE ถ้าจะทดสอบการเข้าสู่ระบบ
php -S 127.0.0.1:8080 -t htdocs dev-router.php
# เปิด http://127.0.0.1:8080/timetable/ แล้วกด "ลองใช้ทันที" (ไม่ต้องตั้งค่า OAuth)

node htdocs/timetable/tests/solver.test.mjs          # ทดสอบตัวจัดตาราง
node htdocs/timetable/tools/build-curriculum.mjs     # สร้างรายวิชาและข้อมูลตัวอย่างประถมใหม่
```

## ข้อมูลจากแหล่งภายนอก

- จังหวัด อำเภอ ตำบล: [thailand-geography-json](https://github.com/thailand-geography-data/thailand-geography-json) · MIT License, Copyright (c) 2023-Present Joe Takara
- รายชื่อสถานศึกษา: กระทรวงศึกษาธิการ ชุดข้อมูล “สถานศึกษาตามสังกัดของประเทศไทย” (data.go.th) · Open Data Common
- ฟอนต์ IBM Plex Sans Thai, Chakra Petch, JetBrains Mono · SIL Open Font License 1.1

รายละเอียดวันที่ดึงและวิธีแปลงข้อมูลอยู่ที่ `htdocs/timetable/data/SOURCES.md`

## สิทธิ์การใช้งาน

© 2569 (2026) ศรีโค้ดบูรณ์ สงวนลิขสิทธิ์ เผยแพร่โค้ดให้ดูและศึกษาได้ แต่ **ไม่อนุญาต** ให้คัดลอกไปให้บริการ ดัดแปลงเผยแพร่ หรือใช้เชิงพาณิชย์โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษร ดู [LICENSE](LICENSE) · โรงเรียนที่ต้องการใช้งานใช้ได้ฟรีที่เว็บด้านบน

ติดต่อ: sricodeboon@gmail.com · [facebook.com/sricodeboon](https://facebook.com/sricodeboon)
