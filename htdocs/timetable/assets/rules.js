// กฎของข้อมูลการสอนที่ไม่แตะหน้าจอ (ทดสอบใน node ได้: tests/rules.test.mjs)
// - แนวตาราง (วันเรียงลงล่าง / คาบเรียงลงล่าง) · ความยาวคาบ · คาบ/สัปดาห์ตามหลักสูตร
// - กันเลือกวิชาซ้ำในห้องเดียวกัน · แบ่งสอน (วิชาเดียว 2 ครู) · รวมแถวซ้ำ · ลบทั้งหมด + เลิกทำ
// - สร้างโครงคาบจากเวลาเริ่ม (buildPeriods) · รายวิชาตามชั้นจากรหัสวิชา (subjectsForLevels)
// - กลุ่มสาระของวิชา/ครู · เติมครูอัตโนมัติ (autoAssign) · เดาครูของแถวใหม่ (guessTeacher/guessNew)

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

// ---------- ชั้นเรียน ⇄ รหัสวิชา ----------
/** ชั้นมาตรฐานจากชื่อ/level ห้อง: 'ม.1/2' 'ม1/2' 'ป. 1' 'ป.1-2' (คละชั้นใช้ชั้นแรก) → 'ม.1' · อ่านไม่ได้ → '' */
export function levelKey(s) {
  const m = /^\s*(อ|ป|ม)\.?\s*(\d)/.exec(String(s || ''));
  return m ? m[1] + '.' + m[2] : '';
}
/** หลัก [ระดับ][ปี] ของรหัสวิชาที่ชั้นนี้ใช้: ป.1 → '11' · ม.1 → '21' · ม.4 → '31' · อนุบาล/อ่านไม่ได้ → '' */
function levelDigits(level) {
  const k = levelKey(level);
  if (!k) return '';
  const y = +k[2];
  if (k[0] === 'ป') return y >= 1 && y <= 6 ? '1' + y : '';
  if (k[0] === 'ม') return y >= 1 && y <= 3 ? '2' + y : y <= 6 ? '3' + (y - 3) : '';
  return '';
}
const codeDigits = (code) => { const m = /^\s*[ก-ฮ](\d)(\d)/.exec(String(code || '')); return m ? m[1] + m[2] : ''; };
/** วิชานี้เป็นของชั้นนี้ไหม — ดูจากรหัสวิชาเท่านั้น (ชื่อวิชามัธยมไม่มีชื่อชั้น เช่น "ภาษาไทย 1" = ม.1) */
export function codeFitsLevel(code, level) { const d = levelDigits(level); return !!d && codeDigits(code) === d; }
/** ภาคเรียนจากชื่อภาคเรียน: "ภาคเรียนที่ 2/2569" → 2 · อื่น ๆ → 1 */
export function termSem(name) { return /ภาคเรียนที่\s*2/.test(String(name || '')) ? 2 : 1; }

/**
 * รายวิชาพื้นฐานของชั้นที่เลือกจาก data/curriculum.json (ใช้ในตัวช่วยเริ่มต้น)
 * จับวิชาเข้าชั้นด้วยรหัส [กลุ่มสาระ][ระดับ][ปี]… ไม่เทียบชื่อ · มัธยมกรองภาคเรียน (sem 0 = ทั้งปี ใช้ได้ทุกภาค)
 * คืน [{ code, name, perWeek, color, type, level }] เรียงตามชั้นที่ส่งมา ไม่มีรหัสซ้ำ · อนุบาลไม่มีในหลักสูตร → ไม่มีรายการ
 */
export function subjectsForLevels(curriculum, levels, sem) {
  const out = [], seen = new Set();
  const lvs = [...new Set((levels || []).map(levelKey).filter(Boolean))];
  for (const level of lvs) {
    for (const l of curriculum?.levels || []) {
      if (sem && l.sem && l.sem !== sem) continue;
      for (const s of l.subjects || []) {
        const code = String(s.code || '').trim();
        if (!code || seen.has(code) || !codeFitsLevel(code, level)) continue;
        seen.add(code);
        out.push({ ...s, code, level });
      }
    }
  }
  return out;
}

// ---------- โครงคาบ ----------
const hhmm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const posInt = (v, def, max) => { const n = Math.floor(+v); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def; };

/**
 * โครงคาบจากเวลาเริ่ม: count คาบ คาบละ minutes นาที พักหลังคาบที่ breakAfter นาน breakMinutes นาที
 * breakAfter = 0 (หรือ ≥ count) = ไม่มีพัก · คืน [{ label, start, end, type }] รูปแบบเดียวกับ term.periods
 * ประถม: buildPeriods({ start: '08:30', minutes: 60, count: 6, breakAfter: 3 }) → 6 คาบ + พักกลางวัน 11:30–12:30
 */
export function buildPeriods({ start = '08:30', minutes = 60, count = 6, breakAfter = 0, breakMinutes = 60 } = {}) {
  count = posInt(count, 6, 19); // ไม่เกิน 20 แถวรวมพัก (validate_term_doc)
  minutes = posInt(minutes, 60, 300);
  const brk = Math.floor(+breakAfter) || 0;
  const brkMin = posInt(breakMinutes, 0, 300);
  let t = toMin(start) ?? 510;
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push({ label: String(i), start: hhmm(t), end: hhmm(t + minutes), type: 'class' });
    t += minutes;
    if (i === brk && i < count && brkMin) { out.push({ label: 'พักกลางวัน', start: hhmm(t), end: hhmm(t + brkMin), type: 'break' }); t += brkMin; }
  }
  return out;
}

/**
 * คำนวณเวลาใหม่ของโครงคาบเดิม (ปุ่ม "คำนวณเวลาใหม่จากคาบแรก"): คงชื่อ/ชนิด/ลำดับ เปลี่ยนแค่เวลาเรียงต่อกัน
 * คาบเรียนยาว minutes นาที · ช่องพักคงความยาวเดิมถ้าอ่านได้ ไม่งั้น breakMinutes · start ไม่ส่ง = เวลาเริ่มคาบแรกเดิม
 */
export function retimePeriods(periods, { start, minutes = 60, breakMinutes = 60 } = {}) {
  minutes = posInt(minutes, 60, 300);
  let t = toMin(start) ?? toMin(periods[0]?.start) ?? 510;
  return periods.map((p) => {
    const old = toMin(p.end) - toMin(p.start);
    const len = p.type === 'break' ? (old > 0 && old < 300 ? old : posInt(breakMinutes, 60, 300)) : minutes;
    const r = { ...p, start: hhmm(t), end: hhmm(t + len) };
    t += len;
    return r;
  });
}

// ---------- กลุ่มสาระ ----------
/** รหัสกลุ่มสาระ (ตกลงร่วมกับ import.js · store.sanitize ใช้เป็น whitelist ของ teacher.subjects) */
export const SUBJECT_GROUP_CODES = ['TH', 'MA', 'SC', 'SO', 'HE', 'AR', 'OC', 'FL', 'EC', 'GU'];
export const SUBJECT_GROUP_NAMES = {
  TH: 'ภาษาไทย', MA: 'คณิตศาสตร์', SC: 'วิทยาศาสตร์และเทคโนโลยี', SO: 'สังคมศึกษา', HE: 'สุขศึกษาและพลศึกษา',
  AR: 'ศิลปะ', OC: 'การงานอาชีพ', FL: 'ภาษาต่างประเทศ', EC: 'ปฐมวัย', GU: 'แนะแนว',
};
// พจนานุกรมคำไทย เรียงจากเฉพาะไปกว้าง ตัวแรกที่ตรงชนะ ("ดนตรีไทย" = ศิลปะ เพราะ "ไทย" อยู่ท้ายสุด)
const GROUP_WORDS = [
  [/ภาษาไทย/, 'TH'],
  [/แนะแนว/, 'GU'],
  [/ปฐมวัย|อนุบาล/, 'EC'],
  [/อังกฤษ|ต่างประเทศ|จีน|ญี่ปุ่น|เกาหลี|ฝรั่งเศส|เยอรมัน|english/, 'FL'],
  [/คณิต|math/, 'MA'],
  [/วิทย|เทคโน|คำนวณ|คอมพิวเตอร์|ฟิสิกส์|เคมี|science/, 'SC'],
  [/สุข|พละ|พลศึกษา|กีฬา/, 'HE'],
  [/ศิลป|ดนตรี|นาฏ/, 'AR'],
  [/การงาน|อาชีพ|เกษตร|คหกรรม/, 'OC'],
  [/สังคม|ประวัติ|พระพุทธ|ศาสนา|ศีลธรรม|หน้าที่พลเมือง|ภูมิศาสตร์/, 'SO'],
  [/ไทย/, 'TH'],
];
/** กลุ่มสาระจากข้อความ (ชื่อวิชา/วิชาเอก): "คณิต" "วิทย์" "สุข-พละ" → รหัสกลุ่ม · ไม่รู้จัก → null */
export function groupFromText(str) {
  const s = String(str || '').replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  for (const [re, g] of GROUP_WORDS) if (re.test(s)) return g;
  return null;
}
const CODE_GROUP = { ท: 'TH', ค: 'MA', ว: 'SC', ส: 'SO', พ: 'HE', ศ: 'AR', ง: 'OC', อ: 'FL', จ: 'FL', ญ: 'FL', ฝ: 'FL' };
/** กลุ่มสาระของวิชา: อักษรแรกของรหัสมาตรฐาน (ท21101 → TH) ก่อน · ไม่มีรหัส/อักษรนอกตาราง → เดาจากชื่อ */
export function subjectGroupOf(subject) {
  const m = /^\s*([ก-ฮ])\d/.exec(String(subject?.code || ''));
  return (m && CODE_GROUP[m[1]]) || groupFromText(subject?.name);
}

// ---------- เติมครูอัตโนมัติ ----------
/** คาบ/สัปดาห์รวมของครูแต่ละคน (แบ่งสอนนับแยกตามแถว) → Map teacherId → คาบ */
export function teacherLoad(doc) {
  const m = new Map();
  for (const a of doc.assignments) if (a.teacherId) m.set(a.teacherId, (m.get(a.teacherId) || 0) + (a.perWeek || 0));
  return m;
}
const isPrimary = (lv) => lv[0] === 'ป' || lv[0] === 'อ';
/** เพดานคาบ/สัปดาห์เริ่มต้น: โรงเรียนมัธยมล้วน 22 · มีห้องประถม/อนุบาล 25 */
export function defaultMaxPerWeek(doc) { return doc.classes.some((c) => isPrimary(levelKey(c.level || c.name))) ? 25 : 22; }
/** ค่าเริ่มต้นของสวิตช์ในหน้าการสอน: ครูประจำชั้นสอนวิชาหลักเองเมื่อมีห้อง ป./อ. */
export function defaultAssignOpts(doc) {
  const primary = doc.classes.some((c) => isPrimary(levelKey(c.level || c.name)));
  return { homeroomTeachesCore: primary, maxPerWeek: primary ? 25 : 22 };
}
// กลุ่มที่ครูประจำชั้นสอนเองได้ (FL เฉพาะเมื่อไม่มีครูภาษาต่างประเทศ) · ปฐมวัย/แนะแนวครูประจำชั้นสอนเองเป็นปกติ
const HOME_GROUPS = new Set(['TH', 'MA', 'SC', 'SO', 'HE', 'AR', 'OC', 'EC', 'GU']);

/** สถานะระหว่างเติม: ภาระที่นับรวมแถวที่เพิ่งเติม เพื่อให้แถวถัดไปเห็นทันที */
function planner(doc, opts = {}) {
  const def = defaultAssignOpts(doc);
  const cls = new Map(doc.classes.map((c) => [c.id, c]));
  const home = new Map();
  for (const t of doc.teachers) if (typeof t.homeroom === 'string' && cls.has(t.homeroom) && !home.has(t.homeroom)) home.set(t.homeroom, t);
  const groupsOf = (t) => (Array.isArray(t.subjects) ? t.subjects : []);
  return {
    doc, cls, home, groupsOf,
    subj: byId(doc),
    tch: new Map(doc.teachers.map((t) => [t.id, t])),
    load: teacherLoad(doc),
    assigned: new Map(), // assignmentId → teacherId ที่เพิ่งเติม (ยังไม่ลง doc)
    core: opts.homeroomTeachesCore ?? def.homeroomTeachesCore,
    max: opts.maxPerWeek > 0 ? +opts.maxPerWeek : def.maxPerWeek,
    hasFL: doc.teachers.some((t) => groupsOf(t).includes('FL')),
  };
}

/**
 * ครูที่เหมาะกับแถว a (ยังไม่ต้องอยู่ใน doc) ตามลำดับ · ไม่นับครู exclude · ทุกข้อต้องไม่เกินเพดาน
 * 1. วิชารหัสเดียวกันของห้องอื่นชั้นเดียวกันที่มีครูแล้ว → ครูคนนั้น
 * 2. ครูที่มีกลุ่มสาระของวิชา → คนภาระน้อยสุด (เท่ากัน → ลำดับในรายชื่อ)
 * 3. เปิดสวิตช์ครูประจำชั้น + ห้องมีครูประจำชั้น + เป็นวิชาหลัก → ครูประจำชั้น
 * ห้อง ป./อ. ที่ข้อ 3 ใช้ได้ ข้อ 1-2 ไม่ดึงครูประจำชั้นของห้องอื่นมา (ไม่งั้นครูประจำชั้น ป.1 ที่จบไทยได้ภาษาไทยทุกห้อง)
 * → { teacherId, rule, why } หรือ null
 */
function pickTeacher(c, a, exclude = null) {
  const s = c.subj.get(a.subjectId);
  const group = subjectGroupOf(s);
  const cl = c.cls.get(a.classId);
  const lv = levelKey(cl?.level || cl?.name);
  const homeT = c.home.get(a.classId);
  const homeOk = c.core && !!homeT && (HOME_GROUPS.has(group) || (group === 'FL' && !c.hasFL));
  const keepHome = homeOk && isPrimary(lv);
  const need = a.perWeek || 0;
  const ok = (t) => !!t && t.id !== exclude
    && (c.load.get(t.id) || 0) + need <= (t.maxPerWeek > 0 ? t.maxPerWeek : c.max)
    && !(keepHome && t.homeroom && t.homeroom !== a.classId && c.cls.has(t.homeroom));

  const code = String(s?.code || '').trim();
  if (lv) {
    for (const x of c.doc.assignments) {
      if (x.id === a.id || x.classId === a.classId) continue;
      if (code ? String(c.subj.get(x.subjectId)?.code || '').trim() !== code : x.subjectId !== a.subjectId) continue;
      const xc = c.cls.get(x.classId);
      if (levelKey(xc?.level || xc?.name) !== lv) continue;
      const t = c.tch.get(x.teacherId || c.assigned.get(x.id));
      if (ok(t)) return { teacherId: t.id, rule: 1, why: `ครูคนเดียวกับห้อง ${xc.name || ''}`.trim() };
    }
  }
  if (group) {
    let best = null;
    for (const t of c.doc.teachers) if (c.groupsOf(t).includes(group) && ok(t) && (!best || (c.load.get(t.id) || 0) < (c.load.get(best.id) || 0))) best = t;
    if (best) return { teacherId: best.id, rule: 2, why: `ครู${SUBJECT_GROUP_NAMES[group]} ภาระน้อยสุด` };
  }
  if (homeOk && ok(homeT)) return { teacherId: homeT.id, rule: 3, why: 'ครูประจำชั้น' };
  return null;
}

/**
 * เติมครูให้แถวที่ยังไม่มีครู (teacherId ว่าง) — ไม่ทับครูที่เลือกไว้ · ไม่แก้ doc (ใช้ applyAssign)
 * opts: { homeroomTeachesCore, maxPerWeek } ไม่ส่ง = defaultAssignOpts · teacher.maxPerWeek (ถ้ามี) ชนะเพดานรวม
 * ผลเหมือนเดิมทุกครั้งสำหรับ doc เดียวกัน (ไล่ตามลำดับแถว ไม่มีสุ่ม)
 * → { changes: [{ assignmentId, from, to, rule, why }], unresolved: [assignmentId] } · หาไม่ได้ = unresolved ไม่ใส่ครูคนแรกให้
 */
export function autoAssign(doc, opts = {}) {
  const c = planner(doc, opts);
  const changes = [], unresolved = [];
  const tch = new Set((doc.teachers || []).map((t) => t.id)); // ครูที่ถูกลบไปแล้ว = ยังไม่มีครู (นิยามเดียวกับ store.noTeacher)
  for (const a of doc.assignments) {
    if (a.teacherId && tch.has(a.teacherId)) continue;
    const g = pickTeacher(c, a);
    if (!g) { unresolved.push(a.id); continue; }
    changes.push({ assignmentId: a.id, from: a.teacherId ?? null, to: g.teacherId, rule: g.rule, why: g.why });
    c.assigned.set(a.id, g.teacherId);
    c.load.set(g.teacherId, (c.load.get(g.teacherId) || 0) + (a.perWeek || 0));
  }
  return { changes, unresolved };
}
/** ใส่ผล autoAssign ลง doc (เฉพาะแถวที่ยังว่างอยู่) → จำนวนแถวที่เติม */
export function applyAssign(doc, changes) {
  const m = new Map(doc.assignments.map((a) => [a.id, a]));
  const tch = new Set((doc.teachers || []).map((t) => t.id));
  let n = 0;
  for (const ch of changes) { const a = m.get(ch.assignmentId); if (a && (!a.teacherId || !tch.has(a.teacherId))) { a.teacherId = ch.to; n++; } }
  return n;
}
/** เลิกทำ applyAssign: คืนค่าเดิมเฉพาะแถวที่ยังเป็นครูที่เติมให้ (ผู้ใช้เปลี่ยนเองหลังจากนั้น = ไม่แตะ) */
export function undoAssign(doc, changes) {
  const m = new Map(doc.assignments.map((a) => [a.id, a]));
  let n = 0;
  for (const ch of changes) { const a = m.get(ch.assignmentId); if (a && a.teacherId === ch.to) { a.teacherId = ch.from; n++; } }
  return n;
}

/** ครูที่น่าจะสอนแถว a (แถวใหม่ที่ยังไม่อยู่ใน doc ก็ได้) ตามลำดับเดียวกับ autoAssign · ไม่พบ → null */
export function guessTeacher(doc, assignment, opts = {}) {
  return pickTeacher(planner(doc, opts), assignment)?.teacherId ?? null;
}

/**
 * ค่าเริ่มต้นของการสอนใหม่ในห้อง classId: วิชาของชั้นนี้ (ดูจากรหัส) ที่ห้องยังไม่มี + ครูตาม guessTeacher
 * วิชาไม่มีรหัสใช้ชื่อลงท้ายด้วยชั้น ("ภาษาไทย ป.1") · ไม่มีวิชาของชั้นนี้ → วิชาที่ไม่ระบุชั้น → วิชาแรกที่เหลือ
 * → { classId, subjectId, teacherId|null } · ห้องมีครบทุกวิชาแล้ว → null
 */
export function guessNew(doc, classId, opts = {}) {
  const cls = doc.classes.find((c) => c.id === classId);
  const used = new Set(doc.assignments.filter((a) => a.classId === classId).map((a) => a.subjectId));
  const free = doc.subjects.filter((s) => !used.has(s.id));
  const raw = (cls?.level || cls?.name || '').trim().split('/')[0];
  const lv = levelKey(raw);
  const fits = (s) => codeDigits(s.code) ? codeFitsLevel(s.code, lv) : !!raw && (s.name || '').trim().endsWith(' ' + raw);
  const subject = free.find(fits) || free.find((s) => !codeDigits(s.code)) || free[0];
  if (!subject) return null;
  const row = { id: null, classId, subjectId: subject.id, perWeek: subject.perWeek > 0 ? subject.perWeek : 1 };
  return { classId, subjectId: subject.id, teacherId: guessTeacher(doc, row, opts) };
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

/**
 * ครูคนที่สองที่เหมาะจะแบ่งสอน: ลำดับเดียวกับ autoAssign (ไม่นับคนเดิม) ก่อน
 * ไม่พบ → ครูที่สอนห้องนี้อยู่แล้ว (ไม่ใช่คนเดิม) แล้วค่อยครูคนแรกที่ไม่ใช่คนเดิม (แบ่งสอนต้องมีครูเสมอ)
 */
function otherTeacher(doc, a, perWeek) {
  const g = pickTeacher(planner(doc), { ...a, perWeek }, a.teacherId);
  if (g) return g.teacherId;
  const count = new Map();
  for (const x of doc.assignments) if (x.classId === a.classId && x.teacherId !== a.teacherId) count.set(x.teacherId, (count.get(x.teacherId) || 0) + 1);
  const known = new Set(doc.teachers.map((t) => t.id));
  const top = [...count].filter(([id]) => known.has(id)).sort((x, y) => y[1] - x[1])[0]?.[0];
  return top || doc.teachers.find((t) => t.id !== a.teacherId)?.id || a.teacherId;
}

/**
 * แบ่งสอน: แยกแถว a เป็น 2 แถวที่ผูกกัน (split = id กลุ่ม) คาบรวมเท่าเดิม (5 → 3+2)
 * คาบที่วางไว้แล้วอยู่กับแถวเดิม ส่วนที่เกินคาบใหม่ของแถวเดิมถูกนำออก (เก็บคาบปักหมุดไว้ก่อน) · คืนแถวใหม่
 * perWeek < 2 แบ่งไม่ได้ (คาบรวมต้องเท่าเดิม) → คืน null และไม่แก้เอกสาร
 */
export function splitAssignment(doc, a, newId) {
  const n = Math.floor(Number(a.perWeek) || 0);
  if (n < 2) return null;
  const group = a.split || a.id;
  const keep = Math.ceil(n / 2), give = n - keep;
  a.split = group;
  a.perWeek = keep;
  if ((a.doubles || 0) * 2 > keep) a.doubles = Math.floor(keep / 2);
  const pinned = (p) => p.pinned === true || p.pinned === 1 || p.pinned === '1';
  const mine = doc.placements.filter((p) => p.assignmentId === a.id);
  if (mine.length > keep) {
    const order = [...mine.filter(pinned), ...mine.filter((p) => !pinned(p))];   // stable: หมุดก่อน ตามลำดับเดิม
    const drop = new Set(order.slice(keep));
    doc.placements = doc.placements.filter((p) => !drop.has(p));
  }
  const b = { id: newId, subjectId: a.subjectId, classId: a.classId, teacherId: otherTeacher(doc, a, give),roomId: a.roomId ?? null, perWeek: give, doubles: 0, split: group };
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
