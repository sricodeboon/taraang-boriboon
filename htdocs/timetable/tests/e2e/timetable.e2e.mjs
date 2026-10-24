// ทดสอบ e2e ในเบราว์เซอร์จริง (Playwright) — ไม่ขึ้นโฮสต์ (tests/.htaccess กันไว้)
// รัน: BASE=http://127.0.0.1:8123/timetable/ DB=<ไฟล์ sqlite ของสำเนาทดสอบ> OUT=<โฟลเดอร์ผล> PW=<โฟลเดอร์ที่มี node_modules/playwright> node tests/e2e/timetable.e2e.mjs
// ครอบ: SweetAlert2 (toast/ยืนยัน/พิมพ์ "ลบ"/เลิกทำ/409/ตัวสำรองเมื่อโหลด CDN ไม่ได้) · กันวิชาซ้ำ · แบ่งสอน · คาบ/สัปดาห์ตามหลักสูตร
// · ลบทั้งหมด+เลิกทำ · แนวตาราง 2 แบบ (ลากวาง/คาบล็อก/พัก) · PDF/Excel · ข้อมูลภาคเรียนแบบเก่า · จอ 390px · ไม่มี console error/CSP
// · รุ่น smart-boon: ลองใช้ประถม · ตัวช่วยเริ่มต้น (คละชั้น) · วางรายชื่อครู · เติมครูอัตโนมัติ · ติดแล้วกดแก้ให้เลย · จัดเฉพาะที่ขาด · Ctrl+Z
//   · ฟอร์มข้อเสนอแนะ (สำเร็จ/honeypot/เร็วเกิน) + admin-feedback · #donate · CLS ตอนเปิดแอป · สแกนสีเขียว/แถบขอบซ้ายจาก computed style
// ห้ามชี้ DB ไปที่ฐานข้อมูลจริง: สคริปต์ล้างตาราง rate_hits ของ DB ที่ให้มา (กันเพดานโหมดทดลองระหว่างทดสอบ)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(join(process.env.PW || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8123/timetable/';
const OUT = process.env.OUT || '/tmp/tt-e2e';
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

async function open(viewport = { width: 1366, height: 900 }, { blockSwal = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH', acceptDownloads: true, deviceScaleFactor: 1, hasTouch: viewport.width < 500 });
  if (blockSwal) await ctx.route(/sweetalert2/, (r) => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    // alert/confirm/prompt ของเบราว์เซอร์ต้องไม่ถูกเรียกเลย
    for (const k of ['alert', 'confirm', 'prompt']) window[k] = (...a) => { (window.__native ||= []).push(k + ':' + a[0]); return false; };
  });
  page.on('console', (m) => {
    const t = m.text();
    // 409 = ทดสอบชนกันโดยตั้งใจ (เบราว์เซอร์พิมพ์ network error ลง console เอง)
    if (m.type() === 'error' && !(blockSwal && /sweetalert2|ERR_FAILED/.test(t)) && !/status of 409/.test(t)) page.errors.push('console: ' + t);
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
  // เพดานโหมดทดลอง 10 ครั้ง/ชม./IP (guest.php) — ทั้งไฟล์ล็อกอินทดลองเกิน 10 ครั้ง → ล้างเฉพาะถังโหมดทดลองของ DB ทดสอบก่อนทุกครั้ง
  if (DB && /scratchpad|tmp/.test(DB)) try { execFileSync('sqlite3', [DB, "DELETE FROM rate_hits WHERE bucket LIKE 'guest:%' OR bucket LIKE 'gk:%'"]); } catch { /* ยังไม่มีตาราง */ }
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
/** รอผลจัดอัตโนมัติ (รุ่น delight: ไม่มี modal สรุปแล้ว — บอกที่เดียวในกล่องรายงานเหนือตาราง + toast สั้น)
 *  รอให้ฉากจัดจบ (#tab-board[data-solve] ไม่ใช่ "run") แล้ว: วางไม่ครบ = .callout มี "วางไม่ลง N คาบ|ยังขาด" · ครบ = toast "จัดเสร็จ|วางเพิ่ม" · คืนข้อความที่เห็น */
async function solveDone(page, timeout = 60000) {
  const h = await page.waitForFunction(() => {
    if (document.querySelector('#tab-board')?.dataset.solve === 'run') return false;
    const m = document.querySelector('.swal2-popup:not(.swal2-toast)');
    if (m && /วางไม่ลง|ยังขาด/.test(m.textContent)) return 'modal:' + m.textContent; // ต้องไม่เกิดแล้ว (ตรวจด้านล่าง)
    const c = document.querySelector('#tab-board .callout[data-report]');
    if (c && /วางไม่ลง \d+ คาบ|ยังขาด/.test(c.textContent)) return 'callout:' + c.textContent.replace(/\s+/g, ' ');
    const t = [...document.querySelectorAll('.swal2-toast, #toast:not([hidden])')].find((e) => /จัดเสร็จ|วางเพิ่ม/.test(e.textContent));
    return t ? 'toast:' + t.textContent : false;
  }, null, { timeout });
  const txt = await h.jsonValue();
  assert.ok(!txt.startsWith('modal:'), 'ผลจัดต้องไม่เปิดกล่อง modal ซ้ำกับรายงาน: ' + txt.slice(0, 80));
  return txt;
}
/** มือถือ: ปุ่ม "ล้างที่ไม่ปักหมุด"/แนวตาราง อยู่ในเมนู ⋯ ของแถบเครื่องมือ → กางก่อนกด */
async function tbMore(page) {
  if (await page.locator('#tab-board .tb-more:not([open]) > summary').count()) await page.click('#tab-board .tb-more > summary');
}
async function gotoTab(page, t) { await page.click(`.tabs [data-tab="${t}"]`); await page.waitForTimeout(150); }
async function dataSection(page, k) { await gotoTab(page, 'data'); await page.click(`[data-sec="${k}"]`); await page.waitForTimeout(150); }
async function drag(page, from, to) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------- จอกว้าง
const { ctx, page } = await open();

await test('โหมดทดลอง: flash เป็น toast SweetAlert2 (ไม่ใช่เขียว) · แนวตารางเริ่มที่ วันเรียงลงล่าง', async () => {
  await guest(page);
  await toastText(page, /โหมดทดลอง/);
  const icon = await page.evaluate(() => { const i = document.querySelector('.swal2-toast .swal2-icon.swal2-success'); return i ? getComputedStyle(i).borderColor : null; });
  if (icon) assert.equal(icon, 'rgb(31, 95, 168)', 'ไอคอนสำเร็จต้องเป็นน้ำเงินโขง');
  assert.equal(await page.getAttribute('.tt', 'data-orient'), 'days');
  assert.equal(await page.locator('.tt thead th').first().textContent(), 'วัน');
  assert.equal(await page.locator('.tt tbody tr').count(), 5, 'แถว = 5 วัน');
  assert.equal(await page.locator('.tt td.brk-col').count(), 1, 'ช่องพักเป็นคอลัมน์เดียวรวมทุกวัน');
  await shot(page, '01-board-days-empty');
});

await test('ลากวาง (วันเรียงลงล่าง): วางได้ ปักหมุด · วางทับคาบล็อกไม่ได้ · ช่องพักไม่มีเป้าวาง', async () => {
  const chip = page.locator('.chip[data-asg]').first();
  const target = page.locator('.tt tbody tr').nth(0).locator('td[data-day]').first();
  await drag(page, chip, target);
  let d = await store(page);
  assert.equal(d.placements.length, 1);
  assert.equal(d.placements[0].day, 0); assert.equal(d.placements[0].period, 0); assert.equal(d.placements[0].pinned, true);
  assert.equal(await page.locator('.tt .cell').count(), 1);
  // คาบล็อก (พุธ คาบ 7 ของ ม.1/1 ในข้อมูลตัวอย่าง)
  const lock = page.locator('.tt td.lock').first();
  await drag(page, page.locator('.chip[data-asg]').first(), lock);
  await toastText(page, /วางไม่ได้: คาบล็อก/);
  d = await store(page);
  assert.equal(d.placements.length, 1);
  assert.equal(await page.locator('.tt td.brk-col[data-day]').count(), 0);
});

await test('สลับแนวตาราง → คาบเรียงลงล่าง: ลากวางยังได้ · คาบคู่วางต่อกัน · บันทึกเป็นค่าของภาคเรียน', async () => {
  await page.click('[data-orient="periods"]');
  assert.equal(await page.getAttribute('.tt', 'data-orient'), 'periods');
  assert.equal(await page.locator('.tt thead th').first().textContent(), 'คาบ');
  assert.equal(await page.locator('.tt tr.brk').count(), 1);
  const cell = page.locator('.tt tbody tr').nth(1).locator('td[data-day]').nth(1); // คาบ 2 วันอังคาร
  await drag(page, page.locator('.chip[data-asg]').nth(2), cell);
  const d = await store(page);
  assert.equal(d.settings.orientation, 'periods');
  assert.ok(d.placements.some((p) => p.day === 1 && p.period === 1), JSON.stringify(d.placements));
  await forceSave(page);
  await page.reload();
  await page.waitForSelector('.tt');
  assert.equal(await page.getAttribute('.tt', 'data-orient'), 'periods', 'รีโหลดแล้วยังเป็นแนวเดิม');
  await shot(page, '02-board-periods');
  await page.click('[data-orient="days"]');
});

await test('จัดอัตโนมัติ: มีคาบแล้ว → เมนู 2 ข้อ → จัดใหม่ทั้งหมด (ยืนยัน) → จัดเสร็จ N คาบ · ไม่มีจุดชน', async () => {
  await page.click('#auto-solve');
  await page.waitForSelector('.cell-menu [data-mode="missing"]');
  await page.click('.cell-menu [data-mode="all"]');
  // คาบที่ลากวางถูกปักหมุดหมด → ไม่มีคาบที่จะถูกย้าย จึงไม่ถามยืนยัน (ถามเฉพาะเมื่อมีคาบที่ไม่ได้ปักหมุด)
  if (await page.locator('.swal2-popup:not(.swal2-toast) .swal2-title', { hasText: 'จัดใหม่ทั้งหมด' }).isVisible().catch(() => false)) await page.click('.swal2-confirm');
  await toastText(page, /จัดเสร็จ \d+ คาบ|วางไม่ลง/, 30000);
  const d = await store(page);
  const need = d.assignments.reduce((n, a) => n + a.perWeek, 0);
  assert.equal(d.placements.length, need, `จัด ${d.placements.length}/${need}`);
  assert.match(await page.locator('.toolbar .pill').nth(0).textContent(), /ไม่มีจุดชน/);
  await page.waitForTimeout(600);
  await shot(page, '03-board-days-solved');
});

await test('แท็บวิชา: "สอนใน N ห้องเรียน" + คาบ/สัปดาห์ตามหลักสูตร (ติดจากรหัส) + คำใบ้ชั่วโมง', async () => {
  await dataSection(page, 'subjects');
  const headers = await page.locator('#data-body thead th').allTextContents();
  assert.ok(headers.some((h) => /คาบ\/สัปดาห์/.test(h) && /หลักสูตร/.test(h)), headers.join('|'));
  assert.ok(!headers.some((h) => /ใช้ในการสอน/.test(h)));
  assert.match(await page.locator('#data-body tbody tr').first().textContent(), /สอนใน 2 ห้องเรียน/);
  const v = await page.locator('#data-body tbody tr').first().locator('input[data-f="perWeek"]').inputValue();
  assert.equal(v, '3'); // ท21101 = 3 คาบ/สัปดาห์
  assert.match(await page.locator('#data-body tbody tr').first().locator('.pw-hint').textContent(), /60 ชม\.\/ภาค/);
  assert.match(await page.locator('.data-head p').textContent(), /1 คาบ = 50 นาที/);
  await shot(page, '04-subjects');
});

await test('แท็บการสอน: dropdown วิชาไม่มีวิชาที่ห้องนี้มีแล้ว · แบ่งสอน 2 ครู ไม่เตือน · รวมกลับ', async () => {
  await dataSection(page, 'assignments');
  const rows = page.locator('.asg-table tbody tr');
  const n = await rows.count();
  const opts = await rows.nth(1).locator('select[data-f="subjectId"] option').evaluateAll((o) => o.map((x) => x.value));
  const used = await rows.evaluateAll((r) => r.map((tr) => tr.querySelector('select[data-f="subjectId"]').value));
  const mine = used[1];
  for (const u of used) if (u !== mine) assert.ok(!opts.includes(u), 'วิชาที่ห้องนี้มีแล้วต้องไม่อยู่ในตัวเลือก ' + u);
  assert.ok(opts.includes(mine));
  // แบ่งสอนแถวแรก (ภาษาไทย 3 คาบ → 2 + 1)
  await rows.nth(0).locator('[data-split]').click();
  await toastText(page, /แบ่งสอนแล้ว/);
  assert.equal(await rows.count(), n + 1);
  assert.match(await rows.nth(0).textContent(), /แบ่งสอน 1\/2/);
  assert.match(await rows.nth(1).textContent(), /แบ่งสอน 2\/2/);
  assert.equal(await rows.nth(0).locator('.pill.soft').count(), 0, 'รวม 2+1 = 3 เท่าหลักสูตร → ไม่เตือน');
  const t0 = await rows.nth(0).locator('select[data-f="teacherId"]').inputValue(), t1 = await rows.nth(1).locator('select[data-f="teacherId"]').inputValue();
  assert.notEqual(t0, t1);
  // เพิ่มคาบแถวที่สองจนเกิน → เตือนเบา ๆ
  await rows.nth(1).locator('input[data-f="perWeek"]').fill('3');
  await rows.nth(1).locator('input[data-f="perWeek"]').dispatchEvent('change');
  await page.waitForTimeout(150);
  assert.match(await page.locator('.asg-table tbody tr').nth(0).locator('.pill.soft').textContent(), /หลักสูตร 3 คาบ\/สัปดาห์ · รวมตอนนี้ 5/);
  await shot(page, '05-assign-split');
  await page.locator('.asg-table tbody tr').nth(0).locator('[data-unsplit]').click();
  await page.click('.swal2-confirm');
  await toastText(page, /รวมกลับเป็นแถวเดียวแล้ว/);
  assert.equal(await page.locator('.asg-table tbody tr').count(), n);
  await page.locator('.asg-table tbody tr').nth(0).locator('input[data-f="perWeek"]').fill('3');
  await page.locator('.asg-table tbody tr').nth(0).locator('input[data-f="perWeek"]').dispatchEvent('change');
});

await test('ลบทั้งหมด (เฉพาะห้องที่กรอง): ต้องพิมพ์ "ลบ" · บอกจำนวน · เลิกทำ 10 วิคืนครบรวมคาบที่วาง', async () => {
  const before = await store(page);
  const cls = await page.locator('#flt').inputValue();
  const mineIds = new Set(before.assignments.filter((a) => a.classId === cls).map((a) => a.id));
  const mineP = before.placements.filter((p) => mineIds.has(p.assignmentId)).length;
  await page.click('[data-del-all]');
  await page.waitForSelector('.swal2-popup .swal2-input');
  const html = await page.locator('.swal2-html-container').textContent();
  assert.match(html, new RegExp(`การสอน ${mineIds.size} รายการ`));
  assert.match(html, new RegExp(`${mineP} คาบ`));
  await shot(page, '06-delete-all-confirm');
  await page.fill('.swal2-input', 'ลบบ');
  await page.click('.swal2-confirm');
  await page.waitForSelector('.swal2-validation-message:visible');
  await page.fill('.swal2-input', 'ลบ');
  await page.keyboard.press('Enter');
  await toastText(page, /ลบการสอน \d+ รายการ/);
  let d = await store(page);
  assert.equal(d.assignments.length, before.assignments.length - mineIds.size);
  assert.equal(d.placements.length, before.placements.length - mineP);
  assert.equal(d.assignments.filter((a) => a.classId !== cls).length, before.assignments.filter((a) => a.classId !== cls).length, 'ห้องอื่นไม่ถูกลบ');
  await shot(page, '07-undo-toast');
  await page.click('.swal2-toast .swal2-confirm');
  await toastText(page, /คืนข้อมูลแล้ว/);
  d = await store(page);
  assert.deepEqual(d.assignments, before.assignments);
  assert.equal(d.placements.length, before.placements.length);
});

await test('ลบวิชาทั้งหมด + เลิกทำ · ลบการสอนทุกห้อง (ดูทุกห้อง)', async () => {
  const before = await store(page);
  await dataSection(page, 'subjects');
  await page.click('[data-del-all]');
  await page.fill('.swal2-input', 'ลบ');
  await page.click('.swal2-confirm');
  await toastText(page, /ลบวิชา \d+ วิชา/);
  let d = await store(page);
  assert.equal(d.subjects.length, 0); assert.equal(d.assignments.length, 0); assert.equal(d.placements.length, 0);
  await page.click('.swal2-toast .swal2-confirm');
  await toastText(page, /คืนข้อมูลแล้ว/);
  d = await store(page);
  assert.equal(d.subjects.length, before.subjects.length); assert.equal(d.assignments.length, before.assignments.length); assert.equal(d.placements.length, before.placements.length);
  // ดูทุกห้อง → ปุ่มเป็น "ลบการสอนทั้งหมด" · ยกเลิก = ไม่ลบ
  await dataSection(page, 'assignments');
  await page.selectOption('#flt', '');
  assert.match(await page.locator('[data-del-all]').textContent(), /ลบการสอนทั้งหมด/);
  await page.click('[data-del-all]');
  assert.match(await page.locator('.swal2-html-container').textContent(), new RegExp(`การสอน ${before.assignments.length} รายการ ของทุกห้อง`));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal((await store(page)).assignments.length, before.assignments.length);
});

await test('ปล่อยให้ toast เลิกทำหมดเวลา 10 วิ → ลบจริง และ autosave ระหว่างนั้นไม่ทับปุ่มเลิกทำ', async () => {
  await dataSection(page, 'assignments');
  const cls = (await store(page)).classes[1].id;
  await page.selectOption('#flt', cls);
  const n0 = (await store(page)).assignments.length;
  const k = (await store(page)).assignments.filter((a) => a.classId === cls).length;
  await page.click('[data-del-all]');
  await page.fill('.swal2-input', 'ลบ');
  await page.click('.swal2-confirm');
  await page.waitForTimeout(5000);
  assert.equal(await page.locator('.swal2-toast .swal2-confirm:visible').count(), 1, 'ยังมีปุ่มเลิกทำหลัง 5 วิ');
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('.swal2-toast .swal2-confirm:visible').count(), 0);
  assert.equal((await store(page)).assignments.length, n0 - k);
  await forceSave(page);
});

await test('ข้อมูลภาคเรียนแบบเก่า (ไม่มี settings, ไม่มี perWeek, การสอนซ้ำ) เปิดได้ ไม่พัง + ป้าย "ซ้ำ" + ปุ่มรวม', async () => {
  const r = await page.evaluate(async () => {
    const { store } = await import('./assets/store.js');
    const d = JSON.parse(JSON.stringify(store.doc));
    delete d.settings;
    for (const s of d.subjects) delete s.perWeek;
    const a = d.assignments.find((x) => x.classId === d.classes[0].id);
    d.assignments.push({ ...a, id: 'legacyDup', teacherId: d.teachers[5].id, perWeek: 1, doubles: 0 });
    const res = await fetch('api.php?r=term.save', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': window.TT.csrf }, body: JSON.stringify({ id: store.termId, version: store.version, data: d }) });
    return { status: res.status, j: await res.json() };
  });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await page.reload();
  await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state')?.textContent || ''));
  await gotoTab(page, 'board');
  assert.equal(await page.getAttribute('.tt', 'data-orient'), 'days');
  const d = await store(page);
  assert.ok(d.subjects.filter((s) => s.perWeek > 0).length >= 60, 'เติมคาบ/สัปดาห์จากหลักสูตร');
  await dataSection(page, 'assignments');
  await page.selectOption('#flt', d.classes[0].id);
  await page.waitForSelector('.dup-note');
  assert.equal(await page.locator('.asg-table tr.dup-row').count(), 2);
  await shot(page, '08-legacy-dup');
  await page.locator('.asg-table [data-merge]').first().click();
  await page.waitForSelector('.swal2-deny');
  await page.click('.swal2-confirm'); // รวมเป็นแถวเดียว
  await toastText(page, /รวมเป็นแถวเดียวแล้ว/);
  assert.equal(await page.locator('.asg-table tr.dup-row').count(), 0);
  assert.equal((await store(page)).assignments.some((a) => a.id === 'legacyDup'), false);
});

await test('หน้าแอดมินนับข้อมูลได้ (json_array_length กับ data_json ที่มี settings) — ตรวจผ่าน SQL ตรง', async () => {
  if (!DB) return;
  const out = execFileSync('sqlite3', [DB, "SELECT json_array_length(data_json,'$.assignments'), json_extract(data_json,'$.settings.orientation') FROM terms ORDER BY id DESC LIMIT 1"]).toString().trim();
  assert.match(out, /^\d+\|(days|periods)?$/, out); // ข้อมูลเก่าไม่มี settings ก็นับได้
});

await test('ส่งออก: สลับแนวในหน้าส่งออก · PDF รายห้อง วันเรียงลงล่าง A4 แนวนอน 1/2/4 ต่อหน้า · Excel', async () => {
  await gotoTab(page, 'export');
  await page.click('#tab-export [data-orient="days"]');
  await shot(page, '09-export');
  const files = {};
  for (const [per, name] of [[1, 'pdf-days-1'], [2, 'pdf-days-2'], [4, 'pdf-days-4']]) {
    await page.check(`input[name=per][value="${per}"]`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-pdf="class"][data-mode="each"]')]);
    const f = join(OUT, name + '.pdf'); await dl.saveAs(f); files[name] = f;
    await toastText(page, /สร้าง PDF เสร็จ/, 30000);
  }
  await page.click('#tab-export [data-orient="periods"]');
  await page.check('input[name=per][value="1"]');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-pdf="teacher"][data-mode="each"]')]);
  files['pdf-periods-teacher'] = join(OUT, 'pdf-periods-teacher.pdf'); await dl2.saveAs(files['pdf-periods-teacher']);
  await page.click('#tab-export [data-orient="days"]');
  const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#x-xlsx')]);
  files.xlsx = join(OUT, 'excel-days.xlsx'); await dl3.saveAs(files.xlsx);
  await toastText(page, /สร้าง Excel เสร็จ/, 30000);
  writeFileSync(join(OUT, 'files.json'), JSON.stringify(files, null, 1));
});

await test('409: สองแท็บแก้ครูคนเดียวกัน → กล่องเลือกฉบับ (SweetAlert2) · เลือกของหน้าจอนี้', async () => {
  await forceSave(page);
  const p2 = await ctx.newPage();
  p2.errors = [];
  p2.on('pageerror', (e) => p2.errors.push(e.message));
  await p2.goto(BASE + 'app.php');
  await p2.waitForSelector('.tt');
  for (const [pg, name] of [[p2, 'ครูจากแท็บสอง'], [page, 'ครูจากแท็บหนึ่ง']]) {
    await pg.click('.tabs [data-tab="data"]'); await pg.click('[data-sec="teachers"]');
    await pg.locator('#data-body input[data-f="name"]').first().fill(name);
    await pg.locator('#data-body input[data-f="name"]').first().dispatchEvent('change');
    await pg.evaluate(() => document.querySelector('#save-state').click());
    if (pg === p2) await pg.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state').textContent));
  }
  await page.waitForSelector('.swal2-popup .swal2-deny', { timeout: 15000 });
  assert.match(await page.locator('.swal2-html-container').textContent(), /ครู/);
  await shot(page, '10-conflict-409');
  await page.click('.swal2-confirm');
  await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state').textContent), null, { timeout: 15000 });
  assert.equal((await store(page)).teachers[0].name, 'ครูจากแท็บหนึ่ง');
  await p2.close();
});

await test('ไม่มี alert()/confirm()/prompt() ของเบราว์เซอร์ · ไม่มี console error / CSP ตลอดการทดสอบจอกว้าง', async () => {
  const all = await check(page, 'desktop');
  assert.deepEqual(all, []);
});

// ---------------------------------------------------------------- มือถือ 390px
await test('มือถือ 390px: ไม่ล้นจอทุกแท็บ · ตารางเลื่อนในกรอบ · toast/กล่องยืนยันพอดีจอ', async () => {
  const m = await open({ width: 390, height: 844 });
  await guest(m.page);
  const over = async (label) => {
    const w = await m.page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${label}: หน้ากว้าง ${w}px`);
  };
  await over('board');
  const gw = await m.page.evaluate(() => { const g = document.querySelector('.grid-wrap'); return [g.scrollWidth, g.clientWidth]; });
  assert.ok(gw[0] > gw[1], 'ตารางกว้างกว่าจอ → เลื่อนในกรอบ');
  await m.page.click('#auto-solve');
  await toastText(m.page, /จัดเสร็จ|วางไม่ลง/, 30000);
  const tb = await m.page.locator('.swal2-toast').boundingBox();
  assert.ok(tb.x >= 0 && tb.x + tb.width <= 390, 'toast อยู่ในจอ');
  await shot(m.page, '11-mobile-board');
  await m.page.evaluate(() => document.querySelector('.grid-wrap').scrollIntoView());
  await shot(m.page, '11b-mobile-grid');
  for (const k of ['assignments', 'subjects', 'teachers']) { await dataSection(m.page, k); await over('data ' + k); }
  await shot(m.page, '12-mobile-subjects');
  await dataSection(m.page, 'assignments');
  await m.page.click('[data-del-all]');
  const pb = await m.page.locator('.swal2-popup').boundingBox();
  assert.ok(pb.x >= 0 && pb.x + pb.width <= 390, 'กล่องยืนยันอยู่ในจอ');
  await shot(m.page, '13-mobile-confirm');
  await m.page.keyboard.press('Escape');
  await gotoTab(m.page, 'periods'); await over('periods');
  await gotoTab(m.page, 'export'); await over('export');
  await shot(m.page, '14-mobile-export');
  await gotoTab(m.page, 'board');
  // รุ่น delight: มือถือย้ายแนวตาราง/ล้างที่ไม่ปักหมุดเข้าเมนู ⋯ ของแถบเครื่องมือ (แถบเครื่องมือเหลือ 2 แถว) → กางเมนูก่อนกด
  await tbMore(m.page); await m.page.click('[data-orient="periods"]'); await over('board periods');
  // ลากด้วยนิ้ว (pointer) ในแนววันเรียงลงล่างบนมือถือ
  await tbMore(m.page); await m.page.click('[data-orient="days"]');
  await tbMore(m.page); await m.page.click('#clear-auto');
  await m.page.waitForTimeout(400);
  const before = (await store(m.page)).placements.length;
  const chip = m.page.locator('.chip[data-asg]:not(.done)').first();
  await chip.scrollIntoViewIfNeeded();
  const cell = m.page.locator('.tt tbody tr').nth(4).locator('td[data-day]:not(.lock)').first();
  await cell.scrollIntoViewIfNeeded();
  await drag(m.page, chip, cell);
  const after = (await store(m.page)).placements.length;
  assert.ok(after === before + 1 || after === before, 'ลากบนมือถือไม่พัง');
  assert.deepEqual(await check(m.page, 'mobile'), []);
  await m.ctx.close();
});

// ---------------------------------------------------------------- ตัวสำรองเมื่อโหลด SweetAlert2 ไม่ได้
await test('โหลด SweetAlert2 ไม่ได้ → ใช้ toast/กล่องโต้ตอบของระบบ (ไม่ใช้ alert) ลบทั้งหมด+เลิกทำยังใช้ได้', async () => {
  const f = await open({ width: 1200, height: 850 }, { blockSwal: true });
  await guest(f.page);
  await f.page.waitForSelector('#toast:not([hidden])', { timeout: 15000 });
  await dataSection(f.page, 'assignments');
  const n0 = (await store(f.page)).assignments.length;
  await f.page.click('[data-del-all]');
  await f.page.waitForSelector('dialog[open] input[name=v]');
  await f.page.fill('dialog[open] input[name=v]', 'ลบ');
  await f.page.click('dialog[open] button[value=ok]');
  await f.page.waitForSelector('#toast:not([hidden]) button');
  assert.ok((await store(f.page)).assignments.length < n0);
  await shot(f.page, '15-fallback-undo');
  await f.page.click('#toast button');
  await f.page.waitForTimeout(300);
  assert.equal((await store(f.page)).assignments.length, n0);
  assert.deepEqual(await check(f.page, 'fallback'), []);
  await f.ctx.close();
});

// ---------------------------------------------------------------- รุ่น smart-boon: ตัวช่วยเริ่มต้น · วางรายชื่อ · เติมครู · แก้ให้เลย · ข้อเสนอแนะ
const sql = (q) => execFileSync('sqlite3', [DB, q]).toString().trim();
const pageWidth = (p) => p.evaluate(() => document.documentElement.scrollWidth);
/** สแกน computed style ทั้งหน้า: สีเขียว (hue 75–165, sat > 0.2) และแถบสีขอบซ้าย (border-left หนา ≥ 2px ที่ด้านอื่นไม่มี/ต่างสี) */
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
    // pseudo-element: แถบผอมสูง (กว้าง 2–8px สูง ≥ 2.5 เท่า) ที่มีสี = แถบขอบซ้ายแบบ ::before (เช่น .cell::before เดิม) · จุดกลม/ไอคอนไม่นับ
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(e, pe);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      // getComputedStyle ของ pseudo คืนค่า auto เมื่อขนาดมาจาก top/bottom หรือ grid → คำนวณจากกล่องแม่แทน
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

const sb = await open();
const P = sb.page;
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

await test('ลองใช้ทันที · ประถม: ได้ข้อมูลตัวอย่างประถม (ป.1…) ไม่ใช่มัธยม · ตัวช่วยไม่เปิดเองกับข้อมูลตัวอย่าง', async () => {
  await guest(P, 'sample-primary');
  const d = await store(P);
  assert.ok(d.classes.some((c) => c.name === 'ป.1'), d.classes.map((c) => c.name).join(','));
  assert.ok(!d.classes.some((c) => /^ม\./.test(c.name)));
  await P.waitForTimeout(400);
  assert.equal(await P.locator('dialog[open] #wz-title').count(), 0);
  await assertStyle(P, 'app board (ประถม)');
});

await test('ฉากจัดอัตโนมัติ (ประถม): แถบความคืบหน้าโผล่ · คาบแรกลง ≤1.3 วิ · ครบ ≤2.4 วิ · ไม่มี long task > 50ms ระหว่างเผย · ฉลองแล้วไม่มีของค้าง', async () => {
  await gotoTab(P, 'board');
  const t = await P.evaluate(() => new Promise((res) => {
    const lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask' }); } catch { /* ไม่รองรับ */ }
    const s = performance.now();
    let first = 0, all = 0, sawBar = false;
    document.querySelector('#auto-solve').click(); // คลิกในหน้าเอง เวลาเริ่มนับตรงกับคลิกจริง
    const tick = () => {
      const now = performance.now() - s;
      const bar = document.querySelector('#solve-progress');
      if (bar && !bar.hidden) sawBar = true;
      const cells = [...document.querySelectorAll('#tab-board .tt .cell')];
      const out = cells.filter((c) => !c.classList.contains('m-pre')); // ยังซ่อนรอจังหวะเผย = m-pre
      if (!first && out.length) first = now;
      if (first && !all && cells.length && cells.every((c) => !c.classList.contains('m-pre') && +getComputedStyle(c).opacity > 0.02)) all = now;
      if ((all && document.querySelector('#tab-board').dataset.solve === 'done') || now > 10000) {
        res({ first, all, sawBar, n: cells.length, long: lt.filter(([st, d]) => st >= s + first - 5 && st <= s + all + 5 && d > 50).map(([, d]) => Math.round(d)) });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  assert.ok(t.sawBar, '#solve-progress ต้องเคยแสดง');
  assert.ok(t.n > 0, 'มีคาบในตาราง');
  assert.ok(t.first > 0 && t.first <= 1300, `คาบแรกลงที่ ${Math.round(t.first)} ms`);
  assert.ok(t.all > 0 && t.all <= 2400, `คาบครบที่ ${Math.round(t.all)} ms`);
  assert.deepEqual(t.long, [], 'long task ระหว่างเผย');
  // ฉลอง: ครูบูรณ์ท่า celebrate + คอนเฟตติ 4 สี (ไม่มีเขียว) · หายหมดใน 2.5 วิ นับจากเห็นชิ้นแรก
  const cf = await P.evaluate(() => new Promise((res) => {
    const s = performance.now();
    let colors = null, seen = 0;
    const tick = () => {
      const now = performance.now() - s;
      const ps = [...document.querySelectorAll('.m-confetti i')];
      if (ps.length && !colors) { seen = now; colors = [...new Set(ps.map((p) => getComputedStyle(p).backgroundColor))]; }
      if ((colors && !document.querySelector('.m-confetti')) || now > 6000) {
        res({ colors, life: colors ? Math.round(now - seen) : -1, pose: document.querySelector('.boon-fig img.on, .boon img.on, .boon-card img')?.getAttribute('src') || '' });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  assert.ok(cf.colors, 'ต้องมีคอนเฟตติเมื่อจัดครบ');
  assert.equal(cf.colors.length, 4, 'คอนเฟตติ 4 สี: ' + cf.colors.join(' '));
  for (const c of cf.colors) {
    const [r, g, b] = c.match(/\d+/g).map(Number);
    assert.ok(!(g > r + 20 && g > b + 20), 'คอนเฟตติห้ามเขียว ' + c);
  }
  assert.ok(cf.life >= 0 && cf.life <= 2500, `คอนเฟตติหายใน ${cf.life} ms`);
  assert.match(cf.pose, /celebrate/, 'ครูบูรณ์ท่าฉลอง: ' + cf.pose);
  await toastText(P, /จัดเสร็จ \d+ คาบ ไม่มีคาบชน · ครูทุกคนไม่สอนเกินเพดาน/);
  const rep = await P.locator('#tab-board .callout[data-report]').textContent();
  assert.doesNotMatch(rep, /ใช้เวลา/, 'ไม่บอกเวลาที่ใช้แล้ว');
  assert.match(rep, /ไม่มีคาบชน · ครูทุกคนไม่สอนเกินเพดาน/);
  await P.waitForFunction(() => document.querySelector('.boon-card')?.dataset.tone === 'ok' && /จัดครบทุกคาบ \d+ คาบ/.test(document.querySelector('.boon-msg')?.textContent || ''));
  assert.equal(await P.locator('[data-next-hint]').count() >= 1, true, 'ชี้ปุ่มส่งออก');
  // ภาพรวมทั้งโรงเรียน: แถว = ห้อง · ตัวเลขนับขึ้นจบที่ค่าจริง · วาด ≤ 16ms
  const ov = await P.evaluate(() => ({
    rows: document.querySelectorAll('.overview-map .ov-row').length,
    rects: document.querySelectorAll('.overview-map .ov-col rect').length,
    placed: document.querySelector('.overview-map .ov-nums b')?.textContent,
    ms: Math.max(...performance.getEntriesByName('tt-overview').map((e) => e.duration)),
  }));
  const d = await store(P);
  assert.equal(ov.rows, d.classes.length);
  assert.ok(ov.rects >= d.classes.length * 25, 'ช่องในแผนที่ ' + ov.rects);
  await P.waitForTimeout(800);
  assert.equal(await P.locator('.overview-map .ov-nums b').first().textContent(), String(d.placements.length));
  assert.ok(ov.ms <= 16, `วาดแผนที่ ${ov.ms.toFixed(1)} ms`);
  // 36 ห้อง (สำเนา 6 เท่าในหน่วยความจำ ไม่ commit): วาดแผนที่ ≤ 16ms
  const big = await P.evaluate(async () => {
    const { store, index } = await import('./assets/store.js');
    const board = await import('./assets/board.js');
    const orig = store.doc;
    const d = JSON.parse(JSON.stringify(orig));
    const cls = [...d.classes], asg = [...d.assignments], pls = [...d.placements];
    for (let k = 1; k < 6; k++) {
      for (const c of cls) d.classes.push({ ...c, id: c.id + '_' + k, name: c.name + '/' + k });
      for (const a of asg) d.assignments.push({ ...a, id: a.id + '_' + k, classId: a.classId + '_' + k });
      for (const p of pls) d.placements.push({ ...p, assignmentId: p.assignmentId + '_' + k });
    }
    store.doc = d; index();
    let ms = 0, rows = 0;
    try {
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); const h = board.overviewHTML(); ms = i ? Math.min(ms, performance.now() - t0) : performance.now() - t0; rows = (h.match(/class="ov-row/g) || []).length; }
    } finally { store.doc = orig; index(); }
    return { ms, rows };
  });
  assert.equal(big.rows, 36);
  assert.ok(big.ms <= 16, `แผนที่ 36 ห้อง ${big.ms.toFixed(1)} ms`);
  // ไม่มีของค้าง: คอนเฟตติ/ghost/เงาความคืบหน้า
  await P.waitForTimeout(2600);
  assert.equal(await P.locator('.m-ghost, .boon-confetti i, .m-confetti, .m-ghost-cell, .ghost-wrap').count(), 0);
  await assertStyle(P, 'board หลังจัด (ประถม)');
  await shot(P, '19-solved-scene');
});

await test('summarize(): ครบ / ไม่ครบ / ครบแต่หมุดชน / จัดเฉพาะที่ขาด (ฟังก์ชันล้วน)', async () => {
  const r = await P.evaluate(async () => {
    const { summarize } = await import('./assets/board.js');
    return [
      summarize({ unplaced: [], n: 147 }),
      summarize({ unplaced: [{ remaining: 12 }, { remaining: 8 }], n: 127 }),
      summarize({ unplaced: [], hard: 2, n: 147 }),
      summarize({ unplaced: [{ remaining: 3 }], mode: 'missing', added: 9, n: 140 }),
      summarize({ unplaced: [], skipped: 2, n: 140 }),
    ];
  });
  assert.equal(r[0].tone, 'ok'); assert.match(r[0].toast, /จัดเสร็จ 147 คาบ ไม่มีคาบชน · ครูทุกคนไม่สอนเกินเพดาน/);
  assert.equal(r[1].tone, 'warn'); assert.equal(r[1].head, 'จัดได้ 127 คาบ · วางไม่ลง 20 คาบ'); assert.equal(r[1].toast, 'วางไม่ลง 20 คาบ — ดูวิธีแก้เหนือตาราง');
  assert.equal(r[2].tone, 'warn'); assert.match(r[2].head, /จัดครบแต่มีคาบชน 2 จุด/); assert.match(r[2].toast, /ชน/); assert.doesNotMatch(r[2].toast + r[2].head, /ไม่มีคาบชน/);
  assert.equal(r[3].head, 'วางเพิ่มได้ 9 คาบ · ยังขาด 3 คาบ');
  assert.match(r[4].head, /ยังขาด/);
});

await test('ตัวช่วยเริ่มต้น 4 คำถาม: ภาคเรียนว่าง → เปิดเอง → ประถม 6 ชั้น + คละชั้น ป.1-2 → ได้ 5 ห้อง ลูกเสือรายห้อง การสอนร่างไม่มีครู', async () => {
  await P.selectOption('#term-select', '__new');
  await P.waitForSelector('.swal2-popup #nt-kind');
  await P.selectOption('#nt-kind', 'blank:primary');
  await P.fill('#nt-name', 'ทดสอบตัวช่วย 1/2570');
  await P.click('.swal2-confirm');
  await P.waitForSelector('dialog[open] #wz-title', { timeout: 15000 });
  await P.click('dialog[open] [data-preset="0"]');
  assert.equal(await P.inputValue('#wz-min'), '60');
  assert.equal(await P.inputValue('#wz-count'), '6');
  await P.check('dialog[open] [data-combine-on]');
  await P.check('dialog[open] [data-pair="ป.1|ป.2"]');
  assert.ok(await P.locator('dialog[open] [data-pair="ป.2|ป.3"]').isDisabled(), 'คู่ที่ซ้อนกันกดไม่ได้');
  await shot(P, '20-wizard');
  await assertStyle(P, 'wizard dialog');
  await P.click('dialog[open] [data-ok]');
  await toastText(P, /สร้างห้อง \d+ ห้อง/);
  const d = await store(P);
  assert.deepEqual(d.classes.map((c) => c.name), ['ป.1-2', 'ป.3', 'ป.4', 'ป.5', 'ป.6']);
  assert.equal(d.term.periods.filter((p) => p.type !== 'break').length, 6);
  assert.ok(d.assignments.length > 0 && d.assignments.every((a) => !a.teacherId), 'การสอนร่างยังไม่มีครู');
  assert.ok(d.locks.length >= 5, 'มีคาบล็อก');
  assert.ok(d.meta?.setup?.wizardAt, 'meta.setup');
  assert.equal(await P.locator('dialog[open] #wz-title').count(), 0);
});

await test('วางรายชื่อครู 8 บรรทัด (คำนำหน้า/ยศ + กลุ่มสาระ + ประจำชั้น) → ตรวจก่อนเพิ่ม → เพิ่ม 8 คน · เลิกทำได้', async () => {
  await dataSection(P, 'teachers');
  await P.click('[data-paste="teachers"]');
  await P.fill('dialog[open] [data-text]', TEACHERS8);
  await P.click('dialog[open] [data-next]');
  await P.waitForSelector('dialog[open] .imp-table');
  assert.equal(await P.locator('dialog[open] .imp-table tbody tr').count(), 8);
  await shot(P, '21-paste-preview');
  assert.match(await P.locator('dialog[open] [data-ok]').textContent(), /8/);
  await P.click('dialog[open] [data-ok]');
  await toastText(P, /เพิ่มครู 8 คน/);
  let d = await store(P);
  assert.equal(d.teachers.length, 8);
  assert.ok(!d.teachers.some((t) => /^(นาย|นาง|ด\.ต\.)/.test(t.name)), 'ตัดคำนำหน้า: ' + d.teachers.map((t) => t.name).join(','));
  assert.equal(d.teachers.filter((t) => t.homeroom).length, 5, 'ประจำชั้น 5 ห้อง');
  assert.ok(d.teachers.every((t) => t.subjects?.length), 'มีกลุ่มสาระทุกคน');
  // เลิกทำ แล้ววางซ้ำ (ข้อความที่วางจำไว้)
  await P.click('.swal2-toast .swal2-confirm');
  await P.waitForTimeout(300);
  assert.equal((await store(P)).teachers.length, 0);
  await P.click('[data-paste="teachers"]');
  assert.equal((await P.inputValue('dialog[open] [data-text]')).split('\n').length, 8, 'จำข้อความเดิมไว้');
  await P.click('dialog[open] [data-next]');
  await P.click('dialog[open] [data-ok]');
  await toastText(P, /เพิ่มครู 8 คน/);
  d = await store(P);
  assert.equal(d.teachers.length, 8);
});

await test('เติมครูอัตโนมัติ 1 คลิก: ยังไม่มีครู ≤ 10% · commit ครั้งเดียว · เลิกทำคืนว่าง', async () => {
  await dataSection(P, 'assignments');
  const n0 = (await store(P)).assignments.length;
  await P.click('[data-auto]');
  await toastText(P, /เติมครู \d+ แถว/);
  const d = await store(P);
  const left = d.assignments.filter((a) => !a.teacherId).length;
  assert.ok(left <= Math.floor(n0 * 0.1), `ยังไม่มีครู ${left}/${n0}`);
  await shot(P, '22-autoassign');
  await assertStyle(P, 'data assignments');
  // เลิกทำ แล้วเติมใหม่
  await P.click('.swal2-toast .swal2-confirm');
  await P.waitForTimeout(300);
  assert.equal((await store(P)).assignments.filter((a) => !a.teacherId).length, n0);
  await P.click('[data-auto]');
  await toastText(P, /เติมครู \d+ แถว/);
});

let beforeMissing = null;
await test('จัด → ติด (ครูสอนได้วันละ 1 คาบ) → ปุ่ม "เพิ่มเป็น N" แก้ให้เลย → จัดเฉพาะที่ขาด คาบเดิมอยู่ที่เดิม', async () => {
  // ทำให้ติด: ครูที่สอนมากสุดสอนได้แค่วันละ 1 คาบ
  const tid = await P.evaluate(async () => {
    const { store } = await import('./assets/store.js');
    const load = new Map();
    for (const a of store.doc.assignments) if (a.teacherId) load.set(a.teacherId, (load.get(a.teacherId) || 0) + a.perWeek);
    const [id] = [...load.entries()].sort((a, b) => b[1] - a[1])[0];
    store.doc.teachers.find((t) => t.id === id).maxPerDay = 1;
    store.commit('data');
    return id;
  });
  await gotoTab(P, 'board');
  await P.click('#auto-solve');
  // รุ่น delight: วางไม่ครบบอกที่เดียว (ไม่มี modal) = กล่องรายงานเหนือตาราง + ครูบูรณ์ปลอบ 1 ประโยค + toast สั้น
  await P.waitForFunction(() => /วางไม่ลง \d+ คาบ/.test(document.querySelector('#tab-board .callout[data-report]')?.textContent || ''), null, { timeout: 60000 });
  await P.waitForFunction(() => document.querySelector('#tab-board')?.dataset.solve !== 'run', null, { timeout: 10000 });
  assert.match(await P.locator('#tab-board .callout[data-report]').textContent(), /สูงสุด\/วัน/);
  assert.equal(await P.locator('.swal2-popup:not(.swal2-toast)').count(), 0, 'ไม่มีกล่อง modal สรุปซ้ำ');
  await toastText(P, /วางไม่ลง \d+ คาบ — ดูวิธีแก้เหนือตาราง/);
  assert.match(await P.locator('.boon-msg').textContent(), /เหลืออีก \d+ คาบ/);
  const fix = P.locator('[data-fix]', { hasText: /เพิ่มเป็น/ }).first();
  await fix.waitFor({ timeout: 10000 });
  await shot(P, '23-stuck-fix');
  await assertStyle(P, 'board report');
  await fix.click();
  await toastText(P, /สูงสุด|เพิ่ม/);
  // ปุ่มแก้รับรู้ผล: ปุ่มเป็น ✓ → การ์ดนั้นหายจากรายงาน · ครูบูรณ์ยืนยันว่าแก้แล้ว (ไม่ถอยไปพูดเรื่อง "ยังไม่มีครู")
  await P.waitForSelector('#tab-board .btn-done', { timeout: 3000 });
  const boon = await P.locator('.boon-msg').textContent();
  assert.doesNotMatch(boon, /ยังมีการสอน .* ยังไม่มีครู/);
  assert.match(boon, /จัดเฉพาะที่ยังขาด|แล้วครับ/);
  await P.waitForFunction(() => !document.querySelector('#tab-board .btn-done'), null, { timeout: 4000 });
  await P.waitForTimeout(300);
  assert.match(await P.locator('.boon-msg').textContent(), /จัดเฉพาะที่ยังขาด|แล้วครับ/, 'ข้อความยืนยันค้างอยู่หลังการ์ดหาย');
  let d = await store(P);
  assert.ok(d.teachers.find((t) => t.id === tid).maxPerDay > 1, 'เพิ่ม maxPerDay แล้ว');
  beforeMissing = d.placements.map((p) => `${p.assignmentId}@${p.day}.${p.period}`).sort();
  const need = d.assignments.filter((a) => a.teacherId).reduce((n, a) => n + a.perWeek, 0);
  assert.ok(beforeMissing.length < need, 'ยังขาดอยู่ก่อนจัดเฉพาะที่ขาด');
  await P.click('#auto-solve');
  await P.waitForSelector('.cell-menu [data-mode="missing"]:not([disabled])');
  await P.click('.cell-menu [data-mode="missing"]');
  const res = await solveDone(P);
  assert.ok(!/สุ่มลำดับใหม่ทุกครั้ง/.test(res), 'ข้อความต้องไม่บอกว่าสุ่มใหม่ทุกครั้ง (seed คงที่แล้ว)');
  d = await store(P);
  const after = new Set(d.placements.map((p) => `${p.assignmentId}@${p.day}.${p.period}`));
  for (const k of beforeMissing) assert.ok(after.has(k), 'คาบเดิมต้องอยู่ที่เดิม ' + k);
  assert.ok(after.size > beforeMissing.length, `วางเพิ่ม ${after.size - beforeMissing.length} คาบ`);
  assert.equal(d.meta?.lastSolve?.mode, 'missing');
  await shot(P, '24-solve-missing');
});

await test('Ctrl+Z บนกระดาน: ย้อนผลจัดเฉพาะที่ขาด (ใช้ได้ตอนแป้นไทย) · ไม่ดักเมื่อโฟกัสในช่องกรอก', async () => {
  await P.evaluate(() => document.activeElement?.blur());
  await P.keyboard.press('Control+KeyZ');
  await P.waitForTimeout(300);
  let d = await store(P);
  assert.deepEqual(d.placements.map((p) => `${p.assignmentId}@${p.day}.${p.period}`).sort(), beforeMissing);
  // ลาก 1 คาบ แล้ว Ctrl+Z คืน
  const n = d.placements.length;
  const chip = P.locator('.chip[data-asg]:not(.done)').first();
  const cell = P.locator('.tt tbody td[data-day]:not(.lock):not(:has(.cell))').first();
  await drag(P, chip, cell);
  d = await store(P);
  if (d.placements.length === n + 1) {
    await P.evaluate(() => document.activeElement?.blur());
    await P.keyboard.press('Control+KeyZ');
    await P.waitForTimeout(300);
    assert.equal((await store(P)).placements.length, n);
  }
  // โฟกัสใน input (ตัวเลือกห้อง/ช่องค้นหา) → ไม่ดัก
  await gotoTab(P, 'data');
  await P.click('[data-sec="teachers"]');
  const inp = P.locator('#data-body input[data-f="name"]').first();
  await inp.focus();
  const before = (await store(P)).placements.length;
  await P.keyboard.press('Control+KeyZ');
  await P.waitForTimeout(200);
  assert.equal((await store(P)).placements.length, before);
  await forceSave(P);
});

await test('ตัวสแกนจับแถบซ้ายแบบ ::before ได้จริง (กันผ่านหลอก)', async () => {
  await gotoTab(P, 'board');
  const s = await P.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'bar-probe';
    // แบบเดิมทั้ง 2 จุด: .cell::before (absolute 4px) และ .chip::before (คอลัมน์ grid 6px ยืดเต็มสูง)
    st.textContent = '.tt .cell::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#1F5FA8}'
      + '.chip{grid-template-columns:6px 1fr auto!important}.chip::before{align-self:stretch;width:auto;height:auto;border-radius:3px}';
    document.head.appendChild(st);
    return { cell: !!document.querySelector('.tt .cell'), chip: !!document.querySelector('.chip') };
  });
  const r = await scanStyle(P);
  await P.evaluate(() => document.getElementById('bar-probe')?.remove());
  if (s.cell) assert.ok(r.bars.some((b) => /cell.*::before/.test(b)), 'ต้องจับ .cell::before ได้: ' + r.bars.join(' | '));
  if (s.chip) assert.ok(r.bars.some((b) => /chip.*::before/.test(b)), 'ต้องจับ .chip::before ได้: ' + r.bars.join(' | '));
  assert.ok(s.cell || s.chip, 'ต้องมี .cell หรือ .chip ให้ทดสอบ');
  await assertStyle(P, 'board (ไม่มีแถบ ::before)');
});

await test('จัดเฉพาะที่ขาด → "ลองอีกแบบ" ได้คาบวางเพิ่มจริง (ไม่ตรึงคาบที่รอบก่อนวางเพิ่ม) · คาบเดิมอยู่ที่เดิม · กลับไปแบบก่อนได้', async () => {
  await gotoTab(P, 'board');
  const key = (p) => `${p.assignmentId}@${p.day}.${p.period}`;
  const base = new Set((await store(P)).placements.map(key));
  await P.click('#auto-solve');
  await P.waitForSelector('.cell-menu [data-mode="missing"]:not([disabled])');
  await P.click('.cell-menu [data-mode="missing"]');
  await solveDone(P);
  const v1 = (await store(P)).placements.map(key).sort();
  assert.ok(v1.length > base.size, 'รอบแรกวางเพิ่มได้');
  await P.locator('[data-solve="again"]').click();
  await solveDone(P);
  const d = await store(P);
  const v2 = d.placements.map(key).sort();
  for (const k of base) assert.ok(v2.includes(k), 'คาบก่อนจัดเฉพาะที่ขาดต้องอยู่ที่เดิม ' + k);
  assert.ok(v2.length > base.size, `ลองอีกแบบต้องวางเพิ่มได้ (ได้ ${v2.length - base.size})`);
  const added = await P.evaluate(() => document.querySelector('.solve-extra')?.textContent || '');
  assert.ok(!/วางเพิ่ม 0 คาบ|วางเพิ่มได้ 0 คาบ/.test(added), 'ข้อความต้องไม่บอกว่าวางเพิ่ม 0 คาบ: ' + added.trim().slice(0, 80));
  assert.notDeepEqual(v2, v1, 'seed ใหม่ต้องได้แบบใหม่');
  await P.locator('[data-solve="back"]').click();
  await toastText(P, /กลับไปใช้แบบก่อนหน้า/);
  assert.deepEqual((await store(P)).placements.map(key).sort(), v1);
});

await test('แถวที่ยังไม่มีครู: 2 ห้องวางคาบเดียวกันได้ (ไม่ขึ้น "ครูสอนห้องอื่นอยู่") · ปักหมุดแล้ว "จัดใหม่ทั้งหมด" ไม่หาย ไม่มีวิชาอื่นทับ', async () => {
  await gotoTab(P, 'board');
  const r = await P.evaluate(async () => {
    const m = await import('./assets/store.js');
    const { store } = m;
    const d = store.doc, P = d.term.periods.length;
    const byClass = new Map();
    for (const a of d.assignments) if (!byClass.has(a.classId)) byClass.set(a.classId, a);
    const [a1, a2] = [...byClass.values()];
    a1.teacherId = null; a2.teacherId = null;
    d.placements = d.placements.filter((p) => p.assignmentId !== a1.id && p.assignmentId !== a2.id);
    // ช่องที่ทั้งสองห้องไม่ใช่คาบล็อก/พัก → เอาคาบอื่นของสองห้องในช่องนั้นออก
    let slot = null;
    for (let day = 0; day < d.term.days && !slot; day++) for (let period = 0; period < P && !slot; period++) {
      if (d.term.periods[period].type === 'break') continue;
      if (d.locks.some((l) => l.day === day && l.period === period && (l.classId == null || l.classId === a1.classId || l.classId === a2.classId))) continue;
      slot = { day, period };
    }
    d.placements = d.placements.filter((p) => !(p.day === slot.day && p.period === slot.period && [a1.classId, a2.classId].includes(d.assignments.find((a) => a.id === p.assignmentId)?.classId)));
    d.placements.push({ assignmentId: a1.id, day: slot.day, period: slot.period, pinned: true });
    store.commit('data');
    const why = m.whyCannotPlace(a2, slot.day, slot.period);
    return { a1: a1.id, cls: a1.classId, slot, why };
  });
  assert.equal(r.why, null, 'แถวไม่มีครูสองห้องช่องเดียวกันต้องวางได้: ' + r.why);
  await P.click('#auto-solve');
  await P.waitForSelector('.cell-menu [data-mode="all"]');
  await P.click('.cell-menu [data-mode="all"]');
  const ok = P.locator('.swal2-popup:not(.swal2-toast) .swal2-confirm');
  if (await ok.isVisible({ timeout: 3000 }).catch(() => false)) await ok.click();
  await solveDone(P);
  const d = await store(P);
  assert.ok(d.placements.some((p) => p.assignmentId === r.a1 && p.day === r.slot.day && p.period === r.slot.period && p.pinned), 'คาบปักหมุดของแถวไม่มีครูต้องอยู่');
  const clsAt = d.placements.filter((p) => p.day === r.slot.day && p.period === r.slot.period && d.assignments.find((a) => a.id === p.assignmentId)?.classId === r.cls);
  assert.equal(clsAt.length, 1, 'ห้องนั้นช่องนั้นต้องมีคาบเดียว (solver ไม่วางทับ)');
  await forceSave(P);
});

await test('แอป: เมนู "สนับสนุน" → แท็บส่งออก กล่องบริจาคกางเอง · ทุกแท็บไม่มีสีเขียว/แถบขอบซ้าย · ไม่มี console error', async () => {
  await gotoTab(P, 'board');
  const sup = P.locator('.bar-support[href="#donate"]');
  if (await sup.count()) {
    await sup.click();
    await P.waitForSelector('#tab-export #donate-d[open]', { timeout: 5000 });
  }
  for (const t of ['periods', 'data', 'export']) { await gotoTab(P, t); await assertStyle(P, 'app ' + t); }
  assert.deepEqual(await check(P, 'smart-boon app'), []);
});

await test('แอป: เปิดหน้า CLS < 0.02 (แถบขั้นตอน + ครูบูรณ์แทรกเหนือ main ไม่ดันเนื้อหา)', async () => {
  await P.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await P.goto(BASE + 'app.php');
  await P.waitForSelector('#tt-steps');
  await P.waitForTimeout(1500);
  const cls = await P.evaluate(() => window.__cls);
  assert.ok(cls < 0.02, 'CLS = ' + cls.toFixed(4));
});
await sb.ctx.close();

await test('หมุดชนกันเอง (2 คาบห้องเดียวกันช่องเดียวกัน) → จัดใหม่: รายงาน/toast มี "ชน" ไม่มี "ไม่มีคาบชน" · ป้ายชนตรงรายงาน · ครูบูรณ์ปลอบ · เลิกปักหมุดที่ชนแล้วจัดใหม่ = ไม่มีจุดชน', async () => {
  const c = await open();
  const p = c.page;
  await guest(p);
  await p.goto(BASE + 'app.php?dbg=1');
  await p.waitForSelector('#tab-board .toolbar');
  // ลากวาง 1 ครั้ง: "วางได้ไหม" คำนวณครั้งเดียวต่อช่องต่อการลาก (Map ตอนเริ่มลาก ไม่ใช่ทุก pointermove)
  await drag(p, p.locator('.chip[data-asg]').first(), p.locator('.tt tbody tr').nth(1).locator('td[data-day]:not(.lock)').nth(1));
  const dbg = await p.evaluate(() => window.__tt_dbg);
  assert.ok(dbg && dbg.drags >= 1 && dbg.why === dbg.cells * dbg.drags, 'whyCannotPlace ต่อการลาก: ' + JSON.stringify(dbg));
  assert.equal(await p.locator('.ghost-wrap').count(), 0, 'ghost ถูกลบหลังวาง');
  const slot = await p.evaluate(async () => {
    const { store } = await import('./assets/store.js');
    const d = store.doc;
    const cls = d.classes[0].id;
    const mine = d.assignments.filter((a) => a.classId === cls && a.teacherId);
    const [a1] = mine;
    const a2 = mine.find((a) => a.teacherId !== a1.teacherId);
    const P = d.term.periods.length;
    let at = null;
    for (let day = 0; day < d.term.days && !at; day++) for (let period = 0; period < P && !at; period++) {
      if (d.term.periods[period].type === 'break') continue;
      if (d.locks.some((l) => l.day === day && l.period === period && (l.classId == null || l.classId === cls))) continue;
      at = { day, period };
    }
    d.placements = d.placements.filter((x) => !(x.day === at.day && x.period === at.period));
    d.placements.push({ assignmentId: a1.id, ...at, pinned: true }, { assignmentId: a2.id, ...at, pinned: true });
    store.commit('place');
    return at;
  });
  assert.ok(slot);
  await p.click('#auto-solve');
  await p.waitForSelector('.cell-menu [data-mode="all"]');
  await p.click('.cell-menu [data-mode="all"]');
  const ok = p.locator('.swal2-popup:not(.swal2-toast) .swal2-confirm');
  if (await ok.isVisible({ timeout: 2000 }).catch(() => false)) await ok.click();
  await p.waitForFunction(() => document.querySelector('#tab-board')?.dataset.solve === 'done' && document.querySelector('#tab-board .callout[data-report]'), null, { timeout: 30000 });
  await toastText(p, /ชน/);
  const toast = await p.evaluate(() => [...document.querySelectorAll('.swal2-toast')].map((e) => e.textContent).join(' '));
  assert.doesNotMatch(toast, /ไม่มีคาบชน/);
  const rep = await p.locator('#tab-board .callout[data-report]').textContent();
  assert.match(rep, /ชน (\d+) จุด/);
  assert.doesNotMatch(rep, /ไม่มีคาบชน/);
  const nRep = +rep.match(/ชน (\d+) จุด/)[1];
  const pill = await p.locator('#pill-hard').textContent();
  assert.equal(pill.trim(), `ชน ${nRep} จุด`, 'ป้ายชนต้องตรงรายงาน');
  assert.equal(await p.locator('.boon-card').getAttribute('data-tone'), 'warn', 'ครูบูรณ์ปลอบ ไม่ฉลอง');
  assert.ok((await store(p)).meta.lastSolve.codes.includes('PINNED_CLASH'));
  await shot(p, '27-pinned-clash');
  await p.click('#tab-board [data-clash="unpin"]');
  await toastText(p, /เลิกปักหมุด \d+ คาบ/);
  await p.click('.swal2-toast .swal2-confirm'); // "จัดใหม่ทั้งหมด"
  await solveDone(p);
  assert.match(await p.locator('#pill-hard').textContent(), /ไม่มีจุดชน/);
  assert.deepEqual(await check(p, 'pinned clash'), []);
  await c.ctx.close();
});

/** ทำให้จัดไม่ลง: ครูที่สอนมากสุด n คน สอนได้วันละ 1 คาบ */
async function capTeachers(p, n = 1) {
  await p.evaluate(async (n) => {
    const { store } = await import('./assets/store.js');
    const load = new Map();
    for (const a of store.doc.assignments) if (a.teacherId) load.set(a.teacherId, (load.get(a.teacherId) || 0) + a.perWeek);
    for (const [id] of [...load.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)) store.doc.teachers.find((t) => t.id === id).maxPerDay = 1;
    store.commit('data');
  }, n);
}
/** กด #auto-solve ในหน้าเอง แล้ววัดทุกเฟรมระหว่าง data-solve='run': ตำแหน่ง .tt thead · มีรายงานผลใหม่โผล่ไหม · หัวรายงานเป็น 0 ไหม */
const watchScene = (p) => p.evaluate(() => new Promise((res) => {
  const box = document.querySelector('#tab-board');
  const top0 = document.querySelector('#tab-board .tt thead').getBoundingClientRect().top;
  const s = performance.now();
  let maxDy = 0, frames = 0, report = 0, zero = 0, ran = false;
  document.querySelector('#auto-solve').click();
  const tick = () => {
    const run = box.dataset.solve === 'run';
    if (run) {
      ran = true; frames++;
      const th = document.querySelector('#tab-board .tt thead');
      if (th) maxDy = Math.max(maxDy, Math.abs(th.getBoundingClientRect().top - top0));
      if (document.querySelector('#tab-board .callout[data-report]')) report++;
      if (/จัดครบทุกคาบแล้ว 0 คาบ/.test(box.textContent)) zero++;
    }
    if ((ran && !run) || performance.now() - s > 30000) { res({ maxDy, frames, report, zero, ran, ms: performance.now() - s }); return; }
    requestAnimationFrame(tick);
  };
  tick();
}));

for (const cf of [{ w: 1366, h: 900 }, { w: 390, h: 844 }, { w: 1366, h: 900, reduce: true }]) await test(`ฉากจัด (${cf.w}px${cf.reduce ? ' ลดการเคลื่อนไหว' : ''}): ระหว่าง data-solve="run" ตาราง (.tt thead) ไม่ขยับเลย · รายงานผลใหม่ไม่โผล่ก่อนเผย · ไม่มี "0 คาบ" · จบฉากแล้วรายงานมา + ครูบูรณ์ยืนยันการแก้`, async () => {
  const c = await open({ width: cf.w, height: cf.h });
  const p = c.page;
  if (cf.reduce) await p.emulateMedia({ reducedMotion: 'reduce' });
  await guest(p, 'sample-primary');
  await gotoTab(p, 'board');
  // รอบ 1 (ยังไม่มีคาบ → กล่อง "ข้อมูลพร้อมแล้ว" อยู่เหนือตาราง) · รอบ 2 (จัดซ้ำทั้งหมด มีรายงาน+ภาพรวมเดิม)
  const r1 = await watchScene(p);
  assert.ok(r1.ran && r1.frames > 3, 'ต้องเห็นฉากจัด ' + JSON.stringify(r1));
  assert.equal(r1.maxDy, 0, 'thead ขยับระหว่างฉาก (รอบแรก) ' + JSON.stringify(r1));
  assert.equal(r1.report, 0, 'รายงานผลใหม่ต้องไม่โผล่ระหว่างฉาก');
  assert.equal(r1.zero, 0, 'หัวรายงานต้องไม่เป็น 0 คาบ');
  await p.waitForSelector('#tab-board .callout[data-report]', { timeout: 3000 });
  await p.waitForTimeout(800);
  assert.match(await p.locator('#tab-board .callout[data-report]').textContent(), /จัดครบทุกคาบแล้ว [1-9]\d* คาบ/);
  await capTeachers(p, 1);
  await p.click('#auto-solve');
  await p.click('.cell-menu [data-mode="all"]');
  // กล่องยืนยัน "จัดใหม่ทั้งหมด?" → กดยืนยันในหน้า แล้ววัดตั้งแต่จังหวะนั้น
  await p.waitForSelector('.swal2-confirm');
  const r2 = await p.evaluate(() => new Promise((res) => {
    const box = document.querySelector('#tab-board');
    const top0 = document.querySelector('#tab-board .tt thead').getBoundingClientRect().top;
    const s = performance.now();
    let maxDy = 0, frames = 0, report = 0, ran = false;
    document.querySelector('.swal2-confirm').click();
    const tick = () => {
      const run = box.dataset.solve === 'run';
      if (run) {
        ran = true; frames++;
        maxDy = Math.max(maxDy, Math.abs(document.querySelector('#tab-board .tt thead').getBoundingClientRect().top - top0));
        if (document.querySelector('#tab-board .callout[data-report]')) report++;
      }
      if ((ran && !run) || performance.now() - s > 30000) { res({ maxDy, frames, report, ran }); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  assert.ok(r2.ran, 'ต้องเห็นฉากจัดรอบ 2');
  assert.equal(r2.maxDy, 0, 'thead ขยับระหว่างฉาก (จัดซ้ำ) ' + JSON.stringify(r2));
  assert.equal(r2.report, 0, 'รายงานผลใหม่ต้องไม่โผล่ระหว่างฉาก (จัดซ้ำ)');
  // จบฉาก: รายงาน "วางไม่ลง" มา → กดแก้ → ครูบูรณ์ยืนยัน ไม่ถูกข้อความปลอบตอนจบฉากทับ
  await p.waitForFunction(() => /วางไม่ลง \d+ คาบ/.test(document.querySelector('#tab-board .callout[data-report]')?.textContent || ''), null, { timeout: 5000 });
  assert.ok((await pageWidth(p)) <= cf.w, 'ไม่ล้นแนวนอน');
  if (cf.w < 500) { assert.deepEqual(await check(p, 'scene no jump 390'), []); await c.ctx.close(); return; } // มือถือ: ปุ่มแก้อยู่ในข้อที่กาง ทดสอบแยกในชุดมือถือ
  await p.locator('#tab-board .callout[data-report] [data-fix]', { hasText: /เพิ่มเป็น/ }).first().click();
  await p.waitForTimeout(1500);
  const msg = await p.locator('.boon-msg').textContent();
  assert.match(msg, /แล้วครับ/, `ครูบูรณ์ต้องยืนยันการแก้: ${msg}`);
  assert.doesNotMatch(msg, /ไม่ต้องห่วง/);
  assert.ok(await p.locator('.boon-acts button', { hasText: 'จัดเฉพาะที่ยังขาด' }).count() >= 1);
  assert.deepEqual(await check(p, 'scene no jump'), []);
  await c.ctx.close();
});

for (const delay of [0, 300]) await test(`กด "แก้ให้เลย" แล้วกด "เลิกทำ" ภายใน ${delay} ms (ก่อนการ์ดจาง 0.9 วิ) → การ์ดสาเหตุกลับมาครบพร้อมปุ่มแก้ · ค่าเดิมคืน · สลับมุมมองแล้วยังอยู่`, async () => {
  const c = await open();
  const p = c.page;
  await guest(p, 'sample-primary');
  await capTeachers(p, 3);
  await gotoTab(p, 'board');
  await p.click('#auto-solve');
  await p.waitForFunction(() => document.querySelector('#tab-board')?.dataset.solve === 'done' && document.querySelector('#tab-board .callout[data-report] .fix-card'), null, { timeout: 30000 });
  await p.waitForTimeout(400);
  const n0 = await p.locator('#tab-board .callout[data-report] .fix-card').count();
  const caps0 = (await store(p)).teachers.map((t) => t.maxPerDay ?? null);
  await p.locator('#tab-board .callout[data-report] [data-fix].btn-primary').first().click();
  await p.waitForSelector('.swal2-toast .swal2-confirm', { timeout: 3000 });
  if (delay) await p.waitForTimeout(delay);
  await p.click('.swal2-toast .swal2-confirm'); // "เลิกทำ"
  await p.waitForTimeout(1600);
  const n1 = await p.locator('#tab-board .callout[data-report] .fix-card').count();
  assert.equal(n1, n0, `การ์ด ${n0} → ${n1} หลังเลิกทำ`);
  assert.equal(await p.locator('#tab-board .btn-done').count(), 0, 'ไม่มีปุ่ม ✓ ค้าง');
  assert.deepEqual((await store(p)).teachers.map((t) => t.maxPerDay ?? null), caps0, 'ค่าเดิมคืนครบ');
  assert.ok(await p.locator('#tab-board .callout[data-report] [data-fix]', { hasText: /เพิ่มเป็น/ }).count() >= 1, 'ปุ่ม "เพิ่มเป็น N" กลับมา');
  assert.doesNotMatch(await p.locator('.boon-msg').textContent(), /^แก้แล้วครับ/, 'ครูบูรณ์ไม่ค้างข้อความแก้แล้ว');
  await p.click('#tab-board [data-view="teacher"]');
  await p.click('#tab-board [data-view="class"]');
  assert.equal(await p.locator('#tab-board .callout[data-report] .fix-card').count(), n0, 'สลับมุมมองแล้วการ์ดยังครบ');
  // แก้จริงอีกครั้ง (ไม่เลิกทำ) → การ์ดนั้นหาย 1 ใบ
  await p.locator('#tab-board .callout[data-report] [data-fix].btn-primary').first().click();
  await p.waitForTimeout(1800);
  assert.equal(await p.locator('#tab-board .callout[data-report] .fix-card').count(), n0 - 1, 'แก้จริง → การ์ดหาย 1 ใบ');
  assert.deepEqual(await check(p, 'undo fix race ' + delay), []);
  await c.ctx.close();
});

await test('ลูกศรทองของครูบูรณ์ชี้ปุ่มจัดอัตโนมัติ → สลับแท็บแล้วลูกศรหาย (ไม่ค้างชี้ที่ว่างในแท็บอื่น)', async () => {
  const c = await open();
  const p = c.page;
  await guest(p, 'sample');
  await p.waitForSelector('.boon-arrow', { timeout: 4000 });
  await gotoTab(p, 'export');
  assert.equal(await p.locator('.boon-arrow').count(), 0, 'ลูกศรต้องหายเมื่อสลับแท็บ');
  assert.deepEqual(await check(p, 'arrow tab switch'), []);
  await c.ctx.close();
});

for (const mode of ['reduce', 'tt-still']) await test(`ลดการเคลื่อนไหว (${mode}): จัดแล้วตารางขึ้นทันที ข้อมูลครบ · ไม่มี animation ค้าง (รวมไอคอน Swal) · ไม่มีคอนเฟตติ · ปุ่มเป้ามีขอบทองค้าง`, async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'th-TH', ...(mode === 'reduce' ? { reducedMotion: 'reduce' } : {}) });
  // tt-still = ปุ่ม "หยุดภาพเคลื่อนไหว" ของหน้าแรก (localStorage) → layout.php ติด class ที่ <html> ก่อน paint ทุกหน้า
  if (mode === 'tt-still') await ctx2.addInitScript(() => { try { localStorage.setItem('tt-still', '1'); } catch { /* */ } });
  const p = await ctx2.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await guest(p, 'sample-primary');
  const ms = await p.evaluate(() => new Promise((res) => {
    const s = performance.now();
    document.querySelector('#auto-solve').click();
    const tick = () => (document.querySelector('#tab-board')?.dataset.solve === 'done' ? res(performance.now() - s) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));
  assert.ok(ms < 1100, `ไม่มีขั้นต่ำ 1.2 วิ (${Math.round(ms)} ms)`);
  await toastText(p, /จัดเสร็จ \d+ คาบ/);
  const d = await store(p);
  assert.equal(await p.locator('#tab-board .tt .cell.m-pre').count(), 0);
  assert.ok(await p.locator('#tab-board .tt .cell').count() > 0);
  await p.waitForTimeout(1200);
  // นับทุกอย่าง รวมไอคอนสำเร็จของ SweetAlert2 (app.css ตัด animation ของ .swal2-icon ใต้ reduce/tt-still แล้ว)
  const run = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
    const t = a.effect?.target;
    return `${a.animationName || a.transitionProperty || a.constructor.name}@${t?.className?.baseVal ?? t?.className ?? ''}`;
  }));
  assert.deepEqual(run, [], 'animation ที่ยังวิ่ง');
  assert.equal(await p.locator('.m-confetti, .boon-confetti i, .boon-arrow').count(), 0);
  assert.ok(await p.locator('.m-hint-still').count() >= 1, 'ปุ่มเป้ามีขอบทองค้างแทน pulse');
  assert.equal(await p.locator('.overview-map .ov-nums b').first().textContent(), String(d.placements.length));
  assert.deepEqual(p.errors, []);
  await ctx2.close();
});

await test('มือถือ 390×844 (ลองใช้ประถม): หัว 56+44px · ตารางเห็นโดยไม่เลื่อน · ปุ่ม ≥ 40px · จัดไม่ลง → ครูบูรณ์เปิดเอง ปุ่ม "ดูวิธีแก้" อยู่ในจอ', async () => {
  const m = await open({ width: 390, height: 844 });
  const p = m.page;
  await guest(p, 'sample-primary');
  await p.waitForTimeout(300);
  const g = await p.evaluate(() => {
    const r1 = document.querySelector('.bar-row1').getBoundingClientRect(), r2 = document.querySelector('.bar-row2').getBoundingClientRect();
    const small = [...document.querySelectorAll('#tab-board .toolbar button, #tab-board .toolbar select, #tab-board .toolbar summary, .bar-row1 summary, .bar #save-state')]
      .filter((b) => b.offsetParent && b.getBoundingClientRect().height > 0).map((b) => [b.id || b.textContent.trim().slice(0, 12), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 40);
    return { h1: r1.height, h2: r2.height, thead: document.querySelector('.tt thead').getBoundingClientRect().top, sw: document.documentElement.scrollWidth, save: document.querySelector('#save-state').textContent, small };
  });
  assert.ok(g.h1 <= 56 && g.h2 <= 44, `ส่วนหัว ${g.h1}+${g.h2}`);
  assert.ok(g.thead < 560, `.tt thead top = ${g.thead}`);
  assert.ok(g.sw <= 390, 'scrollWidth ' + g.sw);
  assert.match(g.save, /บันทึกแล้ว/);
  assert.deepEqual(g.small, [], 'ปุ่มเล็กกว่า 40px');
  // เลื่อนลง: แถว 1 ยังติดจอ (sticky) · เมนู ⋯ เปิดแล้วอยู่ในจอ
  await p.evaluate(() => window.scrollTo(0, 600));
  assert.ok(Math.abs(await p.evaluate(() => document.querySelector('.bar-row1').getBoundingClientRect().top)) < 1, 'แถว 1 ติดจอ');
  await p.click('.bar-more > summary');
  const menu = await p.locator('.bar-more .bar-user').boundingBox();
  assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= 390, 'เมนู ⋯ อยู่ในจอ');
  await shot(p, '28-mobile-menu');
  await p.mouse.click(30, 700);
  assert.equal(await p.locator('.bar-more[open]').count(), 0, 'แตะนอกเมนู = ปิด');
  for (const t of ['periods', 'data', 'export', 'board']) {
    await gotoTab(p, t);
    assert.ok((await pageWidth(p)) <= 390, `แท็บ ${t} กว้าง ${await pageWidth(p)}`);
    await assertStyle(p, 'mobile ' + t);
  }
  // ทำให้จัดไม่ลง แล้วจัด
  await p.evaluate(async () => {
    const { store } = await import('./assets/store.js');
    const load = new Map();
    for (const a of store.doc.assignments) if (a.teacherId) load.set(a.teacherId, (load.get(a.teacherId) || 0) + a.perWeek);
    const [id] = [...load.entries()].sort((a, b) => b[1] - a[1])[0];
    store.doc.teachers.find((t) => t.id === id).maxPerDay = 1;
    store.commit('data');
  });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#auto-solve');
  await solveDone(p);
  const see = p.locator('.boon[data-mode="sheet"] .boon-acts button', { hasText: 'ดูวิธีแก้' });
  await see.waitFor({ timeout: 5000 });
  const b = await see.boundingBox();
  assert.ok(b && b.y >= 0 && b.y + b.height <= 844, 'ปุ่ม "ดูวิธีแก้" อยู่ในจอ');
  await shot(p, '29-mobile-comfort');
  await see.click();
  await p.waitForTimeout(700);
  const fixIn = await p.evaluate(() => {
    const f = document.querySelector('#tab-board [data-fix].btn-primary');
    const r = f?.getBoundingClientRect();
    return { hint: f?.hasAttribute('data-next-hint'), inView: !!r && r.top >= 0 && r.bottom <= innerHeight, open: !!f?.closest('details[open]') };
  });
  assert.ok(fixIn.hint && fixIn.inView && fixIn.open, 'ปุ่มแก้สีทองตัวแรกถูกชี้ อยู่ในจอ และอยู่ในข้อที่กางไว้: ' + JSON.stringify(fixIn));
  assert.equal(await p.locator('.swal2-popup:not(.swal2-toast)').count(), 0);
  assert.ok((await pageWidth(p)) <= 390);
  await assertStyle(p, 'mobile board report');
  assert.deepEqual(await check(p, 'mobile delight'), []);
  await m.ctx.close();
});

await test('หน้าแรก (ไม่ล็อกอิน): #donate กางเอง · 390px ไม่มีเลื่อนแนวนอน · ไม่มีสีเขียว/แถบขอบซ้าย · ไม่มี console/CSP', async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    const h = await open(vp);
    await h.page.goto(BASE + '#donate');
    await h.page.waitForSelector('#donate-d[open]', { timeout: 5000 });
    assert.ok((await pageWidth(h.page)) <= vp.width, `index ${vp.width}: กว้าง ${await pageWidth(h.page)}`);
    await shot(h.page, `25-index-donate-${vp.width}`, { fullPage: true });
    await assertStyle(h.page, 'index ' + vp.width);
    for (const pth of ['guide.php', 'privacy.php', 'terms.php']) {
      await h.page.goto(BASE + pth);
      assert.ok((await pageWidth(h.page)) <= vp.width, `${pth} ${vp.width}: กว้าง ${await pageWidth(h.page)}`);
      await assertStyle(h.page, pth + ' ' + vp.width);
    }
    await h.page.goto(BASE + 'guide.php#donate');
    await h.page.waitForSelector('#donate-d[open]', { timeout: 5000 });
    assert.deepEqual(await check(h.page, 'public ' + vp.width), []);
    await h.ctx.close();
  }
});

await test('ฟอร์มข้อเสนอแนะ: ส่งเร็วเกิน 4 วิ = สำเร็จหลอกไม่บันทึก · honeypot = ไม่บันทึก · ส่งจริง = บันทึก 1 แถว · หน้า admin-feedback', async () => {
  if (!DB) return;
  const f = await open({ width: 390, height: 844 });
  const fp = f.page;
  const tag = 'e2e-' + Date.now();
  const count = () => +sql(`SELECT count(*) FROM feedback WHERE message LIKE '%${tag}%'`);
  const fill = async (msg) => {
    await fp.locator('#feedback .tt-chip').first().click();
    await fp.fill('#feedback textarea[name=message]', msg);
  };
  await fp.goto(BASE + '#feedback');
  // 1) เร็วเกิน
  await fill(`ส่งเร็วเกิน ${tag} ข้อความทดสอบ`);
  await fp.click('#feedback button[type=submit]');
  await fp.waitForSelector('#feedback [data-fb-done]:not([hidden])');
  assert.equal(count(), 0, 'ส่งเร็วเกินต้องไม่บันทึก');
  // 2) honeypot
  await fp.click('#feedback [data-fb-again]');
  await fp.waitForTimeout(4300);
  await fill(`honeypot ${tag} ข้อความทดสอบ`);
  await fp.evaluate(() => { document.querySelector('#feedback input[name=website]').value = 'http://spam.example'; });
  await fp.click('#feedback button[type=submit]');
  await fp.waitForSelector('#feedback [data-fb-done]:not([hidden])');
  assert.equal(count(), 0, 'honeypot ต้องไม่บันทึก');
  // 3) ส่งจริง
  await fp.click('#feedback [data-fb-again]');
  await fp.evaluate(() => { document.querySelector('#feedback input[name=website]').value = ''; });
  await fill(`ส่งจริง ${tag} อยากให้มีปุ่มพิมพ์ตารางครู <b>xss</b>`);
  await fp.fill('#feedback input[name=contact]', 'kru@example.com');
  await fp.click('#feedback button[type=submit]');
  await fp.waitForSelector('#feedback [data-fb-done]:not([hidden])');
  assert.equal(count(), 1, 'ส่งจริงต้องบันทึก 1 แถว');
  assert.equal(sql(`SELECT status||'|'||kind||'|'||IFNULL(page,'') FROM feedback WHERE message LIKE '%${tag}%'`).split('|')[0], 'new');
  // หน้าแอดมิน: ไม่ใช่แอดมิน = 404
  let r = await fp.goto(BASE + 'admin-feedback.php');
  assert.equal(r.status(), 404);
  fp.errors.length = 0; // 404 ที่ตั้งใจ (เบราว์เซอร์พิมพ์ลง console เอง)
  // เข้าโหมดทดลอง แล้วยกผู้ใช้นั้นเป็นแอดมินในฐานข้อมูลสำเนา (ทดสอบเท่านั้น)
  await guest(fp);
  sql("UPDATE users SET provider='google', email='sricodeboon@gmail.com' WHERE id=(SELECT max(id) FROM users)");
  r = await fp.goto(BASE + 'admin-feedback.php?s=new');
  assert.equal(r.status(), 200);
  const item = fp.locator('.fb-item', { hasText: tag });
  await item.waitFor();
  assert.match(await item.locator('.fb-msg').innerHTML(), /&lt;b&gt;xss/);
  assert.ok((await pageWidth(fp)) <= 390, 'admin-feedback 390px');
  await assertStyle(fp, 'admin-feedback');
  await shot(fp, '26-admin-feedback', { fullPage: true });
  await item.locator('select[name=status]').selectOption('replied');
  await item.locator('textarea[name=note]').fill('ตอบทางอีเมลแล้ว');
  await item.locator('button[type=submit]').click();
  await fp.waitForLoadState('load');
  assert.equal(sql(`SELECT status||'|'||note_admin FROM feedback WHERE message LIKE '%${tag}%'`), 'replied|ตอบทางอีเมลแล้ว');
  r = await fp.goto(BASE + 'admin.php');
  assert.equal(r.status(), 200);
  assert.deepEqual(await check(fp, 'feedback/admin'), []);
  await f.ctx.close();
});

await test('หน้าแรก: flash ออกจากระบบเป็น toast · CSP ไม่มี violation', async () => {
  await page.goto(BASE + 'app.php');
  await page.waitForSelector('#save-state');
  await page.click('form[action="auth/logout.php"] button');
  await page.waitForURL(/timetable\/(index\.php)?$/);
  await toastText(page, /ออกจากระบบแล้ว/);
  assert.equal(await page.locator('.flash[data-flash]:visible').count(), 0);
  await shot(page, '16-logout-toast');
  assert.deepEqual(await check(page, 'index'), []);
});

await ctx.close();
await browser.close();
console.log(`\nผ่าน ${passed} / ${passed + failed}`);
if (problems.length) console.log('ปัญหาที่พบ:\n' + problems.join('\n'));
if (failed) process.exit(1);
