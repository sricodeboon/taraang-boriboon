// บอร์ดจัดตาราง: มุมมองห้อง/ครู/ห้องพิเศษ, ลากวาง (เมาส์+นิ้ว), ตรวจชนทันที, จัดอัตโนมัติ
import {
  store, idx, DAY_NAMES, remaining, isBreak, lockAt, teacherUnavailable, placementsAt, whyCannotPlace,
  localValidate, CONFLICT_TEXT, esc, assignmentLabel,
} from './store.js';
import { gridModel, orientation, ORIENTS } from './rules.js';
import * as notify from './notify.js';
import * as mascot from './mascot.js';
import * as motion from './motion.js';

let view = 'class';
let selected = { class: null, teacher: null, room: null };
let validator = null;       // validate() จาก solver.js ถ้ามี
let conflicts = [];
let solving = null;          // Worker ที่กำลังจัด
let lastSolve = null;        // { termId, sec, placed, unplaced[], warnings[], error } ผลการจัดครั้งล่าสุด แสดงค้างเหนือตาราง
let hideReport = false;      // ผู้ใช้กดปิดกล่องรายงานผลการจัด
let root = null;
let busy = null;             // toast "กำลังจัดตาราง" (notify.loading)
// ฉากจัดอัตโนมัติ (ขั้นต่ำ 1.2 วิ แต่ไม่หน่วงข้อมูล): null = ไม่มีฉาก · ดู startScene()/finishScene()
// phase: 'run' (worker กำลังจัด) → 'pre' (ผลเข้า store แล้ว คาบใหม่ซ่อนรอจังหวะ) → 'reveal' (render รอบเผย) → 'landing' (CSS กำลังเล่น) → จบ
let scene = null;
let reportAnim = false;      // ผลจัดใหม่: callout เข้า m-in + รายการไล่ทีละข้อ (ครั้งเดียว ไม่เล่นซ้ำทุกครั้งที่วาดกระดาน)
let landPl = null;           // คาบที่เพิ่งลากวาง → render รอบถัดไปให้ลง m-land ชิ้นเดียว
let tbMoreOpen = false;      // เมนู ⋯ ของแถบเครื่องมือบนมือถือ (คงสถานะข้ามการวาดใหม่)
let renderPhase = null;      // ระหว่าง render: 'pre' | 'reveal' (ฉากจัด) | 'finish' (วาดรายงานหลังจบฉาก) — ตัวเลขในรายงานเริ่มที่ 0 แล้วนับขึ้น
let finishFx = null;         // render รอบแรกหลังจบฉาก: { hadOv } → รายงาน/ภาพรวมเข้าแบบนุ่ม + ตารางเลื่อนลงแบบ FLIP (ไม่กระโดด)
const MIN_SCENE = 1200;      // ms ตั้งแต่กดจัดจนตารางเริ่มลง
// จอแคบ (ตรงกับ @media (max-width:640px) ใน board.css) · node ไม่มี matchMedia → ถือเป็นจอกว้าง
const mqSmall = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(max-width: 640px)') : { matches: false };
const small = () => !!mqSmall.matches;
// ตัวนับสำหรับ e2e (?dbg=1): whyCannotPlace ต่อการลาก ต้องไม่เกิน 1 ครั้ง/ช่อง
const dbg = { why: 0, cells: 0, drags: 0 };
try { if (/(^|[?&])dbg=1/.test(globalThis.location?.search || '')) globalThis.__tt_dbg = dbg; } catch { /* node */ }

// validate() จาก solver.js (60KB) โหลดหลังหน้าแสดงผลแล้ว ระหว่างนั้นใช้ localValidate() ใน store.js
const loadValidator = () => import('./solver/solver.js').then((m) => { if (typeof m.validate === 'function') { validator = m.validate; if (root) render(root); } }).catch(() => {});
if (document.readyState === 'complete') setTimeout(loadValidator, 300);
else window.addEventListener('load', () => setTimeout(loadValidator, 300), { once: true });

export function solverInput(fixedOnly = true) {
  const d = store.doc;
  return {
    days: d.term.days,
    periods: d.term.periods.map((p) => ({ type: p.type })),
    classes: d.classes.map((c) => ({ id: c.id, name: c.name })),
    teachers: d.teachers.map((t) => ({ id: t.id, name: t.name, maxPerDay: t.maxPerDay || 0, unavailable: t.unavailable || [] })),
    rooms: d.rooms.map((r) => ({ id: r.id, name: r.name })),
    assignments: d.assignments.filter((a) => idx.cls.has(a.classId) && idx.tch.has(a.teacherId))
      // subjectId: ให้ soft "วิชาเดียวกันวันเดียวกัน/วันติดกัน" นับรวมแถวแบ่งสอน (วิชาเดียว 2 ครู) · label: ข้อความชนบอกชื่อกิจกรรม
      .map((a) => ({ id: a.id, subjectId: a.subjectId, classId: a.classId, teacherId: a.teacherId, roomId: a.roomId || null, perWeek: a.perWeek || 0, doubles: a.doubles || 0 })),
    locks: d.locks.map((l) => ({ classId: l.classId ?? null, day: l.day, period: l.period, label: l.label })),
    fixed: d.placements.filter((p) => !fixedOnly || p.pinned).map((p) => ({ assignmentId: p.assignmentId, day: p.day, period: p.period })),
  };
}

function computeConflicts() {
  try {
    conflicts = validator ? validator(solverInput(false), store.doc.placements) : localValidate();
    if (!Array.isArray(conflicts)) conflicts = localValidate();
  } catch (e) {
    console.warn('validate ล้มเหลว ใช้ตัวตรวจสำรอง', e);
    conflicts = localValidate();
  }
}

function entities() {
  const d = store.doc;
  return view === 'class' ? d.classes : view === 'teacher' ? d.teachers : d.rooms;
}

function currentId() {
  const list = entities();
  if (!list.some((e) => e.id === selected[view])) selected[view] = list[0]?.id ?? null;
  return selected[view];
}

function relevantAssignments(id) {
  return store.doc.assignments.filter((a) => (view === 'class' ? a.classId : view === 'teacher' ? a.teacherId : a.roomId) === id);
}

function cellConflict(cellPlacements, day, period) {
  if (!cellPlacements.length) return [];
  const ids = new Set();
  for (const p of cellPlacements) {
    const a = idx.asg.get(p.assignmentId);
    ids.add(p.assignmentId); if (a) { ids.add(a.classId); ids.add(a.teacherId); if (a.roomId) ids.add(a.roomId); }
  }
  return conflicts.filter((c) => c.day === day && c.period === period && (c.ids || []).some((x) => ids.has(x)));
}

// ---------- วาด ----------
const VIEW_NAME = { class: 'ห้องเรียน', teacher: 'ครู', room: 'ห้องพิเศษ' };
const hardText = (n) => (n ? `ชน ${n} จุด` : 'ไม่มีจุดชน');
const leftText = (n) => `เหลือจัด ${n} คาบ`;

/** el = #tab-board · o.reveal ใช้ภายใน (ฉากจัด) · app.js เรียก render(el) ทุก commit */
export function render(el) {
  root = el;
  const d = store.doc;
  computeConflicts();
  const id = currentId();
  const list = entities();
  const noun = VIEW_NAME[view];
  const totalLeft = d.assignments.reduce((s, a) => s + remaining(a), 0);
  const hard = conflicts.length;
  const sm = small();
  syncUndo(); // เปลี่ยนภาคเรียน/รวมการแก้ไข = เอกสารใหม่ทั้งก้อน → ตั้งฐานของสแต็กเลิกทำใหม่
  bindRootOnce(el);
  syncBar();
  // ฉาก: 'reveal' ถูกใช้ครั้งเดียว (render รอบนี้ใส่ m-land) แล้วกลายเป็น 'landing' → การวาดใหม่ระหว่างนั้นไม่เล่นซ้ำ
  const sc = scene && scene.termId === store.termId ? scene : null;
  const revealing = sc?.phase === 'reveal';
  const showOld = sc && (sc.phase === 'pre' || revealing); // ตัวเลข/ชิปยังเป็นค่าก่อนจัด แล้วค่อยนับ/จางไปค่าใหม่
  if (revealing) sc.phase = 'landing';
  renderPhase = showOld ? (revealing ? 'reveal' : 'pre') : finishFx ? 'finish' : null;
  const pills = `<span class="pill ${hard ? 'warn' : 'ok'}" id="pill-hard" title="จำนวนจุดที่ชนทั้งโรงเรียน">${hardText(showOld ? sc.prevHard : hard)}</span>
      <span class="pill" id="pill-left">${leftText(showOld ? sc.prevLeft : totalLeft)}</span>`;
  const viewSeg = `<div class="seg" role="group" aria-label="มุมมอง">
        ${['class', 'teacher', 'room'].map((v) => `<button data-view="${v}" aria-pressed="${v === view}">${VIEW_NAME[v]}</button>`).join('')}
      </div>`;
  const orient = `<div class="orient" role="group" aria-label="แนวตาราง"><span class="lbl">แนวตาราง</span>
        <div class="seg orient-seg">${ORIENTS.map(([k, t]) => `<button data-orient="${k}" aria-pressed="${k === orientation(d)}" title="${k === 'days' ? 'แถว = วัน คอลัมน์ = คาบ' : 'แถว = คาบ คอลัมน์ = วัน'}">${t}</button>`).join('')}</div></div>`;
  const ent = `<select id="ent-select" class="input input-sm" aria-label="เลือก${noun}">
        ${list.map((e) => `<option value="${esc(e.id)}" ${e.id === id ? 'selected' : ''}>${esc(e.name)}</option>`).join('') || `<option>ยังไม่มี${noun}</option>`}
      </select>`;
  const prog = `<div class="progress" id="solve-progress" ${sc ? '' : 'hidden'} aria-hidden="true"><i style="transform:scaleX(${sc ? sc.p.toFixed(3) : 0})"></i></div>`;
  const undoTip = undoStack.length ? `เลิกทำ${UNDO_TEXT[undoStack[undoStack.length - 1].reason] || ''} (Ctrl+Z · ย้อนได้ ${undoStack.length} ขั้น)` : 'ยังไม่มีอะไรให้เลิกทำ';
  const undo = `<button class="btn btn-sm" id="undo-board" ${undoStack.length && !solving ? '' : 'disabled'} aria-keyshortcuts="Control+Z Meta+Z" title="${undoTip}">↶<span class="${sm ? 'tb-txt-sr' : ''}"> เลิกทำ</span></button>`;
  const clear = `<button class="btn btn-sm" id="clear-auto" title="ลบคาบที่ไม่ได้ปักหมุดทั้งโรงเรียน">ล้างที่ไม่ปักหมุด</button>`;
  // ระหว่างจัด: ปุ่มเดียวกันเป็น "หยุดจัด" (.btn-busy วงหมุนจาก app.css) กว้างเท่าเดิม ปุ่มข้าง ๆ ไม่ขยับ
  const solveBtn = `<button class="btn btn-primary btn-sm${solving ? ' btn-busy' : ''}" id="auto-solve" ${solving || !d.placements.length ? '' : 'aria-haspopup="menu"'}${solving && sc?.btnW ? ` style="min-width:${sc.btnW}px"` : ''}>${solving ? 'หยุดจัด' : d.placements.length ? 'จัดอัตโนมัติ ▾' : 'จัดอัตโนมัติ'}</button>`;
  // มือถือ: 2 แถว (มุมมอง + รายการ · ปุ่มจัดเต็มกว้าง + เลิกทำ + ⋯) · ป้ายชน/เหลือจัดย้ายไปใต้ตาราง
  const toolbar = sm
    ? `<div class="toolbar tb-m">
        <div class="tb-row tb-view">${viewSeg}${ent}</div>
        <div class="tb-row tb-act">${solveBtn}${undo}
          <details class="tb-more" ${tbMoreOpen ? 'open' : ''}><summary aria-label="เครื่องมือเพิ่มเติม" title="เครื่องมือเพิ่มเติม"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></summary>
            <div class="tb-pop">${clear}${orient}</div></details>
          ${prog}</div>
      </div>`
    : `<div class="toolbar">
        ${viewSeg}${orient}${ent}${pills}
        <span class="spacer"></span>
        ${prog}${undo}${clear}${solveBtn}
      </div>`;

  // ระหว่างฉาก (จัด → รอเผย → เผย): ส่วนเหนือตารางคงเหมือนก่อนกดจัด (กติกา §1 สิ่งที่ไหลเข้าต้องจองที่ก่อน)
  // รายงาน/ลองอีกแบบ/ภาพรวมที่เพิ่งเกิด วาดใน finishScene หลังฉลอง → ตารางไม่กระโดดระหว่างผู้ใช้กำลังดูคาบลง
  const frz = sc && sc.frozen && sc.phase !== 'none' ? sc.frozen : null;
  let top, ov;
  if (frz) {
    fixActs = []; // ปุ่มในส่วนที่แช่ไว้กดไม่ได้ (inert) — ดัชนีเดิมไม่ต้องคงไว้
    top = frz.top;
    const oo = { open: frz.ovOpen, score: frz.score };
    if (!frz.hasOv) ov = '';
    else if (sc.phase === 'run') ov = frz.ov = overviewHTML(sc, false, oo); // ข้อมูลยังเป็นของเดิม (สลับมุมมองได้)
    else if (sc.phase === 'pre') ov = frz.ov; // ผลใหม่เข้า store แล้ว แต่ยังไม่ถึงจังหวะเผย → ภาพเดิม
    else ov = overviewHTML(sc, revealing, oo); // เผย: แถวเท่าเดิม กาง/หุบเท่าเดิม = สูงเท่าเดิม
    sc.frozenDrawn = true;
  } else {
    const fx = finishFx;
    top = guideHTML(totalLeft) + solveExtraHTML(!!fx);
    ov = overviewHTML(sc, revealing, fx && !fx.hadOv ? { enter: true } : {});
    if (sc) sc.frozenDrawn = false;
  }
  el.innerHTML = `
    ${toolbar}
    <div class="tt-top"${frz ? ' inert' : ''}>${top}</div>
    ${ov}
    <div class="board">
      <aside class="card palette" id="palette">${paletteHTML(id, showOld ? sc : null)}</aside>
      <div>
        <div class="card grid-wrap">${gridHTML(id, sc, revealing)}</div>
        ${sm ? `<div class="tb-pills">${pills}</div>` : ''}
        ${issuesHTML()}
      </div>
    </div>`;
  landPl = null;
  renderPhase = null;

  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(el); }));
  el.querySelectorAll('[data-orient]').forEach((b) => b.addEventListener('click', () => {
    if (orientation(d) === b.dataset.orient) return;
    tbMoreOpen = false;
    d.settings.orientation = b.dataset.orient;
    store.commit('settings'); // วาดใหม่ผ่าน onChange + บันทึกเป็นค่าของภาคเรียน (ใช้กับ PDF/Excel ด้วย)
  }));
  el.querySelector('.tb-more')?.addEventListener('toggle', (e) => { tbMoreOpen = e.currentTarget.open; });
  el.querySelector('#ent-select')?.addEventListener('change', (e) => { selected[view] = e.target.value; render(el); });
  el.querySelector('#auto-solve').addEventListener('click', (e) => openSolveMenu(e.currentTarget));
  el.querySelector('#auto-solve-2')?.addEventListener('click', () => autoSolve('all')); // แสดงเฉพาะตอนยังไม่มีคาบในตาราง → ไม่ต้องเลือกแบบ
  el.querySelector('#undo-board').addEventListener('click', undoBoard);
  el.querySelectorAll('[data-solve]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.solve;
    if (k === 'again') tryAnother(); else if (k === 'back') backVariant(); else autoSolve(k);
  }));
  el.querySelectorAll('[data-tview]').forEach((b) => b.addEventListener('click', () => { view = 'teacher'; selected.teacher = b.dataset.tview; render(el); }));
  el.querySelectorAll('[data-ov-ent]').forEach((g) => {
    const pick = () => { if (view === 'room') view = 'class'; selected[view] = g.dataset.ovEnt; render(el); el.querySelector('.grid-wrap')?.scrollIntoView({ behavior: motion.still() ? 'auto' : 'smooth', block: 'nearest' }); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  el.querySelector('#solve-score')?.addEventListener('toggle', (e) => { try { localStorage.setItem(SCORE_KEY, e.currentTarget.open ? '1' : '0'); } catch { /* ไม่มีที่เก็บ */ } });
  // จำเฉพาะที่ผู้ใช้กางเอง (คลิก summary) — toggle event ตอนวาดด้วย open ไม่นับ
  el.querySelector('.overview-map > summary')?.addEventListener('click', (e) => { ovOpen = !e.currentTarget.parentElement.open; });
  el.querySelector('#solve-report-close')?.addEventListener('click', () => { hideReport = true; render(el); });
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => gotoData(b.dataset.goto)));
  el.querySelectorAll('[data-clash]').forEach((b) => b.addEventListener('click', () => (b.dataset.clash === 'unpin' ? unpinClashes() : seeClashes())));
  el.querySelector('#clear-auto').addEventListener('click', () => {
    tbMoreOpen = false;
    const gone = d.placements.filter((p) => !p.pinned);
    if (!gone.length) { notify.info('ไม่มีคาบที่ไม่ได้ปักหมุด'); render(el); return; }
    d.placements = d.placements.filter((p) => p.pinned);
    store.commit('clear');
    notify.action(`ล้าง ${gone.length} คาบที่ไม่ได้ปักหมุดแล้ว`, 'เลิกทำ', () => { store.doc.placements.push(...gone); store.commit('undo'); notify.ok('คืนคาบที่ล้างแล้ว'); });
  });
  bindDrag(el);
  afterRender(el, sc, revealing);
}

/** หลังวาด: แท็บเลื่อนได้ไหม · ฉากเผย (นับตัวเลข/ชิปจาง) · รายงานผลใหม่ (รายการไล่เข้า) */
function afterRender(el, sc, revealing) {
  syncTabs();
  if (sc?.ghost && (sc.phase === 'run' || sc.phase === 'pre')) drawGhosts(sc);
  if (revealing) {
    const dur = sc.revealMs || 700;
    const ph = el.querySelector('#pill-hard'), pleft = el.querySelector('#pill-left');
    const tot = store.doc.assignments.reduce((s, a) => s + remaining(a), 0);
    motion.countUp(ph, conflicts.length, { from: sc.prevHard, dur, fmt: hardText });
    motion.countUp(pleft, tot, { from: sc.prevLeft, dur, fmt: leftText });
    if (sc.mapReveal) for (const b of el.querySelectorAll('.ov-nums [data-n]')) motion.countUp(b, +b.dataset.n, { from: 0, dur });
    for (const b of el.querySelectorAll('.callout[data-report] .n-up')) motion.countUp(b, +b.dataset.n, { from: 0, dur });
    // ชิปที่ครบแล้ว: วาดเป็นค่าเดิมก่อน แล้วจาง (transition opacity) พร้อมนับเลขเหลือลง
    const chips = [...el.querySelectorAll('.chip[data-fade]')];
    if (chips.length) {
      requestAnimationFrame(() => chips.forEach((c) => c.classList.add('done')));
      for (const c of chips) { const n = c.querySelector('.n'); if (n) motion.countUp(n, 0, { from: +c.dataset.fade, dur, fmt: (k) => `${k}/${n.dataset.of}` }); }
    }
  }
  if (finishFx) {
    finishFx = null;
    if (!motion.still()) for (const b of el.querySelectorAll('.callout[data-report] .n-up')) motion.countUp(b, +b.dataset.n, { from: 0, dur: 600 });
  }
  if (reportAnim && el.querySelector('.callout[data-report]')) {
    reportAnim = false;
    const ul = el.querySelector('.callout[data-report] ul.m-stagger');
    if (ul) motion.staggerVars(ul, { each: 80, max: 80 * Math.max(1, ul.children.length) });
  }
}

/** ตัวจับที่ผูกกับ #tab-board ครั้งเดียว (render วาด innerHTML ใหม่ แต่ el เดิม) */
let boundRoot = null;
function bindRootOnce(el) {
  if (boundRoot === el) return;
  boundRoot = el;
  // คลิกที่กระดานระหว่างฉากเผย = ข้ามฉาก (ตารางขึ้นครบทันที) · ใช้ click ไม่ใช่ pointerdown จะได้ไม่ตัดการลากที่เพิ่งเริ่ม
  el.addEventListener('click', (e) => { if (scene && scene.result && e.target.closest?.('.board, .overview-map')) skipScene(); }, true);
  // เมนู ⋯ ของแถบเครื่องมือ: แตะนอกเมนู = ปิด
  document.addEventListener('pointerdown', (e) => {
    const m = el.querySelector('.tb-more[open]');
    if (m && !m.contains(e.target)) { m.open = false; tbMoreOpen = false; }
  }, true);
}

/** แท็บบนจอแคบเลื่อนได้อีก → .has-more (เงาจางขอบขวา) · เลื่อนสุดแล้วเงาหาย */
let tabsBound = false;
function syncTabs() {
  const tabs = document.querySelector?.('.tabs');
  if (!tabs) return;
  tabs.classList.toggle('has-more', tabs.scrollWidth > tabs.clientWidth + 2 && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
  if (tabsBound) return;
  tabsBound = true;
  tabs.addEventListener('scroll', syncTabs, { passive: true });
  globalThis.addEventListener?.('resize', syncTabs, { passive: true });
}

/** ส่วนหัว: เมนู ⋯ (.bar-more) เดสก์ท็อปกางเสมอ · มือถือหุบ แตะนอก/กด Esc/เลือกแล้วปิด */
let barBound = false;
function syncBar() {
  const m = document.querySelector?.('.bar-more');
  if (!m) return;
  if (!small()) m.open = true;
  else if (!barBound) m.open = false;
  if (barBound) return;
  barBound = true;
  document.addEventListener('pointerdown', (e) => { if (small() && m.open && !m.contains(e.target)) m.open = false; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && small() && m.open) { m.open = false; m.querySelector('summary')?.focus(); } });
  m.addEventListener('click', (e) => { if (small() && e.target.closest('a[href^="#"]')) m.open = false; });
}
// หน้าแอปเปิดที่แท็บอื่นก่อน (กระดานยังไม่ถูกวาด) ก็ต้องจัดส่วนหัวให้ถูก · node ไม่มี querySelector = ข้าม
if (typeof globalThis.document?.querySelector === 'function') queueMicrotask(() => { syncBar(); syncTabs(); });
mqSmall.addEventListener?.('change', () => {
  tbMoreOpen = false;
  const m = document.querySelector?.('.bar-more');
  if (m) m.open = !small();
  if (root?.isConnected && store.doc) render(root);
});

function paletteHTML(id, old = null) {
  if (!id) return `<p class="empty">ยังไม่มีข้อมูล ไปที่แท็บ <b>ข้อมูล</b> เพื่อเพิ่มห้องเรียน ครู วิชา และการสอน หรือสร้างภาคเรียนจากข้อมูลตัวอย่าง</p>`;
  const list = relevantAssignments(id);
  if (!list.length) return `<h3>วิชาที่ต้องจัด</h3><p class="empty">ยังไม่มีการสอนของรายการนี้ เพิ่มได้ที่แท็บ <b>ข้อมูล → การสอน</b></p>`;
  const sorted = [...list].sort((a, b) => remaining(b) - remaining(a));
  return `<h3>วิชาที่ต้องจัด <span class="muted" style="font-weight:400;font-size:.85rem">ลากไปวางในตาราง</span></h3>` + sorted.map((a) => {
    const L = assignmentLabel(a), left = remaining(a);
    const sub = view === 'class' ? (L.tch?.short || L.tch?.name || '') : (L.cls?.name || '');
    // ระหว่างฉากจัด: แสดงค่าก่อนจัด → afterRender จางชิปที่ครบ + นับเลขลง (ไม่มีฉาก = ค่าจริงทันที)
    const was = old ? old.prevRem.get(a.id) ?? left : left;
    const fade = old && was > 0 && left === 0;
    const shown = old ? was : left;
    return `<div class="chip ${shown ? '' : 'done'}" data-asg="${esc(a.id)}" ${fade ? `data-fade="${was}"` : ''} style="--c:${esc(L.color)}" title="${esc(L.code)} ${esc(L.name)}">
      <span class="t"><b>${esc(L.name)}</b><span>${esc(sub)}${L.room ? ' · ' + esc(L.room.name) : ''}${a.doubles ? ' · คาบคู่ ' + a.doubles : ''}</span></span>
      <span class="n" title="เหลือ/ทั้งหมด" data-of="${a.perWeek}">${shown}/${a.perWeek}</span></div>`;
  }).join('');
}

/** sc = ฉากจัด (ถ้ามี): 'pre' ซ่อนคาบใหม่ · revealing = ใส่ m-land ไล่ตาม (วัน, คาบ) */
function gridHTML(id, sc = null, revealing = false) {
  const d = store.doc;
  const g = gridModel(d);
  const tm = (p) => (p.start && p.end ? `${esc(p.start)}–${esc(p.end)}` : '');
  const headOf = (x) => (x.p ? `<span class="lbl">${x.brk ? esc(x.p.label || 'พัก') : 'คาบ ' + esc(x.p.label || x.period + 1)}</span><span class="tm">${tm(x.p)}</span>` : esc(x.name));
  // คาบที่ "ใหม่" ในรอบจัดนี้ของรายการที่เปิดอยู่ → ลำดับเผยตาม (วัน, คาบ) ไม่ขึ้นกับแนวตาราง
  let rank = null, step = 22;
  if (sc && sc.landKeys && (sc.phase === 'pre' || revealing) && id) {
    const mine = d.placements.filter((p) => sc.landKeys.has(plKey(p)) && placementsAt(view, id, p.day, p.period).includes(p));
    mine.sort((x, y) => x.day - y.day || x.period - y.period);
    rank = new Map(mine.map((p, i) => [p, i]));
    step = Math.min(22, 1100 / Math.max(1, mine.length));
    if (revealing) sc.revealMs = Math.max(sc.revealMs || 0, Math.round(step * Math.max(0, mine.length - 1) + 520));
  }
  let h = `<table class="tt ${g.orient === 'days' ? 'by-day' : 'by-period'}${revealing && rank ? ' m-scene' : ''}" data-orient="${g.orient}"${revealing && rank ? ` style="--step:${step.toFixed(2)}ms"` : ''}><thead><tr><th>${g.corner}</th>${g.cols.map((c) => (c.brk
    ? `<th class="brk-col" title="${esc(c.p.label || 'พัก')} ${tm(c.p)}"></th>` : `<th>${headOf(c)}</th>`)).join('')}</tr></thead><tbody>`;
  g.rows.forEach((r, ri) => {
    if (r.brk) { // คาบเรียงลงล่าง: ช่องพักเต็มแถว
      h += `<tr class="brk"><th>${headOf(r)}</th><td colspan="${g.cols.length}">${esc(r.p.label || 'พัก')}</td></tr>`;
      return;
    }
    h += `<tr><th>${headOf(r)}</th>`;
    for (const c of g.cols) {
      if (c.brk) { // วันเรียงลงล่าง: ช่องพักเต็มคอลัมน์ (วาดครั้งเดียวที่แถวแรก)
        if (ri === 0) h += `<td class="brk-col" rowspan="${g.rows.length}"><span>${esc(c.p.label || 'พัก')}</span></td>`;
        continue;
      }
      const { day, period: pi } = g.at(r, c);
      const lk = view === 'class' && id ? lockAt(id, day, pi) : null;
      const cells = id ? placementsAt(view, id, day, pi) : [];
      const unav = view === 'teacher' && id && teacherUnavailable(id, day, pi);
      if (lk && !cells.length) { h += `<td class="lock" data-day="${day}" data-period="${pi}">🔒 ${esc(lk.label || 'คาบล็อก')}</td>`; continue; }
      h += `<td class="${unav ? 'unavail' : ''}" data-day="${day}" data-period="${pi}">`;
      for (const pl of cells) {
        const a = idx.asg.get(pl.assignmentId), L = assignmentLabel(a);
        const bad = cellConflict([pl], day, pi);
        const sub = view === 'class' ? (L.tch?.short || L.tch?.name || '') : view === 'teacher' ? (L.cls?.name || '') : `${L.cls?.name || ''} · ${L.tch?.short || ''}`;
        const tip = bad.length ? bad.map((x) => CONFLICT_TEXT[x.type] || x.type).join(', ') : `${L.code} ${L.name}`;
        const k = rank?.get(pl);
        const anim = k == null ? (pl === landPl ? ' m-land' : '') : revealing ? ' m-land' : ' m-pre';
        h += `<div class="cell ${bad.length ? 'conflict' : ''}${anim}" data-pl="${d.placements.indexOf(pl)}" style="--c:${esc(L.color)}${k != null && revealing ? `;--i:${k}` : ''}"${k != null ? ' data-m="scene"' : ''} title="${esc(tip)}">
          ${pl.pinned ? '<span class="pin" title="ปักหมุด">📌</span>' : ''}<b>${esc(L.name)}</b><span>${esc(sub)}</span>${L.room && view !== 'room' ? `<span>${esc(L.room.name)}</span>` : ''}</div>`;
      }
      h += `</td>`;
    }
    h += `</tr>`;
  });
  return h + `</tbody></table>`;
}

function issuesHTML() {
  if (!conflicts.length) return '';
  const lines = conflicts.slice(0, 12).map((c) => {
    const where = c.period >= 0 ? `${DAY_NAMES[c.day] || ''} คาบ ${store.doc.term.periods[c.period]?.label ?? c.period + 1}` : DAY_NAMES[c.day] || '';
    const names = (c.ids || []).map((x) => idx.asg.get(x) ? assignmentLabel(idx.asg.get(x)).name + ' (' + (idx.cls.get(idx.asg.get(x).classId)?.name || '') + ')' : (idx.tch.get(x)?.name || idx.cls.get(x)?.name || idx.room.get(x)?.name || '')).filter(Boolean);
    return `<li><b>${esc(CONFLICT_TEXT[c.type] || c.type)}</b> · ${esc(where)}${names.length ? ' · ' + esc(names.join(', ')) : ''}</li>`;
  }).join('');
  return `<div class="card issues"><b style="color:var(--danger)">จุดที่ต้องแก้ ${conflicts.length} จุด</b><ul>${lines}</ul>${conflicts.length > 12 ? `<p class="muted" style="margin:6px 0 0">และอีก ${conflicts.length - 12} จุด</p>` : ''}</div>`;
}

// ---------- ภาพรวมทั้งโรงเรียน (SVG ครั้งเดียวต่อการวาด) ----------
// แถว = ห้องเรียน (มุมมองครู = ครู) · คอลัมน์ = วัน × คาบเรียน · ช่อง 8×8 สีวิชา · ว่าง = เส้นประ · ล็อก = ม่วงอ่อน · ชน = แดง · ค้าง = ทองกะพริบ 3 ครั้ง
let ovOpen = null;           // ผู้ใช้กาง/หุบเอง (null = ค่าเริ่มต้น: เดสก์ท็อปกาง มือถือหุบ)
/** o.open/o.score = คงสภาพกาง/หุบ + กล่องคุณภาพเหมือนก่อนกดจัด (ระหว่างฉาก ความสูงต้องไม่เปลี่ยน) · o.enter = เพิ่งเกิดหลังจบฉาก → เข้าแบบนุ่ม */
export function overviewHTML(sc = null, revealing = false, o = {}) {
  const d = store.doc;
  if (!d?.placements?.length) return '';
  const t0 = globalThis.performance?.now?.() ?? 0;
  const byTeacher = view === 'teacher';
  const rows = byTeacher ? d.teachers : d.classes;
  if (!rows.length) return '';
  const P = d.term.periods.length, D = d.term.days;
  const cols = [];
  for (let day = 0; day < D; day++) for (let p = 0; p < P; p++) if (!isBreak(p)) cols.push({ day, p });
  // ดัชนีครั้งเดียว: (แถว|วัน|คาบ) → คาบที่วาง · ภาระครู · คาบที่ชน
  const at = new Map(), load = new Map(), left = new Map();
  for (const pl of d.placements) {
    const a = idx.asg.get(pl.assignmentId);
    if (!a) continue;
    const r = byTeacher ? a.teacherId : a.classId;
    const k = r + '|' + pl.day + '|' + pl.period;
    const arr = at.get(k);
    if (arr) arr.push(a); else at.set(k, [a]);
    if (a.teacherId) load.set(a.teacherId, (load.get(a.teacherId) || 0) + 1);
  }
  for (const a of d.assignments) {
    const n = remaining(a);
    if (!n) continue;
    const r = byTeacher ? a.teacherId : a.classId;
    if (r) left.set(r, (left.get(r) || 0) + n);
  }
  const badSlot = new Set();
  for (const c of conflicts) for (const x of c.ids || []) badSlot.add(x + '|' + c.day + '|' + c.period);
  const LW = 64, CW = 9, DG = 5, RH = 11, TOP = 14;
  const colX = cols.map((c, i) => LW + i * CW + c.day * DG);
  const maxLeft = Math.min(12, Math.max(0, ...left.values()));
  const W = (colX[colX.length - 1] ?? LW) + CW + (maxLeft ? 6 + maxLeft * CW : 0) + 4;
  const H = TOP + rows.length * RH + 2;
  const dayLbl = Array.from({ length: D }, (_, day) => {
    const i = cols.findIndex((c) => c.day === day);
    return i < 0 ? '' : `<text class="ov-day" x="${colX[i]}" y="10">${esc((DAY_NAMES[day] || '').slice(0, 2))}</text>`;
  }).join('');
  // คอลัมน์ละ <g> → ฉากเผยใช้ m-land ไล่คอลัมน์ (--i) แค่ไม่กี่สิบชิ้น ไม่ใช่พันกว่าช่อง
  const colRects = cols.map(() => []);
  const rowsSvg = [];
  rows.forEach((e, ri) => {
    const y = TOP + ri * RH;
    const cur = e.id === selected[view] || (selected[view] == null && ri === 0);
    rowsSvg.push(`<g class="ov-row${cur ? ' cur' : ''}" data-ov-ent="${esc(e.id)}" tabindex="0" role="button" aria-label="ดูตาราง ${esc(e.name)}"><rect class="ov-hit" x="0" y="${y - 1}" width="${W}" height="${RH}" rx="2"/><text x="2" y="${y + 8}">${esc(String(e.name).slice(0, 10))}</text></g>`);
    cols.forEach((c, ci) => {
      const x = colX[ci];
      const list = at.get(e.id + '|' + c.day + '|' + c.p);
      const where = `${esc(e.name)} · ${esc(DAY_NAMES[c.day] || '')} คาบ ${esc(d.term.periods[c.p]?.label ?? c.p + 1)}`;
      if (list) {
        const a = list[0], L = assignmentLabel(a);
        const clash = list.length > 1 || badSlot.has(a.id + '|' + c.day + '|' + c.p);
        const who = byTeacher ? (L.cls?.name || '') : (L.tch?.name || '');
        colRects[ci].push(`<rect x="${x}" y="${y}" width="8" height="8" rx="1.5" ${clash ? 'class="ov-bad"' : `fill="${esc(L.color)}"`}><title>${where} · ${esc(L.name)}${who ? ` (${esc(who)})` : ''}${clash ? ' · ชน' : ''}</title></rect>`);
      } else if (!byTeacher && (lockAt(e.id, c.day, c.p))) {
        colRects[ci].push(`<rect class="ov-lock" x="${x}" y="${y}" width="8" height="8" rx="1.5"><title>${where} · ${esc(lockAt(e.id, c.day, c.p).label || 'คาบล็อก')}</title></rect>`);
      } else {
        colRects[ci].push(`<rect class="ov-empty" x="${x + .5}" y="${y + .5}" width="7" height="7" rx="1.5"/>`);
      }
    });
    const n = Math.min(maxLeft, left.get(e.id) || 0);
    for (let k = 0; k < n; k++) rowsSvg.push(`<rect class="ov-left" x="${(colX[colX.length - 1] ?? LW) + CW + 6 + k * CW}" y="${y}" width="8" height="8" rx="1.5"><title>${esc(e.name)} · ยังไม่ได้วาง ${left.get(e.id)} คาบ</title></rect>`);
  });
  const anim = revealing && sc;
  const svg = `<svg class="ov-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="ภาพรวม${byTeacher ? 'ครูทุกคน' : 'ทุกห้องเรียน'} ${rows.length} แถว">${dayLbl}${rowsSvg.join('')}
    ${colRects.map((rs, ci) => `<g class="ov-col${anim ? ' m-land' : ''}"${anim ? ` style="--i:${ci}" data-m="scene"` : ''}>${rs.join('')}</g>`).join('')}</svg>`;
  // 3 ตัวเลข: วางแล้ว a/b · ชน c · ครูสอนหนักสุด
  const need = d.assignments.reduce((s, a) => s + (a.perWeek > 0 ? a.perWeek : 0), 0);
  const placed = d.placements.filter((p) => idx.asg.has(p.assignmentId)).length;
  let top = null;
  for (const [t, n] of load) if (idx.tch.has(t) && (!top || n > top[1])) top = [t, n];
  const num = (n) => `<b ${anim ? `data-n="${n}"` : ''}>${anim ? 0 : n}</b>`;
  if (anim) { sc.mapReveal = true; sc.revealMs = Math.max(sc.revealMs || 0, cols.length * 6 + 520); }
  const nums = `<span class="ov-nums"><span>วางแล้ว ${num(placed)}/${need}</span><span class="${conflicts.length ? 'bad' : ''}">ชน ${num(conflicts.length)}</span>${top ? `<span>ครูสอนหนักสุด: ${esc(tName(top[0]))} ${num(top[1])} คาบ</span>` : ''}</span>`;
  // กางเองเฉพาะตอนมีผลจัดใหม่ (คู่กับกล่องรายงาน) บนจอกว้าง · นอกนั้นหุบเหลือแถวตัวเลข (ไม่ดันตารางลง)
  const fresh = !!lastSolve && lastSolve.termId === store.termId && !hideReport && !lastSolve.error;
  const open = o.open ?? ovOpen ?? (fresh && !small());
  const html = `<details class="card overview-map${o.enter ? ' m-in' : ''}" ${open ? 'open' : ''}><summary><span class="ov-title">ภาพรวมทั้งโรงเรียน</span>${nums}</summary>
    <div class="ov-scroll">${svg}</div>
    <div class="ov-legend"><span><i class="k-empty"></i>ว่าง</span><span><i class="k-lock"></i>คาบล็อก</span><span><i class="k-bad"></i>ชน</span>${maxLeft ? '<span><i class="k-left"></i>ยังไม่ได้วาง</span>' : ''}<span>แตะแถวเพื่อเปิดตาราง${byTeacher ? 'ครู' : 'ห้อง'}นั้น</span></div>
    ${o.score === false ? '' : scoreHTML()}</details>`;
  try { globalThis.performance?.measure?.('tt-overview', { start: t0, end: globalThis.performance.now() }); } catch { /* เบราว์เซอร์เก่า */ }
  return html;
}

// ---------- ลากวาง ----------
// ghost = .ghost-wrap (translate3d ตามนิ้ว/เมาส์) > .ghost (เอียง ยกเงา) · เริ่มลากคำนวณ "วางได้ไหม" ทุกช่องครั้งเดียว (Map)
// นิ้ว: กดค้าง 200ms ก่อนยก (สั่นเบา ๆ) · วางไม่ได้ = ghost บินกลับที่เดิม แล้วบอกเหตุผล · ลดการเคลื่อนไหว = ไม่มี pop/shake/บินกลับ
function bindDrag(el) {
  let drag = null;

  const start = (e, payload, srcEl) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (drag?.timer) clearTimeout(drag.timer);
    drag = { payload, srcEl, x: e.clientX, y: e.clientY, active: false, wrap: null, ghost: null, tip: null, over: null, pointerId: e.pointerId, touch: e.pointerType === 'touch', why: null, moved: false };
    if (drag.touch) {
      const dr = drag;
      dr.timer = setTimeout(() => {
        if (drag !== dr || dr.active) return;
        try { navigator.vibrate?.(10); } catch { /* ไม่รองรับ */ }
        activate(dr, dr.x, dr.y);
      }, 200);
    }
  };
  el.querySelectorAll('.chip[data-asg]').forEach((c) => c.addEventListener('pointerdown', (e) => {
    const a = idx.asg.get(c.dataset.asg);
    if (a && remaining(a) > 0) start(e, { kind: 'new', a }, c);
    else if (a) notify.info('วิชานี้จัดครบแล้ว');
  }));
  el.querySelectorAll('.cell[data-pl]').forEach((c) => c.addEventListener('pointerdown', (e) => {
    const pl = store.doc.placements[+c.dataset.pl];
    if (pl) start(e, { kind: 'move', pl, a: idx.asg.get(pl.assignmentId) }, c);
  }));

  const activate = (dr, x, y) => {
    dr.active = true;
    dbg.drags++;
    const w = document.createElement('div');
    w.className = 'ghost-wrap' + (dr.touch ? ' touch' : '');
    w.setAttribute('aria-hidden', 'true');
    const g = dr.srcEl.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('dragging', 'm-land', 'm-pre');
    g.removeAttribute('data-m');
    g.style.width = dr.srcEl.offsetWidth + 'px';
    g.style.height = dr.srcEl.offsetHeight + 'px'; // .cell สูง 100% ของช่อง ถ้าไม่ล็อกจะยืดเท่าทั้งหน้า
    const tip = document.createElement('div');
    tip.className = 'ghost-why';
    tip.hidden = true;
    w.append(g, tip);
    document.body.appendChild(w);
    Object.assign(dr, { wrap: w, ghost: g, tip, gh: dr.srcEl.offsetHeight });
    w.style.transform = `translate3d(${x}px,${y}px,0)`;
    const lift = dr.touch ? 'translate(-50%,-130%) scale(1.08) rotate(-1.5deg)' : 'translate(-50%,-50%) scale(1.04) rotate(-1.5deg)';
    motion.play(g, [{ transform: lift.replace(/scale\([\d.]+\) rotate\([^)]+\)/, 'scale(.92) rotate(0deg)') }, { transform: lift }], { duration: 200, easing: motion.EASE.springPop });
    dr.srcEl.classList.add('dragging');
    // วางได้ไหม: ทุกช่องของตารางที่เห็น คำนวณครั้งเดียวต่อการลาก (ไม่ใช่ทุก pointermove)
    dr.why = new Map();
    for (const td of el.querySelectorAll('.tt td[data-day]')) {
      const why = whyCannotPlace(dr.payload.a, +td.dataset.day, +td.dataset.period, dr.payload.pl || null);
      dbg.why++;
      dr.why.set(td, why);
      if (!why) td.classList.add('can');
    }
    dbg.cells = dr.why.size;
  };
  const whyAt = (dr, td) => (dr.why?.has(td) ? dr.why.get(td) : whyCannotPlace(dr.payload.a, +td.dataset.day, +td.dataset.period, dr.payload.pl || null));
  const showTip = (dr, text) => {
    if (!dr.tip) return;
    dr.tip.hidden = !text;
    if (!text) return;
    dr.tip.textContent = text;
    dr.tip.style.transform = dr.touch ? `translate(-50%, calc(-100% - ${Math.round(dr.gh * 1.3 + 8)}px))` : `translate(-50%, ${Math.round(dr.gh / 2 + 8)}px)`;
  };

  const move = (e) => {
    const dr = drag;
    if (!dr || e.pointerId !== dr.pointerId) return;
    if (!dr.active) {
      const dist = Math.hypot(e.clientX - dr.x, e.clientY - dr.y);
      if (dr.touch) { if (dist > 12) { clearTimeout(dr.timer); drag = null; } return; } // ยังไม่ครบ 200ms แล้วเลื่อนนิ้ว = ไม่ใช่การลาก
      if (dist < 5) return;
      activate(dr, e.clientX, e.clientY);
    }
    e.preventDefault();
    if (Math.hypot(e.clientX - dr.x, e.clientY - dr.y) > 5) dr.moved = true;
    dr.wrap.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
    const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td[data-day]');
    if (td !== dr.over) {
      dr.over?.classList.remove('drop-ok', 'drop-bad', 'over');
      dr.over = td && el.contains(td) ? td : null;
      if (dr.over) {
        const why = whyAt(dr, dr.over);
        dr.over.classList.add(why ? 'drop-bad' : 'drop-ok', 'over');
        dr.over.title = why || 'วางได้';
        if (why) motion.shake(dr.over); // สั่นครั้งเดียวตอนเข้า
        showTip(dr, why);
      } else showTip(dr, '');
    }
  };

  /** ghost บินกลับที่เดิม (320ms) แล้วค่อยลบ · ลดการเคลื่อนไหว = ลบทันที */
  const flyBack = (dr) => {
    const w = dr.wrap;
    if (!w) return Promise.resolve();
    const r = dr.srcEl.isConnected ? dr.srcEl.getBoundingClientRect() : null;
    if (!r || motion.still()) { w.remove(); return Promise.resolve(); }
    const a = motion.play(w, [{ transform: w.style.transform, opacity: 1 }, { transform: `translate3d(${r.left + r.width / 2}px,${r.top + r.height / 2}px,0)`, opacity: .55 }], { duration: 320, easing: motion.EASE.io, fill: 'forwards' });
    return Promise.resolve(a.finished).catch(() => {}).then(() => w.remove());
  };
  const cleanup = (dr) => {
    clearTimeout(dr.timer);
    dr.srcEl.classList.remove('dragging');
    dr.over?.classList.remove('drop-ok', 'drop-bad', 'over');
    if (dr.why) for (const td of dr.why.keys()) td.classList.remove('can');
  };

  const end = (e) => {
    const dr = drag;
    if (!dr || e.pointerId !== dr.pointerId) return;
    drag = null;
    cleanup(dr);
    if (!dr.active) { if (dr.payload.kind === 'move' && e.type === 'pointerup') openMenu(dr.srcEl, dr.payload.pl); return; }
    const td = e.type === 'pointerup' ? dr.over : null;
    if (!td) { flyBack(dr); return; }
    const day = +td.dataset.day, period = +td.dataset.period;
    // นิ้วกดค้างแล้วปล่อยที่เดิม = แตะ → เมนูคาบ (ไม่ย้าย)
    if (dr.touch && !dr.moved && dr.payload.kind === 'move') { dr.wrap.remove(); openMenu(dr.srcEl, dr.payload.pl); return; }
    const why = whyAt(dr, td);
    if (why && !e.shiftKey) { flyBack(dr).then(() => notify.warn(`วางไม่ได้: ${why} (กด Shift ค้างเพื่อวางทับ)`, 4500)); return; }
    dr.wrap.remove();
    if (dr.payload.kind === 'new') { landPl = { assignmentId: dr.payload.a.id, day, period, pinned: true }; store.doc.placements.push(landPl); }
    else { const p = dr.payload.pl; p.day = day; p.period = period; p.pinned = true; landPl = p; }
    store.commit('place');
  };

  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function openMenu(cellEl, pl) {
  document.querySelector('.cell-menu')?.remove();
  const a = idx.asg.get(pl.assignmentId), L = assignmentLabel(a);
  const m = document.createElement('div');
  m.className = 'card cell-menu';
  m.innerHTML = `<div class="muted" style="padding:4px 10px;font-size:.82rem">${esc(L.code)} ${esc(L.name)} · ${esc(L.cls?.name || '')} · ${esc(L.tch?.name || '')}</div>
    <button data-act="pin">${pl.pinned ? 'เลิกปักหมุด (ให้จัดอัตโนมัติย้ายได้)' : '📌 ปักหมุด (ห้ามจัดอัตโนมัติย้าย)'}</button>
    ${view !== 'teacher' ? '<button data-act="teacher">ดูตารางสอนของครูคนนี้</button>' : ''}
    ${view !== 'class' ? '<button data-act="class">ดูตารางของห้องนี้</button>' : ''}
    <button data-act="remove" class="btn-danger">นำออกจากตาราง</button>`;
  const r = cellEl.getBoundingClientRect();
  m.style.left = Math.min(window.innerWidth - 220, r.left + window.scrollX) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(m);
  const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
  m.addEventListener('click', (ev) => {
    const act = ev.target.dataset.act;
    if (!act) return;
    m.remove();
    if (act === 'pin') { pl.pinned = !pl.pinned; store.commit('pin'); }
    if (act === 'remove') { store.doc.placements.splice(store.doc.placements.indexOf(pl), 1); store.commit('remove'); }
    if (act === 'teacher') { view = 'teacher'; selected.teacher = a.teacherId; render(root); }
    if (act === 'class') { view = 'class'; selected.class = a.classId; render(root); }
  });
}

// ---------- ความพร้อมก่อนจัด + รายงานผลการจัด ----------
// ผู้ใช้จริงคนแรกกรอกข้อมูลครบแต่ไม่มีคาบถูกวางเลย และเดิมเหตุผลที่ solver ส่งกลับมา (unplaced[].reason) ไม่ถูกแสดงที่ไหนเลย
// → แสดงกล่องบอก "ขั้นต่อไป" + ตรวจความจุล่วงหน้า และหลังจัดแสดงสาเหตุ/วิธีแก้ค้างไว้เหนือตาราง (ไม่ใช่ toast 3 วินาที)
// เหตุผลมีรหัส (code + params จาก solver.js ดู SPEC.md) → ตาราง FIXES เลือกวิธีแก้และปุ่ม "แก้ให้เลย"
// ที่คำนวณตรงจากตัวเลข ไม่รัน solver ซ้ำ · กดแล้ว commit ครั้งเดียว + toast เลิกทำ · ไม่มี code (ผลเก่า) = ใช้ regex เดิม

let capCheck = null;        // capacityCheck() จาก solver.js · ยังไม่มา = ตรวจแบบเดิมในไฟล์นี้ (สำรอง)
let capLoading = false;
let rulesMod = null;        // rules.js แบบ namespace: buildPeriods (WP1) / splitAssignment อาจยังไม่มีในบางรุ่น จึงไม่ import ชื่อตรง ๆ
let fixActs = [];           // ปุ่มที่วาดอยู่ (data-fix = ดัชนี) สร้างใหม่ทุกครั้งที่วาดกล่อง

/** โหลด capacityCheck หลัง validate() มาแล้วเท่านั้น (ไฟล์เดียวกัน ได้จากแคช ไม่เพิ่มการโหลดตอนเปิดหน้า) */
function loadCapCheck() {
  if (capCheck || capLoading || !validator) return;
  capLoading = true;
  import('./rules.js').then((m) => { rulesMod = m; }).catch(() => {});
  import('./solver/solver.js').then((m) => {
    if (typeof m.capacityCheck !== 'function') return;
    capCheck = m.capacityCheck;
    if (root) render(root);
  }).catch(() => {});
}

const tName = (id) => idx.tch.get(id)?.name || 'ครู';
const cName = (id) => idx.cls.get(id)?.name || 'ห้องเรียน';
const rName = (id) => idx.room.get(id)?.name || 'ห้องพิเศษ';
const aName = (a) => { const L = assignmentLabel(a); return `${L.name} ${L.cls?.name || ''}`.trim(); };
const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); // รูปแบบเดียวกับ uid() ใน store.js

// ---------- การแก้ที่กดแล้วจบ: run(doc) แก้เอกสาร → { msg, undo(doc) } หรือ null ถ้าแก้ไม่ได้แล้ว ----------
function setMaxPerDay(teacherId, n) {
  const t = store.doc.teachers.find((x) => x.id === teacherId);
  if (!t || !(n > 0) || (t.maxPerDay > 0 && t.maxPerDay >= n)) return null;
  return {
    label: `เพิ่มเป็น ${n}`,
    run: (d) => {
      const x = d.teachers.find((y) => y.id === teacherId);
      if (!x) return null;
      const old = x.maxPerDay;
      x.maxPerDay = n;
      return { msg: `ตั้ง “สูงสุด/วัน” ของ ${x.name} เป็น ${n} คาบแล้ว`, boon: `เพิ่มเพดานของ${x.name}เป็น ${n} คาบ/วันแล้วครับ กด “จัดเฉพาะที่ยังขาด” ได้เลย`, undo: (doc) => { const y = doc.teachers.find((z) => z.id === teacherId); if (y) y.maxPerDay = old; } };
    },
  };
}

/** ลดคาบคู่: เลือกแถวที่มีคาบคู่มากสุดในกลุ่มที่เกี่ยวข้อง ลดเท่าที่ขาด (อย่างน้อย 1) */
function reduceDoubles(p, ctx) {
  const d = store.doc;
  const ids = new Set(ctx.assignmentIds || []);
  if (p.assignmentId) ids.add(p.assignmentId);
  let list = d.assignments.filter((a) => ids.has(a.id) && a.doubles > 0);
  if (!list.length) list = d.assignments.filter((a) => a.doubles > 0 && (p.teacherId ? a.teacherId === p.teacherId : a.classId === p.classId));
  const a = list.sort((x, y) => y.doubles - x.doubles)[0];
  if (!a) return null;
  const to = Math.max(0, a.doubles - Math.max(1, (p.doubles || 0) - (p.slots || 0)));
  return {
    label: `ลดคาบคู่ ${aName(a)} จาก ${a.doubles} → ${to}`,
    run: (doc) => {
      const x = doc.assignments.find((y) => y.id === a.id);
      if (!x) return null;
      const old = x.doubles;
      x.doubles = to;
      return { msg: `ลดคาบคู่ของ ${aName(x)} เป็น ${to} คู่แล้ว`, undo: (dd) => { const y = dd.assignments.find((z) => z.id === a.id); if (y) y.doubles = old; } };
    },
  };
}

/** แบ่งวิชาที่คาบมากสุดของครูให้ครูอื่น (กลไกเดียวกับปุ่มแบ่งสอนในแท็บการสอน) */
function splitToOther(teacherId) {
  const d = store.doc;
  if (typeof rulesMod?.splitAssignment !== 'function' || d.teachers.length < 2) return null;
  const a = d.assignments.filter((x) => x.teacherId === teacherId && idx.cls.has(x.classId) && x.perWeek >= 2).sort((x, y) => y.perWeek - x.perWeek)[0];
  if (!a) return null;
  return {
    label: `แบ่ง ${aName(a)} ให้ครูอื่น`,
    run: (doc) => {
      const x = doc.assignments.find((y) => y.id === a.id);
      if (!x) return null;
      const before = { perWeek: x.perWeek, doubles: x.doubles, split: x.split, pls: doc.placements.filter((pl) => pl.assignmentId === x.id) };
      const b = rulesMod.splitAssignment(doc, x, newId('a'));
      if (!b || b.teacherId === x.teacherId) { Object.assign(x, { perWeek: before.perWeek, doubles: before.doubles }); doc.assignments = doc.assignments.filter((y) => y !== b); return null; }
      return {
        msg: `แบ่ง ${aName(x)} ${b.perWeek} คาบให้ ${tName(b.teacherId)} แล้ว — เปลี่ยนครูได้ที่ ข้อมูล → การสอน`,
        undo: (dd) => {
          const y = dd.assignments.find((z) => z.id === a.id);
          dd.assignments = dd.assignments.filter((z) => z.id !== b.id);
          dd.placements = dd.placements.filter((pl) => pl.assignmentId !== b.id && pl.assignmentId !== a.id).concat(before.pls);
          if (!y) return;
          y.perWeek = before.perWeek; y.doubles = before.doubles;
          if (before.split === undefined) delete y.split; else y.split = before.split;
        },
      };
    },
  };
}

const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
const fmtMin = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** คาบเรียนใหม่ต่อท้ายวัน: ถ้าโครงคาบเดิมสร้างจาก buildPeriods (WP1) ได้ตรงทุกช่อง ใช้เวลาจาก buildPeriods ไม่งั้นต่อเวลาจากคาบสุดท้าย */
function nextPeriod(ps) {
  const cls = ps.filter((p) => p.type !== 'break'), brk = ps.filter((p) => p.type === 'break');
  const last = ps[ps.length - 1], lastCls = cls[cls.length - 1];
  const out = { label: String(cls.length + 1), start: '', end: '', type: 'class' };
  if (typeof rulesMod?.buildPeriods === 'function' && cls.length && brk.length <= 1) {
    try {
      const breakAt = brk.length ? ps.indexOf(brk[0]) : -1;
      const args = {
        start: ps[0].start, minutes: toMin(cls[0].end) - toMin(cls[0].start), count: cls.length,
        breakAfter: breakAt < 0 ? 0 : ps.slice(0, breakAt).filter((p) => p.type !== 'break').length,
        breakMinutes: brk.length ? toMin(brk[0].end) - toMin(brk[0].start) : 0,
      };
      const same = rulesMod.buildPeriods(args);
      const more = rulesMod.buildPeriods({ ...args, count: cls.length + 1 });
      const eq = (x, y) => x && y && x.start === y.start && x.end === y.end && (x.type === 'break') === (y.type === 'break');
      if (Array.isArray(same) && Array.isArray(more) && same.length === ps.length && same.every((x, i) => eq(x, ps[i])) && more.length === ps.length + 1 && more.slice(0, -1).every((x, i) => eq(x, ps[i]))) {
        const n = more[more.length - 1];
        return { ...out, start: n.start || '', end: n.end || '' };
      }
    } catch { /* ใช้วิธีต่อเวลาจากคาบสุดท้าย */ }
  }
  const s = toMin(last?.end), dur = toMin(lastCls?.end) - toMin(lastCls?.start);
  if (s !== null && dur > 0) { out.start = fmtMin(s); out.end = fmtMin(s + dur); }
  return out;
}

const MAX_PERIODS = 20; // ตรงกับ validate_term_doc ฝั่งเซิร์ฟเวอร์
function addPeriodPerDay() {
  const d = store.doc;
  if (d.term.periods.length >= MAX_PERIODS) return null;
  return {
    label: `เพิ่ม 1 คาบ/วัน (+${d.term.days} ช่อง)`,
    run: (doc) => {
      const ps = doc.term.periods;
      if (ps.length >= MAX_PERIODS) return null;
      const i = ps.length, p = nextPeriod(ps);
      ps.push(p);
      return {
        msg: `เพิ่มคาบ ${p.label}${p.start ? ` (${p.start}–${p.end})` : ''} ท้ายทุกวันแล้ว — แก้เวลาได้ที่แท็บโครงคาบ`,
        undo: (dd) => {
          if (dd.term.periods.length !== i + 1) return; // มีการแก้โครงคาบต่อจากนี้แล้ว ไม่ลบให้
          dd.term.periods.pop();
          dd.placements = dd.placements.filter((pl) => pl.period !== i);
          dd.locks = dd.locks.filter((l) => l.period !== i);
          for (const t of dd.teachers) if (t.unavailable) t.unavailable = t.unavailable.filter(([, y]) => y !== i);
        },
      };
    },
  };
}

const go = (label, detail) => ({ label, go: detail });
// seed คงที่ (settings.solveSeed) → กดจัดซ้ำได้ผลเดิม · ลำดับสุ่มชุดใหม่ต้องกด "ลองอีกแบบ"
const crowded = 'กด “ลองอีกแบบ” (จัดด้วยลำดับสุ่มชุดถัดไป) หรือเลิกปักหมุดบางคาบ แล้วลากวางส่วนที่เหลือเอง';

/** รหัสเหตุผล → วิธีแก้ (ข้อความ) + แท็บที่ไปแก้ + ปุ่มแก้ให้เลย · p = params จาก solver, ctx.assignmentIds = แถวที่วางไม่ลง */
const FIXES = {
  TEACHER_MAX_DAY: {
    goto: 'teachers',
    text: (p) => `เพิ่ม “สูงสุด/วัน” ของ ${tName(p.teacherId)} จาก ${p.maxPerDay || 'ไม่จำกัด'} → ${p.minNeeded} คาบ`,
    acts: (p) => [setMaxPerDay(p.teacherId, p.minNeeded)],
  },
  TEACHER_OVER: {
    goto: 'teachers',
    text: (p) => `${tName(p.teacherId)} ต้องสอน ${p.need} คาบ แต่สอนได้ ${p.free} คาบ: ${p.unavail ? `ลดช่องไม่ว่าง (สีแดง ${p.unavail} ช่อง) ` : ''}หรือแบ่งบางวิชาให้ครูคนอื่น`,
    acts: (p) => [go(`ไปดูช่องไม่ว่างของ ${tName(p.teacherId)}`, { tab: 'data', section: 'teachers', teacherId: p.teacherId }), splitToOther(p.teacherId)],
  },
  CLASS_OVER: {
    goto: 'assignments',
    text: (p) => `${cName(p.classId)} ต้องเรียน ${p.need} คาบ มีช่อง ${p.free} คาบ: ลด ${p.need - p.free} คาบ หรือเพิ่มคาบต่อวัน/ลดคาบล็อก`,
    acts: (p) => [addPeriodPerDay(), go('ไปดูคาบล็อกของห้องนี้', { tab: 'periods', classId: p.classId })],
  },
  ROOM_OVER: {
    goto: 'rooms',
    text: (p) => `${rName(p.roomId)} ถูกใช้ ${p.need} คาบ มีเพียง ${p.free} คาบ: เพิ่มห้องพิเศษอีกห้อง หรือเลิกผูกห้องพิเศษกับบางวิชา`,
  },
  DOUBLE_NO_SLOT: {
    goto: 'assignments',
    text: (p) => (p.pinnedHalf ? 'เลิกปักหมุดคาบคู่ที่ค้างครึ่งเดียว หรือลดจำนวนคาบคู่ของวิชานี้'
      : `ลดจำนวนคาบคู่${p.slots ? ` (มีช่องคาบคู่ ${p.slots} คู่ ต้องการ ${p.doubles} คู่)` : ''}${p.minNeeded ? ` หรือเพิ่ม “สูงสุด/วัน” ของ ${tName(p.teacherId)} เป็น ${p.minNeeded}` : ''}`),
    acts: (p, ctx) => [reduceDoubles(p, ctx), p.minNeeded ? setMaxPerDay(p.teacherId, p.minNeeded) : null],
  },
  NO_TEACHER: {
    goto: 'assignments',
    text: () => 'เลือกครูให้การสอนที่ยังว่าง (ไม่เลือกครู = ระบบไม่นำไปจัด)',
    acts: () => {
      const n = store.doc.assignments.filter((a) => idx.cls.has(a.classId) && !idx.tch.has(a.teacherId)).length;
      return [n ? go(`ไปเติมครู (${n} แถว)`, { tab: 'data', section: 'assignments', filter: 'noTeacher' }) : null];
    },
  },
  BLOCKED_TEACHER: {
    goto: 'teachers',
    text: (p) => `${tName(p.teacherId)} ถูกตั้ง “ไม่ว่าง” ${p.blocked} ช่องจนไม่เหลือคาบที่สอนได้ (ช่องสีแดง = ครูไม่ว่าง ไม่ใช่คาบที่สอน)`,
  },
  BLOCKED_ROOM: { goto: 'rooms', text: (p) => `${rName(p.roomId)} ไม่มีช่องที่ใช้ได้เลย` },
  BLOCKED_CLASS: {
    goto: null,
    text: (p) => `${cName(p.classId)} ถูกล็อกจนไม่เหลือคาบเรียน — ปลดคาบล็อกบางช่องในแท็บโครงคาบ`,
    acts: (p) => [go('ไปที่คาบล็อก', { tab: 'periods', classId: p.classId })],
  },
  BAD_DATA: { goto: 'assignments', text: (p) => (p.what === 'teacher' ? 'เลือกครูของการสอนนี้ใหม่ (ครูเดิมถูกลบแล้ว)' : 'เลือกห้องเรียนของการสอนนี้ใหม่') },
  CROWDED_TEACHER: { goto: null, text: () => crowded },
  CROWDED_ROOM: { goto: 'rooms', text: () => `${crowded} หรือเพิ่มห้องพิเศษ` },
  CROWDED_CLASS: { goto: null, text: () => crowded },
  CROWDED_MAX_DAY: {
    goto: 'teachers',
    text: (p) => `${crowded} หรือเพิ่ม “สูงสุด/วัน” ของ ${tName(p.teacherId)}`,
    acts: (p) => [setMaxPerDay(p.teacherId, (p.maxPerDay || 0) + 1)],
  },
};

/** วิธีแก้ตามเหตุผลที่ solver ส่งมา → [ข้อความ, แท็บ] · มี code = ใช้ FIXES · ไม่มี (ผลเก่า/ข้อความล้วน) = regex เดิม */
function fixFor(reason, code = null, params = null) {
  const F = code && FIXES[code];
  if (F) { try { return [F.text(params || {}), F.goto ?? null]; } catch { /* params เสีย → regex */ } }
  const r = String(reason || '');
  if (/ต้องเรียนรวม/.test(r)) return ['ลดคาบ/สัปดาห์ของห้องนี้ หรือเพิ่มคาบต่อวัน/ลดคาบล็อก (แท็บโครงคาบ)', 'assignments'];
  if (/สอนได้สูงสุด|สอนได้วันละ/.test(r)) return ['เพิ่ม “สูงสุด/วัน” ของครู ลดช่องไม่ว่าง หรือย้ายบางวิชาไปให้ครูคนอื่น', 'teachers'];
  if (/คาบคู่/.test(r)) return ['ลดจำนวนคาบคู่ของวิชานี้ (แท็บข้อมูล → การสอน) หรือเลิกปักหมุดคาบคู่ที่ค้างครึ่งเดียว', 'assignments'];
  if (/ไม่มีคาบที่ครูว่าง/.test(r)) return ['ตรวจช่อง “คาบไม่ว่าง” ของครู (ช่องสีแดง = ครูไม่ว่าง ไม่ใช่คาบที่สอน) และคาบล็อกที่ปิดทุกช่อง', 'teachers'];
  if (/ห้องพิเศษ|ถูกใช้/.test(r)) return ['เพิ่มห้องพิเศษอีกห้อง หรือเลิกผูกห้องพิเศษกับบางวิชา', 'rooms'];
  if (/ไม่พบห้องเรียน/.test(r)) return ['เลือกห้องเรียนของการสอนนี้ใหม่', 'assignments'];
  return [crowded, null];
}

/** ปุ่มแก้ของรหัสนั้น (กรองที่แก้ไม่ได้ออก) · ใช้ทดสอบใน node ได้ */
export function fixActions(code, params, ctx = {}) {
  const F = code && FIXES[code];
  if (!F?.acts) return [];
  try { return F.acts(params || {}, ctx).filter(Boolean); } catch { return []; }
}

/** วาดปุ่มแก้ (เก็บ action ไว้ใน fixActs ให้ตัวจับคลิกกลางเรียก) + ปุ่ม "ไปแก้ที่…" เดิมเมื่อไม่มีปุ่มพาไปแท็บอยู่แล้ว */
function actsHTML(code, params, ctx, goto) {
  const acts = fixActions(code, params, ctx);
  const html = acts.map((a) => {
    fixActs.push(a);
    return ` <button class="btn btn-sm${a.run ? ' btn-primary' : ''}" data-fix="${fixActs.length - 1}">${esc(a.label)}</button>`;
  }).join('');
  return `<div class="fix-acts" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${html}${acts.some((a) => a.go) ? '' : gotoBtn(goto)}</div>`;
}

/** กดปุ่มแก้: แก้ → commit ครั้งเดียว → toast เลิกทำ · ปุ่มพาไปแท็บ = tt:goto (app.js ส่ง section/filter ต่อให้ data.js)
 *  ปุ่มในรายงานผลจัด: ปุ่มกลายเป็น ✓ (.btn-done) → การ์ดสาเหตุนั้นจางออก (m-out) แล้วหายจากรายงาน → ครูบูรณ์ยืนยันว่าแก้แล้ว + ชวนจัดเฉพาะที่ยังขาด */
function runFix(act, btn = null) {
  if (act.go) { document.dispatchEvent(new CustomEvent('tt:goto', { detail: act.go })); return null; }
  const d = store.doc, term = store.termId;
  const li = btn?.closest?.('.fix-card');
  const g = li?.dataset.g || null;
  const s = lastSolve;
  const inReport = !!(g && li.closest('[data-report]') && s && s.termId === term && !hideReport);
  // กดแก้ระหว่างเผย → จบฉากก่อน (ข้อความปลอบตอนจบฉากต้องไม่มาทับข้อความยืนยันการแก้) · act/btn จับไว้แล้ว จึงไม่กระทบที่ render ใหม่
  if (scene && scene.result) skipScene();
  const r = act.run(d);
  if (!r) { notify.info('ข้อมูลเปลี่ยนไปแล้ว ไม่มีอะไรต้องแก้'); return null; }
  // tok = การแก้ครั้งนี้ (ตัวจับเวลาจางการ์ดผูกกับ tok) → เลิกทำก่อนครบ 0.9 วิ ยกเลิกได้ ไม่ทำให้การ์ดหายถาวร
  const tok = inReport ? { g, label: act.label, timer: 0, undone: false } : null;
  if (inReport) { if (s.fixing?.timer && s.fixing.g === g) clearTimeout(s.fixing.timer); s.fixing = tok; }
  else hideReport = true; // กล่องตรวจความพร้อม/รายงานเก่า → ตรวจใหม่จากข้อมูลล่าสุด
  store.commit('fix');
  notify.action(r.msg, 'เลิกทำ', () => {
    // เปลี่ยนภาคเรียน/รวมการแก้ไขระหว่างที่ toast ยังอยู่ → undo จะไปแก้เอกสารอื่น ห้ามทำ
    if (store.doc !== d || store.termId !== term) { notify.info('เปลี่ยนภาคเรียนไปแล้ว เลิกทำการแก้นี้ไม่ได้'); return; }
    if (tok) { tok.undone = true; clearTimeout(tok.timer); s.fixedG?.delete(g); if (s.fixing === tok) s.fixing = null; }
    r.undo(d); store.commit('undo'); notify.ok('คืนค่าเดิมแล้ว'); // commit → render วาดการ์ดนี้กลับพร้อมปุ่มแก้
    // ครูบูรณ์ค้างข้อความ "แก้แล้วครับ" (hold) → เปลี่ยนเป็นบอกว่าคืนค่าแล้ว และชี้ปุ่มแก้ที่กลับมา
    if (tok && lastSolve === s && !hideReport) mascot.set('comfort', { msg: 'คืนค่าเดิมแล้วครับ การ์ดสาเหตุกลับมาในรายงานแล้ว กดปุ่มสีทองเมื่อพร้อมแก้', acts: [{ label: 'ดูวิธีแก้', primary: true, run: showFix, hint: '[data-fix].btn-primary' }] });
  });
  if (inReport) {
    // การ์ดที่แก้แล้ว: ค้าง ✓ ให้เห็นสักครู่ แล้วจางออก (render ระหว่างนี้วาดการ์ดนี้เป็นสถานะ "แก้แล้ว")
    tok.timer = setTimeout(() => {
      if (tok.undone || lastSolve !== s) return; // เลิกทำแล้ว / จัดใหม่แล้ว → ไม่ซ่อนการ์ด
      if (s.fixing === tok) s.fixing = null;
      s.fixedG.add(g);
      const el = root && [...root.querySelectorAll('.fix-card')].find((x) => x.dataset.g === g);
      if (!el) return;
      if (motion.still()) { el.remove(); return; }
      el.classList.add('m-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 600); // กันกรณี animationend ไม่มา
    }, 900);
    mascot.set('next', { msg: r.boon || `แก้แล้วครับ: ${r.msg} · กด “จัดเฉพาะที่ยังขาด” ได้เลย`, hold: true,
      acts: [{ label: 'จัดเฉพาะที่ยังขาด', primary: true, hint: '#auto-solve', run: () => autoSolve('missing') }] });
  }
  return r;
}

// ตัวจับคลิกกลางตัวเดียว (render วาด innerHTML ใหม่ทุกครั้ง จึงไม่ผูกทีละปุ่ม)
document.addEventListener('click', (ev) => {
  const b = ev.target?.closest?.('[data-fix]');
  if (!b || !root?.contains(b)) return;
  const act = fixActs[+b.dataset.fix];
  if (act) runFix(act, b);
});

/** ตรวจความจุแบบเร็ว (ชุดเดียวกับที่ solver ใช้ตัดสินว่าจัดไม่ครบแน่นอน) → รายการปัญหาพร้อมวิธีแก้ {text, fix, goto, code?, params?} */
export function readiness() {
  const d = store.doc, days = d.term.days, P = d.term.periods.length;
  const out = [];
  const skipped = d.assignments.filter((a) => !idx.cls.has(a.classId) || !idx.tch.has(a.teacherId));
  if (skipped.length) {
    const noTeacher = skipped.some((a) => idx.cls.has(a.classId));
    out.push({ text: `การสอน ${skipped.length} รายการยังไม่ได้เลือกห้องเรียนหรือครู จึงไม่ถูกนำไปจัด`, fix: 'เลือกห้องเรียนและครูให้ครบ', goto: 'assignments', ...(noTeacher ? { code: 'NO_TEACHER', params: {} } : {}) });
  }
  const zero = d.assignments.filter((a) => !(a.perWeek > 0)).length;
  if (zero) out.push({ text: `การสอน ${zero} รายการตั้งคาบ/สัปดาห์เป็น 0`, fix: 'ใส่จำนวนคาบต่อสัปดาห์', goto: 'assignments' });
  loadCapCheck();
  if (capCheck) {
    // solver.js มาแล้ว: ตรวจชุดเดียวกับ solve() (รวมคาบคู่และห้องพิเศษ) ข้อความตรงกับรายงานหลังจัด
    try {
      for (const x of capCheck(solverInput(true)).issues) {
        if (x.code === 'NO_TEACHER') continue; // solverInput กรองแถวไม่มีครูออกแล้ว (นับไว้ข้างบน)
        const [fix, goto] = fixFor(x.text, x.code, x.params);
        out.push({ text: x.text, fix, goto, code: x.code, params: x.params });
      }
      return out;
    } catch (e) { console.warn('capacityCheck ล้มเหลว ใช้ตัวตรวจสำรอง', e); }
  }
  const globalLock = (day, p) => d.locks.some((l) => l.classId == null && l.day === day && l.period === p);
  for (const c of d.classes) {
    const need = d.assignments.filter((a) => a.classId === c.id && idx.tch.has(a.teacherId)).reduce((s, a) => s + (a.perWeek || 0), 0);
    let free = 0;
    for (let day = 0; day < days; day++) for (let p = 0; p < P; p++) if (!isBreak(p) && !lockAt(c.id, day, p)) free++;
    if (need > free) out.push({ text: `${c.name} ต้องเรียนรวม ${need} คาบ/สัปดาห์ แต่มีช่องว่างเพียง ${free} คาบ`, fix: `ลดคาบ/สัปดาห์ของ ${c.name} ลง ${need - free} คาบ หรือเพิ่มคาบต่อวัน/ลดคาบล็อกในแท็บโครงคาบ`, goto: 'assignments', code: 'CLASS_OVER', params: { classId: c.id, need, free } });
  }
  for (const t of d.teachers) {
    const need = d.assignments.filter((a) => a.teacherId === t.id && idx.cls.has(a.classId)).reduce((s, a) => s + (a.perWeek || 0), 0);
    if (!need) continue;
    let cap = 0;
    const perDay = [];
    for (let day = 0; day < days; day++) {
      let n = 0;
      for (let p = 0; p < P; p++) if (!isBreak(p) && !globalLock(day, p) && !teacherUnavailable(t.id, day, p)) n++;
      perDay.push(n);
      cap += t.maxPerDay ? Math.min(n, t.maxPerDay) : n;
    }
    if (need > cap) {
      const unav = (t.unavailable || []).length;
      // เพดานต่อวันต่ำสุดที่พอ (ไม่นับคาบคู่ — ตัวตรวจเต็มใน solver.js นับให้)
      let minNeeded = 0;
      if (t.maxPerDay) for (let m = t.maxPerDay + 1; m <= Math.max(...perDay) && !minNeeded; m++) if (perDay.reduce((s, n) => s + Math.min(n, m), 0) >= need) minNeeded = m;
      out.push({ text: `${t.name} ต้องสอน ${need} คาบ/สัปดาห์ แต่สอนได้สูงสุด ${cap} คาบ (สูงสุด ${t.maxPerDay || 'ไม่จำกัด'} คาบ/วัน${unav ? `, ไม่ว่าง ${unav} ช่อง` : ''})`,
        fix: `เพิ่ม “สูงสุด/วัน” ของครู${unav ? ' ลดช่องไม่ว่าง (สีแดง)' : ''} หรือย้ายบางวิชาไปให้ครูคนอื่น`, goto: 'teachers',
        ...(minNeeded ? { code: 'TEACHER_MAX_DAY', params: { teacherId: t.id, maxPerDay: t.maxPerDay, minNeeded, need, free: cap } }
          : { code: 'TEACHER_OVER', params: { teacherId: t.id, need, free: cap, maxPerDay: t.maxPerDay || 0, unavail: unav } }) });
    }
  }
  return out;
}

const SEC_NAME = { assignments: 'การสอน', teachers: 'ครู', rooms: 'ห้องพิเศษ', classes: 'ห้องเรียน' };
const gotoBtn = (k) => (k ? ` <button class="btn btn-sm" data-goto="${k}">ไปแก้ที่ ข้อมูล → ${SEC_NAME[k]}</button>` : '');

function gotoData(sec) {
  document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'data', section: sec } }));
}

// การ์ดปัญหา: พื้นอ่อน + ขอบรอบ + ไอคอน (ไม่ใช้แถบสีขอบซ้าย)
const CARD = 'list-style:none;margin-left:-20px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface-2);display:flex;gap:10px;align-items:flex-start';
const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="flex:none;margin-top:2px;color:var(--gold)"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 1 7h-2l1-7zm-1 9h2v2h-2v-2z"/></svg>';
const card = (body, g = '', cls = '') => `<li class="fix-card${cls}" style="${CARD}"${g ? ` data-g="${esc(g)}"` : ''}>${ICON}<div style="min-width:0;flex:1">${body}</div></li>`;

function issueHTML(x) {
  return card(`${esc(x.text)}<br><span class="fix">วิธีแก้: ${esc(x.fix)}</span>${actsHTML(x.code, x.params, {}, x.goto)}`);
}

function guideHTML(totalLeft) {
  const d = store.doc;
  fixActs = [];
  if (lastSolve && lastSolve.termId === store.termId && !hideReport) return solveReportHTML();
  if (!d.assignments.length) {
    if (mascot.shown()) return ''; // ครูบูรณ์ + แถบขั้นตอนบอกขั้นต่อไปอยู่แล้ว ไม่ต้องซ้ำ
    return `<div class="card callout"><b>เริ่มต้นใน 4 ขั้น</b><ol>
      <li>แท็บ <b>ข้อมูล</b> → เพิ่มห้องเรียน และครู</li><li>ข้อมูล → <b>การสอน</b>: จับคู่ วิชา × ห้อง × ครู และจำนวนคาบ/สัปดาห์</li>
      <li>แท็บ <b>โครงคาบ · คาบล็อก</b>: ตั้งเวลาเรียน และล็อกคาบกิจกรรม (ถ้ามี)</li><li>กลับมาหน้านี้แล้วกด <b>จัดอัตโนมัติ</b></li></ol>
      <p class="muted" style="margin:6px 0 0">มีภาคเรียนก่อนหน้าแล้ว? เลือก “＋ สร้างภาคเรียนใหม่…” ที่หัวจอ แล้วเลือกแบบ “สำเนาจาก…” ครู วิชา และการสอนจะตามมาครบ ไม่ต้องกรอกใหม่</p></div>`;
  }
  const issues = readiness();
  if (!totalLeft && !issues.length) return '';
  const list = issues.length ? `<ul>${issues.map(issueHTML).join('')}</ul>` : '';
  if (!d.placements.length) {
    const total = d.assignments.reduce((s, a) => s + (a.perWeek || 0), 0);
    // มือถือ: ย่อเหลือหัวข้อ + ปุ่ม (คำอธิบายยาวดันตารางพ้นจอ · ครูบูรณ์/แถบขั้นตอนบอกขั้นต่อไปอยู่แล้ว)
    return `<div class="card callout ${issues.length ? 'warn' : 'go'}">
      <div class="callout-head"><b>${small() ? `ข้อมูลพร้อมแล้ว: ${total} คาบ/สัปดาห์ · ยังไม่ได้วางลงตาราง` : `ข้อมูลพร้อมแล้ว: การสอน ${d.assignments.length} รายการ รวม ${total} คาบ/สัปดาห์ · ยังไม่ได้วางลงตาราง`}</b>
      <button class="btn btn-primary btn-sm" id="auto-solve-2">จัดอัตโนมัติเลย</button></div>
      ${small() ? '' : `<p style="margin:4px 0 0">ขั้นต่อไป: กด <b>จัดอัตโนมัติ</b> ระบบจะวางทุกวิชาให้ภายในไม่กี่วินาที หรือลากวิชาจากรายการ “วิชาที่ต้องจัด” ไปวางในตารางเอง</p>`}
      ${issues.length ? `<p style="margin:8px 0 0"><b style="color:var(--danger)">ตรวจพบ ${issues.length} จุดที่ทำให้จัดได้ไม่ครบ</b> (จัดได้ แต่จะเหลือบางคาบ)</p>${list}` : ''}</div>`;
  }
  return issues.length ? `<div class="card callout warn"><b>ตรวจพบ ${issues.length} จุดที่ทำให้จัดได้ไม่ครบ</b>${list}</div>` : '';
}

/** กลุ่มของรายการที่วางไม่ลง: รหัสเดียวกัน + ครู/ห้องพิเศษ/ห้องเรียนเดียวกัน = การ์ดเดียว · ไม่มีรหัส = รวมตามข้อความ */
function groupKey(u) {
  if (!u.code) return 'r|' + u.reason;
  const p = u.params || {};
  return u.code + '|' + (p.teacherId ?? p.roomId ?? p.classId ?? '');
}

/**
 * สรุปผลจัด (ฟังก์ชันล้วน ไม่แตะ DOM/store) → { tone:'ok'|'warn', head, toast, miss }
 * ใช้ร่วมกันทั้งหัวรายงาน toast และครูบูรณ์ ข้อความจึงตรงกันทุกที่ · hard = result.stats.hardViolations (คาบที่ปักหมุดชนกันเอง)
 * ตัวอย่าง:
 *   summarize({ unplaced: [], n: 147 })                                  → ok   'จัดครบทุกคาบแล้ว 147 คาบ ไม่มีคาบชน'
 *   summarize({ unplaced: [{ remaining: 20 }], n: 127 })                 → warn 'จัดได้ 127 คาบ · วางไม่ลง 20 คาบ'
 *   summarize({ unplaced: [], hard: 2, n: 147 })                         → warn 'จัดครบแต่มีคาบชน 2 จุด (จากคาบที่ปักหมุดไว้)' (toast ไม่มีคำว่า "ไม่มีคาบชน")
 *   summarize({ unplaced: [{ remaining: 3 }], mode: 'missing', added: 9 }) → warn 'วางเพิ่มได้ 9 คาบ · ยังขาด 3 คาบ'
 */
export function summarize({ unplaced = [], skipped = 0, hard = 0, mode = 'all', n = 0, added = 0 } = {}) {
  const miss = (unplaced || []).reduce((s, u) => s + (u.remaining || 0), 0);
  hard = hard > 0 ? hard : 0;
  if (!miss && !skipped) {
    if (hard) return { tone: 'warn', miss, head: `จัดครบแต่มีคาบชน ${hard} จุด (จากคาบที่ปักหมุดไว้)`, toast: `จัดเสร็จ ${n} คาบ · มีคาบชน ${hard} จุด จากคาบที่ปักหมุดไว้ — ดูจุดชนใต้ตาราง` };
    return {
      tone: 'ok', miss, head: `จัดครบทุกคาบแล้ว ${n} คาบ ไม่มีคาบชน`,
      toast: mode === 'missing' ? `วางเพิ่ม ${added} คาบ ครบทุกคาบแล้ว คาบเดิมอยู่ที่เดิม` : `จัดเสร็จ ${n} คาบ ไม่มีคาบชน · ครูทุกคนไม่สอนเกินเพดาน`,
    };
  }
  let head;
  if (!miss) head = `${mode === 'missing' ? `วางเพิ่ม ${added} คาบ` : `จัดได้ ${n} คาบ`} · ยังขาดการสอน ${skipped} รายการที่ยังไม่มีครู`;
  else if (mode === 'missing') head = `วางเพิ่มได้ ${added} คาบ · ยังขาด ${miss} คาบ`;
  else head = n ? `จัดได้ ${n} คาบ · วางไม่ลง ${miss} คาบ` : `ยังวางคาบไม่ได้เลย (วางไม่ลง ${miss} คาบ)`;
  if (hard) head += ` · ชน ${hard} จุด`;
  let toast = miss ? `วางไม่ลง ${miss} คาบ — ดูวิธีแก้เหนือตาราง` : `การสอน ${skipped} รายการยังไม่มีครู จึงยังไม่ถูกจัด — ดูเหนือตาราง`;
  if (hard) toast += ` · มีคาบชน ${hard} จุด`;
  return { tone: 'warn', miss, head, toast };
}

/** รวมรายการวางไม่ลงเป็นกลุ่ม (รหัส+ครู/ห้อง) เรียงตามจำนวนคาบ */
function solveGroups(s) {
  const groups = new Map();
  for (const u of s.unplaced) {
    const a = idx.asg.get(u.assignmentId);
    const L = a ? assignmentLabel(a) : null;
    const k = groupKey(u);
    const g = groups.get(k) || { k, n: 0, items: [], ids: [], reason: u.reason, code: u.code || null, params: u.params || null };
    g.n += u.remaining || 0;
    g.ids.push(u.assignmentId);
    g.items.push(L ? `${L.cls?.name || ''} ${L.name} (${u.remaining})` : `${u.assignmentId} (${u.remaining})`);
    groups.set(k, g);
  }
  return [...groups.values()].sort((x, y) => y.n - x.n);
}

function solveReportHTML() {
  const s = lastSolve;
  const close = '<button class="btn btn-sm" id="solve-report-close" aria-label="ปิดรายงาน">ปิด</button>';
  if (s.error) return `<div class="card callout warn"><div class="callout-head"><b>จัดอัตโนมัติไม่สำเร็จ</b>${close}</div><p style="margin:4px 0 0">${esc(s.error)}</p></div>`;
  const sum = summarize({ unplaced: s.unplaced, skipped: s.skipped, hard: s.hard, mode: s.mode, n: s.placed, added: s.added });
  const anim = reportAnim;
  const box = (tone, inner) => `<div class="card callout ${tone}${anim ? ' m-in' : ''}" data-report="1">${inner}</div>`;
  const clashBtns = s.hard ? `<div class="fix-acts" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"><button class="btn btn-sm btn-primary" data-clash="unpin">เลิกปักหมุดที่ชน</button><button class="btn btn-sm" data-clash="see">ดูจุดชน</button></div>` : '';
  if (!sum.miss && !s.skipped) {
    if (s.hard) {
      return box('warn', `<div class="callout-head"><b>${esc(sum.head)}</b>${close}</div>
        <p style="margin:4px 0 0">คาบที่ลากวางเอง (ปักหมุด) ซ้อนกันในช่องเดียวกัน ระบบจึงย้ายให้ไม่ได้ — กด “เลิกปักหมุดที่ชน” แล้วกด <b>จัดอัตโนมัติ → จัดใหม่ทั้งหมด</b> ระบบจะหาที่ใหม่ให้</p>${clashBtns}`);
    }
    // จัดครบ: ตัวเลขนับขึ้นตอนเผยตาราง (ไม่บอกเวลาที่ใช้ — ไม่ช่วยอะไร)
    return box('go', `<div class="callout-head"><b>จัดครบทุกคาบแล้ว <span class="n-up" data-n="${s.placed}">${renderPhase ? 0 : s.placed}</span> คาบ ไม่มีคาบชน</b>${close}</div>
      <p style="margin:4px 0 0">ไม่มีคาบชน · ครูทุกคนไม่สอนเกินเพดาน · ลากคาบเพื่อปรับได้ (คาบที่ลากเองจะปักหมุด) · พร้อมพิมพ์ที่แท็บ <b>ส่งออก</b></p>`);
  }
  const sm = small();
  const fixed = s.fixedG || new Set();
  const lis = [];
  if (s.skipped && !fixed.has('skip')) lis.push(card(`การสอน ${s.skipped} รายการยังไม่ได้เลือกห้องเรียนหรือครู จึงไม่ถูกนำไปจัด${actsHTML('NO_TEACHER', {}, {}, 'assignments')}`, 'skip', anim ? ' m-in' : ''));
  const groups = solveGroups(s).filter((g) => !fixed.has(g.k));
  groups.slice(0, 8).forEach((g, i) => {
    const [fix, goto] = fixFor(g.reason, g.code, g.params);
    const names = g.items.slice(0, 6).join(', ') + (g.items.length > 6 ? ` และอีก ${g.items.length - 6} รายการ` : '');
    const done = s.fixing?.g === g.k;
    // แก้แล้ว (รอจางออก): ปุ่มเป็น ✓ กดซ้ำไม่ได้
    const acts = done ? `<div class="fix-acts" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"><button class="btn btn-sm btn-primary btn-done" disabled>${esc(s.fixing.label)}</button></div>` : actsHTML(g.code, g.params, { assignmentIds: g.ids }, goto);
    const detail = `<span class="muted">${esc(names)}</span><br><span class="fix">วิธีแก้: ${esc(fix)}</span>${acts}`;
    // มือถือ: สาเหตุละ 1 บรรทัด กางเฉพาะข้อแรก (ปุ่มแก้สีทองอยู่ในข้อแรกที่กางไว้)
    const body = sm ? `<details ${i === 0 || done ? 'open' : ''}><summary><b>${esc(g.reason)}</b> — ${g.n} คาบ</summary>${detail}</details>` : `<b>${esc(g.reason)}</b> — ${g.n} คาบ<br>${detail}`;
    lis.push(card(body, g.k, anim ? ' m-in' : ''));
  });
  const more = groups.length > 8 ? `<p class="muted" style="margin:0">และอีก ${groups.length - 8} สาเหตุ</p>` : '';
  return box('warn', `<div class="callout-head"><b>${esc(sum.head)}</b>${close}</div>
    <p style="margin:4px 0 0">${sm ? 'กดปุ่มสีทองให้ระบบแก้ให้ (เลิกทำได้) แล้วกด <b>จัดเฉพาะที่ยังขาด</b>' : 'สาเหตุและวิธีแก้ด้านล่าง กดปุ่มสีทองให้ระบบแก้ให้ (เลิกทำได้) แล้วกด <b>จัดเฉพาะที่ยังขาด</b> — คาบที่วางได้แล้วยังอยู่ ลากวางส่วนที่เหลือเองก็ได้'}</p>
    ${s.hard ? `<p style="margin:6px 0 0"><b style="color:var(--danger)">มีคาบที่ปักหมุดชนกันเอง ${s.hard} จุด</b></p>${clashBtns}` : ''}
    <ul class="m-stagger">${lis.join('')}</ul>${more}`);
}

/** "เลิกปักหมุดที่ชน": ปลดหมุดของคาบในจุดชน (ตัวตรวจชุดเดียวกับป้าย "ชน") → จัดใหม่ทั้งหมดย้ายให้ได้ */
function unpinClashes() {
  const d = store.doc;
  const hit = new Set();
  for (const c of conflicts) for (const p of d.placements) if (p.pinned && p.day === c.day && p.period === c.period && (c.ids || []).includes(p.assignmentId)) hit.add(p);
  if (!hit.size) { notify.info('ไม่มีคาบที่ปักหมุดในจุดชนแล้ว'); return; }
  for (const p of hit) p.pinned = false;
  store.commit('pin');
  notify.action(`เลิกปักหมุด ${hit.size} คาบที่ชนแล้ว — กด “จัดใหม่ทั้งหมด” ให้ระบบหาที่ใหม่`, 'จัดใหม่ทั้งหมด', () => autoSolve('all', { noAsk: true }), 8000);
}
function seeClashes() {
  const box = root?.querySelector('.issues');
  if (!box) return;
  box.scrollIntoView({ behavior: motion.still() ? 'auto' : 'smooth', block: 'center' });
  motion.flash(box);
}

/** "ดูวิธีแก้" ของครูบูรณ์: เปิดมุมมองที่เกี่ยวข้อง + ไฮไลต์ช่องปัญหา → เลื่อนไปกล่องรายงาน → ชี้ปุ่มแก้สีทองตัวแรก */
const T_CODES = new Set(['TEACHER_MAX_DAY', 'TEACHER_OVER', 'BLOCKED_TEACHER', 'CROWDED_MAX_DAY', 'CROWDED_TEACHER', 'DOUBLE_NO_SLOT']);
const C_CODES = new Set(['CLASS_OVER', 'BLOCKED_CLASS', 'CROWDED_CLASS']);
const R_CODES = new Set(['ROOM_OVER', 'BLOCKED_ROOM', 'CROWDED_ROOM']);
let glowTimer = 0;
export function showFix() {
  if (!root) return;
  const top = lastSolve && !lastSolve.error ? solveGroups(lastSolve).find((g) => !lastSolve.fixedG?.has(g.k)) : null;
  const p = top?.params || {};
  let kind = null;
  if (top && T_CODES.has(top.code) && idx.tch.has(p.teacherId)) { view = 'teacher'; selected.teacher = p.teacherId; kind = 't'; }
  else if (top && C_CODES.has(top.code) && idx.cls.has(p.classId)) { view = 'class'; selected.class = p.classId; kind = 'c'; }
  else if (top && R_CODES.has(top.code) && idx.room.has(p.roomId)) { view = 'room'; selected.room = p.roomId; kind = 'r'; }
  hideReport = false;
  if (kind) render(root);
  const st = motion.still();
  clearTimeout(glowTimer);
  const marks = [];
  if (kind) {
    for (const c of root.querySelectorAll('.tt .cell')) { c.classList.add(st ? 'm-outline-red' : 'm-glow-red'); marks.push(c); }
    if (kind === 't') for (const td of root.querySelectorAll('.tt td.unavail')) { if (st) { td.classList.add('m-outline-red'); marks.push(td); } else motion.once(td, 'tt-pulse-red'); }
    if (kind === 'c') for (const td of root.querySelectorAll('.tt td.lock')) { if (st) { td.classList.add('m-outline-red'); marks.push(td); } else motion.once(td, 'tt-blink'); }
    glowTimer = setTimeout(() => marks.forEach((m) => m.classList.remove('m-glow-red', 'm-outline-red')), st ? 3000 : 2000);
  }
  // ชิปที่ยังค้างสั่นพร้อมกันครั้งเดียว (หลังกล่องรายงานเลื่อนเข้ามา)
  if (!st) setTimeout(() => root?.querySelectorAll('.chip:not(.done)').forEach((c) => motion.shake(c)), 400);
  requestAnimationFrame(() => {
    root?.querySelector('.callout')?.scrollIntoView({ behavior: st ? 'auto' : 'smooth', block: 'start' });
    motion.hint('[data-fix].btn-primary');
  });
}

// ---------- จัดอัตโนมัติ (Web Worker) ----------
const secText = (ms) => (ms / 1000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SOLVE_OPTS = (seed) => ({ timeLimitMs: 6000, seed });
// 2 แบบ: 'missing' = จัดเฉพาะที่ยังขาด (ทุกคาบในตารางเป็น fixed ชั่วคราวใน input เท่านั้น ไม่แตะ pinned ใน doc)
//         'all' = จัดใหม่ทั้งหมด (fixed = เฉพาะคาบที่ปักหมุด แบบเดิม) · ชื่อโหมดลง meta.lastSolve.mode ให้แอดมินอ่าน
const MODE_TEXT = { missing: 'จัดเฉพาะที่ยังขาด', all: 'จัดใหม่ทั้งหมด' };
let prevVariant = null;      // { termId, placements(JSON), seed, lastSolve, meta } ก่อนกด "ลองอีกแบบ" — อยู่ใน memory เท่านั้น ไม่ลง doc

/** seed ของภาคเรียน: สร้างครั้งแรกแล้วเก็บใน settings.solveSeed → ข้อมูลเดิมกดจัดซ้ำได้ผลเดิม ("ลองอีกแบบ" = seed+1) */
function solveSeed() {
  const s = store.doc.settings;
  if (!Number.isSafeInteger(s.solveSeed)) s.solveSeed = Date.now() % 100000; // ลง doc พร้อม commit('solve')
  return s.solveSeed;
}

/** คาบในเอกสาร → คาบที่ยังใช้ได้กับข้อมูลตอนนี้ (สำเนาเก่าจากสแต็กเลิกทำ/แบบก่อน อาจอ้างการสอนที่ลบไปแล้ว คาบที่ไม่มีแล้ว หรือเกินคาบ/สัปดาห์ที่ลดลง) */
function validPlacements(list) {
  const d = store.doc, P = d.term.periods.length;
  const left = new Map(d.assignments.map((a) => [a.id, a.perWeek > 0 ? a.perWeek : 0])); // โควตาที่เหลือของแต่ละการสอน
  return list.filter((p) => {
    if (!p || !left.get(p.assignmentId) || !(p.day >= 0 && p.day < d.term.days && p.period >= 0 && p.period < P)) return false;
    left.set(p.assignmentId, left.get(p.assignmentId) - 1);
    return true;
  });
}

// ---------- เมนูจัดอัตโนมัติ ----------
function openSolveMenu(btn) {
  if (solving) { autoSolve(); return; } // ปุ่มเดียวกันเป็น "หยุดจัด" ระหว่างจัด
  const d = store.doc;
  if (!d.placements.length) { autoSolve('all'); return; } // ยังไม่มีตาราง ไม่มีอะไรให้เลือก
  document.querySelector('.cell-menu')?.remove();
  const left = d.assignments.reduce((s, a) => s + remaining(a), 0);
  const pinned = d.placements.filter((p) => p.pinned).length;
  const m = document.createElement('div');
  m.className = 'card cell-menu';
  m.setAttribute('role', 'menu');
  m.style.width = 'min(320px, calc(100vw - 16px))';
  m.innerHTML = `
    <button role="menuitem" data-mode="missing" ${left ? '' : 'disabled style="opacity:.55;cursor:not-allowed"'}><b>จัดเฉพาะที่ยังขาด</b>${left ? ` (${left} คาบ)` : ''}<br>
      <small class="muted">${left ? 'แนะนำเมื่อมีตารางแล้ว · คาบที่อยู่ในตารางอยู่ที่เดิมทุกคาบ' : 'จัดครบแล้ว ไม่มีคาบที่ยังขาด'}</small></button>
    <button role="menuitem" data-mode="all"><b>จัดใหม่ทั้งหมด</b><br>
      <small class="muted">ระบบวางใหม่ทั้งตาราง${pinned ? ` · คาบที่ปักหมุด ${pinned} คาบอยู่ที่เดิม` : ''}</small></button>`;
  const r = btn.getBoundingClientRect();
  document.body.appendChild(m);
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth) + window.scrollX) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (ev) => { if (!m.contains(ev.target) && ev.target !== btn) close(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { close(); btn.focus(); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  document.addEventListener('keydown', onKey, true);
  m.querySelector('button:not([disabled])')?.focus();
  m.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b || b.disabled) return;
    close();
    autoSolve(b.dataset.mode);
  });
}

// ---------- เลิกทำบนกระดาน ----------
// สแต็ก 20 ขั้นของ placements (ก่อน commit ที่มาจากกระดาน) อยู่ใน memory ของหน้านี้ · เลิกทำ = commit ใหม่ ('undo')
// ไม่ย้อน version ของเซิร์ฟเวอร์ จึงบันทึกอัตโนมัติต่อได้ไม่ชน 409 · ฐาน (undoBase) = สภาพหลัง commit ครั้งก่อน
const UNDO_MAX = 20;
const UNDO_TEXT = { place: 'การวาง/ย้ายคาบ', swap: 'การสลับคาบ', remove: 'การนำคาบออก', pin: 'การปักหมุด', solve: 'การจัดอัตโนมัติ', clear: 'การล้างคาบ' };
let undoStack = [];          // [{ snap: JSON ของ placements ก่อนแก้, reason }]
let undoDoc = null, undoBase = '[]';
const plSnap = () => JSON.stringify(store.doc?.placements || []);
const plKey = (p) => `${p.assignmentId}|${p.day}|${p.period}`;

/** เอกสารถูกแทนทั้งก้อน (โหลดภาคเรียน/รวมการแก้ไข 409/กู้ฉบับร่าง) → ล้างสแต็กแล้วตั้งฐานใหม่ · คืน true ถ้าเพิ่งตั้งใหม่
 *  (สำเนาก่อนรวมการแก้ไขจะเขียนทับคาบที่อีกเครื่องเพิ่งแก้ จึงห้ามเก็บไว้แม้เป็นภาคเรียนเดิม) */
function syncUndo() {
  if (store.doc === undoDoc) return false;
  undoStack = [];
  undoDoc = store.doc; undoBase = plSnap();
  return true;
}

store.onChange((reason) => {
  if (!store.doc || syncUndo()) return; // ไม่รู้สภาพก่อนหน้า → เริ่มนับจากตอนนี้
  const now = plSnap();
  if (UNDO_TEXT[reason] && now !== undoBase) {
    undoStack.push({ snap: undoBase, reason });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  } else if (!UNDO_TEXT[reason] && reason !== 'undo' && now !== undoBase) {
    undoStack = []; // คาบเปลี่ยนจากที่อื่น (แท็บข้อมูล/นำเข้า/แก้ให้เลย/ตัวช่วย) → สำเนาเก่าไม่ตรงข้อมูลแล้ว
  }
  undoBase = now;
  if (reason === 'place') pinTip();
});

function undoBoard() {
  if (solving) return;
  syncUndo();
  const u = undoStack.pop();
  if (!u) { notify.info('ยังไม่มีอะไรให้เลิกทำ'); return; }
  store.doc.placements = validPlacements(JSON.parse(u.snap));
  if (u.reason === 'solve' || u.reason === 'clear') hideReport = true; // รายงานผลจัดล้าสมัยแล้ว
  store.commit('undo');
  notify.info(`เลิกทำ${UNDO_TEXT[u.reason]}แล้ว${undoStack.length ? ` · ย้อนได้อีก ${undoStack.length} ขั้น` : ''}`, 2500);
}

// Ctrl/Cmd+Z เมื่อโฟกัสอยู่ที่กระดาน (หรือไม่ได้โฟกัสอะไร) และแท็บจัดตารางเปิดอยู่ · ช่องพิมพ์/กล่องโต้ตอบ = ปล่อยให้เบราว์เซอร์ทำเอง
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return;
  if (e.code !== 'KeyZ' && String(e.key).toLowerCase() !== 'z') return; // e.code = ตำแหน่งปุ่ม ใช้ได้ตอนแป้นพิมพ์เป็นภาษาไทย
  if (!root?.isConnected || !root.offsetParent) return;
  const a = document.activeElement;
  if (a && a !== document.body && !root.contains(a)) return;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  e.preventDefault();
  undoBoard();
});

// ลากวางเอง = ปักหมุดอัตโนมัติ (คงพฤติกรรมเดิม) → บอก 3 ครั้งแรกต่อเครื่อง
const PIN_TIP_KEY = 'tt:pinTip';
let pinTipShown = 0;         // ตัวนับในหน้า สำรองเมื่อ localStorage อ่าน/เขียนไม่ได้
function pinTip() {
  let n = pinTipShown;
  try { n = Math.max(n, +localStorage.getItem(PIN_TIP_KEY) || 0); } catch { /* ใช้ตัวนับในหน้า */ }
  if (n >= 3) return;
  pinTipShown = n + 1;
  try { localStorage.setItem(PIN_TIP_KEY, String(n + 1)); } catch { /* ไม่มีที่เก็บ */ }
  notify.info('วางแล้วและปักหมุดไว้ — จัดอัตโนมัติจะไม่ย้ายคาบนี้ แตะคาบเพื่อปลด', 6000);
}

// ---------- ผลจัดเพิ่มเติม: โหมด + คุณภาพตาราง 3 บรรทัด + ลองอีกแบบ ----------
const SCORE_KEY = 'tt:scoreOpen';

/** คาบว่างแทรกของครูแต่ละคน นับแบบเดียวกับ score() ใน solver (ช่องคาบเรียนระหว่างคาบแรก–คาบสุดท้ายของวันที่ไม่ได้สอน ไม่นับพัก) → ครูที่มากสุด */
function worstGap(pls) {
  const by = new Map(); // teacherId → Map(day → Set(period))
  for (const p of pls) {
    const t = idx.asg.get(p.assignmentId)?.teacherId;
    if (!t) continue;
    if (!by.has(t)) by.set(t, new Map());
    const days = by.get(t);
    if (!days.has(p.day)) days.set(p.day, new Set());
    days.get(p.day).add(p.period);
  }
  let best = null;
  for (const [t, days] of by) {
    let n = 0;
    for (const s of days.values()) {
      const lo = Math.min(...s), hi = Math.max(...s);
      for (let q = lo + 1; q < hi; q++) if (!s.has(q) && !isBreak(q)) n++;
    }
    if (n && (!best || n > best.n)) best = { teacherId: t, n };
  }
  return best;
}

function solveExtraHTML(enter = false) {
  const s = lastSolve;
  if (!s || s.termId !== store.termId || hideReport || s.error || !s.mode) return '';
  const miss = s.unplaced.reduce((n, u) => n + (u.remaining || 0), 0);
  const off = solving ? 'disabled' : '';
  let mode = '';
  if (s.mode === 'missing') {
    mode = miss
      ? `<p style="margin:0 0 6px"><b>วางเพิ่มได้ ${s.added} คาบ ยังขาด ${miss} คาบ</b> — ลอง “จัดใหม่ทั้งหมด” หรือปลดคาบของครู/ห้องที่เกี่ยวข้อง (แตะคาบ → เลิกปักหมุด/นำออก)
          <button class="btn btn-sm" data-solve="all" ${off}>จัดใหม่ทั้งหมด</button></p>`
      : `<p style="margin:0 0 6px"><b>วางเพิ่ม ${s.added} คาบ</b> · คาบที่อยู่ในตารางก่อนหน้าอยู่ที่เดิมทุกคาบ</p>`;
  }
  const back = prevVariant && prevVariant.termId === store.termId ? ` <button class="btn btn-sm" data-solve="back" ${off}>กลับไปแบบก่อน</button>` : '';
  return `<div class="card solve-extra${enter ? ' m-in' : ''}" style="padding:10px 14px;margin-bottom:12px">${mode}
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <button class="btn btn-sm" data-solve="again" ${off} title="จัดด้วยลำดับสุ่มชุดถัดไป (${esc(MODE_TEXT[s.mode] || '')}) — กลับมาแบบนี้ได้">ลองอีกแบบ</button>${back}
      <span class="muted" style="font-size:.82rem">กดจัดซ้ำด้วยข้อมูลเดิมได้ผลเดิมทุกครั้ง</span></div></div>`;
}

/** คุณภาพตาราง (ใต้ภาพรวมทั้งโรงเรียน) · adjacentDays = ส่วนที่เกินจำเป็น (solver รุ่นใหม่) หรือค่าดิบ (รุ่นเดิม) · 0 = ✓ */
function scoreHTML() {
  const s = lastSolve;
  if (!s || s.termId !== store.termId || hideReport || s.error || !s.soft) return '';
  const q = s.soft, g = s.gapTop && idx.tch.has(s.gapTop.teacherId) ? s.gapTop : null;
  let open = true;
  try { open = localStorage.getItem(SCORE_KEY) !== '0'; } catch { /* ค่าเริ่มต้น = กาง */ }
  const good = !q.sameDay && !q.adjacentDays && !q.teacherGaps;
  const ok = (n) => (n ? '' : '<span class="ok-mark" aria-label="ผ่าน">✓</span> ');
  return `<details id="solve-score" ${open ? 'open' : ''}><summary style="cursor:pointer"><b>คุณภาพตาราง</b> <span class="muted">${good ? '· ดีมาก ไม่มีจุดให้ปรับ' : '· ยิ่งน้อยยิ่งดี'}</span></summary>
      <ul style="margin:6px 0 0;padding-left:20px">
        <li>${ok(q.sameDay)}วิชาเดียวกันลงวันเดียวกันซ้ำ ${q.sameDay || 0} ครั้ง</li>
        <li>${ok(q.adjacentDays)}วิชาเดียวกันลงวันติดกันเกินจำเป็น ${q.adjacentDays || 0} ครั้ง</li>
        <li>${ok(q.teacherGaps)}ครูมีคาบว่างแทรกรวม ${q.teacherGaps || 0} คาบ${g ? ` (มากสุด: <button class="btn btn-sm" data-tview="${esc(g.teacherId)}" title="ดูตารางสอนของครูคนนี้">${esc(tName(g.teacherId))} ${g.n} คาบ</button>)` : ''}</li>
      </ul></details>`;
}

/** "ลองอีกแบบ": เก็บแบบปัจจุบันไว้ในหน้า แล้วจัดโหมดเดิมด้วย seed+1 (ไม่ถามยืนยัน เพราะกลับไปแบบก่อนได้) */
function tryAnother() {
  const s = lastSolve, d = store.doc;
  if (solving || !s || s.termId !== store.termId || !Number.isSafeInteger(s.seed)) return;
  prevVariant = { termId: store.termId, placements: plSnap(), seed: s.seed, lastSolve: s, meta: d.meta?.lastSolve ? { ...d.meta.lastSolve } : null };
  d.settings.solveSeed = s.seed + 1;
  // จัดเฉพาะที่ขาด: คาบที่รอบก่อนวางเพิ่ม (และยังไม่ถูกปักหมุด) ต้องขยับได้ ไม่งั้น seed ใหม่ได้ผลเดิม
  autoSolve(s.mode, { again: true, drop: s.mode === 'missing' ? s.addedKeys : null });
}

function backVariant() {
  const v = prevVariant, d = store.doc;
  if (solving || !v || v.termId !== store.termId) return;
  prevVariant = null;
  d.placements = validPlacements(JSON.parse(v.placements));
  d.settings.solveSeed = v.seed;
  if (v.meta) { if (!d.meta || typeof d.meta !== 'object') d.meta = {}; d.meta.lastSolve = v.meta; }
  lastSolve = v.lastSolve; hideReport = false;
  store.commit('solve'); // เลิกทำได้ด้วยสแต็ก + บันทึกเร็วแบบผลจัด
  notify.ok('กลับไปใช้แบบก่อนหน้าแล้ว', 3000);
}

/** URL ของ worker พร้อมเลขเวอร์ชัน (import map ใช้กับ new Worker ไม่ได้ ต้อง resolve เอง) + ส่งเวอร์ชันของ solver.js ให้ worker import ไฟล์ใหม่ */
function workerURL() {
  let w = null, sv = null;
  try { w = import.meta.resolve('./solver/solver.worker.js'); sv = new URL(import.meta.resolve('./solver/solver.js')).searchParams.get('v'); } catch { /* เบราว์เซอร์เก่า */ }
  const u = new URL(w || './solver/solver.worker.js', import.meta.url);
  if (sv && /^\d+$/.test(sv)) u.searchParams.set('sv', sv);
  return u;
}

// ---------- ฉากจัดอัตโนมัติ: ขั้นต่ำ 1.2 วิ ที่ไม่หน่วงผลจริง ----------
// ผลเข้า store ทันทีที่ worker ตอบ (ข้อมูลไม่รอ) แต่ "การเผย" รอให้ครบ 1.2 วิ ตั้งแต่กด แล้วคาบค่อย ๆ ลงตาราง (CSS delay ไม่ใช่ JS loop)
// ลดการเคลื่อนไหว/หยุดภาพเคลื่อนไหว = ไม่มีขั้นต่ำ ตารางขึ้นทันที แถบความคืบหน้าตามจริง
const PHASE_TEXT = { greedy: 'กำลังวางคาบหลัก…', hard: 'กำลังกันครูชนกัน…', repair: 'กำลังเกลี่ยคาบที่ชน…', soft: 'กำลังเกลี่ยให้ทั่วสัปดาห์…' };
const PHASE_ORDER = ['greedy', 'hard', 'soft'];
const guest = () => !!globalThis.window?.TT?.school?.guest;

function startScene(mode) {
  const d = store.doc;
  if (scene) { if (scene.result) skipScene(); else { scene.after = null; finishScene(); } }
  const btn = root?.querySelector('#auto-solve');
  // แช่ส่วนเหนือตารางตามที่ผู้ใช้เห็นอยู่ (รวม details ที่กางเอง) · ตัดคลาส/แอตทริบิวต์ที่ทำให้เล่นแอนิเมชันซ้ำหรือถูกนับเลขซ้ำ
  const topEl = root?.querySelector('.tt-top'), ovEl = root?.querySelector('.overview-map');
  const frozen = {
    top: (topEl?.innerHTML || '').replace(/ data-report="1"/g, '').replace(/ m-(?:in|out)\b/g, '').replace(/class="m-stagger"/g, ''),
    hasOv: !!ovEl, ovOpen: !!ovEl?.open, score: !!ovEl?.querySelector('#solve-score'), ov: '',
  };
  const sc = scene = {
    termId: store.termId, t0: performance.now(), mode, phase: 'run', result: false, real: 0, p: 0, seen: [], shown: -1,
    prevLeft: d.assignments.reduce((n, a) => n + remaining(a), 0), prevHard: conflicts.length,
    prevRem: new Map(d.assignments.map((a) => [a.id, remaining(a)])), btnW: btn?.offsetWidth || 0,
    ghost: null, timer: 0, raf: 0, msgTimer: 0, after: null, landKeys: null, revealMs: 0, frozen, frozenDrawn: false,
  };
  if (root) root.dataset.solve = 'run';
  // แถบความคืบหน้า: rAF เดียว · max(ความคืบหน้าจริง, เวลาที่ผ่าน/1.2 วิ) ไม่เกิน 90% จนได้ผล · ไม่ถอยหลัง
  const raf = globalThis.requestAnimationFrame || ((f) => setTimeout(() => f(performance.now()), 50));
  const tick = () => {
    if (scene !== sc) return;
    const st = motion.still();
    let want = st ? sc.real : Math.max(sc.real, (performance.now() - sc.t0) / MIN_SCENE);
    want = Math.min(sc.result ? 1 : 0.9, sc.result && st ? 1 : want);
    sc.p = Math.max(sc.p, want);
    const bar = root?.querySelector('#solve-progress');
    if (bar) { bar.hidden = false; bar.firstElementChild.style.transform = `scaleX(${sc.p.toFixed(3)})`; }
    mascot.progress(sc.p);
    if (sc.phase === 'run' || sc.phase === 'pre') sc.raf = raf(tick);
  };
  sc.raf = raf(tick);
  mascot.preload('celebrate', 'comfort');
  thinkTick(sc);
  sc.msgTimer = setInterval(() => thinkTick(sc), 600);
}

/** ข้อความครูบูรณ์ระหว่างจัด: สลับทุก 600ms ตามขั้นที่ worker บอก (ไม่มี = ตามเวลา greedy → hard → soft) */
function thinkTick(sc) {
  if (scene !== sc || (sc.result && sc.phase !== 'pre')) return;
  const real = sc.seen.length > 0;
  const list = real ? sc.seen : PHASE_ORDER;
  const i = real ? Math.min(sc.shown + 1, list.length - 1) : Math.min(PHASE_ORDER.length - 1, Math.floor((performance.now() - sc.t0) / 600));
  if (i === sc.shown) return;
  sc.shown = i;
  const tail = sc.mode === 'missing' ? 'คาบที่อยู่ในตารางแล้วอยู่ที่เดิม' : 'คาบที่ปักหมุดไว้ไม่ถูกย้าย';
  mascot.set('thinking', { msg: `${PHASE_TEXT[list[i]] || 'กำลังจัดให้ครับ…'} ${tail}` });
}
function notePhase(sc, ph) {
  if (ph && PHASE_TEXT[ph] && !sc.seen.includes(ph)) sc.seen.push(ph);
}

/** ความคืบหน้าจริงจาก worker (ถ้า solver ส่ง placements/delta มา): เงาจางในตารางที่เปิดอยู่ ไม่แตะ store */
function noteGhost(sc, msg) {
  if (!Array.isArray(msg.placements) && !(msg.delta && typeof msg.delta === 'object')) return;
  if (!sc.ghost) sc.ghost = new Map();
  // รายการเต็ม = [{assignmentId, day, period}] · delta = {add, remove} ของ [assignmentId, day, period] (หรืออ็อบเจกต์แบบเดียวกัน)
  const norm = (x) => (Array.isArray(x) ? { assignmentId: x[0], day: x[1], period: x[2] } : x);
  if (Array.isArray(msg.placements)) { sc.ghost.clear(); for (const p of msg.placements) sc.ghost.set(plKey(p), p); }
  else {
    for (const x of msg.delta.remove || []) sc.ghost.delete(plKey(norm(x)));
    for (const x of msg.delta.add || []) { const p = norm(x); sc.ghost.set(plKey(p), p); }
  }
  if (sc.ghostQ) return;
  sc.ghostQ = true;
  requestAnimationFrame(() => { sc.ghostQ = false; drawGhosts(sc); });
}
function drawGhosts(sc) {
  // ระหว่างจัด และช่วงรอเผย ('pre') เงายังอยู่ให้เห็นว่าคาบจะลงตรงไหน → render รอบเผยแทนที่ด้วยคาบจริง
  if (scene !== sc || (sc.result && sc.phase !== 'pre') || !root || motion.still()) return;
  const id = currentId();
  root.querySelectorAll('.m-ghost-cell').forEach((x) => x.remove());
  if (!id || !sc.ghost) return;
  const tds = new Map();
  for (const td of root.querySelectorAll('.tt td[data-day]')) tds.set(td.dataset.day + '|' + td.dataset.period, td);
  for (const p of sc.ghost.values()) {
    const a = idx.asg.get(p.assignmentId);
    if (!a || (view === 'class' ? a.classId : view === 'teacher' ? a.teacherId : a.roomId) !== id) continue;
    const td = tds.get(p.day + '|' + p.period);
    if (!td || td.querySelector('.cell:not(.m-pre), .m-ghost-cell')) continue;
    const g = document.createElement('div');
    g.className = 'm-ghost-cell';
    g.setAttribute('aria-hidden', 'true');
    g.style.setProperty('--c', assignmentLabel(a).color);
    td.appendChild(g);
  }
}

/** ถึงจังหวะเผย: วาดรอบเดียวด้วย m-land (ไล่ตาม --i) แล้วรอให้ช่องสุดท้ายลงเสร็จ */
function revealScene(sc) {
  if (scene !== sc) return;
  sc.phase = 'reveal';
  if (root?.isConnected && !root.hidden && store.termId === sc.termId) render(root);
  sc.timer = setTimeout(() => finishScene(sc), (sc.revealMs || 700) + 80);
}

/** จบฉาก (เผยครบ/ผู้ใช้ข้าม/หยุด) → ซ่อนแถบ ลบเงา แล้วค่อยฉลอง/ปลอบ + toast (sc.after) */
function finishScene(sc = scene) {
  if (!sc || scene !== sc) return;
  scene = null;
  clearTimeout(sc.timer); clearInterval(sc.msgTimer);
  try { globalThis.cancelAnimationFrame?.(sc.raf); } catch { /* */ }
  if (root) {
    root.dataset.solve = 'done';
    const bar = root.querySelector('#solve-progress');
    if (bar) bar.hidden = true;
    root.querySelectorAll('.m-ghost-cell').forEach((x) => x.remove());
    // ฉากจบ: ค่อยวาดรายงาน + ลองอีกแบบ + ภาพรวม (ก่อนฉลอง/toast เพื่อให้ลูกศรของครูบูรณ์ชี้ปุ่มแก้ได้)
    if (sc.frozenDrawn && root.isConnected && store.termId === sc.termId) finishRender(sc);
  }
  sc.after?.();
}

/** วาดผลหลังจบฉาก: ตาราง (.board) ถูกดันลงเพราะรายงานเกิดใหม่ → FLIP ให้เลื่อนลงนุ่ม ๆ แทนการกระโดด (transform อย่างเดียว) */
function finishRender(sc) {
  const still = motion.still();
  const b0 = still ? null : root.querySelector('.board')?.getBoundingClientRect().top;
  finishFx = sc.result && !still ? { hadOv: sc.frozen.hasOv } : null;
  render(root);
  finishFx = null;
  const board = root.querySelector('.board');
  if (b0 == null || !board) return;
  const dy = b0 - board.getBoundingClientRect().top;
  if (Math.abs(dy) >= 1) motion.play(board, [{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'none' }], { duration: 420, easing: motion.EASE.out });
}

/** คลิกกระดานระหว่างฉาก = ตารางขึ้นครบทันที */
function skipScene() {
  const sc = scene;
  if (!sc || !sc.result) return;
  if (sc.phase === 'pre' || sc.phase === 'reveal') { sc.phase = 'none'; if (root?.isConnected) render(root); }
  else if (root) motion.skipScene(root);
  finishScene(sc);
}

/** จัดอัตโนมัติ · mode 'missing' | 'all' · o.again = มาจาก "ลองอีกแบบ" (ไม่ถาม ไม่ล้างแบบก่อน) · o.noAsk = ไม่ถามยืนยัน · เรียกตอนกำลังจัด = หยุด */
async function autoSolve(mode = 'all', o = {}) {
  if (solving) {
    solving.terminate(); solving = null; busy?.close(); busy = null;
    if (scene) { scene.after = null; finishScene(); }
    render(root); mascot.refresh(); notify.info('หยุดการจัดอัตโนมัติแล้ว'); return;
  }
  if (mode !== 'missing') mode = 'all';
  if (mode === 'all' && !o.again && !o.noAsk) {
    const loose = store.doc.placements.filter((p) => !p.pinned).length;
    if (loose && !(await notify.confirm({
      title: 'จัดใหม่ทั้งหมด?', icon: 'warning', ok: 'จัดใหม่ทั้งหมด',
      text: `จะย้าย ${loose} คาบที่ระบบวางไว้ (คาบที่ปักหมุดอยู่ที่เดิม) — ถ้าแค่อยากเติมคาบที่ยังขาด เลือก “จัดเฉพาะที่ยังขาด” · เลิกทำได้ด้วยปุ่ม “เลิกทำ”`,
    }))) return;
    if (solving) return; // กดซ้ำระหว่างรอยืนยัน
  }
  if (!o.again) prevVariant = null; // "กลับไปแบบก่อน" ใช้ได้เฉพาะต่อจาก "ลองอีกแบบ"
  syncUndo(); // ฐานของสแต็ก = สภาพก่อนจัด (เผื่อเอกสารเพิ่งถูกแทนโดยยังไม่ได้วาดกระดาน)
  const input = solverInput(mode === 'all');
  const skipped = store.doc.assignments.length - input.assignments.length;
  // ปักหมุดชั่วคราว: ส่งเฉพาะคาบของการสอนที่อยู่ใน input (คาบของแถวที่ยังไม่มีครูเก็บไว้ใน doc ตามเดิมทั้ง 2 โหมด ดู applyResult)
  const ids = new Set(input.assignments.map((a) => a.id));
  // "ลองอีกแบบ" ของจัดเฉพาะที่ขาด: ไม่ตรึงคาบที่รอบก่อนวางเพิ่ม (drop) → seed ใหม่ได้แบบใหม่จริง
  const drop = o.drop instanceof Set ? o.drop : null;
  const dropped = new Set(store.doc.placements.filter((p) => drop && !p.pinned && ids.has(p.assignmentId) && drop.has(plKey(p))));
  const dropKeys = new Set([...dropped].map(plKey));
  input.fixed = input.fixed.filter((f) => ids.has(f.assignmentId) && !dropKeys.has(plKey(f)));
  // คาบของแถวที่ไม่ได้ส่งเข้า solver = ห้องนั้นไม่ว่าง → ส่งเป็นคาบล็อกชั่วคราวของห้อง กัน solver วางวิชาอื่นทับ
  for (const p of store.doc.placements) {
    const a = idx.asg.get(p.assignmentId);
    if (a && !ids.has(a.id) && idx.cls.has(a.classId)) input.locks.push({ classId: a.classId, day: p.day, period: p.period, label: 'คาบที่ยังไม่มีครู' });
  }
  const run = { mode, ids, before: store.doc.placements.length - dropped.size, dropped };
  hideReport = false;
  if (!input.assignments.length) {
    lastSolve = { termId: store.termId, error: store.doc.assignments.length
      ? 'การสอนทุกรายการยังไม่ได้เลือกห้องเรียนหรือครู ไปที่แท็บข้อมูล → การสอน แล้วเลือกให้ครบ'
      : 'ยังไม่มีการสอนให้จัด ไปที่แท็บข้อมูล → การสอน เพื่อจับคู่วิชา ห้อง และครูก่อน' };
    render(root); mascot.set('comfort', { msg: lastSolve.error }); notify.warn(lastSolve.error, 7000); return;
  }
  const t0 = performance.now(); // นับตั้งแต่กดจนได้ผล (รวมเวลาเปิด worker) = เวลาที่ผู้ใช้รอจริง
  const opts = SOLVE_OPTS(solveSeed());
  run.seed = opts.seed;
  startScene(mode);
  let worker = null;
  try { worker = new Worker(workerURL(), { type: 'module' }); } catch (e) { console.warn('เปิด worker ไม่ได้', e); }
  if (!worker) { solveInPage(input, opts, t0, skipped, run); return; }
  solving = worker;
  render(root);
  busy = notify.loading(mode === 'missing' ? 'กำลังวางคาบที่ยังขาด… คาบที่อยู่ในตารางแล้วไม่ถูกย้าย' : 'กำลังจัดตาราง… คาบที่ปักหมุดไว้จะไม่ถูกย้าย');
  let heard = false;
  const sc = scene;
  const stop = () => { clearTimeout(silent); clearTimeout(hard); worker.terminate(); if (solving === worker) solving = null; };
  // เบราว์เซอร์ที่ไม่รองรับ module worker บางตัวไม่ error แต่เงียบไปเลย → 8 วิไม่มีข่าว = จัดในหน้าแทน
  const silent = setTimeout(() => { if (!heard) { stop(); solveInPage(input, opts, t0, skipped, run); } }, 8000);
  const hard = setTimeout(() => { stop(); failSolve('ตัวจัดตารางไม่ตอบกลับภายในเวลาที่กำหนด กรุณาลองกดอีกครั้ง หรือรีเฟรชหน้า'); }, opts.timeLimitMs + 20000);
  worker.onmessage = (ev) => {
    heard = true;
    const msg = ev.data || {};
    // ฟิลด์ใหม่ของ worker (pctMono/phase/placements/delta) เป็น optional ทั้งหมด — ไม่มีก็ทำงานเหมือนเดิม
    if (msg.type === 'progress') {
      if (sc && scene === sc) { sc.real = Math.max(sc.real, Number(msg.pctMono ?? msg.pct) || 0); notePhase(sc, msg.phase); noteGhost(sc, msg); }
      return;
    }
    if (msg.type === 'phase') { if (sc && scene === sc) notePhase(sc, msg.phase); return; }
    if (msg.type === 'done') { stop(); applyResult(msg.result, t0, skipped, run); }
    if (msg.type === 'error') { stop(); failSolve('ตัวจัดตารางทำงานผิดพลาด: ' + (msg.message || 'ไม่ทราบสาเหตุ') + ' — กรุณาส่งไฟล์สำรอง (แท็บส่งออก) ให้ผู้ดูแลตรวจสอบ'); }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    console.warn('solver worker error', e.message);
    stop();
    // โหลด worker ไม่ได้ (เบราว์เซอร์เก่า/แอปในไลน์) → จัดในหน้าแทน ผู้ใช้ยังได้ผลเหมือนเดิม แค่หน้าค้างไม่กี่วินาที
    if (!heard) solveInPage(input, opts, t0, skipped, run);
    else failSolve('ตัวจัดตารางหยุดทำงานกลางคัน: ' + (e.message || 'ไม่ทราบสาเหตุ'));
  };
  worker.postMessage({ type: 'solve', input, options: opts });
}

/** สำรอง: จัดใน main thread (ช้ากว่าเล็กน้อยและหน้าค้างระหว่างจัด) ใช้เมื่อเบราว์เซอร์เปิด module worker ไม่ได้ */
async function solveInPage(input, opts, t0, skipped, run) {
  solving = null;
  busy?.close();
  busy = notify.loading('กำลังจัดตาราง… (เบราว์เซอร์นี้จัดเบื้องหลังไม่ได้ หน้าจออาจค้างสักครู่)');
  if (!scene) startScene(run.mode);
  try {
    const m = await import('./solver/solver.js');
    await new Promise((r) => setTimeout(r, 50)); // ให้ toast แสดงก่อนหน้าค้าง
    applyResult(m.solve(input, { ...opts, timeLimitMs: 4000 }), t0, skipped, run);
  } catch (e) {
    console.error(e);
    failSolve('เบราว์เซอร์นี้เปิดตัวจัดตารางไม่ได้ (' + (e.message || e) + ') ลองเปิดด้วย Chrome หรือ Safari รุ่นใหม่ ถ้าเปิดจากแอป LINE ให้กด “เปิดในเบราว์เซอร์”');
  }
}

function failSolve(message) {
  solving = null;
  if (scene) { scene.after = null; finishScene(); }
  busy?.close(); busy = null;
  lastSolve = { termId: store.termId, error: message };
  hideReport = false;
  if (root) render(root);
  mascot.set('comfort', { msg: 'จัดไม่สำเร็จครับ ไม่ต้องห่วง ข้อมูลยังอยู่ครบ — ' + message, acts: [{ label: 'ลองอีกครั้ง', run: () => autoSolve('missing') }] });
  notify.alertBox('จัดอัตโนมัติไม่สำเร็จ', message, 'error');
}

/** ผลจาก solver → doc · run = { mode, ids (การสอนที่ส่งเข้า solver), before (จำนวนคาบก่อนจัด), seed } */
function applyResult(result, t0, skipped, run = { mode: 'all', ids: null, before: 0, seed: null }) {
  solving = null;
  const d = store.doc;
  const pinnedKey = new Set(d.placements.filter((p) => p.pinned).map(plKey));
  const beforeKeys = new Set(d.placements.map(plKey)); // ช่องที่มีคาบอยู่แล้วก่อนจัด → ไม่ต้องเผยซ้ำ
  const sec = secText(performance.now() - t0);
  // คาบที่ตรึงไว้ก่อนจัด (ไม่นับที่ปล่อยให้ "ลองอีกแบบ" ขยับ) → ส่วนที่เกินจากนี้ = คาบที่รอบนี้วางเพิ่ม
  const kept = new Set(d.placements.filter((p) => !run.dropped?.has(p)).map(plKey));
  let pls = (result.placements || []).map((p) => ({
    assignmentId: p.assignmentId, day: p.day, period: p.period, pinned: pinnedKey.has(plKey(p)),
  }));
  const addedKeys = run.mode === 'missing' ? new Set(pls.map(plKey).filter((k) => !kept.has(k))) : null;
  // คาบของการสอนที่ไม่ได้ส่งเข้า solver (ยังไม่มีครู) ไม่ถูกส่งกลับมา → เก็บไว้ตามเดิมทั้ง 2 โหมด ไม่ให้หาย (รวมคาบที่ปักหมุดไว้)
  if (run.ids) pls = pls.concat(d.placements.filter((p) => !run.ids.has(p.assignmentId)));
  d.placements = pls;
  const unplaced = result.unplaced || [];
  const miss = unplaced.reduce((s, u) => s + (u.remaining || 0), 0);
  const soft = result.stats?.soft || null;
  // คาบที่ปักหมุดชนกันเอง: solver วางครบแต่ยังชน (เดิมไม่ถูกดู → ขึ้น "ไม่มีคาบชน" ทั้งที่ชน)
  const hard = Math.max(0, Number(result.stats?.hardViolations) || 0);
  lastSolve = {
    termId: store.termId, sec, placed: pls.length, unplaced, warnings: result.stats?.warnings || [], skipped, hard,
    mode: run.mode, seed: run.seed, added: Math.max(0, pls.length - run.before), addedKeys, soft, gapTop: soft?.teacherGaps ? worstGap(pls) : null,
    fixedG: new Set(), fixing: null,
  };
  // ผลจัดล่าสุดให้แอดมินเห็นว่าโรงเรียนติดอะไร (store.sanitizeMeta บังคับรูปแบบ) · need = คาบที่ต้องวางทั้งโรงเรียน รวมแถวที่ยังไม่มีครู
  if (!d.meta || typeof d.meta !== 'object' || Array.isArray(d.meta)) d.meta = {};
  d.meta.lastSolve = {
    at: new Date().toISOString(), mode: run.mode, placed: pls.length,
    need: d.assignments.reduce((s, a) => s + (a.perWeek > 0 ? a.perWeek : 0), 0), unplaced: miss,
    codes: [...new Set([...(skipped ? ['NO_TEACHER'] : []), ...unplaced.map((u) => u.code).filter(Boolean), ...(hard ? ['PINNED_CLASH'] : [])])],
  };
  hideReport = false;
  reportAnim = true;
  const sum = summarize({ unplaced, skipped, hard, mode: run.mode, n: pls.length, added: lastSolve.added });
  const after = () => {
    busy?.close(); busy = null;
    if (sum.tone === 'ok') notify.ok(sum.toast, 4500); else notify.warn(sum.toast, 5000);
    boonAfterSolve(sum);
  };
  const sc = scene && scene.termId === store.termId ? scene : null;
  if (sc) {
    const st = motion.still();
    const wait = st ? 0 : Math.max(0, MIN_SCENE - (performance.now() - sc.t0));
    sc.result = true;
    sc.landKeys = new Set(pls.map(plKey).filter((k) => !beforeKeys.has(k)));
    sc.phase = st ? 'none' : wait > 0 ? 'pre' : 'reveal';
    sc.after = after;
    root?.querySelectorAll('.m-ghost-cell').forEach((x) => x.remove());
    store.commit('solve'); // ข้อมูลเข้าทันที (บันทึก/เลิกทำได้) · กระดานวาดคาบใหม่แบบซ่อนไว้ ('pre') หรือเผยเลย ('reveal')
    if (sc.phase === 'none') finishScene(sc);
    else if (sc.phase === 'pre') sc.timer = setTimeout(() => revealScene(sc), wait);
    else sc.timer = setTimeout(() => finishScene(sc), (sc.revealMs || 700) + 80);
    return;
  }
  store.commit('solve');
  after();
}

// ---------- ครูบูรณ์หลังจัด (assets/mascot.js) ----------
/** ครบ = ฉลอง + ปุ่มส่งออก · ครบแต่หมุดชน = ปลอบ + เลิกปักหมุด · ไม่ครบ = ปลอบ + ชี้สาเหตุที่กินคาบมากสุด (แก้ข้อนี้ข้อเดียวมักลงเกือบหมด) */
function boonAfterSolve(sum) {
  const s = lastSolve;
  if (!s) return;
  if (sum.tone === 'ok') {
    const acts = [
      { label: 'ส่งออก PDF / Excel', primary: true, go: { tab: 'export' }, hint: '#boon .boon-acts .btn-primary' },
      { label: 'ดาวน์โหลด PDF ทุกห้อง', go: { tab: 'export', action: 'pdf-all' } },
    ];
    if (small() && typeof globalThis.navigator?.share === 'function') acts.push({ label: 'ส่งเข้า LINE', go: { tab: 'export', action: 'share' } });
    let msg = 'เยี่ยมเลยครับ จัดครบทุกคาบ {n} คาบ ไม่มีคาบชน ครูทุกคนไม่สอนเกินเพดาน พร้อมพิมพ์แล้ว';
    if (guest()) {
      msg += ' · นี่คือโหมดทดลอง ดาวน์โหลดไฟล์สำรองไว้ก่อน แล้วสมัครด้วย Google เพื่อเก็บตารางของโรงเรียนไว้ใช้ต่อ';
      acts.push({ label: 'สมัครด้วย Google แล้วเก็บตารางนี้', href: 'auth/login.php?p=google' });
    }
    mascot.set('celebrate', { msg, count: s.placed, acts });
    return;
  }
  if (!sum.miss && !s.skipped && s.hard) {
    mascot.set('comfort', {
      msg: `ตารางครบแล้วครับ แต่คาบที่ปักหมุดไว้ชนกันเอง ${s.hard} จุด — เลิกปักหมุดคาบที่ชน แล้วจัดใหม่ทั้งหมด ระบบหาที่ใหม่ให้`,
      acts: [{ label: 'เลิกปักหมุดที่ชน', primary: true, run: unpinClashes, hint: '[data-clash="unpin"]' }, { label: 'ดูจุดชน', run: seeClashes }],
    });
    return;
  }
  const by = new Map();
  for (const u of s.unplaced) by.set(u.reason, (by.get(u.reason) || 0) + (u.remaining || 0));
  const top = [...by].sort((x, y) => y[1] - x[1])[0];
  const msg = top
    ? `เหลืออีก ${sum.miss} คาบครับ ไม่ต้องห่วง ส่วนใหญ่ติดที่ “${top[0]}” (${top[1]} คาบ) แก้ข้อนี้ข้อเดียวน่าจะลงเกือบหมด`
    : `การสอน ${s.skipped} รายการยังไม่มีครูหรือห้องเรียน จึงยังไม่ถูกจัดครับ เติมให้ครบแล้วกดจัดเฉพาะที่ยังขาด`;
  mascot.set('comfort', { msg, acts: [{ label: 'ดูวิธีแก้', primary: true, run: showFix, hint: '[data-fix].btn-primary' }, { label: 'จัดเฉพาะที่ยังขาด', run: () => autoSolve('missing') }] });
}
// ผู้ช่วยถูกซ่อน/เปิด → กล่อง "เริ่มต้นใน 4 ขั้น" ต้องแสดง/หาย
document.addEventListener('tt:boon', () => { if (root && !root.hidden && store.doc && !store.doc.assignments.length) render(root); });
