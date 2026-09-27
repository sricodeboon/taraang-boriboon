// สร้างรายวิชาพื้นฐานตามหลักสูตรแกนกลางฯ (data/curriculum.json) และข้อมูลตัวอย่างโรงเรียนประถม (assets/solver/sample-primary.json)
// รัน: node htdocs/timetable/tools/build-curriculum.mjs
// หมายเหตุ: รหัสวิชาตามรูปแบบมาตรฐาน [กลุ่มสาระ][ระดับ][ปี][ประเภท][ลำดับ] เช่น ท11101 = ภาษาไทย ป.1 พื้นฐาน
// จำนวนคาบ/สัปดาห์เป็นค่าที่โรงเรียนนิยมใช้ (1 คาบ = 40 ชม./ปี) — โรงเรียนควรตรวจกับโครงสร้างหลักสูตรสถานศึกษาของตนเอง
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// สีตามกลุ่มสาระ (ชุดเดียวกับข้อมูลตัวอย่างมัธยม)
const COLOR = {
  ท: '#F4A6A6', ค: '#7FB0E8', ว: '#B9A7E8', คำนวณ: '#8FA8C8', ส: '#E3B85A', ประวัติ: '#D9A273', หน้าที่: '#E8C5A0',
  พ: '#F7C59F', พละ: '#F2B880', ศ: '#F0A6BD', ง: '#C9B79C', อ: '#F2D16B',
};

// ---------- ประถม ป.1–ป.6 (รายปี) ----------
function primary(y) {
  const lower = y <= 3;
  const L = `ป.${y}`, c = (p, seq) => `${p}1${y}${seq}`;
  return [
    { code: c('ท', '101'), name: `ภาษาไทย ${L}`, perWeek: lower ? 5 : 4, color: COLOR.ท, type: 'พื้นฐาน' },
    { code: c('ค', '101'), name: `คณิตศาสตร์ ${L}`, perWeek: lower ? 5 : 4, color: COLOR.ค, type: 'พื้นฐาน' },
    { code: c('ว', '101'), name: `วิทยาศาสตร์และเทคโนโลยี ${L}`, perWeek: 2, color: COLOR.ว, type: 'พื้นฐาน' },
    { code: c('ว', '103'), name: `วิทยาการคำนวณ ${L}`, perWeek: 1, color: COLOR.คำนวณ, type: 'พื้นฐาน' },
    { code: c('ส', '101'), name: `สังคมศึกษา ศาสนาและวัฒนธรรม ${L}`, perWeek: 2, color: COLOR.ส, type: 'พื้นฐาน' },
    { code: c('ส', '102'), name: `ประวัติศาสตร์ ${L}`, perWeek: 1, color: COLOR.ประวัติ, type: 'พื้นฐาน' },
    { code: c('พ', '101'), name: `สุขศึกษาและพลศึกษา ${L}`, perWeek: 2, color: COLOR.พ, type: 'พื้นฐาน' },
    { code: c('ศ', '101'), name: `ศิลปะ ${L}`, perWeek: 2, color: COLOR.ศ, type: 'พื้นฐาน' },
    { code: c('ง', '101'), name: `การงานอาชีพ ${L}`, perWeek: 1, color: COLOR.ง, type: 'พื้นฐาน' },
    { code: c('อ', '101'), name: `ภาษาอังกฤษ ${L}`, perWeek: lower ? 1 : 2, color: COLOR.อ, type: 'พื้นฐาน' },
    { code: c('ส', '231'), name: `หน้าที่พลเมือง ${L}`, perWeek: 1, color: COLOR.หน้าที่, type: 'เพิ่มเติม' },
    { code: c('อ', '201'), name: `ภาษาอังกฤษเพื่อการสื่อสาร ${L}`, perWeek: 2, color: COLOR.อ, type: 'เพิ่มเติม' },
  ];
}

// ---------- มัธยม (รายภาคเรียน) ม.ต้น ระดับ 2 · ม.ปลาย ระดับ 3 ----------
function secondary(level, y, sem) {
  const n = (y - 1) * 2 + sem;            // ลำดับวิชาต่อเนื่อง เช่น ม.2 ภาค 1 = ภาษาไทย 3
  const c = (p, sem1, sem2) => `${p}${level}${y}${sem === 1 ? sem1 : sem2}`;
  const upper = level === 3;
  return [
    { code: c('ท', '101', '102'), name: `ภาษาไทย ${n}`, perWeek: upper ? 2 : 3, color: COLOR.ท, type: 'พื้นฐาน' },
    { code: c('ค', '101', '102'), name: `คณิตศาสตร์ ${n}`, perWeek: upper ? 2 : 3, color: COLOR.ค, type: 'พื้นฐาน' },
    { code: c('ว', '101', '102'), name: `วิทยาศาสตร์และเทคโนโลยี ${n}`, perWeek: upper ? 2 : 3, color: COLOR.ว, type: 'พื้นฐาน' },
    { code: c('ว', '103', '104'), name: `วิทยาการคำนวณ ${n}`, perWeek: 1, color: COLOR.คำนวณ, type: 'พื้นฐาน' },
    { code: c('ส', '101', '103'), name: `สังคมศึกษา ศาสนาและวัฒนธรรม ${n}`, perWeek: 2, color: COLOR.ส, type: 'พื้นฐาน' },
    { code: c('ส', '102', '104'), name: `ประวัติศาสตร์ ${n}`, perWeek: 1, color: COLOR.ประวัติ, type: 'พื้นฐาน' },
    { code: c('พ', '101', '103'), name: `สุขศึกษา ${n}`, perWeek: 1, color: COLOR.พ, type: 'พื้นฐาน' },
    { code: c('พ', '102', '104'), name: `พลศึกษา ${n}`, perWeek: 1, color: COLOR.พละ, type: 'พื้นฐาน' },
    { code: c('ศ', '101', '102'), name: `ศิลปะ ${n}`, perWeek: upper ? 1 : 2, color: COLOR.ศ, type: 'พื้นฐาน' },
    { code: c('ง', '101', '102'), name: `การงานอาชีพ ${n}`, perWeek: upper ? 1 : 2, color: COLOR.ง, type: 'พื้นฐาน' },
    { code: c('อ', '101', '102'), name: `ภาษาอังกฤษ ${n}`, perWeek: upper ? 2 : 3, color: COLOR.อ, type: 'พื้นฐาน' },
    { code: c('ส', '231', '232'), name: `หน้าที่พลเมือง ${n}`, perWeek: 1, color: COLOR.หน้าที่, type: 'เพิ่มเติม' },
  ];
}

const levels = [];
for (let y = 1; y <= 6; y++) levels.push({ id: `p${y}`, name: `ป.${y}`, band: 'primary', sem: 0, subjects: primary(y) });
for (const [band, level, first] of [['lower', 2, 1], ['upper', 3, 4]]) {
  for (let y = 1; y <= 3; y++) for (const sem of [1, 2]) {
    levels.push({ id: `m${first + y - 1}s${sem}`, name: `ม.${first + y - 1}`, band, sem, subjects: secondary(level, y, sem) });
  }
}
const curriculum = {
  v: 1,
  note: 'รายวิชาพื้นฐาน (และหน้าที่พลเมือง อังกฤษเพื่อการสื่อสารสำหรับประถม) ตามรูปแบบรหัสของหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน พ.ศ. 2551 (ฉบับปรับปรุง พ.ศ. 2560) จำนวนคาบ/สัปดาห์เป็นค่าแนะนำ ตรวจสอบกับโครงสร้างหลักสูตรสถานศึกษาของโรงเรียนก่อนใช้จริง',
  bands: { primary: 'ประถมศึกษา (ป.1–ป.6)', lower: 'มัธยมศึกษาตอนต้น (ม.1–ม.3)', upper: 'มัธยมศึกษาตอนปลาย (ม.4–ม.6)' },
  levels,
};
writeFileSync(join(ROOT, 'data/curriculum.json'), JSON.stringify(curriculum));

// ---------- ข้อมูลตัวอย่างโรงเรียนประถมขนาดเล็ก ป.1–ป.6 ชั้นละ 1 ห้อง ----------
const periods = [
  ['1', '08:30', '09:30'], ['2', '09:30', '10:30'], ['3', '10:30', '11:30'], ['พักกลางวัน', '11:30', '12:30', 'break'],
  ['4', '12:30', '13:30'], ['5', '13:30', '14:30'], ['6', '14:30', '15:30'],
].map(([label, start, end, type = 'class']) => ({ label, start, end, type }));
const LAST = periods.length - 1;
const classes = [1, 2, 3, 4, 5, 6].map((y) => ({ id: `c${y}`, name: `ป.${y}`, level: `ป.${y}` }));
const homeroom = ['นางสาวพิมพ์ชนก ใจงาม', 'นางอรุณี แสงทอง', 'นางสาววาสนา บุญมา', 'นายสมชาย รักเรียน', 'นางจันทร์เพ็ญ ศรีสุข', 'นายวีระพงษ์ ทองดี'];
const teachers = [
  ...homeroom.map((name, i) => ({ id: `t${i + 1}`, name, short: name.split(' ')[0].replace(/^(นางสาว|นาง|นาย)/, ''), maxPerDay: 5, unavailable: [] })),
  { id: 't7', name: 'นางสาวกัญญารัตน์ วงศ์วิทย์', short: 'กัญญารัตน์', maxPerDay: 5, unavailable: [] }, // วิทย์ + วิทยาการคำนวณ
  { id: 't8', name: 'นางสาวเจนจิรา อินทร์แก้ว', short: 'เจนจิรา', maxPerDay: 5, unavailable: [] },       // ภาษาอังกฤษ
  { id: 't9', name: 'นายธนวัฒน์ แข็งแรง', short: 'ธนวัฒน์', maxPerDay: 5, unavailable: [] },               // สุขศึกษาและพลศึกษา
];
const rooms = [{ id: 'r1', name: 'ห้องคอมพิวเตอร์', kind: 'ห้องคอมพิวเตอร์' }];
const subjects = [], assignments = [];
let sid = 0, aid = 0;
for (let y = 1; y <= 6; y++) {
  for (const s of primary(y)) {
    const id = `s${++sid}`;
    subjects.push({ id, code: s.code, name: s.name, color: s.color });
    const g = s.code[0], sub = s.code.slice(3);
    const teacherId = g === 'ว' ? 't7' : g === 'อ' ? 't8' : g === 'พ' ? 't9' : `t${y}`;
    assignments.push({ id: `a${++aid}`, subjectId: id, classId: `c${y}`, teacherId, roomId: sub === '103' && g === 'ว' ? 'r1' : null, perWeek: s.perWeek, doubles: 0 });
  }
}
const locks = [
  { classId: null, day: 2, period: LAST, label: 'ลูกเสือ-เนตรนารี' },
  { classId: null, day: 3, period: LAST, label: 'แนะแนว' },
  { classId: null, day: 4, period: LAST, label: 'ชุมนุม' },
];
const sample = {
  meta: { format: 'sricodeboon-timetable', version: 1, school: 'โรงเรียนบ้านศรีโค้ด (ข้อมูลตัวอย่าง)', description: 'ข้อมูลสมมติของโรงเรียนประถมขนาดเล็ก ป.1–ป.6 ชั้นละ 1 ห้อง ครูประจำชั้นสอนวิชาหลัก มีครูวิทย์ ครูอังกฤษ และครูพละแยก ชื่อบุคคลทั้งหมดเป็นชื่อสมมติ', dayNames: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'] },
  term: { name: 'ภาคเรียนที่ 1 ปีการศึกษา 2569', days: 5, periods },
  classes, teachers, rooms, subjects, assignments, locks,
};
writeFileSync(join(ROOT, 'assets/solver/sample-primary.json'), JSON.stringify(sample, null, 1));
console.log(`curriculum: ${levels.length} ระดับ ${levels.reduce((n, l) => n + l.subjects.length, 0)} วิชา · ตัวอย่างประถม: ${subjects.length} วิชา ${assignments.length} งานสอน`);
