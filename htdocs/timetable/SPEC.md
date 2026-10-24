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
  "assignments":[{id,subjectId,classId,teacherId,roomId,perWeek,doubles}],   // perWeek 0–60 (store.sanitize ตัดที่ 60) · doubles ≤ floor(perWeek/2)
  "locks":[{classId|null,day,period,label}],
  "placements":[{assignmentId,day,period,pinned}] }
```
บันทึกทั้งก้อนพร้อม `version` (optimistic lock: ถ้า version ไม่ตรง = มีคนแก้ก่อน → แจ้งผู้ใช้)
- **store.sanitize** (แก้ในอาร์เรย์เดิมเสมอ): `assignment.perWeek` = 0–60 · `doubles` ≤ floor(perWeek/2) · `placements[].pinned` เป็นจริง/เท็จเมื่อมีค่า ('yes'/1 → true · 0/'0'/'false'/'no' → false) · placement/lock ที่วัน/คาบไม่ใช่จำนวนเต็ม ≥ 0 (NaN, 'abc', 1.5, −1) **ถูกตัดทิ้ง** (เดิมแปลงเป็น 0 = ย้ายไปจันทร์คาบแรก) · ค่าที่เกินช่วงวัน/คาบของตาราง **คงไว้** · เอกสารปกติ JSON เท่าเดิมหลัง sanitize
- **merge3 (409/กู้ฉบับร่าง)**: รายการที่มี id เทียบรายรายการ · `placements` เทียบรายช่อง คีย์ `assignmentId|day|period` จัดกลุ่มตามการสอน · `locks` คีย์ `classId|day|period` (`classId` null → `*`) · แก้ฝั่งเดียว = เอาฝั่งนั้น · สองฝั่งวางคาบของการสอนต่างกันที่ไม่ชน = รวมทั้งคู่ ไม่ถาม · แก้คาบของการสอนเดียวกันทั้งสองฝั่งต่างกัน = ชน `'placements'` (prefer ตัดสินเฉพาะการสอนนั้น) · คาบที่เพิ่มคนละฝั่งชนห้อง/ครู/ห้องพิเศษช่องเดียวกัน = ชน (prefer ตัดสินเฉพาะคาบที่ชน) · `prefer === null` เก็บทั้งหมดไว้ให้ `mergeAsk` ถาม · ไม่มีฉบับฐาน/มีคีย์ซ้ำ = เทียบทั้งหมวดแบบเดิม · ท้ายสุดเรียก `trimPlacements`
- **`trimPlacements(doc)`** (store.js, แก้ในอาร์เรย์เดิม คืนจำนวนที่ตัด): ตัดคาบกำพร้า (การสอนไม่มีแล้ว) + คาบเกิน `perWeek` ต่อการสอน — เก็บคาบปักหมุดก่อน แล้วตามลำดับในอาร์เรย์
- **`rules.splitAssignment`**: perWeek < 2 → คืน `null` ไม่แก้เอกสาร (ผู้เรียกต้องเช็ก) · ตัดคาบเกินของแถวเดิมโดยเก็บคาบปักหมุดก่อน
id ในเอกสารเป็นสตริงสั้นที่ client สร้าง (เช่น "c1", "t12")

## สัญญา Solver (JS, ES module + ใช้ใน Web Worker ได้)
```js
import { solve } from './solver.js';
const result = solve(input, { timeLimitMs: 4000, seed: 1, onProgress, onPhase, progressPlacements: true, weights });
// input
{
  days: 5,
  periods: [{ type: 'class' | 'break' }, ...],
  classes:  [{ id }],
  teachers: [{ id, maxPerDay: 6, unavailable: [[day, period], ...] }],
  rooms:    [{ id }],
  assignments: [{ id, subjectId, classId, teacherId, roomId: null, perWeek: 3, doubles: 1, group: 'TH' }],  // subjectId: แถวแบ่งสอนวิชาเดียวกันนับ soft ร่วมกัน · group (optional) ดู Soft ใหม่
  locks:    [{ classId: null, day, period, label }],                                       // label: ใช้ในข้อความชน "วางทับคาบล็อก (ลูกเสือ)"
  fixed:    [{ assignmentId, day, period }]      // placements ที่ pinned — ห้ามย้าย
}
// result
{
  placements: [{ assignmentId, day, period }],   // รวม fixed
  unplaced:   [{ assignmentId, remaining, reason, code, params }],   // reason = ข้อความไทยเดิม · code/params = ดูตารางรหัสด้านล่าง
  stats: { hardViolations: 0, softScore, ms, iterations, timedOut, units, unplacedPeriods,
           soft: { sameDay, adjacentDays, adjacentDaysRaw, teacherGaps, morningCore, classGaps } }
}
```
- **เพดาน**: `perWeek > 60` ต่อแถว → ไม่สร้างหน่วย คืน `BAD_DATA what:'perWeek'` (คาบที่ปักหมุดของแถวนั้นยังอยู่และกันช่อง) · หน่วยรวมเกิน 20,000 → แถวตั้งแต่ตัวที่ทำให้เกินได้ `BAD_DATA what:'units'` · ภาระเกินมากยังคืนภายใน ≈ timeLimit (ถอดชนแบบ heap ดูเวลา deadline+500 ms · ใส่กลับดูเวลา deadline+1500 ms) · ข้อมูลปกติได้ผลเท่าเดิมทุกคาบ
- **adjacentDays** = จำนวนคู่ "วิชาเดียวกันลงวันติดกัน" ที่ **เกินขั้นต่ำที่เลี่ยงไม่ได้** (ต่อกลุ่มวิชา×ห้อง: k ครั้ง (คาบคู่นับ 1) ใน D วัน ต้องติดกันอย่างน้อย max(0, min(D−1, 2k−D−1))) → 0 = ดีที่สุดแล้ว · `adjacentDaysRaw` = จำนวนจริงทั้งหมด (ค่าเดิม) · `softScore` ยังคิดจากค่า raw ตามน้ำหนักเดิม (search ไม่เปลี่ยน)

**ความคืบหน้า (onProgress / worker `progress`)** — ฟิลด์เดิมคงทุกตัว ฟิลด์ใหม่ optional (ผู้รับต้องทำงานได้เมื่อไม่มี)
```js
{ type:'progress', pct, phase, iterations, ms, best:{hardViolations, softScore},
  pctMono,          // pct ที่ไม่ถอยหลัง (ใช้แทน pct ในแถบความคืบหน้า) — สุดท้าย = 1
  placed, total,    // คาบที่วางได้โดยไม่ชนตอนนี้ / คาบทั้งหมดที่ต้องวาง (ไม่รวมแถว BAD_DATA) — สุดท้าย placed = result.placements.length
  placements?,      // [{assignmentId, day, period}] snapshot คาบที่วางได้ไม่ชน (รวมหมุด) — ส่งเมื่อ phase เปลี่ยน หรือห่าง ≥ 400 ms · ≤ 2,000 รายการ
  delta? }          // เกิน 2,000: {add:[[assignmentId,day,period]], remove:[...]} เทียบ snapshot ก่อนหน้า (ครั้งแรก = add ทั้งหมด)
{ type:'phase', phase:'greedy'|'hard'|'repair'|'soft', ms }   // ข้อความใหม่ของ worker: ยิงทันทีเมื่อเปลี่ยน (ไม่ throttle) · solve() เรียก options.onPhase
```
- snapshot อ่านสถานะอย่างเดียว ไม่แตะ RNG → มี/ไม่มี onProgress ผลเท่ากันทุกคาบ · ปิดด้วย `options.progressPlacements:false` (worker ส่งต่อจาก `{type:'solve', options}`) · 42 ห้อง snapshot ≤ 60 KB
- phase อาจวน `greedy → hard` ซ้ำเมื่อ restart · `repair` = กำลังถอดคาบที่ชนออก (จะมีคาบค้าง) · progress สุดท้าย (pct 1) ไม่แนบ snapshot — ใช้ `done.result.placements`
```js
import { capacityCheck } from './solver.js';
capacityCheck(input)   // → { issues: [{ code, params, text }] } ตรวจความจุเร็วโดยไม่จัดจริง (ตัวเลข/ข้อความชุดเดียวกับ solve)
```
**รหัสเหตุผล (unplaced[].code / capacityCheck issues[].code)** — `reason`/`text` เป็นข้อความไทยเดิมทุกตัวอักษร (มีเทสต์และ regex จับ) รหัสเป็นฟิลด์ข้างกัน · id ใน params เป็นค่าเดิมจาก input
| code | params | ความหมาย | ปุ่มใน board.js (FIXES) |
|---|---|---|---|
| `CLASS_OVER` | classId, need, free | ห้องต้องเรียนเกินช่องที่มี | เพิ่ม 1 คาบ/วัน (เลิกทำได้) · ไปดูคาบล็อก |
| `TEACHER_MAX_DAY` | teacherId, maxPerDay, minNeeded (+need, free) | เพิ่มเพดาน “สูงสุด/วัน” เป็น minNeeded แล้วความจุพอ (ค่าต่ำสุดที่พอ ทั้งคาบรวมและช่องคาบคู่) · หรือเพดาน < 2 จึงลงคาบคู่ไม่ได้ | “เพิ่มเป็น N” |
| `TEACHER_OVER` | teacherId, need, free, maxPerDay (0 = ไม่จำกัด), unavail | ครูสอนเกินความจุ และเพิ่มเพดานอย่างเดียวไม่พอ | ไปดูช่องไม่ว่าง · แบ่งวิชาที่คาบมากสุดให้ครูอื่น |
| `ROOM_OVER` | roomId, need, free | ห้องพิเศษถูกใช้เกินช่องที่มี | ไปแท็บห้องพิเศษ |
| `DOUBLE_NO_SLOT` | classId และ/หรือ teacherId, doubles, slots (+assignmentId, pinnedHalf, minNeeded ถ้ามี) | ช่องคาบคู่ไม่พอ · pinnedHalf = ปักหมุดคาบคู่ไว้ครึ่งเดียวแล้วข้างหมุดลงไม่ได้ | ลดคาบคู่ของแถวนั้น · เพิ่มเพดานถ้ามี minNeeded |
| `BLOCKED_TEACHER` | teacherId, blocked | ช่องที่เหลือเป็นช่องที่ครูไม่ว่างทั้งหมด | ไปแท็บครู |
| `BLOCKED_CLASS` | classId | ห้องถูกล็อกจนไม่มีคาบเรียน | ไปแท็บคาบล็อก |
| `BLOCKED_ROOM` | roomId | (สงวนไว้ ยังไม่มีที่ส่ง) | ไปแท็บห้องพิเศษ |
| `NO_TEACHER` | assignmentId (capacityCheck) | การสอนยังไม่มีครู (board กรองออกก่อนจัด นับใน readiness) | ไปเติมครู → tt:goto {tab:'data', section:'assignments', filter:'noTeacher'} |
| `BAD_DATA` | what ('class'\|'teacher'\|'perWeek'\|'units'), assignmentId, classId/teacherId | อ้างห้อง/ครูที่ไม่พบ · perWeek เกิน 60 (ข้อความ “คาบ/สัปดาห์เกิน 60 (ข้อมูลผิดปกติ)”) · หน่วยรวมทั้งโรงเรียนเกิน 20,000 | ไปแท็บการสอน |
| `PINNED_CLASH` | — (ไม่อยู่ใน unplaced) | จัดครบแต่ `stats.hardViolations > 0` จากคาบที่ปักหมุดชนกันเอง — board.js (แพ็กเกจ ข) ใส่ใน `meta.lastSolve.codes` | ดูจุดชน · เลิกปักหมุดที่ชน |
| `CROWDED_TEACHER` / `CROWDED_ROOM` / `CROWDED_CLASS` / `CROWDED_MAX_DAY` | teacherId/roomId/classId (+maxPerDay) | ความจุพอแต่ค้นไม่เจอช่อง (ไม่ใช่พิสูจน์ว่าเป็นไปไม่ได้) | จัดใหม่/เลิกปักหมุด · CROWDED_MAX_DAY ลองเพิ่มเพดาน +1 |

ปุ่ม “แก้ให้เลย” ทุกปุ่ม: แก้เอกสาร → `store.commit('fix')` ครั้งเดียว → toast “เลิกทำ” 10 วินาที · ผลเก่าที่ไม่มี code ใช้ regex ตามข้อความเดิม (fixFor)

**บันทึกรุ่น (ต.ค. 69):** solverInput ส่ง subjectId แล้ว ⇒ ผลจัดของโรงเรียนที่มีแบ่งสอน (วิชาเดียว 2 ครู) จะเปลี่ยน (ดีขึ้น: ไม่ลงวิชาเดียวกันซ้ำวัน) · ข้อความชนคาบล็อกบอกชื่อกิจกรรม

**Hard:** ห้องเรียน/ครู/ห้องพิเศษ ไม่ซ้อนคาบ · ห้ามลงช่องพัก/คาบล็อก/คาบที่ครูไม่ว่าง · ครูไม่เกิน maxPerDay · คู่คาบต้องติดกันในวันเดียวกันไม่คร่อมช่องพัก
**Soft:** วิชาเดียวกันในห้องเดียววันละไม่เกิน 1 ครั้ง (คู่คาบนับเป็น 1) · กระจายวิชาให้ทั่วสัปดาห์ · ลดคาบว่างแทรกของครู
**Soft ใหม่ (ต.ค. 69)** — ใช้เมื่อมี `assignments[].group` อย่างน้อย 1 แถว หรือส่ง `options.weights` ระบุเอง · น้ำหนักใน `SOFT_WEIGHTS` ทับได้ด้วย `options.weights` (และ `score(input, placements, weights)`)

| คีย์ | น้ำหนัก | ความหมาย |
|---|---|---|
| `sameDay` | 10 | วิชาเดียวกันวันเดียวกันเกิน 1 ครั้ง |
| `adjacentDays` | 2 | วิชาเดียวกันวันติดกัน (search ใช้ค่า raw) |
| `teacherGap` | 1 | คาบว่างแทรกของครู |
| `morningCore` | 3 | วิชาหลัก (`group` ∈ TH MA SC FL) ลงคาบหลังพักแรก (ไม่มีพัก = ครึ่งหลังของวัน) ต่อคาบ · คาบเรียนสุดท้ายของวันนับ 2 |
| `classGap` | 4 | ห้องเรียนมีคาบว่างกลางวัน (ระหว่างคาบเรียนแรก–สุดท้าย ไม่นับพัก · คาบล็อกนับว่าไม่ว่าง) ต่อคาบ |

- ไม่ส่ง `group` เลย = `morningCore`/`classGap` เป็น 0 → ผลเท่ารุ่นก่อน 100% (ล็อกด้วย hash ใน solver.test ก-0) · `stats.soft.morningCore`/`classGaps` นับเสมอเพื่อแสดงผล แต่รวมใน softScore เฉพาะเมื่อเปิดใช้
- ผลวัด (ประถม 6 ห้อง seed 1/7): ไทย+คณิตตกบ่าย 42–52% → 3–10% · คาบว่างกลางวันของห้อง → 0 · hard 0 · เวลา 27–36 → 46–84 ms (search ขัดเกลานานขึ้นเพราะยังเจอทางดีขึ้น)
- ข้อควรรู้: มัธยม 42 ห้องที่ห้องไม่เต็ม (เรียน 22/40 คาบ) เมื่อส่ง group: classGaps 246→10 แต่ teacherGaps 29→88 และ adjacentDays 15→105 (classGap บีบคาบของห้องให้ติดกัน) — ถ้าจะส่ง group ให้มัธยม ควรลด `classGap` ผ่าน `options.weights`

## ข้อมูลภูมิศาสตร์/โรงเรียน (ทีม Data)
- `data/geo.json`: `{"v":1,"source":"...","provinces":[{"n":"นครพนม","a":[{"n":"นาทม","t":["นาทม","หนองซน","ดอนเตย"]}]}]}`
- `data/schools/<ชื่อจังหวัด>.json`: `[{"n":"ชื่อโรงเรียน","c":"รหัส(ถ้ามี)","t":"ตำบล","a":"อำเภอ","p":"จังหวัด"}]`
- `data/SOURCES.md`: แหล่งข้อมูล วันที่ดึง และสัญญาอนุญาต · ต้องเป็นข้อมูลเปิด ห้าม scrape ขัดเงื่อนไข
- ผู้ใช้พิมพ์ชื่อโรงเรียนเองได้เสมอ ถ้าไม่มีในรายการ (เช่น รร.ตชด. เอกชน อปท.)

## มาตรฐาน
- ภาษาไทยทุกข้อความบน UI · สีแบรนด์: #0B141C #0F2438 #E3B85A #7FB0E8 #F0A6BD #F2F4F1 (ห้ามสีเขียวเป็นสีแบรนด์ — ใช้เฉพาะสื่อสถานะถ้าจำเป็น)
- ความปลอดภัย: prepared statements, CSRF token ทุก POST, session cookie HttpOnly+Secure+SameSite=Lax, ตรวจ school_id ทุก query (ห้ามข้ามโรงเรียน)
- ไม่ commit/อัปโหลด config.php และไฟล์ใน storage/
