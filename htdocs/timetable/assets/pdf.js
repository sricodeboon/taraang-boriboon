// สร้างไฟล์ PDF ในเบราว์เซอร์ (pdfmake + IBM Plex Sans Thai) ดาวน์โหลดทันที ไม่ผ่านหน้าต่างพิมพ์
// - ตารางรายห้อง/รายครู: 1, 2 หรือ 4 ตารางต่อหน้า
// - ตารางรวม: ทุกห้อง (หรือทุกครู) ในหน้าเดียว แถว = ห้อง/ครู คอลัมน์ = วัน × คาบ
import { store, idx, DAY_NAMES, lockAt, assignmentLabel } from './store.js';
import { orientation } from './rules.js';

const PDFMAKE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.3.3/pdfmake.min.js';
// SRI: ถ้าไฟล์บน CDN ถูกแก้ เบราว์เซอร์จะไม่รัน (เปลี่ยนเวอร์ชันต้องเปลี่ยน hash ด้วย — ดูได้จาก cdnjs.com)
const PDFMAKE_SRI = 'sha512-EkS5jkn3vXRWIdphIy51xskMZggNip3Or8kpe/FlM5XaQeiK2GZJ9OwrIEbXl6txKWsHNtm4OXtxzkkz41Mspw==';
const FOOT = 'จัดด้วย ตารางบริบูรณ์ · sricodeboon.infinityfreeapp.com/timetable';
const INK = '#0F2438', MUTED = '#5B6B7A', LINE = '#C9D2DC', HEAD = '#EEF2F6', BRK = '#F4F5F7', LOCK = '#E9E6F2';

let loading = null;
let hasLogo = false; // ตั้งใน downloadPdf เมื่อโหลดรูปโลโก้โรงเรียนสำเร็จ (dd.images.logo)
function loadPdfMake() {
  if (window.pdfMake) return Promise.resolve(window.pdfMake);
  loading ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = PDFMAKE_URL;
    s.integrity = PDFMAKE_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      const font = (f) => new URL('assets/fonts/' + f, location.href).href;
      window.pdfMake.fonts = { Plex: { normal: font('IBMPlexSansThai-Regular.ttf'), bold: font('IBMPlexSansThai-SemiBold.ttf') } };
      ok(window.pdfMake);
    };
    s.onerror = () => { loading = null; fail(new Error('โหลดตัวสร้าง PDF ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่')); };
    document.head.appendChild(s);
  });
  return loading;
}

// ---------- ข้อมูลช่องตาราง ----------
/** ดัชนี kind:id:day:period → งานสอนที่วางอยู่ สร้างครั้งเดียวต่อการส่งออก */
function slotIndex() {
  const m = new Map();
  for (const p of store.doc.placements) {
    const a = idx.asg.get(p.assignmentId);
    if (!a) continue;
    for (const k of [`class:${a.classId}`, `teacher:${a.teacherId}`]) {
      const key = `${k}:${p.day}:${p.period}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
  }
  return m;
}

/** สีวิชาจางลงให้พิมพ์แล้วอ่านง่าย */
export function tint(hex, k = 0.8) {
  const n = parseInt(String(hex || '#7FB0E8').replace('#', ''), 16);
  if (Number.isNaN(n)) return '#FFFFFF';
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function cellFull(slots, kind, id, day, pi, fs, brief = false) {
  const as = slots.get(`${kind}:${id}:${day}:${pi}`);
  if (!as) {
    const lk = kind === 'class' ? lockAt(id, day, pi) : null;
    return lk ? { text: th(lk.label || 'กิจกรรม'), fillColor: LOCK, color: MUTED, fontSize: fs * 0.9, alignment: 'center' } : { text: '' };
  }
  const L = as.map(assignmentLabel);
  return {
    fillColor: L.length > 1 ? '#FBE3E3' : tint(L[0].color),
    stack: L.map((x) => brief ? {
      // แบบย่อ: ชื่อวิชาต่อด้วยชื่อย่อครูในย่อหน้าเดียว ประหยัดความสูงแถว
      text: [{ text: th(x.name), bold: true }, { text: ' ' + th([kind === 'class' ? (x.tch?.short || x.tch?.name) : x.cls?.name, brief === 'room' ? x.room?.name : ''].filter(Boolean).join(' · ')), color: MUTED, fontSize: fs * 0.85 }],
      fontSize: fs, lineHeight: 0.95,
    } : ({ stack: [
      { text: th((x.code && !brief ? x.code + ' ' : '') + x.name), bold: true, fontSize: fs },
      { text: th([kind === 'class' ? (x.tch?.short || x.tch?.name) : x.cls?.name, brief ? '' : x.room?.name].filter(Boolean).join(' · ')), fontSize: fs * 0.85, color: MUTED },
    ] })),
  };
}

function cellShort(slots, kind, id, day, pi, fs) {
  const as = slots.get(`${kind}:${id}:${day}:${pi}`);
  if (!as) {
    const lk = kind === 'class' ? lockAt(id, day, pi) : null;
    return lk ? { text: th(shorten(lk.label || 'กิจกรรม', 5)), fillColor: LOCK, color: MUTED, fontSize: fs * 0.8 } : { text: '' };
  }
  const L = as.map(assignmentLabel);
  const main = L.map((x) => kind === 'class' ? (x.code || shorten(x.name, 6)) : (x.cls?.name || '')).join('/');
  const sub = L.map((x) => kind === 'class' ? (x.tch?.short || shorten(x.tch?.name, 6)) : (x.code || shorten(x.name, 6))).join('/');
  return { fillColor: L.length > 1 ? '#FBE3E3' : tint(L[0].color), stack: [{ text: th(main), bold: true, fontSize: fs }, { text: th(sub), fontSize: fs * 0.85, color: MUTED }] };
}

// ภาษาไทยไม่มีช่องว่างระหว่างคำ pdfmake จึงตัดบรรทัดไม่ได้และดันตารางล้นหน้า → แทรก zero-width space ระหว่างคำ
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function th(s) {
  s = String(s ?? '');
  if (!segmenter || !/[\u0E00-\u0E7F]/.test(s)) return s;
  // ไม่ตัดบรรทัดกลางชื่อชั้น เช่น "ป.1" "ม.4/2"
  // คำยาว (เช่น "สาธารณประโยชน์") ใส่จุดตัดทุก 5 ตัวอักษร (ตามกลุ่มสระ/วรรณยุกต์) ไม่ให้ความกว้างขั้นต่ำของคำดันช่องแคบ
  // (แนววันเรียงลงล่าง 4 ตาราง/หน้า มี 8 คาบในความกว้างครึ่งหน้า) จนตารางล้นขอบกระดาษ — pdfmake ตัดที่จุดนี้เฉพาะเมื่อบรรทัดไม่พอ
  return [...segmenter.segment(s)].map((x) => breakLong(x.segment)).join('\u200B').replace(/([ปม])\u200B?\.\u200B?(?=\d)/g, '$1.').replace(/(\d)\u200B?\/\u200B?(?=\d)/g, '$1/');
}
const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
function breakLong(w) {
  if (!graphemes || w.length <= 8 || !/[\u0E00-\u0E7F]/.test(w)) return w;
  const g = [...graphemes.segment(w)].map((x) => x.segment);
  if (g.length <= 7) return w;
  let out = '';
  g.forEach((c, i) => { out += (i && i % 5 === 0 ? '\u200B' : '') + c; });
  return out;
}
const shorten = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const timeOf = (p) => [p.start, p.end].filter(Boolean).join('–');
const hoursOf = (kind, id) => store.doc.placements.filter((p) => idx.asg.get(p.assignmentId)?.[kind === 'class' ? 'classId' : 'teacherId'] === id).length;

const gridLayout = {
  hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LINE, vLineColor: () => LINE,
  paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
};

// ---------- ตารางรายห้อง / รายครู ----------
/** ตารางตามแนวที่โรงเรียนเลือก: วันเรียงลงล่าง (ค่าเริ่มต้น) หรือ คาบเรียงลงล่าง */
function oneTable(kind, e, slots, opts) {
  return wrapTable(kind, e, opts, orientation(store.doc) === 'days' ? bodyByDay(kind, e, slots, opts) : bodyByPeriod(kind, e, slots, opts));
}

/** วันเรียงลงล่าง: แถว = วัน คอลัมน์ = คาบ · ช่องพักเป็นคอลัมน์แคบรวมทุกแถว */
function bodyByDay(kind, e, slots, { fs, rowH, width, brief }) {
  const d = store.doc, days = d.term.days, P = d.term.periods;
  const brkW = fs * 3.1;
  const body = [[
    { text: 'วัน', bold: true, fontSize: fs, fillColor: HEAD, margin: [0, fs * 0.4, 0, 0] },
    ...P.map((p) => (p.type === 'break' ? { text: '', fillColor: BRK }
      : { stack: [{ text: 'คาบ ' + p.label, bold: true, fontSize: fs }, { text: timeOf(p), fontSize: fs * 0.72, color: MUTED }], fillColor: HEAD, alignment: 'center' })),
  ]];
  const heights = [fs * 2.9];
  for (let day = 0; day < days; day++) {
    body.push([
      { text: DAY_NAMES[day], bold: true, fontSize: fs * 1.05, fillColor: HEAD },
      ...P.map((p, pi) => (p.type === 'break'
        ? (day === 0 ? { text: th(p.label || 'พัก'), rowSpan: days, fillColor: BRK, color: MUTED, fontSize: fs * 0.72, alignment: 'center' } : {})
        : cellFull(slots, kind, e.id, day, pi, fs, brief))),
    ]);
    heights.push(rowH);
  }
  const firstW = Math.max(fs * 5.6, width * 0.1);
  return { widths: [firstW, ...P.map((p) => (p.type === 'break' ? brkW : '*'))], heights, body };
}

/** คาบเรียงลงล่าง: แถว = คาบ คอลัมน์ = วัน · ช่องพักเป็นแถวเต็ม */
function bodyByPeriod(kind, e, slots, { fs, rowH, width, brief }) {
  const d = store.doc, days = d.term.days;
  const body = [[
    { text: 'คาบ', bold: true, fontSize: fs, fillColor: HEAD },
    ...DAY_NAMES.slice(0, days).map((n) => ({ text: n, bold: true, fontSize: fs, fillColor: HEAD, alignment: 'center' })),
  ]];
  const heights = [fs * 1.9];
  d.term.periods.forEach((p, pi) => {
    if (p.type === 'break') {
      body.push([{ text: [p.label, timeOf(p)].filter(Boolean).join(' '), fontSize: fs * 0.8, color: MUTED, fillColor: BRK },
        { text: p.label || 'พัก', colSpan: days, alignment: 'center', fontSize: fs * 0.8, color: MUTED, fillColor: BRK }, ...Array(days - 1).fill({})]);
      heights.push(fs * 1.7);
      return;
    }
    body.push([
      { stack: [{ text: 'คาบ ' + p.label, bold: true, fontSize: fs }, { text: timeOf(p), fontSize: fs * 0.75, color: MUTED }], fillColor: HEAD },
      ...[...Array(days).keys()].map((day) => cellFull(slots, kind, e.id, day, pi, fs, brief)),
    ]);
    heights.push(rowH);
  });
  return { widths: [Math.max(fs * 5.2, width * 0.12), ...Array(days).fill('*')], heights, body };
}

function wrapTable(kind, e, { fs }, { widths, heights, body }) {
  const d = store.doc;
  const title = (kind === 'class' ? 'ตารางเรียน ' : 'ตารางสอน ') + e.name;
  const hrs = kind === 'teacher' ? `สอน ${hoursOf('teacher', e.id)} คาบ/สัปดาห์` : `${hoursOf('class', e.id)} คาบ/สัปดาห์`;
  const heading = { stack: [
    { text: title, bold: true, fontSize: fs * 1.55, color: INK },
    { text: `${window.TT?.school?.name || ''} · ${d.term.name}`, fontSize: fs * 0.9, color: MUTED },
  ] };
  // โลโก้สูงเท่าหัวเรื่อง 2 บรรทัด ไม่กินความสูงเพิ่ม (rowH คำนวณเผื่อหัวเรื่องไว้ fs*5 แล้ว)
  const logo = hasLogo ? [{ image: 'logo', fit: [fs * 3.4, fs * 3.4], width: fs * 3.4 }] : [];
  return { stack: [
    { columns: [...logo, { ...heading, width: '*' }, { text: hrs, width: 'auto', fontSize: fs * 0.9, color: MUTED, alignment: 'right', margin: [0, fs * 0.6, 0, 0] }], columnGap: fs * 0.7, margin: [0, 0, 0, fs * 0.4] },
    { table: { headerRows: 1, dontBreakRows: true, widths, heights, body }, layout: gridLayout },
  ] };
}

/** perPage: 1 = A4 แนวนอน, 2 = A4 แนวตั้ง 2 ตารางบนล่าง, 4 = A4 แนวนอน 2×2 */
function docPerEntity(kind, perPage) {
  const d = store.doc;
  const list = kind === 'class' ? d.classes : d.teachers;
  const slots = slotIndex();
  const teach = d.term.periods.filter((p) => p.type !== 'break').length || 1;
  const brk = d.term.periods.length - teach;
  const M = 24;
  const cfg = {
    1: { orient: 'landscape', w: 842 - 2 * M, h: 595 - 2 * M - 14, fs: 9 },
    2: { orient: 'portrait', w: 595 - 2 * M, h: (842 - 2 * M - 14 - 18) / 2, fs: 7.5 },
    4: { orient: 'landscape', w: (842 - 2 * M - 14) / 2, h: (595 - 2 * M - 14 - 14) / 2, fs: 5.6 },
  }[perPage];
  // ความสูงที่เหลือหลังหัวเรื่อง/หัวตาราง/แถวพัก แบ่งให้แถว (คาบ หรือ วัน) เท่า ๆ กัน
  // heights ของ pdfmake ไม่รวม padding บน-ล่าง (4pt) และข้อความยาวจะดันแถวสูงขึ้น จึงเผื่อไว้ 15%
  const byDay = orientation(d) === 'days';
  const free = byDay ? cfg.h - cfg.fs * 5 - (cfg.fs * 2.9 + 4) : cfg.h - cfg.fs * 5 - (cfg.fs * 1.9 + 4) - brk * (cfg.fs * 1.7 + 4);
  const rowH = Math.max(cfg.fs * 2.6, (free / (byDay ? d.term.days : teach)) * 0.85 - 4);
  const opts = { fs: cfg.fs, rowH, width: cfg.w, brief: { 1: false, 2: 'room', 4: true }[perPage] };
  const content = [];
  for (let i = 0; i < list.length; i += perPage) {
    const group = list.slice(i, i + perPage).map((e) => oneTable(kind, e, slots, opts));
    const brkBefore = i ? 'before' : undefined;
    // unbreakable: ถ้าตารางไม่พอดีหน้าให้ย้ายทั้งตาราง ไม่ตัดครึ่ง
    if (perPage === 1) content.push({ ...group[0], pageBreak: brkBefore });
    else if (perPage === 2) content.push({ stack: group.map((g, k) => ({ ...g, unbreakable: true, margin: [0, k ? 18 : 0, 0, 0] })), pageBreak: brkBefore });
    else {
      const rows = [group.slice(0, 2), group.slice(2, 4)].filter((r) => r.length);
      content.push({ stack: rows.map((r, k) => ({ columns: [r[0], r[1] || { text: '' }], columnGap: 14, unbreakable: true, margin: [0, k ? 14 : 0, 0, 0] })), pageBreak: brkBefore });
    }
  }
  return { pageSize: 'A4', pageOrientation: cfg.orient, pageMargins: [M, M, M, M + 10], content };
}

// ---------- ตารางรวมทั้งโรงเรียน ----------
function docOverview(kind, paper) {
  const d = store.doc, days = d.term.days;
  const list = kind === 'class' ? d.classes : d.teachers;
  const slots = slotIndex();
  const periods = d.term.periods.map((p, pi) => ({ p, pi })).filter(({ p }) => p.type !== 'break');
  const M = 18;
  const pageW = paper === 'A3' ? 1191 : 842;
  const nCols = days * periods.length;
  const firstW = paper === 'A3' ? 70 : 52;
  const colW = (pageW - 2 * M - firstW) / nCols;
  // รหัสวิชา/ชื่อห้องตัดบรรทัดไม่ได้ → ขนาดตัวอักษรต้องให้คำที่ยาวที่สุดพอดีช่อง (ตัวเลข/อักษร Plex กว้าง ~0.6 em)
  const longest = Math.max(4, ...(kind === 'class' ? d.subjects.map((x) => (x.code || '').length) : d.classes.map((x) => x.name.length)));
  const fs = Math.max(3.6, Math.min(9, (colW - 2.5) / (longest * 0.62)));
  // ขยายแถวให้เต็มหน้าที่เหลือ (เผื่อหัวเรื่อง คำอธิบาย และ padding) ไม่เกิน 40pt
  const pageH = paper === 'A3' ? 842 : 595;
  const rowH = Math.min(40, Math.max(fs * 2.4, ((pageH - 2 * M - 10 - 48 - fs * 4) / Math.max(1, list.length)) * 0.9 - 3));
  const dayEdge = (col) => col > 0 && (col - 1) % periods.length === 0;

  const head1 = [{ text: kind === 'class' ? 'ห้อง' : 'ครู', rowSpan: 2, bold: true, fontSize: fs * 1.1, fillColor: HEAD, margin: [0, fs * 0.5, 0, 0] }];
  const head2 = [{}];
  for (let day = 0; day < days; day++) {
    head1.push({ text: DAY_NAMES[day], colSpan: periods.length, bold: true, alignment: 'center', fontSize: fs * 1.1, fillColor: HEAD }, ...Array(periods.length - 1).fill({}));
    for (const { p } of periods) head2.push({ text: p.label, alignment: 'center', fontSize: fs * 0.9, color: MUTED, fillColor: HEAD });
  }
  const body = [head1, head2];
  for (const e of list) {
    const row = [{ text: kind === 'class' ? e.name : (e.short || e.name), bold: true, fontSize: fs * 1.05, fillColor: HEAD }];
    for (let day = 0; day < days; day++) for (const { pi } of periods) row.push({ ...cellShort(slots, kind, e.id, day, pi, fs), alignment: 'center' });
    body.push(row);
  }
  const title = kind === 'class' ? 'ตารางเรียนรวมทุกห้อง' : 'ตารางสอนรวมครูทุกคน';
  return {
    pageSize: paper, pageOrientation: 'landscape', pageMargins: [M, M, M, M + 10],
    content: [
      { columns: [
        ...(hasLogo ? [{ image: 'logo', fit: [24, 24], width: 24, margin: [0, -3, 0, 0] }] : []),
        { text: title, bold: true, fontSize: 14, color: INK, width: '*' },
        { text: `${window.TT?.school?.name || ''} · ${d.term.name}`, fontSize: 9, color: MUTED, alignment: 'right', width: 'auto', margin: [0, 4, 0, 0] },
      ], columnGap: 8 },
      { margin: [0, 6, 0, 0], table: { headerRows: 2, dontBreakRows: true, widths: [firstW, ...Array(nCols).fill('*')], heights: (r) => (r < 2 ? undefined : rowH), body }, layout: {
        ...gridLayout, paddingLeft: () => 0.8, paddingRight: () => 0.8, paddingTop: () => 1.5, paddingBottom: () => 1.5,
        vLineWidth: (i) => (dayEdge(i) ? 1.2 : 0.4), vLineColor: (i) => (dayEdge(i) ? '#7C8A99' : LINE),
      } },
      { text: kind === 'class' ? 'ในช่อง: บรรทัดบน = รหัสวิชา · บรรทัดล่าง = ชื่อย่อครู · ช่องสีม่วงอ่อน = คาบล็อก · ช่องสีแดง = คาบชน'
        : 'ในช่อง: บรรทัดบน = ห้องเรียน · บรรทัดล่าง = รหัสวิชา · ช่องสีแดง = คาบชน', fontSize: 7, color: MUTED, margin: [0, 4, 0, 0] },
    ],
  };
}

// ---------- ส่วนที่เรียกจากแท็บส่งออก ----------
const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'ตาราง';

/**
 * mode: 'each' (รายห้อง/รายครู) หรือ 'overview' (ตารางรวม)
 * perPage: 1|2|4 สำหรับ each · paper: 'A4'|'A3' สำหรับ overview
 */
export async function downloadPdf({ kind, mode, perPage = 1, paper = 'A4' }) {
  const d = store.doc;
  const list = kind === 'class' ? d.classes : d.teachers;
  if (!list.length) throw new Error(kind === 'class' ? 'ยังไม่มีห้องเรียน' : 'ยังไม่มีครู');
  const [pm, logo] = await Promise.all([loadPdfMake(), loadLogo()]);
  hasLogo = !!logo;
  const dd = mode === 'overview' ? docOverview(kind, paper) : docPerEntity(kind, perPage);
  if (logo) dd.images = { logo };
  dd.defaultStyle = { font: 'Plex', fontSize: 9, color: INK, lineHeight: 1.05 };
  dd.info = { title: `${window.TT?.school?.name || ''} ${d.term.name}`, creator: 'ตารางบริบูรณ์' };
  dd.footer = (page, pages) => ({ columns: [
    { text: FOOT, fontSize: 7, color: MUTED }, { text: `หน้า ${page}/${pages}`, fontSize: 7, color: MUTED, alignment: 'right' },
  ], margin: [dd.pageMargins[0], 4, dd.pageMargins[2], 0] });
  const what = mode === 'overview' ? (kind === 'class' ? 'ตารางรวมทุกห้อง' : 'ตารางรวมครู') : (kind === 'class' ? 'ตารางเรียน' : 'ตารางสอน');
  const suffix = mode === 'overview' ? paper : `${perPage}ต่อหน้า`;
  const name = `${what}-${safeFile(window.TT?.school?.name)}-${safeFile(d.term.name)}-${suffix}.pdf`;
  const blob = await pm.createPdf(dd).getBlob();
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

/** โลโก้โรงเรียนเป็น data URL (pdfmake รับเฉพาะ PNG/JPEG) · ไม่มีหรือโหลดไม่ได้ → null แล้ว PDF ออกได้ตามปกติ */
export async function loadLogo() {
  const rev = window.TT?.school?.logoRev;
  if (!rev) return null;
  try {
    const res = await fetch('logo.php?v=' + rev, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

/** ตารางรวมเป็นอาร์เรย์ 2 มิติ สำหรับชีต Excel */
export function overviewMatrix(kind) {
  const d = store.doc, days = d.term.days;
  const list = kind === 'class' ? d.classes : d.teachers;
  const slots = slotIndex();
  const periods = d.term.periods.map((p, pi) => ({ p, pi })).filter(({ p }) => p.type !== 'break');
  const h1 = [kind === 'class' ? 'ห้อง' : 'ครู'], h2 = [''];
  for (let day = 0; day < days; day++) periods.forEach(({ p }, k) => { h1.push(k ? '' : DAY_NAMES[day]); h2.push('คาบ ' + p.label); });
  const fills = [];
  const rows = list.map((e) => {
    const r = [kind === 'class' ? e.name : (e.short || e.name)], f = [null];
    for (let day = 0; day < days; day++) for (const { pi } of periods) {
      const c = cellShort(slots, kind, e.id, day, pi, 1);
      r.push((c.stack ? c.stack.map((x) => x.text).filter(Boolean).join('\n') : c.text).replace(/\u200B/g, ''));
      f.push(c.fillColor || null);
    }
    fills.push(f);
    return r;
  });
  return { aoa: [h1, h2, ...rows], fills, perDay: periods.length, days };
}
