// ทดสอบ e2e ในเบราว์เซอร์จริง (Playwright) — ไม่ขึ้นโฮสต์ (tests/.htaccess กันไว้)
// รัน: BASE=http://127.0.0.1:8123/timetable/ DB=<ไฟล์ sqlite ของสำเนาทดสอบ> OUT=<โฟลเดอร์ผล> PW=<โฟลเดอร์ที่มี node_modules/playwright> node tests/e2e/timetable.e2e.mjs
// ครอบ: SweetAlert2 (toast/ยืนยัน/พิมพ์ "ลบ"/เลิกทำ/409/ตัวสำรองเมื่อโหลด CDN ไม่ได้) · กันวิชาซ้ำ · แบ่งสอน · คาบ/สัปดาห์ตามหลักสูตร
// · ลบทั้งหมด+เลิกทำ · แนวตาราง 2 แบบ (ลากวาง/คาบล็อก/พัก) · PDF/Excel · ข้อมูลภาคเรียนแบบเก่า · จอ 390px · ไม่มี console error/CSP
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

async function guest(page) {
  await page.goto(BASE);
  await page.click('form[action="auth/guest.php"] button');
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

await test('จัดอัตโนมัติ: toast กำลังจัด → จัดเสร็จ N คาบ · ไม่มีจุดชน', async () => {
  await page.click('#auto-solve');
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
  await m.page.click('[data-orient="periods"]'); await over('board periods');
  // ลากด้วยนิ้ว (pointer) ในแนววันเรียงลงล่างบนมือถือ
  await m.page.click('[data-orient="days"]');
  await m.page.click('#clear-auto');
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
