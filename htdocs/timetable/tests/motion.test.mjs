// ทดสอบ motion.js ใน node (ไม่มี DOM/matchMedia/rAF) — รัน: node htdocs/timetable/tests/motion.test.mjs
// เป้าหมาย: ทุก API ต้องไม่ throw เมื่อไม่มีเบราว์เซอร์ และ "ผลปลายทาง" ต้องเกิดครบ (เช่นเลขที่นับขึ้นต้องเป็นค่าปลายทันที)
import assert from 'node:assert/strict';
import * as motion from '../assets/motion.js';

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const fakeEl = () => ({ textContent: '', dataset: {}, style: { setProperty(k, v) { this[k] = v; } } });
const animEl = (log) => ({
  animate(kf, opts) { log.push(opts); return { finished: Promise.resolve(), cancel() {}, finish() {} }; },
});

test('still() คืน false เมื่อไม่มี matchMedia/document', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(motion.still(), false);
});

test('countUp ไม่มี rAF → ใส่ค่าปลายทันที + dataset.to', async () => {
  const el = fakeEl();
  const p = motion.countUp(el, 147);
  assert.equal(el.textContent, '147');
  assert.equal(el.dataset.to, '147');
  await p;
});

test('countUp ใช้ fmt กับค่าปลาย', async () => {
  const el = fakeEl();
  await motion.countUp(el, 3, { fmt: (n) => `เหลือ ${n} คาบ` });
  assert.equal(el.textContent, 'เหลือ 3 คาบ');
});

test('stagger: delay ตัวที่ i = min(each, max/n) * i', async () => {
  const log = [];
  const els = Array.from({ length: 8 }, () => animEl(log));
  await motion.stagger(els, [{ opacity: 0 }, { opacity: 1 }], { each: 200, max: 900, duration: 300 });
  assert.equal(log.length, 8);
  const step = Math.min(200, 900 / 8);
  log.forEach((o, i) => { assert.equal(o.delay, step * i); assert.equal(o.duration, 300); });
});

test('stagger: each เล็กกว่า max/n → ใช้ each', async () => {
  const log = [];
  await motion.stagger([animEl(log), animEl(log), animEl(log)], [], { each: 24 });
  assert.deepEqual(log.map((o) => o.delay), [0, 24, 48]);
});

test('staggerVars ตั้ง --i และ --step', () => {
  const kids = [fakeEl(), fakeEl(), fakeEl(), fakeEl()];
  const host = { children: kids, style: fakeEl().style };
  const step = motion.staggerVars(host, { each: 400, max: 900 });
  assert.equal(step, 225);
  assert.equal(host.style['--step'], '225ms');
  assert.deepEqual(kids.map((k) => k.style['--i']), ['0', '1', '2', '3']);
});

test('play(el ไม่มี animate) คืน stub ที่มี finished thenable', async () => {
  const a = motion.play({}, [{ opacity: 0 }]);
  assert.equal(typeof a.finished.then, 'function');
  assert.doesNotThrow(() => { a.cancel(); a.finish(); });
  await a.finished;
  assert.equal(typeof motion.play(null, []).finished.then, 'function');
});

test('play ใส่ fill:none เป็นค่าเริ่มต้น', () => {
  const log = [];
  motion.play(animEl(log), [], { duration: 100 });
  assert.equal(log[0].fill, 'none');
  assert.equal(log[0].duration, 100);
});

test('viewTransition(fn) ไม่มี document → เรียก fn 1 ครั้ง', async () => {
  let n = 0;
  await motion.viewTransition(() => { n++; });
  assert.equal(n, 1);
});

test('flyTo(null, null) ไม่ throw และ resolve', async () => {
  await motion.flyTo(null, null);
});

test('confetti(null) ไม่ throw และคืน false', async () => {
  assert.equal(await motion.confetti(null), false);
});

test('once/pulse/hint/skipScene ไม่ throw เมื่อไม่มี DOM', async () => {
  await motion.once(null, 'm-pop');
  await motion.pulse(null);
  assert.equal(motion.hint('#x'), null);
  assert.equal(motion.skipScene(), 0);
});

test('EASE มีค่า easing ที่ใช้กับ WAAPI ได้', () => {
  for (const k of ['out', 'in', 'io', 'springSoft', 'springPop']) assert.equal(typeof motion.EASE[k], 'string');
});

for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log('✔ ' + name); } catch (e) { failed++; console.log('✘ ' + name + '\n    ' + e.message); }
}
console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
