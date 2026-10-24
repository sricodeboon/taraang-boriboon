// แท็บส่งออก: Excel (ExcelJS), PDF (สร้างไฟล์ในเบราว์เซอร์ด้วย pdfmake ดู pdf.js), สำรอง/นำเข้า JSON
import { store, idx, DAY_NAMES, lockAt, esc, assignmentLabel } from './store.js';
import { orientation, ORIENTS } from './rules.js';
import * as notify from './notify.js';
import * as motion from './motion.js';
// pdf.js โหลดเมื่อกดส่งออกครั้งแรกเท่านั้น
const pdfModule = () => import('./pdf.js');

let root = null;
let perPage = 1, paper = null; // paper null = ตามขนาดโรงเรียน (ห้อง×คาบ > 36 → A3)

// ---------- กล่องเลี้ยงโอวัลติน + ฟอร์มข้อเสนอแนะรุ่นย่อ (app.php วาง #tt-support ไว้นอก <main>) ----------
// ย้ายทั้งก้อนมาท้ายแท็บ (ไม่สร้างใหม่) → ปุ่มที่ home.js ผูกไว้และข้อความที่พิมพ์ค้างอยู่ครบ
// ลิงก์ #donate / #feedback (เมนูบนหัวจอ หรือมาจากหน้าแรกตอนล็อกอินแล้ว) = เปิดแท็บส่งออกแล้วเลื่อนไปที่กล่อง
const SUPPORT_IDS = ['donate', 'feedback'];
let wantHash = '';
let supportEl = null;
const support = () => (supportEl ??= document.getElementById('tt-support')); // จำไว้ เพราะตอนย้ายถูกถอดออกจากหน้าชั่วคราว
function supportFromHash() {
  const id = location.hash.slice(1);
  if (!SUPPORT_IDS.includes(id) || !support()?.querySelector('#' + id)) return;
  wantHash = id;
  document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'export' } }));
}
addEventListener('hashchange', supportFromHash);
// กดลิงก์เดิมซ้ำ (hash ไม่เปลี่ยน = ไม่มี hashchange) ก็ยังพาไป
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#"]');
  if (a && a.getAttribute('href') === location.hash) supportFromHash();
});
setTimeout(supportFromHash); // ตอนโหลดหน้า: รอ app.js ผูกตัวรับ tt:goto ก่อน (ยังไม่มีข้อมูล = แท็บส่งออกเปิดเมื่อโหลดเสร็จ)
function placeSupport(el) {
  const box = support();
  if (!box) return;
  el.append(box);
  box.hidden = false;
  if (!wantHash) return;
  const target = box.querySelector('#' + wantHash);
  wantHash = '';
  if (target?.matches('.tt-donate')) target.querySelector('details').open = true;
  if (!target) return;
  // หัวกล่องต้องพ้นแถบหัวจอที่ติดด้านบน (มือถือแถบหัวสูง) · scroll-margin ใช้กับ home.js ที่เลื่อนตาม hash ด้วย
  const bar = document.querySelector('.bar');
  for (const id of SUPPORT_IDS) box.querySelector('#' + id)?.style.setProperty('scroll-margin-top', (bar?.offsetHeight || 0) + 12 + 'px');
  requestAnimationFrame(() => { target.scrollIntoView({ block: 'start' }); });
}

export function render(el) {
  root = el;
  const d = store.doc;
  const o = orientation(d);
  const autoPaper = autoPaperOf(d);
  const curPaper = paper || autoPaper;
  if (mine && !d.teachers.some((t) => t.id === mine)) mine = null;
  const share = canShareFiles();
  css();
  support()?.remove(); // เอาออกก่อน innerHTML ใหม่ ไม่งั้นกล่องถูกลบทิ้งไปกับเนื้อหาเดิม
  el.innerHTML = `<div class="card export-orient">
      <div><b>แนวตารางรายห้อง / รายครู</b>
        <p class="muted" style="margin:2px 0 0;font-size:.88rem">${o === 'days' ? 'วันเรียงลงล่าง: แถว = วัน (จันทร์–ศุกร์) คอลัมน์ = คาบ' : 'คาบเรียงลงล่าง: แถว = คาบ คอลัมน์ = วัน'} · ใช้กับกระดานจัดตาราง PDF และ Excel (ตารางรวมทั้งโรงเรียนเป็น แถว = ห้อง/ครู เสมอ)</p></div>
      <div class="seg orient-seg" role="group" aria-label="แนวตาราง">${ORIENTS.map(([k, t]) => `<button data-orient="${k}" aria-pressed="${k === o}">${t}</button>`).join('')}</div>
    </div>
    <div class="export-grid">
    <div class="card">
      <h3 style="font-size:1.05rem">PDF รายห้อง / รายครู</h3>
      <p class="muted" style="margin:0">หัวกระดาษมีชื่อโรงเรียน ภาคเรียน ครูประจำชั้น และคำอธิบายสีท้ายตาราง · เลือกย่อหลายตารางต่อหน้าเพื่อประหยัดกระดาษได้</p>
      <div class="seg-row" role="radiogroup" aria-label="จำนวนตารางต่อหน้า">
        ${[[1, '1 ตาราง/หน้า'], [2, '2 ตาราง/หน้า'], [4, '4 ตาราง/หน้า']].map(([n, t]) => `<label><input type="radio" name="per" value="${n}" ${n === perPage ? 'checked' : ''}> ${t}</label>`).join('')}
      </div>
      <div class="x-row">
        <button class="btn btn-primary" data-pdf="class" data-mode="each">ตารางเรียนทุกห้อง (${d.classes.length})</button>
        <button class="btn" data-pdf="teacher" data-mode="each">ตารางสอนครูทุกคน (${d.teachers.length})</button>
      </div>
      <div class="x-tools" role="group" aria-label="ดูก่อน พิมพ์ หรือส่งต่อ">
        <label class="muted" for="x-set">ดูก่อน / พิมพ์ / ส่ง:</label>
        <select id="x-set" class="input input-sm"><option value="class"${set === 'class' ? ' selected' : ''}>ตารางเรียนทุกห้อง</option><option value="teacher"${set === 'teacher' ? ' selected' : ''}>ตารางสอนครูทุกคน</option></select>
        <button class="btn btn-sm" data-x="preview">${ICON.eye}ดูตัวอย่าง</button>
        <button class="btn btn-sm" data-x="print">${ICON.print}พิมพ์</button>
        ${share ? `<button class="btn btn-sm" data-x="share">${ICON.share}ส่งเข้า LINE / แชร์</button>` : ''}
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">ตารางสอนของฉัน · แจกครู</h3>
      <p class="muted" style="margin:0">เลือกครู ได้ PDF 1 หน้า (สอน/ว่างกี่คาบ ประจำชั้นไหน) ส่งเข้า LINE ให้ครูแต่ละคนได้จากมือถือ</p>
      ${d.teachers.length ? `<div class="x-tools">
        <label class="muted" for="x-mine">ครู</label>
        <select id="x-mine" class="input input-sm">${d.teachers.map((t) => `<option value="${esc(t.id)}"${t.id === mine ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      </div>
      <div class="x-row">
        <button class="btn btn-primary" data-mine="pdf">ดาวน์โหลด PDF ของครูคนนี้</button>
        <button class="btn btn-sm" data-mine="preview">${ICON.eye}ดูตัวอย่าง</button>
        ${share ? `<button class="btn btn-sm" data-mine="share">${ICON.share}ส่งเข้า LINE / แชร์</button>` : ''}
      </div>` : '<p class="hint" style="margin:0">ยังไม่มีครู — เพิ่มที่ ข้อมูล → ครู</p>'}
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">Excel (.xlsx)</h3>
      <p class="muted" style="margin:0">ชีตแรก “สรุป” (คาบต่อครู/ห้อง และคาบว่าง) ตามด้วยตารางรวม รายห้อง และรายครู มีเส้นตาราง สีวิชา โลโก้ หัวตารางตรึงไว้ พร้อมพิมพ์ A4 แนวนอน</p>
      <div class="x-row"><button class="btn btn-primary" id="x-xlsx">ดาวน์โหลด Excel</button></div>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">ตารางรวมทั้งโรงเรียน</h3>
      <p class="muted" style="margin:0">ทุกห้องหรือทุกครูในแผ่นเดียว แต่ละช่องแสดงชื่อย่อวิชากับชื่อย่อครู เหมาะติดบอร์ดห้องวิชาการ</p>
      <div class="seg-row" role="radiogroup" aria-label="ขนาดกระดาษ">
        ${['A4', 'A3'].map((x) => `<label><input type="radio" name="paper" value="${x}" ${x === curPaper ? 'checked' : ''}> ${x} แนวนอน${x === autoPaper ? ' <span class="muted">(แนะนำ)</span>' : ''}</label>`).join('')}
        <label><input type="checkbox" name="split" ${split ? 'checked' : ''}> แยก 2 หน้า (${esc(halfDays(d))})</label>
      </div>
      <div class="x-row">
        <button class="btn" data-pdf="class" data-mode="overview">รวมทุกห้อง</button>
        <button class="btn" data-pdf="teacher" data-mode="overview">รวมครูทุกคน</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">สำรองข้อมูล</h3>
      <p class="muted" style="margin:0">เก็บไฟล์ .json ไว้ในเครื่อง นำกลับมาใช้ภายหลังหรือย้ายไปภาคเรียนอื่นได้</p>
      <div class="x-row">
        <button class="btn" id="b-save">ดาวน์โหลดไฟล์สำรอง</button>
        <label class="btn">นำเข้าไฟล์สำรอง<input type="file" id="b-load" accept=".json,application/json" hidden></label>
      </div>
    </div>
  </div>`;
  el.querySelectorAll('[data-orient]').forEach((b) => b.addEventListener('click', () => {
    if (orientation(d) === b.dataset.orient) return;
    d.settings.orientation = b.dataset.orient;
    store.commit('settings');
    notify.ok(`เปลี่ยนเป็น “${b.textContent}” แล้ว`, 2500);
  }));
  el.querySelector('#x-xlsx').addEventListener('click', (e) => exportXlsx(e.currentTarget));
  el.querySelectorAll('input[name=per]').forEach((r) => r.addEventListener('change', () => { perPage = +r.value; }));
  el.querySelectorAll('input[name=paper]').forEach((r) => r.addEventListener('change', () => { paper = r.value; }));
  el.querySelector('input[name=split]')?.addEventListener('change', (e) => { split = e.target.checked; });
  el.querySelector('#x-set').addEventListener('change', (e) => { set = e.target.value === 'teacher' ? 'teacher' : 'class'; });
  el.querySelector('#x-mine')?.addEventListener('change', (e) => { mine = e.target.value; });
  el.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => exportPdf(b)));
  el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => tool(b.dataset.x, b, { kind: set, mode: 'each', perPage })));
  el.querySelectorAll('[data-mine]').forEach((b) => b.addEventListener('click', () => {
    const id = mine || el.querySelector('#x-mine')?.value;
    if (!id) return;
    const opts = { kind: 'teacher', mode: 'each', perPage: 1, ids: [id] };
    if (b.dataset.mine === 'pdf') exportPdf(b, opts); else tool(b.dataset.mine, b, opts);
  }));
  el.querySelector('#b-save').addEventListener('click', backup);
  el.querySelector('#b-load').addEventListener('change', restore);
  placeSupport(el);
}

// ---------- ตัวช่วยของแท็บ ----------
let set = 'class', mine = null, split = false;
// ป้าย (แนะนำ) ใช้ร่วมกันทั้งปุ่ม "รวมทุกห้อง" และ "รวมครูทุกคน" → คิดจากฝั่งที่มากกว่า (ห้องหรือครู) × คาบเรียน > 36 = A3
// ตรงกับ pdf.js defaultPaper(kind) ของปุ่มที่หนักกว่า และสิ่งที่ติ๊กไว้ = กระดาษที่ได้จริง (ไม่มี A4 ตัวเล็กเพราะครูเยอะกว่าห้อง)
const autoPaperOf = (d) => (Math.max(d.classes.length, d.teachers.length) * d.term.periods.filter((p) => p.type !== 'break').length > 36 ? 'A3' : 'A4');
const halfDays = (d) => { const n = d.term.days, h = Math.ceil(n / 2); return n > 1 ? `${DAY_NAMES[0]}–${DAY_NAMES[h - 1]} / ${DAY_NAMES[h]}–${DAY_NAMES[n - 1]}` : DAY_NAMES[0]; };
const narrow = () => !!window.matchMedia?.('(max-width: 560px)').matches;
let shareOk = null;
/** แชร์ไฟล์ได้ไหม (มือถือส่วนใหญ่ได้ → LINE/Messenger/อีเมล) · ไม่ได้ = ไม่แสดงปุ่ม */
function canShareFiles() {
  if (shareOk !== null) return shareOk;
  try { shareOk = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }); } catch { shareOk = false; }
  return shareOk;
}
const ICON = {
  eye: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z"/></svg>',
  print: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v4H7zM5 8h14a2 2 0 012 2v6h-4v4H7v-4H3v-6a2 2 0 012-2zm4 7v3h6v-3z"/></svg>',
  share: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18 16a3 3 0 00-2.4 1.2l-6.7-3.4a3 3 0 000-1.6l6.7-3.4A3 3 0 1015 7c0 .3 0 .5.1.8L8.4 11.2a3 3 0 100 3.6l6.7 3.4A3 3 0 1018 16z"/></svg>',
  file: (ext) => `<span class="fly-file" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 2h8l6 6v14H6zm8 1.5V9h5.5"/></svg>${ext}</span>`,
};
function css() {
  if (document.getElementById('tt-export-css')) return;
  const s = document.createElement('style');
  s.id = 'tt-export-css';
  s.textContent = `.x-row{display:flex;gap:8px;flex-wrap:wrap}
.x-tools{display:flex;gap:6px 8px;flex-wrap:wrap;align-items:center;padding-top:10px;border-top:1px solid var(--line)}
.x-tools .input-sm{width:auto;max-width:100%;min-width:0;padding:5px 10px}
.x-tools .btn svg,.x-row .btn svg{flex:none}
.dlg.pdf-dlg{width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:14px;display:grid;gap:10px}
.pdf-dlg[open]{display:grid}
.pdf-dlg .pdf-prev{display:block;width:100%;height:min(70vh,640px);border:1px solid var(--line);border-radius:10px;background:#E9EDF1}
.pdf-dlg .pdf-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.pdf-dlg .pdf-head h3{font-size:1.05rem;flex:1;min-width:0;overflow-wrap:anywhere}
.pdf-dlg .x-row{justify-content:flex-end}`;
  document.head.appendChild(s);
}

/** ไฟล์พร้อม → ไอคอนไฟล์บินลงมุมล่างขวา (เหมือนลงถาดดาวน์โหลด) · ลดภาพเคลื่อนไหว = ข้าม */
function flyFile(btn, ext) {
  if (!btn?.isConnected || motion.still()) return;
  const dock = Object.assign(document.createElement('i'), { className: 'fly-dock' });
  dock.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dock);
  motion.flyTo(btn, dock, { html: ICON.file(ext), dur: 600 }).finally(() => dock.remove());
}

// ครูบูรณ์ (mascot.js) สั่งงานแท็บนี้: tt:goto { tab:'export', action:'pdf-all' | 'share' } — รอ app.js วาดแท็บก่อนแล้วกดปุ่มจริง (เห็นสถานะ busy เหมือนกดเอง)
document.addEventListener('tt:goto', (e) => {
  const g = e.detail || {};
  if (g.tab !== 'export' || !g.action) return;
  requestAnimationFrame(() => {
    if (!root?.isConnected || root.hidden) return;
    if (g.action === 'pdf-all') {
      const b = root.querySelector('[data-pdf="class"][data-mode="each"]');
      if (b) { b.scrollIntoView({ block: 'center' }); exportPdf(b); }
    } else if (g.action === 'share') {
      const b = root.querySelector('[data-x="share"]') || root.querySelector('[data-pdf="class"][data-mode="each"]');
      if (!b) return;
      if (b.dataset.x === 'share') tool('share', b, { kind: 'class', mode: 'each', perPage }); else exportPdf(b);
    }
  });
});

// ---------- Excel (ExcelJS: มีเส้นตาราง สีวิชา โลโก้ และตั้งหน้ากระดาษพร้อมพิมพ์) ----------
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
const EXCELJS_SRI = 'sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==';
const XL = { ink: '0F2438', muted: '5B6B7A', line: '9AA5B1', head: 'EEF2F6', brk: 'F4F5F7', lock: 'E9E6F2', clash: 'FBE3E3' };
const argb = (hex) => 'FF' + String(hex || '').replace('#', '').toUpperCase();
const thin = { style: 'thin', color: { argb: argb(XL.line) } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FONT = 'TH Sarabun New';

/** ช่องในตารางรายห้อง/รายครู: ข้อความ + สีพื้น */
function slotCell(kind, id, day, period) {
  const pls = store.doc.placements.filter((p) => {
    if (p.day !== day || p.period !== period) return false;
    const a = idx.asg.get(p.assignmentId);
    return a && (kind === 'class' ? a.classId === id : a.teacherId === id);
  });
  if (!pls.length) {
    const lk = kind === 'class' ? lockAt(id, day, period) : null;
    return lk ? { text: lk.label || 'กิจกรรม', fill: XL.lock, lock: true } : { text: '' };
  }
  const L = pls.map((p) => assignmentLabel(idx.asg.get(p.assignmentId)));
  const text = L.map((x) => {
    const who = kind === 'class' ? (x.tch?.short || x.tch?.name || '') : (x.cls?.name || '');
    return [`${x.code ? x.code + ' ' : ''}${x.name}`, [who, x.room?.name].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  }).join('\n— ชน —\n');
  return { text, fill: L.length > 1 ? XL.clash : null, color: L.length > 1 ? null : L[0].color };
}

function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.integrity = EXCELJS_SRI; // SRI: ไฟล์บน CDN ถูกแก้ → ไม่รัน
    s.crossOrigin = 'anonymous';
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => fail(new Error('โหลดตัวสร้าง Excel ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'));
    document.head.appendChild(s);
  });
}

const sheetName = (s, used) => {
  let n = String(s).replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'ชีต';
  let k = n, i = 2;
  while (used.has(k)) k = n.slice(0, 25) + ' (' + i++ + ')';
  used.add(k);
  return k;
};

/** หัวชีต: โลโก้ (ถ้ามี) + ชื่อตาราง + ชื่อโรงเรียน·ภาคเรียน · คืนเลขแถวแรกของตาราง */
function sheetHeader(ws, title, lastCol, logoId) {
  const c0 = logoId !== null ? 2 : 1;
  ws.getRow(1).height = 26; ws.getRow(2).height = 18;
  ws.mergeCells(1, c0, 1, Math.max(c0, lastCol)); ws.mergeCells(2, c0, 2, Math.max(c0, lastCol));
  Object.assign(ws.getCell(1, c0), { value: title, font: { name: FONT, size: 18, bold: true, color: { argb: argb(XL.ink) } }, alignment: { vertical: 'middle' } });
  Object.assign(ws.getCell(2, c0), { value: `${window.TT?.school?.name || ''} · ${store.doc.term.name}`, font: { name: FONT, size: 13, color: { argb: argb(XL.muted) } }, alignment: { vertical: 'top' } });
  if (logoId !== null) ws.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 54, height: 54 }, editAs: 'oneCell' });
  return 4;
}

function styleCell(cell, { fill, bold, size = 13, center = true, color } = {}) {
  cell.border = BORDER;
  cell.font = { name: FONT, size, bold: !!bold, color: { argb: argb(color || XL.ink) } };
  cell.alignment = { wrapText: true, vertical: 'middle', horizontal: center ? 'center' : 'left' };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(fill) } };
}

function pageSetup(ws, { fitHeight = 1, paper = 9 } = {}) {
  // paperSize 9 = A4, 8 = A3 · พิมพ์แนวนอนย่อให้พอดีความกว้างหน้า
  ws.pageSetup = { paperSize: paper, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: fitHeight,
    horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter = { oddFooter: '&L&8จัดด้วย ตารางบริบูรณ์&R&8หน้า &P/&N' };
}

/** ตารางรายห้อง / รายครู หนึ่งชีต ตามแนวที่เลือก */
function entitySheet(wb, used, kind, e, logoId, tint) {
  if (orientation(store.doc) === 'days') return entitySheetByDay(wb, used, kind, e, logoId, tint);
  return entitySheetByPeriod(wb, used, kind, e, logoId, tint);
}

/** วันเรียงลงล่าง: แถว = วัน คอลัมน์ = คาบ · ช่องพักเป็นคอลัมน์แคบ (รวมช่องทุกวัน ข้อความตั้ง) */
function entitySheetByDay(wb, used, kind, e, logoId, tint) {
  const d = store.doc, days = d.term.days, P = d.term.periods;
  const ws = wb.addWorksheet(sheetName(kind === 'class' ? e.name : 'ครู ' + (e.short || e.name), used));
  ws.columns = [{ width: 12 }, ...P.map((p) => ({ width: p.type === 'break' ? 6 : 17 }))];
  const top = sheetHeader(ws, (kind === 'class' ? 'ตารางเรียน ' : 'ตารางสอน ') + e.name, P.length + 1, logoId);
  const hr = ws.getRow(top);
  hr.height = 36;
  const h0 = hr.getCell(1); h0.value = 'วัน / คาบ'; styleCell(h0, { fill: XL.head, bold: true });
  P.forEach((p, pi) => {
    const c = hr.getCell(pi + 2), time = [p.start, p.end].filter(Boolean).join('–');
    if (p.type === 'break') { c.value = ''; styleCell(c, { fill: XL.brk }); return; }
    c.value = `คาบ ${p.label}${time ? '\n' + time : ''}`; styleCell(c, { fill: XL.head, bold: true, size: 12 });
  });
  for (let day = 0; day < days; day++) {
    const r = ws.getRow(top + 1 + day);
    r.height = 62;
    const a = r.getCell(1); a.value = DAY_NAMES[day]; styleCell(a, { fill: XL.head, bold: true, size: 14 });
    P.forEach((p, pi) => {
      const c = r.getCell(pi + 2);
      if (p.type === 'break') { styleCell(c, { fill: XL.brk, size: 11, color: XL.muted }); return; }
      const s = slotCell(kind, e.id, day, pi);
      c.value = s.text;
      styleCell(c, { fill: s.fill || (s.color ? tint(s.color) : null), size: s.lock ? 12 : 13, color: s.lock ? XL.muted : null });
    });
  }
  // ช่องพัก: รวมทุกวันเป็นช่องเดียว ข้อความหมุนตั้ง
  P.forEach((p, pi) => {
    if (p.type !== 'break' || days < 1) return;
    ws.mergeCells(top + 1, pi + 2, top + days, pi + 2);
    const c = ws.getRow(top + 1).getCell(pi + 2);
    c.value = p.label || 'พัก';
    c.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true };
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: top }];
  pageSetup(ws);
}

/** คาบเรียงลงล่าง: แถว = คาบ คอลัมน์ = วัน */
function entitySheetByPeriod(wb, used, kind, e, logoId, tint) {
  const d = store.doc, days = d.term.days;
  const ws = wb.addWorksheet(sheetName(kind === 'class' ? e.name : 'ครู ' + (e.short || e.name), used));
  ws.columns = [{ width: 16 }, ...Array(days).fill({ width: 24 })];
  const top = sheetHeader(ws, (kind === 'class' ? 'ตารางเรียน ' : 'ตารางสอน ') + e.name, days + 1, logoId);
  const hr = ws.getRow(top);
  hr.height = 22;
  ['คาบ / เวลา', ...DAY_NAMES.slice(0, days)].forEach((t, i) => { const c = hr.getCell(i + 1); c.value = t; styleCell(c, { fill: XL.head, bold: true }); });
  d.term.periods.forEach((p, pi) => {
    const r = ws.getRow(top + 1 + pi);
    const time = [p.start, p.end].filter(Boolean).join('–');
    if (p.type === 'break') {
      r.height = 20;
      const a = r.getCell(1); a.value = [p.label, time].filter(Boolean).join(' '); styleCell(a, { fill: XL.brk, size: 11, color: XL.muted });
      ws.mergeCells(top + 1 + pi, 2, top + 1 + pi, days + 1);
      const b = r.getCell(2); b.value = p.label || 'พัก'; styleCell(b, { fill: XL.brk, size: 11, color: XL.muted });
      for (let k = 3; k <= days + 1; k++) r.getCell(k).border = BORDER;
      return;
    }
    r.height = 48;
    const a = r.getCell(1); a.value = `คาบ ${p.label}${time ? '\n' + time : ''}`; styleCell(a, { fill: XL.head, bold: true, size: 12 });
    for (let day = 0; day < days; day++) {
      const s = slotCell(kind, e.id, day, pi), c = r.getCell(day + 2);
      c.value = s.text;
      styleCell(c, { fill: s.fill || (s.color ? tint(s.color) : null), size: s.lock ? 12 : 13, color: s.lock ? XL.muted : null });
    }
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: top }];
  pageSetup(ws);
}

/** ตารางรวมทั้งโรงเรียน: แถว = ห้อง/ครู คอลัมน์ = วัน × คาบ */
function overviewSheet(wb, used, kind, m, logoId, tint) {
  const { aoa, fills, perDay, days } = m;
  const ws = wb.addWorksheet(sheetName(kind === 'class' ? 'รวมทุกห้อง' : 'รวมครู', used));
  const nCols = aoa[0].length;
  ws.columns = [{ width: 13 }, ...Array(nCols - 1).fill({ width: 7.5 })];
  const top = sheetHeader(ws, kind === 'class' ? 'ตารางเรียนรวมทุกห้อง' : 'ตารางสอนรวมครูทุกคน', nCols, logoId);
  // แถวหัว 2 ชั้น: วัน (รวมช่อง) / คาบ
  const r1 = ws.getRow(top), r2 = ws.getRow(top + 1);
  ws.mergeCells(top, 1, top + 1, 1);
  r1.getCell(1).value = aoa[0][0];
  styleCell(r1.getCell(1), { fill: XL.head, bold: true });
  for (let k = 0; k < days; k++) {
    const c0 = 2 + k * perDay;
    ws.mergeCells(top, c0, top, c0 + perDay - 1);
    r1.getCell(c0).value = aoa[0][c0 - 1];
    for (let j = 0; j < perDay; j++) {
      styleCell(r1.getCell(c0 + j), { fill: XL.head, bold: true });
      const c = r2.getCell(c0 + j); c.value = String(aoa[1][c0 + j - 1]).replace('คาบ ', ''); styleCell(c, { fill: XL.head, size: 11, color: XL.muted });
    }
  }
  r2.getCell(1).border = BORDER;
  aoa.slice(2).forEach((row, i) => {
    const r = ws.getRow(top + 2 + i);
    r.height = 38;
    row.forEach((v, j) => {
      const c = r.getCell(j + 1); c.value = v;
      const f = fills[i][j];
      styleCell(c, { fill: j === 0 ? XL.head : f === '#FBE3E3' ? XL.clash : f && f.startsWith('#E9E6F2') ? XL.lock : f ? f.replace('#', '') : null, bold: j === 0, size: j === 0 ? 12 : 10 });
    });
  });
  // เส้นแบ่งวันหนาขึ้นให้อ่านง่าย
  const med = { style: 'medium', color: { argb: argb('7C8A99') } };
  for (let r = top; r < top + aoa.length; r++) for (let k = 0; k < days; k++) {
    const c = ws.getRow(r).getCell(2 + k * perDay); c.border = { ...c.border, left: med };
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: top + 1 }];
  pageSetup(ws, { fitHeight: 0, paper: (paper || autoPaperOf(store.doc)) === 'A3' ? 8 : 9 }); // ไม่ได้เลือกเอง = ตามที่ติ๊ก (แนะนำ) ไว้
}

async function exportXlsx(btn) {
  const d = store.doc;
  if (!d.classes.length) { notify.warn('ยังไม่มีห้องเรียน'); return; }
  let name;
  try { name = await notify.busy(btn, () => buildXlsx(d), { label: 'กำลังเตรียม' }); }
  catch (e) { notify.error('สร้าง Excel ไม่สำเร็จ: ' + e.message); console.error(e); return; }
  if (!name) return;
  flyFile(btn, 'XLSX');
  notify.ok('สร้าง Excel เสร็จ ดาวน์โหลดแล้ว: ' + name, 5000);
}

async function buildXlsx(d) {
  const [X, pdf] = await Promise.all([loadExcelJS(), pdfModule()]);
  const logo = await pdf.loadLogo();
  const wb = new X.Workbook();
  wb.creator = 'ตารางบริบูรณ์';
  const logoId = logo ? wb.addImage({ base64: logo, extension: logo.startsWith('data:image/jpeg') ? 'jpeg' : 'png' }) : null;
  const used = new Set();
  summarySheet(wb, used, d, logoId);
  for (const kind of ['class', 'teacher']) overviewSheet(wb, used, kind, pdf.overviewMatrix(kind), logoId, pdf.tint);
  for (const c of d.classes) entitySheet(wb, used, 'class', c, logoId, pdf.tint);
  for (const t of d.teachers) entitySheet(wb, used, 'teacher', t, logoId, pdf.tint);

  const buf = await wb.xlsx.writeBuffer();
  const name = `ตารางเรียน-${safeFile(window.TT?.school?.name)}-${safeFile(d.term.name)}.xlsx`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'ตาราง';

/** ชีตแรก "สรุป": ครูแต่ละคน (มอบหมาย / จัดแล้ว / คาบว่าง) และห้องเรียน (มอบหมาย / จัดแล้ว / ช่องว่าง) · ตรึงหัวตาราง */
function summarySheet(wb, used, d, logoId) {
  const ws = wb.addWorksheet(sheetName('สรุป', used));
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 18 }, { width: 16 }];
  const top = sheetHeader(ws, 'สรุปภาระสอนและตาราง', 4, logoId);
  const slots = d.term.days * d.term.periods.filter((p) => p.type !== 'break').length;
  const placedBy = (key, id) => d.placements.filter((p) => idx.asg.get(p.assignmentId)?.[key] === id).length;
  const lockN = (c) => d.locks.filter((l) => l.classId == null || l.classId === c.id).length;
  const block = (r0, head, rows) => {
    [head, ...rows].forEach((row, i) => row.forEach((v, j) => { const c = ws.getRow(r0 + i).getCell(j + 1); c.value = v; styleCell(c, { fill: i ? null : XL.head, bold: !i, center: j > 0 }); }));
    return r0 + rows.length + 2;
  };
  let r = block(top, ['ครู', 'คาบที่ได้รับมอบหมาย/สัปดาห์', 'จัดลงตารางแล้ว', 'คาบว่าง'], d.teachers.map((t) => {
    const placed = placedBy('teacherId', t.id);
    return [t.name, d.assignments.filter((a) => a.teacherId === t.id).reduce((n, a) => n + (a.perWeek || 0), 0), placed, Math.max(0, slots - placed)];
  }));
  block(r, ['ห้องเรียน', 'คาบที่มอบหมาย/สัปดาห์', 'จัดลงตารางแล้ว', 'ช่องว่าง (ไม่รวมคาบล็อก)'], d.classes.map((c) => {
    const placed = placedBy('classId', c.id);
    return [c.name, d.assignments.filter((a) => a.classId === c.id).reduce((n, a) => n + (a.perWeek || 0), 0), placed, Math.max(0, slots - placed - lockN(c))];
  }));
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: top }];
  pageSetup(ws, { fitHeight: 0 });
}

// ---------- PDF ----------
/** ดาวน์โหลด PDF: ปุ่มหมุน (กันกดซ้ำ) → เช็ก + ไอคอนไฟล์บินลงมุมล่างขวา → toast ชื่อไฟล์ */
async function exportPdf(btn, opts = { kind: btn.dataset.pdf, mode: btn.dataset.mode, perPage, paper: paper || autoPaperOf(store.doc), split }) {
  if (btn.disabled || btn.classList.contains('btn-busy')) return;
  let name;
  try {
    name = await notify.busy(btn, async () => (await pdfModule()).downloadPdf(opts), { label: 'กำลังเตรียม' });
  } catch (e) { notify.error('สร้าง PDF ไม่สำเร็จ: ' + e.message); console.error(e); return; }
  if (!name) return;
  flyFile(btn, 'PDF');
  notify.ok('สร้าง PDF เสร็จ ดาวน์โหลดแล้ว: ' + name, 5000);
}

/** URL ไฟล์ PDF ชั่วคราว (ลบทิ้งหลัง 60 วิ — เปิดดู/พิมพ์ทันพอ ไม่ค้างหน่วยความจำ) */
function tempUrl(blob) {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return url;
}

/**
 * ดูตัวอย่าง / พิมพ์ / แชร์ ชุดที่เลือก
 * - ดูตัวอย่าง: จอกว้าง = กล่องในหน้า (HTML ของเอกสารเดียวกัน ใน iframe sandbox) · มือถือ = เปิดไฟล์ PDF จริงในแท็บใหม่
 * - พิมพ์: เปิดไฟล์ PDF ในแท็บใหม่ ให้ตัวดู PDF ของเบราว์เซอร์พิมพ์ (ไม่ใช้ window.print() ของหน้าเว็บ)
 * - แชร์: Web Share พร้อมไฟล์ (LINE / Messenger / อีเมล) — แสดงปุ่มเฉพาะเครื่องที่ทำได้
 */
async function tool(what, btn, opts) {
  if (what === 'preview' && !narrow()) return previewDialog(btn, opts);
  if (what === 'share') return sharePdf(btn, opts);
  // เปิดแท็บใหม่ทันทีตอนกด (ยังอยู่ในจังหวะคลิกของผู้ใช้ ตัวกันป๊อปอัปไม่บล็อก) แล้วค่อยใส่ไฟล์เมื่อสร้างเสร็จ
  const w = window.open('', '_blank');
  try { if (w) { w.document.title = 'กำลังเตรียม PDF…'; w.document.body.textContent = 'กำลังเตรียม PDF…'; } } catch { /* แท็บใหม่บางเบราว์เซอร์แตะไม่ได้ */ }
  let out;
  try { out = await notify.busy(btn, async () => (await pdfModule()).buildPdf(opts), { label: 'กำลังเตรียม', done: 'เปิดแล้ว' }); }
  catch (e) { try { w?.close(); } catch { /* */ } notify.error('สร้าง PDF ไม่สำเร็จ: ' + e.message); console.error(e); return; }
  if (!out) { try { w?.close(); } catch { /* */ } return; }
  const url = tempUrl(out.blob);
  if (w && !w.closed) { w.location.href = url; notify.ok(what === 'print' ? 'เปิดไฟล์ในแท็บใหม่แล้ว กดพิมพ์จากตัวดู PDF ได้เลย' : 'เปิดไฟล์ในแท็บใหม่แล้ว', 4000); return; }
  notify.action('PDF พร้อมแล้ว: ' + out.name, 'เปิดไฟล์', () => { window.open(url, '_blank'); }, 15000);
}

async function sharePdf(btn, opts) {
  let out;
  try { out = await notify.busy(btn, async () => (await pdfModule()).buildPdf(opts), { label: 'กำลังเตรียม', done: 'พร้อมส่ง' }); }
  catch (e) { notify.error('สร้าง PDF ไม่สำเร็จ: ' + e.message); console.error(e); return; }
  if (!out) return;
  const file = new File([out.blob], out.name, { type: 'application/pdf' });
  const go = () => navigator.share({ files: [file], title: out.name.replace(/\.pdf$/, '') });
  try { await go(); }
  catch (e) {
    if (e?.name === 'AbortError') return; // ผู้ใช้ปิดหน้าต่างแชร์เอง
    // สร้างไฟล์นานจนจังหวะคลิกหมดอายุ → ให้กดอีกครั้งเพื่อแชร์ (ได้จังหวะคลิกใหม่)
    if (e?.name === 'NotAllowedError') { notify.action('ไฟล์พร้อมแล้ว: ' + out.name, 'แชร์', () => go().catch(() => {}), 15000); return; }
    notify.error('แชร์ไม่สำเร็จ: ' + (e?.message || e));
  }
}

/** กล่องดูตัวอย่าง: หน้าแรก ๆ ของเอกสารเดียวกับไฟล์จริง · ปุ่มเปิดไฟล์จริง/ดาวน์โหลด */
async function previewDialog(btn, opts) {
  let p;
  try { p = await notify.busy(btn, async () => (await pdfModule()).previewHtml(opts), { label: 'กำลังเตรียม', done: 'เปิดแล้ว' }); }
  catch (e) { notify.error('ดูตัวอย่างไม่สำเร็จ: ' + e.message); console.error(e); return; }
  if (!p) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg pdf-dlg';
  dlg.setAttribute('aria-label', 'ตัวอย่าง ' + p.name);
  dlg.innerHTML = `<div class="pdf-head"><h3>${esc(p.name.replace(/\.pdf$/, ''))}</h3><span class="muted" style="font-size:.86rem">ตัวอย่าง ${p.pages}${p.total > p.pages ? ` จาก ${p.total}` : ''} หน้า · หน้าตาใกล้เคียงไฟล์จริง</span></div>
    <iframe class="pdf-prev" sandbox title="ตัวอย่างไฟล์ PDF"></iframe>
    <div class="x-row"><button type="button" class="btn" data-close>ปิด</button><button type="button" class="btn" data-open>${ICON.print}เปิดไฟล์จริง / พิมพ์</button><button type="button" class="btn btn-primary" data-dl>ดาวน์โหลด PDF</button></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-open]').addEventListener('click', (e) => tool('print', e.currentTarget, opts));
  dlg.querySelector('[data-dl]').addEventListener('click', (e) => exportPdf(e.currentTarget, opts));
  dlg.showModal();
  const frame = dlg.querySelector('.pdf-prev');
  // ย่อหน้ากระดาษให้พอดีความกว้างกล่อง (zoom ภายในเอกสารตัวอย่าง)
  const k = Math.min(1, Math.max(0.3, (frame.clientWidth - 30) / p.width));
  frame.srcdoc = p.html.replace('</style>', `.page{zoom:${k.toFixed(3)}}</style>`);
}

// ---------- สำรอง / นำเข้า ----------
function backup() {
  const blob = new Blob([JSON.stringify({ app: 'timetable', v: 1, exported: new Date().toISOString(), data: store.doc }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `สำรอง-${safeFile(store.doc.term.name)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function restore(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const data = j.data || j;
    for (const k of ['term', 'classes', 'teachers', 'rooms', 'subjects', 'assignments', 'locks']) if (!data[k]) throw new Error('ไฟล์ไม่ใช่ไฟล์สำรองของระบบนี้');
    if (!(await notify.confirm({ title: 'นำเข้าไฟล์สำรอง?', icon: 'warning', ok: 'นำเข้าและแทนที่', text: `ข้อมูลภาคเรียน “${store.doc.term.name}” จะถูกแทนที่ด้วยไฟล์ “${f.name}” ทั้งหมด` }))) return;
    data.placements = data.placements || [];
    store.doc = data;
    store.commit('import');
    notify.ok('นำเข้าข้อมูลเรียบร้อย');
  } catch (err) { notify.error('นำเข้าไม่สำเร็จ: ' + err.message); }
}
