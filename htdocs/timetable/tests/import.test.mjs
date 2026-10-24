// ทดสอบการวางรายชื่อ ครู / วิชา / ภาระสอน (assets/import.js) + sanitize ฟิลด์ใหม่ — รัน: node htdocs/timetable/tests/import.test.mjs
// วางจาก Excel (tab มี/ไม่มีหัว) · LINE ทีละบรรทัด · คอลัมน์ `|` · คำนำหน้า · ชื่อย่อซ้ำ · ครูซ้ำ · วิชา · ภาระสอนขยายห้อง · merge3
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseTable, parseTeachers, parseSubjects, parseWorkload, applyTeachers, applySubjects, applyWorkload, undoImport,
  stripPrefix, normClass, resolveClasses, EXAMPLES,
} from '../assets/import.js';
import { store, index, merge3 } from '../assets/store.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✔ ' + name); } catch (e) { failed++; console.log('✘ ' + name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
const seqId = (p) => p + 'x' + ++n;

const school = {
  term: { name: 'ภาคเรียนที่ 2/2569', days: 5, periods: [{ type: 'class' }, { type: 'class' }] },
  classes: [
    { id: 'c11', name: 'ม.1/1', level: 'ม.1' }, { id: 'c12', name: 'ม.1/2', level: 'ม.1' }, { id: 'c13', name: 'ม.1/3', level: 'ม.1' },
    { id: 'c21', name: 'ม.2/1', level: 'ม.2' }, { id: 'p3', name: 'ป.3', level: 'ป.3' }, { id: 'p12', name: 'ป.1-2', level: 'ป.1' },
  ],
  teachers: [{ id: 't1', name: 'นางสมศรี รักเรียน', short: 'ครูสมศรี' }, { id: 't2', name: 'สมชาย ใจดี', short: 'ครูสมชาย' }],
  rooms: [],
  subjects: [
    { id: 's1', code: 'ค21101', name: 'คณิตศาสตร์ 1', color: '#7FB0E8', perWeek: 3 },
    { id: 's2', code: 'ท21101', name: 'ภาษาไทย 1', color: '#E3B85A', perWeek: 3 },
    { id: 's3', code: '', name: 'ลูกเสือ', color: '#F0A6BD', perWeek: 1 },
  ],
  assignments: [{ id: 'a1', subjectId: 's2', classId: 'c11', teacherId: 't1', roomId: null, perWeek: 3, doubles: 0 }],
  locks: [], placements: [],
};

// ---------- parseTable ----------
test('Excel tab มีหัว → headers + keys ไม่นับหัวเป็นแถว', () => {
  const r = parseTable('ชื่อ-สกุล\tกลุ่มสาระ\tประจำชั้น\nนายเอ บีซี\tคณิต\tป.3\nนางดี อี\tไทย\t\n');
  assert.equal(r.delim, '\t');
  assert.deepEqual(r.keys, ['name', 'group', 'class']);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], ['นายเอ บีซี', 'คณิต', 'ป.3']);
});

test('Excel ช่องในเครื่องหมายคำพูดขึ้นบรรทัดใหม่ได้ · ไม่ตัดที่ช่องว่างตัวเดียว', () => {
  const r = parseTable('"นายเอ\nบีซี"\tคณิต\nนางดี อี\tไทย');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0][0], 'นายเอ บีซี');
  const line = parseTable('นายสมชาย ใจดี คณิต ป.3');
  assert.deepEqual(line.rows, [['นายสมชาย ใจดี คณิต ป.3']]);
});

test('คอลัมน์ | (ตาราง markdown) + ช่องว่าง ≥ 2 ตัว', () => {
  const r = parseTable('| ชื่อ | วิชาเอก |\n|---|---|\n| นายเอ บีซี | คณิต |');
  assert.equal(r.delim, '|');
  assert.deepEqual(r.keys, ['name', 'group']);
  assert.deepEqual(r.rows, [['นายเอ บีซี', 'คณิต']]);
  assert.deepEqual(parseTable('นายเอ บีซี   คณิต   ป.3').rows, [['นายเอ บีซี', 'คณิต', 'ป.3']]);
});

// ---------- ครู ----------
test('ครู: Excel มีหัว → ชื่อ ชื่อย่อ กลุ่มสาระ ประจำชั้น', () => {
  const { rows } = parseTeachers('ชื่อ-สกุล\tกลุ่มสาระ\tประจำชั้น\nนายมานะ ขยัน\tคณิตศาสตร์, วิทยาศาสตร์\tป.3\nนางสาวปิติ ยินดี\tภาษาอังกฤษ\t', school);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'มานะ ขยัน', short: 'ครูมานะ', subjects: ['MA', 'SC'], homeroom: 'p3', homeroomText: 'ป.3', status: 'new', include: true, dupOf: null, issues: [] });
  assert.deepEqual(rows[1].subjects, ['FL']);
  assert.equal(rows[1].homeroom, null);
});

test('ครู: Excel ไม่มีหัว → เดาคอลัมน์จากรูปแบบ', () => {
  const { rows } = parseTeachers('นายมานะ ขยัน\tคณิต\tป. 3\nวีระ กล้าหาญ\tสุข-พละ\tม.1/2', school);
  assert.equal(rows[0].name, 'มานะ ขยัน');
  assert.deepEqual(rows[0].subjects, ['MA']);
  assert.equal(rows[0].homeroom, 'p3');
  assert.equal(rows[1].name, 'วีระ กล้าหาญ');
  assert.deepEqual(rows[1].subjects, ['HE']);
  assert.equal(rows[1].homeroom, 'c12');
});

test('ครู: วางจาก LINE ทีละบรรทัด "1. นายสมชาย ใจดี คณิต ป.3"', () => {
  const { rows } = parseTeachers('1. นายมานะ ขยัน คณิต ป.3\n2) นางสาวชูใจ ศรีไทย ภาษาไทย ประจำชั้น ม.1/1\n3. ครูวิไล (ครูอัตราจ้าง) อังกฤษ\n4. นายเอก ณ อยุธยา สังคม', school);
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[0].name, rows[0].subjects, rows[0].homeroom], ['มานะ ขยัน', ['MA'], 'p3']);
  assert.deepEqual([rows[1].name, rows[1].subjects, rows[1].homeroom], ['ชูใจ ศรีไทย', ['TH'], 'c11'], 'นามสกุลมีคำว่าไทย ไม่ใช่วิชาเอก');
  assert.deepEqual([rows[2].name, rows[2].subjects], ['วิไล', ['FL']], 'วงเล็บถูกตัด คำที่ 2 เป็นวิชาเอก');
  assert.deepEqual([rows[3].name, rows[3].subjects], ['เอก ณ อยุธยา', ['SO']]);
  const comma = parseTeachers('นายมานะ ขยัน คณิต, วิทย์ ป.3', school).rows[0];
  assert.deepEqual([comma.name, comma.subjects, comma.homeroom], ['มานะ ขยัน', ['MA', 'SC'], 'p3'], 'มีจุลภาคในบรรทัด');
});

test('ครู: คำนำหน้า 6 แบบ + ยศตำรวจ ถูกตัด', () => {
  for (const p of ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'ครู', 'ว่าที่ร้อยตรี', 'ว่าที่ ร.ต. ', 'ด.ต.', 'ส.ต.อ.หญิง', 'ดร. ']) {
    assert.equal(stripPrefix(p + 'มานี มีนา'), 'มานี มีนา', p);
  }
  const { rows } = parseTeachers('นายก้อง หนึ่ง\nนางกล้า สอง\nนางสาวขวัญ สาม\nน.ส.คิด สี่\nครูงาม ห้า\nว่าที่ร้อยตรีจริง หก', school);
  assert.deepEqual(rows.map((r) => r.name), ['ก้อง หนึ่ง', 'กล้า สอง', 'ขวัญ สาม', 'คิด สี่', 'งาม ห้า', 'จริง หก']);
  assert.ok(rows.every((r) => r.short === 'ครู' + r.name.split(' ')[0]));
});

test('ครู: ชื่อตัวซ้ำกัน → ชื่อย่อเติมอักษรแรกนามสกุล ไม่ชนกับครูเดิม', () => {
  const { rows } = parseTeachers('นายสมพร ใจงาม\nนายสมพร เก่งมาก\nนายสมศรี เอี่ยมสะอาด', school);
  assert.deepEqual(rows.map((r) => r.short), ['ครูสมพร จ.', 'ครูสมพร ก.', 'ครูสมศรี อ.']);
  assert.equal(new Set(rows.map((r) => r.short)).size, 3);
});

test('ครู: ชื่อที่มีอยู่แล้ว (ต่างคำนำหน้า/ช่องว่าง) → status dup ไม่ติ๊ก', () => {
  const { rows } = parseTeachers('ครูสมศรี  รักเรียน\nนายสมชาย ใจดี\nนายใหม่ มาก\nนายใหม่ มาก', school);
  assert.deepEqual(rows.map((r) => r.status), ['dup', 'dup', 'new', 'dup']);
  assert.deepEqual(rows.map((r) => r.include), [false, false, true, false]);
  assert.equal(rows[0].dupOf, 't1');
  assert.equal(rows[1].dupOf, 't2');
});

test('ครู: ประจำชั้นที่มีหลายห้อง / ไม่มีห้อง → homeroom ว่าง + issue (ไม่ throw)', () => {
  const { rows } = parseTeachers('ชื่อ\tประจำชั้น\nนายเอ บี\tม.1\nนายซี ดี\tป.6\nนายอี เอฟ\tป.1-2', school);
  assert.equal(rows[0].homeroom, null);
  assert.match(rows[0].issues[0], /3 ห้อง/);
  assert.equal(rows[1].homeroom, null);
  assert.match(rows[1].issues[0], /ไม่พบห้อง/);
  assert.equal(rows[2].homeroom, 'p12', 'ห้องคละชั้น "ป.1-2" ตรงตัว ไม่ขยายเป็นช่วง');
});

test('ครู: applyTeachers เพิ่มเฉพาะที่ติ๊ก + undoImport', () => {
  const d = clone(school);
  const { rows } = parseTeachers('นายมานะ ขยัน\tคณิต\tป.3\nนายสมชาย ใจดี\tคณิต', d);
  const res = applyTeachers(d, rows, seqId);
  assert.equal(res.teachers.length, 1);
  const t = d.teachers.at(-1);
  assert.deepEqual({ ...t, id: 'x' }, { id: 'x', name: 'มานะ ขยัน', short: 'ครูมานะ', maxPerDay: 6, unavailable: [], subjects: ['MA'], homeroom: 'p3' });
  undoImport(d, res);
  assert.deepEqual(d, school);
});

// ---------- วิชา ----------
test('วิชา: รหัส + ชื่อ + คาบ · รหัสซ้ำกับวิชาเดิม → ข้าม · สีจากชุดสี', () => {
  const { rows } = parseSubjects('รหัส\tชื่อวิชา\tคาบ\nว21101\tวิทยาศาสตร์ 1\t3\nค21101\tคณิตศาสตร์ 1\t3\nส 21101\tสังคมศึกษา 1\t2', school);
  assert.deepEqual(rows.map((r) => [r.code, r.name, r.perWeek, r.status]), [
    ['ว21101', 'วิทยาศาสตร์ 1', 3, 'new'], ['ค21101', 'คณิตศาสตร์ 1', 3, 'dup'], ['ส21101', 'สังคมศึกษา 1', 2, 'new']]);
  assert.ok(rows.every((r) => /^#[0-9A-F]{6}$/i.test(r.color)));
});

test('วิชา: ขาดคาบ → ตามหลักสูตรถ้ารหัสตรง ไม่งั้น 1 · "3 คาบ" ในบรรทัดเดียว', () => {
  const cur = { ว21101: 4 };
  const { rows } = parseSubjects('ว21101 วิทยาศาสตร์ 1\nชุมนุม\nง21101 การงานอาชีพ 1 2 คาบ\nค21102  คณิตศาสตร์ 2  5', null, cur);
  assert.deepEqual(rows.map((r) => [r.code, r.name, r.perWeek]), [
    ['ว21101', 'วิทยาศาสตร์ 1', 4], ['', 'ชุมนุม', 1], ['ง21101', 'การงานอาชีพ 1', 2], ['ค21102', 'คณิตศาสตร์ 2', 5]]);
});

test('วิชา: applySubjects', () => {
  const d = clone(school);
  const res = applySubjects(d, parseSubjects('ว21101\tวิทยาศาสตร์ 1\t3', d).rows, seqId);
  assert.equal(res.subjects.length, 1);
  assert.deepEqual({ ...d.subjects.at(-1), id: 'x', color: 'c' }, { id: 'x', code: 'ว21101', name: 'วิทยาศาสตร์ 1', color: 'c', perWeek: 3 });
});

// ---------- ภาระสอน ----------
test('ห้อง: สะกดต่างกันถือเป็นห้องเดียวกัน · ช่วง · ทุกห้อง', () => {
  for (const s of ['ม.1/1', 'ม1/1', 'ม.1 /1', 'ม. 1/1', 'มัธยมศึกษาปีที่ 1/1']) assert.equal(normClass(s), 'ม1/1', s);
  const cls = school.classes;
  assert.deepEqual(resolveClasses('ม.1/1-3', cls).ids, ['c11', 'c12', 'c13']);
  assert.deepEqual(resolveClasses('ม.1 ทุกห้อง', cls).ids, ['c11', 'c12', 'c13']);
  assert.deepEqual(resolveClasses('ม.2', cls).ids, ['c21'], 'ชั้นที่มีห้องเดียว');
  assert.deepEqual(resolveClasses('ม.1/2-5', cls).ids, ['c12', 'c13']);
  assert.match(resolveClasses('ม.1/2-5', cls).issue, /4,5/);
});

test('ภาระสอน: "ม.1 ทุกห้อง" ขยายเป็น 3 แถว · วิชาจับด้วยชื่อ "คณิตศาสตร์ 1" · ห้องสะกดต่าง', () => {
  const { rows, newTeachers } = parseWorkload('ครู\tวิชา\tห้อง\tคาบ\nครูสมชาย\tคณิตศาสตร์ 1\tม.1 ทุกห้อง\t3\nนางสมศรี รักเรียน\tท21101\tม 1/2\t\n', school);
  assert.equal(newTeachers.length, 0);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.teacherId, r.subjectId, r.classId, r.perWeek, r.status]), [
    ['t2', 's1', 'c11', 3, 'ok'], ['t2', 's1', 'c12', 3, 'ok'], ['t2', 's1', 'c13', 3, 'ok']]);
  assert.deepEqual([rows[3].teacherId, rows[3].subjectId, rows[3].classId, rows[3].perWeek], ['t1', 's2', 'c12', 3], 'ไม่มีคาบ → คาบของวิชา');
});

test('ภาระสอน: ไม่มีหัว · ครูใหม่ถูกเสนอสร้าง · ซ้ำกับการสอนเดิม → dup/skip', () => {
  const { rows, newTeachers } = parseWorkload('นายใหม่ ใจกล้า\tลูกเสือ\tม.2/1\t1\nครูสมศรี\tภาษาไทย 1\tม.1/1\t3\nนายใหม่ ใจกล้า\tค21101 คณิตศาสตร์ 1\tม.2/1\t4\t1', school);
  assert.deepEqual(newTeachers, [{ key: 'ใหม่ใจกล้า', name: 'ใหม่ ใจกล้า', short: 'ครูใหม่', include: true }]);
  assert.deepEqual([rows[0].newTeacher, rows[0].subjectId, rows[0].classId, rows[0].status], ['ใหม่ใจกล้า', 's3', 'c21', 'ok']);
  assert.deepEqual([rows[1].status, rows[1].dupOf, rows[1].action, rows[1].include], ['dup', 'a1', 'skip', false]);
  assert.deepEqual([rows[2].subjectId, rows[2].perWeek, rows[2].doubles], ['s1', 4, 1]);
});

test('ภาระสอน: แถวจับไม่ได้ → status unresolved ไม่ throw (รวมข้อความขยะ)', () => {
  const { rows } = parseWorkload('ครูสมชาย\tฟิสิกส์ควอนตัม\tม.1/1\t2\nครูสมชาย\tคณิตศาสตร์ 1\tม.9/9\t2\n???\n\t\t\t', school);
  assert.equal(rows[0].status, 'unresolved');
  assert.match(rows[0].issues.join(), /ไม่พบวิชา/);
  assert.equal(rows[1].status, 'unresolved');
  assert.match(rows[1].issues.join(), /ไม่พบห้อง/);
  assert.ok(rows.every((r) => r.include === false));
  for (const junk of [null, undefined, '', 42, '\n\n', '|||', '"""', 'a\tb\tc\td\te\tf']) {
    assert.doesNotThrow(() => { parseTable(junk); parseTeachers(junk, school); parseSubjects(junk, school); parseWorkload(junk, school); parseWorkload(junk, null); });
  }
});

test('ภาระสอน: applyWorkload สร้างครูใหม่ + การสอน · merge แก้แถวเดิม · undoImport คืนสภาพ', () => {
  const d = clone(school);
  const res0 = parseWorkload('นายใหม่ ใจกล้า\tลูกเสือ\tม.1 ทุกห้อง\t1\nครูสมชาย\tภาษาไทย 1\tม.1/1\t4', d);
  res0.rows[3].action = 'merge'; // ผู้ใช้เลือก "ใช้ค่าที่วาง" แทนแถวเดิม
  const res = applyWorkload(d, res0, seqId);
  assert.equal(res.teachers.length, 1);
  assert.equal(res.assignments.length, 3);
  const nt = res.teachers[0];
  assert.ok(d.assignments.filter((a) => a.subjectId === 's3').every((a) => a.teacherId === nt && a.perWeek === 1));
  assert.deepEqual([d.assignments[0].teacherId, d.assignments[0].perWeek], ['t2', 4]);
  undoImport(d, res);
  assert.deepEqual(d, school);
});

test('ภาระสอน: ครูใหม่ที่ไม่ติ๊กสร้าง → แถวนั้นถูกข้าม', () => {
  const d = clone(school);
  const res0 = parseWorkload('นายใหม่ ใจกล้า\tลูกเสือ\tม.2/1\t1', d);
  res0.newTeachers[0].include = false;
  const res = applyWorkload(d, res0, seqId);
  assert.deepEqual([res.teachers.length, res.assignments.length], [0, 0]);
  assert.deepEqual(d, school);
});

test('ตัวอย่างรูปแบบทั้ง 3 แบบอ่านได้ไม่มีแถวสีส้มเรื่องรูปแบบ', () => {
  const d = clone(school);
  assert.ok(parseTeachers(EXAMPLES.teachers, { classes: d.classes }).rows.every((r) => r.name && r.status === 'new' && r.subjects.length));
  assert.ok(parseSubjects(EXAMPLES.subjects, d).rows.every((r) => r.code && r.name));
  const w = parseWorkload(EXAMPLES.workload, d);
  assert.equal(w.rows.length, 5);
  assert.ok(w.rows.every((r) => r.subjectId && r.classId));
});

// ---------- sanitize + merge3 ----------
test('sanitize: t.subjects whitelist · t.homeroom ต้องเป็นห้องที่มีอยู่ · solveSeed · meta', () => {
  const d = clone(school);
  d.teachers[0].subjects = ['MA', 'XX', 'MA', 3, '<img>', 'GU'];
  d.teachers[0].homeroom = 'c11';
  d.teachers[1].subjects = 'MA';
  d.teachers[1].homeroom = 'ไม่มีห้องนี้';
  d.settings = { solveSeed: '12345.9' };
  d.meta = { lastSolve: { at: 1761300000000, mode: 'missing', placed: '40', need: 42, unplaced: -1, codes: ['TEACHER_BUSY', '<b>', 5], x: 1 },
    setup: { level: 'ป', start: '08:30', homeroomTeachesCore: true, levels: ['ป.1', 'ป.2'], bad: { a: 1 }, 'bad key': 1 }, junk: '<script>' };
  store.doc = d; index();
  assert.deepEqual(d.teachers[0].subjects, ['MA', 'GU']);
  assert.equal(d.teachers[0].homeroom, 'c11');
  assert.ok(!('subjects' in d.teachers[1]) && !('homeroom' in d.teachers[1]));
  assert.equal(d.settings.solveSeed, 12345);
  assert.deepEqual(d.meta, {
    lastSolve: { at: 1761300000000, mode: 'missing', placed: 40, need: 42, unplaced: 0, codes: ['TEACHER_BUSY'] },
    setup: { level: 'ป', start: '08:30', homeroomTeachesCore: true, levels: ['ป.1', 'ป.2'] },
  });
  for (const bad of [[1, 2], 'x', 5]) { const e = clone(school); e.meta = bad; e.settings = { solveSeed: 'abc' }; store.doc = e; index(); assert.ok(!('meta' in e) && !('solveSeed' in e.settings)); }
  // ลบห้อง → homeroom หายตอน sanitize ครั้งถัดไป
  d.classes = d.classes.filter((c) => c.id !== 'c11'); store.doc = d; index();
  assert.ok(!('homeroom' in d.teachers[0]));
});

test('ข้อมูลเก่า (ไม่มีฟิลด์ใหม่) เปิดได้ ไม่เพิ่มฟิลด์ให้เอง', () => {
  const d = clone(school);
  store.doc = d; index();
  assert.ok(d.teachers.every((t) => !('subjects' in t) && !('homeroom' in t)));
  assert.ok(!('meta' in d) && !('solveSeed' in d.settings));
});

test('doc หลังนำเข้าผ่าน sanitize และ merge3 กับฉบับอีกแท็บได้ (teacher.subjects)', () => {
  const base = clone(school);
  const mine = clone(base);
  applyTeachers(mine, parseTeachers('นายมานะ ขยัน\tคณิต\tป.3', mine).rows, seqId);
  applyWorkload(mine, parseWorkload('นายมานะ ขยัน\tคณิตศาสตร์ 1\tม.1/1\t3', mine), seqId);
  mine.teachers[0].subjects = ['TH'];
  store.doc = mine; index();
  const theirs = clone(base); theirs.teachers[1].name = 'สมชาย ใจดี (แก้)';
  const { merged, clashes } = merge3(base, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged.teachers.map((t) => [t.name, t.subjects || null, t.homeroom || null]), [
    ['นางสมศรี รักเรียน', ['TH'], null], ['สมชาย ใจดี (แก้)', null, null], ['มานะ ขยัน', ['MA'], 'p3']]);
  assert.equal(merged.assignments.length, 2);
  store.doc = merged; index();
  assert.deepEqual(merged.teachers[2].subjects, ['MA']);
  assert.equal(merged.teachers[2].homeroom, 'p3');
});

test('ความเร็ว: วางภาระ 300 แถว + ครู 40 คน < 200 ms', () => {
  const d = clone(school);
  const tl = Array.from({ length: 40 }, (_, i) => `นายครู${i} สกุล${i}\tคณิต\t`).join('\n');
  const wl = Array.from({ length: 300 }, (_, i) => `ครูสมชาย\tคณิตศาสตร์ 1\tม.1/${(i % 3) + 1}\t3`).join('\n');
  const t0 = performance.now();
  assert.equal(parseTeachers(tl, d).rows.length, 40);
  assert.equal(parseWorkload(wl, d).rows.length, 300);
  assert.ok(performance.now() - t0 < 200);
});

// ---------- DELIGHT ก-1/ก-6 (24 ต.ค. 69): sanitize เพดาน perWeek · ตัดคาบที่วัน/คาบเสีย · pinned เป็นจริง/เท็จ ----------
test('ก-6 sanitize: วัน/คาบเสียถูกตัด (อาร์เรย์เดิม) · ค่าเกินช่วงตารางยังอยู่ · perWeek 999999 → 60 · pinned yes → true', () => {
  const d = clone(school);
  const a0 = d.assignments[0].id;
  d.assignments[0].perWeek = 999999; d.assignments[0].doubles = 999;
  d.placements = [
    { assignmentId: a0, day: 'abc', period: 1 }, { assignmentId: a0, day: 7, period: 9 }, { assignmentId: a0, day: 1.5, period: 0 },
    { assignmentId: a0, day: 0, period: -1 }, { assignmentId: a0, day: NaN, period: 0 }, { assignmentId: a0, day: '2', period: 1, pinned: 'yes' },
    { assignmentId: a0, day: 3, period: 0, pinned: 0 }, { assignmentId: a0, day: 4, period: 0, pinned: '0' },
  ];
  d.locks = [{ classId: null, day: 'x', period: 1, label: 'เสีย' }, { classId: null, day: 2, period: 1, label: 'ลูกเสือ' }];
  const pl = d.placements, lk = d.locks;
  store.doc = d; index();
  assert.equal(d.placements, pl, 'ต้องแก้ในอาร์เรย์เดิม');
  assert.equal(d.locks, lk);
  assert.deepEqual(d.placements.map((p) => [p.day, p.period]), [[7, 9], [2, 1], [3, 0], [4, 0]]);
  assert.equal(d.placements[1].pinned, true);
  assert.equal(d.placements[2].pinned, false);
  assert.equal(d.placements[3].pinned, false);
  assert.ok(!('pinned' in d.placements[0]), 'ไม่มี pinned = ไม่เพิ่มฟิลด์');
  assert.deepEqual(d.locks.map((l) => l.label), ['ลูกเสือ']);
  assert.equal(d.assignments[0].perWeek, 60);
  assert.equal(d.assignments[0].doubles, 30);
});

test('ก-6 เอกสารปกติ (sample 2 ไฟล์ + ภาคเรียนเก่า) ผ่าน sanitize แล้ว ตาราง/คาบล็อก/การสอน JSON เท่าเดิม', () => {
  const docs = [clone(school)];
  for (const f of ['sample-school.json', 'sample-primary.json']) docs.push(JSON.parse(readFileSync(new URL('../assets/solver/' + f, import.meta.url), 'utf8')));
  for (const d of docs) {
    const before = JSON.stringify([d.placements ?? [], d.locks ?? [], d.assignments]);   // sample ไม่มี placements = []
    store.doc = d; index();
    assert.equal(JSON.stringify([d.placements, d.locks, d.assignments]), before);
    const once = JSON.stringify(d);
    index();
    assert.equal(JSON.stringify(d), once, 'sanitize ซ้ำต้องได้ค่าเดิม');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
