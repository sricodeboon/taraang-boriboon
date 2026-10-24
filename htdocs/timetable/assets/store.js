// สถานะกลางของเอกสารภาคเรียน + ตัวช่วยค้นหา + ตรวจชน (สำรอง ถ้า solver.js ยังไม่พร้อม)
import { DAY_NAMES, fillSubjectPerWeek, SUBJECT_GROUP_CODES } from './rules.js';
export { DAY_NAMES };
export const SUBJECT_COLORS = ['#7FB0E8', '#E3B85A', '#F0A6BD', '#B69CE0', '#F2A65A', '#5FB3C9', '#E07A7A', '#9DB4C0', '#D4A5E8', '#C9B27C', '#8EA6E0', '#E8A0A0'];

export const store = {
  termId: 0,
  version: 0,
  doc: null,
  curriculum: null, // { รหัสวิชา: คาบ/สัปดาห์ } จาก data/curriculum.json (app.php ฝังมา) ใช้เติม subject.perWeek ให้ข้อมูลเก่า
  listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  /** แก้เอกสาร แล้วแจ้งทุกหน้าจอ + ตั้งเวลาบันทึก */
  commit(reason = '') { index(); for (const fn of this.listeners) fn(reason); },
};

export function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// ---------- ดัชนีค้นหาเร็ว ----------
export const idx = { cls: new Map(), tch: new Map(), room: new Map(), subj: new Map(), asg: new Map(), placed: new Map() };
export function index() {
  const d = store.doc;
  if (!d) return;
  sanitize(d);
  idx.cls = new Map(d.classes.map((x) => [x.id, x]));
  idx.tch = new Map(d.teachers.map((x) => [x.id, x]));
  idx.room = new Map(d.rooms.map((x) => [x.id, x]));
  idx.subj = new Map(d.subjects.map((x) => [x.id, x]));
  idx.asg = new Map(d.assignments.map((x) => [x.id, x]));
  idx.placed = new Map();
  for (const p of d.placements) idx.placed.set(p.assignmentId, (idx.placed.get(p.assignmentId) || 0) + 1);
}

// ---------- ทำความสะอาดเอกสาร ----------
// เอกสารมาจากเซิร์ฟเวอร์หรือไฟล์สำรองที่ผู้ใช้นำเข้า (แก้มือได้) — ค่าที่หน้าจอพิมพ์ลง HTML ตรง ๆ (ตัวเลข, สี)
// ต้องเป็นชนิดที่ถูกต้องเสมอ ไม่งั้นไฟล์สำรองที่ถูกดัดแปลงฝัง HTML/สคริปต์ผ่าน innerHTML ได้
const toInt = (v, def = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : def; };
const HEX = /^#[0-9a-f]{3,8}$/i;
function sanitize(d) {
  if (!d.term || typeof d.term !== 'object') d.term = {};
  d.term.days = Math.min(7, Math.max(1, toInt(d.term.days, 5)));
  // ตัดรายการเสียออกแบบแก้ในอาร์เรย์เดิม (หน้าจอถืออ้างอิงอาร์เรย์ไว้ ห้ามสร้างอาร์เรย์ใหม่)
  const clean = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (!arr[i] || typeof arr[i] !== 'object') arr.splice(i, 1); };
  if (!Array.isArray(d.term.periods)) d.term.periods = [];
  clean(d.term.periods);
  for (const k of ['classes', 'teachers', 'rooms', 'subjects', 'assignments', 'locks', 'placements']) {
    if (!Array.isArray(d[k])) d[k] = [];
    clean(d[k]);
  }
  const classIds = new Set(d.classes.map((c) => c.id));
  for (const t of d.teachers) {
    if (t.maxPerDay != null) t.maxPerDay = Math.max(0, toInt(t.maxPerDay));
    if (t.unavailable != null && !(Array.isArray(t.unavailable) && t.unavailable.every((u) => Array.isArray(u) && Number.isInteger(u[0]) && Number.isInteger(u[1])))) {
      t.unavailable = Array.isArray(t.unavailable) ? t.unavailable.filter(Array.isArray).map(([x, y]) => [toInt(x), toInt(y)]) : [];
    }
    // กลุ่มสาระที่สอนได้ (ฟิลด์ใหม่ optional) — เฉพาะรหัสใน whitelist ไม่ซ้ำ
    if (t.subjects != null) {
      if (!Array.isArray(t.subjects)) delete t.subjects;
      else if (!t.subjects.every((g, i, a) => SUBJECT_GROUP_CODES.includes(g) && a.indexOf(g) === i)) t.subjects = [...new Set(t.subjects.filter((g) => SUBJECT_GROUP_CODES.includes(g)))]; // ถูกอยู่แล้ว = อาร์เรย์เดิม (sanitize รันทุก commit)
    }
    // ครูประจำชั้น (optional) — id ห้องที่มีอยู่จริงเท่านั้น (ลบห้องแล้วค่านี้หายเอง)
    if (t.homeroom != null && !(typeof t.homeroom === 'string' && classIds.has(t.homeroom))) delete t.homeroom;
  }
  for (const s of d.subjects) {
    if (s.color != null && !HEX.test(String(s.color))) s.color = SUBJECT_COLORS[0];
    // คาบ/สัปดาห์ตามหลักสูตร: undefined = ข้อมูลเก่า (เติมจากหลักสูตรด้านล่าง) · null = ไม่ระบุ
    if (s.perWeek != null) { const n = toInt(s.perWeek, -1); s.perWeek = n >= 1 ? Math.min(40, n) : null; }
  }
  fillSubjectPerWeek(d, store.curriculum);
  for (const a of d.assignments) {
    if (a.perWeek != null) a.perWeek = Math.max(0, toInt(a.perWeek));
    if (a.doubles != null) a.doubles = Math.max(0, toInt(a.doubles));
    // แบ่งสอน: id กลุ่มเป็นข้อความสั้น ๆ เท่านั้น
    if (a.split != null && !(typeof a.split === 'string' && /^[\w-]{1,40}$/.test(a.split))) delete a.split;
  }
  // ค่าตั้งของภาคเรียน (แนวตาราง) — ข้อมูลเก่าไม่มี = วันเรียงลงล่าง
  if (!d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) d.settings = {};
  if (d.settings.orientation !== 'periods' && d.settings.orientation !== 'days') d.settings.orientation = 'days';
  // seed ของการจัดอัตโนมัติ (ผลเหมือนเดิมทุกครั้งจนกว่าจะกด "สุ่มแบบใหม่") — จำนวนเต็มเท่านั้น
  if (d.settings.solveSeed != null) { const n = Math.trunc(Number(d.settings.solveSeed)); if (Number.isSafeInteger(n)) d.settings.solveSeed = n; else delete d.settings.solveSeed; }
  sanitizeMeta(d);
  for (const x of [...d.locks, ...d.placements]) { x.day = toInt(x.day); x.period = toInt(x.period); }
}

// ข้อมูลประกอบของภาคเรียน (ไม่ใช่ข้อมูลตาราง): meta.lastSolve = ผลจัดล่าสุด (แอดมินอ่าน) · meta.setup = คำตอบตัวช่วยเริ่มต้น
// รับเฉพาะคีย์ที่รู้จัก ชนิดถูกต้อง — ค่าอื่นตัดทิ้ง (meta ไม่ใช่ object ธรรมดา = ลบทั้งก้อน)
const plain = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const SAFE_KEY = /^[A-Za-z_][\w-]{0,39}$/;
const natural = (v) => { const n = toInt(v, -1); return n >= 0 ? n : 0; };
function sanitizeMeta(d) {
  if (d.meta == null) return;
  if (!plain(d.meta)) { delete d.meta; return; }
  const m = d.meta, out = {};
  const ls = m.lastSolve;
  if (plain(ls)) {
    const at = typeof ls.at === 'number' && Number.isFinite(ls.at) ? Math.trunc(ls.at) : typeof ls.at === 'string' && /^[\d\-T:.Z+ ]{4,40}$/.test(ls.at) ? ls.at : null;
    out.lastSolve = { at, mode: typeof ls.mode === 'string' && /^[\w-]{1,20}$/.test(ls.mode) ? ls.mode : '', placed: natural(ls.placed), need: natural(ls.need), unplaced: natural(ls.unplaced),
      codes: Array.isArray(ls.codes) ? ls.codes.filter((c) => typeof c === 'string' && /^[\w.-]{1,40}$/.test(c)).slice(0, 50) : [] };
  }
  // setup: คีย์ปลอดภัย + ค่าพื้นฐาน (ข้อความ ≤ 200 ตัว · ตัวเลข · จริง/เท็จ · อาร์เรย์ของค่าพื้นฐาน ≤ 50)
  if (plain(m.setup)) {
    const prim = (v) => (typeof v === 'string' ? v.length <= 200 : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean');
    out.setup = {};
    for (const [k, v] of Object.entries(m.setup)) {
      if (!SAFE_KEY.test(k)) continue;
      if (prim(v)) out.setup[k] = v;
      else if (Array.isArray(v) && v.length <= 50 && v.every(prim)) out.setup[k] = v.slice();
    }
  }
  for (const k of Object.keys(m)) delete m[k];
  Object.assign(m, out);
}

export const remaining = (a) => Math.max(0, (a.perWeek || 0) - (idx.placed.get(a.id) || 0));
export const isBreak = (period) => store.doc.term.periods[period]?.type === 'break';
export const classPeriods = () => store.doc.term.periods.filter((p) => p.type !== 'break').length;

export function lockAt(classId, day, period) {
  return store.doc.locks.find((l) => l.day === day && l.period === period && (l.classId == null || l.classId === classId)) || null;
}

export function teacherUnavailable(teacherId, day, period) {
  const t = idx.tch.get(teacherId);
  return !!t && (t.unavailable || []).some(([d, p]) => d === day && p === period);
}

/** รายการคาบที่วางอยู่ในช่องนี้ ตามมุมมอง */
export function placementsAt(view, id, day, period) {
  return store.doc.placements.filter((p) => {
    if (p.day !== day || p.period !== period) return false;
    const a = idx.asg.get(p.assignmentId);
    if (!a) return false;
    return view === 'class' ? a.classId === id : view === 'teacher' ? a.teacherId === id : a.roomId === id;
  });
}

/** แถวที่ยังไม่มีครู: ว่าง หรืออ้างครูที่ถูกลบไปแล้ว (รวมการแก้ไข 409/เลิกทำนำเข้า) — ใช้นิยามเดียวกันทุกที่ ตรงกับ solverInput */
export const noTeacher = (a) => !a.teacherId || !idx.tch.has(a.teacherId);

/** เหตุผลที่วางไม่ได้ (hard constraints) หรือ null ถ้าวางได้ — ใช้ตอนลาก */
export function whyCannotPlace(a, day, period, ignore = null) {
  if (isBreak(period)) return 'ช่องพัก';
  const lk = lockAt(a.classId, day, period);
  if (lk) return 'คาบล็อก: ' + (lk.label || '');
  if (teacherUnavailable(a.teacherId, day, period)) return 'ครูไม่ว่างคาบนี้';
  let teacherToday = 0;
  for (const p of store.doc.placements) {
    if (p === ignore) continue;
    const b = idx.asg.get(p.assignmentId);
    if (!b) continue;
    // แถวที่ยังไม่มีครู (teacherId ว่าง) ไม่นับว่าเป็นครูคนเดียวกัน — ตรงกับ localValidate
    const sameTeacher = !!a.teacherId && b.teacherId === a.teacherId;
    if (p.day === day && sameTeacher) teacherToday++;
    if (p.day !== day || p.period !== period) continue;
    if (b.classId === a.classId) return 'ห้องเรียนนี้มีวิชาอื่นแล้ว';
    if (sameTeacher) return 'ครูสอนห้องอื่นอยู่';
    if (a.roomId && b.roomId === a.roomId) return 'ห้องพิเศษถูกใช้อยู่';
  }
  const t = idx.tch.get(a.teacherId);
  if (t && t.maxPerDay && teacherToday >= t.maxPerDay) return `ครูสอนครบ ${t.maxPerDay} คาบในวันนี้แล้ว`;
  return null;
}

/** ตรวจชนทั้งเอกสาร (สำรอง) — คืนรูปแบบเดียวกับ validate() ของ solver */
export function localValidate() {
  const d = store.doc, out = [];
  const seen = new Map();
  const perTeacherDay = new Map();
  for (const p of d.placements) {
    const a = idx.asg.get(p.assignmentId);
    if (!a) continue;
    if (isBreak(p.period)) out.push({ type: 'break', day: p.day, period: p.period, ids: [a.id] });
    if (lockAt(a.classId, p.day, p.period)) out.push({ type: 'lock', day: p.day, period: p.period, ids: [a.id] });
    if (teacherUnavailable(a.teacherId, p.day, p.period)) out.push({ type: 'unavailable', day: p.day, period: p.period, ids: [a.id] });
    for (const [kind, key] of [['class', a.classId], ['teacher', a.teacherId], ['room', a.roomId]]) {
      if (!key) continue;
      const k = `${kind}|${key}|${p.day}|${p.period}`;
      if (seen.has(k)) out.push({ type: kind, day: p.day, period: p.period, ids: [seen.get(k), a.id] });
      else seen.set(k, a.id);
    }
    const tk = `${a.teacherId}|${p.day}`;
    perTeacherDay.set(tk, (perTeacherDay.get(tk) || 0) + 1);
  }
  for (const [k, n] of perTeacherDay) {
    const [tid, day] = k.split('|');
    const t = idx.tch.get(tid);
    if (t && t.maxPerDay && n > t.maxPerDay) out.push({ type: 'maxPerDay', day: +day, period: -1, ids: [tid] });
  }
  return out;
}

export const CONFLICT_TEXT = {
  class: 'ห้องเรียนมีสองวิชาในคาบเดียวกัน', teacher: 'ครูสอนสองห้องในคาบเดียวกัน', room: 'ห้องพิเศษถูกใช้ซ้ำ',
  lock: 'วางทับคาบล็อก', break: 'วางในช่องพัก', unavailable: 'ครูไม่ว่างคาบนี้', maxPerDay: 'ครูสอนเกินจำนวนคาบต่อวัน',
  double: 'คาบคู่ไม่ติดกัน',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function assignmentLabel(a) {
  const s = idx.subj.get(a.subjectId), c = idx.cls.get(a.classId), t = idx.tch.get(a.teacherId), r = a.roomId ? idx.room.get(a.roomId) : null;
  return { subj: s, cls: c, tch: t, room: r, color: s?.color || '#7FB0E8', name: s ? s.name : '(ไม่มีวิชา)', code: s?.code || '' };
}

// ---------- รวมการแก้ไขเมื่อบันทึกชนกัน (409) / กู้ฉบับร่าง — ใช้ใน app.js และทดสอบใน tests/merge.test.mjs ----------
const byId = (arr) => Array.isArray(arr) && arr.every((x) => x && typeof x === 'object' && typeof x.id === 'string');
/**
 * ส่วนที่เปลี่ยนทุกครั้งที่กดจัด แต่ไม่ควรถามผู้ใช้ → ทำให้สองฝั่งเท่ากันก่อนรวม (สำเนาตื้น ไม่แก้ของเดิม)
 * meta = บันทึกประกอบ: lastSolve เอาฉบับที่ at ใหม่กว่า, ส่วนอื่น (setup) รวมแบบ spread ฝั่งเราชนะ
 * settings ต่างกันแค่ solveSeed → ใช้ seed ของอีกฝั่ง (seed ไม่ใช่ข้อมูลที่ครูตั้งเอง)
 */
function quietParts(base, mine, theirs) {
  if (!mine || !theirs || typeof mine !== 'object' || typeof theirs !== 'object') return [mine, theirs];
  const plainObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const m = { ...mine }, t = { ...theirs };
  if ((plainObj(m.meta) || plainObj(t.meta)) && JSON.stringify(m.meta) !== JSON.stringify(t.meta)) {
    const mm = plainObj(m.meta) ? m.meta : {}, tm = plainObj(t.meta) ? t.meta : {};
    const at = (x) => (plainObj(x) && typeof x.at === 'string' ? x.at : '');
    const ls = at(mm.lastSolve) >= at(tm.lastSolve) ? mm.lastSolve : tm.lastSolve;
    const meta = { ...tm, ...mm };
    if (ls === undefined) delete meta.lastSolve; else meta.lastSolve = ls;
    m.meta = meta; t.meta = meta;
  }
  if (plainObj(m.settings) && plainObj(t.settings) && m.settings.solveSeed !== t.settings.solveSeed) {
    const { solveSeed: a, ...ms } = m.settings, { solveSeed: b, ...ts } = t.settings;
    if (JSON.stringify(ms) === JSON.stringify(ts)) m.settings = t.settings;
  }
  return [m, t];
}

/**
 * รวม 3 ทาง: รายการที่มี id (ห้อง ครู วิชา ห้องพิเศษ การสอน) เทียบทีละรายการ ส่วนอื่น (โครงคาบ คาบล็อก ตาราง) เทียบทั้งหมวด
 * แก้ฝั่งเดียว = เอาฝั่งนั้น (รวมการเพิ่ม/ลบ) · แก้ทั้งสองฝั่งต่างกัน = ชน → prefer ('mine'|'theirs') ตัดสิน, null = ยังไม่ตัดสิน (นับไว้ถาม)
 * คืน { merged, clashes: [ชื่อหมวดที่ชน] }
 */
export function merge3(base, mine, theirs, prefer = null) {
  const J = (x) => JSON.stringify(x);
  const out = {}, clashes = new Set();
  [mine, theirs] = quietParts(base, mine, theirs);
  const pick = (k, b, m, t) => {
    const bj = J(b), mj = J(m), tj = J(t);
    if (mj === tj || mj === bj) return t;
    if (tj === bj) return m;
    clashes.add(k);
    return prefer === 'theirs' ? t : m;
  };
  for (const k of new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})])) {
    const b = base?.[k], m = mine?.[k], t = theirs?.[k];
    if (byId(m) && byId(t) && (b === undefined || byId(b))) {
      const B = new Map((b || []).map((x) => [x.id, x])), M = new Map(m.map((x) => [x.id, x])), T = new Map(t.map((x) => [x.id, x]));
      const ids = [...t.map((x) => x.id), ...m.map((x) => x.id).filter((id) => !T.has(id))];
      out[k] = ids.map((id) => pick(k, B.get(id), M.get(id), T.get(id))).filter(Boolean);
    } else out[k] = pick(k, b, m, t);
  }
  return { merged: out, clashes: [...clashes] };
}
