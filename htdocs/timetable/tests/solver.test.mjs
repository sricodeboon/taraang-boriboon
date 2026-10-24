// ทดสอบ solver — รัน: node htdocs/timetable/tests/solver.test.mjs
// ไม่มี dependency ภายนอก (node >= 18)
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { solve, validate, score, toSolverInput, capacityCheck } from '../assets/solver/solver.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = join(here, '../assets/solver/sample-school.json');
const sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
const now = () => performance.now();

let passed = 0, failed = 0;
async function test(name, fn) {
  const t = now();
  try {
    const info = await fn();
    passed++;
    console.log(`✔ ${name} (${(now() - t).toFixed(0)} ms)${info ? '\n    ' + info : ''}`);
  } catch (e) {
    failed++;
    console.log(`✘ ${name}\n    ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e}`);
  }
}

// ── ตัวช่วย ────────────────────────────────────────────────────────────────
const clone = (x) => JSON.parse(JSON.stringify(x));
const types = (conf) => [...new Set(conf.map((c) => c.type))].sort();
function countByAssignment(placements) {
  const m = new Map();
  for (const p of placements) m.set(p.assignmentId, (m.get(p.assignmentId) || 0) + 1);
  return m;
}
/** ขยายโรงเรียนตัวอย่าง k เท่า (id ไม่ซ้ำ) — ใช้ทดสอบขนาดใหญ่ */
function scaled(k) {
  const out = clone(sample);
  for (const key of ['classes', 'teachers', 'rooms', 'subjects', 'assignments']) out[key] = [];
  out.locks = [];
  for (let i = 0; i < k; i++) {
    const s = (id) => (id === null || id === undefined ? id : `${id}_${i}`);
    out.classes.push(...sample.classes.map((c) => ({ ...c, id: s(c.id), name: `${c.name} (${i + 1})` })));
    out.teachers.push(...sample.teachers.map((t) => ({ ...t, id: s(t.id) })));
    out.rooms.push(...sample.rooms.map((r) => ({ ...r, id: s(r.id) })));
    out.subjects.push(...sample.subjects.map((x) => ({ ...x, id: s(x.id) })));
    out.assignments.push(...sample.assignments.map((a) => ({ ...a, id: s(a.id), subjectId: s(a.subjectId), classId: s(a.classId), teacherId: s(a.teacherId), roomId: s(a.roomId) })));
    out.locks.push(...sample.locks.filter((l) => l.classId !== null).map((l) => ({ ...l, classId: s(l.classId) })));
  }
  out.locks.push(...sample.locks.filter((l) => l.classId === null));
  return out;
}
/** ตรวจผลลัพธ์แบบอิสระจาก validate(): คาบคู่ติดกันไม่คร่อมพัก, ไม่ทับคาบล็อก/พัก */
function independentChecks(data, result) {
  const inp = toSolverInput(data);
  const periods = inp.periods;
  const asg = new Map(inp.assignments.map((a) => [a.id, a]));
  // ไม่ลงช่องพัก/คาบล็อก
  for (const p of result.placements) {
    assert.notEqual(periods[p.period].type, 'break', `ลงช่องพัก ${JSON.stringify(p)}`);
    const a = asg.get(p.assignmentId);
    const locked = inp.locks.some((l) => l.day === p.day && l.period === p.period && (l.classId === null || l.classId === a.classId));
    assert.ok(!locked, `ทับคาบล็อก ${JSON.stringify(p)}`);
  }
  // คาบคู่: ต้องมีคู่ติดกันครบ doubles และแต่ละคู่อยู่ในคาบเรียนที่ index ติดกันจริง (พักคั่น = ไม่ติด)
  const byA = new Map();
  for (const p of result.placements) {
    if (!byA.has(p.assignmentId)) byA.set(p.assignmentId, []);
    byA.get(p.assignmentId).push(p);
  }
  for (const a of inp.assignments) {
    if (!a.doubles) continue;
    const list = (byA.get(a.id) || []).map((p) => p.day * 100 + p.period).sort((x, y) => x - y);
    let pairs = 0;
    for (let i = 0; i + 1 < list.length; i++) {
      const x = list[i], y = list[i + 1];
      if (y === x + 1 && periods[x % 100].type !== 'break' && periods[y % 100].type !== 'break') { pairs++; i++; }
    }
    const placedAll = (byA.get(a.id) || []).length === a.perWeek;
    if (placedAll) assert.ok(pairs >= a.doubles, `งาน ${a.id} ต้องมีคาบคู่ ${a.doubles} คู่ พบ ${pairs}`);
  }
}

// ── 1) โรงเรียนตัวอย่าง ─────────────────────────────────────────────────────
let sampleResult;
await test('ข้อมูลตัวอย่าง: จัดครบ hardViolations=0 ภายใน 2 วินาที', () => {
  const r = solve(sample, { seed: 1, timeLimitMs: 4000, debugCheck: true });
  sampleResult = r;
  assert.equal(r.unplaced.length, 0, 'ต้องไม่มีคาบค้าง: ' + JSON.stringify(r.unplaced.slice(0, 3)));
  assert.equal(r.stats.hardViolations, 0);
  assert.deepEqual(validate(sample, r.placements), []);
  const cnt = countByAssignment(r.placements);
  for (const a of sample.assignments) assert.equal(cnt.get(a.id) || 0, a.perWeek, `งาน ${a.id} ต้องได้ ${a.perWeek} คาบ`);
  assert.ok(r.stats.ms < 2000, `ใช้เวลา ${r.stats.ms} ms`);
  const sc = score(sample, r.placements);
  assert.equal(sc.softScore, r.stats.softScore);
  independentChecks(sample, r);
  return `stats: ${JSON.stringify({ ms: r.stats.ms, iterations: r.stats.iterations, restarts: r.stats.restarts, softScore: r.stats.softScore, soft: r.stats.soft, placements: r.placements.length })}`;
});

await test('ข้อมูลตัวอย่าง: หลาย seed จัดครบทุกครั้ง', () => {
  const lines = [];
  for (const seed of [2, 3, 42, 2026, 99999]) {
    const r = solve(sample, { seed, timeLimitMs: 4000, debugCheck: true });
    assert.equal(r.unplaced.length, 0);
    assert.equal(r.stats.hardViolations, 0);
    independentChecks(sample, r);
    lines.push(`seed ${seed}: ${r.stats.ms} ms, ${r.stats.iterations} iter, soft ${r.stats.softScore}`);
  }
  return lines.join('\n    ');
});

// ── 2) validate จับชนทุกประเภท ─────────────────────────────────────────────
const tiny = {
  days: 2,
  periods: [{ type: 'class' }, { type: 'class' }, { type: 'break' }, { type: 'class' }, { type: 'class' }],
  classes: [{ id: 'c1' }, { id: 'c2' }],
  teachers: [{ id: 't1', maxPerDay: 2, unavailable: [[1, 4]] }, { id: 't2', maxPerDay: 6, unavailable: [] }],
  rooms: [{ id: 'r1' }],
  assignments: [
    { id: 'a1', classId: 'c1', teacherId: 't1', roomId: 'r1', perWeek: 2, doubles: 1 },
    { id: 'a2', classId: 'c2', teacherId: 't1', roomId: null, perWeek: 2, doubles: 0 },
    { id: 'a3', classId: 'c2', teacherId: 't2', roomId: 'r1', perWeek: 1, doubles: 0 },
    { id: 'a4', classId: 'c1', teacherId: 't2', roomId: null, perWeek: 2, doubles: 0 },
  ],
  locks: [{ classId: 'c1', day: 1, period: 0, label: 'ลูกเสือ' }],
  fixed: [],
};
await test('validate: ชุดที่ถูกต้องไม่มี conflict', () => {
  const ok = [
    { assignmentId: 'a1', day: 0, period: 0 }, { assignmentId: 'a1', day: 0, period: 1 },
    { assignmentId: 'a2', day: 1, period: 1 }, { assignmentId: 'a2', day: 1, period: 3 },
    { assignmentId: 'a3', day: 1, period: 4 },
    { assignmentId: 'a4', day: 0, period: 3 }, { assignmentId: 'a4', day: 1, period: 1 },
  ];
  assert.deepEqual(validate(tiny, ok), []);
});
await test('validate: จับได้ครบ 8 ประเภท', () => {
  const cases = {
    class: [{ assignmentId: 'a1', day: 0, period: 0 }, { assignmentId: 'a4', day: 0, period: 0 }],
    teacher: [{ assignmentId: 'a2', day: 0, period: 3 }, { assignmentId: 'a1', day: 0, period: 3 }],
    room: [{ assignmentId: 'a3', day: 1, period: 1 }, { assignmentId: 'a1', day: 1, period: 1 }],
    lock: [{ assignmentId: 'a4', day: 1, period: 0 }],
    break: [{ assignmentId: 'a4', day: 0, period: 2 }],
    unavailable: [{ assignmentId: 'a2', day: 1, period: 4 }],
    maxPerDay: [{ assignmentId: 'a1', day: 0, period: 0 }, { assignmentId: 'a1', day: 0, period: 1 }, { assignmentId: 'a2', day: 0, period: 3 }],
    // คาบคู่คร่อมพัก (คาบ index 1 กับ 3 มีช่องพักคั่น) = ไม่นับว่าติดกัน
    double: [{ assignmentId: 'a1', day: 0, period: 1 }, { assignmentId: 'a1', day: 0, period: 3 }],
  };
  for (const [type, pls] of Object.entries(cases)) {
    const conf = validate(tiny, pls);
    const hit = conf.filter((c) => c.type === type);
    assert.ok(hit.length >= 1, `ต้องจับ ${type} ได้ แต่ได้ ${JSON.stringify(types(conf))}`);
    for (const c of hit) {
      assert.ok(Number.isInteger(c.day) && Number.isInteger(c.period) && Array.isArray(c.ids) && c.ids.length > 0, `รูปแบบ conflict ผิด ${JSON.stringify(c)}`);
      assert.ok(typeof c.message === 'string' && c.message.length > 0);
    }
  }
  // ตรวจรายละเอียดบางตัว
  const cls = validate(tiny, cases.class).find((c) => c.type === 'class');
  assert.deepEqual([cls.day, cls.period, [...cls.ids].sort()], [0, 0, ['a1', 'a4']]);
  const mpd = validate(tiny, cases.maxPerDay).find((c) => c.type === 'maxPerDay');
  assert.deepEqual([mpd.day, mpd.period], [0, 3]); // คาบแรกที่เกินเพดาน
  // คาบคู่ที่ยังวางไม่ครบ (1 จาก 2) ยังไม่ถือว่าผิด — ผู้ใช้กำลังลากอยู่
  assert.deepEqual(validate(tiny, [{ assignmentId: 'a1', day: 0, period: 0 }]), []);
  // id เป็นตัวเลขก็ใช้ได้ และ ids คืนค่าตามชนิดเดิม
  const num = clone(tiny);
  num.assignments.forEach((a, i) => { a.id = i + 1; });
  const c2 = validate(num, [{ assignmentId: 1, day: 0, period: 0 }, { assignmentId: 4, day: 0, period: 0 }]);
  assert.deepEqual(c2.find((c) => c.type === 'class').ids.sort(), [1, 4]);
});
await test('validate: เร็วกว่า 5 ms สำหรับโรงเรียน 36 ห้อง', () => {
  const big = scaled(3);
  const r = solve(big, { seed: 5, timeLimitMs: 6000 });
  const pls = r.placements;
  // ใส่ข้อชนเพิ่มสักหน่อยให้มีงานทำ
  const bad = pls.concat(pls.slice(0, 40).map((p) => ({ ...p, period: (p.period + 1) % 9 })));
  for (let i = 0; i < 20; i++) validate(big, bad); // warm-up JIT
  const N = 200, t = now();
  for (let i = 0; i < N; i++) validate(big, bad);
  const avg = (now() - t) / N;
  assert.ok(avg < 5, `เฉลี่ย ${avg.toFixed(2)} ms`);
  return `placements ${bad.length} รายการ · เฉลี่ย ${avg.toFixed(3)} ms/ครั้ง · conflicts ${validate(big, bad).length}`;
});

// ── 3) fixed / pinned ────────────────────────────────────────────────────
await test('fixed (ปักหมุด) ไม่ถูกย้าย และจัดส่วนที่เหลือครบ', () => {
  const base = sampleResult.placements;
  // ปักหมุด 40 คาบจากผลของ seed 1 + ปักคาบเดี่ยวของวิชาคาบคู่ครึ่งหนึ่ง
  const fixed = base.filter((_, i) => i % 8 === 0).map((p) => ({ assignmentId: p.assignmentId, day: p.day, period: p.period }));
  const input = { ...toSolverInput(sample), fixed };
  const r = solve(input, { seed: 77, timeLimitMs: 4000, debugCheck: true });
  const set = new Set(r.placements.map((p) => `${p.assignmentId}|${p.day}|${p.period}`));
  for (const f of fixed) assert.ok(set.has(`${f.assignmentId}|${f.day}|${f.period}`), `หมุด ${JSON.stringify(f)} หาย`);
  assert.equal(r.placements.filter((p) => p.pinned).length, fixed.length);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.stats.hardViolations, 0);
  const cnt = countByAssignment(r.placements);
  for (const a of sample.assignments) assert.equal(cnt.get(a.id) || 0, a.perWeek);
  independentChecks(sample, r);
  return `ปักหมุด ${fixed.length} คาบ · ${r.stats.ms} ms · soft ${r.stats.softScore}`;
});
await test('fixed ที่ชนกันเอง: ไม่ย้ายหมุด และรายงานเป็น hardViolations', () => {
  const input = clone(tiny);
  input.fixed = [{ assignmentId: 'a1', day: 0, period: 0 }, { assignmentId: 'a4', day: 0, period: 0 }];
  const r = solve(input, { seed: 1, timeLimitMs: 500, debugCheck: true });
  const set = new Set(r.placements.map((p) => `${p.assignmentId}|${p.day}|${p.period}`));
  assert.ok(set.has('a1|0|0') && set.has('a4|0|0'));
  assert.ok(r.stats.hardViolations >= 1);
  assert.ok(validate(input, r.placements).every((c) => c.type === 'class' && c.day === 0 && c.period === 0), 'ข้อชนต้องมาจากหมุดเท่านั้น');
});

await test('ปักหมุดคาบคู่ไว้ครึ่งเดียว: อีกครึ่งต้องไปต่อข้างหมุด (ไม่ข้ามพัก)', () => {
  const input = clone(tiny);
  input.fixed = [{ assignmentId: 'a1', day: 0, period: 1 }];   // ช่อง index 2 คือพัก → คู่ได้เฉพาะ index 0
  const r = solve(input, { seed: 4, timeLimitMs: 500, debugCheck: true });
  const a1 = r.placements.filter((p) => p.assignmentId === 'a1').map((p) => [p.day, p.period]).sort();
  assert.deepEqual(a1, [[0, 0], [0, 1]]);
  assert.equal(r.stats.hardViolations, 0);
  assert.equal(r.unplaced.length, 0);
});

// ── 4) คาบคู่ไม่คร่อมพัก ────────────────────────────────────────────────────
await test('คาบคู่ไม่คร่อมพัก: ถ้ามีแต่ช่องที่คร่อมพัก ต้องคืน unplaced', () => {
  const input = {
    days: 1, periods: [{ type: 'class' }, { type: 'break' }, { type: 'class' }],
    classes: [{ id: 'c' }], teachers: [{ id: 't', maxPerDay: 6 }], rooms: [],
    assignments: [{ id: 'x', classId: 'c', teacherId: 't', roomId: null, perWeek: 2, doubles: 1 }], locks: [], fixed: [],
  };
  const r = solve(input, { seed: 1, timeLimitMs: 300 });
  assert.equal(r.placements.length, 0);
  assert.equal(r.unplaced.length, 1);
  assert.equal(r.unplaced[0].remaining, 2);
  assert.match(r.unplaced[0].reason, /คาบคู่/);
  return `reason: ${r.unplaced[0].reason}`;
});
await test('คาบคู่ในข้อมูลตัวอย่าง: ติดกันจริงทุกคู่ ไม่ข้ามช่องพัก', () => {
  const inp = toSolverInput(sample);
  const breakIdx = inp.periods.findIndex((p) => p.type === 'break');
  const dbl = sample.assignments.filter((a) => a.doubles > 0);
  assert.ok(dbl.length > 0);
  let n = 0;
  for (const a of dbl) {
    const ps = sampleResult.placements.filter((p) => p.assignmentId === a.id);
    const byDay = new Map();
    for (const p of ps) { if (!byDay.has(p.day)) byDay.set(p.day, []); byDay.get(p.day).push(p.period); }
    let pairs = 0;
    for (const list of byDay.values()) {
      list.sort((x, y) => x - y);
      for (let i = 0; i + 1 < list.length; i++) if (list[i + 1] === list[i] + 1) { assert.ok(list[i] !== breakIdx && list[i + 1] !== breakIdx); pairs++; i++; }
    }
    assert.ok(pairs >= a.doubles, `งาน ${a.id} คู่ ${pairs}/${a.doubles}`);
    n += pairs;
  }
  return `ตรวจ ${dbl.length} งานสอนที่มีคาบคู่ รวม ${n} คู่`;
});

// ── 5) locks ─────────────────────────────────────────────────────────────
await test('คาบล็อก (ทุกห้อง + รายห้อง) ไม่ถูกจัดทับ', () => {
  const inp = toSolverInput(sample);
  const asg = new Map(inp.assignments.map((a) => [a.id, a]));
  let checked = 0;
  for (const l of sample.locks) {
    const hit = sampleResult.placements.filter((p) => p.day === l.day && p.period === l.period && (l.classId === null || asg.get(p.assignmentId).classId === l.classId));
    assert.equal(hit.length, 0, `ทับคาบล็อก ${JSON.stringify(l)}`);
    checked++;
  }
  // ล็อกด้วย day=null (ทุกวัน) — ส่วนขยาย
  const input = clone(tiny);
  input.locks = [{ classId: null, day: null, period: 0 }];
  const r = solve(input, { seed: 3, timeLimitMs: 500 });
  assert.ok(r.placements.every((p) => p.period !== 0));
  return `ตรวจคาบล็อก ${checked} รายการ`;
});

// ── 6) infeasible ────────────────────────────────────────────────────────
await test('infeasible (ห้องเรียนคาบเกิน): คืน unplaced พร้อมเหตุผล ไม่ค้าง', () => {
  const data = clone(sample);
  data.assignments.push({ id: 'extra', subjectId: data.subjects[0].id, classId: 'c11', teacherId: 't1', roomId: null, perWeek: 8, doubles: 0 });
  const t = now();
  const r = solve(data, { seed: 1, timeLimitMs: 3000, debugCheck: true });
  const el = now() - t;
  assert.ok(el < 3300, `ใช้เวลา ${el}`);
  assert.ok(r.unplaced.length > 0);
  const miss = r.unplaced.reduce((s, u) => s + u.remaining, 0);
  // ม.1/1 มีคาบว่าง 36 (หลังหักคาบล็อก) · ความต้องการคำนวณจากข้อมูลตัวอย่าง (ปรับตามหลักสูตรแล้ว 31 คาบ) + 8 → ค้าง 3 คาบ
  const need = sample.assignments.filter((a) => a.classId === 'c11').reduce((n, a) => n + a.perWeek, 0) + 8;
  assert.equal(miss, need - 36, `ม.1/1 มีคาบว่าง 36 ต้องการ ${need} → ค้าง ${need - 36} คาบ`);
  for (const u of r.unplaced) assert.ok(typeof u.reason === 'string' && u.reason.length > 5);
  assert.ok(r.unplaced.some((u) => /คาบว่างเพียง/.test(u.reason)), JSON.stringify(r.unplaced));
  assert.equal(r.stats.hardViolations, 0, 'สิ่งที่วางแล้วต้องไม่ชน');
  return `${el.toFixed(0)} ms · unplaced ${JSON.stringify(r.unplaced)}`;
});
await test('infeasible (ครูไม่ว่างทุกคาบ / ครูสอนเกินที่ว่าง): มีเหตุผลเฉพาะ', () => {
  const input = clone(tiny);
  input.teachers[1].unavailable = [];
  for (let d = 0; d < 2; d++) for (let p = 0; p < 5; p++) input.teachers[1].unavailable.push([d, p]);
  const r = solve(input, { seed: 1, timeLimitMs: 500 });
  const u3 = r.unplaced.find((u) => u.assignmentId === 'a3');
  assert.ok(u3 && /ครูว่าง/.test(u3.reason), JSON.stringify(r.unplaced));
  const input2 = clone(tiny);
  input2.assignments[1].perWeek = 6; // t1 สอนได้วันละ 2 × 2 วัน = 4 แต่ต้องสอน 2+6
  const r2 = solve(input2, { seed: 1, timeLimitMs: 500 });
  assert.ok(r2.unplaced.length > 0);
  assert.ok(r2.unplaced.some((u) => /สอนได้สูงสุด/.test(u.reason)), JSON.stringify(r2.unplaced));
  assert.equal(r2.stats.hardViolations, 0);
  return r2.unplaced.map((u) => `${u.assignmentId}×${u.remaining}: ${u.reason}`).join('\n    ');
});
await test('input ว่าง/เสีย ไม่ throw', () => {
  for (const x of [null, {}, { days: 5, periods: [] }, { days: 0, periods: [{ type: 'class' }], classes: [{ id: 1 }] }]) {
    const r = solve(x, { timeLimitMs: 100 });
    assert.ok(Array.isArray(r.placements) && Array.isArray(r.unplaced) && r.stats);
    assert.ok(Array.isArray(validate(x, [])));
  }
  const r = solve({ ...tiny, assignments: [...tiny.assignments, { id: 'z', classId: 'nope', teacherId: 't1', perWeek: 2 }] }, { timeLimitMs: 300 });
  assert.ok(r.unplaced.some((u) => u.assignmentId === 'z'));
});

// ── 7) timeLimit ─────────────────────────────────────────────────────────
await test('timeLimit ได้รับการเคารพ (โรงเรียนใหญ่ 48 ห้อง, จำกัด 300 ms)', () => {
  const big = scaled(4);
  const t = now();
  const r = solve(big, { seed: 1, timeLimitMs: 300, effort: 5 });
  const el = now() - t;
  assert.ok(el < 300 + 150, `ใช้ ${el.toFixed(0)} ms`);
  return `ใช้จริง ${el.toFixed(0)} ms (ในตัว ${r.stats.ms} ms) · timedOut=${r.stats.timedOut} · unplaced ${r.stats.unplacedPeriods} คาบ · hard ${r.stats.hardViolations}`;
});

// ── 8) deterministic ─────────────────────────────────────────────────────
await test('deterministic: seed เดียวกันได้ผลเหมือนเดิม', () => {
  const a = solve(sample, { seed: 7, timeLimitMs: 10000 });
  const b = solve(sample, { seed: 7, timeLimitMs: 10000 });
  assert.ok(!a.stats.timedOut && !b.stats.timedOut);
  assert.deepEqual(a.placements, b.placements);
  assert.equal(a.stats.iterations, b.stats.iterations);
  const c = solve(sample, { seed: 8, timeLimitMs: 10000 });
  assert.notDeepEqual(a.placements, c.placements);
  return `seed 7: iter ${a.stats.iterations} soft ${a.stats.softScore} · seed 8: soft ${c.stats.softScore}`;
});

// ── 9) ขนาดใหญ่ ──────────────────────────────────────────────────────────
await test('ขนาดใหญ่: 36 ห้อง 60 ครู จัดครบ', () => {
  const big = scaled(3);
  const r = solve(big, { seed: 1, timeLimitMs: 8000, debugCheck: true });
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.stats.hardViolations, 0);
  independentChecks(big, r);
  return `${big.classes.length} ห้อง ${big.teachers.length} ครู ${big.assignments.length} งานสอน · ${r.stats.ms} ms · ${r.stats.iterations} iter · soft ${r.stats.softScore} ${JSON.stringify(r.stats.soft)}`;
});
await test('ขนาดใหญ่: 40 ห้อง 60 ครู (ครูภาระหนักขึ้น) จัดครบ', () => {
  const big = scaled(3);
  // เพิ่มอีก 4 ห้อง (ม.1, ม.2) โดยใช้ครู 60 คนเดิม เลือกสำเนาครูที่ภาระ/ความจุต่ำสุด และให้สอนได้วันละ 6 คาบ
  big.teachers.forEach((t) => { t.maxPerDay = Math.max(t.maxPerDay, 6); });
  const load = new Map();
  for (const a of big.assignments) load.set(a.teacherId, (load.get(a.teacherId) || 0) + a.perWeek);
  for (const cid of ['c11', 'c12', 'c21', 'c22']) {
    const nid = `${cid}_x`;
    big.classes.push({ id: nid, name: `${cid}-เพิ่ม`, level: 'ม.x' });
    for (const a of sample.assignments.filter((x) => x.classId === cid)) {
      const tid = [0, 1, 2].map((i) => `${a.teacherId}_${i}`).sort((x, y) => load.get(x) - load.get(y) || (x < y ? -1 : 1))[0];
      load.set(tid, load.get(tid) + a.perWeek);
      big.assignments.push({ ...a, id: `${a.id}_x`, classId: nid, subjectId: `${a.subjectId}_0`, teacherId: tid, roomId: a.roomId ? `${a.roomId}_${tid.split('_')[1]}` : null });
    }
  }
  const r = solve(big, { seed: 1, timeLimitMs: 8000, debugCheck: true });
  assert.equal(r.stats.hardViolations, 0);
  assert.equal(r.unplaced.length, 0, JSON.stringify(r.unplaced.slice(0, 3)));
  independentChecks(big, r);
  const maxLoad = Math.max(...load.values());
  return `${big.classes.length} ห้อง ${big.teachers.length} ครู ${big.assignments.length} งานสอน (ครูภาระสูงสุด ${maxLoad} คาบ/สัปดาห์) · ${r.stats.ms} ms · ${r.stats.iterations} iter · restarts ${r.stats.restarts} · soft ${r.stats.softScore}`;
});

// ── 10) worker ───────────────────────────────────────────────────────────
await test('solver.worker.js: ส่ง progress และ done ตามสัญญา', async () => {
  const msgs = [];
  globalThis.self = { postMessage: (m) => msgs.push(m) };
  await import('../assets/solver/solver.worker.js');
  // onmessage เป็น async แล้ว (รอ import solver.js แบบมีเวอร์ชัน)
  await self.onmessage({ data: { type: 'solve', input: sample, options: { timeLimitMs: 4000, seed: 1 } } });
  const done = msgs.find((m) => m.type === 'done');
  assert.ok(done && done.result && Array.isArray(done.result.placements));
  assert.equal(done.result.unplaced.length, 0);
  const prog = msgs.filter((m) => m.type === 'progress');
  assert.ok(prog.length >= 2, 'ต้องมี progress');
  for (const p of prog) assert.ok(p.pct >= 0 && p.pct <= 1 && p.best && typeof p.best === 'object');
  assert.equal(prog[prog.length - 1].pct, 1);
  await self.onmessage({ data: { type: 'validate', input: tiny, placements: [{ assignmentId: 'a4', day: 0, period: 2 }] } });
  assert.equal(msgs.at(-1).type, 'validated');
  assert.equal(msgs.at(-1).conflicts[0].type, 'break');
  delete globalThis.self;
  return `progress ${prog.length} ครั้ง`;
});

// ── กรณีผู้ใช้จริงคนแรก (28 ก.ย. 69): ประถมเล็ก ป.1–ป.6 ครู 9 ไม่มีห้องพิเศษ 78 วิชา 75 งานสอน ล็อก 3 ──
// ตารางว่าง 5 วัน 8 คาบ (แม่แบบ blank) + ข้อมูลกรอกเองจากตัวอย่างประถม — ต้องจัดได้ครบ และกรณีข้อมูลผิดต้องวางเท่าที่ได้พร้อมเหตุผล
const primary = JSON.parse(readFileSync(join(here, '../assets/solver/sample-primary.json'), 'utf8'));
function firstUserCase() {
  const d = clone(primary);
  const times = [0, 1, 2, 3, 'b', 4, 5, 6, 7];
  d.term = { name: 'ภาคเรียนที่ 2/2569', days: 5, periods: times.map((x) => (x === 'b' ? { label: 'พักกลางวัน', type: 'break' } : { label: String(x + 1), type: 'class' })) };
  d.rooms = [];
  for (const a of d.assignments) a.roomId = null;
  for (let i = 0; i < 6; i++) d.subjects.push({ id: 'sx' + i, code: '', name: 'วิชาใหม่', color: '#7FB0E8' });
  for (let i = 0; i < 3; i++) d.assignments.push({ id: 'ax' + i, subjectId: 'sx' + i, classId: d.classes[i].id, teacherId: d.teachers[i].id, roomId: null, perWeek: 1, doubles: 0 });
  d.locks = [[2, 7], [3, 8], [4, 8]].map(([day, period]) => ({ classId: null, day, period, label: 'กิจกรรม' }));
  d.placements = [];
  return d;
}
const perWeekTotal = (d) => d.assignments.reduce((s, a) => s + a.perWeek, 0);

await test('ผู้ใช้จริง: ประถม 6 ห้อง ครู 9 ห้องพิเศษ 0 วิชา 78 งานสอน 75 ล็อก 3 → จัดครบไม่ชน', () => {
  const d = firstUserCase();
  assert.equal(d.rooms.length, 0); assert.equal(d.subjects.length, 78); assert.equal(d.assignments.length, 75); assert.equal(d.locks.length, 3);
  const r = solve(toSolverInput(d), { timeLimitMs: 4000, seed: 3 });
  assert.equal(r.stats.unplacedPeriods, 0, JSON.stringify(r.unplaced.slice(0, 3)));
  assert.equal(r.placements.length, perWeekTotal(d));
  assert.equal(validate(toSolverInput(d), r.placements).length, 0);
  independentChecks(d, r);
  return `${r.placements.length} คาบ ${r.stats.ms} ms`;
});

await test('ผู้ใช้จริง: ไม่ได้เปลี่ยนช่องครู (ทุกงานสอนเป็นครูคนแรก) → วางเท่าที่ได้ + บอกเหตุผลภาระครู', () => {
  const d = firstUserCase();
  for (const a of d.assignments) a.teacherId = d.teachers[0].id;
  const r = solve(toSolverInput(d), { timeLimitMs: 3000, seed: 3 });
  assert.ok(r.placements.length > 0, 'ต้องวางได้บางส่วน ไม่ใช่ 0');
  assert.equal(validate(toSolverInput(d), r.placements).length, 0);
  assert.equal(r.placements.length + r.stats.unplacedPeriods, perWeekTotal(d));
  assert.ok(r.unplaced.every((u) => /ต้องสอน \d+ คาบ\/สัปดาห์ แต่สอนได้สูงสุด/.test(u.reason)), r.unplaced[0]?.reason);
  return `วาง ${r.placements.length} · ค้าง ${r.stats.unplacedPeriods} · "${r.unplaced[0].reason}"`;
});

await test('ผู้ใช้จริง: ชั่วโมงรวมของห้องเกินคาบในสัปดาห์ → เหตุผลระบุห้องและจำนวนคาบ', () => {
  const d = firstUserCase();
  for (const a of d.assignments.filter((x) => x.classId === d.classes[0].id)) a.perWeek += 2;
  const r = solve(toSolverInput(d), { timeLimitMs: 3000, seed: 3 });
  assert.ok(r.placements.length > 0);
  assert.equal(validate(toSolverInput(d), r.placements).length, 0);
  assert.ok(r.unplaced.some((u) => new RegExp(`${d.classes[0].name} ต้องเรียนรวม \\d+ คาบ/สัปดาห์ แต่มีคาบว่างเพียง 37 คาบ`).test(u.reason)), r.unplaced.map((u) => u.reason).join(' | '));
  return r.unplaced[0].reason;
});

await test('ผู้ใช้จริง: ครูไม่ว่างทุกช่อง (กดช่องแดงผิดความหมาย) → 0 คาบ คืนผลเร็ว พร้อมเหตุผล', () => {
  const d = firstUserCase();
  for (const t of d.teachers) t.unavailable = [...Array(5).keys()].flatMap((x) => [...Array(9).keys()].map((y) => [x, y]));
  const r = solve(toSolverInput(d), { timeLimitMs: 3000, seed: 3 });
  assert.equal(r.placements.length, 0);
  assert.equal(r.stats.unplacedPeriods, perWeekTotal(d));
  assert.ok(r.stats.ms < 500, `ช้าไป ${r.stats.ms} ms`);
  assert.ok(r.unplaced.every((u) => u.reason.includes('ไม่มีคาบที่ครูว่าง')));
});

await test('ผู้ใช้จริง: งานสอนที่ยังไม่มีครู/อ้างครูที่ถูกลบ → ไม่ล้ม ยังจัดส่วนอื่นได้', () => {
  const d = firstUserCase();
  d.assignments[0].teacherId = null;
  d.assignments[1].teacherId = 't-ถูกลบ';
  d.assignments[2].classId = 'c-ถูกลบ';
  const r = solve(toSolverInput(d), { timeLimitMs: 3000, seed: 3 });
  assert.ok(r.placements.length >= perWeekTotal(d) - d.assignments[2].perWeek - 2);
  assert.ok(r.unplaced.some((u) => u.assignmentId === d.assignments[2].id && /ไม่พบห้องเรียน/.test(u.reason)));
  assert.ok(r.stats.warnings.some((w) => w.includes('ครูที่ไม่พบ')));
});

// ── WP0: solverInput ส่ง subjectId/label · WP6: รหัสเหตุผล + capacityCheck + ปุ่มแก้ให้เลย ─────────────
const CODES = new Set(['CLASS_OVER', 'TEACHER_OVER', 'TEACHER_MAX_DAY', 'ROOM_OVER', 'DOUBLE_NO_SLOT', 'BLOCKED_TEACHER', 'BLOCKED_ROOM', 'BLOCKED_CLASS',
  'NO_TEACHER', 'BAD_DATA', 'CROWDED_TEACHER', 'CROWDED_ROOM', 'CROWDED_CLASS', 'CROWDED_MAX_DAY']);
const assertCoded = (r) => {
  for (const u of r.unplaced) {
    assert.ok(CODES.has(u.code), `ไม่มี code: ${JSON.stringify(u)}`);
    assert.ok(u.params && typeof u.params === 'object', JSON.stringify(u));
    assert.ok(typeof u.reason === 'string' && u.reason.length > 5);
  }
};
/** ห้องเดียว 5 วัน 6 คาบ: วิชา s1 แบ่งสอน 3+2 คาบ (2 ครู) + วิชาอื่นเติมให้แน่นพอประมาณ */
function splitCase(withSubject = true) {
  const asg = [
    { id: 'p1', subjectId: 's1', classId: 'c1', teacherId: 't1', perWeek: 3 },
    { id: 'p2', subjectId: 's1', classId: 'c1', teacherId: 't2', perWeek: 2 },
    { id: 'q1', subjectId: 's2', classId: 'c1', teacherId: 't1', perWeek: 4 },
    { id: 'q2', subjectId: 's3', classId: 'c1', teacherId: 't2', perWeek: 4 },
  ];
  if (!withSubject) for (const a of asg) delete a.subjectId;
  return { days: 5, periods: Array(6).fill({ type: 'class' }), classes: [{ id: 'c1' }], teachers: [{ id: 't1', maxPerDay: 6 }, { id: 't2', maxPerDay: 6 }], rooms: [], assignments: asg, locks: [], fixed: [] };
}

await test('WP0 แบ่งสอน 3+2 คาบวิชาเดียวกัน 2 ครู → ไม่ลงวันเดียวกันเมื่อมีช่องพอ (soft sameDay = 0)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const inp = splitCase();
    const r = solve(inp, { seed, timeLimitMs: 1500 });
    assert.equal(r.unplaced.length, 0);
    const days = r.placements.filter((p) => p.assignmentId === 'p1' || p.assignmentId === 'p2').map((p) => p.day);
    assert.equal(new Set(days).size, 5, `seed ${seed}: s1 ลงซ้ำวัน ${days}`);
    assert.equal(score(inp, r.placements).sameDay, 0);
  }
  // ไม่มี subjectId (บั๊กเดิม): solver มองเป็นคนละวิชา จึงนับ sameDay ไม่ได้ — ยืนยันว่ากลุ่มมาจาก subjectId จริง
  const noSub = splitCase(false);
  const pl = [0, 1, 2].map((d) => ({ assignmentId: 'p1', day: d, period: 0 })).concat([0, 1].map((d) => ({ assignmentId: 'p2', day: d, period: 1 })));
  assert.equal(score(noSub, pl).sameDay, 0);
  assert.equal(score(splitCase(), pl).sameDay, 2);
});

// board.js ใช้ใน node ได้ด้วย DOM จำลองขั้นต่ำ (ไม่มี window.load → ตัวตรวจ solver โหลดเมื่อ readyState = complete)
globalThis.document = { readyState: 'complete', addEventListener() {}, dispatchEvent() {} };
globalThis.window = { addEventListener() {} };
const board = await import('../assets/board.js');
const { store, index } = await import('../assets/store.js');
const useDoc = (d) => { store.doc = d; index(); return d; };
await new Promise((r) => setTimeout(r, 400));        // validate() โหลดหลัง 300 ms
useDoc(firstUserCase());
board.readiness();                                    // เริ่มโหลด capacityCheck (ต่อจาก validate)
await new Promise((r) => setTimeout(r, 50));

await test('WP0 solverInput: ส่ง subjectId ของการสอน และ label ของคาบล็อก → ข้อความชนบอกชื่อกิจกรรม', () => {
  const d = useDoc(firstUserCase());
  d.locks.push({ classId: d.classes[0].id, day: 0, period: 0, label: 'ลูกเสือ' });
  index();
  const inp = board.solverInput(false);
  assert.ok(inp.assignments.every((a) => a.subjectId === store.doc.assignments.find((x) => x.id === a.id).subjectId));
  assert.ok(inp.locks.some((l) => l.label === 'ลูกเสือ'));
  const a = d.assignments.find((x) => x.classId === d.classes[0].id);
  const conf = validate(inp, [{ assignmentId: a.id, day: 0, period: 0 }]);
  assert.ok(conf.some((c) => c.type === 'lock' && c.message.includes('ลูกเสือ')), JSON.stringify(conf));
  return conf.find((c) => c.type === 'lock').message;
});

await test('WP6 ทุกเคส infeasible มี code + params (reason เดิมไม่เปลี่ยน)', () => {
  const cases = [];
  const d1 = clone(sample);
  d1.assignments.push({ id: 'extra', subjectId: d1.subjects[0].id, classId: 'c11', teacherId: 't1', roomId: null, perWeek: 8, doubles: 0 });
  cases.push(['ห้องเกิน', d1, 'CLASS_OVER']);
  const t1 = clone(tiny); t1.teachers[1].unavailable = [];
  for (let d = 0; d < 2; d++) for (let p = 0; p < 5; p++) t1.teachers[1].unavailable.push([d, p]);
  cases.push(['ครูไม่ว่างทุกคาบ', t1, 'BLOCKED_TEACHER']);
  const t2 = clone(tiny); t2.assignments[1].perWeek = 6;
  cases.push(['ครูสอนเกิน (เพิ่มเพดานอย่างเดียวไม่พอ)', t2, 'TEACHER_OVER']);
  cases.push(['คาบคู่คร่อมพัก', {
    days: 1, periods: [{ type: 'class' }, { type: 'break' }, { type: 'class' }], classes: [{ id: 'c' }], teachers: [{ id: 't', maxPerDay: 6 }], rooms: [],
    assignments: [{ id: 'x', classId: 'c', teacherId: 't', roomId: null, perWeek: 2, doubles: 1 }], locks: [], fixed: [],
  }, 'DOUBLE_NO_SLOT']);
  const u1 = firstUserCase(); for (const a of u1.assignments) a.teacherId = u1.teachers[0].id;
  cases.push(['ผู้ใช้จริง: ครูคนแรกทุกวิชา', toSolverInput(u1), 'TEACHER_OVER']);
  const u2 = firstUserCase(); for (const a of u2.assignments.filter((x) => x.classId === u2.classes[0].id)) a.perWeek += 2;
  cases.push(['ผู้ใช้จริง: ห้องเกิน', toSolverInput(u2), 'CLASS_OVER']);
  const u3 = firstUserCase(); for (const t of u3.teachers) t.unavailable = [...Array(5).keys()].flatMap((x) => [...Array(9).keys()].map((y) => [x, y]));
  cases.push(['ผู้ใช้จริง: ไม่ว่างทุกช่อง', toSolverInput(u3), 'BLOCKED_TEACHER']);
  const u4 = firstUserCase(); u4.assignments[2].classId = 'c-ถูกลบ';
  cases.push(['ห้องที่ถูกลบ', toSolverInput(u4), 'BAD_DATA']);
  const t3 = clone(tiny); t3.teachers[0].maxPerDay = 1;
  cases.push(['เพดาน 1 คาบ/วัน กับคาบคู่', t3, 'TEACHER_MAX_DAY']);
  const t4 = clone(tiny); t4.fixed = [{ assignmentId: 'a1', day: 1, period: 1 }]; t4.locks.push({ classId: 'c1', day: 1, period: 0, label: 'x' });
  cases.push(['คาบคู่ปักหมุดครึ่งเดียว ข้างหมุดติดล็อก', t4, 'DOUBLE_NO_SLOT']);
  const lines = [];
  for (const [name, inp, want] of cases) {
    const r = solve(inp, { seed: 1, timeLimitMs: 1500 });
    assert.ok(r.unplaced.length > 0, name);
    assertCoded(r);
    assert.ok(r.unplaced.some((u) => u.code === want), `${name}: ต้องมี ${want} ได้ ${r.unplaced.map((u) => u.code)}`);
    lines.push(`${name}: ${[...new Set(r.unplaced.map((u) => u.code))].join(', ')}`);
  }
  const pinned = cases.at(-1)[1];
  assert.ok(solve(pinned, { seed: 1, timeLimitMs: 500 }).unplaced.some((u) => u.params.pinnedHalf), 'คู่หูหมุดต้องมี pinnedHalf');
  return lines.join('\n    ');
});

/** 3 ห้อง 5 วัน 6 คาบ ครู t1 สอนห้องละ 4 คาบ (12) แต่สอนได้วันละ 2 (10) */
function maxDayCase() {
  return {
    days: 5, periods: Array(6).fill({ type: 'class' }), classes: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    teachers: [{ id: 't1', name: 'ครูหนึ่ง', maxPerDay: 2 }, { id: 't2', maxPerDay: 6 }], rooms: [],
    assignments: [1, 2, 3].map((i) => ({ id: 'm' + i, subjectId: 's1', classId: 'c' + i, teacherId: 't1', perWeek: 4 }))
      .concat([1, 2, 3].map((i) => ({ id: 'n' + i, subjectId: 's2', classId: 'c' + i, teacherId: 't2', perWeek: 2 }))),
    locks: [], fixed: [],
  };
}
await test('WP6 TEACHER_MAX_DAY.params.minNeeded ถูกต้อง: ตั้งค่านั้นแล้วจัดครบ ค่าน้อยกว่าไม่พอ', () => {
  const inp = maxDayCase();
  const r = solve(inp, { seed: 1, timeLimitMs: 1000 });
  const u = r.unplaced.find((x) => x.code === 'TEACHER_MAX_DAY');
  assert.ok(u, JSON.stringify(r.unplaced));
  assert.match(u.reason, /ต้องสอน 12 คาบ\/สัปดาห์ แต่สอนได้สูงสุด 10 คาบ/);
  assert.deepEqual(u.params, { teacherId: 't1', maxPerDay: 2, minNeeded: 3, need: 12, free: 10 });
  const ok = clone(inp); ok.teachers[0].maxPerDay = u.params.minNeeded;
  const r2 = solve(ok, { seed: 1, timeLimitMs: 2000 });
  assert.equal(r2.unplaced.length, 0, JSON.stringify(r2.unplaced));
  assert.equal(r2.stats.hardViolations, 0);
  // ครูไม่ว่างบางวัน: ต้องเพิ่มเพดานมากขึ้น (วันที่ไม่ว่างไม่ช่วย)
  const busy = clone(inp); busy.teachers[0].unavailable = [...Array(6).keys()].flatMap((p) => [[0, p], [1, p]]);
  const ub = solve(busy, { seed: 1, timeLimitMs: 1000 }).unplaced.find((x) => x.code === 'TEACHER_MAX_DAY');
  assert.equal(ub.params.minNeeded, 4); // 3 วัน × 4 = 12
  const ok2 = clone(busy); ok2.teachers[0].maxPerDay = 4;
  assert.equal(solve(ok2, { seed: 1, timeLimitMs: 2000 }).unplaced.length, 0);
  // ไม่ว่างจนเพิ่มเพดานอย่างเดียวไม่พอ → TEACHER_OVER
  const full = clone(inp); full.teachers[0].unavailable = [...Array(6).keys()].flatMap((p) => [[0, p], [1, p], [2, p], [3, p]]);
  const uf = solve(full, { seed: 1, timeLimitMs: 1000 }).unplaced.find((x) => x.params.teacherId === 't1');
  assert.equal(uf.code, 'TEACHER_OVER');
  assert.deepEqual(uf.params, { teacherId: 't1', need: 12, free: 2, maxPerDay: 2, unavail: 24 });
});

await test('WP6 capacityCheck ให้ตัวเลขและข้อความเท่า solve().unplaced ในเคสความจุ', () => {
  const d1 = clone(sample);
  d1.assignments.push({ id: 'extra', subjectId: d1.subjects[0].id, classId: 'c11', teacherId: 't1', roomId: null, perWeek: 8, doubles: 0 });
  const u2 = firstUserCase(); for (const a of u2.assignments) a.teacherId = u2.teachers[0].id;
  const rm = clone(tiny); rm.assignments[2].perWeek = 9; // r1 ใช้ 2 + 9 = 11 > 8 ช่อง
  for (const inp of [d1, toSolverInput(u2), maxDayCase(), rm]) {
    const r = solve(inp, { seed: 1, timeLimitMs: 1500 });
    const cc = capacityCheck(inp).issues;
    for (const u of r.unplaced.filter((x) => /OVER|MAX_DAY/.test(x.code) && !x.code.startsWith('CROWDED'))) {
      const hit = cc.find((x) => x.code === u.code && JSON.stringify(x.params) === JSON.stringify(u.params));
      assert.ok(hit, `capacityCheck ไม่มี ${u.code} ${JSON.stringify(u.params)} · มี ${JSON.stringify(cc)}`);
      assert.equal(hit.text, u.reason);
    }
  }
  assert.ok(capacityCheck(rm).issues.some((x) => x.code === 'ROOM_OVER' && x.params.need === 11 && x.params.free === 8));
  assert.deepEqual(capacityCheck(sample).issues, []);
});

await test('WP6 capacityCheck กับ input ว่าง/เสีย/อ้าง id ที่ถูกลบ → ไม่ throw', () => {
  for (const x of [null, undefined, {}, [], 'x', { days: 5, periods: [] }, { days: 0, periods: [{ type: 'class' }], classes: [{ id: 1 }] },
    { days: 5, periods: [{ type: 'class' }], classes: [null], teachers: [null], assignments: [null, {}, { id: 'a', classId: 'nope', perWeek: 3 }] }]) {
    const r = capacityCheck(x);
    assert.ok(Array.isArray(r.issues));
  }
  const bad = clone(tiny);
  bad.assignments.push({ id: 'z1', classId: 'ลบแล้ว', teacherId: 't1', perWeek: 2 }, { id: 'z2', classId: 'c1', teacherId: 'ลบแล้ว', perWeek: 1 },
    { id: 'z3', classId: 'c2', teacherId: null, perWeek: 1 }, { id: 'z4', classId: 'c2', teacherId: 't2', roomId: 'ลบแล้ว', perWeek: 1 });
  bad.fixed = [{ assignmentId: 'ไม่มี', day: 0, period: 0 }, { assignmentId: 'a1', day: 9, period: 9 }];
  bad.locks.push({ classId: 'ลบแล้ว', day: 0, period: 0 });
  const codes = capacityCheck(bad).issues.map((x) => x.code);
  assert.ok(codes.includes('BAD_DATA') && codes.includes('NO_TEACHER'), codes.join());
  assertCoded(solve(bad, { seed: 1, timeLimitMs: 300 }));
});

await test('WP6 readiness ใช้ capacityCheck: ครูภาระเกิน → ปุ่ม "เพิ่มเป็น 7" → แก้แล้วพร้อมจัด จัดครบ → เลิกทำคืนค่า 6', () => {
  const d = firstUserCase();
  const t = d.teachers[0];
  t.maxPerDay = 6;
  // ให้ครูคนแรกรับแถวของครูคนที่สองเพิ่ม จนต้องสอนเกิน 30 คาบ (5 วัน × 6) แต่ไม่เกิน 35
  const mine = () => d.assignments.filter((a) => a.teacherId === t.id).reduce((s, a) => s + a.perWeek, 0);
  for (const a of d.assignments) if (a.teacherId !== t.id && mine() <= 30 && mine() + a.perWeek <= 33) a.teacherId = t.id;
  useDoc(d);
  const need = mine();
  assert.ok(need > 30 && need <= 35, `ภาระ ${need}`);
  const issues = board.readiness();
  const it = issues.find((x) => x.code === 'TEACHER_MAX_DAY' && x.params.teacherId === t.id);
  assert.ok(it, JSON.stringify(issues));
  assert.match(it.text, /รวมคาบไม่ว่างและเพดานต่อวัน/, 'ต้องเป็นข้อความจาก capacityCheck (solver โหลดแล้ว)');
  const acts = board.fixActions(it.code, it.params);
  const fix = acts.find((a) => a.label === 'เพิ่มเป็น 7');
  assert.ok(fix, acts.map((a) => a.label).join());
  const res = fix.run(store.doc); index();
  assert.equal(t.maxPerDay, 7);
  assert.ok(!board.readiness().some((x) => x.params?.teacherId === t.id), 'แก้แล้วต้องไม่ขึ้นปัญหาครูคนนี้');
  const r = solve(board.solverInput(true), { seed: 3, timeLimitMs: 4000 });
  assert.ok(!r.unplaced.some((u) => idx2(u) === t.id), JSON.stringify(r.unplaced.slice(0, 2)));
  res.undo(store.doc); index();
  assert.equal(t.maxPerDay, 6);
  return `ภาระ ${need} คาบ · "${it.fix}" · จัดหลังแก้ ค้าง ${r.stats.unplacedPeriods} คาบ`;
  function idx2(u) { return store.doc.assignments.find((a) => a.id === u.assignmentId)?.teacherId; }
});

await test('WP6 ปุ่มแก้: เพิ่ม 1 คาบ/วัน (ห้องเกิน) · ลดคาบคู่ · แบ่งวิชาให้ครูอื่น · ไปเติมครู — ทุกปุ่มเลิกทำได้', () => {
  // ห้องเกิน → เพิ่มคาบท้ายวัน (ต่อเวลาจากคาบสุดท้าย) แล้วเลิกทำ
  const d = firstUserCase();
  for (const a of d.assignments.filter((x) => x.classId === d.classes[0].id)) a.perWeek += 1;
  d.term.periods.forEach((p, i) => { p.start = `${String(8 + i).padStart(2, '0')}:00`; p.end = `${String(9 + i).padStart(2, '0')}:00`; });
  useDoc(d);
  const co = board.readiness().find((x) => x.code === 'CLASS_OVER');
  assert.ok(co);
  const add = board.fixActions(co.code, co.params).find((a) => a.run);
  assert.match(add.label, /เพิ่ม 1 คาบ\/วัน/);
  const n0 = d.term.periods.length;
  const r1 = add.run(store.doc); index();
  assert.equal(d.term.periods.length, n0 + 1);
  assert.deepEqual(d.term.periods.at(-1), { label: '9', start: '17:00', end: '18:00', type: 'class' });
  assert.ok(!board.readiness().some((x) => x.code === 'CLASS_OVER'), 'เพิ่มคาบแล้วห้องต้องพอ');
  r1.undo(store.doc); index();
  assert.equal(d.term.periods.length, n0);
  assert.ok(board.fixActions('CLASS_OVER', co.params).some((a) => a.go?.tab === 'periods'));

  // คาบคู่ไม่พอ → ลดคาบคู่ของแถวนั้น
  const dd = firstUserCase();
  const a0 = dd.assignments.find((x) => x.classId === dd.classes[0].id && x.perWeek >= 4);
  a0.doubles = 2;
  useDoc(dd);
  const red = board.fixActions('DOUBLE_NO_SLOT', { classId: a0.classId, doubles: 2, slots: 1 }, { assignmentIds: [a0.id] })[0];
  assert.match(red.label, /จาก 2 → 1/);
  const r2 = red.run(store.doc);
  assert.equal(a0.doubles, 1);
  r2.undo(store.doc);
  assert.equal(a0.doubles, 2);

  // ครูสอนเกิน (เพิ่มเพดานไม่พอ) → แบ่งวิชาที่คาบมากสุดให้ครูอื่น · เลิกทำคืนแถวเดิม
  const ds = firstUserCase();
  useDoc(ds);
  const tid = ds.teachers[0].id;
  const before = JSON.stringify(ds.assignments);
  const acts = board.fixActions('TEACHER_OVER', { teacherId: tid, need: 40, free: 30, maxPerDay: 6, unavail: 0 });
  assert.ok(acts.some((a) => a.go?.section === 'teachers' && a.go.teacherId === tid));
  const sp = acts.find((a) => a.run);
  assert.ok(sp && /ให้ครูอื่น/.test(sp.label), acts.map((a) => a.label).join());
  const n1 = ds.assignments.length;
  const r3 = sp.run(store.doc); index();
  assert.equal(ds.assignments.length, n1 + 1);
  assert.ok(ds.assignments.some((a) => a.split && a.teacherId !== tid));
  r3.undo(store.doc); index();
  assert.equal(JSON.stringify(ds.assignments), before);

  // แถวยังไม่มีครู → ปุ่มพาไปแท็บการสอน กรองแถวว่าง
  const dn = firstUserCase();
  dn.assignments[0].teacherId = null; dn.assignments[1].teacherId = null;
  useDoc(dn);
  const nt = board.readiness().find((x) => x.code === 'NO_TEACHER');
  assert.ok(nt);
  const g = board.fixActions('NO_TEACHER', nt.params)[0];
  assert.deepEqual(g.go, { tab: 'data', section: 'assignments', filter: 'noTeacher' });
  assert.equal(g.label, 'ไปเติมครู (2 แถว)');
});

await test('WP6 readiness ไม่ช้า: 36 ห้อง ≤ 5 ms ต่อครั้ง', () => {
  const big = scaled(3);
  big.placements = [];
  useDoc(big);
  for (let i = 0; i < 5; i++) board.readiness();
  const times = [];
  for (let i = 0; i < 20; i++) { const t = now(); board.readiness(); times.push(now() - t); }
  times.sort((x, y) => x - y);
  const med = times[10];
  assert.ok(med < 5, `median ${med.toFixed(2)} ms`);
  return `median ${med.toFixed(2)} ms · max ${times.at(-1).toFixed(2)} ms`;
});

// ── สรุปข้อมูลตัวอย่าง ────────────────────────────────────────────────────
await test('ข้อมูลตัวอย่าง: โครงสร้างถูกต้องและจัดได้ในทางทฤษฎี', () => {
  const periods = sample.term.periods;
  assert.equal(sample.term.days, 5);
  assert.equal(periods.filter((p) => p.type === 'class').length, 8);
  assert.equal(periods[4].type, 'break');
  const ids = (k) => new Set(sample[k].map((x) => x.id));
  const C = ids('classes'), T = ids('teachers'), R = ids('rooms'), SB = ids('subjects');
  for (const a of sample.assignments) {
    assert.ok(C.has(a.classId) && T.has(a.teacherId) && SB.has(a.subjectId) && (a.roomId === null || R.has(a.roomId)), JSON.stringify(a));
  }
  for (const s of sample.subjects) {
    assert.match(s.color, /^#[0-9A-F]{6}$/i);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
    assert.ok(!(g > r + 40 && g > b + 40), `สี ${s.color} ของ ${s.name} เป็นโทนเขียว`);
  }
  const free = 5 * 8;
  for (const c of sample.classes) {
    const need = sample.assignments.filter((a) => a.classId === c.id).reduce((s, a) => s + a.perWeek, 0);
    const locked = sample.locks.filter((l) => l.classId === null || l.classId === c.id).length;
    assert.ok(need <= free - locked, `${c.name} ${need} > ${free - locked}`);
  }
  return `${sample.classes.length} ห้อง · ${sample.teachers.length} ครู · ${sample.rooms.length} ห้องพิเศษ · ${sample.subjects.length} รายวิชา · ${sample.assignments.length} งานสอน · ${sample.locks.length} คาบล็อก`;
});

// ── DELIGHT ก (24 ต.ค. 69): ล็อกผลเดิม + เพดานหน่วย + progress/phase/snapshot + adjacentDays ส่วนเกิน ──
// ก-0: hash ของ JSON.stringify(result.placements) คำนวณจาก solver.js ของ main 6fd069e *ก่อนแก้โค้ด* (24 ต.ค. 69)
// ทุกการแก้ใน DELIGHT ก ต้องไม่เปลี่ยนค่านี้ (ข้อมูลปกติ ไม่ส่ง group = ผลเท่าเดิมทุกคาบ)
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const LOCKED_HASH = {
  'sample-school.json': '59fbaa6da1994dbfb2ec370aa094741d9f4531cb',   // 351 คาบ softScore 4
  'sample-primary.json': '10b7ea7e92071164585214df3cefd634e7a4a750',  // 147 คาบ softScore 72
};
const LOCKED_SOFT = { 'sample-school.json': 4, 'sample-primary.json': 72 };
// [placements, unplaced] ของ sample-primary ที่ perWeek = 10 ทุกแถว (ภาระเกิน → เข้า repair) seed 1 — จากรุ่นก่อนแก้ 24 ต.ค. 69
const PW10_HASH = '1e3122bef2a7d4503c18e8a6c89b2189f666ba7c';
await test('ก-0 ผลจัด sample 2 ไฟล์ (seed 1, 4000 ms) เท่าเดิมทุกคาบ (hash ล็อก 24 ต.ค. 69)', () => {
  const out = [];
  for (const f of Object.keys(LOCKED_HASH)) {
    const d = JSON.parse(readFileSync(join(here, '../assets/solver/' + f), 'utf8'));
    const r = solve(d, { seed: 1, timeLimitMs: 4000 });
    assert.equal(sha1(JSON.stringify(r.placements)), LOCKED_HASH[f], `${f}: placements เปลี่ยน`);
    assert.equal(r.stats.softScore, LOCKED_SOFT[f], `${f}: softScore เปลี่ยน`);
    out.push(`${f} ${r.placements.length} คาบ`);
  }
  return out.join(' · ');
});

// ── ก-1 เพดานหน่วย + เคารพ timeLimit ──
await test('ก-1 perWeek 1e6 แถวเดียว (ไฟล์สำรองเสีย) → คืนภายใน 2×timeLimit ไม่ throw · BAD_DATA what:perWeek · แถวอื่นจัดครบ', () => {
  const d = clone(primary);
  d.assignments[0].perWeek = 1e6;
  const limit = 2000, t = now();
  const r = solve(d, { seed: 1, timeLimitMs: limit });
  const wall = now() - t;
  assert.ok(wall <= 2 * limit, `ใช้ ${wall.toFixed(0)} ms`);
  const u = r.unplaced.find((x) => x.assignmentId === d.assignments[0].id);
  assert.ok(u && u.code === 'BAD_DATA' && u.params.what === 'perWeek', JSON.stringify(u));
  assert.equal(u.reason, 'คาบ/สัปดาห์เกิน 60 (ข้อมูลผิดปกติ)');
  assert.equal(r.unplaced.length, 1, JSON.stringify(r.unplaced.slice(0, 3)));
  assert.equal(r.stats.hardViolations, 0);
  // capacityCheck ให้รหัสเดียวกัน
  assert.ok(capacityCheck(d).issues.some((i) => i.code === 'BAD_DATA' && i.params.what === 'perWeek'));
  return `${wall.toFixed(0)} ms · ${r.placements.length} คาบ`;
});

await test('ก-1 แถว perWeek เกิน 60 ที่มีคาบปักหมุด: หมุดยังอยู่ในผลและกันช่องไว้ (ไม่มีหน่วยอื่นลงทับ)', () => {
  const d = clone(primary);
  const a = d.assignments[0];
  a.perWeek = 999;
  d.placements = [{ assignmentId: a.id, day: 0, period: 0, pinned: true }];
  const r = solve(d, { seed: 1, timeLimitMs: 2000 });
  assert.ok(r.placements.some((p) => p.assignmentId === a.id && p.day === 0 && p.period === 0));
  const same = r.placements.filter((p) => p.day === 0 && p.period === 0 && d.assignments.find((x) => x.id === p.assignmentId)?.classId === a.classId);
  assert.equal(same.length, 1, 'ห้องเดียวกันช่องเดียวกันต้องมีแค่หมุด');
  const u = r.unplaced.find((x) => x.assignmentId === a.id);
  assert.equal(u.remaining, 998);
});

await test('ก-1 5000 แถว × perWeek 20 (ครู 50 ห้อง 100) → wall ≤ 1.5×timeLimit · แถวเกินเพดานหน่วยได้ BAD_DATA what:units', () => {
  const P = Array.from({ length: 9 }, (_, i) => ({ type: i === 4 ? 'break' : 'class' }));
  const big = { days: 5, periods: P, classes: [], teachers: [], rooms: [], assignments: [], locks: [], fixed: [] };
  for (let i = 0; i < 100; i++) big.classes.push({ id: 'c' + i });
  for (let i = 0; i < 50; i++) big.teachers.push({ id: 't' + i, maxPerDay: 6 });
  for (let i = 0; i < 5000; i++) big.assignments.push({ id: 'a' + i, subjectId: 's' + (i % 37), classId: 'c' + (i % 100), teacherId: 't' + (i % 50), roomId: null, perWeek: 20, doubles: i % 3 === 0 ? 2 : 0 });
  const limit = 1500, t = now();
  const r = solve(big, { seed: 1, timeLimitMs: limit });
  const wall = now() - t;
  assert.ok(wall <= 1.5 * limit, `ใช้ ${wall.toFixed(0)} ms`);
  assert.ok(r.stats.units <= 20000, `units ${r.stats.units}`);
  const bad = r.unplaced.filter((u) => u.code === 'BAD_DATA');
  assert.ok(bad.length > 0 && bad.every((u) => u.params.what === 'units'));
  return `${wall.toFixed(0)} ms · units ${r.stats.units} · วาง ${r.placements.length} · BAD_DATA ${bad.length} แถว`;
});

await test('ก-1 extract แบบ heap เลือกหน่วยเดียวกับรุ่นเดิม: ภาระเกิน (perWeek 10 ทุกแถว) seed 1 ผลเดิม', () => {
  // hash คำนวณจากรุ่นก่อนแก้ (24 ต.ค. 69) — เคสนี้เข้า repair (extractConflicts + reinsert) จริง
  const d = clone(primary);
  for (const a of d.assignments) a.perWeek = 10;
  const r = solve(d, { seed: 1, timeLimitMs: 30000 });
  assert.equal(r.stats.timedOut, false);
  assert.ok(r.unplaced.length > 0);
  assert.equal(sha1(JSON.stringify([r.placements, r.unplaced])), PW10_HASH);
});

// ── ก-2 progress monotonic + phase · ก-3 snapshot ──
await test('ก-2 pctMono ไม่ลดเลย · phase แรก greedy · สุดท้าย pct 1 · placed/total ครบ · onPhase ทันที', () => {
  const big = scaled(3);
  const ev = [], ph = [];
  const r = solve(big, { seed: 1, timeLimitMs: 3000, onProgress: (p) => ev.push(p), onPhase: (p) => ph.push(p) });
  assert.ok(ev.length >= 3);
  assert.equal(ev[0].phase, 'greedy');
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].pctMono >= ev[i - 1].pctMono, `pctMono ถอย ${ev[i - 1].pctMono} → ${ev[i].pctMono}`);
  for (const e of ev) assert.ok(e.pctMono >= e.pct && typeof e.placed === 'number' && e.total === ev[0].total);
  const last = ev.at(-1);
  assert.equal(last.pct, 1); assert.equal(last.pctMono, 1);
  assert.equal(last.placed, r.placements.length);
  assert.equal(last.total, r.placements.length + r.stats.unplacedPeriods);
  assert.deepEqual(ph[0].phase, 'greedy');
  assert.ok(ph.some((p) => p.phase === 'hard') && ph.at(-1).phase === 'soft', ph.map((p) => p.phase).join());
  assert.ok(ph.every((p) => typeof p.ms === 'number'));
  return `${ev.length} progress · phases ${ph.map((p) => p.phase).join('→')}`;
});

await test('ก-2/ก-3 มี/ไม่มี onProgress (และปิด snapshot) → placements เท่ากันทุกตัว (ไม่แตะ RNG)', () => {
  for (const [d, lim] of [[sample, 4000], [primary, 4000], [scaled(2), 4000]]) {
    const a = solve(d, { seed: 3, timeLimitMs: lim });
    const b = solve(d, { seed: 3, timeLimitMs: lim, onProgress: () => {}, onPhase: () => {} });
    const c = solve(d, { seed: 3, timeLimitMs: lim, onProgress: () => {}, progressPlacements: false });
    assert.equal(a.stats.timedOut || b.stats.timedOut || c.stats.timedOut, false);
    assert.equal(JSON.stringify(b.placements), JSON.stringify(a.placements));
    assert.equal(JSON.stringify(c.placements), JSON.stringify(a.placements));
  }
});

await test('ก-3 onProgress ได้ placements ≥ 1 ครั้ง (timeLimit ≥ 300) · ตรวจไม่ชน · progressPlacements:false = ไม่แนบ', () => {
  const ev = [];
  solve(sample, { seed: 1, timeLimitMs: 300, onProgress: (p) => ev.push(p) });
  const snaps = ev.filter((e) => Array.isArray(e.placements));
  assert.ok(snaps.length >= 1, 'ไม่มี snapshot');
  const ids = new Set(sample.assignments.map((a) => a.id));
  for (const s of snaps) {
    assert.equal(s.placements.length, s.placed);
    assert.ok(s.placements.every((p) => ids.has(p.assignmentId) && Number.isInteger(p.day) && Number.isInteger(p.period)));
    assert.equal(validate(sample, s.placements).filter((c) => c.type !== 'double').length, 0, 'snapshot ต้องไม่มีคาบชน');
  }
  const ev2 = [];
  solve(sample, { seed: 1, timeLimitMs: 300, progressPlacements: false, onProgress: (p) => ev2.push(p) });
  assert.ok(ev2.length > 0 && ev2.every((e) => !('placements' in e) && !('delta' in e)));
  return `snapshot ${snaps.length} ครั้ง จาก ${ev.length}`;
});

/** มัธยม 42 ห้อง (ม.1–6 × 7) 8 วิชา 22 คาบ/ห้อง = 924 คาบ · ครูกลุ่มละ ≤ 18 คาบ · ห้องพิเศษ 6 */
function secondary42() {
  const P = [0, 1, 2, 3, 'b', 4, 5, 6, 7].map((x) => ({ type: x === 'b' ? 'break' : 'class' }));
  const SUBJ = [['th', 3, 0], ['ma', 3, 0], ['sc', 4, 1], ['so', 3, 0], ['pe', 2, 0], ['ar', 2, 0], ['wk', 2, 1], ['en', 3, 0]];
  const d = { days: 5, periods: P, classes: [], teachers: [], rooms: [], assignments: [], locks: [], fixed: [] };
  for (let i = 1; i <= 6; i++) d.rooms.push({ id: 'r' + i });
  const pool = {};
  let tid = 0, aid = 0, rr = 0;
  for (const [g, pw] of SUBJ) { pool[g] = []; for (let i = 0; i < Math.ceil((42 * pw) / 18); i++) { const id = 't' + ++tid; d.teachers.push({ id, maxPerDay: 6 }); pool[g].push(id); } }
  for (let m = 1; m <= 6; m++) for (let r = 1; r <= 7; r++) {
    const c = `c${m}${r}`;
    d.classes.push({ id: c });
    for (const [g, pw, dbl] of SUBJ) d.assignments.push({ id: 'a' + ++aid, subjectId: g + m, classId: c, teacherId: pool[g][rr++ % pool[g].length], roomId: g === 'sc' ? 'r' + (((m - 1) % 3) + 1) : g === 'wk' ? 'r' + (4 + ((r - 1) % 3)) : null, perWeek: pw, doubles: dbl });
    if (m <= 3) d.locks.push({ classId: c, day: 2, period: 8, label: 'ลูกเสือ' });
  }
  d.locks.push({ classId: null, day: 4, period: 8, label: 'ชุมนุม' });
  return d;
}

await test('ก-3 42 ห้อง: snapshot แต่ละครั้ง ≤ 60 KB (JSON) · delta เมื่อเกิน 2,000 รายการ', () => {
  const d = secondary42();
  const ev = [];
  const r = solve(d, { seed: 1, timeLimitMs: 1500, onProgress: (p) => ev.push(p) });
  const snaps = ev.filter((e) => e.placements);
  assert.ok(snaps.length >= 1);
  const maxLen = Math.max(...snaps.map((e) => JSON.stringify(e).length));
  assert.ok(maxLen <= 60 * 1024, `ใหญ่ ${maxLen}`);
  // ข้อมูลใหญ่ (> 2,000 คาบ) → ส่ง delta {add, remove} ที่ประกอบกลับได้เท่า placed
  const huge = scaled(6);   // 72 ห้อง 2,106 คาบ
  const ev2 = [];
  solve(huge, { seed: 1, timeLimitMs: 1500, onProgress: (p) => ev2.push(p) });
  const set = new Set();
  let nDelta = 0;
  for (const e of ev2) {
    if (e.placements) { set.clear(); for (const p of e.placements) set.add(`${p.assignmentId}|${p.day}|${p.period}`); }
    if (!e.delta) continue;
    nDelta++;
    for (const x of e.delta.remove) assert.ok(set.delete(x.join('|')), 'ลบสิ่งที่ไม่มี');
    for (const x of e.delta.add) set.add(x.join('|'));
    assert.equal(set.size, e.placed);
  }
  assert.ok(nDelta >= 1, 'ต้องมี delta');
  return `42 ห้อง ${r.placements.length} คาบ snapshot สูงสุด ${(maxLen / 1024).toFixed(1)} KB · 72 ห้อง delta ${nDelta} ครั้ง`;
});

await test('ก-2 worker: progress มี pctMono/placed/total · ส่ง {type:"phase"} ≥ 2 ค่า · placements เท่ากับ solve ตรง', async () => {
  const msgs = [];
  globalThis.self = { postMessage: (m) => msgs.push(m) };
  // worker.js ไม่มี import/export → node โหลดเป็น CommonJS ซึ่งแคชตามไฟล์ (query ไม่ช่วย) — คัดลอกไปโฟลเดอร์ชั่วคราวเพื่อได้ instance ใหม่
  const dir = mkdtempSync(join(tmpdir(), 'tt-worker-'));
  for (const f of ['solver.worker.js', 'solver.js']) copyFileSync(join(here, '../assets/solver/', f), join(dir, f));
  await import(pathToFileURL(join(dir, 'solver.worker.js')).href);
  const handler = globalThis.self.onmessage;
  await handler({ data: { type: 'solve', input: sample, options: { timeLimitMs: 4000, seed: 1 } } });
  const prog = msgs.filter((m) => m.type === 'progress');
  const phases = msgs.filter((m) => m.type === 'phase');
  assert.ok(prog.every((p) => typeof p.pctMono === 'number' && typeof p.placed === 'number' && typeof p.total === 'number'));
  assert.ok(new Set(phases.map((p) => p.phase)).size >= 2, phases.map((p) => p.phase).join());
  assert.equal(phases[0].phase, 'greedy');
  assert.ok(prog.some((p) => Array.isArray(p.placements)));
  const done = msgs.find((m) => m.type === 'done');
  assert.equal(sha1(JSON.stringify(done.result.placements)), LOCKED_HASH['sample-school.json']);
  msgs.length = 0;
  await handler({ data: { type: 'solve', input: sample, options: { timeLimitMs: 4000, seed: 1, progressPlacements: false } } });
  assert.ok(msgs.filter((m) => m.type === 'progress').every((p) => !('placements' in p) && !('delta' in p)));
  delete globalThis.self;
  rmSync(dir, { recursive: true, force: true });
  return `progress ${prog.length} · phase ${phases.map((p) => p.phase).join('→')}`;
});

// ── ก-4 adjacentDays = ส่วนเกินขั้นต่ำ ──
/** ประถม 6 ห้อง ครู 6 ประจำชั้นสอนทุกวิชา (ไทย 5 คณิต 5 อังกฤษ 4 …) 24 คาบ/ห้อง D = 5 */
function primaryFit6() {
  const P = [0, 1, 2, 'b', 3, 4, 5].map((x) => ({ type: x === 'b' ? 'break' : 'class' }));
  const CORE = [['th', 5], ['ma', 5], ['sc', 2], ['so', 2], ['hi', 1], ['pe', 2], ['ar', 2], ['wk', 1], ['en', 4]];
  const d = { days: 5, periods: P, classes: [], teachers: [], rooms: [], assignments: [], locks: [], fixed: [] };
  let aid = 0;
  for (let c = 1; c <= 6; c++) {
    d.classes.push({ id: 'c' + c }); d.teachers.push({ id: 't' + c, maxPerDay: 0 });
    for (const [g, pw] of CORE) d.assignments.push({ id: 'a' + ++aid, subjectId: g + c, classId: 'c' + c, teacherId: 't' + c, roomId: null, perWeek: pw, doubles: 0 });
  }
  for (const day of [2, 3, 4]) d.locks.push({ classId: null, day, period: 6, label: 'กิจกรรม' });
  return d;
}

await test('ก-4 ประถมพอดี (ไทย 5 คณิต 5 อังกฤษ 4, D=5) → adjacentDays 0 (ส่วนเกิน) · adjacentDaysRaw 60 (= ขั้นต่ำ)', () => {
  const d = primaryFit6();
  for (const seed of [1, 7]) {
    const r = solve(d, { seed, timeLimitMs: 4000 });
    assert.equal(r.stats.hardViolations, 0); assert.equal(r.unplaced.length, 0);
    assert.equal(r.stats.soft.adjacentDays, 0, JSON.stringify(r.stats.soft));
    assert.equal(r.stats.soft.adjacentDaysRaw, 60, JSON.stringify(r.stats.soft));
    const s = score(d, r.placements);
    assert.equal(s.adjacentDays, 0); assert.equal(s.adjacentDaysRaw, 60);
    assert.equal(s.softScore, 10 * s.sameDay + 2 * s.adjacentDaysRaw + s.teacherGaps, 'softScore ยังคิดจากค่า raw (น้ำหนักเดิม)');
  }
  // sample เดิม: raw = ค่าที่เคยรายงาน (2) · ส่วนเกินไม่ติดลบ
  const r0 = solve(sample, { seed: 1, timeLimitMs: 4000 });
  assert.equal(r0.stats.soft.adjacentDaysRaw, 2);
  assert.ok(r0.stats.soft.adjacentDays >= 0 && r0.stats.soft.adjacentDays <= 2);
});

// ── ก-8 (stretch) วิชาหลักช่วงเช้า + ห้องไม่มีคาบว่างกลางวัน — ใช้เมื่อส่ง assignments[].group ──
const GROUP_OF = { th: 'TH', ma: 'MA', sc: 'SC', so: 'SO', hi: 'SO', pe: 'HE', ar: 'AR', wk: 'OC', en: 'FL' };
function withGroups(d) { for (const a of d.assignments) a.group = GROUP_OF[a.subjectId.replace(/\d+$/, '')]; return d; }
function primaryWide() {   // ประถม 8 คาบ/วัน เรียน 24 คาบ (ห้องไม่เต็ม → มีที่ให้เกิดคาบว่างกลางวัน)
  const d = primaryFit6();
  d.periods = [0, 1, 2, 3, 'b', 4, 5, 6, 7].map((x) => ({ type: x === 'b' ? 'break' : 'class' }));
  for (const l of d.locks) l.period = 8;
  return d;
}
const afternoonPct = (d, r) => {
  const brk = d.periods.findIndex((p) => p.type === 'break');
  const sub = new Map(d.assignments.map((a) => [a.id, a.subjectId]));
  const tm = r.placements.filter((p) => /^(th|ma)/.test(sub.get(p.assignmentId)));
  return (100 * tm.filter((p) => p.period > brk).length) / tm.length;
};

await test('ก-8 ไม่ส่ง group = ผลเท่าเดิม 100% · ส่ง group แต่ weights ปิด (0) = ผลเท่าไม่มี group', () => {
  for (const mk of [primaryFit6, primaryWide]) {
    const plain = solve(mk(), { seed: 1, timeLimitMs: 4000 });
    const off = solve(withGroups(mk()), { seed: 1, timeLimitMs: 4000, weights: { morningCore: 0, classGap: 0 } });
    assert.equal(JSON.stringify(off.placements), JSON.stringify(plain.placements));
    assert.equal(plain.stats.softScore, score(mk(), plain.placements).softScore);
  }
});

await test('ก-8 ประถม + group: ไทย/คณิตตกบ่าย ≤ 15% · ห้องไม่มีคาบว่างกลางวัน · hard 0 · incremental ตรง (debugCheck)', () => {
  const out = [];
  for (const mk of [primaryFit6, primaryWide]) for (const seed of [1, 7]) {
    const base = mk(), d = withGroups(mk());
    const t0 = now(); const r0 = solve(base, { seed, timeLimitMs: 4000 }); const ms0 = now() - t0;
    const t1 = now(); const r = solve(d, { seed, timeLimitMs: 4000, debugCheck: true }); const ms1 = now() - t1;
    assert.equal(r.unplaced.length, 0); assert.equal(validate(d, r.placements).length, 0);
    const pct = afternoonPct(d, r);
    assert.ok(pct <= 15, `ไทย/คณิตตกบ่าย ${pct.toFixed(0)}% (เดิม ${afternoonPct(base, r0).toFixed(0)}%)`);
    assert.equal(r.stats.soft.classGaps, 0, JSON.stringify(r.stats.soft));
    assert.ok(ms1 < 1000, `ช้าเกิน ${ms1.toFixed(0)} ms`);
    out.push(`${mk.name} s${seed}: บ่าย ${afternoonPct(base, r0).toFixed(0)}→${pct.toFixed(0)}% · ช่องว่างห้อง ${r0.stats.soft.classGaps}→0 · ${ms0.toFixed(0)}→${ms1.toFixed(0)} ms`);
  }
  return out.join('\n    ');
});

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
