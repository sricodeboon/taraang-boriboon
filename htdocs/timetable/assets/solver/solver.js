/**
 * solver.js — ตัวจัดตารางเรียนตารางสอนอัตโนมัติ (ตารางบริบูรณ์ · ศรีโค้ดบูรณ์)
 *
 * JavaScript ล้วน ไม่มี dependency ใช้ได้ทั้งในเบราว์เซอร์ (Web Worker / main thread) และ node >= 18
 *
 *   import { solve, validate, score } from './solver.js';
 *   const result = solve(input, { timeLimitMs: 4000, seed: 1, onProgress });
 *   const conflicts = validate(input, placements);   // ใช้ไฮไลต์ช่องชนตอนลากวาง
 *
 * รูปแบบ input ตาม "สัญญา Solver" ใน SPEC.md
 * (รับไฟล์รูปแบบ sample-school.json ตรง ๆ ได้ด้วย — ดู toSolverInput)
 *
 * ── อัลกอริทึม ────────────────────────────────────────────────────────────────
 * 1) แตกงานสอน (assignment) เป็น "หน่วย" (unit): คาบคู่ = หน่วยยาว 2, คาบเดี่ยว = หน่วยยาว 1
 *    คาบที่ปักหมุด (fixed) กลายเป็นหน่วยตายตัวที่ไม่ถูกย้าย
 *    ถ้าปักหมุดคาบคู่ไว้ครึ่งเดียว จะสร้างหน่วย "คู่หู" ที่ลงได้เฉพาะช่องติดกับหมุด
 *    ตรวจความจุล่วงหน้า (คาบรวมของห้อง/ครู/ห้องพิเศษ และช่องคาบคู่) → ถ้าพิสูจน์ได้ว่าจัดไม่ครบ
 *    จะไม่ทำ restart ซ้ำ (คืนผลเร็ว) และใช้เป็นเหตุผลใน unplaced
 * 2) คำนวณ "โดเมน" ของแต่ละหน่วย = ช่องเริ่มที่ถูกกฎเดี่ยว ๆ อยู่แล้ว
 *    (ไม่ใช่ช่องพัก ไม่ติดคาบล็อก ครูว่าง คู่คาบไม่คร่อมพัก/ไม่ล้นวัน)
 *    → ข้อจำกัดแข็งที่เหลือมีแค่ "ชนกัน" (ห้อง/ครู/ห้องพิเศษ) และ "ครูเกินวันละ N คาบ"
 * 3) Greedy แบบ most-constrained-first (คาบคู่ ห้องพิเศษ โดเมนแคบ ครูภาระมาก ก่อน)
 * 4) Tabu search แบบ min-conflicts: สุ่มหน่วยที่ยังชน แล้วเลือกการย้ายที่ดีที่สุด
 *    (ย้ายไปช่องอื่น หรือสลับกับหน่วยอื่นในห้องเดียวกัน) ต้นทุน = HARD×W + SOFT
 *    ติดหล่มนานเกิน → random restart (สร้าง greedy ใหม่ด้วยลำดับสุ่ม)
 * 5) เมื่อไม่มีชนแล้ว ขัดเกลา soft ด้วย Late Acceptance Hill Climbing (LAHC)
 *    โดยห้ามการย้ายที่ทำให้กลับมาชน
 * 6) ถ้าหมดเวลาแล้วยังชน: ถอดหน่วยที่ชนมากที่สุดออกทีละหน่วยจนไม่ชน → คืนเป็น unplaced พร้อมเหตุผล
 *
 * ทุกการสุ่มใช้ PRNG แบบมี seed (mulberry32) และเงื่อนไขหยุดนับเป็นจำนวนรอบ (ไม่ใช่เวลา)
 * ⇒ seed เดียวกัน + input เดียวกัน ได้ผลเหมือนเดิมทุกครั้ง (ยกเว้นกรณีโดนตัดด้วย timeLimitMs)
 */

// ─────────────────────────────────────────────────────────────────────────────
// ค่าคงที่ / น้ำหนัก
// ─────────────────────────────────────────────────────────────────────────────

/** น้ำหนักข้อจำกัดอ่อน (ยิ่งน้อยยิ่งดี) */
export const SOFT_WEIGHTS = Object.freeze({
  sameDay: 10,      // วิชาเดียวกันในห้องเดียว วันเดียวกันเกิน 1 ครั้ง (คู่คาบนับ 1) — ต่อครั้งที่เกิน
  adjacentDays: 2,  // วิชาเดียวกันเรียนวันติดกัน (เช่น จ.+อ.) — ต่อคู่วัน (ช่วยกระจายทั่วสัปดาห์)
  teacherGap: 1,    // คาบว่างแทรกของครู (ระหว่างคาบแรกกับคาบสุดท้ายของวัน ไม่นับช่องพัก) — ต่อคาบ
});

/** ประเภทข้อขัดแย้งแข็งที่ validate() คืนได้ */
export const CONFLICT_TYPES = Object.freeze(['class', 'teacher', 'room', 'lock', 'break', 'unavailable', 'maxPerDay', 'double']);

const W_HARD = 100000;     // น้ำหนักรวมของ hard 1 หน่วย (มากพอให้ soft ไม่มีทางกลบ)
const MAX_PERIODS = 30;    // ใช้ bitmask 32 บิตต่อวัน จึงรองรับได้ไม่เกิน 30 ช่องต่อวัน

const now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** PRNG แบบมี seed (mulberry32) — เร็วและกระจายดีพอสำหรับ local search */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
}

const arr = (v) => (Array.isArray(v) ? v : []);
const keyOf = (v) => (v === null || v === undefined || v === '' ? null : String(v));
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/** แปลงคู่ [day, period] หรือ {day, period} เป็น [d, p] */
function pairOf(x) {
  if (Array.isArray(x)) return [Number(x[0]), Number(x[1])];
  if (x && typeof x === 'object') return [Number(x.day), Number(x.period)];
  return [NaN, NaN];
}

// ─────────────────────────────────────────────────────────────────────────────
// แปลง input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * แปลงข้อมูลให้เป็นรูปแบบ input ของ solver
 * รับได้ทั้งรูปแบบสัญญา ({days, periods, ...}) และรูปแบบไฟล์ sample-school.json ({term:{days, periods}, ...})
 * ถ้าไม่มี fixed แต่มี placements ที่ pinned จะใช้เป็น fixed ให้
 */
export function toSolverInput(data) {
  if (!data || typeof data !== 'object') {
    return { days: 0, periods: [], classes: [], teachers: [], rooms: [], assignments: [], locks: [], fixed: [] };
  }
  const term = data.term && typeof data.term === 'object' ? data.term : {};
  const fixed = Array.isArray(data.fixed) ? data.fixed
    : arr(data.placements).filter((p) => p && (p.pinned === true || p.pinned === 1 || p.pinned === '1'));
  return {
    days: data.days ?? term.days,
    periods: data.periods ?? term.periods,
    classes: arr(data.classes),
    teachers: arr(data.teachers),
    rooms: arr(data.rooms),
    assignments: arr(data.assignments),
    locks: arr(data.locks),
    fixed,
  };
}

/**
 * สร้างโมเดลภายใน (ดัชนีตัวเลข + ตาราง typed array) ใช้ร่วมกันระหว่าง solve / validate / score
 * ช่อง (slot) = day * P + period
 */
function buildModel(raw) {
  const inp = toSolverInput(raw);
  const warnings = [];
  const D = Math.max(0, Math.floor(Number(inp.days) || 0));
  const periodsIn = arr(inp.periods);
  if (periodsIn.length > MAX_PERIODS) warnings.push(`จำนวนช่องต่อวันเกิน ${MAX_PERIODS} ช่อง ใช้เพียง ${MAX_PERIODS} ช่องแรก`);
  const P = Math.min(periodsIn.length, MAX_PERIODS);
  const S = D * P;

  // ช่องที่เป็นคาบเรียน (ไม่ใช่ช่องพัก) + bitmask ของคาบเรียนในหนึ่งวัน
  const isClass = new Uint8Array(P);
  let classBits = 0;
  for (let p = 0; p < P; p++) {
    const t = periodsIn[p] && periodsIn[p].type;
    if (t !== 'break') { isClass[p] = 1; classBits |= (1 << p); }
  }

  const classes = inp.classes, teachers = inp.teachers, rooms = inp.rooms, asgs = inp.assignments;
  const C = classes.length, T = teachers.length, R = rooms.length, A = asgs.length;
  const cIdx = new Map(), tIdx = new Map(), rIdx = new Map(), aIdx = new Map();
  classes.forEach((c, i) => { const k = keyOf(c && c.id); if (k !== null) cIdx.set(k, i); });
  teachers.forEach((t, i) => { const k = keyOf(t && t.id); if (k !== null) tIdx.set(k, i); });
  rooms.forEach((r, i) => { const k = keyOf(r && r.id); if (k !== null) rIdx.set(k, i); });

  // ครู: จำนวนคาบสูงสุดต่อวัน + คาบไม่ว่าง
  const tMax = new Int16Array(T);
  const tUnav = new Uint8Array(T * S);
  for (let i = 0; i < T; i++) {
    const t = teachers[i] || {};
    const m = Math.floor(Number(t.maxPerDay));
    tMax[i] = m > 0 ? Math.min(m, 999) : 999;           // 0/ว่าง = ไม่จำกัด
    for (const x of arr(t.unavailable)) {
      const [d, p] = pairOf(x);
      if (isInt(d) && isInt(p) && d >= 0 && d < D && p >= 0 && p < P) tUnav[i * S + d * P + p] = 1;
    }
  }

  // คาบล็อก: classId = null → ล็อกทุกห้อง · day/period = null → ทุกวัน/ทุกคาบ (ส่วนขยาย)
  const lock = new Uint8Array(C * S);
  const gLock = new Uint8Array(S);
  const lockLabel = new Map();   // key: (c|-1) * S + slot → label
  for (const l of arr(inp.locks)) {
    if (!l) continue;
    const dList = l.day === null || l.day === undefined ? [...Array(D).keys()] : [Number(l.day)];
    const pList = l.period === null || l.period === undefined ? [...Array(P).keys()] : [Number(l.period)];
    const ck = keyOf(l.classId);
    const c = ck === null ? -1 : cIdx.get(ck);
    if (c === undefined) { warnings.push(`คาบล็อกอ้างถึงห้องที่ไม่พบ (${ck})`); continue; }
    for (const d of dList) for (const p of pList) {
      if (!isInt(d) || !isInt(p) || d < 0 || d >= D || p < 0 || p >= P) continue;
      const slot = d * P + p;
      if (c < 0) {
        gLock[slot] = 1;
        for (let k = 0; k < C; k++) lock[k * S + slot] = 1;
        if (l.label) lockLabel.set(-1 - slot, String(l.label));
      } else {
        lock[c * S + slot] = 1;
        if (l.label) lockLabel.set(c * S + slot, String(l.label));
      }
    }
  }

  // งานสอน
  const aCls = new Int32Array(A).fill(-1), aTch = new Int32Array(A).fill(-1), aRoom = new Int32Array(A).fill(-1);
  const aPer = new Int32Array(A), aDbl = new Int32Array(A), aGrp = new Int32Array(A).fill(-1);
  const aBad = new Array(A).fill(null);
  const grpMap = new Map();
  let G = 0;
  for (let i = 0; i < A; i++) {
    const a = asgs[i] || {};
    const ak = keyOf(a.id);
    if (ak !== null && !aIdx.has(ak)) aIdx.set(ak, i);
    const per = Math.max(0, Math.floor(Number(a.perWeek) || 0));
    aPer[i] = per;
    aDbl[i] = Math.min(Math.max(0, Math.floor(Number(a.doubles) || 0)), Math.floor(per / 2));
    const c = cIdx.get(keyOf(a.classId));
    if (c === undefined) { aBad[i] = 'ไม่พบห้องเรียนของงานสอนนี้'; continue; }
    aCls[i] = c;
    const tk = keyOf(a.teacherId);
    if (tk !== null) {
      const t = tIdx.get(tk);
      if (t === undefined) warnings.push(`งานสอน ${ak} อ้างถึงครูที่ไม่พบ (${tk}) — จัดโดยไม่ตรวจชนครู`);
      else aTch[i] = t;
    }
    const rk = keyOf(a.roomId);
    if (rk !== null) {
      const r = rIdx.get(rk);
      if (r === undefined) warnings.push(`งานสอน ${ak} อ้างถึงห้องพิเศษที่ไม่พบ (${rk}) — จัดโดยไม่ตรวจชนห้องพิเศษ`);
      else aRoom[i] = r;
    }
    // "วิชาเดียวกันในห้องเดียวกัน" = คู่ (ห้อง, subjectId) ถ้าไม่มี subjectId ใช้ตัวงานสอนเอง
    const sk = keyOf(a.subjectId);
    const gk = c + '|' + (sk === null ? '#' + i : 's' + sk);
    let g = grpMap.get(gk);
    if (g === undefined) { g = G++; grpMap.set(gk, g); }
    aGrp[i] = g;
  }
  const gDbl = new Int32Array(G);
  for (let i = 0; i < A; i++) if (aGrp[i] >= 0) gDbl[aGrp[i]] += aDbl[i];

  // ตารางคำนวณคาบว่างแทรก (gap) จาก bitmask ของครูในหนึ่งวัน
  let gapOf;
  const gapCalc = (m) => {
    if (!m) return 0;
    const first = 31 - Math.clz32(m & -m);
    const last = 31 - Math.clz32(m);
    const range = ((2 << last) - 1) ^ ((1 << first) - 1);
    return popcount(range & classBits & ~m);
  };
  if (P <= 16) {
    const tbl = new Uint8Array(1 << P);
    for (let m = 1; m < tbl.length; m++) tbl[m] = gapCalc(m);
    gapOf = (m) => tbl[m];
  } else gapOf = gapCalc;

  const name = (list, i, fallback) => {
    const o = list[i] || {};
    return String(o.name ?? o.short ?? (fallback + ' ' + (o.id ?? i)));
  };

  return {
    D, P, S, C, T, R, A, G, isClass, classBits, classes, teachers, rooms, asgs,
    cIdx, tIdx, rIdx, aIdx, tMax, tUnav, lock, gLock, lockLabel,
    aCls, aTch, aRoom, aPer, aDbl, aGrp, aBad, gDbl, gapOf, warnings,
    fixed: arr(inp.fixed),
    className: (c) => name(classes, c, 'ห้อง'),
    teacherName: (t) => name(teachers, t, 'ครู'),
    roomName: (r) => name(rooms, r, 'ห้องพิเศษ'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// validate — ตรวจชน (ต้องเร็ว: ใช้ตอนลากวางทุกครั้ง)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ตรวจข้อจำกัดแข็งของชุด placements
 * @returns {Array<{type, day, period, ids, idx, cells, message}>}
 *   type   : 'class'|'teacher'|'room'|'lock'|'break'|'unavailable'|'maxPerDay'|'double'
 *   day/period : ช่องหลักที่ให้ไฮไลต์ (maxPerDay = คาบแรกที่เกิน, double = คาบที่จับคู่ไม่ได้)
 *   ids    : assignmentId ที่เกี่ยวข้อง (ค่าเดิมตาม input)
 *   idx    : ดัชนีใน placements ที่เกี่ยวข้อง · cells : [[day, period], ...] ทุกช่องที่เกี่ยวข้อง
 *   message: คำอธิบายภาษาไทย
 * หมายเหตุ 'double' ตรวจแบบมองโลกในแง่ดี: ถ้ายังวางไม่ครบ perWeek และคาบที่เหลือยังจับคู่ได้ จะยังไม่ฟ้อง
 */
export function validate(input, placements) {
  const M = buildModel(input);
  const { D, P, S, C, T, R, A, aCls, aTch, aRoom, asgs } = M;
  const list = arr(placements);
  const n = list.length;
  const out = [];
  const pa = new Int32Array(n).fill(-1), pSlot = new Int32Array(n).fill(-1);
  const headC = new Int32Array(C * S).fill(-1), headT = new Int32Array(T * S).fill(-1), headR = new Int32Array(R * S).fill(-1);
  const nextC = new Int32Array(n).fill(-1), nextT = new Int32Array(n).fill(-1), nextR = new Int32Array(n).fill(-1);
  const headA = new Int32Array(A).fill(-1), nextA = new Int32Array(n).fill(-1);
  const tDay = new Int32Array(T * D);
  const aid = (a) => (asgs[a] ? asgs[a].id : null);

  for (let i = 0; i < n; i++) {
    const pl = list[i];
    if (!pl) continue;
    const a = M.aIdx.get(keyOf(pl.assignmentId));
    if (a === undefined || aCls[a] < 0) continue;
    const d = Number(pl.day), p = Number(pl.period);
    if (!isInt(d) || !isInt(p) || d < 0 || d >= D || p < 0 || p >= P) {
      out.push({ type: 'break', day: d, period: p, ids: [aid(a)], idx: [i], cells: [[d, p]], message: 'อยู่นอกช่วงวัน/คาบของตาราง' });
      continue;
    }
    const slot = d * P + p, c = aCls[a], t = aTch[a], r = aRoom[a];
    pa[i] = a; pSlot[i] = slot;
    if (!M.isClass[p]) out.push({ type: 'break', day: d, period: p, ids: [aid(a)], idx: [i], cells: [[d, p]], message: 'วางในช่องพัก' });
    if (M.lock[c * S + slot]) {
      const label = M.lockLabel.get(c * S + slot) || M.lockLabel.get(-1 - slot) || 'คาบล็อก';
      out.push({ type: 'lock', day: d, period: p, ids: [aid(a)], idx: [i], cells: [[d, p]], message: `วางทับคาบล็อก (${label})` });
    }
    if (t >= 0 && M.tUnav[t * S + slot]) {
      out.push({ type: 'unavailable', day: d, period: p, ids: [aid(a)], idx: [i], cells: [[d, p]], message: `${M.teacherName(t)} ไม่ว่างคาบนี้` });
    }
    // ร้อยรายการตามทรัพยากร × ช่อง (linked list ใน typed array — เร็วกว่า Map)
    nextC[i] = headC[c * S + slot]; headC[c * S + slot] = i;
    if (t >= 0) { nextT[i] = headT[t * S + slot]; headT[t * S + slot] = i; tDay[t * D + d]++; }
    if (r >= 0) { nextR[i] = headR[r * S + slot]; headR[r * S + slot] = i; }
    nextA[i] = headA[a]; headA[a] = i;
  }

  // ชนกัน: ออกรายงานครั้งเดียวต่อ (ทรัพยากร, ช่อง) ตอนเจอหัวรายการ
  const clash = (type, head, next, base, i, msg) => {
    if (head[base] !== i || next[i] < 0) return;
    const idxs = [], ids = [];
    for (let j = i; j >= 0; j = next[j]) { idxs.push(j); const x = aid(pa[j]); if (!ids.includes(x)) ids.push(x); }
    idxs.reverse(); ids.reverse();
    const d = (pSlot[i] / P) | 0, p = pSlot[i] - d * P;
    out.push({ type, day: d, period: p, ids, idx: idxs, cells: [[d, p]], message: msg });
  };
  for (let i = 0; i < n; i++) {
    const a = pa[i];
    if (a < 0) continue;
    const slot = pSlot[i], c = aCls[a], t = aTch[a], r = aRoom[a];
    clash('class', headC, nextC, c * S + slot, i, `${M.className(c)} มีมากกว่า 1 วิชาในคาบเดียวกัน`);
    if (t >= 0) clash('teacher', headT, nextT, t * S + slot, i, `${M.teacherName(t)} สอนมากกว่า 1 ห้องในคาบเดียวกัน`);
    if (r >= 0) clash('room', headR, nextR, r * S + slot, i, `${M.roomName(r)} ถูกใช้ซ้ำในคาบเดียวกัน`);
  }

  // ครูเกินจำนวนคาบต่อวัน: 1 รายการต่อ (ครู, วัน)
  let over = null;
  for (let i = 0; i < n; i++) {
    const a = pa[i];
    if (a < 0 || aTch[a] < 0) continue;
    const t = aTch[a], d = (pSlot[i] / P) | 0;
    if (tDay[t * D + d] <= M.tMax[t]) continue;
    over = over || new Map();
    const k = t * D + d;
    if (!over.has(k)) over.set(k, []);
    over.get(k).push(i);
  }
  if (over) for (const [k, idxs] of over) {
    const t = (k / D) | 0, d = k - t * D, mx = M.tMax[t];
    idxs.sort((x, y) => pSlot[x] - pSlot[y]);
    const excess = idxs.slice(mx);
    const ids = [];
    for (const j of idxs) { const x = aid(pa[j]); if (!ids.includes(x)) ids.push(x); }
    out.push({
      type: 'maxPerDay', day: d, period: pSlot[excess[0]] - d * P, ids, idx: idxs,
      cells: excess.map((j) => [d, pSlot[j] - d * P]),
      message: `${M.teacherName(t)} สอน ${idxs.length} คาบในวันนี้ เกินกำหนด ${mx} คาบ`,
    });
  }

  // คาบคู่: ต้องมีคู่ติดกันในวันเดียวกัน (ไม่คร่อมพัก) ครบ doubles
  for (let a = 0; a < A; a++) {
    const need = M.aDbl[a];
    if (need <= 0 || headA[a] < 0) continue;
    const masks = new Int32Array(D);
    for (let j = headA[a]; j >= 0; j = nextA[j]) { const d = (pSlot[j] / P) | 0; masks[d] |= 1 << (pSlot[j] - d * P); }
    let cells = 0, pairs = 0;
    const odd = [];
    for (let d = 0; d < D; d++) {
      const m = masks[d];
      if (!m) continue;
      cells += popcount(m);
      for (let p = 0; p < P;) {
        if (!(m & (1 << p))) { p++; continue; }
        let q = p;
        while (q + 1 < P && (m & (1 << (q + 1))) && M.isClass[q] && M.isClass[q + 1]) q++;
        const len = q - p + 1;
        pairs += len >> 1;
        if (len & 1) for (let x = p; x <= q; x++) odd.push([d, x]);
        p = q + 1;
      }
    }
    const used = Math.min(pairs, need);
    const unpaired = cells - 2 * used;
    const rem = Math.max(0, M.aPer[a] - cells);
    const k = Math.min(unpaired, rem);
    const best = used + k + ((rem - k) >> 1);   // คู่มากสุดที่ยังเป็นไปได้ถ้าวางคาบที่เหลือได้ดีที่สุด
    if (best >= need) continue;
    const idxs = [];
    for (let j = headA[a]; j >= 0; j = nextA[j]) idxs.push(j);
    idxs.reverse();
    const first = odd[0] || [((pSlot[idxs[0]] / P) | 0), pSlot[idxs[0]] % P];
    out.push({
      type: 'double', day: first[0], period: first[1], ids: [aid(a)], idx: idxs, cells: odd.length ? odd : [first],
      message: `ต้องมีคาบคู่ติดกัน ${need} คู่ (ไม่คร่อมพัก) แต่จัดได้ ${used} คู่`,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// score — คะแนนข้อจำกัดอ่อนจาก placements (ยิ่งน้อยยิ่งดี)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * คำนวณคะแนน soft จาก placements โดยตรง (ไม่ขึ้นกับสถานะภายใน solver)
 * @returns {{softScore:number, sameDay:number, adjacentDays:number, teacherGaps:number}}
 */
export function score(input, placements) {
  const M = buildModel(input);
  const { D, P, G, T, aGrp, aTch } = M;
  const gMask = new Int32Array(G * D);   // ช่องที่วิชา (กลุ่ม) ลงในแต่ละวัน
  const tMask = new Int32Array(T * D);
  for (const pl of arr(placements)) {
    if (!pl) continue;
    const a = M.aIdx.get(keyOf(pl.assignmentId));
    if (a === undefined || aGrp[a] < 0) continue;
    const d = Number(pl.day), p = Number(pl.period);
    if (!isInt(d) || !isInt(p) || d < 0 || d >= D || p < 0 || p >= P) continue;
    gMask[aGrp[a] * D + d] |= 1 << p;
    if (aTch[a] >= 0) tMask[aTch[a] * D + d] |= 1 << p;
  }
  let sameDay = 0, adjacentDays = 0, teacherGaps = 0;
  for (let g = 0; g < G; g++) {
    let dblLeft = M.gDbl[g];
    for (let d = 0; d < D; d++) {
      const m = gMask[g * D + d];
      if (!m) continue;
      // นับ "ครั้ง" ในวันนั้น: คู่คาบติดกันนับ 1 (ไม่เกินจำนวนคาบคู่ที่กำหนด)
      let cells = 0, pairs = 0;
      for (let p = 0; p < P;) {
        if (!(m & (1 << p))) { p++; continue; }
        let q = p;
        while (q + 1 < P && (m & (1 << (q + 1))) && M.isClass[q] && M.isClass[q + 1]) q++;
        cells += q - p + 1; pairs += (q - p + 1) >> 1; p = q + 1;
      }
      const use = Math.min(pairs, dblLeft);
      dblLeft -= use;
      const occ = cells - use;
      if (occ > 1) sameDay += occ - 1;
      if (d + 1 < D && gMask[g * D + d + 1]) adjacentDays++;
    }
  }
  for (let i = 0; i < T * D; i++) teacherGaps += M.gapOf(tMask[i]);
  const softScore = SOFT_WEIGHTS.sameDay * sameDay + SOFT_WEIGHTS.adjacentDays * adjacentDays + SOFT_WEIGHTS.teacherGap * teacherGaps;
  return { softScore, sameDay, adjacentDays, teacherGaps };
}

// ─────────────────────────────────────────────────────────────────────────────
// solve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * จัดตารางอัตโนมัติ
 * @param {object} input  ตามสัญญา Solver ใน SPEC.md
 * @param {object} [options]
 * @param {number} [options.timeLimitMs=4000]  เวลาสูงสุด (หยุดเร็วกว่านั้นเมื่อไม่พบการปรับปรุงแล้ว)
 * @param {number} [options.seed=1]            seed ของตัวสุ่ม (ค่าเดิม = ผลเดิม)
 * @param {number} [options.maxIterations]     เพดานจำนวนรอบ (ไม่บังคับ)
 * @param {number} [options.effort=1]          ตัวคูณความพยายามช่วงขัดเกลา soft (0.2–5)
 * @param {(p:{pct:number,best:object,iterations:number,ms:number,phase:string})=>void} [options.onProgress]
 *        pct เป็นสัดส่วน 0..1
 * @returns {{placements:Array, unplaced:Array, stats:object}}
 */
export function solve(input, options = {}) {
  const t0 = now();
  const opt = options || {};
  const timeLimit = Math.max(20, Number(opt.timeLimitMs) > 0 ? Number(opt.timeLimitMs) : 4000);
  const seed = (Number(opt.seed) || 1) >>> 0;
  const maxIter = Number(opt.maxIterations) > 0 ? Number(opt.maxIterations) : Infinity;
  const effort = Math.min(5, Math.max(0.2, Number(opt.effort) || 1));
  const onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : null;
  const rnd = mulberry32(seed || 1);
  const rint = (n) => (rnd() * n) | 0;

  const M = buildModel(input);
  const { D, P, S, C, T, R, A, G, isClass, lock, tUnav, tMax, aCls, aTch, aRoom, aPer, aDbl, aGrp, gapOf } = M;
  const warnings = M.warnings.slice();
  const WS = SOFT_WEIGHTS.sameDay, WA = SOFT_WEIGHTS.adjacentDays, WG = SOFT_WEIGHTS.teacherGap;

  // ── 1) แตกเป็นหน่วย ──────────────────────────────────────────────────────
  const uA = [], uL = [], uFixed = [], uStart0 = [];
  const partnerDom = new Map();     // หน่วย "คู่หู" ของคาบคู่ที่ถูกปักหมุดไว้ครึ่งเดียว → ช่องที่อนุญาต
  const preUnplaced = [];            // {a, periods, reason}
  const fixedByA = new Map();
  const fixedOut = [];               // placements ที่ปักหมุด (ส่งคืนตามเดิม)
  for (const f of M.fixed) {
    if (!f) continue;
    const a = M.aIdx.get(keyOf(f.assignmentId));
    const d = Number(f.day), p = Number(f.period);
    if (a === undefined || aCls[a] < 0) { warnings.push(`คาบปักหมุดอ้างถึงงานสอนที่ไม่พบ (${f.assignmentId}) — ข้าม`); continue; }
    if (!isInt(d) || !isInt(p) || d < 0 || d >= D || p < 0 || p >= P) { warnings.push(`คาบปักหมุดอยู่นอกตาราง (วัน ${f.day} คาบ ${f.period}) — ข้าม`); continue; }
    if (!fixedByA.has(a)) fixedByA.set(a, []);
    fixedByA.get(a).push(d * P + p);
    fixedOut.push({ assignmentId: f.assignmentId, day: d, period: p, pinned: true });
  }
  for (let a = 0; a < A; a++) {
    if (M.aBad[a]) { if (aPer[a] > 0) preUnplaced.push({ a, periods: aPer[a], reason: M.aBad[a] }); continue; }
    const fs = (fixedByA.get(a) || []).sort((x, y) => x - y);
    let fixedCells = 0, fixedPairs = 0;
    let oddRuns = 0;
    const oddExt = [];   // ช่องข้าง ๆ ของกลุ่มหมุดความยาวคี่ (วางคาบเดี่ยวตรงนี้แล้วจะกลายเป็นคาบคู่)
    for (let i = 0; i < fs.length;) {
      // รวมช่องปักหมุดที่ติดกันเป็นหน่วยเดียว (นับเป็น "ครั้ง" เดียวในวันนั้น)
      let j = i;
      while (j + 1 < fs.length && fs[j + 1] === fs[j] + 1 && (fs[j + 1] % P) !== 0 && isClass[fs[j] % P] && isClass[fs[j + 1] % P]) j++;
      const len = j - i + 1;
      uA.push(a); uL.push(len); uFixed.push(1); uStart0.push(fs[i]);
      fixedCells += len; fixedPairs += len >> 1;
      if (len & 1) {
        const n0 = oddExt.length;
        const first = fs[i], last = fs[j];
        if (isClass[first % P] && first % P > 0 && isClass[first % P - 1]) oddExt.push(first - 1);
        if (isClass[last % P] && last % P < P - 1 && isClass[last % P + 1]) oddExt.push(last + 1);
        if (oddExt.length > n0) oddRuns++;
      }
      i = j + 1;
    }
    // คาบที่ยังต้องวาง: x = คาบคู่ใหม่, y = คาบเดี่ยวที่ต้องไปต่อข้างหมุด (ถ้าเหลือคาบไม่พอสร้างคู่ใหม่), ที่เหลือเป็นคาบเดี่ยว
    const remaining = Math.max(0, aPer[a] - fixedCells);
    const needDbl = Math.max(0, aDbl[a] - fixedPairs);
    const x = oddRuns ? Math.min(needDbl, Math.max(0, remaining - needDbl), remaining >> 1) : Math.min(needDbl, remaining >> 1);
    const y = Math.min(needDbl - x, remaining - 2 * x, oddRuns);
    const singles = remaining - 2 * x - y;
    for (let k = 0; k < x; k++) { uA.push(a); uL.push(2); uFixed.push(0); uStart0.push(-1); }
    for (let k = 0; k < y; k++) { partnerDom.set(uA.length, oddExt); uA.push(a); uL.push(1); uFixed.push(0); uStart0.push(-1); }
    for (let k = 0; k < singles; k++) { uA.push(a); uL.push(1); uFixed.push(0); uStart0.push(-1); }
  }
  const U = uA.length;
  const uLen = Int32Array.from(uL), uAsg = Int32Array.from(uA);
  const uCls = new Int32Array(U), uTch = new Int32Array(U), uRoom = new Int32Array(U), uGrp = new Int32Array(U);
  for (let u = 0; u < U; u++) { const a = uAsg[u]; uCls[u] = aCls[a]; uTch[u] = aTch[a]; uRoom[u] = aRoom[a]; uGrp[u] = partnerDom.has(u) ? -1 : aGrp[a]; }

  // ── 2) โดเมน: ช่องเริ่มที่ผ่านกฎเดี่ยว (พัก/ล็อก/ครูไม่ว่าง/คู่คาบไม่คร่อมพัก) ──
  const domStart = new Int32Array(U + 1);
  const domTmp = [];
  const domOk = new Uint8Array(U * S);
  const dead = new Uint8Array(U);
  for (let u = 0; u < U; u++) {
    domStart[u] = domTmp.length;
    if (uFixed[u]) continue;
    const L = uLen[u], c = uCls[u], t = uTch[u];
    if (t >= 0 && tMax[t] < L) { dead[u] = 1; continue; }
    if (partnerDom.has(u)) {
      // หน่วยคู่หู: ลงได้เฉพาะช่องติดกับหมุด (ไม่นับเป็น "ครั้ง" ใหม่ของวิชาในวันนั้น)
      for (const slot of [...new Set(partnerDom.get(u))].sort((p, q) => p - q)) {
        if (lock[c * S + slot] || (t >= 0 && tUnav[t * S + slot])) continue;
        domTmp.push(slot); domOk[u * S + slot] = 1;
      }
      if (domTmp.length === domStart[u]) dead[u] = 1;
      continue;
    }
    for (let d = 0; d < D; d++) {
      for (let s = 0; s + L <= P; s++) {
        let ok = true;
        for (let k = 0; k < L && ok; k++) {
          const p = s + k, slot = d * P + p;
          if (!isClass[p] || lock[c * S + slot] || (t >= 0 && tUnav[t * S + slot])) ok = false;
        }
        if (ok) { domTmp.push(d * P + s); domOk[u * S + d * P + s] = 1; }
      }
    }
    if (domTmp.length === domStart[u]) dead[u] = 1;
  }
  domStart[U] = domTmp.length;
  const domList = Int32Array.from(domTmp);
  const domSize = (u) => domStart[u + 1] - domStart[u];

  // หน่วยที่ขยับได้ + รายการหน่วยในแต่ละห้อง (ใช้หาคู่สลับ)
  const movTmp = [];
  for (let u = 0; u < U; u++) if (!uFixed[u] && !dead[u]) movTmp.push(u);
  const mov = Int32Array.from(movTmp);
  const nMov = mov.length;
  const cuStart = new Int32Array(C + 1);
  for (const u of movTmp) cuStart[uCls[u] + 1]++;
  for (let c = 0; c < C; c++) cuStart[c + 1] += cuStart[c];
  const cuList = new Int32Array(nMov);
  { const fill = cuStart.slice(0, C); for (const u of movTmp) cuList[fill[uCls[u]]++] = u; }

  // ── 3) สถานะ + การประเมินแบบ incremental ─────────────────────────────────
  const clsOcc = new Int16Array(C * S), tchOcc = new Int16Array(T * S), romOcc = new Int16Array(R * S);
  const tchDay = new Int16Array(T * D), tchMask = new Int32Array(T * D), grpDay = new Int16Array(G * D);
  const uPos = new Int32Array(U).fill(-1);
  let hardTot = 0, softTot = 0;
  let gH = 0, gS = 0; // ผลลัพธ์ของ addCost

  /** ต้นทุนที่เพิ่มขึ้นถ้าวางหน่วย u ที่ช่อง slot (u ต้องยังไม่ได้วาง) → gH, gS */
  function addCost(u, slot) {
    const L = uLen[u], c = uCls[u], t = uTch[u], r = uRoom[u], g = uGrp[u];
    const d = (slot / P) | 0, s = slot - d * P;
    let h = 0, sc = 0;
    const cb = c * S + slot, tb = t * S + slot, rb = r * S + slot;
    for (let k = 0; k < L; k++) {
      if (clsOcc[cb + k] > 0) h++;
      if (t >= 0 && tchOcc[tb + k] > 0) h++;
      if (r >= 0 && romOcc[rb + k] > 0) h++;
    }
    if (t >= 0) {
      const td = t * D + d, n0 = tchDay[td], mx = tMax[t], n1 = n0 + L;
      h += (n1 > mx ? n1 - mx : 0) - (n0 > mx ? n0 - mx : 0);
      const m = tchMask[td];
      sc += WG * (gapOf(m | (((1 << L) - 1) << s)) - gapOf(m));
    }
    if (g >= 0) {
      const gd = g * D + d;
      if (grpDay[gd] > 0) sc += WS;
      else {
        if (d > 0 && grpDay[gd - 1] > 0) sc += WA;
        if (d + 1 < D && grpDay[gd + 1] > 0) sc += WA;
      }
    }
    gH = h; gS = sc;
  }

  function place(u, slot) {
    addCost(u, slot);
    hardTot += gH; softTot += gS;
    const L = uLen[u], c = uCls[u], t = uTch[u], r = uRoom[u], g = uGrp[u];
    const d = (slot / P) | 0, s = slot - d * P;
    for (let k = 0; k < L; k++) {
      clsOcc[c * S + slot + k]++;
      if (t >= 0 && tchOcc[t * S + slot + k]++ === 0) tchMask[t * D + d] |= 1 << (s + k);
      if (r >= 0) romOcc[r * S + slot + k]++;
    }
    if (t >= 0) tchDay[t * D + d] += L;
    if (g >= 0) grpDay[g * D + d]++;
    uPos[u] = slot;
  }

  function remove(u) {
    const slot = uPos[u];
    const L = uLen[u], c = uCls[u], t = uTch[u], r = uRoom[u], g = uGrp[u];
    const d = (slot / P) | 0, s = slot - d * P;
    for (let k = 0; k < L; k++) {
      clsOcc[c * S + slot + k]--;
      if (t >= 0 && --tchOcc[t * S + slot + k] === 0) tchMask[t * D + d] &= ~(1 << (s + k));
      if (r >= 0) romOcc[r * S + slot + k]--;
    }
    if (t >= 0) tchDay[t * D + d] -= L;
    if (g >= 0) grpDay[g * D + d]--;
    uPos[u] = -1;
    addCost(u, slot);
    hardTot -= gH; softTot -= gS;
  }

  /** จำนวนข้อชนที่หน่วย u (ซึ่งวางอยู่) มีส่วนเกี่ยวข้อง */
  function unitHard(u) {
    const slot = uPos[u], L = uLen[u], c = uCls[u], t = uTch[u], r = uRoom[u];
    let h = 0;
    for (let k = 0; k < L; k++) {
      if (clsOcc[c * S + slot + k] > 1) h++;
      if (t >= 0 && tchOcc[t * S + slot + k] > 1) h++;
      if (r >= 0 && romOcc[r * S + slot + k] > 1) h++;
    }
    if (t >= 0 && tchDay[t * D + ((slot / P) | 0)] > tMax[t]) h++;
    return h;
  }

  /** คำนวณต้นทุนทั้งหมดใหม่จากตาราง (ใช้ตรวจความถูกต้องของ incremental) */
  function recomputeTotals() {
    let h = 0, s = 0;
    for (let i = 0; i < clsOcc.length; i++) if (clsOcc[i] > 1) h += clsOcc[i] - 1;
    for (let i = 0; i < tchOcc.length; i++) if (tchOcc[i] > 1) h += tchOcc[i] - 1;
    for (let i = 0; i < romOcc.length; i++) if (romOcc[i] > 1) h += romOcc[i] - 1;
    for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) {
      const n = tchDay[t * D + d];
      if (n > tMax[t]) h += n - tMax[t];
      s += WG * gapOf(tchMask[t * D + d]);
    }
    for (let g = 0; g < G; g++) for (let d = 0; d < D; d++) {
      const n = grpDay[g * D + d];
      if (n > 1) s += WS * (n - 1);
      if (n > 0 && d + 1 < D && grpDay[g * D + d + 1] > 0) s += WA;
    }
    return { hard: h, soft: s };
  }

  // วางหน่วยปักหมุดก่อน แล้วเก็บเป็นสถานะฐาน (ใช้ reset ตอน restart)
  for (let u = 0; u < U; u++) if (uFixed[u]) place(u, uStart0[u]);
  const fixedHard = hardTot;
  const base = {
    clsOcc: clsOcc.slice(), tchOcc: tchOcc.slice(), romOcc: romOcc.slice(),
    tchDay: tchDay.slice(), tchMask: tchMask.slice(), grpDay: grpDay.slice(), hard: hardTot, soft: softTot,
  };
  function resetState() {
    clsOcc.set(base.clsOcc); tchOcc.set(base.tchOcc); romOcc.set(base.romOcc);
    tchDay.set(base.tchDay); tchMask.set(base.tchMask); grpDay.set(base.grpDay);
    hardTot = base.hard; softTot = base.soft;
    for (let i = 0; i < nMov; i++) uPos[mov[i]] = -1;
  }
  function snapshot(dst) { for (let i = 0; i < nMov; i++) dst[i] = uPos[mov[i]]; }
  function restore(src) {
    resetState();
    for (let i = 0; i < nMov; i++) if (src[i] >= 0) place(mov[i], src[i]);
  }

  // ── วิเคราะห์ความจุล่วงหน้า (ใช้ตัดสิน infeasible ที่พิสูจน์ได้ + เขียนเหตุผล) ──
  const classDemand = new Int32Array(C), teacherDemand = new Int32Array(T), roomDemand = new Int32Array(R);
  for (let u = 0; u < U; u++) {
    if (dead[u]) continue;
    classDemand[uCls[u]] += uLen[u];
    if (uTch[u] >= 0) teacherDemand[uTch[u]] += uLen[u];
    if (uRoom[u] >= 0) roomDemand[uRoom[u]] += uLen[u];
  }
  const classCap = new Int32Array(C), teacherCap = new Int32Array(T);
  let roomCap = 0;
  for (let slot = 0; slot < S; slot++) if (isClass[slot % P] && !M.gLock[slot]) roomCap++;
  for (let c = 0; c < C; c++) for (let slot = 0; slot < S; slot++) if (isClass[slot % P] && !lock[c * S + slot]) classCap[c]++;
  for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) {
    let n = 0;
    for (let p = 0; p < P; p++) { const slot = d * P + p; if (isClass[p] && !M.gLock[slot] && !tUnav[t * S + slot]) n++; }
    teacherCap[t] += Math.min(n, tMax[t]);
  }
  const overClass = new Uint8Array(C), overTeacher = new Uint8Array(T), overRoom = new Uint8Array(R);
  let provablyInfeasible = false;
  for (let c = 0; c < C; c++) if (classDemand[c] > classCap[c]) { overClass[c] = 1; provablyInfeasible = true; }
  for (let t = 0; t < T; t++) if (teacherDemand[t] > teacherCap[t]) { overTeacher[t] = 1; provablyInfeasible = true; }
  for (let r = 0; r < R; r++) if (roomDemand[r] > roomCap) { overRoom[r] = 1; provablyInfeasible = true; }
  // ช่องคาบคู่: นับคู่ช่องว่างติดกันที่ไม่ทับกันได้มากสุดต่อวัน (greedy ซ้าย→ขวาให้ค่าสูงสุดบนเส้นตรง)
  const maxPairs = (free, cap) => {
    let pairs = 0;
    for (let p = 0; p + 1 < P; p++) if (free(p) && free(p + 1)) { pairs++; p++; }
    return Math.min(pairs, cap);
  };
  const classDbl = new Int32Array(C), teacherDbl = new Int32Array(T), classDblCap = new Int32Array(C), teacherDblCap = new Int32Array(T);
  for (let u = 0; u < U; u++) {
    if (dead[u] || uFixed[u] || uLen[u] !== 2) continue;
    classDbl[uCls[u]]++;
    if (uTch[u] >= 0) teacherDbl[uTch[u]]++;
  }
  for (let d = 0; d < D; d++) {
    for (let c = 0; c < C; c++) if (classDbl[c]) classDblCap[c] += maxPairs((p) => isClass[p] && !lock[c * S + d * P + p], 99);
    for (let t = 0; t < T; t++) if (teacherDbl[t]) teacherDblCap[t] += maxPairs((p) => isClass[p] && !M.gLock[d * P + p] && !tUnav[t * S + d * P + p], tMax[t] >> 1);
  }
  const overClassDbl = new Uint8Array(C), overTeacherDbl = new Uint8Array(T);
  for (let c = 0; c < C; c++) if (classDbl[c] > classDblCap[c]) { overClassDbl[c] = 1; provablyInfeasible = true; }
  for (let t = 0; t < T; t++) if (teacherDbl[t] > teacherDblCap[t]) { overTeacherDbl[t] = 1; provablyInfeasible = true; }

  // ── ตัวช่วยเวลา/ความคืบหน้า ───────────────────────────────────────────
  const deadline = t0 + timeLimit;
  let iter = 0, restarts = 0, timedOut = false, lastReport = t0, phase = 'greedy';
  let bestHardSeen = Infinity, bestSoftSeen = Infinity;
  function report(pct, force) {
    if (!onProgress) return;
    const t = now();
    if (!force && t - lastReport < 120) return;
    lastReport = t;
    try {
      onProgress({
        pct: Math.max(0, Math.min(1, pct)), phase, iterations: iter, ms: Math.round(t - t0),
        best: { hardViolations: bestHardSeen === Infinity ? null : bestHardSeen, softScore: bestSoftSeen === Infinity ? null : bestSoftSeen },
      });
    } catch (e) { /* ไม่ให้ callback ทำให้ solver ล้ม */ }
  }
  function outOfTime(limitAt) {
    const t = now();
    if (t >= limitAt) { if (limitAt >= deadline) timedOut = true; return true; }
    return false;
  }

  // ── 4) Greedy แบบ most-constrained-first ─────────────────────────────────
  const tLoad = teacherDemand;
  function greedy(noise) {
    const order = Array.from(mov);
    const key = new Float64Array(U);
    for (const u of order) {
      const t = uTch[u];
      key[u] = uLen[u] * 1000                          // คาบคู่ก่อน
        + (uRoom[u] >= 0 ? 300 : 0)                     // ใช้ห้องพิเศษ
        - domSize(u) * 10                               // โดเมนแคบก่อน
        + (t >= 0 ? (tLoad[t] * 10) / Math.max(1, teacherCap[t]) * 20 : 0) // ครูภาระแน่น
        + (noise ? rnd() * noise : 0);
    }
    order.sort((x, y) => key[y] - key[x] || x - y);
    for (const u of order) {
      let best = Infinity, bestSlot = -1, ties = 0;
      for (let j = domStart[u]; j < domStart[u + 1]; j++) {
        const slot = domList[j];
        addCost(u, slot);
        const v = gH * W_HARD + gS;
        if (v < best) { best = v; bestSlot = slot; ties = 1; }
        else if (v === best && rint(++ties) === 0) bestSlot = slot;
      }
      place(u, bestSlot);
    }
  }

  // ── 5) Tabu search แบบ min-conflicts (กำจัดข้อชน) ──────────────────────
  const tabu = new Int32Array(U * S);
  const conf = new Int32Array(Math.max(1, nMov));
  const runBest = new Int32Array(nMov), globalBest = new Int32Array(nMov);
  let globalBestKey = Infinity;
  const hardIdleLimit = Math.max(1500, 6 * nMov);

  function hardPhase(limitAt) {
    let bestKey = W_HARD * hardTot + softTot, idle = 0;
    snapshot(runBest);
    while (hardTot > fixedHard && idle < hardIdleLimit && iter < maxIter) {
      iter++;
      if ((iter & 31) === 0) {
        if (outOfTime(limitAt)) break;
        report(Math.min(0.9, (now() - t0) / timeLimit));
      }
      let nConf = 0;
      for (let i = 0; i < nMov; i++) { const u = mov[i]; if (unitHard(u) > 0) conf[nConf++] = u; }
      if (nConf === 0) break; // ชนเฉพาะระหว่างคาบปักหมุดด้วยกัน — แก้ไม่ได้
      const u = conf[rint(nConf)];
      const old = uPos[u], L = uLen[u], c = uCls[u];
      remove(u);
      const baseVal = W_HARD * hardTot + softTot;
      let bestVal = Infinity, bestSlot = -1, bestV = -1, ties = 0;
      if (rnd() < 0.02 && domSize(u) > 1) {
        // สุ่มเดินบ้างเล็กน้อย กันวนลูป
        do { bestSlot = domList[domStart[u] + rint(domSize(u))]; } while (bestSlot === old);
      } else {
        for (let j = domStart[u]; j < domStart[u + 1]; j++) {
          const slot = domList[j];
          if (slot === old) continue;
          addCost(u, slot);
          const val = gH * W_HARD + gS;
          if (tabu[u * S + slot] > iter && baseVal + val >= bestKey) continue; // tabu (เว้นแต่ได้ดีที่สุดใหม่)
          if (val < bestVal) { bestVal = val; bestSlot = slot; bestV = -1; ties = 1; }
          else if (val === bestVal && rint(++ties) === 0) { bestSlot = slot; bestV = -1; }
        }
        // สลับกับหน่วยอื่นในห้องเดียวกันที่ยาวเท่ากัน
        for (let j = cuStart[c]; j < cuStart[c + 1]; j++) {
          const v = cuList[j];
          if (v === u || uLen[v] !== L) continue;
          const pv = uPos[v];
          if (pv < 0 || pv === old || !domOk[u * S + pv] || !domOk[v * S + old]) continue;
          remove(v); place(u, pv); place(v, old);
          const val = W_HARD * hardTot + softTot - baseVal;
          remove(v); remove(u); place(v, pv);
          if ((tabu[u * S + pv] > iter || tabu[v * S + old] > iter) && baseVal + val >= bestKey) continue;
          if (val < bestVal) { bestVal = val; bestSlot = pv; bestV = v; ties = 1; }
          else if (val === bestVal && rint(++ties) === 0) { bestSlot = pv; bestV = v; }
        }
      }
      const tenure = 3 + rint(7) + (nConf >> 3);
      if (bestSlot < 0) { place(u, old); idle++; continue; }
      if (bestV >= 0) {
        const v = bestV, pv = uPos[v];
        remove(v); place(u, pv); place(v, old);
        tabu[v * S + pv] = iter + tenure;
      } else place(u, bestSlot);
      tabu[u * S + old] = iter + tenure;
      const k = W_HARD * hardTot + softTot;
      if (k < bestKey) { bestKey = k; idle = 0; snapshot(runBest); } else idle++;
      if (hardTot - fixedHard < bestHardSeen) { bestHardSeen = hardTot - fixedHard; }
    }
    return bestKey;
  }

  // ── 6) LAHC ขัดเกลาข้อจำกัดอ่อน (ห้ามกลับไปชน) ────────────────────────
  function softPhase(limitAt) {
    const placed = [];
    for (let i = 0; i < nMov; i++) if (uPos[mov[i]] >= 0) placed.push(mov[i]);
    const n = placed.length;
    if (!n) return;
    const hard0 = hardTot;
    let cur = softTot, best = cur, idle = 0, k = 0;
    const idleLimit = Math.round(Math.max(100000, 400 * n) * effort);
    const LH = Math.max(50, Math.min(200, Math.round(n / 2)));  // ความยาวประวัติ LAHC (ทดลองแล้ว 100–200 ดีสุด)
    const hist = new Float64Array(LH).fill(cur);
    const bestPos = new Int32Array(nMov);
    snapshot(bestPos);
    bestSoftSeen = Math.min(bestSoftSeen, best);
    while (idle < idleLimit && best > 0 && iter < maxIter) {
      iter++;
      if ((iter & 255) === 0) {
        if (outOfTime(limitAt)) break;
        report(0.9 * Math.max((now() - t0) / timeLimit, idle / idleLimit) + 0.05);
      }
      const u = placed[rint(n)];
      const old = uPos[u];
      let v = -1, pv = -1;
      if (rnd() < 0.55) {
        const slot = domList[domStart[u] + rint(domSize(u))];
        if (slot === old) { idle++; continue; }
        remove(u); place(u, slot);
      } else {
        const c = uCls[u], cn = cuStart[c + 1] - cuStart[c];
        v = cuList[cuStart[c] + rint(cn)];
        pv = uPos[v];
        if (v === u || uLen[v] !== uLen[u] || pv < 0 || pv === old || !domOk[u * S + pv] || !domOk[v * S + old]) { idle++; continue; }
        remove(v); remove(u); place(u, pv); place(v, old);
      }
      let accept = false;
      if (hardTot <= hard0) {
        const nc = softTot;
        accept = nc <= cur || nc <= hist[k];
      }
      if (accept) cur = softTot;
      else if (v < 0) { remove(u); place(u, old); }
      else { remove(v); remove(u); place(u, old); place(v, pv); }
      hist[k] = cur; k = (k + 1) % LH;
      if (cur < best) { best = cur; idle = 0; snapshot(bestPos); bestSoftSeen = Math.min(bestSoftSeen, best); }
      else idle++;
    }
    if (softTot !== best) restore(bestPos);
  }

  // ── 7) กรณีแก้ชนไม่หมด: ถอดหน่วยที่ชนออก แล้วลองใส่กลับแบบไม่ชน ──────────
  const unplacedUnits = [];
  function extractConflicts() {
    while (hardTot > fixedHard) {
      let worst = -1, wh = 0;
      for (let i = 0; i < nMov; i++) {
        const u = mov[i];
        if (uPos[u] < 0) continue;
        const h = unitHard(u);
        if (h > wh || (h === wh && h > 0 && uLen[u] > uLen[worst])) { wh = h; worst = u; }
      }
      if (worst < 0) break;
      remove(worst);
      unplacedUnits.push(worst);
    }
  }
  function reinsert() {
    const left = [];
    // พยายามใส่หน่วยยาว/โดเมนแคบก่อน
    unplacedUnits.sort((x, y) => uLen[y] - uLen[x] || domSize(x) - domSize(y) || x - y);
    for (const u of unplacedUnits) {
      let best = Infinity, bestSlot = -1;
      for (let j = domStart[u]; j < domStart[u + 1]; j++) {
        const slot = domList[j];
        addCost(u, slot);
        if (gH === 0 && gS < best) { best = gS; bestSlot = slot; }
      }
      if (bestSlot >= 0) place(u, bestSlot); else left.push(u);
    }
    unplacedUnits.length = 0;
    unplacedUnits.push(...left);
  }

  // ── ลำดับการทำงานหลัก ───────────────────────────────────────────────────
  const hardLimitAt = t0 + timeLimit * 0.75;   // เก็บเวลาไว้สำหรับถอดชน/ขัดเกลา soft
  const maxRestarts = provablyInfeasible ? 1 : Infinity;
  if (nMov > 0) {
    report(0, true);
    for (let attempt = 0; attempt < maxRestarts; attempt++) {
      if (attempt > 0) { restarts++; resetState(); }
      phase = 'greedy';
      greedy(attempt === 0 ? 0 : 600 + 200 * Math.min(attempt, 10));
      bestHardSeen = Math.min(bestHardSeen, hardTot - fixedHard);
      phase = 'hard';
      const key = hardPhase(hardLimitAt);
      if (key < globalBestKey) { globalBestKey = key; globalBest.set(runBest); }
      if (globalBestKey < W_HARD * (fixedHard + 1)) break;   // ไม่ชนแล้ว
      if (now() >= hardLimitAt || iter >= maxIter) break;
    }
    restore(globalBest);
    if (hardTot > fixedHard) { phase = 'repair'; extractConflicts(); reinsert(); }
    bestHardSeen = hardTot - fixedHard;
    phase = 'soft';
    softPhase(deadline);
    if (unplacedUnits.length) reinsert();
  }

  if (opt.debugCheck) {
    const re = recomputeTotals();
    if (re.hard !== hardTot || re.soft !== softTot) {
      throw new Error(`incremental cost mismatch: hard ${hardTot}/${re.hard} soft ${softTot}/${re.soft}`);
    }
  }

  // ── ประกอบผลลัพธ์ ─────────────────────────────────────────────────────────
  const placements = fixedOut.slice();
  for (let i = 0; i < nMov; i++) {
    const u = mov[i], slot = uPos[u];
    if (slot < 0) continue;
    const d = (slot / P) | 0, s = slot - d * P, id = M.asgs[uAsg[u]].id;
    for (let k = 0; k < uLen[u]; k++) placements.push({ assignmentId: id, day: d, period: s + k });
  }

  // เหตุผลของคาบที่วางไม่ลง (ต่อ assignment)
  const byA = new Map();
  const addUnplaced = (a, periods, reason, rank) => {
    const e = byA.get(a);
    if (!e) byA.set(a, { a, periods, reason, rank });
    else { e.periods += periods; if (rank < e.rank) { e.reason = reason; e.rank = rank; } }
  };
  for (const x of preUnplaced) addUnplaced(x.a, x.periods, x.reason, 0);
  for (let u = 0; u < U; u++) {
    if (!dead[u]) continue;
    const t = uTch[u];
    let reason;
    if (partnerDom.has(u)) reason = 'คาบคู่ที่ปักหมุดไว้ครึ่งเดียว: ช่องข้างหมุดติดคาบล็อก/ครูไม่ว่าง';
    else if (t >= 0 && tMax[t] < uLen[u]) reason = `${M.teacherName(t)} สอนได้วันละ ${tMax[t]} คาบ จึงลงคาบคู่ไม่ได้`;
    else if (uLen[u] === 2) reason = 'ไม่มีช่องคาบคู่ติดกัน (ไม่คร่อมพัก) ที่ครูว่างและไม่ติดคาบล็อก';
    else reason = 'ไม่มีคาบที่ครูว่างและไม่ติดคาบล็อกเลย';
    addUnplaced(uAsg[u], uLen[u], reason, 1);
  }
  for (const u of unplacedUnits) addUnplaced(uAsg[u], uLen[u], explainUnit(u), 2);

  function explainUnit(u) {
    const c = uCls[u], t = uTch[u], r = uRoom[u];
    if (overClass[c]) return `${M.className(c)} ต้องเรียนรวม ${classDemand[c]} คาบ/สัปดาห์ แต่มีคาบว่างเพียง ${classCap[c]} คาบ`;
    if (t >= 0 && overTeacher[t]) return `${M.teacherName(t)} ต้องสอน ${teacherDemand[t]} คาบ/สัปดาห์ แต่สอนได้สูงสุด ${teacherCap[t]} คาบ (รวมคาบไม่ว่างและเพดานต่อวัน)`;
    if (r >= 0 && overRoom[r]) return `${M.roomName(r)} ถูกใช้ ${roomDemand[r]} คาบ/สัปดาห์ เกินจำนวนคาบที่มี ${roomCap} คาบ`;
    if (uLen[u] === 2 && t >= 0 && overTeacherDbl[t]) return `${M.teacherName(t)} ต้องสอนคาบคู่ ${teacherDbl[t]} คู่ แต่มีช่องคาบคู่ที่ว่าง (ไม่คร่อมพัก) เพียง ${teacherDblCap[t]} คู่`;
    if (uLen[u] === 2 && overClassDbl[c]) return `${M.className(c)} ต้องเรียนคาบคู่ ${classDbl[c]} คู่ แต่มีช่องคาบคู่ที่ว่างเพียง ${classDblCap[c]} คู่`;
    // นับว่าช่องในโดเมนถูกขวางด้วยอะไรมากที่สุด
    let bc = 0, bt = 0, br = 0, bm = 0;
    const L = uLen[u];
    for (let j = domStart[u]; j < domStart[u + 1]; j++) {
      const slot = domList[j], d = (slot / P) | 0;
      let xc = 0, xt = 0, xr = 0;
      for (let k = 0; k < L; k++) {
        if (clsOcc[c * S + slot + k] > 0) xc = 1;
        if (t >= 0 && tchOcc[t * S + slot + k] > 0) xt = 1;
        if (r >= 0 && romOcc[r * S + slot + k] > 0) xr = 1;
      }
      bc += xc; bt += xt; br += xr;
      if (t >= 0 && tchDay[t * D + d] + L > tMax[t]) bm++;
    }
    const tail = ' — ลองเพิ่มเวลาจัด ผ่อนข้อจำกัด หรือเลิกปักหมุดบางคาบ';
    const top = Math.max(bc, bt, br, bm);
    if (top === bt && t >= 0) return `${M.teacherName(t)} ติดสอนห้องอื่นในช่องที่เหลือ${tail}`;
    if (top === br && r >= 0) return `${M.roomName(r)} ถูกใช้เต็มในช่องที่เหลือ${tail}`;
    if (top === bm && t >= 0) return `${M.teacherName(t)} สอนครบ ${tMax[t]} คาบ/วัน ในวันที่ยังว่าง${tail}`;
    return `${M.className(c)} ไม่มีช่องว่างที่ลง${L === 2 ? 'คาบคู่' : ''}ได้โดยไม่ชน${tail}`;
  }

  const unplaced = [...byA.values()].sort((x, y) => x.a - y.a)
    .map((e) => ({ assignmentId: M.asgs[e.a].id, remaining: e.periods, reason: e.reason }));

  const conflicts = validate(input, placements);
  const sc = score(input, placements);
  const ms = now() - t0;
  report(1, true);
  return {
    placements,
    unplaced,
    stats: {
      hardViolations: conflicts.length,
      softScore: sc.softScore,
      soft: { sameDay: sc.sameDay, adjacentDays: sc.adjacentDays, teacherGaps: sc.teacherGaps },
      ms: Math.round(ms * 10) / 10,
      iterations: iter,
      restarts,
      seed,
      timedOut,
      units: U,
      unplacedPeriods: unplaced.reduce((s, x) => s + x.remaining, 0),
      warnings,
    },
  };
}
