// ทดสอบแพ็กเกจ ค (DELIGHT) ส่วนที่เป็นฟังก์ชันล้วน · node ไม่มี DOM
// - pdf.js: ชื่อย่อวิชา · กระดาษเริ่มต้นตามขนาดโรงเรียน · เนื้อหา PDF (หัวกระดาษ ครูประจำชั้น สรุปครู คำอธิบายสี ท้ายหน้า) ผ่าน previewHtml
// - notify.busy: ปุ่มหมุน → เสร็จ → คืนข้อความเดิม · กันกดซ้ำ · พลาดแล้วคืนทันที
// - import.openPaste มีอยู่และโหลด import.js ใน node ไม่แตะ DOM
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window ??= {};
window.TT = { school: { name: 'โรงเรียนทดสอบ <b>หนึ่ง</b>' } }; // ไม่มี logoRev → loadLogo ไม่ fetch
const { store, index } = await import('../assets/store.js');
const pdf = await import('../assets/pdf.js');
const notify = await import('../assets/notify.js');
const imp = await import('../assets/import.js');

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '../assets/solver/', f), 'utf8'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('✔', name); } catch (e) { failed++; console.log('✘', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); }
}

/** ข้อมูลประถมตัวอย่าง + วางคาบให้ห้องแรกบางช่อง + ครูประจำชั้น + ครูไม่ว่าง 1 ช่อง */
function primary() {
  const d = load('sample-primary.json');
  d.placements = [];
  store.doc = d; index();
  const c0 = d.classes[0];
  const mine = d.assignments.filter((a) => a.classId === c0.id && a.teacherId);
  const teach = d.term.periods.map((p, i) => (p.type === 'break' ? -1 : i)).filter((i) => i >= 0);
  mine.slice(0, 4).forEach((a, k) => d.placements.push({ assignmentId: a.id, day: k % d.term.days, period: teach[k % teach.length], pinned: false }));
  d.teachers[0].homeroom = c0.id;
  d.teachers[0].unavailable = [[4, teach[teach.length - 1]]];
  index();
  return d;
}

await test('shortName: ชื่อย่อวิชาที่ครูอ่านเข้าใจ ไม่ใช้รหัส · subject.short มาก่อน · ไม่ซ้ำกันระหว่างภาษา', () => {
  const s = (name, extra = {}) => pdf.shortName({ name, ...extra });
  assert.equal(s('ภาษาไทย 1'), 'ไทย');
  assert.equal(s('ภาษาอังกฤษ'), 'อังกฤษ');
  assert.equal(s('ภาษาจีน'), 'จีน');
  assert.equal(s('คณิตศาสตร์ 2'), 'คณิต');
  assert.equal(s('วิทยาศาสตร์และเทคโนโลยี'), 'วิทย์');
  assert.equal(s('วิทยาการคำนวณ'), 'คำนวณ');
  assert.equal(s('สุขศึกษาและพลศึกษา'), 'สุข-พละ');
  assert.equal(s('ลูกเสือ-เนตรนารี'), 'ลูกเสือ');
  assert.equal(s('แนะแนว'), 'แนะแนว');
  assert.equal(s('คณิตศาสตร์', { short: 'คณ' }), 'คณ');
  assert.ok([...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s('สารานุกรมประวัติศาสตร์ไทยยาวมาก'))].length <= 6);
});

await test('defaultPaper: ห้อง × คาบต่อวัน > 36 → A3 · โรงเรียนเล็ก A4', () => {
  primary();
  assert.equal(pdf.defaultPaper('class'), 'A4'); // 6 ห้อง × 6 คาบ = 36
  store.doc = load('sample-school.json'); index();
  assert.equal(pdf.defaultPaper('class'), 'A3');
});

await test('PDF รายห้อง (ตัวอย่าง HTML ของเอกสารเดียวกัน): ชื่อโรงเรียน (escape) · ตารางเรียน ป.1 · ภาคเรียน · ครูประจำชั้น · คำอธิบายสี · คาบล็อก · ท้ายหน้า', async () => {
  const d = primary();
  const p = await pdf.previewHtml({ kind: 'class', mode: 'each', perPage: 1 }, { maxPages: 2 });
  assert.equal(p.total, d.classes.length, '1 ห้อง/หน้า');
  assert.equal(p.pages, 2);
  assert.match(p.html, /โรงเรียนทดสอบ &lt;b&gt;หนึ่ง&lt;\/b&gt;/, 'ชื่อโรงเรียนถูก escape');
  assert.ok(!/<b>หนึ่ง<\/b>/.test(p.html));
  assert.match(p.html, new RegExp(`ตารางเรียน ${d.classes[0].name} · ภาคเรียนที่ 1`));
  assert.match(p.html, new RegExp(`ครูประจำชั้น: ${d.teachers[0].name}`));
  assert.match(p.html, /ภาษาไทย|คณิตศาสตร์|วิทยาศาสตร์ฯ/, 'คำอธิบายสีกลุ่มสาระ');
  if (d.locks.length) assert.match(p.html, /คาบล็อก/);
  assert.match(p.html, /พิมพ์เมื่อ .+ · จัดด้วย ตารางบริบูรณ์ · sricodeboon/);
  assert.match(p.html, /หน้า 1\/6/);
  assert.equal(p.width, 842, 'A4 แนวนอน');
  assert.ok(!/​/.test(p.html), 'ไม่มีอักขระ zero-width หลุดในตัวอย่าง');
});

await test('PDF ตารางสอนของฉัน (ครูคนเดียว): 1 หน้า · "สอน N คาบ · ว่าง M คาบ · ประจำชั้น …" · ช่องครูไม่ว่างมีลาย', async () => {
  const d = primary();
  const t = d.teachers[0];
  const p = await pdf.previewHtml({ kind: 'teacher', mode: 'each', perPage: 1, ids: [t.id] });
  assert.equal(p.total, 1);
  const n = d.placements.filter((x) => d.assignments.find((a) => a.id === x.assignmentId)?.teacherId === t.id).length;
  const slots = d.term.days * d.term.periods.filter((x) => x.type !== 'break').length;
  assert.match(p.html, new RegExp(`สอน ${n} คาบ · ว่าง ${slots - n} คาบ · ประจำชั้น ${d.classes[0].name}`));
  assert.match(p.html, /ไม่ว่าง/);
  assert.match(p.html, /repeating-linear-gradient/, 'ลายเฉียงช่องไม่ว่าง');
  assert.match(p.name, new RegExp(`^ตารางสอน-${t.name}-`));
});

await test('PDF ตารางรวม: ชื่อย่อวิชาแทนรหัส · แยก 2 หน้า (จ–พ / พฤ–ศ) · ไม่มีสีเขียวในเอกสาร', async () => {
  primary();
  const one = await pdf.previewHtml({ kind: 'class', mode: 'overview', paper: 'A4' });
  assert.equal(one.total, 1);
  assert.match(one.html, /บรรทัดบน = ชื่อย่อวิชา/);
  assert.ok(!/ท1\d{4}|ค1\d{4}/.test(one.html.replace(/title="[^"]*"/g, '')), 'ไม่ใช้รหัสวิชาในช่อง');
  const two = await pdf.previewHtml({ kind: 'class', mode: 'overview', paper: 'A4', split: true });
  assert.equal(two.total, 2);
  assert.match(two.html, /จันทร์–พุธ/);
  assert.match(two.html, /พฤหัสบดี–ศุกร์/);
  // สีในเอกสาร (hex/rgba) ต้องไม่มีโทนเขียว
  const hue = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn, l = (mx + mn) / 2;
    if (!dd) return null;
    const s = dd / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h = (h * 60 + 360) % 360;
    return s > 0.2 ? h : null;
  };
  const greens = [...new Set([...one.html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]))].filter((x) => { const h = hue(x); return h != null && h >= 75 && h <= 165; });
  assert.deepEqual(greens, []);
});

await test('previewHtml: ไม่มีห้อง → error ภาษาไทย (ไม่พัง)', async () => {
  store.doc = { ...load('sample-primary.json'), classes: [], assignments: [] }; index();
  await assert.rejects(pdf.previewHtml({ kind: 'class', mode: 'each' }), /ยังไม่มีห้องเรียน/);
});

/** ปุ่มปลอม (พอสำหรับ busy) */
function fakeButton(html = 'ดาวน์โหลด') {
  const cls = new Set(['btn']);
  const attrs = {};
  return {
    innerHTML: html, disabled: false, style: { width: '' },
    get textContent() { return this.innerHTML; }, set textContent(v) { this.innerHTML = String(v); },
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c) },
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, attrs,
    getBoundingClientRect: () => ({ width: 132.5 }),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await test('notify.busy: หมุน (disabled + ล็อกความกว้าง + aria-busy) → เสร็จ (เช็ก 1.2 วิ) → คืนข้อความเดิม · กดซ้ำระหว่างหมุนไม่เรียกซ้ำ', async () => {
  const b = fakeButton('ตารางเรียนทุกห้อง (6)');
  let calls = 0, mid = null;
  const p = notify.busy(b, async () => { calls++; mid = { cls: b.classList.contains('btn-busy'), dis: b.disabled, w: b.style.width, aria: b.attrs['aria-busy'], txt: b.textContent }; await sleep(30); return 'ไฟล์.pdf'; }, { label: 'กำลังเตรียม', min: 80 });
  const again = await notify.busy(b, async () => { calls++; });
  assert.equal(again, undefined, 'กดซ้ำระหว่างหมุน = ไม่ทำ');
  const t0 = Date.now();
  assert.equal(await p, 'ไฟล์.pdf');
  assert.ok(Date.now() - t0 >= 60, 'เวลาขั้นต่ำ');
  assert.deepEqual(mid, { cls: true, dis: true, w: '132.5px', aria: 'true', txt: 'กำลังเตรียม' });
  assert.equal(calls, 1);
  assert.ok(b.classList.contains('btn-done') && !b.classList.contains('btn-busy') && !b.disabled);
  await sleep(1300);
  assert.equal(b.textContent, 'ตารางเรียนทุกห้อง (6)');
  assert.ok(!b.classList.contains('btn-done'));
  assert.equal(b.style.width, '');
});

await test('notify.busy: fn พลาด → คืนปุ่มทันที แล้วโยน error ต่อ', async () => {
  const b = fakeButton('Excel');
  await assert.rejects(notify.busy(b, async () => { throw new Error('โหลดไม่ได้'); }), /โหลดไม่ได้/);
  assert.equal(b.textContent, 'Excel');
  assert.ok(!b.disabled && !b.classList.contains('btn-busy') && !b.classList.contains('btn-done'));
});

await test('import.openPaste: มีให้ตัวช่วยเรียก · โหลด import.js ใน node ไม่แตะ DOM', () => {
  assert.equal(typeof imp.openPaste, 'function');
  assert.equal(typeof imp.parseTeachers, 'function');
});

console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
