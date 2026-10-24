// ทดสอบการรวมการแก้ไขเมื่อบันทึกชนกัน (409) — รัน: node htdocs/timetable/tests/merge.test.mjs
// กรณีจริงที่ต้องไม่เกิดอีก: แท็บ A จัดตารางแล้ว แท็บ B (ค้าง ไม่มีตาราง) แก้ชื่อครู → เดิมกด Cancel = ตารางที่จัดไว้หายหมด
import assert from 'node:assert/strict';
import { merge3 } from '../assets/store.js';

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

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
