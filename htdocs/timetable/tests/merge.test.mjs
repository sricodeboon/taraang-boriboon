// ทดสอบการรวมการแก้ไขเมื่อบันทึกชนกัน (409) — รัน: node htdocs/timetable/tests/merge.test.mjs
// กรณีจริงที่ต้องไม่เกิดอีก: แท็บ A จัดตารางแล้ว แท็บ B (ค้าง ไม่มีตาราง) แก้ชื่อครู → เดิมกด Cancel = ตารางที่จัดไว้หายหมด
import assert from 'node:assert/strict';
import { merge3, trimPlacements } from '../assets/store.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✔ ' + name); } catch (e) { failed++; console.log('✘ ' + name + '\n    ' + e.message); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const base = {
  term: { name: 'ภาคเรียนที่ 2/2569', days: 5, periods: [{ type: 'class' }] },
  teachers: [{ id: 't1', name: 'ครู ก' }, { id: 't2', name: 'ครู ข' }],
  assignments: [{ id: 'a1', teacherId: 't1', perWeek: 2 }, { id: 'a2', teacherId: 't2', perWeek: 1 }],
  locks: [], placements: [],
};

test('แท็บหนึ่งจัดตาราง อีกแท็บแก้ชื่อครู → ได้ทั้งสองอย่าง ไม่ถาม', () => {
  const theirs = clone(base); theirs.placements = [{ assignmentId: 'a1', day: 0, period: 0 }];
  const mine = clone(base); mine.teachers[0].name = 'ครู ก (แก้)';
  const { merged, clashes } = merge3(base, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.equal(merged.placements.length, 1);
  assert.equal(merged.teachers[0].name, 'ครู ก (แก้)');
});

test('แก้ครูคนละคนกัน → รวมรายรายการ ไม่ชน', () => {
  const theirs = clone(base); theirs.teachers[1].name = 'ครู ข (อีกที่)';
  const mine = clone(base); mine.teachers[0].name = 'ครู ก (ที่นี่)';
  const { merged, clashes } = merge3(base, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged.teachers.map((t) => t.name), ['ครู ก (ที่นี่)', 'ครู ข (อีกที่)']);
});

test('เพิ่มคนละรายการ + ลบจากอีกที่ → เก็บที่เพิ่มทั้งคู่ ลบตามอีกที่', () => {
  const theirs = clone(base); theirs.assignments = theirs.assignments.filter((a) => a.id !== 'a2'); theirs.assignments.push({ id: 'a3', teacherId: 't1', perWeek: 1 });
  const mine = clone(base); mine.assignments.push({ id: 'a4', teacherId: 't2', perWeek: 3 });
  const { merged, clashes } = merge3(base, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged.assignments.map((a) => a.id), ['a1', 'a3', 'a4']);
});

test('แก้ครูคนเดียวกันทั้งสองที่ → ชน และ prefer ตัดสินได้', () => {
  const theirs = clone(base); theirs.teachers[0].name = 'อีกที่';
  const mine = clone(base); mine.teachers[0].name = 'ที่นี่';
  assert.deepEqual(merge3(base, mine, theirs).clashes, ['teachers']);
  assert.equal(merge3(base, mine, theirs, 'mine').merged.teachers[0].name, 'ที่นี่');
  assert.equal(merge3(base, mine, theirs, 'theirs').merged.teachers[0].name, 'อีกที่');
});

test('จัดตารางทั้งสองที่ → ชนหมวดตาราง', () => {
  const theirs = clone(base); theirs.placements = [{ assignmentId: 'a1', day: 0, period: 0 }];
  const mine = clone(base); mine.placements = [{ assignmentId: 'a1', day: 1, period: 0 }];
  assert.deepEqual(merge3(base, mine, theirs).clashes, ['placements']);
});

test('ไม่มีฉบับฐาน (ข้อมูลเก่า) → ส่วนที่ต่างถือว่าชน ไม่ทิ้งเงียบ ๆ', () => {
  const theirs = clone(base); theirs.teachers[0].name = 'อีกที่';
  const { clashes } = merge3(null, clone(base), theirs);
  assert.deepEqual(clashes, ['teachers']);
});

test('กดจัดทั้งสองที่ ได้ตารางเดียวกัน → meta.lastSolve/solveSeed ไม่ถาม ใช้ผลจัดที่ใหม่กว่า', () => {
  const b0 = { ...clone(base), settings: { maxDoubles: 1 }, meta: { setup: { wizardAt: 'x' } } };
  const pl = [{ assignmentId: 'a1', day: 0, period: 0 }];
  const theirs = clone(b0); theirs.placements = pl; theirs.settings.solveSeed = 11; theirs.meta.lastSolve = { at: '2026-10-24T01:00:00.000Z', placed: 1 };
  const mine = clone(b0); mine.placements = clone(pl); mine.settings.solveSeed = 22; mine.meta.lastSolve = { at: '2026-10-24T02:00:00.000Z', placed: 1 };
  const before = JSON.stringify(mine);
  const { merged, clashes } = merge3(b0, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.equal(merged.meta.lastSolve.at, '2026-10-24T02:00:00.000Z');
  assert.equal(merged.meta.setup.wizardAt, 'x');
  assert.equal(merged.settings.solveSeed, 11);
  assert.equal(JSON.stringify(mine), before, 'ไม่แก้ object ของผู้เรียก');
});

test('settings ต่างกันมากกว่า solveSeed → ยังนับว่าชน', () => {
  const b0 = { ...clone(base), settings: { maxDoubles: 1 } };
  const theirs = clone(b0); theirs.settings.maxDoubles = 2; theirs.settings.solveSeed = 1;
  const mine = clone(b0); mine.settings.maxDoubles = 3; mine.settings.solveSeed = 2;
  assert.deepEqual(merge3(b0, mine, theirs).clashes, ['settings']);
});

// ── DELIGHT ก-7 (24 ต.ค. 69): ตาราง/คาบล็อกรวมรายช่อง แทนทั้งหมวด ──
// ห้อง 2 ห้อง ครู 2 คน — a1 (ห้อง c1 ครู t1) · a2 (ห้อง c2 ครู t2) · a3 (ห้อง c1 ครู t2)
const base2 = {
  term: { name: 'ภาคเรียนที่ 2/2569', days: 5, periods: [{ type: 'class' }, { type: 'class' }, { type: 'class' }] },
  classes: [{ id: 'c1', name: 'ป.1' }, { id: 'c2', name: 'ป.2' }],
  teachers: [{ id: 't1', name: 'ครู ก' }, { id: 't2', name: 'ครู ข' }],
  assignments: [
    { id: 'a1', classId: 'c1', teacherId: 't1', perWeek: 3 },
    { id: 'a2', classId: 'c2', teacherId: 't2', perWeek: 3 },
    { id: 'a3', classId: 'c1', teacherId: 't2', perWeek: 2 },
  ],
  locks: [], placements: [{ assignmentId: 'a1', day: 0, period: 0, pinned: true }],
};

test('ก-7 สองแท็บลากคนละคาบ (ห้องต่างกัน ไม่ชน) → ได้ทั้ง 2 คาบ ไม่ถาม', () => {
  const mine = clone(base2); mine.placements.push({ assignmentId: 'a1', day: 1, period: 0, pinned: true });
  const theirs = clone(base2); theirs.placements.push({ assignmentId: 'a2', day: 2, period: 1, pinned: true });
  const { merged, clashes } = merge3(base2, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.equal(merged.placements.length, 3);
  assert.ok(merged.placements.some((p) => p.assignmentId === 'a1' && p.day === 1));
  assert.ok(merged.placements.some((p) => p.assignmentId === 'a2' && p.day === 2));
});

test('ก-7 ลบคาบฝั่งเดียว (อีกฝั่งลากคาบอื่น) → คาบที่ลบหาย ไม่ถาม', () => {
  const mine = clone(base2); mine.placements = [];
  const theirs = clone(base2); theirs.placements.push({ assignmentId: 'a2', day: 3, period: 2, pinned: true });
  const { merged, clashes } = merge3(base2, mine, theirs);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged.placements.map((p) => p.assignmentId), ['a2']);
});

test('ก-7 ย้ายคาบเดียวกันไปคนละที่ → ชน placements · prefer ตัดสินเฉพาะการสอนนั้น', () => {
  const extra = { assignmentId: 'a2', day: 4, period: 0, pinned: true };
  const mine = clone(base2); mine.placements = [{ assignmentId: 'a1', day: 1, period: 1, pinned: true }, extra];
  const theirs = clone(base2); theirs.placements = [{ assignmentId: 'a1', day: 2, period: 2, pinned: true }];
  assert.deepEqual(merge3(base2, mine, theirs).clashes, ['placements']);
  const m = merge3(base2, mine, theirs, 'mine').merged.placements;
  const t = merge3(base2, mine, theirs, 'theirs').merged.placements;
  assert.deepEqual(m.filter((p) => p.assignmentId === 'a1').map((p) => [p.day, p.period]), [[1, 1]]);
  assert.deepEqual(t.filter((p) => p.assignmentId === 'a1').map((p) => [p.day, p.period]), [[2, 2]]);
  // คาบที่ไม่ชน (a2 ที่ฝั่งนี้เพิ่ม) อยู่ครบไม่ว่าเลือกฉบับไหน
  assert.ok(m.some((p) => p.assignmentId === 'a2') && t.some((p) => p.assignmentId === 'a2'));
});

test('ก-7 ฝั่ง A จัดอัตโนมัติ 144 คาบ + ฝั่ง B ลาก 1 คาบที่ไม่ชน → 145 ไม่ถาม', () => {
  // 6 ห้อง × 24 คาบ (การสอน 6 ต่อห้อง × 4 คาบ) จัดโดย A · B ลากการสอน z (ห้อง c7 ที่ A ไม่ได้จัด) 1 คาบ
  const b = { term: { days: 5, periods: Array.from({ length: 6 }, () => ({ type: 'class' })) }, classes: [], teachers: [], assignments: [], locks: [], placements: [] };
  for (let c = 1; c <= 7; c++) { b.classes.push({ id: 'c' + c }); b.teachers.push({ id: 't' + c }); }
  for (let c = 1; c <= 6; c++) for (let j = 0; j < 6; j++) b.assignments.push({ id: `a${c}_${j}`, classId: 'c' + c, teacherId: 't' + c, perWeek: 4 });
  b.assignments.push({ id: 'z', classId: 'c7', teacherId: 't7', perWeek: 1 });
  const A = clone(b);
  for (let c = 1; c <= 6; c++) for (let j = 0; j < 6; j++) for (let k = 0; k < 4; k++) {
    const n = j * 4 + k;   // 24 ช่องของห้อง c
    A.placements.push({ assignmentId: `a${c}_${j}`, day: n % 5, period: (n / 5) | 0 });
  }
  const B = clone(b); B.placements.push({ assignmentId: 'z', day: 0, period: 0, pinned: true });
  assert.equal(A.placements.length, 144);
  const { merged, clashes } = merge3(b, B, A);
  assert.deepEqual(clashes, []);
  assert.equal(merged.placements.length, 145);
  assert.equal(merge3(b, A, B).merged.placements.length, 145, 'สลับฝั่งก็ได้เท่ากัน');
});

test('ก-7 ลบการสอนฝั่ง A + วางคาบของมันฝั่ง B → ไม่มีคาบกำพร้า · คาบเกิน perWeek ถูกตัด (หมุดอยู่ก่อน)', () => {
  const A = clone(base2); A.assignments = A.assignments.filter((a) => a.id !== 'a3');
  const B = clone(base2); B.placements.push({ assignmentId: 'a3', day: 1, period: 2, pinned: true });
  const { merged, clashes } = merge3(base2, A, B);
  assert.deepEqual(clashes, []);
  assert.ok(!merged.placements.some((p) => p.assignmentId === 'a3'), JSON.stringify(merged.placements));
  // trimPlacements: a3 perWeek 2 วาง 3 (หมุดอยู่ท้าย) → ตัดคาบอัตโนมัติก่อน คงหมุด
  const d = { assignments: [{ id: 'a3', perWeek: 2 }], placements: [{ assignmentId: 'a3', day: 0, period: 0 }, { assignmentId: 'gone', day: 0, period: 1 }, { assignmentId: 'a3', day: 1, period: 0 }, { assignmentId: 'a3', day: 2, period: 0, pinned: true }] };
  const arr = d.placements;
  assert.equal(trimPlacements(d), 2);
  assert.equal(d.placements, arr, 'แก้ในอาร์เรย์เดิม');
  assert.deepEqual(d.placements.map((p) => [p.day, !!p.pinned]), [[0, false], [2, true]]);
});

test('ก-7 คาบที่เพิ่มคนละฝั่งชนครูเดียวกันช่องเดียวกัน (คนละการสอน) → ชน · prefer เก็บเฉพาะฝั่งที่เลือกในช่องนั้น', () => {
  const mine = clone(base2); mine.placements.push({ assignmentId: 'a2', day: 1, period: 1, pinned: true });   // ครู t2 ห้อง c2
  const theirs = clone(base2); theirs.placements.push({ assignmentId: 'a3', day: 1, period: 1, pinned: true }); // ครู t2 ห้อง c1
  assert.deepEqual(merge3(base2, mine, theirs).clashes, ['placements']);
  const ids = (pref) => merge3(base2, mine, theirs, pref).merged.placements.map((p) => p.assignmentId).sort();
  assert.deepEqual(ids('mine'), ['a1', 'a2']);
  assert.deepEqual(ids('theirs'), ['a1', 'a3']);
});

test('ก-7 คาบล็อก: เพิ่มคนละช่องสองฝั่ง → รวมทั้งคู่ · แก้ชื่อช่องเดียวกันต่างกัน → ชน locks', () => {
  const b = clone(base2); b.locks = [{ classId: null, day: 2, period: 2, label: 'ลูกเสือ' }];
  const m = clone(b); m.locks.push({ classId: 'c1', day: 0, period: 2, label: 'ชุมนุม' });
  const t = clone(b); t.locks.push({ classId: null, day: 4, period: 2, label: 'แนะแนว' });
  const r = merge3(b, m, t);
  assert.deepEqual(r.clashes, []);
  assert.equal(r.merged.locks.length, 3);
  const m2 = clone(b); m2.locks[0].label = 'ลูกเสือ-เนตรนารี';
  const t2 = clone(b); t2.locks[0].label = 'กิจกรรม';
  assert.deepEqual(merge3(b, m2, t2).clashes, ['locks']);
});

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
