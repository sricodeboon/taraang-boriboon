// ทดสอบกฎข้อมูลการสอน (assets/rules.js) — รัน: node htdocs/timetable/tests/rules.test.mjs
// กันเลือกวิชาซ้ำ · แบ่งสอน · รวมแถวซ้ำ · คาบ/สัปดาห์ตามหลักสูตร · แนวตาราง · ลบทั้งหมด + เลิกทำ · ข้อมูลภาคเรียนแบบเก่า
// โครงคาบ (buildPeriods) · รายวิชาตามชั้น (subjectsForLevels) · กลุ่มสาระ · เติมครูอัตโนมัติ · เดาครูแถวใหม่
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  orientation, gridModel, periodMinutes, periodText, hoursHint, fillSubjectPerWeek, subjectChoices, usedSubjects,
  duplicateGroups, splitAssignment, mergeRows, markSplit, perWeekStatus, removeAssignments, removeSubjects, undoRemove,
  buildPeriods, retimePeriods, subjectsForLevels, levelKey, termSem, SUBJECT_GROUP_CODES, groupFromText, subjectGroupOf,
  teacherLoad, defaultAssignOpts, autoAssign, applyAssign, undoAssign, guessTeacher, guessNew,
} from '../assets/rules.js';
import { store, index } from '../assets/store.js';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✔ ' + name); } catch (e) { failed++; console.log('✘ ' + name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// ภาคเรียนแบบเก่า: ไม่มี settings, วิชาไม่มี perWeek, การสอนซ้ำ (ป.1 ภาษาไทย 2 แถว)
const legacy = {
  term: { name: 'ภาคเรียนที่ 1/2569', days: 5, periods: [
    { label: '1', start: '08:30', end: '09:30', type: 'class' }, { label: '2', start: '09:30', end: '10:30', type: 'class' },
    { label: 'พักกลางวัน', start: '11:30', end: '12:30', type: 'break' }, { label: '3', start: '12:30', end: '13:30', type: 'class' },
  ] },
  classes: [{ id: 'c1', name: 'ป.1/1', level: 'ป.1' }, { id: 'c2', name: 'ป.1/2', level: 'ป.1' }],
  teachers: [{ id: 't1', name: 'ครู ก' }, { id: 't2', name: 'ครู ข' }, { id: 't3', name: 'ครู ค' }],
  rooms: [],
  subjects: [{ id: 's1', code: 'ท11101', name: 'ภาษาไทย ป.1', color: '#F4A6A6' }, { id: 's2', code: 'ค11101', name: 'คณิตศาสตร์ ป.1', color: '#7FB0E8' },
    { id: 's3', code: 'X999', name: 'ชุมนุมพิเศษ', color: '#B69CE0' }],
  assignments: [
    { id: 'a1', subjectId: 's1', classId: 'c1', teacherId: 't1', roomId: null, perWeek: 3, doubles: 0 },
    { id: 'a2', subjectId: 's1', classId: 'c1', teacherId: 't2', roomId: null, perWeek: 2, doubles: 0 },
    { id: 'a3', subjectId: 's2', classId: 'c1', teacherId: 't1', roomId: null, perWeek: 5, doubles: 1 },
    { id: 'a4', subjectId: 's1', classId: 'c2', teacherId: 't3', roomId: null, perWeek: 5, doubles: 0 },
  ],
  locks: [], placements: [
    { assignmentId: 'a1', day: 0, period: 0, pinned: true }, { assignmentId: 'a2', day: 1, period: 0 }, { assignmentId: 'a3', day: 2, period: 1 },
    { assignmentId: 'a4', day: 0, period: 0 },
  ],
};
const cur = JSON.parse(readFileSync(join(here, '../data/curriculum.json'), 'utf8'));
const curMap = {};
for (const lv of cur.levels) for (const s of lv.subjects) curMap[s.code] = s.perWeek;

test('หลักสูตร: ภาษาไทย ป.1–3 = 5 คาบ (200 ชม./ปี) · ป.4–6 = 4 คาบ (160 ชม./ปี)', () => {
  for (const y of [1, 2, 3]) assert.equal(curMap[`ท1${y}101`], 5);
  for (const y of [4, 5, 6]) assert.equal(curMap[`ท1${y}101`], 4);
  assert.equal(hoursHint('ท11101', 5), '= 200 ชม./ปี');
  assert.equal(hoursHint('ท14101', 4), '= 160 ชม./ปี');
  assert.match(hoursHint('ท21101', 3), /60 ชม\./);
});

test('ข้อมูลเก่าเปิดได้: store.sanitize เติม settings.orientation = วันเรียงลงล่าง และ subject.perWeek จากรหัส', () => {
  store.curriculum = curMap;
  store.doc = clone(legacy);
  index();
  assert.equal(store.doc.settings.orientation, 'days');
  assert.equal(orientation(store.doc), 'days');
  assert.equal(store.doc.subjects[0].perWeek, 5);
  assert.equal(store.doc.subjects[1].perWeek, 5);
  assert.equal(store.doc.subjects[2].perWeek, undefined, 'รหัสนอกหลักสูตรไม่ถูกเดา');
  store.doc.subjects[0].perWeek = null; index();
  assert.equal(store.doc.subjects[0].perWeek, null, 'ผู้ใช้ล้างค่าเอง (null) ไม่ถูกเติมซ้ำ');
  store.curriculum = null;
});

test('ความยาวคาบจากโครงคาบ: 1 คาบ = 60 นาที', () => {
  assert.deepEqual(periodMinutes(legacy), { min: 60, max: 60 });
  assert.match(periodText(legacy), /1 คาบ = 60 นาที/);
  const d = clone(legacy); d.term.periods.forEach((p) => { delete p.start; delete p.end; });
  assert.equal(periodMinutes(d), null);
});

test('กันซ้ำ: dropdown วิชาไม่แสดงวิชาที่ห้องนี้มีแล้ว ยกเว้นวิชาของแถวตัวเอง', () => {
  const d = clone(legacy);
  const a3 = d.assignments.find((a) => a.id === 'a3');
  assert.deepEqual(subjectChoices(d, a3).map((s) => s.id), ['s2', 's3']); // s1 มีแล้วใน c1
  const a4 = d.assignments.find((a) => a.id === 'a4');
  assert.deepEqual(subjectChoices(d, a4, usedSubjects(d)).map((s) => s.id), ['s1', 's2', 's3']); // c2 มีแค่ s1 (ของตัวเอง)
});

test('แถวซ้ำของข้อมูลเก่าถูกตรวจพบ → รวมเป็นแถวเดียว (คาบรวม, คาบที่วางย้ายมา)', () => {
  const d = clone(legacy);
  const g = duplicateGroups(d);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map((a) => a.id), ['a1', 'a2']);
  mergeRows(d, g[0]);
  assert.equal(d.assignments.length, 3);
  const a1 = d.assignments.find((a) => a.id === 'a1');
  assert.equal(a1.perWeek, 5);
  assert.equal(d.placements.filter((p) => p.assignmentId === 'a1').length, 2);
  assert.equal(duplicateGroups(d).length, 0);
});

test('แถวซ้ำตั้งเป็นแบ่งสอนได้ → ไม่นับว่าซ้ำ และรวมคาบเทียบหลักสูตร', () => {
  const d = clone(legacy); fillSubjectPerWeek(d, curMap);
  markSplit(duplicateGroups(d)[0]);
  assert.equal(duplicateGroups(d).length, 0);
  const st = perWeekStatus(d, d.assignments[0]);
  assert.deepEqual({ ...st }, { target: 5, total: 5, split: true, ok: true });
});

test('แบ่งสอน: 5 คาบ → 3 + 2 ผูกกลุ่มเดียวกัน ครูคนที่สองไม่ใช่คนเดิม ไม่เตือนเมื่อรวมเท่าหลักสูตร', () => {
  const d = clone(legacy); fillSubjectPerWeek(d, curMap);
  const a4 = d.assignments.find((a) => a.id === 'a4');
  const b = splitAssignment(d, a4, 'aNew');
  assert.equal(a4.perWeek, 3); assert.equal(b.perWeek, 2);
  assert.equal(a4.split, b.split); assert.ok(a4.split);
  assert.notEqual(b.teacherId, a4.teacherId);
  assert.equal(d.assignments.indexOf(b), d.assignments.indexOf(a4) + 1);
  assert.equal(duplicateGroups(d).length, 1, 'แถวซ้ำเดิมของ c1 ยังอยู่ แต่กลุ่มแบ่งสอนของ c2 ไม่นับ');
  const st = perWeekStatus(d, b);
  assert.equal(st.ok, true); assert.equal(st.split, true); assert.equal(st.total, 5);
  b.perWeek = 3;
  assert.equal(perWeekStatus(d, b).ok, false, 'รวม 6 เกินหลักสูตร 5 → เตือน');
  // เลิกแบ่งสอน
  mergeRows(d, [a4, b]);
  assert.equal(a4.perWeek, 6); assert.equal(a4.split, undefined);
});

test('แบ่งสอน: คาบที่วางไว้เกินส่วนใหม่ของแถวเดิมถูกนำออก', () => {
  const d = clone(legacy);
  const a3 = d.assignments.find((a) => a.id === 'a3');
  d.placements.push({ assignmentId: 'a3', day: 3, period: 1 }, { assignmentId: 'a3', day: 4, period: 1 }, { assignmentId: 'a3', day: 4, period: 3 });
  splitAssignment(d, a3, 'aX'); // 5 → 3 + 2, วางไว้ 4 คาบ → เหลือ 3
  assert.equal(d.placements.filter((p) => p.assignmentId === 'a3').length, 3);
  assert.ok(a3.doubles * 2 <= a3.perWeek);
});

test('ลบทั้งหมดเฉพาะห้องที่กรอง + เลิกทำคืนครบรวมคาบที่วางไว้และลำดับเดิม', () => {
  const d = clone(legacy);
  const before = clone(d);
  const t = removeAssignments(d, (a) => a.classId === 'c1');
  assert.equal(d.assignments.length, 1);
  assert.deepEqual(d.placements.map((p) => p.assignmentId), ['a4']);
  assert.equal(t.assignments.length, 3); assert.equal(t.placements.length, 3);
  undoRemove(d, t);
  assert.deepEqual(d, before);
});

test('ลบวิชาทั้งหมด (พร้อมการสอนที่ผูก) + เลิกทำคืนครบ', () => {
  const d = clone(legacy);
  const before = clone(d);
  const t = removeSubjects(d);
  assert.equal(d.subjects.length, 0); assert.equal(d.assignments.length, 0); assert.equal(d.placements.length, 0);
  assert.equal(undoRemove(d, t), 7);
  assert.deepEqual(d, before);
  undoRemove(d, t); // กดซ้ำไม่ทำให้ซ้ำ
  assert.deepEqual(d, before);
});

test('แนวตาราง: วันเรียงลงล่าง แถว = วัน คอลัมน์ = คาบ (พักเป็นคอลัมน์) · คาบเรียงลงล่างสลับกัน · ช่องเดียวกันได้ day/period ตรงกัน', () => {
  const d = clone(legacy);
  const g1 = gridModel(d, 'days');
  assert.equal(g1.rows.length, 5); assert.equal(g1.cols.length, 4);
  assert.equal(g1.corner, 'วัน');
  assert.deepEqual(g1.cols.map((c) => c.brk), [false, false, true, false]);
  assert.deepEqual(g1.at(g1.rows[2], g1.cols[3]), { day: 2, period: 3 });
  const g2 = gridModel(d, 'periods');
  assert.equal(g2.rows.length, 4); assert.equal(g2.cols.length, 5);
  assert.deepEqual(g2.rows.map((r) => r.brk), [false, false, true, false]);
  assert.deepEqual(g2.at(g2.rows[3], g2.cols[2]), { day: 2, period: 3 });
  // ทุกช่องที่ไม่ใช่พักถูกครอบคลุมครบ ไม่ซ้ำ ทั้งสองแนว
  for (const g of [g1, g2]) {
    const seen = new Set();
    for (const r of g.rows) for (const c of g.cols) if (!r.brk && !c.brk) { const { day, period } = g.at(r, c); seen.add(day + ':' + period); }
    assert.equal(seen.size, 5 * 3);
  }
  d.settings = { orientation: 'periods' };
  assert.equal(gridModel(d).orient, 'periods');
});

// ---------- โครงคาบ ----------
test('buildPeriods ประถม 08:30 · 60 นาที · 6 คาบ · พักหลังคาบ 3 → 7 แถว ตรงกับตัวอย่างประถม', () => {
  const p = buildPeriods({ start: '08:30', minutes: 60, count: 6, breakAfter: 3, breakMinutes: 60 });
  assert.equal(p.length, 7);
  assert.equal(p.filter((x) => x.type === 'class').length, 6);
  assert.deepEqual(p[3], { label: 'พักกลางวัน', start: '11:30', end: '12:30', type: 'break' });
  assert.deepEqual(p[6], { label: '6', start: '14:30', end: '15:30', type: 'class' });
  const sample = JSON.parse(readFileSync(join(here, '../assets/solver/sample-primary.json'), 'utf8'));
  assert.deepEqual(p, sample.term.periods);
  assert.deepEqual(periodMinutes({ term: { periods: p } }), { min: 60, max: 60 });
});

test('buildPeriods มัธยม 50 นาที 8 คาบ พักหลังคาบ 4 · breakAfter=0 ไม่มีพัก · ค่าแปลกไม่พัง', () => {
  const m = buildPeriods({ start: '08:30', minutes: 50, count: 8, breakAfter: 4, breakMinutes: 60 });
  assert.equal(m.length, 9);
  assert.equal(m[4].type, 'break'); assert.equal(m[4].start, '11:50'); assert.equal(m[4].end, '12:50');
  assert.equal(m[8].label, '8'); assert.equal(m[8].end, '16:10');
  const n = buildPeriods({ start: '08:00', minutes: 60, count: 5, breakAfter: 0 });
  assert.equal(n.length, 5); assert.ok(n.every((x) => x.type === 'class'));
  assert.equal(n[4].end, '13:00');
  assert.equal(buildPeriods({ count: 5, breakAfter: 5 }).length, 5, 'พักหลังคาบสุดท้าย = ไม่มีพัก');
  const odd = buildPeriods({ start: 'xx', minutes: -3, count: 99, breakAfter: 2 });
  assert.ok(odd.length <= 20, 'ไม่เกิน 20 แถว (validate_term_doc)');
  assert.equal(odd[0].start, '08:30');
});

test('retimePeriods คงชื่อ/ชนิด เปลี่ยนเวลาเรียงต่อกันจากคาบแรก · พักคงความยาวเดิม', () => {
  const src = [
    { label: 'โฮมรูม', start: '08:00', end: '08:20', type: 'class' }, { label: '1', start: '', end: '', type: 'class' },
    { label: 'พัก', start: '10:00', end: '10:15', type: 'break' }, { label: '2', type: 'class' },
  ];
  const r = retimePeriods(src, { minutes: 50 });
  assert.deepEqual(r.map((x) => x.label), ['โฮมรูม', '1', 'พัก', '2']);
  assert.deepEqual(r.map((x) => [x.start, x.end]), [['08:00', '08:50'], ['08:50', '09:40'], ['09:40', '09:55'], ['09:55', '10:45']]);
  assert.equal(src[1].start, '', 'ไม่แก้อาร์เรย์เดิม');
});

// ---------- รายวิชาตามชั้น ----------
test('subjectsForLevels(ป.1, ม.1, ภาค 1) จับด้วยรหัส: ป.1 = x11xxx · ม.1 ภาค 1 = x21xxx เลขคี่ ไม่เอาภาค 2', () => {
  const list = subjectsForLevels(cur, ['ป.1', 'ม.1/2'], 1);
  const p1 = list.filter((s) => s.level === 'ป.1'), m1 = list.filter((s) => s.level === 'ม.1');
  assert.equal(p1.length + m1.length, list.length);
  assert.ok(p1.length >= 10 && m1.length >= 10);
  assert.ok(p1.every((s) => /^[ก-ฮ]11\d{3}$/.test(s.code)));
  assert.ok(m1.every((s) => /^[ก-ฮ]21\d{3}$/.test(s.code)));
  assert.ok(m1.some((s) => s.code === 'ท21101') && !m1.some((s) => s.code === 'ท21102'));
  assert.ok(subjectsForLevels(cur, ['ม.1'], 2).some((s) => s.code === 'ท21102'));
  assert.equal(new Set(list.map((s) => s.code)).size, list.length, 'ไม่มีรหัสซ้ำ');
  assert.equal(p1.find((s) => s.code === 'ท11101').perWeek, 5);
  assert.deepEqual(subjectsForLevels(cur, ['อ.2', 'อะไร'], 1), []);
  assert.equal(levelKey('ม1/2'), 'ม.1'); assert.equal(levelKey('ป. 1-2'), 'ป.1');
  assert.equal(termSem('ภาคเรียนที่ 2/2569'), 2); assert.equal(termSem(''), 1);
});

// ---------- กลุ่มสาระ ----------
test('กลุ่มสาระ: จากรหัสวิชาก่อน ไม่มีรหัสใช้ชื่อ · พจนานุกรมคำไทย 10 กลุ่ม', () => {
  assert.equal(SUBJECT_GROUP_CODES.length, 10);
  const byCode = { ท21101: 'TH', ค11101: 'MA', ว11201: 'SC', ส11231: 'SO', พ21102: 'HE', ศ14101: 'AR', ง16101: 'OC', อ11101: 'FL', จ20201: 'FL', ญ30201: 'FL', ฝ30201: 'FL' };
  for (const [code, g] of Object.entries(byCode)) assert.equal(subjectGroupOf({ code, name: 'อะไรก็ได้' }), g, code);
  assert.equal(subjectGroupOf({ code: 'X999', name: 'ภาษาอังกฤษเพื่อการสื่อสาร' }), 'FL');
  assert.equal(subjectGroupOf({ code: '', name: 'ชุมนุมพิเศษ' }), null);
  const words = {
    'ภาษาไทย': 'TH', 'ไทย': 'TH', 'คณิต': 'MA', 'วิทย์': 'SC', 'วิทยาการคำนวณ': 'SC', 'เทคโนโลยี': 'SC', 'สังคม': 'SO', 'ประวัติศาสตร์': 'SO',
    'พระพุทธศาสนา': 'SO', 'สุขศึกษา': 'HE', 'สุข-พละ': 'HE', 'ศิลปะ': 'AR', 'ดนตรีไทย': 'AR', 'นาฏศิลป์': 'AR', 'การงานอาชีพ': 'OC',
    'อาชีพ': 'OC', 'อังกฤษ': 'FL', 'ภาษาต่างประเทศ': 'FL', 'ภาษาจีน': 'FL', 'ญี่ปุ่น': 'FL', 'ปฐมวัย': 'EC', 'อนุบาล': 'EC', 'แนะแนว': 'GU',
    'สังคมศึกษา ศาสนาและวัฒนธรรม': 'SO', 'สุขศึกษาและพลศึกษา': 'HE', 'วิทยาศาสตร์และเทคโนโลยี': 'SC', 'การออกแบบและเทคโนโลยี': 'SC',
  };
  for (const [w, g] of Object.entries(words)) assert.equal(groupFromText(w), g, w);
  assert.equal(groupFromText(''), null); assert.equal(groupFromText('ลูกเสือ'), null);
  // รายวิชาพื้นฐานทุกตัวในหลักสูตรได้กลุ่มทั้งจากรหัสและจากชื่อ และตรงกัน
  for (const lv of cur.levels) for (const s of lv.subjects) {
    assert.ok(SUBJECT_GROUP_CODES.includes(subjectGroupOf(s)), s.code);
    assert.equal(groupFromText(s.name), subjectGroupOf(s), s.code + ' ' + s.name);
  }
});

// ---------- เติมครูอัตโนมัติ ----------
/** ประถม 6 ห้อง ห้องละ 1 ครูประจำชั้น + ครูวิทย์/อังกฤษ/พละ · การสอนร่างจากหลักสูตร teacherId=null ทั้งหมด */
function primaryDoc() {
  const classes = [1, 2, 3, 4, 5, 6].map((y) => ({ id: 'c' + y, name: 'ป.' + y, level: 'ป.' + y }));
  const teachers = classes.map((c, i) => ({ id: 'h' + (i + 1), name: 'ครูประจำชั้น ' + c.name, homeroom: c.id }));
  teachers[0].subjects = ['TH']; // ครูประจำชั้น ป.1 จบภาษาไทย → ต้องไม่ได้ภาษาไทยทุกห้อง
  teachers.push({ id: 'sci', name: 'ครูวิทย์', subjects: ['SC'] }, { id: 'eng', name: 'ครูอังกฤษ', subjects: ['FL'] }, { id: 'pe', name: 'ครูพละ', subjects: ['HE'] });
  const subs = subjectsForLevels(cur, classes.map((c) => c.level), 1);
  const subjects = subs.map((s, i) => ({ id: 's' + i, code: s.code, name: s.name, color: s.color, perWeek: s.perWeek }));
  const assignments = [];
  for (const c of classes) for (const s of subjects) if (s.code[2] === c.level[2]) assignments.push({ id: 'a' + assignments.length, subjectId: s.id, classId: c.id, teacherId: null, roomId: null, perWeek: s.perWeek, doubles: 0 });
  return { term: { name: 'ภาคเรียนที่ 1/2569', days: 5, periods: buildPeriods({ count: 6, breakAfter: 3 }) }, classes, teachers, rooms: [], subjects, assignments, locks: [], placements: [] };
}

test('autoAssign ประถม: วิชาหลักได้ครูประจำชั้น · วิทย์ได้ครูวิทย์ · พละได้ครูพละ · อังกฤษได้ครูอังกฤษหรือว่าง ไม่ตกครูประจำชั้น', () => {
  const d = primaryDoc();
  assert.deepEqual(defaultAssignOpts(d), { homeroomTeachesCore: true, maxPerWeek: 25 });
  const { changes, unresolved } = autoAssign(d);
  const to = new Map(changes.map((c) => [c.assignmentId, c]));
  const grp = (a) => subjectGroupOf(d.subjects.find((s) => s.id === a.subjectId));
  for (const a of d.assignments) {
    const g = grp(a), ch = to.get(a.id);
    if (g === 'SC') assert.equal(ch?.to, 'sci', a.id);
    else if (g === 'HE') assert.equal(ch?.to, 'pe', a.id);
    else if (g === 'FL') assert.ok(!ch || ch.to === 'eng', 'อังกฤษไม่ตกครูประจำชั้นเมื่อมีครูอังกฤษ');
    else assert.equal(ch?.to, 'h' + a.classId.slice(1), `${a.id} ${g} → ครูประจำชั้น`);
  }
  assert.ok(unresolved.every((id) => grp(d.assignments.find((a) => a.id === id)) === 'FL'), 'ที่ยังว่างมีแต่อังกฤษ (ครูอังกฤษเต็มเพดาน)');
  assert.ok(unresolved.length <= d.assignments.length * 0.1, `ว่าง ${unresolved.length}/${d.assignments.length} ≤ 10%`);
  applyAssign(d, changes);
  for (const [id, n] of teacherLoad(d)) assert.ok(n <= 25, `${id} ${n} คาบ ไม่เกินเพดาน`);
  assert.ok(changes.every((c) => c.from === null && c.why));
});

test('autoAssign มัธยม 3 ห้องชั้นเดียว ครูคณิต 2 คน: ห้อง 2-3 ใช้ครูเดียวกับห้อง 1 เมื่อไม่เกินเพดาน · เกินแล้วกระจาย', () => {
  const d = {
    term: { days: 5, periods: [] },
    classes: [1, 2, 3].map((i) => ({ id: 'm' + i, name: 'ม.1/' + i, level: 'ม.1' })),
    teachers: [{ id: 'tA', name: 'ครูคณิต ก', subjects: ['MA'] }, { id: 'tB', name: 'ครูคณิต ข', subjects: ['MA'] }],
    rooms: [], subjects: [{ id: 's1', code: 'ค21101', name: 'คณิตศาสตร์ 1', perWeek: 3 }],
    assignments: [1, 2, 3].map((i) => ({ id: 'a' + i, subjectId: 's1', classId: 'm' + i, teacherId: null, roomId: null, perWeek: 3, doubles: 0 })),
    locks: [], placements: [],
  };
  assert.deepEqual(defaultAssignOpts(d), { homeroomTeachesCore: false, maxPerWeek: 22 });
  const r1 = autoAssign(d);
  assert.deepEqual(r1.changes.map((c) => [c.to, c.rule]), [['tA', 2], ['tA', 1], ['tA', 1]]);
  const r2 = autoAssign(d, { maxPerWeek: 6 });
  assert.deepEqual(r2.changes.map((c) => c.to), ['tA', 'tA', 'tB']);
  // เพดานรายคน (teacher.maxPerWeek) ชนะเพดานรวม
  d.teachers[0].maxPerWeek = 3;
  assert.deepEqual(autoAssign(d).changes.map((c) => c.to), ['tA', 'tB', 'tB']);
});

test('autoAssign ไม่ทับครูที่เลือกไว้ · ไม่มีครูเข้าเกณฑ์ → unresolved ไม่ใส่ครูคนแรก · ไม่แก้ doc จนกว่าจะ applyAssign', () => {
  const d = primaryDoc();
  d.assignments[0].teacherId = 'pe'; // ครูเลือกเองแม้ไม่ตรงกลุ่ม
  const before = clone(d);
  const r = autoAssign(d);
  assert.deepEqual(d, before, 'autoAssign ไม่แก้ doc');
  assert.ok(!r.changes.some((c) => c.assignmentId === d.assignments[0].id));
  assert.equal(r.changes.length + r.unresolved.length, d.assignments.length - 1);
  // ไม่มีกลุ่มสาระ ไม่มีครูประจำชั้น → ว่างทั้งหมด
  const bare = primaryDoc();
  bare.teachers = bare.teachers.map(({ id, name }) => ({ id, name }));
  const rb = autoAssign(bare);
  assert.equal(rb.changes.length, 0);
  assert.equal(rb.unresolved.length, bare.assignments.length);
  // สวิตช์ครูประจำชั้นปิด → วิชาหลักไม่ได้ครูประจำชั้น
  const off = autoAssign(primaryDoc(), { homeroomTeachesCore: false });
  assert.ok(off.changes.every((c) => ['sci', 'eng', 'pe', 'h1'].includes(c.to)));
});

test('autoAssign ผลเหมือนเดิมทุกครั้ง · applyAssign + undoAssign คืนสภาพ (ไม่แตะแถวที่ผู้ใช้เปลี่ยนต่อ)', () => {
  const d = primaryDoc();
  const r1 = autoAssign(d), r2 = autoAssign(clone(d));
  assert.deepEqual(r1, r2);
  const before = clone(d);
  assert.equal(applyAssign(d, r1.changes), r1.changes.length);
  assert.equal(applyAssign(d, r1.changes), 0, 'ใส่ซ้ำไม่ทับ');
  assert.equal(autoAssign(d).changes.length, 0, 'เติมแล้วกดอีกไม่มีอะไรเปลี่ยน');
  const moved = d.assignments.find((a) => a.id === r1.changes[0].assignmentId);
  moved.teacherId = 'eng'; // ผู้ใช้เปลี่ยนเองหลังเติม
  assert.equal(undoAssign(d, r1.changes), r1.changes.length - 1);
  moved.teacherId = null;
  assert.deepEqual(d, before);
});

test('ข้อมูลเก่า (ครูไม่มี subjects/homeroom) เปิดได้: เติมจากห้องอื่นชั้นเดียวกัน · แบ่งสอนยังได้ครูคนที่สองตามลำดับเดียวกัน', () => {
  const d = clone(legacy);
  d.assignments[3].teacherId = null; // ป.1/2 ภาษาไทย
  const r = autoAssign(d);
  assert.deepEqual(r.changes.map((c) => [c.assignmentId, c.to, c.rule]), [['a4', 't1', 1]]);
  assert.match(r.changes[0].why, /ป\.1\/1/);
  // แบ่งสอนวิชาวิทย์ของห้องที่มีครูวิทย์ → ครูคนที่สองคือครูวิทย์
  const e = clone(legacy);
  e.teachers.push({ id: 't9', name: 'ครูวิทย์', subjects: ['SC'] });
  e.subjects.push({ id: 's9', code: 'ว11101', name: 'วิทยาศาสตร์ ป.1' });
  const a = { id: 'a9', subjectId: 's9', classId: 'c2', teacherId: 't3', roomId: null, perWeek: 2, doubles: 0 };
  e.assignments.push(a);
  assert.equal(splitAssignment(e, a, 'a10').teacherId, 't9');
});

test('guessNew ห้อง ม.1/1: เลือกวิชา ม.1 (ท21101 "ภาษาไทย 1") ที่ยังว่าง ไม่เอา ป.1 · ครูตามลำดับ autoAssign · ไม่พบครู → null', () => {
  const d = {
    term: { days: 5, periods: [] },
    classes: [{ id: 'k1', name: 'ม.1/1', level: 'ม.1' }, { id: 'k2', name: 'ม.1/2', level: 'ม.1' }],
    teachers: [{ id: 'x', name: 'ครูไม่มีวิชาเอก' }, { id: 'th', name: 'ครูภาษาไทย', subjects: ['TH'] }],
    rooms: [],
    subjects: [{ id: 'p', code: 'ท11101', name: 'ภาษาไทย ป.1', perWeek: 5 }, { id: 'm', code: 'ท21101', name: 'ภาษาไทย 1', perWeek: 3 }, { id: 'k', code: 'ค21101', name: 'คณิตศาสตร์ 1', perWeek: 3 }],
    assignments: [], locks: [], placements: [],
  };
  assert.deepEqual(guessNew(d, 'k1'), { classId: 'k1', subjectId: 'm', teacherId: 'th' });
  d.assignments.push({ id: 'a1', subjectId: 'm', classId: 'k1', teacherId: 'th', perWeek: 3 });
  assert.deepEqual(guessNew(d, 'k1'), { classId: 'k1', subjectId: 'k', teacherId: null }, 'คณิตไม่มีครูเข้าเกณฑ์ → null ไม่ใช่ครูคนแรก');
  assert.equal(guessTeacher(d, { id: null, classId: 'k2', subjectId: 'm', perWeek: 3 }), 'th');
  d.assignments.push({ id: 'a2', subjectId: 'k', classId: 'k1', teacherId: 'x', perWeek: 3 });
  assert.deepEqual(guessNew(d, 'k2'), { classId: 'k2', subjectId: 'm', teacherId: 'th' });
  assert.equal(guessTeacher(d, { id: null, classId: 'k2', subjectId: 'k', perWeek: 3 }), 'x', 'คณิตห้องอื่นชั้นเดียวกันมีครู x');
  d.assignments.push({ id: 'a3', subjectId: 'p', classId: 'k1', teacherId: 'x', perWeek: 5 });
  assert.equal(guessNew(d, 'k1'), null, 'ห้องมีครบทุกวิชาแล้ว');
});

test('autoAssign: แถวที่อ้างครูที่ถูกลบไปแล้ว นับเป็นยังไม่มีครู → เติมให้ได้ (applyAssign ก็ใส่ทับได้)', () => {
  const d = primaryDoc();
  const a = d.assignments.find((x) => subjectGroupOf(d.subjects.find((s) => s.id === x.subjectId)) === 'SC');
  a.teacherId = 'deleted-teacher';
  const { changes } = autoAssign(d);
  const ch = changes.find((c) => c.assignmentId === a.id);
  assert.equal(ch?.to, 'sci');
  assert.equal(ch.from, 'deleted-teacher');
  applyAssign(d, changes);
  assert.equal(a.teacherId, 'sci');
});

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
