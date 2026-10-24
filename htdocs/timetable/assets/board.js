// บอร์ดจัดตาราง: มุมมองห้อง/ครู/ห้องพิเศษ, ลากวาง (เมาส์+นิ้ว), ตรวจชนทันที, จัดอัตโนมัติ
import {
  store, idx, DAY_NAMES, remaining, isBreak, lockAt, teacherUnavailable, placementsAt, whyCannotPlace,
  localValidate, CONFLICT_TEXT, esc, assignmentLabel,
} from './store.js';
import { gridModel, orientation, ORIENTS } from './rules.js';
import * as notify from './notify.js';
import * as mascot from './mascot.js';

let view = 'class';
let selected = { class: null, teacher: null, room: null };
let validator = null;       // validate() จาก solver.js ถ้ามี
let conflicts = [];
let solving = null;          // Worker ที่กำลังจัด
let lastSolve = null;        // { termId, sec, placed, unplaced[], warnings[], error } ผลการจัดครั้งล่าสุด แสดงค้างเหนือตาราง
let hideReport = false;      // ผู้ใช้กดปิดกล่องรายงานผลการจัด
let root = null;
let busy = null;             // toast "กำลังจัดตาราง" (notify.loading)

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
export function render(el) {
  root = el;
  const d = store.doc;
  computeConflicts();
  const id = currentId();
  const list = entities();
  const noun = { class: 'ห้องเรียน', teacher: 'ครู', room: 'ห้องพิเศษ' }[view];
  const totalLeft = d.assignments.reduce((s, a) => s + remaining(a), 0);
  const hard = conflicts.length;
  syncUndo(); // เปลี่ยนภาคเรียน/รวมการแก้ไข = เอกสารใหม่ทั้งก้อน → ตั้งฐานของสแต็กเลิกทำใหม่

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="มุมมอง">
        ${['class', 'teacher', 'room'].map((v) => `<button data-view="${v}" aria-pressed="${v === view}">${{ class: 'ห้องเรียน', teacher: 'ครู', room: 'ห้องพิเศษ' }[v]}</button>`).join('')}
      </div>
      <div class="orient" role="group" aria-label="แนวตาราง"><span class="lbl">แนวตาราง</span>
        <div class="seg orient-seg">${ORIENTS.map(([k, t]) => `<button data-orient="${k}" aria-pressed="${k === orientation(d)}" title="${k === 'days' ? 'แถว = วัน คอลัมน์ = คาบ' : 'แถว = คาบ คอลัมน์ = วัน'}">${t}</button>`).join('')}</div></div>
      <select id="ent-select" class="input input-sm" aria-label="เลือก${noun}">
        ${list.map((e) => `<option value="${esc(e.id)}" ${e.id === id ? 'selected' : ''}>${esc(e.name)}</option>`).join('') || `<option>ยังไม่มี${noun}</option>`}
      </select>
      <span class="pill ${hard ? 'warn' : 'ok'}" title="จำนวนจุดที่ชนทั้งโรงเรียน">${hard ? `ชน ${hard} จุด` : 'ไม่มีจุดชน'}</span>
      <span class="pill">เหลือจัด ${totalLeft} คาบ</span>
      <span class="spacer"></span>
      <div class="progress" id="solve-progress" hidden><i></i></div>
      <button class="btn btn-sm" id="undo-board" ${undoStack.length && !solving ? '' : 'disabled'} aria-keyshortcuts="Control+Z Meta+Z"
        title="${undoStack.length ? `เลิกทำ${UNDO_TEXT[undoStack[undoStack.length - 1].reason] || ''} (Ctrl+Z · ย้อนได้ ${undoStack.length} ขั้น)` : 'ยังไม่มีอะไรให้เลิกทำ'}">↶ เลิกทำ</button>
      <button class="btn btn-sm" id="clear-auto" title="ลบคาบที่ไม่ได้ปักหมุดทั้งโรงเรียน">ล้างที่ไม่ปักหมุด</button>
      <button class="btn btn-primary btn-sm" id="auto-solve" ${solving || !d.placements.length ? '' : 'aria-haspopup="menu"'}>${solving ? 'หยุดจัด' : d.placements.length ? 'จัดอัตโนมัติ ▾' : 'จัดอัตโนมัติ'}</button>
    </div>
    ${guideHTML(totalLeft)}
    ${solveExtraHTML()}
    <div class="board">
      <aside class="card palette" id="palette">${paletteHTML(id)}</aside>
      <div>
        <div class="card grid-wrap">${gridHTML(id)}</div>
        ${issuesHTML()}
      </div>
    </div>`;

  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(el); }));
  el.querySelectorAll('[data-orient]').forEach((b) => b.addEventListener('click', () => {
    if (orientation(d) === b.dataset.orient) return;
    d.settings.orientation = b.dataset.orient;
    store.commit('settings'); // วาดใหม่ผ่าน onChange + บันทึกเป็นค่าของภาคเรียน (ใช้กับ PDF/Excel ด้วย)
  }));
  el.querySelector('#ent-select')?.addEventListener('change', (e) => { selected[view] = e.target.value; render(el); });
  el.querySelector('#auto-solve').addEventListener('click', (e) => openSolveMenu(e.currentTarget));
  el.querySelector('#auto-solve-2')?.addEventListener('click', () => autoSolve('all')); // แสดงเฉพาะตอนยังไม่มีคาบในตาราง → ไม่ต้องเลือกแบบ
  el.querySelector('#undo-board').addEventListener('click', undoBoard);
  el.querySelectorAll('[data-solve]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.solve;
    if (k === 'again') tryAnother(); else if (k === 'back') backVariant(); else autoSolve(k);
  }));
  el.querySelectorAll('[data-tview]').forEach((b) => b.addEventListener('click', () => { view = 'teacher'; selected.teacher = b.dataset.tview; render(el); }));
  el.querySelector('#solve-score')?.addEventListener('toggle', (e) => { try { localStorage.setItem(SCORE_KEY, e.currentTarget.open ? '1' : '0'); } catch { /* ไม่มีที่เก็บ */ } });
  el.querySelector('#solve-report-close')?.addEventListener('click', () => { hideReport = true; render(el); });
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => gotoData(b.dataset.goto)));
  el.querySelector('#clear-auto').addEventListener('click', () => {
    const gone = d.placements.filter((p) => !p.pinned);
    if (!gone.length) { notify.info('ไม่มีคาบที่ไม่ได้ปักหมุด'); return; }
    d.placements = d.placements.filter((p) => p.pinned);
    store.commit('clear');
    notify.action(`ล้าง ${gone.length} คาบที่ไม่ได้ปักหมุดแล้ว`, 'เลิกทำ', () => { store.doc.placements.push(...gone); store.commit('undo'); notify.ok('คืนคาบที่ล้างแล้ว'); });
  });
  bindDrag(el);
}

function paletteHTML(id) {
  if (!id) return `<p class="empty">ยังไม่มีข้อมูล ไปที่แท็บ <b>ข้อมูล</b> เพื่อเพิ่มห้องเรียน ครู วิชา และการสอน หรือสร้างภาคเรียนจากข้อมูลตัวอย่าง</p>`;
  const list = relevantAssignments(id);
  if (!list.length) return `<h3>วิชาที่ต้องจัด</h3><p class="empty">ยังไม่มีการสอนของรายการนี้ เพิ่มได้ที่แท็บ <b>ข้อมูล → การสอน</b></p>`;
  const sorted = [...list].sort((a, b) => remaining(b) - remaining(a));
  return `<h3>วิชาที่ต้องจัด <span class="muted" style="font-weight:400;font-size:.85rem">ลากไปวางในตาราง</span></h3>` + sorted.map((a) => {
    const L = assignmentLabel(a), left = remaining(a);
    const sub = view === 'class' ? (L.tch?.short || L.tch?.name || '') : (L.cls?.name || '');
    return `<div class="chip ${left ? '' : 'done'}" data-asg="${esc(a.id)}" style="--c:${esc(L.color)}" title="${esc(L.code)} ${esc(L.name)}">
      <span class="t"><b>${esc(L.name)}</b><span>${esc(sub)}${L.room ? ' · ' + esc(L.room.name) : ''}${a.doubles ? ' · คาบคู่ ' + a.doubles : ''}</span></span>
      <span class="n" title="เหลือ/ทั้งหมด">${left}/${a.perWeek}</span></div>`;
  }).join('');
}

function gridHTML(id) {
  const d = store.doc;
  const g = gridModel(d);
  const tm = (p) => (p.start && p.end ? `${esc(p.start)}–${esc(p.end)}` : '');
  const headOf = (x) => (x.p ? `<span class="lbl">${x.brk ? esc(x.p.label || 'พัก') : 'คาบ ' + esc(x.p.label || x.period + 1)}</span><span class="tm">${tm(x.p)}</span>` : esc(x.name));
  let h = `<table class="tt ${g.orient === 'days' ? 'by-day' : 'by-period'}" data-orient="${g.orient}"><thead><tr><th>${g.corner}</th>${g.cols.map((c) => (c.brk
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
        h += `<div class="cell ${bad.length ? 'conflict' : ''}" data-pl="${d.placements.indexOf(pl)}" style="--c:${esc(L.color)}" title="${esc(tip)}">
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

// ---------- ลากวาง ----------
function bindDrag(el) {
  let drag = null;

  const start = (e, payload, srcEl) => {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { payload, srcEl, x: e.clientX, y: e.clientY, active: false, ghost: null, over: null, pointerId: e.pointerId };
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

  const move = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.active = true;
      drag.ghost = drag.srcEl.cloneNode(true);
      drag.ghost.classList.add('ghost');
      drag.ghost.style.width = drag.srcEl.offsetWidth + 'px';
      drag.ghost.style.height = drag.srcEl.offsetHeight + 'px'; // .cell สูง 100% ของช่อง ถ้าไม่ล็อกจะยืดเท่าทั้งหน้า
      document.body.appendChild(drag.ghost);
      drag.srcEl.classList.add('dragging');
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td[data-day]');
    if (td !== drag.over) {
      drag.over?.classList.remove('drop-ok', 'drop-bad', 'over');
      drag.over = td || null;
      if (td) {
        const why = whyCannotPlace(drag.payload.a, +td.dataset.day, +td.dataset.period, drag.payload.pl || null);
        td.classList.add(why ? 'drop-bad' : 'drop-ok', 'over');
        td.title = why || 'วางได้';
      }
    }
  };

  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dr = drag; drag = null;
    dr.ghost?.remove();
    dr.srcEl.classList.remove('dragging');
    dr.over?.classList.remove('drop-ok', 'drop-bad', 'over');
    if (!dr.active) { if (dr.payload.kind === 'move') openMenu(dr.srcEl, dr.payload.pl); return; }
    const td = dr.over;
    if (!td) return;
    const day = +td.dataset.day, period = +td.dataset.period;
    const why = whyCannotPlace(dr.payload.a, day, period, dr.payload.pl || null);
    if (why && !e.shiftKey) { notify.warn(`วางไม่ได้: ${why} (กด Shift ค้างเพื่อวางทับ)`, 4500); return; }
    if (dr.payload.kind === 'new') store.doc.placements.push({ assignmentId: dr.payload.a.id, day, period, pinned: true });
    else { dr.payload.pl.day = day; dr.payload.pl.period = period; dr.payload.pl.pinned = true; }
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
      return { msg: `ตั้ง “สูงสุด/วัน” ของ ${x.name} เป็น ${n} คาบแล้ว`, undo: (doc) => { const y = doc.teachers.find((z) => z.id === teacherId); if (y) y.maxPerDay = old; } };
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

/** กดปุ่มแก้: แก้ → commit ครั้งเดียว → toast เลิกทำ · ปุ่มพาไปแท็บ = tt:goto (app.js ส่ง section/filter ต่อให้ data.js) */
function runFix(act) {
  if (act.go) { document.dispatchEvent(new CustomEvent('tt:goto', { detail: act.go })); return null; }
  const d = store.doc, term = store.termId;
  const r = act.run(d);
  if (!r) { notify.info('ข้อมูลเปลี่ยนไปแล้ว ไม่มีอะไรต้องแก้'); return null; }
  hideReport = true; // รายงานผลจัดครั้งก่อนล้าสมัยแล้ว → กลับไปแสดงความพร้อม (ตรวจใหม่จากข้อมูลล่าสุด)
  store.commit('fix');
  notify.action(r.msg, 'เลิกทำ', () => {
    // เปลี่ยนภาคเรียน/รวมการแก้ไขระหว่างที่ toast ยังอยู่ → undo จะไปแก้เอกสารอื่น ห้ามทำ
    if (store.doc !== d || store.termId !== term) { notify.info('เปลี่ยนภาคเรียนไปแล้ว เลิกทำการแก้นี้ไม่ได้'); return; }
    r.undo(d); store.commit('undo'); notify.ok('คืนค่าเดิมแล้ว');
  });
  return r;
}

// ตัวจับคลิกกลางตัวเดียว (render วาด innerHTML ใหม่ทุกครั้ง จึงไม่ผูกทีละปุ่ม)
document.addEventListener('click', (ev) => {
  const b = ev.target?.closest?.('[data-fix]');
  if (!b || !root?.contains(b)) return;
  const act = fixActs[+b.dataset.fix];
  if (act) runFix(act);
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
const card = (body) => `<li class="fix-card" style="${CARD}">${ICON}<div style="min-width:0;flex:1">${body}</div></li>`;

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
    return `<div class="card callout ${issues.length ? 'warn' : 'go'}">
      <div class="callout-head"><b>ข้อมูลพร้อมแล้ว: การสอน ${d.assignments.length} รายการ รวม ${total} คาบ/สัปดาห์ · ยังไม่ได้วางลงตาราง</b>
      <button class="btn btn-primary btn-sm" id="auto-solve-2">จัดอัตโนมัติเลย</button></div>
      <p style="margin:4px 0 0">ขั้นต่อไป: กด <b>จัดอัตโนมัติ</b> ระบบจะวางทุกวิชาให้ภายในไม่กี่วินาที หรือลากวิชาจากรายการ “วิชาที่ต้องจัด” ไปวางในตารางเอง</p>
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

function solveReportHTML() {
  const s = lastSolve;
  const close = '<button class="btn btn-sm" id="solve-report-close" aria-label="ปิดรายงาน">ปิด</button>';
  if (s.error) return `<div class="card callout warn"><div class="callout-head"><b>จัดอัตโนมัติไม่สำเร็จ</b>${close}</div><p style="margin:4px 0 0">${esc(s.error)}</p></div>`;
  const miss = s.unplaced.reduce((n, u) => n + (u.remaining || 0), 0);
  const skipped = s.skipped ? card(`การสอน ${s.skipped} รายการยังไม่ได้เลือกห้องเรียนหรือครู จึงไม่ถูกนำไปจัด${actsHTML('NO_TEACHER', {}, {}, 'assignments')}`) : '';
  if (!miss && !s.skipped) {
    return `<div class="card callout go"><div class="callout-head"><b>จัดครบทุกคาบแล้ว ${s.placed} คาบ ไม่มีคาบชน</b>${close}</div>
      <p style="margin:4px 0 0">ใช้เวลา ${s.sec} วินาที · ลากคาบเพื่อปรับได้ (คาบที่ลากเองจะปักหมุด) · พร้อมพิมพ์ที่แท็บ <b>ส่งออก</b></p></div>`;
  }
  // รวมตามรหัส+ครู/ห้อง (หรือตามเหตุผลถ้าไม่มีรหัส): แสดงครั้งเดียว พร้อมรายชื่อห้อง/วิชาที่เกี่ยวข้อง
  const groups = new Map();
  for (const u of s.unplaced) {
    const a = idx.asg.get(u.assignmentId);
    const L = a ? assignmentLabel(a) : null;
    const k = groupKey(u);
    const g = groups.get(k) || { n: 0, items: [], ids: [], reason: u.reason, code: u.code || null, params: u.params || null };
    g.n += u.remaining || 0;
    g.ids.push(u.assignmentId);
    g.items.push(L ? `${L.cls?.name || ''} ${L.name} (${u.remaining})` : `${u.assignmentId} (${u.remaining})`);
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((x, y) => y.n - x.n).slice(0, 8).map((g) => {
    const [fix, goto] = fixFor(g.reason, g.code, g.params);
    const names = g.items.slice(0, 6).join(', ') + (g.items.length > 6 ? ` และอีก ${g.items.length - 6} รายการ` : '');
    return card(`<b>${esc(g.reason)}</b> — ${g.n} คาบ<br><span class="muted">${esc(names)}</span><br><span class="fix">วิธีแก้: ${esc(fix)}</span>${actsHTML(g.code, g.params, { assignmentIds: g.ids }, goto)}`);
  }).join('');
  const head = s.placed ? `จัดได้ ${s.placed} คาบ · วางไม่ลง ${miss} คาบ` : `ยังวางคาบไม่ได้เลย (วางไม่ลง ${miss} คาบ)`;
  return `<div class="card callout warn"><div class="callout-head"><b>${head}</b>${close}</div>
    <p style="margin:4px 0 0">สาเหตุและวิธีแก้ด้านล่าง กดปุ่มสีทองให้ระบบแก้ให้ (เลิกทำได้) แล้วกด <b>จัดอัตโนมัติ</b> อีกครั้ง — คาบที่วางได้แล้วยังอยู่ ลากวางส่วนที่เหลือเองก็ได้</p>
    <ul>${skipped}${rows}</ul>${groups.size > 8 ? `<p class="muted" style="margin:0">และอีก ${groups.size - 8} สาเหตุ</p>` : ''}</div>`;
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

function solveExtraHTML() {
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
  let score = '';
  if (s.soft) {
    const q = s.soft, g = s.gapTop && idx.tch.has(s.gapTop.teacherId) ? s.gapTop : null;
    let open = true;
    try { open = localStorage.getItem(SCORE_KEY) !== '0'; } catch { /* ค่าเริ่มต้น = กาง */ }
    const good = !q.sameDay && !q.adjacentDays && !q.teacherGaps;
    score = `<details id="solve-score" ${open ? 'open' : ''}><summary style="cursor:pointer"><b>คุณภาพตาราง</b> <span class="muted">${good ? '· ดีมาก ไม่มีจุดให้ปรับ' : '· ยิ่งน้อยยิ่งดี'}</span></summary>
      <ul style="margin:6px 0 0;padding-left:20px">
        <li>วิชาเดียวกันลงวันเดียวกันซ้ำ ${q.sameDay || 0} ครั้ง</li>
        <li>วิชาเดียวกันลงวันติดกัน ${q.adjacentDays || 0} ครั้ง</li>
        <li>ครูมีคาบว่างแทรกรวม ${q.teacherGaps || 0} คาบ${g ? ` (มากสุด: <button class="btn btn-sm" data-tview="${esc(g.teacherId)}" title="ดูตารางสอนของครูคนนี้">${esc(tName(g.teacherId))} ${g.n} คาบ</button>)` : ''}</li>
      </ul></details>`;
  }
  const back = prevVariant && prevVariant.termId === store.termId ? ` <button class="btn btn-sm" data-solve="back" ${off}>กลับไปแบบก่อน</button>` : '';
  return `<div class="card solve-extra" style="padding:10px 14px;margin-bottom:12px">${mode}${score}
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px">
      <button class="btn btn-sm" data-solve="again" ${off} title="จัดด้วยลำดับสุ่มชุดถัดไป (${esc(MODE_TEXT[s.mode] || '')}) — กลับมาแบบนี้ได้">ลองอีกแบบ</button>${back}
      <span class="muted" style="font-size:.82rem">กดจัดซ้ำด้วยข้อมูลเดิมได้ผลเดิมทุกครั้ง</span></div></div>`;
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

/** จัดอัตโนมัติ · mode 'missing' | 'all' · o.again = มาจาก "ลองอีกแบบ" (ไม่ถาม ไม่ล้างแบบก่อน) · เรียกตอนกำลังจัด = หยุด */
async function autoSolve(mode = 'all', o = {}) {
  if (solving) { solving.terminate(); solving = null; busy?.close(); render(root); mascot.refresh(); notify.info('หยุดการจัดอัตโนมัติแล้ว'); return; }
  if (mode !== 'missing') mode = 'all';
  if (mode === 'all' && !o.again) {
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
  let worker = null;
  try { worker = new Worker(workerURL(), { type: 'module' }); } catch (e) { console.warn('เปิด worker ไม่ได้', e); }
  if (!worker) { solveInPage(input, opts, t0, skipped, run); return; }
  solving = worker;
  render(root);
  const bar = root.querySelector('#solve-progress');
  bar.hidden = false;
  busy = notify.loading(mode === 'missing' ? 'กำลังวางคาบที่ยังขาด… คาบที่อยู่ในตารางแล้วไม่ถูกย้าย' : 'กำลังจัดตาราง… คาบที่ปักหมุดไว้จะไม่ถูกย้าย');
  boonThinking(mode);
  let heard = false;
  const stop = () => { clearTimeout(silent); clearTimeout(hard); worker.terminate(); if (solving === worker) solving = null; };
  // เบราว์เซอร์ที่ไม่รองรับ module worker บางตัวไม่ error แต่เงียบไปเลย → 8 วิไม่มีข่าว = จัดในหน้าแทน
  const silent = setTimeout(() => { if (!heard) { stop(); solveInPage(input, opts, t0, skipped, run); } }, 8000);
  const hard = setTimeout(() => { stop(); failSolve('ตัวจัดตารางไม่ตอบกลับภายในเวลาที่กำหนด กรุณาลองกดอีกครั้ง หรือรีเฟรชหน้า'); }, opts.timeLimitMs + 20000);
  worker.onmessage = (ev) => {
    heard = true;
    const msg = ev.data || {};
    if (msg.type === 'progress') { bar.firstElementChild.style.width = Math.round((msg.pct || 0) * 100) + '%'; mascot.progress(msg.pct); return; }
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
  boonThinking(run.mode);
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
  lastSolve = {
    termId: store.termId, sec, placed: pls.length, unplaced, warnings: result.stats?.warnings || [], skipped,
    mode: run.mode, seed: run.seed, added: Math.max(0, pls.length - run.before), addedKeys, soft, gapTop: soft?.teacherGaps ? worstGap(pls) : null,
  };
  // ผลจัดล่าสุดให้แอดมินเห็นว่าโรงเรียนติดอะไร (store.sanitizeMeta บังคับรูปแบบ) · need = คาบที่ต้องวางทั้งโรงเรียน รวมแถวที่ยังไม่มีครู
  if (!d.meta || typeof d.meta !== 'object' || Array.isArray(d.meta)) d.meta = {};
  d.meta.lastSolve = {
    at: new Date().toISOString(), mode: run.mode, placed: pls.length,
    need: d.assignments.reduce((s, a) => s + (a.perWeek > 0 ? a.perWeek : 0), 0), unplaced: miss,
    codes: [...new Set([...(skipped ? ['NO_TEACHER'] : []), ...unplaced.map((u) => u.code).filter(Boolean)])],
  };
  hideReport = false;
  store.commit('solve');
  const n = pls.length;
  busy?.close(); busy = null;
  boonAfterSolve(miss, skipped);
  if (!miss && !skipped) {
    notify.ok(run.mode === 'missing' ? `วางเพิ่ม ${lastSolve.added} คาบ ครบทุกคาบแล้ว คาบเดิมอยู่ที่เดิม · ใช้เวลา ${sec} วินาที` : `จัดเสร็จ ${n} คาบ ไม่มีคาบชน · ใช้เวลา ${sec} วินาที`, 4500);
    return;
  }
  solveSummary(n, miss, skipped);
}

// ---------- ครูบูรณ์ระหว่าง/หลังจัด (assets/mascot.js) ----------
function boonThinking(mode) {
  mascot.preload('celebrate', 'comfort');
  mascot.set('thinking', { msg: mode === 'missing' ? 'กำลังหาที่ให้คาบที่ยังขาดครับ คาบเดิมอยู่ที่เดิม…' : 'กำลังจัดให้ครับ ใช้เวลาไม่กี่วินาที คาบที่ปักหมุดไว้ไม่ถูกย้าย…' });
}
/** ครบ = ฉลอง + ปุ่มส่งออก · ไม่ครบ = ปลอบ + ชี้สาเหตุที่กินคาบมากสุด (แก้ข้อนี้ข้อเดียวมักลงเกือบหมด) */
function boonAfterSolve(miss, skipped) {
  if (!miss && !skipped) {
    mascot.set('celebrate', { msg: `เยี่ยมเลยครับ จัดครบทุกคาบ ${lastSolve.placed} คาบ ไม่มีคาบชน พร้อมพิมพ์แล้ว`, acts: [{ label: 'ส่งออก PDF / Excel', primary: true, go: { tab: 'export' } }] });
    return;
  }
  const by = new Map();
  for (const u of lastSolve.unplaced) by.set(u.reason, (by.get(u.reason) || 0) + (u.remaining || 0));
  const top = [...by].sort((x, y) => y[1] - x[1])[0];
  const fix = () => { root?.querySelector('.callout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const msg = top
    ? `เหลืออีก ${miss} คาบครับ ไม่ต้องห่วง ส่วนใหญ่ติดที่ “${top[0]}” (${top[1]} คาบ) แก้ข้อนี้ข้อเดียวน่าจะลงเกือบหมด`
    : `การสอน ${skipped} รายการยังไม่มีครูหรือห้องเรียน จึงยังไม่ถูกจัดครับ เติมให้ครบแล้วกดจัดเฉพาะที่ยังขาด`;
  mascot.set('comfort', { msg, acts: [{ label: 'ดูวิธีแก้', primary: true, run: fix }, { label: 'จัดเฉพาะที่ยังขาด', run: () => autoSolve('missing') }] });
}
// ผู้ช่วยถูกซ่อน/เปิด → กล่อง "เริ่มต้นใน 4 ขั้น" ต้องแสดง/หาย
document.addEventListener('tt:boon', () => { if (root && !root.hidden && store.doc && !store.doc.assignments.length) render(root); });

/** จัดไม่ครบ: กล่องสรุปสาเหตุหลัก 3 อันดับ + ปุ่มไปแก้ (รายละเอียดทั้งหมดค้างอยู่เหนือตาราง) · วิธีแก้ใช้ code/params ชุดเดียวกับรายงาน (FIXES) */
async function solveSummary(n, miss, skipped) {
  const groups = new Map(); // reason → { k คาบ, code, params ของรายการแรก }
  for (const u of lastSolve.unplaced) {
    const g = groups.get(u.reason) || { k: 0, code: u.code || null, params: u.params || null };
    g.k += u.remaining || 0;
    groups.set(u.reason, g);
  }
  const top = [...groups].sort((x, y) => y[1].k - x[1].k).slice(0, 3);
  const fixOf = ([reason, g]) => fixFor(reason, g.code, g.params);
  const firstGoto = top.length ? fixOf(top[0])[1] : skipped ? 'assignments' : null;
  const items = [
    ...(skipped ? [`<li>การสอน ${skipped} รายการยังไม่ได้เลือกห้องเรียนหรือครู</li>`] : []),
    ...top.map((x) => `<li><b>${esc(x[0])}</b> — ${x[1].k} คาบ<br><span class="muted">วิธีแก้: ${esc(fixOf(x)[0])}</span></li>`),
  ].join('');
  const title = lastSolve.mode === 'missing'
    ? `วางเพิ่มได้ ${lastSolve.added} คาบ · ยังขาด ${miss} คาบ`
    : n ? `จัดได้ ${n} คาบ · วางไม่ลง ${miss} คาบ` : `ยังวางคาบไม่ได้เลย (วางไม่ลง ${miss} คาบ)`;
  const pick = await notify.choose({
    title, icon: 'warning',
    html: `<p style="margin:0">สาเหตุหลัก${groups.size > 3 ? ` (จาก ${groups.size} สาเหตุ)` : ''}:</p><ul>${items}</ul><p class="muted" style="margin:8px 0 0">รายละเอียดทั้งหมดอยู่เหนือตาราง · คาบที่วางได้แล้วยังอยู่</p>`,
    ok: 'ดูรายละเอียด', deny: firstGoto ? `ไปแก้ที่ ข้อมูล → ${SEC_NAME[firstGoto]}` : undefined, cancel: 'ปิด',
  });
  if (pick === 'deny') gotoData(firstGoto);
  else if (pick === 'confirm') root?.querySelector('.callout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
