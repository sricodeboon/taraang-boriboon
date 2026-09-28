// ทดสอบ solver — รัน: node htdocs/timetable/tests/solver.test.mjs
// ไม่มี dependency ภายนอก (node >= 18)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { solve, validate, score, toSolverInput } from '../assets/solver/solver.js';

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
  assert.equal(miss, 4, 'ม.1/1 มีคาบว่าง 36 ต้องการ 40 → ค้าง 4 คาบ');
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

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
