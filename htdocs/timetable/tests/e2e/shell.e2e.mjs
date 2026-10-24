// ทดสอบ e2e ของแพ็กเกจ ค (DELIGHT): หน้าแรก · ตัวช่วย · วางรายชื่อ · เติมครู · ส่งออก (Playwright · ไม่ขึ้นโฮสต์)
// รัน: BASE=http://127.0.0.1:8123/timetable/ DB=<sqlite ของสำเนาทดสอบ> OUT=<โฟลเดอร์ผล> PW=<โฟลเดอร์ที่มี node_modules/playwright> node tests/e2e/shell.e2e.mjs
// ครอบ: (ก) หน้าแรกใต้ reduced-motion / tt-still ไม่มีแอนิเมชันวิ่ง (รวม .boon::after) · ไม่มี JS = ไม่มีอะไรซ่อน
//       (ข) หน้าแรก 1366: ส่วนล่างไหลเข้าเมื่อเลื่อนถึง · ตัวเลขโรงเรียน = data-count · 390 ไม่ล้น
//       (ค) ตัวช่วย: พรีวิวโครงคาบสด = จำนวนคาบ · ok → กล่องวางรายชื่อครูเปิดเอง → ปิดได้
//       (ง) วางรายชื่อ 8 บรรทัด → tt:added → แถวใหม่ .m-flash · เติมครู → .btn-busy → tt:autoassigned → ghost หายหมด
//       (จ) ส่งออก: ปุ่ม PDF busy → done → ได้ไฟล์ · ดูตัวอย่าง = dialog + iframe · พิมพ์ = แท็บใหม่ ไม่เรียก window.print
//       (ฉ) ไม่มีสีเขียว/แถบขอบซ้ายทุกแท็บ + หน้าแรก · (ช) ไม่มี console error / CSP / swal-warning / alert()
// ห้ามชี้ DB ไปที่ฐานข้อมูลจริง: สคริปต์ล้างตาราง rate_hits ของ DB ที่ให้มา (กันเพดานโหมดทดลองระหว่างทดสอบ)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(join(process.env.PW || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8123/timetable/';
const OUT = process.env.OUT || '/tmp/tt-e2e-shell';
const DB = process.env.DB || '';
mkdirSync(OUT, { recursive: true });
if (DB && /scratchpad|tmp/.test(DB)) try { execFileSync('sqlite3', [DB, 'DELETE FROM rate_hits']); } catch { /* ยังไม่มีตาราง */ }

let passed = 0, failed = 0;
const problems = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`✔ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`✘ ${name}\n    ${(e.stack || e.message).split('\n').slice(0, 4).join('\n    ')}`); }
}

const browser = await chromium.launch();

/** เปิดหน้าใหม่ + ตัวเก็บ console error/CSP/swal-warning/alert() (เหมือน timetable.e2e.mjs) · opts.ctx = ตัวเลือกของ browser context */
async function open(viewport = { width: 1366, height: 900 }, { ctx: ctxOpts = {}, human = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH', acceptDownloads: true, deviceScaleFactor: 1, hasTouch: viewport.width < 500, ...ctxOpts });
  const page = await ctx.newPage();
  page.errors = [];
  await page.addInitScript((h) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    for (const k of ['alert', 'confirm', 'prompt']) window[k] = (...a) => { (window.__native ||= []).push(k + ':' + a[0]); return false; };
    // ตัวช่วยเริ่มต้นไม่เปิดกล่องวางรายชื่อต่อเองเมื่อเป็นเบราว์เซอร์อัตโนมัติ (กันบังเทสต์เดิม) — เทสต์นี้จำลองผู้ใช้จริง
    if (h) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  }, human);
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') page.errors.push('console: ' + t);
    if (m.type() === 'warning' && /^SweetAlert2:/.test(t)) page.errors.push('swal-warning: ' + t);
    if (/Content Security Policy/i.test(t)) page.errors.push('csp: ' + t);
  });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  return { ctx, page };
}
async function check(page, label) {
  const extra = await page.evaluate(() => ({ csp: window.__csp || [], native: window.__native || [] })).catch(() => ({ csp: [], native: [] }));
  const all = [...page.errors, ...extra.csp.map((x) => 'csp-event: ' + x), ...extra.native.map((x) => 'native-dialog: ' + x)];
  if (all.length) problems.push(`[${label}] ${all.join(' | ')}`);
  page.errors.length = 0;
  return all;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: join(OUT, name + '.png'), ...opts });

async function guest(page, kind = 'sample') {
  await page.goto(BASE);
  await page.click(`form[action="auth/guest.php"] button[value="${kind}"]`);
  await page.waitForURL(/app\.php/);
  await page.waitForSelector('#tab-board .toolbar');
  await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state')?.textContent || ''));
}
const store = (page) => page.evaluate(async () => { const m = await import('./assets/store.js'); return JSON.parse(JSON.stringify(m.store.doc)); });
const toastText = async (page, re, timeout = 8000) => {
  try {
    await page.waitForFunction((src) => [...document.querySelectorAll('.swal2-toast, #toast:not([hidden])')].some((e) => new RegExp(src).test(e.textContent)), re.source, { timeout });
  } catch (e) {
    const now = await page.evaluate(() => [...document.querySelectorAll('.swal2-popup, #toast:not([hidden])')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' || '));
    throw new Error(`ไม่พบ toast ${re} · ที่แสดงอยู่: ${now}`);
  }
};
async function forceSave(page) {
  await page.evaluate(() => document.querySelector('#save-state').click());
  await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state').textContent), null, { timeout: 15000 });
}
async function gotoTab(page, t) { await page.click(`.tabs [data-tab="${t}"]`); await page.waitForTimeout(300); }
async function dataSection(page, k) { await gotoTab(page, 'data'); await page.click(`[data-sec="${k}"]`); await page.waitForTimeout(200); }
const pageWidth = (p) => p.evaluate(() => document.documentElement.scrollWidth);
const running = (p) => p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
  const t = a.effect?.target;
  return `${a.animationName || a.constructor.name} @ ${t ? t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : '') : '?'}${a.effect?.pseudoElement || ''}`;
}));
/** สแกน computed style ทั้งหน้า: สีเขียว (hue 75–165, sat > 0.2) และแถบสีขอบซ้าย (คัดลอกจาก timetable.e2e.mjs) */
const scanStyle = (p) => p.evaluate(() => {
  const parse = (s) => [...String(s).matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(/[ ,/]+/).filter(Boolean).map(Number));
  const green = (c) => {
    const [r, g, b, a = 1] = c;
    if (a < 0.05) return false;
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, dd = mx - mn;
    if (!dd) return false;
    const s = dd / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / dd) % 6 : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4;
    h = (h * 60 + 360) % 360;
    return h >= 75 && h <= 165 && s > 0.2;
  };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const greens = [], bars = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const props = [['background-color', cs.backgroundColor], ['background-image', cs.backgroundImage], ['fill', cs.fill], ['stroke', cs.stroke]];
    if (hasText) props.push(['color', cs.color]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + side + 'Width']) > 0) props.push(['border-' + side.toLowerCase(), cs['border' + side + 'Color']]);
    for (const [k, v] of props) if (parse(v).some(green)) { greens.push(`${name(e)} ${k}=${v}`); break; }
    const bl = parseFloat(cs.borderLeftWidth);
    if (bl >= 2 && cs.borderLeftStyle !== 'none' && (parse(cs.borderLeftColor)[0]?.[3] ?? 1) > 0.05) {
      const others = ['Top', 'Right', 'Bottom'].map((s) => [parseFloat(cs['border' + s + 'Width']), cs['border' + s + 'Color']]);
      if (others.some(([w, c]) => w < bl || c !== cs.borderLeftColor)) bars.push(`${name(e)} border-left ${cs.borderLeftWidth} ${cs.borderLeftColor}`);
    }
    if (/inset\s+[2-9]\d*px\s+0/.test(cs.boxShadow) || /^rgba?\([^)]*\)\s+[2-9]\d*px\s+0px\s+0px\s+0px\s+inset/.test(cs.boxShadow)) bars.push(`${name(e)} box-shadow ${cs.boxShadow}`);
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(e, pe);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      let w = parseFloat(ps.width), h = parseFloat(ps.height);
      if (Number.isNaN(w) && cs.display.includes('grid') && ps.position === 'static') w = parseFloat(cs.gridTemplateColumns);
      if (Number.isNaN(h) && /absolute|fixed/.test(ps.position) && !Number.isNaN(parseFloat(ps.top)) && !Number.isNaN(parseFloat(ps.bottom))) h = e.clientHeight - parseFloat(ps.top) - parseFloat(ps.bottom);
      if (Number.isNaN(h) && ps.position === 'static' && /grid|flex/.test(cs.display) && /stretch|normal/.test(ps.alignSelf)) h = e.clientHeight - pad;
      const painted = (parse(ps.backgroundColor)[0]?.[3] ?? (parse(ps.backgroundColor).length ? 1 : 0)) > 0.05 || ps.backgroundImage !== 'none';
      if (painted && parse(ps.backgroundColor).some(green)) greens.push(`${name(e)}${pe} background=${ps.backgroundColor}`);
      if (painted && w >= 2 && w <= 8 && h >= w * 2.5) bars.push(`${name(e)}${pe} ${w}x${h}px ${ps.backgroundColor}`);
    }
  }
  return { greens: [...new Set(greens)].slice(0, 15), bars: [...new Set(bars)].slice(0, 15) };
});
async function assertStyle(p, label) {
  const s = await scanStyle(p);
  assert.deepEqual(s.greens, [], `${label}: พบสีเขียว`);
  assert.deepEqual(s.bars, [], `${label}: พบแถบสีขอบซ้าย`);
}

// ---------------------------------------------------------------- (ก) หน้าแรก: ลดภาพเคลื่อนไหว
await test('หน้าแรก reduced-motion: ไม่มีแอนิเมชันวิ่งเลย (รวมเงาใต้ครูบูรณ์ .boon::after) · ตัวเลขจริงทันที', async () => {
  const h = await open({ width: 1366, height: 900 }, { ctx: { reducedMotion: 'reduce' } });
  await h.page.goto(BASE);
  await h.page.waitForTimeout(1200);
  assert.deepEqual(await running(h.page), [], 'แอนิเมชันที่ยังวิ่งอยู่');
  const st = await h.page.evaluate(() => { const b = document.querySelector('.stat b[data-count]'); return [b.textContent.replace(/\D/g, ''), b.dataset.count]; });
  assert.equal(st[0], st[1]);
  assert.equal(await h.page.locator('.reveal').count(), 0, 'ลดภาพเคลื่อนไหว = ไม่ซ่อนอะไรรอไหลเข้า');
  // เลื่อนลงจนสุดก็ยังไม่มีอะไรวิ่ง
  await h.page.mouse.wheel(0, 4000); await h.page.waitForTimeout(600);
  assert.deepEqual(await running(h.page), [], 'หลังเลื่อนลง');
  assert.deepEqual(await check(h.page, 'index reduce'), []);
  await h.ctx.close();
});

await test('หน้าแรก html.tt-still (ปุ่มหยุดภาพเคลื่อนไหว): ไม่มีแอนิเมชันวิ่ง', async () => {
  const h = await open();
  await h.page.addInitScript(() => { try { localStorage.setItem('tt-still', '1'); } catch { /* */ } });
  await h.page.goto(BASE);
  await h.page.waitForTimeout(1200);
  assert.ok(await h.page.evaluate(() => document.documentElement.classList.contains('tt-still')));
  assert.deepEqual(await running(h.page), []);
  assert.deepEqual(await check(h.page, 'index still'), []);
  await h.ctx.close();
});

await test('หน้าแรก ปิด JavaScript: ไม่มีอะไรเริ่มที่ opacity 0 (เนื้อหาเห็นครบ)', async () => {
  const h = await open({ width: 1366, height: 900 }, { ctx: { javaScriptEnabled: false } });
  await h.page.goto(BASE);
  const hidden = await h.page.evaluate(() => [...document.querySelectorAll('.feat, .how li, .sister, .support > *')].filter((e) => getComputedStyle(e).opacity === '0').length);
  assert.equal(hidden, 0);
  await h.ctx.close();
});

// ---------------------------------------------------------------- (ข) หน้าแรก 1366 / 390
await test('หน้าแรก 1366: ส่วนล่าง .reveal ไหลเข้าเมื่อเลื่อนถึง (ไม่ค้างซ่อน) · ตัวเลขนับถึง data-count · ป้ายจัดครบเด้ง · ไม่มีสีเขียว', async () => {
  const h = await open();
  const p = h.page;
  await p.goto(BASE);
  await p.waitForTimeout(400);
  const n0 = await p.locator('.reveal').count();
  assert.ok(n0 > 0, 'มีส่วนล่างที่รอไหลเข้า');
  assert.equal(await p.locator('.hero .reveal').count(), 0, 'hero (LCP) ไม่ถูกซ่อน');
  // เลื่อนลงทีละจอ
  for (let y = 0; y < 6000; y += 500) { await p.mouse.wheel(0, 500); await p.waitForTimeout(120); }
  await p.waitForTimeout(1300);
  assert.equal(await p.locator('.reveal:not(.is-in)').count(), 0, 'ทุกส่วนเข้ามาแล้ว');
  const op = await p.evaluate(() => [...document.querySelectorAll('.feat, .how li, .sister, .support > *')].map((e) => getComputedStyle(e).opacity));
  assert.ok(op.every((o) => o === '1'), op.join(','));
  const st = await p.evaluate(() => { const b = document.querySelector('.stat b[data-count]'); return [b.textContent.replace(/\D/g, ''), b.dataset.count]; });
  assert.equal(st[0], st[1], 'ตัวเลขโรงเรียน');
  await p.mouse.wheel(0, -8000); await p.waitForTimeout(3200);
  await shot(p, 's01-index-1366');
  await assertStyle(p, 'index 1366');
  assert.deepEqual(await check(p, 'index 1366'), []);
  await h.ctx.close();
});

await test('หน้าแรก 390: ไม่ล้นแนวนอน · ไม่มีสีเขียว/แถบขอบซ้าย', async () => {
  const h = await open({ width: 390, height: 844 });
  await h.page.goto(BASE);
  await h.page.waitForTimeout(800);
  for (let y = 0; y < 9000; y += 600) { await h.page.mouse.wheel(0, 600); await h.page.waitForTimeout(80); }
  await h.page.waitForTimeout(900);
  assert.ok((await pageWidth(h.page)) <= 390, 'กว้าง ' + (await pageWidth(h.page)));
  await assertStyle(h.page, 'index 390');
  assert.deepEqual(await check(h.page, 'index 390'), []);
  await h.ctx.close();
});

// ---------------------------------------------------------------- (ค)(ง) ตัวช่วย → วางรายชื่อ → เติมครู
const TEACHERS8 = [
  'นางสาวสมศรี ใจดี\tภาษาไทย\tป.1-2',
  'นายสมชาย รักเรียน\tคณิตศาสตร์\tป.3',
  'นางมาลี สีสวย\tวิทยาศาสตร์\tป.4',
  'ด.ต.ประสิทธิ์ กล้าหาญ\tสังคมศึกษา\tป.5',
  'นางสาวกาญจนา แก้วใส\tภาษาไทย\tป.6',
  'นายจอห์น สมิธ\tภาษาอังกฤษ\t',
  'นายวีระ แข็งแรง\tสุขศึกษาและพลศึกษา\t',
  'นางสาวดวงใจ ศิลป์งาม\tศิลปะ\t',
].join('\n');
const W = await open({ width: 1366, height: 900 }, { human: true });
const P = W.page;

await test('ตัวช่วย: พรีวิวโครงคาบสด = จำนวนคาบ (เปลี่ยนตามช่อง) · สรุป "จะได้" · ok → กล่องวางรายชื่อครูเปิดเอง → ปิดได้', async () => {
  await guest(P, 'sample-primary');
  await P.selectOption('#term-select', '__new');
  await P.waitForSelector('.swal2-popup #nt-kind');
  await P.selectOption('#nt-kind', 'blank:primary');
  await P.fill('#nt-name', 'ทดสอบเชลล์ 1/2570');
  await P.click('.swal2-confirm');
  await P.waitForSelector('dialog[open] #wz-title', { timeout: 15000 });
  const pv = () => P.locator('dialog[open] .wz-preview .pv:not(.b):not(.m-out)').count();
  await P.click('dialog[open] [data-preset="0"]');
  assert.equal(await P.inputValue('#wz-count'), '6');
  assert.equal(await pv(), 6, 'กล่องคาบ = 6');
  assert.equal(await P.locator('dialog[open] .wz-preview .pv.b').count(), 1, 'ช่องพัก 1');
  const h0 = await P.evaluate(() => document.querySelector('dialog[open]').offsetHeight);
  await P.fill('#wz-count', '7');
  await P.waitForTimeout(500);
  assert.equal(await pv(), 7, 'เพิ่มเป็น 7 คาบ');
  const h1 = await P.evaluate(() => document.querySelector('dialog[open]').offsetHeight);
  assert.equal(Math.round(h0), Math.round(h1), 'ความสูงกล่องไม่เปลี่ยนเมื่อพรีวิวเปลี่ยน');
  await P.fill('#wz-count', '6');
  await P.waitForTimeout(500);
  assert.equal(await pv(), 6);
  await P.waitForTimeout(800);
  const sum = await P.locator('dialog[open] [data-sum]').textContent();
  assert.match(sum, /จะได้: ห้อง 6 · วิชา \d+ · การสอน \d+ · คาบล็อก \d+/);
  await shot(P, 's02-wizard');
  await assertStyle(P, 'wizard');
  await P.click('dialog[open] [data-ok]');
  await P.waitForSelector('dialog[open] [data-text]', { timeout: 8000 });
  assert.equal(await P.locator('dialog[open] #wz-title').count(), 0);
  assert.match(await P.locator('dialog[open] h3').first().textContent(), /วางรายชื่อครู/);
  assert.equal(await P.getAttribute('.tabs [data-tab="data"]', 'aria-selected'), 'true', 'พาไปแท็บข้อมูล');
  await P.click('dialog[open] [data-close]');
  await P.waitForSelector('dialog[open]', { state: 'detached' });
  await P.waitForTimeout(1000);
  const nav = await P.evaluate(() => Object.fromEntries([...document.querySelectorAll('.data-nav .nav-n')].map((s) => [s.dataset.k, s.textContent])));
  const d = await store(P);
  assert.equal(nav.classes, String(d.classes.length), 'ชิปห้องเรียน = จริง');
  assert.equal(nav.assignments, String(d.assignments.length), 'ชิปการสอน = จริง');
});

await test('วางรายชื่อ 8 บรรทัด → ปุ่ม "เพิ่ม 8 คน" → tt:added ยิง (ids ตรง) → แถวใหม่มี .m-flash · ชิปครู = 8', async () => {
  await P.evaluate(() => { window.__added = []; document.addEventListener('tt:added', (e) => window.__added.push(e.detail)); });
  await P.click('[data-paste="teachers"]');
  await P.fill('dialog[open] [data-text]', TEACHERS8);
  await P.click('dialog[open] [data-next]');
  await P.waitForSelector('dialog[open] .imp-table');
  assert.equal(await P.locator('dialog[open] .imp-table tbody tr').count(), 8);
  assert.match(await P.locator('dialog[open] [data-ok]').textContent(), /8/);
  await P.waitForTimeout(900);
  assert.match(await P.locator('dialog[open] [data-ok] [aria-hidden]').textContent(), /เพิ่ม 8 คน/, 'ตัวเลขนับถึง 8');
  await P.click('dialog[open] [data-ok]');
  await toastText(P, /เพิ่มครู 8 คน/);
  const added = await P.evaluate(() => window.__added);
  const d = await store(P);
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'teachers');
  assert.deepEqual(added[0].ids.slice().sort(), d.teachers.map((t) => t.id).sort());
  const flashed = await P.evaluate((ids) => ids.filter((id) => document.querySelector(`#data-body tr[data-id="${id}"] td.m-flash`)).length, added[0].ids);
  assert.equal(flashed, 8, 'แถวใหม่ทุกแถวมีพื้นทองจาง');
  // แถบขั้นตอน: ขั้น 1 (ครู) เพิ่งเสร็จ → วงกลมเด้ง + เช็กวาดเส้น · ขั้นปัจจุบันใหม่ (ขั้น 2) เล่นเข้า
  assert.equal(await P.locator('#tt-steps li:nth-child(1) button.done.just-done').count(), 1, 'ขั้น 1 just-done');
  assert.equal(await P.locator('#tt-steps li:nth-child(2) button.cur.cur-new').count(), 1, 'ขั้น 2 cur-new');
  await P.waitForTimeout(900);
  assert.equal(await P.locator('.data-nav .nav-n[data-k="teachers"]').textContent(), '8');
  await assertStyle(P, 'data teachers');
});

await test('เติมครูอัตโนมัติ: ปุ่ม .btn-busy ≥ 300ms → tt:autoassigned {changed,left} → ghost ลบตัวเองหมดใน 2 วิ · ช่องครูพื้นทองจาง', async () => {
  await P.evaluate(() => { window.__aa = []; document.addEventListener('tt:autoassigned', (e) => window.__aa.push(e.detail)); });
  await P.click('[data-sec="assignments"]');
  await P.waitForTimeout(200);
  const n0 = (await store(P)).assignments.filter((a) => !a.teacherId).length;
  await P.click('[data-auto]');
  const busy = await P.evaluate(() => document.querySelector('[data-auto]')?.classList.contains('btn-busy') && document.querySelector('[data-auto]').disabled);
  assert.ok(busy, 'ปุ่มหมุน + กดซ้ำไม่ได้');
  await toastText(P, /เติมครู \d+ แถว/);
  const aa = await P.evaluate(() => window.__aa);
  assert.equal(aa.length, 1);
  const d = await store(P);
  const left = d.assignments.filter((a) => !a.teacherId).length;
  assert.equal(aa[0].left, left);
  assert.equal(aa[0].changed.length, n0 - left);
  assert.ok(left <= Math.floor(n0 * 0.1), `ยังไม่มีครู ${left}/${n0}`);
  await P.waitForTimeout(2000);
  assert.equal(await P.locator('.m-ghost').count(), 0, 'ghost ค้าง');
  await shot(P, 's03-autoassign');
  await assertStyle(P, 'data assignments');
  // แบ่งสอน: แถว 1 คาบ/สัปดาห์กดไม่ได้ พร้อมเหตุผล
  const one = await P.evaluate(() => [...document.querySelectorAll('.asg-table tbody tr')].find((tr) => tr.querySelector('input[data-f="perWeek"]')?.value === '1')?.querySelector('[data-split]')?.outerHTML || '');
  if (one) { assert.match(one, /disabled/); assert.match(one, /แบ่งได้เมื่อมี ≥2 คาบ/); }
  await forceSave(P);
  assert.deepEqual(await check(P, 'wizard/paste/auto'), []);
});

// ---------------------------------------------------------------- (จ) ส่งออก
await test('ส่งออก: ปุ่ม PDF .btn-busy → .btn-done → ได้ไฟล์ · ดูตัวอย่าง = dialog มี iframe · พิมพ์ = แท็บใหม่ ไม่เรียก window.print', async () => {
  const h = await open();
  const p = h.page;
  await guest(p, 'sample-primary');
  await gotoTab(p, 'export');
  await p.evaluate(() => {
    window.__seen = new Set();
    new MutationObserver((l) => { for (const m of l) if (m.target.classList) for (const c of ['btn-busy', 'btn-done']) if (m.target.classList.contains(c)) window.__seen.add(c); })
      .observe(document.querySelector('#tab-export'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.__printCalls = 0;
    window.print = () => { window.__printCalls++; throw new Error('ห้ามเรียก window.print'); };
  });
  const btn = p.locator('[data-pdf="class"][data-mode="each"]');
  const w0 = (await btn.boundingBox()).width;
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), btn.click()]);
  await dl.saveAs(join(OUT, 's-class.pdf'));
  await toastText(p, /สร้าง PDF เสร็จ ดาวน์โหลดแล้ว: .+\.pdf/, 30000);
  const seen = await p.evaluate(() => [...window.__seen]);
  assert.ok(seen.includes('btn-busy') && seen.includes('btn-done'), seen.join(','));
  assert.ok(Math.abs((await btn.boundingBox()).width - w0) < 1, 'ปุ่มไม่เปลี่ยนความกว้าง');
  await p.waitForTimeout(1600);
  assert.equal(await p.locator('.m-ghost').count(), 0, 'ไอคอนไฟล์บินแล้วหายเอง');
  assert.match(await btn.textContent(), /ตารางเรียนทุกห้อง/, 'ข้อความเดิมกลับมา');
  // ตารางสอนของฉัน (ครูคนเดียว 1 หน้า)
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('[data-mine="pdf"]')]);
  assert.match(dl2.suggestedFilename(), /^ตารางสอน-.+\.pdf$/);
  // ดูตัวอย่าง
  await p.click('[data-x="preview"]');
  await p.waitForSelector('dialog[open] iframe.pdf-prev[sandbox]', { timeout: 20000 });
  assert.match(await p.getAttribute('dialog[open] iframe.pdf-prev', 'srcdoc') || '', /ตารางเรียน/);
  await p.waitForTimeout(500);
  await shot(p, 's04-preview');
  await p.click('dialog[open] [data-close]');
  await p.waitForSelector('dialog[open]', { state: 'detached' });
  // พิมพ์ → แท็บใหม่
  const [pop] = await Promise.all([h.ctx.waitForEvent('page', { timeout: 30000 }), p.click('[data-x="print"]')]);
  assert.ok(pop, 'เปิดแท็บใหม่');
  await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => window.__printCalls), 0, 'ไม่เรียก window.print');
  await pop.close().catch(() => {});
  // Excel
  const [dl3] = await Promise.all([p.waitForEvent('download', { timeout: 90000 }), p.click('#x-xlsx')]);
  assert.match(dl3.suggestedFilename(), /\.xlsx$/);
  await toastText(p, /สร้าง Excel เสร็จ/, 30000);
  await assertStyle(p, 'export');
  assert.deepEqual(await check(p, 'export'), []);
  await h.ctx.close();
});

// ---------------------------------------------------------------- (ฉ) ทุกแท็บ + มือถือ
await test('ทุกแท็บ (จอกว้าง + 390): ไม่มีสีเขียว/แถบขอบซ้าย · 390 ไม่ล้น · เส้นใต้แท็บย้ายตามแท็บ', async () => {
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const h = await open(vp);
    const p = h.page;
    await guest(p, 'sample-primary');
    for (const t of ['data', 'periods', 'export', 'board']) {
      await gotoTab(p, t);
      await p.waitForTimeout(450); // เส้นใต้แท็บเลื่อนเสร็จ (--d-3)
      await assertStyle(p, `app ${t} ${vp.width}`);
      if (vp.width < 500) assert.ok((await pageWidth(p)) <= 390, `${t} 390 กว้าง ${await pageWidth(p)}`);
      const ink = await p.evaluate(() => {
        const i = document.querySelector('.tabs-ink'), b = document.querySelector('.tabs [aria-selected="true"]'), n = document.querySelector('.tabs');
        const m = /translateX\(([-\d.]+)px\)/.exec(i?.style.transform || '');
        const dx = m ? Math.abs(+m[1] - (b.getBoundingClientRect().left - n.getBoundingClientRect().left + n.scrollLeft)) : -1;
        // มีสไตล์ .tabs-ink (board.css) → ความกว้างที่เห็นจริงต้องเท่าแท็บ
        const dw = i.offsetWidth ? Math.abs(i.getBoundingClientRect().width - b.getBoundingClientRect().width) : 0;
        return { dx, dw };
      });
      assert.ok(ink.dx >= 0 && ink.dx < 1.5, `${t}: เส้นใต้แท็บไม่ตรงแท็บ (${ink.dx})`);
      assert.ok(ink.dw < 1.5, `${t}: เส้นใต้แท็บกว้างไม่เท่าแท็บ (${ink.dw})`);
    }
    assert.deepEqual(await check(p, 'tabs ' + vp.width), []);
    await h.ctx.close();
  }
});

assert.deepEqual(await check(P, 'final'), []);
await W.ctx.close();
await browser.close();
console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (problems.length) console.log('ปัญหาที่พบ:\n' + problems.join('\n'));
if (failed || problems.length) process.exit(1);
