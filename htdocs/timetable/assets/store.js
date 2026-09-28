// สถานะกลางของเอกสารภาคเรียน + ตัวช่วยค้นหา + ตรวจชน (สำรอง ถ้า solver.js ยังไม่พร้อม)
export const DAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
export const SUBJECT_COLORS = ['#7FB0E8', '#E3B85A', '#F0A6BD', '#B69CE0', '#F2A65A', '#5FB3C9', '#E07A7A', '#9DB4C0', '#D4A5E8', '#C9B27C', '#8EA6E0', '#E8A0A0'];

export const store = {
  termId: 0,
  version: 0,
  doc: null,
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
  for (const t of d.teachers) {
    if (t.maxPerDay != null) t.maxPerDay = Math.max(0, toInt(t.maxPerDay));
    if (t.unavailable != null && !(Array.isArray(t.unavailable) && t.unavailable.every((u) => Array.isArray(u) && Number.isInteger(u[0]) && Number.isInteger(u[1])))) {
      t.unavailable = Array.isArray(t.unavailable) ? t.unavailable.filter(Array.isArray).map(([x, y]) => [toInt(x), toInt(y)]) : [];
    }
  }
  for (const s of d.subjects) if (s.color != null && !HEX.test(String(s.color))) s.color = SUBJECT_COLORS[0];
  for (const a of d.assignments) {
    if (a.perWeek != null) a.perWeek = Math.max(0, toInt(a.perWeek));
    if (a.doubles != null) a.doubles = Math.max(0, toInt(a.doubles));
  }
  for (const x of [...d.locks, ...d.placements]) { x.day = toInt(x.day); x.period = toInt(x.period); }
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
    if (p.day === day && b.teacherId === a.teacherId) teacherToday++;
    if (p.day !== day || p.period !== period) continue;
    if (b.classId === a.classId) return 'ห้องเรียนนี้มีวิชาอื่นแล้ว';
    if (b.teacherId === a.teacherId) return 'ครูสอนห้องอื่นอยู่';
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
