// กฎของข้อมูลการสอนที่ไม่แตะหน้าจอ (ทดสอบใน node ได้: tests/rules.test.mjs)
// - แนวตาราง (วันเรียงลงล่าง / คาบเรียงลงล่าง) · ความยาวคาบ · คาบ/สัปดาห์ตามหลักสูตร
// - กันเลือกวิชาซ้ำในห้องเดียวกัน · แบ่งสอน (วิชาเดียว 2 ครู) · รวมแถวซ้ำ · ลบทั้งหมด + เลิกทำ

export const DAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

// ---------- แนวตาราง ----------
/** 'days' = วันเรียงลงล่าง (แถว = วัน คอลัมน์ = คาบ) ค่าเริ่มต้น · 'periods' = คาบเรียงลงล่าง (แถว = คาบ คอลัมน์ = วัน) */
export const ORIENTS = [['days', 'วันเรียงลงล่าง'], ['periods', 'คาบเรียงลงล่าง']];
export function orientation(doc) { return doc?.settings?.orientation === 'periods' ? 'periods' : 'days'; }

/**
 * โครงตารางตามแนวที่เลือก ใช้ร่วมกันทั้งกระดาน PDF และ Excel
 * rows/cols: { day } หรือ { period, p, brk } · at(r, c) → { day, period } ของช่องนั้น
 * ช่องพัก: แนวคาบเรียงลงล่าง = ทั้งแถว (row.brk) · แนววันเรียงลงล่าง = ทั้งคอลัมน์ (col.brk)
 */
export function gridModel(doc, orient = orientation(doc)) {
  const days = [...Array(doc.term.days).keys()].map((day) => ({ day, name: DAY_NAMES[day] }));
  const periods = doc.term.periods.map((p, period) => ({ period, p, brk: p.type === 'break' }));
  if (orient === 'periods') return { orient, corner: 'คาบ', rows: periods, cols: days, at: (r, c) => ({ day: c.day, period: r.period }) };
  return { orient, corner: 'วัน', rows: days, cols: periods, at: (r, c) => ({ day: r.day, period: c.period }) };
}

// ---------- ความยาวคาบ ----------
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
/** นาทีต่อคาบตามโครงคาบที่โรงเรียนตั้ง → { min, max } หรือ null ถ้ายังไม่ได้ตั้งเวลา */
export function periodMinutes(doc) {
  const len = doc.term.periods.filter((p) => p.type !== 'break').map((p) => toMin(p.end) - toMin(p.start)).filter((n) => n > 0 && n < 300);
  return len.length ? { min: Math.min(...len), max: Math.max(...len) } : null;
}
/** ข้อความ "1 คาบ = 60 นาที" สำหรับคำอธิบายหัวตาราง */
export function periodText(doc) {
  const m = periodMinutes(doc);
  if (!m) return '1 คาบ = ตามเวลาที่ตั้งในแท็บโครงคาบ';
  return m.min === m.max ? `1 คาบ = ${m.min} นาที (ตามโครงคาบของโรงเรียน)` : `1 คาบ = ${m.min}–${m.max} นาที (ตามโครงคาบของโรงเรียน)`;
}

// ---------- คาบ/สัปดาห์ตามหลักสูตร ----------
/** ระดับจากรหัสวิชามาตรฐาน [กลุ่มสาระ][ระดับ 1=ประถม 2=ม.ต้น 3=ม.ปลาย][ปี][…] */
export function codeLevel(code) { const m = /^\s*[ก-ฮ]([123])\d/.exec(String(code || '')); return m ? +m[1] : 0; }
/** คำใบ้แปลงคาบ/สัปดาห์เป็นชั่วโมง: ประถม = ×40 ชม./ปี · มัธยม = ×20 ชม./ภาค (2 คาบ = 1 หน่วยกิต) */
export function hoursHint(code, n) {
  if (!(n > 0)) return '';
  const lv = codeLevel(code);
  if (lv === 2 || lv === 3) return `= ${n * 20} ชม./ภาค · ${(n / 2).toLocaleString('th-TH')} หน่วยกิต`;
  return `= ${n * 40} ชม./ปี`;
}

/** เติม subject.perWeek ให้ข้อมูลเก่าที่ยังไม่มีค่า (undefined) จากหลักสูตรตามรหัสวิชา · null = ผู้ใช้ลบค่าเอง ไม่เติมซ้ำ */
export function fillSubjectPerWeek(doc, map) {
  if (!map) return 0;
  let n = 0;
  for (const s of doc.subjects) {
    if (s.perWeek !== undefined) continue;
    const v = map[String(s.code || '').trim()];
    if (Number.isInteger(v) && v > 0) { s.perWeek = v; n++; }
  }
  return n;
}

// ---------- วิชาซ้ำ / แบ่งสอน ----------
const byId = (doc) => new Map(doc.subjects.map((s) => [s.id, s]));
const key = (a) => a.classId + '|' + a.subjectId;

/** แถวที่สอนวิชาเดียวกันในห้องเดียวกัน (รวมแถวตัวเอง) */
export function sameRows(doc, a) { return doc.assignments.filter((x) => x.classId === a.classId && x.subjectId === a.subjectId); }

/**
 * วิชาที่เลือกได้ในแถวนี้: ตัดวิชาที่ห้องเดียวกันมีการสอนอยู่แล้ว ยกเว้นวิชาของแถวตัวเอง
 * (แบ่งสอนใช้ปุ่ม "แบ่งสอน" ไม่ใช่เลือกวิชาซ้ำ)
 */
export function subjectChoices(doc, a, usedByClass = null) {
  const used = usedByClass?.get(a.classId) || new Set(doc.assignments.filter((x) => x.classId === a.classId && x !== a).map((x) => x.subjectId));
  return doc.subjects.filter((s) => s.id === a.subjectId || !used.has(s.id));
}
/** Map classId → Set(subjectId) ใช้ซ้ำทั้งตาราง (ไม่ต้องกรองทุกแถวใหม่) */
export function usedSubjects(doc) {
  const m = new Map();
  for (const a of doc.assignments) { if (!m.has(a.classId)) m.set(a.classId, new Set()); m.get(a.classId).add(a.subjectId); }
  return m;
}

/** กลุ่มแถวที่ซ้ำ (ห้อง+วิชาเดียวกัน แต่ไม่ได้ผูกเป็นแบ่งสอนกลุ่มเดียวกัน) → [[a, b, …], …] */
export function duplicateGroups(doc) {
  const g = new Map();
  for (const a of doc.assignments) { const k = key(a); if (!g.has(k)) g.set(k, []); g.get(k).push(a); }
  return [...g.values()].filter((rows) => rows.length > 1 && !(rows[0].split && rows.every((r) => r.split === rows[0].split)));
}

/** ครูคนที่สองที่เหมาะจะแบ่งสอน: ครูที่สอนห้องนี้อยู่แล้ว (ไม่ใช่คนเดิม) ก่อน แล้วค่อยครูคนแรกที่ไม่ใช่คนเดิม */
function otherTeacher(doc, a) {
  const count = new Map();
  for (const x of doc.assignments) if (x.classId === a.classId && x.teacherId !== a.teacherId) count.set(x.teacherId, (count.get(x.teacherId) || 0) + 1);
  const known = new Set(doc.teachers.map((t) => t.id));
  const top = [...count].filter(([id]) => known.has(id)).sort((x, y) => y[1] - x[1])[0]?.[0];
  return top || doc.teachers.find((t) => t.id !== a.teacherId)?.id || a.teacherId;
}

/**
 * แบ่งสอน: แยกแถว a เป็น 2 แถวที่ผูกกัน (split = id กลุ่ม) คาบรวมเท่าเดิม (5 → 3+2)
 * คาบที่วางไว้แล้วอยู่กับแถวเดิม ส่วนที่เกินคาบใหม่ของแถวเดิมถูกนำออก · คืนแถวใหม่
 */
export function splitAssignment(doc, a, newId) {
  const n = Math.max(1, a.perWeek || 1);
  const group = a.split || a.id;
  const keep = Math.ceil(n / 2), give = n >= 2 ? n - keep : 1;
  a.split = group;
  a.perWeek = keep;
  if ((a.doubles || 0) * 2 > keep) a.doubles = Math.floor(keep / 2);
  const mine = doc.placements.filter((p) => p.assignmentId === a.id);
  if (mine.length > keep) { const drop = new Set(mine.slice(keep)); doc.placements = doc.placements.filter((p) => !drop.has(p)); }
  const b = { id: newId, subjectId: a.subjectId, classId: a.classId, teacherId: otherTeacher(doc, a), roomId: a.roomId ?? null, perWeek: give, doubles: 0, split: group };
  doc.assignments.splice(doc.assignments.indexOf(a) + 1, 0, b);
  return b;
}

/** รวมหลายแถวเป็นแถวเดียว (แถวแรกเก็บไว้): คาบรวมกัน คาบที่วางไว้ย้ายมาเป็นของแถวแรก · ใช้กับ "เลิกแบ่งสอน" และ "รวมแถวซ้ำ" */
export function mergeRows(doc, rows) {
  const [first, ...rest] = rows;
  if (!first || !rest.length) return first;
  const ids = new Set(rest.map((r) => r.id));
  first.perWeek = rows.reduce((s, r) => s + (r.perWeek || 0), 0);
  first.doubles = Math.min(Math.floor(first.perWeek / 2), rows.reduce((s, r) => s + (r.doubles || 0), 0));
  delete first.split;
  for (const p of doc.placements) if (ids.has(p.assignmentId)) p.assignmentId = first.id;
  doc.assignments = doc.assignments.filter((x) => !ids.has(x.id));
  return first;
}
/** ผูกแถวซ้ำเป็นแบ่งสอนกลุ่มเดียวกัน (กรณีตั้งใจให้ 2 ครูสอน) */
export function markSplit(rows) { const g = rows[0].split || rows[0].id; for (const r of rows) r.split = g; }

/**
 * สถานะคาบ/สัปดาห์เทียบหลักสูตร: รวมทุกแถวของวิชาเดียวกันในห้องเดียวกัน (แบ่งสอนนับรวม)
 * คืน null ถ้าวิชาไม่มีค่าตามหลักสูตร · { target, total, split, ok }
 */
export function perWeekStatus(doc, a, subjects = byId(doc)) {
  const s = subjects.get(a.subjectId);
  const target = s?.perWeek;
  if (!(target > 0)) return null;
  const rows = sameRows(doc, a);
  const total = rows.reduce((n, r) => n + (r.perWeek || 0), 0);
  return { target, total, split: rows.length > 1 && rows.every((r) => r.split && r.split === a.split), ok: total === target };
}

// ---------- ลบทั้งหมด + เลิกทำ ----------
/** ลบรายการในอาร์เรย์ตามเงื่อนไข จำตำแหน่งเดิมไว้คืน */
function cut(arr, pred) {
  const out = [];
  for (let i = 0; i < arr.length; i++) if (pred(arr[i])) out.push([i, arr[i]]);
  for (let k = out.length - 1; k >= 0; k--) arr.splice(out[k][0], 1);
  return out;
}
/**
 * ลบการสอนตามเงื่อนไข (เช่น เฉพาะห้องที่กรองอยู่) พร้อมคาบที่วางไว้ · คืน token สำหรับ undo()
 * แก้ในอาร์เรย์เดิม (หน้าจออื่นถืออ้างอิงไว้)
 */
export function removeAssignments(doc, pred) {
  const asg = cut(doc.assignments, pred);
  const ids = new Set(asg.map(([, a]) => a.id));
  const pl = cut(doc.placements, (p) => ids.has(p.assignmentId));
  return { assignments: asg, placements: pl, subjects: [] };
}
/** ลบวิชาทั้งหมด (หรือตามเงื่อนไข) พร้อมการสอนที่ผูกและคาบในตาราง */
export function removeSubjects(doc, pred = () => true) {
  const subj = cut(doc.subjects, pred);
  const ids = new Set(subj.map(([, s]) => s.id));
  const t = removeAssignments(doc, (a) => ids.has(a.subjectId));
  t.subjects = subj;
  return t;
}
/** คืนสภาพจาก token: ใส่กลับตำแหน่งเดิม (เรียงจากน้อยไปมาก) รวมคาบที่วางไว้ · ข้ามรายการที่มี id ซ้ำอยู่แล้ว */
export function undoRemove(doc, t) {
  if (t.undone) return 0; // กดเลิกทำซ้ำไม่ใส่คืนซ้ำ
  t.undone = true;
  const put = (arr, items, idOf) => {
    const have = new Set(arr.map(idOf));
    for (const [i, x] of items) { if (idOf(x) && have.has(idOf(x))) continue; arr.splice(Math.min(i, arr.length), 0, x); }
  };
  put(doc.subjects, t.subjects, (x) => x.id);
  put(doc.assignments, t.assignments, (x) => x.id);
  put(doc.placements, t.placements, () => null);
  return t.assignments.length + t.subjects.length;
}
