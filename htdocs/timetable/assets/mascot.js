// ครูบูรณ์ ผู้ช่วยในแอป (#boon ใน app.php ระหว่างเมนูแท็บกับ <main>) — บอก "ขั้นต่อไป" จากข้อมูลจริงทีละข้อ
// - แถบขั้นตอน 1-2-3-4 (#tt-steps ของ app.js) = ภาพรวมย่อ · ครูบูรณ์ = รายละเอียดของขั้นที่เป็นสีทองอยู่ พร้อมปุ่มลัดปุ่มเดียว
//   (ใช้เกณฑ์เดียวกับแถบขั้นตอน เลขขั้นจึงตรงกันเสมอ · CSS วางสองชิ้นติดกันเป็นแผงเดียว)
// - state: idle / next (คำนวณเอง) · thinking / celebrate / comfort (board.js สั่งผ่าน set() ตอนจัดอัตโนมัติ)
// - ไม่อยู่ใน board.js เพราะกระดานวาดใหม่ทุก commit → แอนิเมชันจะเริ่มใหม่/กระตุกทุกครั้งที่ลากคาบ
// - ภาพ: เดสก์ท็อปใช้ท่า 420×630 (สลับแบบ crossfade 2 ชั้น) · มือถือ/ประหยัดเน็ตใช้ bust 160 อย่างเดียว · ไฟล์ไหนไม่มี = ไม่แสดง ไม่พัง
import { store, esc, remaining } from './store.js';
import * as board from './board.js'; // ใช้ readiness() ตอนรันเท่านั้น (import วนกับ board.js ได้ เพราะไม่แตะตอนโหลดโมดูล)

// ---------- ข้อความ (แก้คำพูดของครูบูรณ์ที่นี่ที่เดียว) ----------
const T = {
  blank: 'ภาคเรียนนี้ยังว่างครับ ตอบ 4 คำถาม ระบบสร้างห้อง วิชา โครงคาบ และกิจกรรมประจำให้ทันที',
  blankBtn: 'เริ่มด้วยตัวช่วย 4 คำถาม',
  periods: 'ยังไม่มีคาบเรียนในโครงคาบครับ ตั้งเวลาเรียนก่อน แล้วค่อยเพิ่มห้องกับครู',
  periodsBtn: 'ไปตั้งโครงคาบ',
  classes: 'เริ่มจากเพิ่มห้องเรียนก่อนครับ เช่น ป.1 ป.2 หรือ ม.1/1',
  classesBtn: 'ไปเพิ่มห้องเรียน',
  teachers: 'เพิ่มรายชื่อครูครับ คัดลอกจาก Excel หรือ LINE มาวางทีเดียวทั้งโรงเรียนก็ได้',
  teachersBtn: 'ไปเพิ่มครู',
  subjects: 'ยังไม่มีวิชาครับ กด “เพิ่มจากหลักสูตรแกนกลาง” ได้วิชาพร้อมคาบ/สัปดาห์เลย',
  subjectsBtn: 'ไปเพิ่มวิชา',
  assignments: 'บอกระบบว่าใครสอนวิชาอะไร ห้องไหน กี่คาบครับ ขั้นนี้ขั้นเดียวแล้วจัดได้เลย',
  assignmentsBtn: 'ไปกรอกการสอน',
  noTeacher: (n) => `ยังมีการสอน ${n} แถวที่ยังไม่มีครูครับ กด “เติมครูอัตโนมัติ” ระบบเลือกครูให้ แล้วแก้เฉพาะแถวที่ไม่ใช่`,
  noTeacherBtn: (n) => `ไปเติมครู (${n} แถว)`,
  issues: (n, first) => `ตรวจพบ ${n} จุดที่ทำให้จัดได้ไม่ครบครับ เริ่มที่ข้อแรก: ${first}`,
  issuesBtn: 'ดูวิธีแก้',
  solve: (n) => `ข้อมูลพร้อมแล้วครับ ${n} คาบ/สัปดาห์ กด “จัดอัตโนมัติ” ระบบวางให้ภายในไม่กี่วินาที`,
  solveBtn: 'จัดอัตโนมัติ',
  left: (n) => `ยังเหลือ ${n} คาบที่ยังไม่ได้วางครับ เลือก “จัดเฉพาะที่ยังขาด” คาบเดิมจะอยู่ที่เดิม หรือลากวางเองก็ได้`,
  leftBtn: 'จัดส่วนที่เหลือ',
  done: 'ตารางครบทุกคาบแล้วครับ พร้อมพิมพ์เป็น PDF หรือ Excel ลากคาบเพื่อปรับต่อได้เสมอ',
  doneBtn: 'ไปส่งออก',
  doneHere: 'ดาวน์โหลดได้เลยครับ แนวตารางเปลี่ยนได้ด้านบน · ถ้าระบบช่วยได้ เลี้ยงโอวัลตินครูแจ็กได้ท้ายหน้านี้',
  hide: 'ซ่อนผู้ช่วย',
  open: 'เปิดผู้ช่วยครูบูรณ์',
  close: 'ปิด',
  name: 'ครูบูรณ์',
};

// ท่าต่อสถานะ (ไม่มีภาพ thinking — ใช้ point + แถบความคืบหน้าแทน)
const POSE = { idle: 'boon-point-420.webp', next: 'boon-point-420.webp', thinking: 'boon-point-420.webp', celebrate: 'boon-celebrate-420.webp', comfort: 'boon-comfort-420.webp' };
const BUST = 'boon-bust-160.webp';
const SIZE = { [BUST]: [160, 160] }; // ไฟล์อื่น 420×630
const TONE = { idle: 'ok', next: 'next', thinking: 'busy', celebrate: 'ok', comfort: 'warn' };
const STICKY = new Set(['thinking', 'celebrate', 'comfort']);
const OFF_KEY = 'tt:boonOff';
const CONFETTI_GAP = 60000; // ฉลองพร้อมคอนเฟตติไม่เกิน 1 ครั้ง/นาที

const files = globalThis.window?.TT?.mascot || {}; // { ชื่อไฟล์: เวลาแก้ไฟล์ } เฉพาะไฟล์ที่มีจริง (app.php ใส่ให้)
const failed = new Set();
/** URL ภาพพร้อม ?v · ไม่มีไฟล์/โหลดไม่ได้ = null */
export function src(file) {
  return files[file] && !failed.has(file) ? `assets/mascot/${file}?v=${files[file]}` : null;
}
/** <img> bust สำหรับ empty state (data.js) · ไม่มีไฟล์ = '' */
export function bustImg(cls = 'boon-bust') {
  const u = src(BUST);
  return u ? `<img class="${cls}" src="${u}" width="160" height="160" alt="" loading="lazy" decoding="async">` : '';
}

// เทสต์ใน node (tests/solver.test.mjs import board.js) ไม่มี DOM เต็ม → ทุกอย่างที่แตะหน้าเว็บต้องมีทางสำรอง
const mm = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false });
const byId = (id) => (typeof document.getElementById === 'function' ? document.getElementById(id) : null);
const mqSmall = mm('(max-width: 639.98px)');
const mqCalm = mm('(prefers-reduced-motion: reduce)');
const conn = globalThis.navigator?.connection;
const saveData = () => !!conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''));
const still = () => mqCalm.matches || !!document.documentElement?.classList.contains('tt-still');
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* โหมดส่วนตัว: จำแค่หน้านี้ */ } };

let el = null, card, fig, layers, msgEl, actsEl, prog, fab, fabDot;
let state = 'idle', key = '', acts = [], stickyTerm = 0, stale = false;
let off = lsGet(OFF_KEY) === '1', sheet = false, mode = '';
let active = 0, curFile = '', swapTok = 0, lastConfetti = 0;

/** วางโครง #boon ครั้งเดียว (ไม่ innerHTML ซ้ำ ภาพ/แอนิเมชันจึงไม่เริ่มใหม่) */
function mount() {
  if (el) return true;
  el = byId('boon');
  if (!el) return false;
  el.innerHTML = `<div class="boon-card" role="region" aria-label="${T.name} ผู้ช่วย">
      <div class="boon-fig" aria-hidden="true"><img alt="" decoding="async"><img alt="" decoding="async"></div>
      <div class="boon-body"><p class="boon-msg" aria-live="polite"></p><div class="boon-acts"></div><div class="progress boon-prog" hidden><i></i></div></div>
      <button type="button" class="boon-x" aria-label="${T.hide}" title="${T.hide}"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg></button>
      <div class="boon-confetti" aria-hidden="true"></div>
    </div>
    <button type="button" class="boon-fab" aria-label="${T.open}" title="${T.name}">${bustImg('boon-fab-img')}<span class="boon-dot" hidden></span></button>`;
  card = el.querySelector('.boon-card');
  fig = el.querySelector('.boon-fig');
  layers = [...fig.querySelectorAll('img')];
  msgEl = el.querySelector('.boon-msg');
  actsEl = el.querySelector('.boon-acts');
  prog = el.querySelector('.boon-prog');
  fab = el.querySelector('.boon-fab');
  fabDot = el.querySelector('.boon-dot');
  if (!fab.querySelector('img')) fab.insertAdjacentHTML('afterbegin', '<span class="boon-fab-txt" aria-hidden="true">บูรณ์</span>');
  // ยังไม่มีภาพที่โหลดสำเร็จ: มีไฟล์ภาพ = จองที่ไว้แบบมองไม่เห็น (ภาพโหลดเสร็จแล้วการ์ดไม่สูงขึ้น ไม่เกิด CLS) · ไม่มีไฟล์เลย = ซ่อน
  if (Object.keys(files).length) fig.style.visibility = 'hidden'; else fig.hidden = true;
  actsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const a = b && acts[+b.dataset.act];
    if (!a) return;
    if (mqSmall.matches) setSheet(false);
    if (a.run) a.run();
    if (a.go) goto(a.go, a.then);
  });
  el.querySelector('.boon-x').addEventListener('click', () => {
    if (mqSmall.matches) { setSheet(false); return; }
    off = true; lsSet(OFF_KEY, '1'); applyMode();
    fab.focus();
  });
  fab.addEventListener('click', () => {
    if (mqSmall.matches) { setSheet(!sheet); return; }
    off = false; lsSet(OFF_KEY, ''); applyMode();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) setSheet(false); });
  mqSmall.addEventListener?.('change', () => { sheet = false; applyMode(); showPose(); });
  return true;
}

function setSheet(on) {
  sheet = on;
  fabDot.hidden = true;
  applyMode();
  if (on) card.querySelector('[data-act], .boon-x')?.focus({ preventScroll: true });
}

/** inline = การ์ดใต้แถบขั้นตอน · fab = ปุ่มกลมมุมขวาล่าง (มือถือ หรือกดซ่อน) · sheet = มือถือกดปุ่มกลมแล้วกางการ์ดขึ้นมา */
function applyMode() {
  const m = mqSmall.matches ? (sheet ? 'sheet' : 'fab') : off ? 'fab' : 'inline';
  fab.setAttribute('aria-expanded', String(m !== 'fab'));
  fab.setAttribute('aria-label', m === 'sheet' ? T.close : T.open);
  if (m === mode) return;
  const was = mode;
  mode = m;
  el.dataset.mode = m;
  // กระดานแสดงกล่อง "เริ่มต้น" แทนเมื่อผู้ช่วยไม่ได้แสดงเป็นการ์ด → กดซ่อน/เปิด/หมุนจอ ให้ board.js วาดใหม่
  if (was && (was === 'inline') !== (m === 'inline')) document.dispatchEvent(new CustomEvent('tt:boon', { detail: { shown: m === 'inline' } }));
  showPose();
}

/** ผู้ช่วยแสดงเป็นการ์ดเหนือตารางอยู่ไหม (board.js ใช้ตัดกล่องแนะนำที่ซ้ำกัน) */
export function shown() {
  return !mqSmall.matches && !off && !!byId('boon'); // รู้ได้ก่อนวางโครง (กระดานวาดก่อนผู้ช่วยครั้งแรก)
}

// ---------- ภาพ: crossfade 2 ชั้น (ชั้นใหม่โหลดเสร็จก่อนจึงสลับ ไม่กะพริบ) ----------
function fileFor(s) {
  return mqSmall.matches || saveData() ? BUST : POSE[s];
}
function showPose() {
  if (!el) return;
  let file = fileFor(state);
  if (!src(file)) file = src(POSE.next) && !mqSmall.matches ? POSE.next : BUST; // ท่านี้ไม่มีไฟล์ → ท่าหลัก → bust
  if (file === curFile) return;
  if (!src(file)) { if (!curFile) noFig(); return; } // ไม่มีไฟล์ไหนใช้ได้เลย → ไม่เหลือช่องว่างค้างในการ์ด
  const tok = ++swapTok;
  const img = layers[active ^ 1];
  const [w, h] = SIZE[file] || [420, 630];
  let settled = false;
  const fin = (ok) => {
    if (settled || tok !== swapTok) return;
    settled = true;
    if (!ok) { failed.add(file); if (!curFile) showPose(); return; } // ยังไม่มีภาพที่ขึ้นจอ → ลองท่าสำรอง (ท่าหลัก → bust) หมดแล้วซ่อน
    layers[active].classList.remove('on');
    img.classList.add('on');
    active ^= 1;
    curFile = file;
    fig.dataset.bust = file === BUST ? '1' : '';
    fig.hidden = false;
    fig.style.visibility = '';
  };
  img.onload = () => fin(true);
  img.onerror = () => fin(false);
  img.width = w; img.height = h;
  img.src = src(file);
  if (img.complete && img.naturalWidth) fin(true);
}

/** ซ่อนกรอบภาพที่จองไว้ (visibility:hidden ยังกินที่ 92×100) เมื่อไม่มีภาพที่โหลดได้ */
function noFig() {
  fig.hidden = true;
  fig.style.visibility = '';
}

/** โหลดท่าล่วงหน้า (เช่น เริ่มกดจัด → celebrate + comfort) · มือถือ/ประหยัดเน็ตไม่โหลด */
export function preload(...states) {
  if (mqSmall.matches || saveData()) return;
  for (const s of states) { const u = src(POSE[s]); if (u) new Image().src = u; }
}

// ---------- ตั้งสถานะ ----------
/**
 * set(state, { msg, step?, acts?: [{ label, primary?, run?: fn, go?: tt:goto detail, then?: 'solve'|'fix' }] })
 * เทียบ key ก่อน: ข้อความ/ท่าเดิม = ไม่แตะ DOM (ลากคาบ 20 ครั้ง ภาพไม่สะดุด)
 */
export function set(s, o = {}) {
  if (!mount() || !POSE[s]) return;
  const k = s + '|' + (o.step || '') + '|' + (o.msg || '') + '|' + (o.acts || []).map((a) => a.label).join('/');
  const prev = state;
  state = s;
  stale = false;
  if (STICKY.has(s)) stickyTerm = store.termId;
  acts = o.acts || [];
  showPose(); // ไฟล์เดิม = ไม่ทำอะไร
  if (k === key) return;
  key = k;
  card.dataset.tone = TONE[s];
  msgEl.innerHTML = (o.step ? `<span class="boon-step">${esc(o.step)}</span> ` : '') + esc(o.msg || '');
  // wizard = ปุ่มเปิดตัวช่วยเริ่มต้น (app.js จับคลิก [data-open-wizard] ทั้งหน้าอยู่แล้ว)
  actsEl.innerHTML = acts.map((a, i) => `<button type="button" class="btn btn-sm${a.primary ? ' btn-primary' : ''}" ${a.wizard ? 'data-open-wizard' : `data-act="${i}"`}>${esc(a.label)}</button>`).join('');
  actsEl.hidden = !acts.length;
  prog.hidden = s !== 'thinking';
  if (s === 'thinking') progress(0);
  if (prev !== s) {
    if (s === 'celebrate') celebrate();
    // มือถือ: การ์ดหุบอยู่ → จุดบนปุ่มกลมบอกว่ามีเรื่องใหม่ (ฉลอง/ติดปัญหา)
    if (mode === 'fab' && (s === 'celebrate' || s === 'comfort')) { fabDot.hidden = false; pop(fab); }
  }
}

/** แถบความคืบหน้าทองระหว่างจัด (0–1) */
export function progress(pct) {
  if (!prog) return;
  prog.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, pct || 0)) * 100) + '%';
}

/** กลับไปบอกขั้นต่อไปจากข้อมูล (เช่น กดหยุดจัด) */
export function refresh() {
  stale = true;
  update();
}

function pop(node) {
  if (still()) return;
  node.classList.remove('boon-pop');
  void node.offsetWidth; // เริ่มแอนิเมชันใหม่
  node.classList.add('boon-pop');
  node.addEventListener('animationend', () => { node.classList.remove('boon-pop'); }, { once: true });
}

/** ฉลอง: ท่า pop ครั้งเดียว + คอนเฟตติ 24 ชิ้น (ไม่เกิน 1 ครั้ง/นาที · ปิดเมื่อลดการเคลื่อนไหว/หยุดภาพเคลื่อนไหว) */
function celebrate() {
  pop(fig);
  const now = Date.now();
  if (still() || mode === 'fab' || now - lastConfetti < CONFETTI_GAP) return;
  lastConfetti = now;
  const box = card.querySelector('.boon-confetti');
  box.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="left:${(i * 37 + 7) % 100}%"></i>`).join('');
  setTimeout(() => { box.innerHTML = ''; }, 2400);
}

// ---------- ขั้นต่อไปจากข้อมูลจริง (เกณฑ์เดียวกับแถบขั้นตอนใน app.js: 1 ครู → 2 ใครสอนอะไร → 3 ตรวจ → 4 จัด) ----------
const curTab = () => document.querySelector('.tabs [aria-selected="true"]')?.dataset.tab || 'board';
function goto(detail, then) {
  document.dispatchEvent(new CustomEvent('tt:goto', { detail }));
  const b = byId('tab-board');
  if (then === 'solve') b?.querySelector('#auto-solve')?.click(); // ยังไม่มีคาบ = จัดทันที · มีแล้ว = เปิดเมนูเลือกแบบ
  if (then === 'fix') requestAnimationFrame(() => { b?.querySelector('.callout')?.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' }); });
}

function nextStep(d) {
  const lessons = d.term.periods.filter((p) => p.type !== 'break').length;
  const asg = d.assignments;
  if (!d.classes.length && !d.teachers.length && !asg.length) {
    return { msg: T.blank, acts: [{ label: T.blankBtn, primary: true, wizard: true }], blank: true };
  }
  if (!lessons) return { msg: T.periods, acts: [{ label: T.periodsBtn, go: { tab: 'periods' } }] };
  if (!d.classes.length) return { msg: T.classes, acts: [{ label: T.classesBtn, go: { tab: 'data', section: 'classes' } }] };
  if (!d.teachers.length) return { step: 'ขั้น 1', msg: T.teachers, acts: [{ label: T.teachersBtn, go: { tab: 'data', section: 'teachers' } }] };
  if (!d.subjects.length) return { step: 'ขั้น 2', msg: T.subjects, acts: [{ label: T.subjectsBtn, go: { tab: 'data', section: 'subjects' } }] };
  if (!asg.length) return { step: 'ขั้น 2', msg: T.assignments, acts: [{ label: T.assignmentsBtn, go: { tab: 'data', section: 'assignments' } }] };
  const noTeacher = asg.filter((a) => !a.teacherId).length;
  if (noTeacher) return { step: 'ขั้น 2', msg: T.noTeacher(noTeacher), acts: [{ label: T.noTeacherBtn(noTeacher), go: { tab: 'data', section: 'assignments', filter: 'noTeacher' } }] };
  const left = asg.reduce((n, a) => n + remaining(a), 0);
  let issues = [];
  if (left) { try { issues = board.readiness().filter((x) => x.code !== 'NO_TEACHER'); } catch { /* ข้อมูลยังไม่ครบ */ } }
  if (issues.length) return { step: 'ขั้น 3', msg: T.issues(issues.length, issues[0].text), acts: [{ label: T.issuesBtn, go: { tab: 'board' }, then: 'fix' }] };
  if (left && !d.placements.length) return { step: 'ขั้น 4', msg: T.solve(asg.reduce((n, a) => n + (a.perWeek || 0), 0)), acts: [{ label: T.solveBtn, primary: true, go: { tab: 'board' }, then: 'solve' }] };
  if (left) return { step: 'ขั้น 4', msg: T.left(left), acts: [{ label: T.leftBtn, go: { tab: 'board' }, then: 'solve' }] };
  if (curTab() === 'export') return { msg: T.doneHere, acts: [], idle: true };
  return { msg: T.done, acts: [{ label: T.doneBtn, go: { tab: 'export' } }], idle: true };
}

function update() {
  if (!mount()) return;
  const d = store.doc;
  if (!d) { el.hidden = true; return; }
  if (el.hidden) { el.hidden = false; applyMode(); }
  if (STICKY.has(state) && !stale && stickyTerm === store.termId) return; // ระหว่างจัด/ผลการจัดค้างไว้จนกว่าจะแก้ข้อมูล
  const n = nextStep(d);
  el.dataset.blank = n.blank ? '1' : ''; // ภาคเรียนว่าง: ปุ่มตัวช่วยในแถบขั้นตอนซ่อน (ใช้ปุ่มของครูบูรณ์ปุ่มเดียว)
  // ปุ่มพาไปแท็บที่เปิดอยู่แล้ว (ไม่มีหมวดย่อย) ไม่ต้องแสดง — เช่น อยู่หน้ากระดานแล้ว ปุ่มจัด/รายการวิธีแก้อยู่ในกล่องใต้ผู้ช่วยแล้ว
  const tab = curTab();
  const a = (n.acts || []).filter((x) => !(x.go && !x.go.section && x.go.tab === tab));
  set(n.idle ? 'idle' : 'next', { msg: n.msg, step: n.step, acts: a });
}

// ทุกครั้งที่ app.js วาดแถบขั้นตอนใหม่ (โหลด/สลับภาคเรียน, สลับแท็บ, ทุก commit) = จังหวะคำนวณขั้นต่อไปใหม่
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; update(); });
}
store.onChange((reason) => {
  // แก้ข้อมูลหลังจัดเสร็จ = ผลการจัดที่ค้างอยู่หมดความหมาย กลับไปบอกขั้นต่อไป (ระหว่างจัดไม่ยกเลิก)
  if ((state === 'celebrate' || state === 'comfort') && reason !== 'solve') stale = true;
  schedule();
});
const watchSteps = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
function hookSteps() {
  if (!watchSteps) return true;
  const nav = byId('tt-steps');
  if (!nav) return false;
  watchSteps.observe(nav, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  return true;
}
if (!hookSteps()) {
  // แถบขั้นตอนถูกสร้างตอน app.js วาดแท็บครั้งแรก → รอให้มันเกิดแล้วค่อยผูก
  const app = byId('app');
  if (app) {
    const wait = new MutationObserver(() => { if (hookSteps()) { wait.disconnect(); schedule(); } });
    wait.observe(app, { childList: true });
  }
}
