// ถ่ายภาพหน้าจอจริงสำหรับคู่มือ (guide.php) → assets/guide/*.webp — ไม่ขึ้นโฮสต์ (tools/ ถูกกันด้วย .htaccess และไม่อยู่ใน zip)
// รันกับสำเนาในเครื่อง (โหมดทดลอง):
//   BASE=http://127.0.0.1:8123/timetable/ PW=<โฟลเดอร์ที่มี node_modules/playwright> DB=<sqlite ของสำเนา> node htdocs/timetable/tools/guide-shots.mjs
// ต้องมี cwebp (brew install webp) และ python3 + PyMuPDF (ภาพหน้า PDF) · ภาพถูกบีบเป็น webp กว้าง ≤1100px
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.env.PW || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8123/timetable/';
const OUTDIR = join(dirname(fileURLToPath(import.meta.url)), '../assets/guide');
const TMP = process.env.TMPDIR_SHOTS || '/tmp/tt-guide-shots';
mkdirSync(OUTDIR, { recursive: true }); mkdirSync(TMP, { recursive: true });
if (process.env.DB) try { execFileSync('sqlite3', [process.env.DB, 'DELETE FROM rate_hits']); } catch { /* ไม่มีตาราง */ }

const sizes = {};
function webp(png, name, width = 1100) {
  const out = join(OUTDIR, name + '.webp');
  const w = +execFileSync('sips', ['-g', 'pixelWidth', png]).toString().match(/pixelWidth: (\d+)/)[1];
  const resize = w > width ? ['-resize', String(width), '0'] : []; // ย่อเท่านั้น ไม่ขยาย
  execFileSync('cwebp', ['-quiet', '-q', '74', '-m', '6', ...resize, png, '-o', out]);
  sizes[name] = { kb: Math.round(statSync(out).size / 1024) };
  console.log('✓', name, sizes[name].kb + 'KB');
}
async function snap(page, name, opts = {}) {
  const png = join(TMP, name + '.png');
  await page.screenshot({ path: png, ...opts });
  webp(png, name, opts.width || 1100);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const box = async (page, sel, pad = 8) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
};

const browser = await chromium.launch({ args: ['--lang=th-TH'] }); // ช่องเวลาแสดง 24 ชม. แบบเครื่องภาษาไทย
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH', deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const tab = async (t) => { await page.click(`.tabs [data-tab="${t}"]`); await sleep(250); };
const sec = async (k) => { await tab('data'); await page.click(`[data-sec="${k}"]`); await sleep(250); };
const closeToasts = () => page.evaluate(() => window.Sweetalert2?.close());

// 1 เข้าสู่ระบบ
await page.goto(BASE);
await sleep(400);
await snap(page, 'g01-login', { clip: { x: 0, y: 0, width: 1280, height: 720 } });
await page.click('form[action="auth/guest.php"] button');
await page.waitForURL(/app\.php/);
await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state')?.textContent || ''));
await sleep(1500); await closeToasts();

// 2 กระดานก่อนจัด (กล่องข้อมูลพร้อม)
await snap(page, 'g10-board-ready', { clip: { x: 0, y: 0, width: 1280, height: 640 } });

// 3 โครงคาบ + คาบล็อก
await tab('periods');
await snap(page, 'g02-periods', { clip: await box(page, '#tab-periods .two-col', 10) });

// 4 โรงเรียน
await sec('school');
await snap(page, 'g03-school', { clip: { x: 0, y: 100, width: 1280, height: 560 } });

// 5 ห้องเรียน · ครู
await sec('classes');
await snap(page, 'g04-classes', { clip: { x: 0, y: 100, width: 1280, height: 480 } });
await sec('teachers');
await snap(page, 'g05-teachers', { clip: { x: 0, y: 100, width: 1280, height: 520 } });

// 6 วิชา + เพิ่มจากหลักสูตร
await sec('subjects');
await snap(page, 'g06-subjects', { clip: { x: 0, y: 100, width: 1280, height: 520 } });
await page.click('[data-catalog]');
await page.waitForSelector('dialog.dlg[open]');
await page.locator('dialog.dlg [data-lv="ป.1"]').check().catch(() => {});
await sleep(300);
await snap(page, 'g07-catalog', { clip: await box(page, 'dialog.dlg[open]', 6) });
await page.keyboard.press('Escape'); await sleep(200);

// 7 การสอน: แบ่งสอน + เตือนคาบตามหลักสูตร
await sec('assignments');
await page.locator('.asg-table tbody tr').nth(0).locator('[data-split]').click();
await sleep(400); await closeToasts();
await page.locator('.asg-table tbody tr').nth(2).locator('input[data-f="perWeek"]').fill('4');
await page.locator('.asg-table tbody tr').nth(2).locator('input[data-f="perWeek"]').dispatchEvent('change');
await sleep(300);
await snap(page, 'g08-assign', { clip: { x: 0, y: 180, width: 1280, height: 470 } });
// คืนค่า
await page.locator('.asg-table tbody tr').nth(2).locator('input[data-f="perWeek"]').fill('3');
await page.locator('.asg-table tbody tr').nth(2).locator('input[data-f="perWeek"]').dispatchEvent('change');
await page.locator('.asg-table tbody tr').nth(0).locator('[data-unsplit]').click();
await page.click('.swal2-confirm'); await sleep(500); await closeToasts();

// 8 ลบทั้งหมด: กล่องพิมพ์ "ลบ" + toast เลิกทำ
await page.click('[data-del-all]');
await page.waitForSelector('.swal2-input'); await page.fill('.swal2-input', 'ลบ'); await sleep(500);
await snap(page, 'g09-delete-confirm', { clip: await box(page, '.swal2-popup', 14) });
await page.click('.swal2-confirm'); await sleep(900);
await snap(page, 'g09b-undo', { clip: { x: 520, y: 560, width: 760, height: 240 } });
await page.click('.swal2-toast .swal2-confirm'); await sleep(600); await closeToasts();

// 9 จัดอัตโนมัติ
await tab('board');
await page.click('#auto-solve');
await page.waitForFunction(() => /จัดเสร็จ|วางไม่ลง/.test(document.querySelector('.swal2-toast')?.textContent || ''), null, { timeout: 30000 });
await sleep(1200);
await snap(page, 'g11-board-solved');
await closeToasts();

// 10 ลากวาง (ถ่ายขณะลาก: กรอบน้ำเงิน = วางได้)
await page.evaluate(() => document.querySelector('.grid-wrap').scrollIntoView({ block: 'end' }));
await sleep(200);
const cellEl = page.locator('.tt .cell').nth(3);
const a = await cellEl.boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
await page.mouse.move(a.x + a.width / 2 + 20, a.y + 20, { steps: 4 });
// หาช่องว่างที่วางได้ (กรอบน้ำเงิน) มาเป็นตัวอย่าง
const empties = page.locator('.tt td[data-day]:not(.lock):not(:has(.cell))');
for (let i = 0, n = await empties.count(); i < n; i++) {
  const b = await empties.nth(i).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await sleep(120);
  if (await empties.nth(i).evaluate((td) => td.classList.contains('drop-ok'))) break;
}
await sleep(200);
await snap(page, 'g12-drag');
await page.mouse.up(); await sleep(400);
// เมนูช่อง (คลิกครั้งเดียว)
await page.locator('.tt .cell').nth(2).click(); await sleep(300);
await snap(page, 'g12b-cell-menu', { clip: await box(page, '.cell-menu', 60) });
await page.keyboard.press('Escape'); await page.mouse.click(5, 780); await sleep(200);

// 11 แนวตาราง: คาบเรียงลงล่าง
await page.click('[data-orient="periods"]'); await sleep(400); await closeToasts();
await snap(page, 'g14-orient-periods', { clip: { x: 0, y: 120, width: 1280, height: 680 } });
await page.click('[data-orient="days"]'); await sleep(300);

// 12 จัดไม่ครบ: ตั้งครูคนแรกสอนได้วันละ 1 คาบ → กล่องสาเหตุ + วิธีแก้
await sec('teachers');
await page.locator('#data-body input[data-f="maxPerDay"]').first().fill('1');
await page.locator('#data-body input[data-f="maxPerDay"]').first().dispatchEvent('change');
await tab('board');
await page.click('#clear-auto'); await sleep(300); await closeToasts();
await page.click('#auto-solve');
await page.waitForSelector('.swal2-popup:not(.swal2-toast) .swal2-deny', { timeout: 30000 });
await sleep(700);
await snap(page, 'g13-unplaced-modal', { clip: await box(page, '.swal2-popup', 14) });
await page.click('.swal2-confirm'); await sleep(800);
await snap(page, 'g13b-unplaced-callout', { clip: await box(page, '.callout', 10) });
await sec('teachers');
await page.locator('#data-body input[data-f="maxPerDay"]').first().fill('6');
await page.locator('#data-body input[data-f="maxPerDay"]').first().dispatchEvent('change');
await tab('board'); await page.click('#auto-solve'); await sleep(2500); await closeToasts();

// 13 ส่งออก + ภาพหน้า PDF จริง
await tab('export');
await snap(page, 'g15-export', { clip: { x: 0, y: 100, width: 1280, height: 640 } });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-pdf="class"][data-mode="each"]')]);
const pdf = join(TMP, 'sample.pdf'); await dl.saveAs(pdf);
execFileSync('python3', ['-c', 'import fitz,sys;d=fitz.open(sys.argv[1]);d[0].get_pixmap(dpi=110).save(sys.argv[2])', pdf, join(TMP, 'g16-pdf.png')]);
webp(join(TMP, 'g16-pdf.png'), 'g16-pdf');
await sleep(1500); await closeToasts();

// 14 ภาคเรียนใหม่แบบสำเนา
await page.selectOption('#term-select', '__new');
await page.waitForSelector('.swal2-popup #nt-kind'); await sleep(600);
await snap(page, 'g17-newterm', { clip: await box(page, '.swal2-popup', 14) });
await page.click('.swal2-cancel'); await sleep(300);

// 15 มือถือ
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH', deviceScaleFactor: 2, hasTouch: true });
const mp = await m.newPage();
await mp.goto(BASE); await mp.click('form[action="auth/guest.php"] button'); await mp.waitForURL(/app\.php/);
await mp.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state')?.textContent || ''));
await mp.click('#auto-solve'); await sleep(2500); await mp.evaluate(() => window.Sweetalert2?.close());
await mp.evaluate(() => document.querySelector('.grid-wrap').scrollIntoView({ block: 'center' })); await sleep(300);
const mpng = join(TMP, 'g18-mobile.png'); await mp.screenshot({ path: mpng });
webp(mpng, 'g18-mobile', 390);
await m.close();

await browser.close();
writeFileSync(join(TMP, 'sizes.json'), JSON.stringify(sizes, null, 1));
console.log('รวม', Object.values(sizes).reduce((n, s) => n + s.kb, 0) + 'KB');
rmSync(join(TMP, 'sample.pdf'), { force: true });
