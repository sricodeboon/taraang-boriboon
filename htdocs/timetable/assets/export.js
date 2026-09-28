// แท็บส่งออก: Excel (SheetJS), PDF (สร้างไฟล์ในเบราว์เซอร์ด้วย pdfmake ดู pdf.js), สำรอง/นำเข้า JSON
import { store, idx, DAY_NAMES, lockAt, esc, assignmentLabel } from './store.js';
import { toast } from './ui.js';
// pdf.js โหลดเมื่อกดส่งออกครั้งแรกเท่านั้น
const pdfModule = () => import('./pdf.js');

let root = null;
let perPage = 1, paper = 'A4';

export function render(el) {
  root = el;
  const d = store.doc;
  el.innerHTML = `<div class="export-grid">
    <div class="card">
      <h3 style="font-size:1.05rem">Excel (.xlsx)</h3>
      <p class="muted" style="margin:0">ชีตตารางรวมทั้งโรงเรียน ชีตรายห้อง ชีตรายครู และสรุปภาระสอน มีเส้นตาราง สีวิชา และโลโก้ พร้อมพิมพ์ A4 แนวนอน</p>
      <button class="btn btn-primary" id="x-xlsx">ดาวน์โหลด Excel</button>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">PDF รายห้อง / รายครู</h3>
      <p class="muted" style="margin:0">ดาวน์โหลดเป็นไฟล์ .pdf ทันที เลือกย่อหลายตารางต่อหน้าเพื่อประหยัดกระดาษได้</p>
      <div class="seg-row" role="radiogroup" aria-label="จำนวนตารางต่อหน้า">
        ${[[1, '1 ตาราง/หน้า'], [2, '2 ตาราง/หน้า'], [4, '4 ตาราง/หน้า']].map(([n, t]) => `<label><input type="radio" name="per" value="${n}" ${n === perPage ? 'checked' : ''}> ${t}</label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-pdf="class" data-mode="each">ตารางเรียนทุกห้อง (${d.classes.length})</button>
        <button class="btn" data-pdf="teacher" data-mode="each">ตารางสอนครูทุกคน (${d.teachers.length})</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">ตารางรวมทั้งโรงเรียน (หน้าเดียว)</h3>
      <p class="muted" style="margin:0">ทุกห้องหรือทุกครูในแผ่นเดียว แต่ละช่องแสดงรหัสวิชากับชื่อย่อครู เหมาะติดบอร์ดห้องวิชาการ</p>
      <div class="seg-row" role="radiogroup" aria-label="ขนาดกระดาษ">
        ${['A4', 'A3'].map((x) => `<label><input type="radio" name="paper" value="${x}" ${x === paper ? 'checked' : ''}> ${x} แนวนอน</label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-pdf="class" data-mode="overview">รวมทุกห้อง</button>
        <button class="btn" data-pdf="teacher" data-mode="overview">รวมครูทุกคน</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem">สำรองข้อมูล</h3>
      <p class="muted" style="margin:0">เก็บไฟล์ .json ไว้ในเครื่อง นำกลับมาใช้ภายหลังหรือย้ายไปภาคเรียนอื่นได้</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="b-save">ดาวน์โหลดไฟล์สำรอง</button>
        <label class="btn">นำเข้าไฟล์สำรอง<input type="file" id="b-load" accept=".json,application/json" hidden></label>
      </div>
    </div>
  </div>`;
  el.querySelector('#x-xlsx').addEventListener('click', exportXlsx);
  el.querySelectorAll('input[name=per]').forEach((r) => r.addEventListener('change', () => { perPage = +r.value; }));
  el.querySelectorAll('input[name=paper]').forEach((r) => r.addEventListener('change', () => { paper = r.value; }));
  el.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => exportPdf(b)));
  el.querySelector('#b-save').addEventListener('click', backup);
  el.querySelector('#b-load').addEventListener('change', restore);
}

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

/** ตารางรายห้อง / รายครู หนึ่งชีต */
function entitySheet(wb, used, kind, e, logoId, tint) {
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
  pageSetup(ws, { fitHeight: 0, paper: paper === 'A3' ? 8 : 9 });
}

async function exportXlsx() {
  const d = store.doc;
  if (!d.classes.length) { toast('ยังไม่มีห้องเรียน'); return; }
  toast('กำลังสร้างไฟล์ Excel…', 8000);
  let X, pdf, logo;
  try { [X, pdf] = await Promise.all([loadExcelJS(), pdfModule()]); logo = await pdf.loadLogo(); } catch (e) { toast(e.message); return; }
  const wb = new X.Workbook();
  wb.creator = 'ตารางบริบูรณ์';
  const logoId = logo ? wb.addImage({ base64: logo, extension: logo.startsWith('data:image/jpeg') ? 'jpeg' : 'png' }) : null;
  const used = new Set();
  for (const kind of ['class', 'teacher']) overviewSheet(wb, used, kind, pdf.overviewMatrix(kind), logoId, pdf.tint);
  for (const c of d.classes) entitySheet(wb, used, 'class', c, logoId, pdf.tint);
  for (const t of d.teachers) entitySheet(wb, used, 'teacher', t, logoId, pdf.tint);

  const ws = wb.addWorksheet(sheetName('สรุปภาระสอน', used));
  ws.columns = [{ width: 32 }, { width: 26 }, { width: 18 }];
  const top = sheetHeader(ws, 'สรุปภาระสอน', 3, logoId);
  const rows = [['ครู', 'คาบที่ได้รับมอบหมาย/สัปดาห์', 'จัดลงตารางแล้ว'], ...d.teachers.map((t) => [
    t.name,
    d.assignments.filter((a) => a.teacherId === t.id).reduce((n, a) => n + (a.perWeek || 0), 0),
    d.placements.filter((p) => idx.asg.get(p.assignmentId)?.teacherId === t.id).length,
  ])];
  rows.forEach((row, i) => row.forEach((v, j) => { const c = ws.getRow(top + i).getCell(j + 1); c.value = v; styleCell(c, { fill: i ? null : XL.head, bold: !i, center: j > 0 }); }));
  pageSetup(ws, { fitHeight: 0 });

  const buf = await wb.xlsx.writeBuffer();
  const name = `ตารางเรียน-${safeFile(window.TT?.school?.name)}-${safeFile(d.term.name)}.xlsx`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('ดาวน์โหลดแล้ว: ' + name);
}

const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'ตาราง';

// ---------- PDF ----------
async function exportPdf(btn) {
  if (btn.disabled) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'กำลังสร้าง PDF…';
  try {
    const name = await (await pdfModule()).downloadPdf({ kind: btn.dataset.pdf, mode: btn.dataset.mode, perPage, paper });
    toast('ดาวน์โหลดแล้ว: ' + name);
  } catch (e) { toast('สร้าง PDF ไม่สำเร็จ: ' + e.message); console.error(e); }
  finally { btn.disabled = false; btn.textContent = old; }
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
    if (!confirm('นำเข้าแล้วข้อมูลภาคเรียนนี้จะถูกแทนที่ทั้งหมด ยืนยันไหม')) return;
    data.placements = data.placements || [];
    store.doc = data;
    store.commit('import');
    toast('นำเข้าข้อมูลเรียบร้อย');
  } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + err.message); }
}
