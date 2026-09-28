// ทดสอบกฎข้อมูลการสอน (assets/rules.js) — รัน: node htdocs/timetable/tests/rules.test.mjs
// กันเลือกวิชาซ้ำ · แบ่งสอน · รวมแถวซ้ำ · คาบ/สัปดาห์ตามหลักสูตร · แนวตาราง · ลบทั้งหมด + เลิกทำ · ข้อมูลภาคเรียนแบบเก่า
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  orientation, gridModel, periodMinutes, periodText, hoursHint, fillSubjectPerWeek, subjectChoices, usedSubjects,
  duplicateGroups, splitAssignment, mergeRows, markSplit, perWeekStatus, removeAssignments, removeSubjects, undoRemove,
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

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
