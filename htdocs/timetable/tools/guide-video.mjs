// อัดคลิปสาธิตหน้าจอจริงสำหรับคู่มือ → assets/guide/demo.mp4 (+ demo-poster.jpg) — ไม่ขึ้นโฮสต์
// เล่นเส้นทางผู้ใช้ในโหมดทดลองบนเซิร์ฟเวอร์ในเครื่อง ตั้งแต่ลองใช้ → โครงคาบ → ข้อมูล → การสอน → จัดอัตโนมัติ → ลากวาง → แนวตาราง → PDF
// คำบรรยายภาษาไทย/ตัวชี้เมาส์ ฉีดเข้าหน้าเฉพาะตอนอัด (page.addInitScript) ไม่อยู่ในโค้ดของระบบ
// รัน: BASE=http://127.0.0.1:8123/timetable/ PW=<โฟลเดอร์ที่มี node_modules/playwright> DB=<sqlite ของสำเนา> node htdocs/timetable/tools/guide-video.mjs
// ต้องมี ffmpeg (brew install ffmpeg) และ python3 + PyMuPDF (ภาพหน้า PDF ในคลิป)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.env.PW || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8123/timetable/';
const OUTDIR = join(dirname(fileURLToPath(import.meta.url)), '../assets/guide');
const TMP = process.env.TMPDIR_VIDEO || '/tmp/tt-guide-video';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true }); mkdirSync(OUTDIR, { recursive: true });
if (process.env.DB) try { execFileSync('sqlite3', [process.env.DB, 'DELETE FROM rate_hits']); } catch { /* ไม่มีตาราง */ }

const W = 1280, H = 720;
const browser = await chromium.launch({ args: ['--lang=th-TH'] }); // ช่องเวลาแสดง 24 ชม. แบบเครื่องภาษาไทย
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'th-TH', deviceScaleFactor: 1, acceptDownloads: true, recordVideo: { dir: TMP, size: { width: W, height: H } } });
// คำบรรยาย + ตัวชี้เมาส์ (เฉพาะตอนอัด)
await ctx.addInitScript(() => {
  const boot = () => {
    if (document.getElementById('__cap')) return;
    const cap = document.createElement('div');
    cap.id = '__cap';
    Object.assign(cap.style, { position: 'fixed', left: '50%', bottom: '92px', transform: 'translateX(-50%)', zIndex: 2147483647, maxWidth: '920px', width: 'max-content',
      background: 'rgba(15,36,56,.94)', color: '#fff', font: '600 25px/1.45 "IBM Plex Sans Thai", system-ui, sans-serif', padding: '14px 26px', borderRadius: '14px',
      borderLeft: '6px solid #C8962E', boxShadow: '0 8px 30px rgba(0,0,0,.35)', textAlign: 'center', pointerEvents: 'none', transition: 'opacity .25s', opacity: '0' });
    const step = document.createElement('div');
    Object.assign(step.style, { font: '600 16px/1.2 "IBM Plex Sans Thai", system-ui, sans-serif', color: '#E3B85A', marginBottom: '4px' });
    const txt = document.createElement('div');
    cap.append(step, txt);
    document.body.appendChild(cap);
    const dot = document.createElement('div');
    dot.id = '__dot';
    Object.assign(dot.style, { position: 'fixed', left: '-40px', top: '-40px', width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px', borderRadius: '50%',
      background: 'rgba(200,150,46,.55)', border: '2px solid #0F2438', zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .12s' });
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
    window.__caption = (s, t) => { step.textContent = s || ''; step.style.display = s ? '' : 'none'; txt.textContent = t || ''; cap.style.opacity = t ? '1' : '0'; };
    const pend = window.__pendingCap; if (pend) window.__caption(...pend);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
});
const page = await ctx.newPage();
const t0 = Date.now();
let tPoster = 60;
page.on('pageerror', (e) => console.log('pageerror', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mx = W / 2, my = H / 2;
async function say(step, text, ms = 3800) {
  await page.evaluate(([s, t]) => { window.__pendingCap = [s, t]; window.__caption?.(s, t); }, [step, text]);
  if (ms) await sleep(ms);
}
async function moveTo(sel, { steps = 22, dx = 0, dy = 0 } = {}) {
  const el = typeof sel === 'string' ? page.locator(sel).first() : sel;
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy;
  await page.mouse.move(x, y, { steps });
  mx = x; my = y;
}
async function click(sel, opts = {}) { await moveTo(sel, opts); await sleep(350); await page.mouse.down(); await sleep(90); await page.mouse.up(); await sleep(opts.after ?? 700); }
const tab = (t) => click(`.tabs [data-tab="${t}"]`, { after: 900 });
const sec = (k) => click(`[data-sec="${k}"]`, { after: 900 });
const closeSwal = () => page.evaluate(() => window.Sweetalert2?.close());

// ---------- เริ่ม ----------
await page.goto(BASE);
await page.mouse.move(mx, my);
await say('', 'ตารางบริบูรณ์ · ระบบจัดตารางเรียนตารางสอนออนไลน์ ใช้ฟรี', 3600);
await say('เข้าใช้งาน', 'ใช้งานจริง: เข้าสู่ระบบด้วย Google หรือ LINE แล้วลงทะเบียนโรงเรียน', 3600);
await moveTo('form[action="auth/guest.php"] button');
await say('เข้าใช้งาน', 'คลิปนี้กด “ลองใช้ทันที” ได้โรงเรียนทดลองพร้อมข้อมูลตัวอย่าง', 3000);
await click('form[action="auth/guest.php"] button', { after: 300 });
await page.waitForURL(/app\.php/);
await page.waitForFunction(() => /บันทึกแล้ว/.test(document.querySelector('#save-state')?.textContent || ''));
await say('', 'เข้าสู่ระบบแล้ว · ระบบบันทึกให้อัตโนมัติ ดูสถานะที่มุมขวาบน', 3600);

await tab('periods');
await say('ขั้นที่ 1 · โครงคาบ', 'ตั้งวันเรียน เวลาเริ่ม–จบของแต่ละคาบ และช่วงพัก', 4200);
await moveTo('.lock-grid td.lock');
await say('ขั้นที่ 1 · คาบล็อก', 'คลิกช่องเพื่อล็อกคาบกิจกรรม เช่น ลูกเสือ ชุมนุม แนะแนว', 4200);

await tab('data');
await sec('classes');
await say('ขั้นที่ 2 · ห้องเรียน', 'เพิ่มห้องเรียน เช่น ม.1/1 ป.6/2 ระบบบอกคาบ/สัปดาห์ที่มอบหมายเทียบกับช่องว่าง', 4200);
await sec('teachers');
await moveTo('.mini-grid button.on', {});
await say('ขั้นที่ 3 · ครู', 'ตั้งจำนวนคาบสูงสุดต่อวัน และคลิกช่องเล็กเพื่อบอกคาบที่ครูไม่ว่าง (สีแดง)', 4600);
await sec('subjects');
await moveTo('#data-body tbody tr input[data-f="perWeek"]');
await say('ขั้นที่ 4 · วิชา', 'แต่ละวิชามี “คาบ/สัปดาห์ตามหลักสูตร” (ประถม 1 คาบ = 40 ชม./ปี · มัธยม 2 คาบ = 1 หน่วยกิต)', 5200);
await click('[data-catalog]', { after: 900 });
await say('ขั้นที่ 4 · วิชา', 'ปุ่ม “เพิ่มจากหลักสูตรแกนกลาง…” ใส่รายวิชาพื้นฐานพร้อมคาบ/สัปดาห์ให้เลย', 4600);
await page.keyboard.press('Escape'); await sleep(500);

await sec('assignments');
await say('ขั้นที่ 5 · การสอน', 'จับคู่ วิชา × ห้อง × ครู × คาบ/สัปดาห์ — รายการนี้คือสิ่งที่ระบบนำไปจัด', 4400);
await moveTo('.asg-table tbody tr:nth-child(2) select[data-f="subjectId"]');
await say('ขั้นที่ 5 · การสอน', 'ช่องเลือกวิชาไม่แสดงวิชาที่ห้องนี้มีแล้ว จึงเลือกซ้ำไม่ได้', 4200);
await click('.asg-table tbody tr:nth-child(1) [data-split]', { after: 600 });
await say('ขั้นที่ 5 · แบ่งสอน', 'วิชาเดียวสอน 2 ครู กด “แบ่งสอน” ได้ 2 แถวที่ผูกกัน คาบรวมยังเท่าหลักสูตร', 5000);
await closeSwal();
await click('.asg-table tbody tr:nth-child(1) [data-unsplit]', { after: 700 });
await click('.swal2-confirm', { after: 900 }); await closeSwal();
await click('[data-del-all]', { after: 900 });
await say('ขั้นที่ 5 · ลบทั้งหมด', 'ลบการสอนทั้งห้องได้ แต่ต้องพิมพ์คำว่า “ลบ” ยืนยันก่อน ระบบบอกจำนวนที่จะหาย', 4200);
await page.locator('.swal2-input').pressSequentially('ลบ', { delay: 180 }); await sleep(600);
await click('.swal2-confirm', { after: 700 });
await moveTo('.swal2-toast .swal2-confirm');
await say('ขั้นที่ 5 · เลิกทำ', 'ลบพลาด? กด “เลิกทำ” ภายใน 10 วินาที ข้อมูลและคาบที่วางไว้กลับมาครบ', 3600);
await click('.swal2-toast .swal2-confirm', { after: 1400 });
await closeSwal();

await tab('board');
await say('ขั้นที่ 6 · จัดตาราง', 'ข้อมูลพร้อมแล้ว กด “จัดอัตโนมัติ” ระบบวางทุกวิชาให้ไม่ชนกัน', 3600);
await click('#auto-solve', { after: 300 });
await page.waitForFunction(() => /จัดเสร็จ|วางไม่ลง/.test(document.querySelector('.swal2-toast')?.textContent || ''), null, { timeout: 30000 });
tPoster = (Date.now() - t0) / 1000 + 1.5; // ภาพปก = กระดานที่จัดเสร็จ
await say('ขั้นที่ 6 · จัดตาราง', 'จัดครบทุกคาบในไม่กี่วินาที ไม่มีคาบชน · ถ้าวางไม่ลง ระบบบอกสาเหตุและวิธีแก้', 5200);
// ลากย้ายคาบ → ช่องกรอบน้ำเงิน
const src = page.locator('.tt .cell').nth(4);
await moveTo(src);
await page.mouse.down();
await page.mouse.move(mx + 20, my + 16, { steps: 6 });
const empties = page.locator('.tt td[data-day]:not(.lock):not(:has(.cell))');
for (let i = 0, n = await empties.count(); i < n; i++) {
  await moveTo(empties.nth(i), { steps: 26 });
  await sleep(250);
  if (await empties.nth(i).evaluate((td) => td.classList.contains('drop-ok'))) break;
}
await say('ขั้นที่ 7 · ลากวาง', 'ลากคาบไปวาง ช่องกรอบน้ำเงิน = วางได้ · กรอบแดง = ชน พร้อมบอกเหตุผล', 3800);
await page.mouse.up(); await sleep(600);
await say('ขั้นที่ 7 · ลากวาง', 'คาบที่ลากเองจะปักหมุด 📌 จัดอัตโนมัติรอบถัดไปจะไม่ย้าย', 3800);
await closeSwal();
await click('[data-orient="periods"]', { after: 900 });
await say('ขั้นที่ 8 · แนวตาราง', 'เลือกแนวตารางได้: “คาบเรียงลงล่าง” แบบนี้ หรือ…', 3400);
await click('[data-orient="days"]', { after: 900 });
await say('ขั้นที่ 8 · แนวตาราง', '“วันเรียงลงล่าง” (ค่าเริ่มต้น) ใช้กับกระดาน PDF และ Excel', 3800);

await tab('export');
await say('ขั้นที่ 9 · ส่งออก', 'ส่งออก Excel หรือ PDF รายห้อง/รายครู เลือก 1, 2 หรือ 4 ตาราง/หน้า', 3800);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), click('[data-pdf="class"][data-mode="each"]', { after: 200 })]);
const pdf = join(TMP, 'demo.pdf'); await dl.saveAs(pdf);
await page.waitForFunction(() => /สร้าง PDF เสร็จ/.test(document.querySelector('.swal2-toast')?.textContent || ''), null, { timeout: 30000 });
await say('ขั้นที่ 9 · ส่งออก', 'สร้างไฟล์ PDF เสร็จและดาวน์โหลดให้ทันที', 2600);
const png = join(TMP, 'pdf.png');
execFileSync('python3', ['-c', 'import fitz,sys;d=fitz.open(sys.argv[1]);d[0].get_pixmap(dpi=100).save(sys.argv[2])', pdf, png]);
await page.evaluate((src) => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'fixed', inset: '0', background: 'rgba(11,20,28,.7)', zIndex: 2147483646, display: 'grid', placeItems: 'center', padding: '20px 20px 110px' });
  const img = new Image(); img.src = src;
  Object.assign(img.style, { maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,.5)', background: '#fff' });
  wrap.appendChild(img); document.body.appendChild(wrap);
}, 'data:image/png;base64,' + readFileSync(png).toString('base64'));
await say('ขั้นที่ 9 · ไฟล์ PDF', 'ตารางเรียนพร้อมพิมพ์ A4 แนวนอน ภาษาไทยถูกต้อง มีโลโก้โรงเรียน', 5600);
await say('', 'จบแล้ว · ระบบบันทึกให้อัตโนมัติ · อ่านคู่มือทีละขั้นด้านล่างคลิปนี้', 4200);

const vid = page.video();
await ctx.close();
const webm = await vid.path();
await browser.close();

// ---------- แปลงเป็น MP4 H.264 720p (+ poster) ----------
const mp4 = join(OUTDIR, 'demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'scale=1280:720:flags=lanczos,fps=24', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '30',
  '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4]).toString();
const poster = join(OUTDIR, 'demo-poster.jpg');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(dur - 1, tPoster)), '-i', mp4, '-frames:v', '1', '-q:v', '5', poster]);
console.log(`demo.mp4 ${(statSync(mp4).size / 1048576).toFixed(2)}MB · ${dur.toFixed(1)} วินาที · poster ${Math.round(statSync(poster).size / 1024)}KB`);
for (const f of readdirSync(TMP)) if (f.endsWith('.webm')) console.log('ต้นฉบับ', join(TMP, f));
