// สร้างไฟล์ PDF ในเบราว์เซอร์ (pdfmake + IBM Plex Sans Thai) ดาวน์โหลดทันที ไม่ผ่านหน้าต่างพิมพ์
// - ตารางรายห้อง/รายครู: 1, 2 หรือ 4 ตารางต่อหน้า
// - ตารางรวม: ทุกห้อง (หรือทุกครู) ในหน้าเดียว แถว = ห้อง/ครู คอลัมน์ = วัน × คาบ
import { store, idx, DAY_NAMES, lockAt, assignmentLabel, teacherUnavailable } from './store.js';
import { orientation, subjectGroupOf, SUBJECT_GROUP_NAMES } from './rules.js';

const PDFMAKE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.3.3/pdfmake.min.js';
// SRI: ถ้าไฟล์บน CDN ถูกแก้ เบราว์เซอร์จะไม่รัน (เปลี่ยนเวอร์ชันต้องเปลี่ยน hash ด้วย — ดูได้จาก cdnjs.com)
const PDFMAKE_SRI = 'sha512-EkS5jkn3vXRWIdphIy51xskMZggNip3Or8kpe/FlM5XaQeiK2GZJ9OwrIEbXl6txKWsHNtm4OXtxzkkz41Mspw==';
const FOOT = 'จัดด้วย ตารางบริบูรณ์ · sricodeboon.infinityfreeapp.com/timetable';
const INK = '#0F2438', MUTED = '#5B6B7A', LINE = '#C9D2DC', HEAD = '#EEF2F6', BRK = '#F4F5F7', LOCK = '#E9E6F2', OFF = '#E4E8ED';
// ลายในช่อง (pdfmake patterns) — สื่อด้วยลาย ไม่ใช่สีอย่างเดียว · ไม่มีสีเขียว
// lock = คาบล็อก (เส้นเฉียงม่วงอ่อน) · off = ครูไม่ว่าง (เส้นเฉียงเทา) · brk = พัก (จุดเทา)
const PATTERNS = {
  lock: { boundingBox: [1, 1, 5, 5], xStep: 4, yStep: 4, pattern: '0.5 w 0 5 m 5 0 l s' },
  off: { boundingBox: [1, 1, 4, 4], xStep: 3, yStep: 3, pattern: '0.6 w 0 4 m 4 0 l s' },
  brk: { boundingBox: [0, 0, 4, 4], xStep: 4, yStep: 4, pattern: '0.8 w 1 1 m 1.4 1 l s' },
};
const FILL = { lock: ['lock', '#B9AED6'], off: ['off', '#A9B4C0'], brk: ['brk', '#C3CAD2'] };
const printedOn = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

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

/** ช่องว่างที่มีความหมาย: คาบล็อก (ตารางห้อง) / ครูไม่ว่าง (ตารางครู) — พื้นอ่อน + ลายเฉียง + ข้อความ (ไม่สื่อด้วยสีอย่างเดียว) */
function emptyCell(kind, id, day, pi, fs, short = false) {
  if (kind === 'class') {
    const lk = lockAt(id, day, pi);
    if (lk) return { text: th(short ? shorten(lk.label || 'กิจกรรม', 5) : (lk.label || 'กิจกรรม')), fillColor: LOCK, overlayPattern: FILL.lock, overlayOpacity: 0.55, color: MUTED, fontSize: fs * (short ? 0.8 : 0.9), alignment: 'center' };
  } else if (teacherUnavailable(id, day, pi)) {
    return { text: short ? '' : 'ไม่ว่าง', fillColor: OFF, overlayPattern: FILL.off, overlayOpacity: 0.6, color: MUTED, fontSize: fs * 0.8, alignment: 'center' };
  }
  return { text: '' };
}

function cellFull(slots, kind, id, day, pi, fs, brief = false) {
  const as = slots.get(`${kind}:${id}:${day}:${pi}`);
  if (!as) return emptyCell(kind, id, day, pi, fs);
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

/** ตารางรวม: บรรทัดบน = ชื่อย่อวิชา (ห้อง) / ห้อง (ครู) · บรรทัดล่าง = ชื่อย่อครู / ชื่อย่อวิชา — ไม่ใช้รหัสวิชา (ครูอ่านชื่อเข้าใจกว่า) */
function cellShort(slots, kind, id, day, pi, fs) {
  const as = slots.get(`${kind}:${id}:${day}:${pi}`);
  if (!as) return emptyCell(kind, id, day, pi, fs, true);
  const L = as.map(assignmentLabel);
  const main = L.map((x) => kind === 'class' ? shortName(x.subj, x.name) : (x.cls?.name || '')).join('/');
  const sub = L.map((x) => kind === 'class' ? (x.tch?.short || shorten(x.tch?.name, 6)) : shortName(x.subj, x.name)).join('/');
  return { fillColor: L.length > 1 ? '#FBE3E3' : tint(L[0].color), stack: [{ text: th(main), bold: true, fontSize: fs }, { text: th(sub), fontSize: fs * 0.85, color: MUTED }] };
}

// ชื่อย่อวิชา 3–6 ตัวอักษร: subject.short ถ้ามี · คำที่โรงเรียนใช้กันทั่วไป · ไม่งั้นคำแรกของชื่อ (ตัดตามกลุ่มสระ/วรรณยุกต์ ไม่ตัดกลางตัวอักษร)
const SHORT_WORDS = [
  [/สุขศึกษา.*พลศึกษา/, 'สุข-พละ'], [/พลศึกษา|พละ/, 'พละ'], [/สุขศึกษา/, 'สุขศึกษา'], [/คณิต/, 'คณิต'], [/วิทยาการคำนวณ/, 'คำนวณ'],
  [/วิทยาศาสตร์|^วิทย์/, 'วิทย์'], [/ประวัติ/, 'ประวัติ'], [/หน้าที่พลเมือง/, 'หน้าที่ฯ'], [/กิจกรรมเพื่อสังคม|สาธารณประโยชน์/, 'กิจสังคม'],
  [/สังคม(?!และ)/, 'สังคม'], [/การงาน/, 'การงาน'], [/การออกแบบ/, 'ออกแบบ'], [/คอมพิวเตอร์/, 'คอมพ์'], [/ดนตรี.*นาฏ/, 'ดนตรี-นาฏ'], [/นาฏ/, 'นาฏศิลป์'],
  [/ลูกเสือ|เนตรนารี/, 'ลูกเสือ'], [/ภาษาอังกฤษ|^อังกฤษ/, 'อังกฤษ'], [/ภาษาไทย/, 'ไทย'], [/ภาษา(.{2,})/, '$1'],
];
const wordSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
export function shortName(subj, fallback = '') {
  if (subj?.short) return String(subj.short).trim();
  const n = String(subj?.name || fallback || '').replace(/\s*\d+(\s*\/\s*\d+)?\s*$/, '').trim();
  for (const [re, out] of SHORT_WORDS) { const m = re.exec(n); if (m) return out.replace('$1', m[1] || ''); }
  const w = wordSeg ? ([...wordSeg.segment(n)].find((x) => x.isWordLike)?.segment || n) : n;
  const g = graphemes ? [...graphemes.segment(w)].map((x) => x.segment) : [...w];
  return g.length > 6 ? g.slice(0, 5).join('') : w;
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
        ? (day === 0 ? { text: th(p.label || 'พัก'), rowSpan: days, fillColor: BRK, overlayPattern: FILL.brk, overlayOpacity: 0.5, color: MUTED, fontSize: fs * 0.72, alignment: 'center' } : {})
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
        { text: p.label || 'พัก', colSpan: days, alignment: 'center', fontSize: fs * 0.8, color: MUTED, fillColor: BRK, overlayPattern: FILL.brk, overlayOpacity: 0.5 }, ...Array(days - 1).fill({})]);
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

const termText = (name) => (/ภาคเรียน/.test(name || '') ? String(name) : `ภาคเรียน ${name || ''}`.trim());
const homeroomOf = (classId) => store.doc.teachers.filter((t) => t.homeroom === classId).map((t) => t.name);

/** หัวกระดาษ: โลโก้ + ชื่อโรงเรียนตัวใหญ่ + "ตารางเรียน ป.1 · ภาคเรียน … · ครูประจำชั้น: …" · ครู: "สอน N คาบ · ว่าง N คาบ · ประจำชั้น …" */
function wrapTable(kind, e, { fs, width }, { widths, heights, body }) {
  const d = store.doc;
  const teach = d.term.periods.filter((p) => p.type !== 'break').length;
  const hrs = hoursOf(kind, e.id);
  const parts = [(kind === 'class' ? 'ตารางเรียน ' : 'ตารางสอน ') + e.name, termText(d.term.name)];
  if (kind === 'class') { const hr = homeroomOf(e.id); if (hr.length) parts.push('ครูประจำชั้น: ' + hr.join(', ')); }
  const sub = [];
  if (kind === 'teacher') {
    const home = e.homeroom ? idx.cls.get(e.homeroom)?.name : '';
    sub.push(`สอน ${hrs} คาบ`, `ว่าง ${Math.max(0, d.term.days * teach - hrs)} คาบ`);
    if (home) sub.push('ประจำชั้น ' + home);
  }
  const heading = { stack: [
    { text: th(window.TT?.school?.name || 'ตารางเรียน'), bold: true, fontSize: fs * 1.6, color: INK },
    { text: th(parts.join(' · ')), bold: true, fontSize: fs * 1.1, color: INK, margin: [0, 1, 0, 0] },
    ...(sub.length ? [{ text: th(sub.join(' · ')), fontSize: fs * 0.95, color: MUTED }] : []),
  ] };
  // โลโก้สูงเท่าหัวเรื่อง ไม่กินความสูงเพิ่ม (rowH คำนวณเผื่อหัวกระดาษ + คำอธิบายสีไว้แล้ว)
  const logo = hasLogo ? [{ image: 'logo', fit: [fs * 4, fs * 4], width: fs * 4 }] : [];
  return { stack: [
    { columns: [...logo, { ...heading, width: '*' }, { text: `${hrs} คาบ/สัปดาห์`, width: 'auto', fontSize: fs * 0.9, color: MUTED, alignment: 'right', margin: [0, fs * 0.6, 0, 0] }], columnGap: fs * 0.7, margin: [0, 0, 0, fs * 0.4] },
    { table: { headerRows: 1, dontBreakRows: true, widths, heights, body }, layout: gridLayout },
    legend(kind, e, fs, width),
  ] };
}

/** คำอธิบายสีท้ายตาราง: กลุ่มสาระที่มีในตารางนี้ (สีวิชาจริง) + คาบล็อก / ครูไม่ว่าง / คาบชน */
function legend(kind, e, fs, width = 790) {
  const d = store.doc;
  const groups = new Map(), seen = new Set();
  let clash = false;
  for (const p of d.placements) {
    const a = idx.asg.get(p.assignmentId);
    if (!a || (kind === 'class' ? a.classId : a.teacherId) !== e.id) continue;
    const k = `${p.day}:${p.period}`;
    if (seen.has(k)) clash = true; else seen.add(k);
    const subj = idx.subj.get(a.subjectId);
    const g = subjectGroupOf(subj) || 'ETC';
    if (!groups.has(g)) groups.set(g, subj?.color || '#7FB0E8');
  }
  const order = ['TH', 'MA', 'SC', 'SO', 'HE', 'AR', 'OC', 'FL', 'EC', 'GU', 'ETC'];
  const name = (g) => (g === 'ETC' ? 'กิจกรรม/อื่น ๆ' : SUBJECT_GROUP_NAMES[g] || g).replace('วิทยาศาสตร์และเทคโนโลยี', 'วิทยาศาสตร์ฯ').replace('สุขศึกษาและพลศึกษา', 'สุขศึกษา-พลศึกษา');
  const items = [...groups].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([g, c]) => [{ text: '', fillColor: tint(c) }, name(g)]);
  if (kind === 'class' && d.locks.some((l) => l.classId == null || l.classId === e.id)) items.push([{ text: '', fillColor: LOCK, overlayPattern: FILL.lock, overlayOpacity: 0.55 }, 'คาบล็อก']);
  if (kind === 'teacher' && (e.unavailable || []).length) items.push([{ text: '', fillColor: OFF, overlayPattern: FILL.off, overlayOpacity: 0.6 }, 'ครูไม่ว่าง']);
  if (clash) items.push([{ text: '', fillColor: '#FBE3E3' }, 'คาบชน']);
  if (!items.length) return { text: '' };
  const sw = fs * 1.1;
  // แบ่งเป็นแถวตามความกว้างตาราง (4 ตาราง/หน้า แคบ) · ป้ายไม่ตัดบรรทัด
  const est = (t) => sw + 8 + t.length * fs * 0.8 * 0.5 + fs * 0.5;
  const rows = [[]];
  let used = 0;
  for (const it of items) {
    const w = est(it[1]);
    if (rows[rows.length - 1].length && used + w > width) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(it); used += w;
  }
  return { stack: rows.map((r, k) => ({
    margin: [0, k ? 1 : fs * 0.5, 0, 0],
    table: { widths: r.flatMap(() => [sw, 'auto']), body: [r.flatMap(([cell, label]) => [cell, { text: label, noWrap: true, fontSize: fs * 0.8, color: MUTED, margin: [0, 0, fs * 0.5, 0] }])] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1, paddingBottom: () => 1 },
  })) };
}

/** perPage: 1 = A4 แนวนอน, 2 = A4 แนวตั้ง 2 ตารางบนล่าง, 4 = A4 แนวนอน 2×2 */
function docPerEntity(kind, perPage, ids = null) {
  const d = store.doc;
  const all = kind === 'class' ? d.classes : d.teachers;
  const list = ids ? all.filter((e) => ids.includes(e.id)) : all;
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
  // หัวกระดาษ (ชื่อโรงเรียน + บรรทัดตาราง + สรุปครู) และคำอธิบายสีท้ายตาราง
  const top = cfg.fs * (kind === 'teacher' ? 6.8 : 5.6) + cfg.fs * 2;
  const free = byDay ? cfg.h - top - (cfg.fs * 2.9 + 4) : cfg.h - top - (cfg.fs * 1.9 + 4) - brk * (cfg.fs * 1.7 + 4);
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
/** กระดาษเริ่มต้นของตารางรวม: ห้อง(หรือครู) × คาบต่อวัน > 36 → A3 (A4 ตัวอักษรเล็กจนอ่านไม่ออก) */
export function defaultPaper(kind = 'class') {
  const d = store.doc;
  if (!d) return 'A4';
  const n = (kind === 'class' ? d.classes : d.teachers).length;
  const teach = d.term.periods.filter((p) => p.type !== 'break').length;
  return n * teach > 36 ? 'A3' : 'A4';
}

/** ตารางรวมหนึ่งหน้า (วันในชุด dayList) · split = แยก 2 หน้า จ–พ / พฤ–ศ */
function overviewPage(kind, paper, dayList, slots, partLabel) {
  const d = store.doc;
  const list = kind === 'class' ? d.classes : d.teachers;
  const periods = d.term.periods.map((p, pi) => ({ p, pi })).filter(({ p }) => p.type !== 'break');
  const M = 18;
  const pageW = paper === 'A3' ? 1191 : 842;
  const nCols = dayList.length * periods.length;
  const firstW = paper === 'A3' ? 70 : 52;
  const colW = (pageW - 2 * M - firstW) / nCols;
  // ข้อความในช่องตัดบรรทัดไม่ได้ → ขนาดตัวอักษรต้องให้คำที่ยาวที่สุดพอดีช่อง (อักษร Plex กว้าง ~0.6 em)
  const len = (s) => (graphemes ? [...graphemes.segment(String(s || ''))].length : String(s || '').length);
  const words = kind === 'class' ? d.subjects.map((x) => shortName(x)) : d.classes.map((x) => x.name);
  const longest = Math.max(3, ...words.map(len));
  const fs = Math.max(3.6, Math.min(9, (colW - 2.5) / (longest * 0.62)));
  // ขยายแถวให้เต็มหน้าที่เหลือ (เผื่อหัวเรื่อง คำอธิบาย และ padding) ไม่เกิน 40pt
  const pageH = paper === 'A3' ? 842 : 595;
  const rowH = Math.min(40, Math.max(fs * 2.4, ((pageH - 2 * M - 10 - 52 - fs * 4) / Math.max(1, list.length)) * 0.9 - 3));
  const dayEdge = (col) => col > 0 && (col - 1) % periods.length === 0;

  const head1 = [{ text: kind === 'class' ? 'ห้อง' : 'ครู', rowSpan: 2, bold: true, fontSize: fs * 1.1, fillColor: HEAD, margin: [0, fs * 0.5, 0, 0] }];
  const head2 = [{}];
  for (const day of dayList) {
    head1.push({ text: DAY_NAMES[day], colSpan: periods.length, bold: true, alignment: 'center', fontSize: fs * 1.1, fillColor: HEAD }, ...Array(periods.length - 1).fill({}));
    for (const { p } of periods) head2.push({ text: p.label, alignment: 'center', fontSize: fs * 0.9, color: MUTED, fillColor: HEAD });
  }
  const body = [head1, head2];
  for (const e of list) {
    const row = [{ text: kind === 'class' ? e.name : (e.short || e.name), bold: true, fontSize: fs * 1.05, fillColor: HEAD }];
    for (const day of dayList) for (const { pi } of periods) row.push({ ...cellShort(slots, kind, e.id, day, pi, fs), alignment: 'center' });
    body.push(row);
  }
  const title = (kind === 'class' ? 'ตารางเรียนรวมทุกห้อง' : 'ตารางสอนรวมครูทุกคน') + (partLabel ? ` (${partLabel})` : '');
  return [
    { columns: [
      ...(hasLogo ? [{ image: 'logo', fit: [26, 26], width: 26, margin: [0, -3, 0, 0] }] : []),
      { stack: [{ text: th(window.TT?.school?.name || ''), bold: true, fontSize: 13, color: INK }, { text: th(`${title} · ${termText(d.term.name)}`), fontSize: 9, color: MUTED }], width: '*' },
    ], columnGap: 8 },
    { margin: [0, 6, 0, 0], table: { headerRows: 2, dontBreakRows: true, widths: [firstW, ...Array(nCols).fill('*')], heights: (r) => (r < 2 ? undefined : rowH), body }, layout: {
      ...gridLayout, paddingLeft: () => 0.8, paddingRight: () => 0.8, paddingTop: () => 1.5, paddingBottom: () => 1.5,
      vLineWidth: (i) => (dayEdge(i) ? 1.2 : 0.4), vLineColor: (i) => (dayEdge(i) ? '#7C8A99' : LINE),
    } },
    { text: kind === 'class' ? 'ในช่อง: บรรทัดบน = ชื่อย่อวิชา · บรรทัดล่าง = ชื่อย่อครู · ช่องม่วงลายเฉียง = คาบล็อก · ช่องสีแดง = คาบชน'
      : 'ในช่อง: บรรทัดบน = ห้องเรียน · บรรทัดล่าง = ชื่อย่อวิชา · ช่องเทาลายเฉียง = ครูไม่ว่าง · ช่องสีแดง = คาบชน', fontSize: 7, color: MUTED, margin: [0, 4, 0, 0] },
  ];
}

function docOverview(kind, paper, split = false) {
  const days = store.doc.term.days;
  const slots = slotIndex();
  const all = [...Array(days).keys()];
  const half = Math.ceil(days / 2);
  const parts = split && days > 1 ? [[all.slice(0, half), `${DAY_NAMES[0]}–${DAY_NAMES[half - 1]}`], [all.slice(half), `${DAY_NAMES[half]}–${DAY_NAMES[days - 1]}`]] : [[all, '']];
  const content = parts.map(([dl, label], i) => ({ stack: overviewPage(kind, paper, dl, slots, label), pageBreak: i ? 'before' : undefined }));
  return { pageSize: paper, pageOrientation: 'landscape', pageMargins: [18, 18, 18, 28], content };
}

// ---------- ส่วนที่เรียกจากแท็บส่งออก ----------
const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'ตาราง';

/**
 * เอกสาร pdfmake (ยังไม่สร้างไฟล์) + ชื่อไฟล์ · opts:
 *   kind 'class'|'teacher' · mode 'each' (รายห้อง/รายครู) | 'overview' (ตารางรวม)
 *   perPage 1|2|4 (each) · paper 'A4'|'A3' (overview, ไม่ใส่ = ตามขนาดโรงเรียน) · split แยก 2 หน้า (overview)
 *   ids [id] = เฉพาะห้อง/ครูเหล่านี้ (เช่น "ตารางสอนของฉัน")
 */
function makeDoc({ kind, mode, perPage = 1, paper, split = false, ids = null }, logo) {
  const d = store.doc;
  const list = kind === 'class' ? d.classes : d.teachers;
  if (!list.length) throw new Error(kind === 'class' ? 'ยังไม่มีห้องเรียน' : 'ยังไม่มีครู');
  paper ||= defaultPaper(kind);
  hasLogo = !!logo;
  const dd = mode === 'overview' ? docOverview(kind, paper, split) : docPerEntity(kind, perPage, ids);
  if (!dd.content.length) throw new Error('ไม่พบรายการที่เลือก');
  if (logo) dd.images = { logo };
  dd.patterns = PATTERNS;
  dd.defaultStyle = { font: 'Plex', fontSize: 9, color: INK, lineHeight: 1.05 };
  dd.info = { title: `${window.TT?.school?.name || ''} ${d.term.name}`, creator: 'ตารางบริบูรณ์' };
  const printed = printedOn();
  dd.footer = (page, pages) => ({ columns: [
    { text: th(`พิมพ์เมื่อ ${printed} · ${FOOT}`), fontSize: 7, color: MUTED }, { text: `หน้า ${page}/${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 'auto' },
  ], margin: [dd.pageMargins[0], 4, dd.pageMargins[2], 0] });
  const one = ids?.length === 1 ? list.find((e) => e.id === ids[0]) : null;
  const what = mode === 'overview' ? (kind === 'class' ? 'ตารางรวมทุกห้อง' : 'ตารางรวมครู') : (kind === 'class' ? 'ตารางเรียน' : 'ตารางสอน') + (one ? '-' + safeFile(one.name) : '');
  const suffix = mode === 'overview' ? paper + (split ? '-2หน้า' : '') : one ? '' : `${perPage}ต่อหน้า`;
  const name = [what, safeFile(window.TT?.school?.name), safeFile(d.term.name), suffix].filter(Boolean).join('-') + '.pdf';
  return { dd, name };
}

/** สร้างไฟล์ PDF → { blob, name } (ไม่ดาวน์โหลดเอง — ใช้กับ ดูตัวอย่าง/พิมพ์/แชร์) */
export async function buildPdf(opts) {
  const [pm, logo] = await Promise.all([loadPdfMake(), loadLogo()]);
  const { dd, name } = makeDoc(opts, logo);
  const blob = await pm.createPdf(dd).getBlob();
  return { blob, name };
}

/** สร้างแล้วดาวน์โหลดทันที → ชื่อไฟล์ (พฤติกรรมเดิม) */
export async function downloadPdf(opts) {
  const { blob, name } = await buildPdf(opts);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

// ---------- ดูตัวอย่างในหน้า (ไม่ต้องโหลด pdfmake) ----------
// CSP ของระบบไม่ให้ <iframe> เปิด blob:/data: (default-src 'self') → วาดเอกสารเดียวกันเป็น HTML ใส่ iframe srcdoc แบบ sandbox
// แปลงเฉพาะส่วนที่ไฟล์นี้ใช้: text/stack/columns/table(rowSpan/colSpan/fillColor/ลาย)/image · หน้าใหม่ = pageBreak 'before'
const PAGE = { A4: [842, 595], A3: [1191, 842] };
const hx = (s) => String(s ?? '').replace(/​/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BG = { lock: 'repeating-linear-gradient(135deg,transparent 0 3px,rgba(140,124,190,.45) 3px 4px)', off: 'repeating-linear-gradient(135deg,transparent 0 2px,rgba(120,134,150,.55) 2px 3px)', brk: 'radial-gradient(rgba(150,160,170,.5) .8px,transparent 1px) 0 0/4px 4px' };
function nodeHtml(n, images, fs = 9, inherit = {}) {
  if (n == null) return '';
  if (typeof n === 'string') return hx(n);
  if (Array.isArray(n)) return n.map((x) => nodeHtml(x, images, fs, inherit)).join('');
  const size = n.fontSize || fs;
  const st = [`font-size:${size}px`];
  if (n.bold) st.push('font-weight:600');
  if (n.color) st.push('color:' + n.color);
  if (n.alignment) st.push('text-align:' + n.alignment);
  if (n.margin) { const m = Array.isArray(n.margin) ? n.margin : [n.margin, n.margin, n.margin, n.margin]; st.push(`margin:${m[1] || 0}px ${m[2] || 0}px ${m[3] || 0}px ${m[0] || 0}px`); }
  const style = ` style="${st.join(';')}"`;
  if (n.image) return images[n.image] ? `<img src="${hx(images[n.image])}" alt="" style="width:${(n.fit?.[0] || n.width || 40)}px;height:auto;flex:none">` : '';
  if (n.columns) return `<div class="cols"${style}>${n.columns.map((c) => `<div style="${c.width === '*' ? 'flex:1;min-width:0' : 'flex:none'}">${nodeHtml(c, images, size)}</div>`).join('')}</div>`;
  if (n.stack) return `<div${style}>${n.stack.map((c) => `<div>${nodeHtml(c, images, size)}</div>`).join('')}</div>`;
  if (n.table) return tableHtml(n, images, size);
  if (Array.isArray(n.text)) return `<span${style}>${n.text.map((t) => nodeHtml(typeof t === 'string' ? t : { ...t, alignment: undefined }, images, size)).join('')}</span>`;
  if ('text' in n) return `<span${style}>${hx(n.text)}</span>`;
  return '';
}
function tableHtml(n, images, fs) {
  const { body, widths = [], heights } = n.table;
  const cols = widths.map((w) => (typeof w === 'number' ? `<col style="width:${w}px">` : '<col>')).join('');
  const noLines = n.layout && typeof n.layout.hLineWidth === 'function' && n.layout.hLineWidth(1) === 0;
  const rows = body.map((row, r) => {
    const h = Array.isArray(heights) ? heights[r] : typeof heights === 'function' ? heights(r) : undefined;
    return `<tr${h ? ` style="height:${h}px"` : ''}>${row.map((c) => {
      if (c && typeof c === 'object' && !Object.keys(c).length) return ''; // ช่องที่ถูกรวม (rowSpan/colSpan)
      const cell = typeof c === 'string' ? { text: c } : c || {};
      const bg = [cell.overlayPattern ? BG[cell.overlayPattern[0]] : '', cell.fillColor && typeof cell.fillColor === 'string' ? cell.fillColor : ''].filter(Boolean).join(',');
      const span = (cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '') + (cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '');
      return `<td${span} style="${bg ? 'background:' + bg + ';' : ''}${cell.alignment ? 'text-align:' + cell.alignment : ''}">${nodeHtml({ ...cell, fillColor: undefined, margin: undefined }, images, fs)}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<table class="${noLines ? 'plain' : 'grid'}"${n.margin ? ` style="margin-top:${n.margin[1] || 0}px"` : ''}><colgroup>${cols}</colgroup>${rows}</table>`;
}

/** HTML ตัวอย่าง (หน้าแรก ๆ ≤ maxPages) ของเอกสารเดียวกับไฟล์จริง → { html, name, pages, total } */
export async function previewHtml(opts, { maxPages = 3 } = {}) {
  const logo = await loadLogo();
  const { dd, name } = makeDoc(opts, logo);
  const [W, H] = PAGE[dd.pageSize] || PAGE.A4;
  const [pw, ph] = dd.pageOrientation === 'portrait' ? [H, W] : [W, H];
  const pages = [];
  for (const node of dd.content) { if (!pages.length || node.pageBreak === 'before') pages.push([]); pages[pages.length - 1].push(node); }
  const m = dd.pageMargins;
  const body = pages.slice(0, maxPages).map((nodes, i) => `<section class="page" style="width:${pw}px;height:${ph}px;padding:${m[1]}px ${m[2]}px ${m[3]}px ${m[0]}px">
    <div class="content">${nodes.map((x) => nodeHtml(x, dd.images || {})).join('')}</div>
    <div class="foot" style="left:${m[0]}px;right:${m[2]}px">${nodeHtml(dd.footer(i + 1, pages.length).columns, dd.images || {}, 7)}</div></section>`).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#E9EDF1;color:${INK};font-family:"IBM Plex Sans Thai","Thonburi","Leelawadee UI","Tahoma",system-ui,sans-serif;line-height:1.15}
    body{padding:14px;display:grid;gap:14px;justify-content:center}
    .page{position:relative;box-sizing:border-box;background:#fff;box-shadow:0 2px 10px rgba(15,36,56,.15);overflow:hidden;transform-origin:0 0}
    .content{display:grid;gap:12px;align-content:start}
    .cols{display:flex;gap:8px;align-items:flex-start}
    table{border-collapse:collapse;width:100%;table-layout:fixed}
    table.grid td{border:.5px solid ${LINE};padding:2px 3px;vertical-align:top;overflow:hidden;word-break:break-word}
    table.plain{width:auto}table.plain td{padding:1px 2px;vertical-align:middle}table.plain td:nth-child(odd){width:10px;border-radius:2px}
    .foot{position:absolute;bottom:8px;font-size:7px;color:${MUTED}}.foot .cols>div:last-child{margin-left:auto}
  </style></head><body>${body}</body></html>`;
  return { html, name, pages: Math.min(pages.length, maxPages), total: pages.length, width: pw, height: ph };
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
