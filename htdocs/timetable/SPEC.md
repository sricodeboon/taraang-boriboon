# ตารางบริบูรณ์ — ระบบจัดตารางเรียนตารางสอน (SPEC กลางของทีม)

ผู้สั่งงาน/ผู้ตัดสินใจ: **ครูแจ็ก** · แบรนด์: ศรีโค้ดบูรณ์ · URL: `https://sricodeboon.infinityfreeapp.com/timetable/`

## ความต้องการ (จากครูแจ็ก)
- หลายโรงเรียนใช้ร่วมกัน: แต่ละโรงเรียนสมัครเอง แก้ข้อมูลของโรงเรียนตัวเองเท่านั้น
- สมัคร/ล็อกอินด้วย **Google** และ **LINE**
- ตอนสมัคร: autocomplete **โรงเรียน · ตำบล · อำเภอ · จังหวัด**
- ตั้งค่าโครงคาบเองได้ (จำนวนวัน คาบ เวลา พัก) + มี **ข้อมูลตัวอย่าง** ให้ลอง
- **คาบล็อก** (เช่น กิจกรรมหน้าเสาธง ลูกเสือ ชุมนุม แนะแนว) ห้ามจัดวิชาทับ
- เฟสแรกได้ทั้ง **ลากวาง + ตรวจชนทันที** และ **จัดอัตโนมัติ**
- จัดเสร็จ **export Excel และ PDF**
- มี **คู่มือการใช้งาน** อธิบายเป็นภาษาไทย

## ข้อจำกัดโฮสต์ (InfinityFree)
- PHP 8.4, ไม่มี SSH/composer/cron, CPU ต่อ request จำกัด → งานคำนวณหนัก (solver) **รันในเบราว์เซอร์ (Web Worker)**
- MySQL ต่อฐาน ≤ 50MB, ~50k hits/วัน/บัญชี · มีระบบกันบอต JS ⇒ เรียก API ได้เฉพาะจากหน้าเว็บของเราเอง
- ไม่ใช้ไลบรารี PHP ภายนอก เขียน PHP ล้วน · JS ใช้ vanilla + ไลบรารี CDN ได้ (cdnjs/jsdelivr) สำหรับ export

## โครงไฟล์
```
timetable/
  index.php        หน้าแนะนำ + ปุ่มเข้าสู่ระบบ Google/LINE
  signup.php       สมัครโรงเรียน (autocomplete)
  app.php          แอปจัดตาราง (ต้องล็อกอิน)
  guide.php        คู่มือการใช้งาน
  api.php          JSON API (?r=...)
  auth/            google.php line.php callback.php logout.php dev.php(เฉพาะ DEV_LOGIN=true)
  lib/             bootstrap.php db.php auth.php tenant.php http.php  (ห้ามเข้าผ่านเว็บ)
  data/            geo.json + schools/<จังหวัด>.json  (ทีม Data)
  storage/         SQLite db (ห้ามเข้าผ่านเว็บ)
  assets/          app.css app.js board.js export.js
  assets/solver/   solver.js solver.worker.js sample-school.json  (ทีม Solver)
  tests/           solver.test.mjs  (รันด้วย node, ไม่อัปโหลด)
  config.sample.php
```

## โมเดลข้อมูล (ตัดสินใจโดยหัวหน้าทีม: เก็บเป็นเอกสารต่อภาคเรียน)
```
schools(id, name, school_code, tambon, amphoe, province, created_at)
users(id, school_id NULL, provider, provider_uid, name, email, avatar, role, created_at)   -- UNIQUE(provider, provider_uid); role: owner|editor
terms(id, school_id, name, data_json, version, updated_at, updated_by)
```
`terms.data_json` = เอกสารภาคเรียน (รูปแบบเดียวกับ `assets/solver/sample-school.json` + `placements`):
```
{ "term":{"name","days","periods":[{label,start,end,type:'class'|'break'}]},
  "classes":[{id,name,level}], "teachers":[{id,name,short,maxPerDay,unavailable:[[d,p]]}],
  "rooms":[{id,name,kind}], "subjects":[{id,code,name,color}],
  "assignments":[{id,subjectId,classId,teacherId,roomId,perWeek,doubles}],
  "locks":[{classId|null,day,period,label}],
  "placements":[{assignmentId,day,period,pinned}] }
```
บันทึกทั้งก้อนพร้อม `version` (optimistic lock: ถ้า version ไม่ตรง = มีคนแก้ก่อน → แจ้งผู้ใช้)
id ในเอกสารเป็นสตริงสั้นที่ client สร้าง (เช่น "c1", "t12")

## สัญญา Solver (JS, ES module + ใช้ใน Web Worker ได้)
```js
import { solve } from './solver.js';
const result = solve(input, { timeLimitMs: 4000, seed: 1 });
// input
{
  days: 5,
  periods: [{ type: 'class' | 'break' }, ...],
  classes:  [{ id }],
  teachers: [{ id, maxPerDay: 6, unavailable: [[day, period], ...] }],
  rooms:    [{ id }],
  assignments: [{ id, classId, teacherId, roomId: null, perWeek: 3, doubles: 1 }],
  locks:    [{ classId: null, day, period }],
  fixed:    [{ assignmentId, day, period }]      // placements ที่ pinned — ห้ามย้าย
}
// result
{
  placements: [{ assignmentId, day, period }],   // รวม fixed
  unplaced:   [{ assignmentId, remaining, reason }],
  stats: { hardViolations: 0, softScore, ms, iterations }
}
```
**Hard:** ห้องเรียน/ครู/ห้องพิเศษ ไม่ซ้อนคาบ · ห้ามลงช่องพัก/คาบล็อก/คาบที่ครูไม่ว่าง · ครูไม่เกิน maxPerDay · คู่คาบต้องติดกันในวันเดียวกันไม่คร่อมช่องพัก
**Soft:** วิชาเดียวกันในห้องเดียววันละไม่เกิน 1 ครั้ง (คู่คาบนับเป็น 1) · กระจายวิชาให้ทั่วสัปดาห์ · ลดคาบว่างแทรกของครู

## ข้อมูลภูมิศาสตร์/โรงเรียน (ทีม Data)
- `data/geo.json`: `{"v":1,"source":"...","provinces":[{"n":"นครพนม","a":[{"n":"นาทม","t":["นาทม","หนองซน","ดอนเตย"]}]}]}`
- `data/schools/<ชื่อจังหวัด>.json`: `[{"n":"ชื่อโรงเรียน","c":"รหัส(ถ้ามี)","t":"ตำบล","a":"อำเภอ","p":"จังหวัด"}]`
- `data/SOURCES.md`: แหล่งข้อมูล วันที่ดึง และสัญญาอนุญาต · ต้องเป็นข้อมูลเปิด ห้าม scrape ขัดเงื่อนไข
- ผู้ใช้พิมพ์ชื่อโรงเรียนเองได้เสมอ ถ้าไม่มีในรายการ (เช่น รร.ตชด. เอกชน อปท.)

## มาตรฐาน
- ภาษาไทยทุกข้อความบน UI · สีแบรนด์: #0B141C #0F2438 #E3B85A #7FB0E8 #F0A6BD #F2F4F1 (ห้ามสีเขียวเป็นสีแบรนด์ — ใช้เฉพาะสื่อสถานะถ้าจำเป็น)
- ความปลอดภัย: prepared statements, CSRF token ทุก POST, session cookie HttpOnly+Secure+SameSite=Lax, ตรวจ school_id ทุก query (ห้ามข้ามโรงเรียน)
- ไม่ commit/อัปโหลด config.php และไฟล์ใน storage/
