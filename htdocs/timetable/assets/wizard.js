// ตัวช่วยเริ่มต้น 4 คำถามบนหน้าเดียว — เปิดเองเฉพาะภาคเรียนที่ยังว่าง (ไม่มีห้อง ครู และการสอน)
// 1 ชั้นที่เปิดสอน · 2 ห้องต่อชั้น (+ สอนคละชั้น → ห้องเดียวชื่อ "ป.1-2") · 3 เวลาเรียน (buildPeriods) · 4 กิจกรรมประจำ (คาบล็อก)
// → ห้อง + โครงคาบ + คาบล็อก + รายวิชาตามหลักสูตร (จับด้วยรหัสวิชา ไม่เทียบชื่อ) + การสอนร่าง teacherId = null
//   ทั้งหมดใน store.commit('wizard') ครั้งเดียว และเลิกทำได้จาก toast
// ส่วนคำนวณ (planSetup / applySetup / undoSetup / inferPeriods) เป็นฟังก์ชันล้วน ทดสอบใน node ได้ · หน้าจอใช้ <dialog> แบบ curriculum.js
import { store, uid, esc, DAY_NAMES } from './store.js';
import { buildPeriods, subjectsForLevels, termSem, levelKey } from './rules.js';
import * as notify from './notify.js';

export const LEVELS = ['อ.1', 'อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6', 'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
const BANDS = [['อ', 'อนุบาล'], ['ป', 'ประถม'], ['ม', 'มัธยม']];
const range = (pre, a, b) => LEVELS.filter((l) => l[0] === pre && +l[2] >= a && +l[2] <= b);
const PRESETS = [
  ['ประถม ป.1–6', range('ป', 1, 6)],
  ['ขยายโอกาส ป.1–ม.3', [...range('ป', 1, 6), ...range('ม', 1, 3)]],
  ['มัธยม ม.1–6', range('ม', 1, 6)],
];
// เวลาเรียนเริ่มต้นตามชั้น: มีประถม/อนุบาล = 60 นาที 6 คาบ พักหลังคาบ 3 · มัธยมล้วน = 50 นาที 8 คาบ พักหลังคาบ 4
const TIME_PRIMARY = { minutes: 60, count: 6, breakAfter: 3 };
const TIME_SECONDARY = { minutes: 50, count: 8, breakAfter: 4 };
// ตารางว่างจาก lib/terms.php (8 คาบ × 50 นาที) — เจอแบบนี้ถือว่ายังไม่ได้ตั้งเอง ให้เปลี่ยนตามชั้นที่เลือก
const BLANK_TIME = { start: '08:30', minutes: 50, count: 8, breakAfter: 4, breakMinutes: 60 };

export function timeDefaults(levels) {
  const lv = [...levels];
  return { start: '08:30', breakMinutes: 60, ...(!lv.length || lv.some((l) => l[0] !== 'ม') ? TIME_PRIMARY : TIME_SECONDARY) };
}

// ---------- กิจกรรมประจำ (คาบล็อก) ----------
// day: -1 = ทุกวัน · period: 0 = คาบสุดท้าย, -1 = คาบแรกที่เริ่มตั้งแต่ 14:00, n = คาบที่ n (นับเฉพาะคาบเรียน)
// perRoom: ล็อกรายห้องเสมอ (ผูกกับชั้น) · whole: ล็อกทั้งโรงเรียน · อื่น ๆ = ทุกห้องเข้าเกณฑ์ → classId null ไม่งั้นรายห้อง
const ALL = -1, LAST = 0, AFTER14 = -1;
const isPM = (lv) => lv[0] === 'ป' || lv[0] === 'ม';
export const ACTS = [
  { key: 'scout', label: 'ลูกเสือ-เนตรนารี', note: 'ป.1–ม.3', fits: (lv) => lv[0] === 'ป' || ['ม.1', 'ม.2', 'ม.3'].includes(lv), perRoom: true, day: 2, period: LAST, on: true },
  { key: 'guidance', label: 'แนะแนว', note: 'ทุกห้อง 1 คาบ', fits: isPM, day: 3, period: LAST, on: true },
  { key: 'club', label: 'ชุมนุม', note: '1 คาบ', fits: isPM, day: 4, period: LAST, on: true },
  { key: 'less', label: 'ลดเวลาเรียน เพิ่มเวลารู้', note: 'ตั้งแต่คาบที่เลือกถึงคาบสุดท้าย', fits: isPM, day: ALL, period: AFTER14, span: true, on: false },
  { key: 'plc', label: 'ประชุมครู / PLC', note: 'ล็อกทั้งโรงเรียน', fits: () => true, whole: true, day: 1, period: LAST, on: false },
  { key: 'homeroom', label: 'โฮมรูมเช้า', note: 'ทุกห้อง', fits: () => true, day: ALL, period: 1, on: false },
];

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const int = (v, def, lo, hi) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const comboName = ([a, b]) => `${a}-${b.slice(2)}`; // ['ป.1','ป.2'] → 'ป.1-2'

/** ภาคเรียนว่าง = ไม่มีห้อง ครู และการสอน (ตัวช่วยเปิดได้เฉพาะแบบนี้ — ไม่เขียนทับข้อมูลเดิมในทุกกรณี) */
export const isBlank = (d) => !!d && !d.classes?.length && !d.teachers?.length && !d.assignments?.length;

/** ค่าที่สร้างโครงคาบเดิมได้ตรงทุกช่องด้วย buildPeriods → { start, minutes, count, breakAfter, breakMinutes } · ไม่ตรง = null */
export function inferPeriods(periods) {
  const cls = (periods || []).filter((p) => p.type !== 'break');
  if (!cls.length) return null;
  const len = (p) => toMin(p.end) - toMin(p.start);
  const bi = periods.findIndex((p) => p.type === 'break');
  const params = { start: cls[0].start, minutes: len(cls[0]), count: cls.length, breakAfter: bi < 0 ? 0 : periods.slice(0, bi).filter((p) => p.type !== 'break').length, breakMinutes: bi < 0 ? 60 : len(periods[bi]) };
  if (!(params.minutes > 0)) return null;
  const re = buildPeriods(params);
  const same = re.length === periods.length && re.every((r, i) => r.start === periods[i].start && r.end === periods[i].end && r.type === (periods[i].type === 'break' ? 'break' : 'class'));
  return same ? params : null;
}

/** เลขช่องใน term.periods ของกิจกรรม (period ตามรหัสด้านบน · span = ถึงคาบสุดท้าย) */
function slotPeriods(periods, sel, span) {
  const cls = periods.map((p, i) => (p.type === 'break' ? -1 : i)).filter((i) => i >= 0);
  if (!cls.length) return [];
  let k = cls.length - 1;
  if (sel === AFTER14) { const j = cls.findIndex((i) => (toMin(periods[i].start) ?? 0) >= 14 * 60); if (j >= 0) k = j; }
  else if (sel > 0) k = Math.min(sel, cls.length) - 1;
  return span ? cls.slice(k) : [cls[k]];
}

/**
 * แผนข้อมูลเริ่มต้นจากคำตอบ (ไม่แก้ doc) — ใช้ทั้งพรีวิวและตอนกดสร้าง
 * ans: { levels[], perLevel, rooms?{ชั้น: n}, combine?[[ชั้น,ชั้น]], keepPeriods?, start, minutes, count, breakAfter, breakMinutes, days, acts[{key,on,day,period}] }
 * cur: data/curriculum.json · คืน { classes, periods, days, subjects (ที่ต้องเพิ่ม), reused, assignments, locks (ทั้งชุดหลังสร้าง), dropped, warnings[], setup }
 */
export function planSetup(ans, cur, doc) {
  const levels = LEVELS.filter((l) => (ans.levels || []).includes(l));
  // คละชั้น: คู่ที่เลือกทั้งสองชั้น ไม่ซ้อนกัน → ห้องเดียว ใช้ level ชั้นแรก (ทางลัดจนกว่าจะมี classIds[] ในรุ่น 3)
  const used = new Set(), pairs = [];
  for (const [a, b] of ans.combine || []) {
    if (a === b || !levels.includes(a) || !levels.includes(b) || used.has(a) || used.has(b)) continue;
    pairs.push(LEVELS.indexOf(a) < LEVELS.indexOf(b) ? [a, b] : [b, a]); used.add(a); used.add(b);
  }
  const classes = [];
  for (const lv of levels) {
    const p = pairs.find(([a]) => a === lv);
    if (p) { classes.push({ id: uid('c'), name: comboName(p), level: lv }); continue; }
    if (used.has(lv)) continue;
    const n = int(ans.rooms?.[lv] ?? ans.perLevel, 1, 1, 20);
    for (let i = 1; i <= n; i++) classes.push({ id: uid('c'), name: n === 1 ? lv : `${lv}/${i}`, level: lv });
  }

  const days = int(ans.days, doc.term.days || 5, 1, 7);
  const periods = ans.keepPeriods ? doc.term.periods.map((p) => ({ ...p }))
    : buildPeriods({ start: ans.start, minutes: ans.minutes, count: ans.count, breakAfter: ans.breakAfter, breakMinutes: ans.breakMinutes });

  // รายวิชาตามหลักสูตรของชั้นที่มีห้อง (ห้องคละชั้นใช้ชั้นแรก) · วิชาที่มีรหัสอยู่แล้วใช้ตัวเดิม ไม่สร้างซ้ำ
  const have = new Map(doc.subjects.filter((s) => s.code).map((s) => [String(s.code).trim(), s]));
  const list = subjectsForLevels(cur, [...new Set(classes.map((c) => c.level))], termSem(doc.term.name));
  const subjects = [], idOf = new Map();
  let reused = 0;
  for (const s of list) {
    const old = have.get(s.code);
    if (old) { idOf.set(s.code, old); reused++; continue; }
    const row = { id: uid('s'), code: s.code, name: s.name, color: s.color, perWeek: s.perWeek > 0 ? s.perWeek : null };
    subjects.push(row); idOf.set(s.code, row);
  }
  const assignments = [];
  for (const c of classes) {
    const lv = levelKey(c.level);
    for (const s of list) {
      if (s.level !== lv) continue;
      const subj = idOf.get(s.code);
      assignments.push({ id: uid('a'), subjectId: subj.id, classId: c.id, teacherId: null, roomId: null, perWeek: subj.perWeek > 0 ? subj.perWeek : s.perWeek > 0 ? s.perWeek : 1, doubles: 0 });
    }
  }

  // คาบล็อก: โครงคาบเดิม → เก็บของเดิมไว้ · สร้างโครงคาบใหม่ → ของเดิมชี้ช่องผิดแล้ว จึงล้าง (บอกในพรีวิว)
  const keep = ans.keepPeriods ? doc.locks.filter((l) => l.day < days && periods[l.period]?.type === 'class').map((l) => ({ ...l })) : [];
  const dropped = doc.locks.length - keep.length;
  const locks = [...keep];
  const taken = (cid, day, period) => locks.some((l) => l.day === day && l.period === period && ((l.classId ?? null) === null || l.classId === cid));
  const actsOn = [];
  for (const a of ans.acts || []) {
    const def = ACTS.find((x) => x.key === a.key);
    if (!def || !a.on) continue;
    const rooms = classes.filter((c) => def.fits(levelKey(c.level)));
    if (!rooms.length) continue;
    actsOn.push(def.key);
    const ids = def.whole || (!def.perRoom && rooms.length === classes.length) ? [null] : rooms.map((c) => c.id);
    const dayList = +a.day === ALL ? [...Array(days).keys()] : [int(a.day, 0, 0, days - 1)];
    for (const day of dayList) {
      for (const period of slotPeriods(periods, +a.period, def.span)) {
        for (const cid of ids) if (!taken(cid, day, period)) locks.push({ classId: cid, day, period, label: def.label });
      }
    }
  }

  // ความจุรายห้อง: คาบที่ต้องเรียน (ตามหลักสูตร) เทียบช่องว่างหลังหักคาบล็อก
  const slots = days * periods.filter((p) => p.type !== 'break').length;
  const warnings = [];
  for (const c of classes) {
    const need = assignments.filter((x) => x.classId === c.id).reduce((n, x) => n + x.perWeek, 0);
    const blocked = new Set(locks.filter((l) => (l.classId ?? null) === null || l.classId === c.id).map((l) => l.day + ':' + l.period)).size;
    if (need > slots - blocked) warnings.push(`${c.name} ต้องเรียน ${need} คาบ/สัปดาห์ แต่มีช่องว่าง ${slots - blocked} ช่อง (ช่องเรียน ${slots} หักคาบล็อก ${blocked}) — เพิ่มคาบ/วัน หรือลดกิจกรรม`);
  }

  const setup = {
    wizardAt: Date.now(), levels, perLevel: int(ans.perLevel, 1, 1, 20), combined: pairs.map(comboName), acts: actsOn,
    periodCount: periods.filter((p) => p.type !== 'break').length, periodMinutes: ans.keepPeriods ? 0 : int(ans.minutes, 60, 1, 300), days,
  };
  return { classes, periods, days, subjects, reused, assignments, locks, dropped, warnings, setup };
}

/** ลงแผนในเอกสาร (แก้ในอาร์เรย์เดิม — หน้าจอถืออ้างอิงไว้) · คืนฉบับก่อนแก้สำหรับ undoSetup */
export function applySetup(doc, plan) {
  const before = JSON.parse(JSON.stringify({ term: doc.term, classes: doc.classes, subjects: doc.subjects, assignments: doc.assignments, locks: doc.locks, placements: doc.placements, meta: doc.meta ?? null }));
  doc.term.days = plan.days;
  doc.term.periods.splice(0, doc.term.periods.length, ...plan.periods);
  doc.classes.push(...plan.classes);
  doc.subjects.push(...plan.subjects);
  doc.assignments.push(...plan.assignments);
  doc.locks.splice(0, doc.locks.length, ...plan.locks);
  doc.placements.length = 0; // ภาคเรียนว่างไม่มีการสอน จึงไม่มีคาบที่วางไว้ได้อยู่แล้ว
  if (!doc.meta || typeof doc.meta !== 'object' || Array.isArray(doc.meta)) doc.meta = {};
  doc.meta.setup = { ...(doc.meta.setup && typeof doc.meta.setup === 'object' ? doc.meta.setup : {}), ...plan.setup };
  return before;
}

/** คืนเอกสารเป็นฉบับก่อนกดสร้าง */
export function undoSetup(doc, before) {
  for (const k of Object.keys(doc.term)) delete doc.term[k];
  Object.assign(doc.term, before.term);
  for (const k of ['classes', 'subjects', 'assignments', 'locks', 'placements']) doc[k].splice(0, doc[k].length, ...before[k]);
  if (before.meta) doc.meta = before.meta; else delete doc.meta;
}

// ---------- หน้าจอ ----------
let cache = null;
// ไฟล์เดียวกับ curriculum.js (แคชเบราว์เซอร์ 1 วัน โหลดครั้งเดียว)
const loadCurriculum = () => (cache ??= fetch('data/curriculum.json').then((r) => { if (!r.ok) throw new Error('โหลดรายวิชาไม่สำเร็จ'); return r.json(); })
  .catch((e) => { cache = null; throw e; }));

const SKIP_KEY = (id) => 'tt:wizard-skip:' + id;
const skipped = (id) => { try { return localStorage.getItem(SKIP_KEY(id)) === '1'; } catch { return false; } };
const setSkip = (id, on) => { try { on ? localStorage.setItem(SKIP_KEY(id), '1') : localStorage.removeItem(SKIP_KEY(id)); } catch { /* ไม่เป็นไร */ } };
let opened = null;

/** เรียกหลังโหลดภาคเรียน: เปิดเองเมื่อภาคเรียนว่างและผู้ใช้ยังไม่กด "ไว้ทีหลัง" ของภาคเรียนนี้ */
export function maybeOpen() {
  if (isBlank(store.doc) && !skipped(store.termId)) open({ auto: true });
}

export async function open({ auto = false } = {}) {
  if (opened) return;
  const doc = store.doc, termId = store.termId;
  if (!isBlank(doc)) { if (!auto) notify.info('ตัวช่วยเริ่มต้นใช้ได้กับภาคเรียนที่ยังไม่มีห้อง ครู และการสอนเท่านั้น'); return; }
  opened = true;
  let cur;
  try { cur = await loadCurriculum(); } catch (e) { opened = null; notify.error(e.message); return; }
  if (store.doc !== doc || !isBlank(doc)) { opened = null; return; } // สลับภาคเรียน/มีข้อมูลเข้ามาระหว่างโหลด

  // ค่าเริ่มต้นของเวลาเรียน: โครงคาบเดิมที่ตั้งเอง (ไม่ใช่ตารางว่าง 8×50) ใช้ต่อ · สร้างด้วย buildPeriods ไม่ได้ = ถามว่าคงไว้ไหม
  const inferred = inferPeriods(doc.term.periods);
  const blankTime = !inferred || Object.keys(BLANK_TIME).every((k) => inferred[k] === BLANK_TIME[k]);
  const st = {
    levels: new Set(), perLevel: 1, custom: false, rooms: {}, combineOn: false, combine: [],
    time: { ...timeDefaults([]), ...(inferred && !blankTime ? inferred : {}) }, days: doc.term.days || 5,
    timeTouched: !!inferred && !blankTime,
    keepOffer: !inferred && doc.term.periods.length > 0, keepPeriods: !inferred && doc.term.periods.length > 0,
    acts: Object.fromEntries(ACTS.map((a) => [a.key, { on: a.on, day: a.day, period: a.period, touched: false }])),
  };
  const answers = () => ({
    levels: [...st.levels], perLevel: st.perLevel, rooms: st.custom ? st.rooms : undefined,
    combine: st.combineOn ? st.combine.map((k) => k.split('|')) : [], keepPeriods: st.keepPeriods, ...st.time, days: st.days,
    acts: ACTS.map((a) => ({ key: a.key, ...st.acts[a.key] })),
  });
  const periodsNow = () => (st.keepPeriods ? doc.term.periods : buildPeriods(st.time));

  css();
  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg wz';
  dlg.setAttribute('aria-labelledby', 'wz-title');
  document.body.appendChild(dlg);
  const q = (n, title, body) => `<section class="wz-q"><h4><span class="wz-n" aria-hidden="true">${n}</span>${title}</h4>${body}</section>`;
  const num = (id, val, lo, hi, label, attr = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" type="number" inputmode="numeric" id="${id}" min="${lo}" max="${hi}" value="${esc(val)}" ${attr}></div>`;
  dlg.innerHTML = `<form method="dialog">
    <div class="wz-head">
      <div style="flex:1;min-width:0"><h3 id="wz-title" style="font-size:1.15rem">เริ่มต้นใน 4 คำถาม</h3>
        <p class="hint" style="margin:2px 0 0">ตอบแล้วระบบสร้างห้องเรียน โครงคาบ คาบล็อก รายวิชาตามหลักสูตร และการสอนทุกวิชาให้เลย เหลือแค่เพิ่มครู · แก้ทุกอย่างได้ภายหลัง</p></div>
      <img src="assets/mascot/boon-point-420.webp" width="420" height="630" alt="" loading="lazy" decoding="async" data-wz-img>
    </div>
    ${q(1, 'ชั้นที่เปิดสอน', `<div class="wz-chips" role="group" aria-label="ทางลัด">${PRESETS.map(([t], i) => `<button type="button" class="btn btn-sm" data-preset="${i}">${t}</button>`).join('')}</div>
      ${BANDS.map(([pre, name]) => `<div class="wz-band"><span class="hint">${name}</span><div class="wz-chips">${LEVELS.filter((l) => l[0] === pre).map((l) => `<label><input type="checkbox" data-lv="${l}">${l}</label>`).join('')}</div></div>`).join('')}`)}
    ${q(2, 'ห้องต่อชั้น', '<div data-rooms></div>')}
    ${q(3, 'เวลาเรียน', `${st.keepOffer ? `<label class="wz-check"><input type="checkbox" data-keep ${st.keepPeriods ? 'checked' : ''}> ใช้โครงคาบเดิมที่ตั้งไว้ (${doc.term.periods.filter((p) => p.type !== 'break').length} คาบ/วัน)</label>` : ''}
      <div class="wz-grid" data-time>
        <div class="field"><label for="wz-start">เริ่มคาบแรก</label><input class="input mono" type="time" id="wz-start" data-t="start" value="${esc(st.time.start)}"></div>
        ${num('wz-min', st.time.minutes, 20, 120, 'นาที/คาบ', 'data-t="minutes"')}
        ${num('wz-count', st.time.count, 1, 12, 'คาบ/วัน', 'data-t="count"')}
        <div class="field"><label for="wz-brk">พักกลางวัน</label><select class="input" id="wz-brk" data-t="breakAfter"></select></div>
        ${num('wz-brkmin', st.time.breakMinutes, 10, 120, 'นาทีพัก', 'data-t="breakMinutes"')}
      </div>
      <div class="wz-grid"><div class="field"><label for="wz-days">วันเรียน/สัปดาห์</label><select class="input" id="wz-days">${[5, 6, 7].map((n) => `<option value="${n}" ${st.days === n ? 'selected' : ''}>${n} วัน (${DAY_NAMES[0]}–${DAY_NAMES[n - 1]})</option>`).join('')}</select></div></div>`)}
    ${q(4, 'กิจกรรมประจำ (คาบล็อก ห้ามจัดวิชาทับ)', `<div class="wz-acts">${ACTS.map((a) => `<div class="wz-act" data-act="${a.key}">
        <label><input type="checkbox" data-a="on"> <b>${a.label}</b> <span class="hint" data-note></span></label>
        <select class="input input-sm" data-a="day" aria-label="วันของ${a.label}"></select>
        <select class="input input-sm" data-a="period" aria-label="คาบของ${a.label}"></select></div>`).join('')}</div>`)}
    <section class="wz-prev" aria-live="polite" data-prev></section>
    <div class="wz-foot">
      <button class="btn" value="later" formnovalidate>ไว้ทีหลัง</button>
      <button class="btn btn-primary" value="ok" data-ok>สร้างข้อมูลเริ่มต้น</button>
    </div>
  </form>`;
  const $ = (s) => dlg.querySelector(s);
  // ยังไม่มีภาพมาสคอต → ไม่แสดงกรอบรูปแตก
  $('[data-wz-img]').addEventListener('error', (e) => e.currentTarget.remove(), { once: true });

  const drawRooms = () => {
    const lv = LEVELS.filter((l) => st.levels.has(l));
    // คู่คละชั้น: ชั้นติดกันในระดับเดียวกันที่เลือกทั้งคู่
    const pairs = lv.slice(1).map((b, i) => [lv[i], b]).filter(([a, b]) => a[0] === b[0] && +b[2] === +a[2] + 1);
    st.combine = st.combine.filter((k) => pairs.some((p) => p.join('|') === k));
    const inPair = new Set(st.combine.flatMap((k) => k.split('|')));
    $('[data-rooms]').innerHTML = !lv.length ? '<p class="hint" style="margin:0">เลือกชั้นในข้อ 1 ก่อน</p>' : `
      <div class="wz-grid">${num('wz-per', st.perLevel, 1, 20, 'ห้องต่อชั้น', `data-per ${st.custom ? 'disabled' : ''}`)}</div>
      <p class="hint" style="margin:0">1 ห้อง = ชื่อ “ป.1” · หลายห้อง = “ม.1/1, ม.1/2 …” <button type="button" class="wz-link" data-custom aria-expanded="${st.custom}">${st.custom ? 'ใช้จำนวนเดียวกันทุกชั้น' : 'กำหนดรายชั้น'}</button></p>
      ${st.custom ? `<div class="wz-grid">${lv.filter((l) => !inPair.has(l)).map((l) => num('wz-r-' + LEVELS.indexOf(l), st.rooms[l] ?? st.perLevel, 1, 20, l, `data-room="${l}"`)).join('')}</div>` : ''}
      ${pairs.length ? `<label class="wz-check"><input type="checkbox" data-combine-on ${st.combineOn ? 'checked' : ''}> สอนคละชั้น (โรงเรียนขนาดเล็ก: 2 ชั้นเรียนห้องเดียวกัน)</label>
        ${st.combineOn ? `<div class="wz-chips" role="group" aria-label="คู่ชั้นที่เรียนรวม">${pairs.map((p) => { const k = p.join('|'), on = st.combine.includes(k); return `<label><input type="checkbox" data-pair="${k}" ${on ? 'checked' : ''} ${!on && p.some((x) => inPair.has(x)) ? 'disabled' : ''}>${p.join('+')} → ${comboName(p)}</label>`; }).join('')}</div>
          <p class="hint" style="margin:0">ห้องคละชั้นได้ห้องเดียว ใช้รายวิชาของชั้นแรก (เช่น ป.1-2 ใช้วิชา ป.1) แก้วิชาเองได้ที่ ข้อมูล → การสอน</p>` : ''}` : ''}`;
  };
  const drawTime = () => {
    const off = st.keepPeriods;
    dlg.querySelectorAll('[data-time] input, [data-time] select').forEach((x) => { x.disabled = off; });
    for (const [k, v] of Object.entries(st.time)) { const el = dlg.querySelector(`[data-t="${k}"]`); if (el && el.tagName === 'INPUT' && document.activeElement !== el) el.value = v; }
    const brk = $('#wz-brk'), n = int(st.time.count, 6, 1, 12);
    brk.innerHTML = `<option value="0">ไม่มีพัก</option>` + [...Array(Math.max(0, n - 1)).keys()].map((i) => `<option value="${i + 1}">หลังคาบที่ ${i + 1}</option>`).join('');
    brk.value = String(Math.min(int(st.time.breakAfter, 0, 0, 19), n - 1) || 0);
  };
  const drawActs = () => {
    const ps = periodsNow();
    const cls = ps.map((p, i) => [p, i]).filter(([p]) => p.type !== 'break');
    const lv = [...st.levels];
    for (const a of ACTS) {
      const row = $(`[data-act="${a.key}"]`), s = st.acts[a.key];
      const fits = lv.some((l) => a.fits(l));
      if (!s.touched) s.on = a.on && fits;
      row.querySelector('[data-a="on"]').checked = s.on;
      row.querySelector('[data-note]').textContent = '· ' + a.note + (lv.length && !fits ? ' (ไม่มีชั้นที่เข้าเกณฑ์)' : '');
      const day = row.querySelector('[data-a="day"]'), per = row.querySelector('[data-a="period"]');
      day.innerHTML = `<option value="-1">ทุกวัน</option>` + DAY_NAMES.slice(0, st.days).map((n, i) => `<option value="${i}">${n}</option>`).join('');
      if (+s.day >= st.days) s.day = st.days - 1;
      day.value = String(s.day);
      per.innerHTML = `<option value="0">${a.span ? 'ตั้งแต่' : ''}คาบสุดท้าย</option>` + (a.span ? '<option value="-1">ตั้งแต่ 14:00 เป็นต้นไป</option>' : '')
        + cls.map(([p], k) => `<option value="${k + 1}">${a.span ? 'ตั้งแต่' : ''}คาบ ${esc(p.label)} (${esc(p.start || '')})</option>`).join('');
      if (+s.period > cls.length) s.period = LAST;
      per.value = String(s.period);
      day.disabled = per.disabled = !s.on;
    }
  };
  const drawPrev = () => {
    const ans = answers();
    const ok = $('[data-ok]');
    if (!ans.levels.length) { $('[data-prev]').innerHTML = '<p class="hint" style="margin:0">เลือกชั้นที่เปิดสอนอย่างน้อย 1 ชั้น แล้วจะเห็นตัวอย่างข้อมูลที่จะสร้างตรงนี้</p>'; ok.disabled = true; return; }
    ok.disabled = false;
    const p = planSetup(ans, cur, doc);
    const names = p.classes.map((c) => c.name);
    const sem = termSem(doc.term.name);
    const hasSec = ans.levels.some((l) => l[0] === 'ม');
    $('[data-prev]').innerHTML = `<b>จะสร้างให้</b>
      <div class="wz-periods" aria-label="โครงคาบ">${p.periods.map((x) => `<span class="${x.type === 'break' ? 'b' : ''}">${esc(x.type === 'break' ? x.label : 'คาบ ' + x.label)} <small class="mono">${esc(x.start)}–${esc(x.end)}</small></span>`).join('')}</div>
      <ul style="margin:0;padding-left:20px;display:grid;gap:2px;font-size:.92rem">
        <li>ห้องเรียน <b>${p.classes.length}</b> ห้อง: ${esc(names.slice(0, 12).join(', '))}${names.length > 12 ? ` และอีก ${names.length - 12} ห้อง` : ''}</li>
        <li>เรียน ${p.days} วัน × ${p.setup.periodCount} คาบ = ${p.days * p.setup.periodCount} ช่อง/สัปดาห์ · คาบล็อก <b>${p.locks.length}</b> ช่อง${p.dropped ? ` <span class="hint">(คาบล็อกเดิม ${p.dropped} ช่องจะถูกล้าง เพราะโครงคาบเปลี่ยน)</span>` : ''}</li>
        <li>รายวิชาตามหลักสูตร <b>${p.subjects.length + p.reused}</b> วิชา${p.reused ? ` (มีอยู่แล้ว ${p.reused})` : ''}${hasSec ? ` · วิชามัธยมใช้ภาคเรียนที่ ${sem} ตามชื่อภาคเรียน` : ''}</li>
        <li>การสอนร่าง <b>${p.assignments.length}</b> แถว (ทุกวิชา × ทุกห้อง) — <b>ยังไม่มีครู</b> เพิ่มครูแล้วเติมได้ในขั้นต่อไป</li>
        ${p.assignments.length ? '' : '<li class="hint">ชั้นอนุบาลยังไม่มีรายวิชาตามหลักสูตรให้อัตโนมัติ เพิ่มวิชาเองได้ที่ ข้อมูล → วิชา</li>'}
      </ul>
      ${p.warnings.map((w) => `<div class="wz-warn" role="note"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="flex:none;margin-top:2px;color:var(--gold)"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 1 7h-2l1-7zm-1 9h2v2h-2v-2z"/></svg><span>${esc(w)}</span></div>`).join('')}`;
  };
  const levelsChanged = () => {
    dlg.querySelectorAll('[data-lv]').forEach((c) => { c.checked = st.levels.has(c.dataset.lv); });
    if (!st.timeTouched && !st.keepPeriods) st.time = { ...st.time, ...timeDefaults(st.levels) };
    drawRooms(); drawTime(); drawActs(); drawPrev();
  };

  // แก้ทีละส่วน ไม่วาดใหม่ทั้งกล่อง (ปุ่มที่กำลังคลิกจะไม่ถูกแทนที่กลางคลิก และช่องที่กำลังพิมพ์ไม่เสียโฟกัส)
  const onField = (e) => {
    const el = e.target;
    if (el.dataset.lv) { el.checked ? st.levels.add(el.dataset.lv) : st.levels.delete(el.dataset.lv); levelsChanged(); return; }
    if (el.matches('[data-per]')) { st.perLevel = int(el.value, 1, 1, 20); drawPrev(); return; }
    if (el.dataset.room) { st.rooms[el.dataset.room] = int(el.value, 1, 1, 20); drawPrev(); return; }
    if (el.matches('[data-combine-on]')) { st.combineOn = el.checked; drawRooms(); drawPrev(); return; }
    if (el.dataset.pair) { const k = el.dataset.pair; st.combine = el.checked ? [...st.combine, k] : st.combine.filter((x) => x !== k); drawRooms(); drawPrev(); return; }
    if (el.matches('[data-keep]')) { st.keepPeriods = el.checked; if (!el.checked && !st.timeTouched) st.time = { ...st.time, ...timeDefaults(st.levels) }; drawTime(); drawActs(); drawPrev(); return; }
    if (el.dataset.t) {
      const k = el.dataset.t;
      if (k === 'start') { if (!/^\d{1,2}:\d{2}$/.test(el.value)) return; st.time.start = el.value; }
      else st.time[k] = int(el.value, st.time[k], k === 'breakAfter' ? 0 : 1, k === 'count' ? 12 : 300);
      if (e.type === 'change' || k === 'breakAfter') st.timeTouched = true;
      if (k === 'count') drawTime();
      drawActs(); drawPrev(); return;
    }
    if (el.id === 'wz-days') { st.days = int(el.value, 5, 1, 7); drawActs(); drawPrev(); return; }
    const row = el.closest('[data-act]');
    if (row) {
      const s = st.acts[row.dataset.act];
      s.touched = true;
      if (el.dataset.a === 'on') s.on = el.checked; else s[el.dataset.a] = +el.value;
      row.querySelectorAll('select').forEach((x) => { x.disabled = !s.on; });
      drawPrev();
    }
  };
  dlg.addEventListener('change', onField);
  dlg.addEventListener('input', (e) => { if (e.target.matches('input[type=number], input[type=time]')) onField(e); });
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('button[type=button]');
    if (!b) return;
    if (b.dataset.preset != null) { st.levels = new Set(PRESETS[+b.dataset.preset][1]); levelsChanged(); }
    else if (b.matches('[data-custom]')) {
      st.custom = !st.custom;
      if (st.custom) for (const l of st.levels) st.rooms[l] ??= st.perLevel;
      drawRooms(); drawPrev();
    }
  });
  levelsChanged();
  dlg.showModal();
  $('[data-preset="0"]')?.focus(); // ทางลัดแรก (หัวกล่องอ่านได้ผ่าน aria-labelledby)

  dlg.addEventListener('close', () => {
    const v = dlg.returnValue;
    dlg.remove(); opened = null;
    if (store.termId !== termId || store.doc !== doc) return;
    if (v !== 'ok') { setSkip(termId, true); if (auto) notify.info('เปิดตัวช่วยได้อีกครั้งจากปุ่ม “เริ่มด้วยตัวช่วย” ใต้แถบเมนู', 5000); return; }
    if (!isBlank(doc) || !st.levels.size) return;
    const plan = planSetup(answers(), cur, doc);
    const before = applySetup(doc, plan);
    setSkip(termId, false);
    store.commit('wizard');
    document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'data', section: 'teachers' } }));
    notify.action(`สร้างห้อง ${plan.classes.length} ห้อง · วิชา ${plan.subjects.length + plan.reused} · การสอนร่าง ${plan.assignments.length} แถวแล้ว — ขั้นต่อไป: เพิ่มครู`, 'เลิกทำ', () => {
      if (store.doc !== doc) return;
      undoSetup(doc, before);
      store.commit('wizard');
      notify.info('เลิกทำแล้ว ภาคเรียนกลับเป็นเหมือนก่อนใช้ตัวช่วย');
    }, 12000);
  }, { once: true });
}

// สไตล์ของตัวช่วย (ใส่ครั้งเดียว · CSP อนุญาต style แบบ inline) — ใช้ตัวแปรสีของ app.css จึงรองรับโหมดมืดเอง · ไม่มีแถบสีขอบซ้าย
function css() {
  if (document.getElementById('wz-css')) return;
  const s = document.createElement('style');
  s.id = 'wz-css';
  s.textContent = `.wz{width:min(760px,calc(100vw - 24px));padding:0}
.wz form{display:grid;gap:12px;padding:18px}
.wz-head{display:flex;gap:12px;align-items:center}.wz-head img{width:64px;height:auto;flex:none}
.wz-q{border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:10px;min-width:0}
.wz-q>h4{display:flex;gap:8px;align-items:center;font-size:1rem;margin:0}
.wz-n{width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--bg);display:inline-grid;place-items:center;font-size:.8rem;flex:none}
.wz-band{display:grid;gap:4px}
.wz-chips{display:flex;flex-wrap:wrap;gap:6px}
.wz-chips label{border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer;font-size:.9rem;min-height:34px;display:inline-flex;align-items:center}
.wz-chips label:has(input:checked){border-color:var(--blue);background:var(--blue-soft)}
.wz-chips label:has(input:disabled){opacity:.45;cursor:default}
.wz-chips input{margin:0 4px 0 0}
.wz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}
.wz-check{display:flex;gap:6px;align-items:center;font-size:.92rem;cursor:pointer}
.wz-link{border:0;background:none;padding:0;color:var(--blue);text-decoration:underline;cursor:pointer;font:inherit}
.wz-act{display:grid;grid-template-columns:minmax(0,1fr) 120px 190px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.wz-act:first-child{border-top:0}.wz-act select:disabled{opacity:.5}
.wz-prev{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:8px}
.wz-periods{display:flex;flex-wrap:wrap;gap:4px}
.wz-periods span{border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:.8rem;background:var(--surface)}
.wz-periods span.b{background:var(--lock);color:var(--lock-ink)}
.wz-warn{background:var(--gold-soft);border:1px solid var(--gold-bg);border-radius:10px;padding:8px 10px;font-size:.88rem;display:flex;gap:8px}
.wz-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;position:sticky;bottom:0;background:var(--surface);padding:10px 0 2px;border-top:1px solid var(--line)}
@media (max-width:560px){.wz form{padding:14px}.wz-head img{display:none}.wz-act{grid-template-columns:1fr 1fr}.wz-act>label{grid-column:1/-1}}`;
  document.head.appendChild(s);
}
