// บอร์ดจัดตาราง: มุมมองห้อง/ครู/ห้องพิเศษ, ลากวาง (เมาส์+นิ้ว), ตรวจชนทันที, จัดอัตโนมัติ
import {
  store, idx, DAY_NAMES, remaining, isBreak, lockAt, teacherUnavailable, placementsAt, whyCannotPlace,
  localValidate, CONFLICT_TEXT, esc, assignmentLabel,
} from './store.js';
import { toast } from './ui.js';

let view = 'class';
let selected = { class: null, teacher: null, room: null };
let validator = null;       // validate() จาก solver.js ถ้ามี
let conflicts = [];
let solving = null;          // Worker ที่กำลังจัด
let lastSolve = null;        // { termId, sec, placed, unplaced[], warnings[], error } ผลการจัดครั้งล่าสุด แสดงค้างเหนือตาราง
let hideReport = false;      // ผู้ใช้กดปิดกล่องรายงานผลการจัด
let root = null;

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
      .map((a) => ({ id: a.id, classId: a.classId, teacherId: a.teacherId, roomId: a.roomId || null, perWeek: a.perWeek || 0, doubles: a.doubles || 0 })),
    locks: d.locks.map((l) => ({ classId: l.classId ?? null, day: l.day, period: l.period })),
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

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="มุมมอง">
        ${['class', 'teacher', 'room'].map((v) => `<button data-view="${v}" aria-pressed="${v === view}">${{ class: 'ห้องเรียน', teacher: 'ครู', room: 'ห้องพิเศษ' }[v]}</button>`).join('')}
      </div>
      <select id="ent-select" class="input input-sm" aria-label="เลือก${noun}">
        ${list.map((e) => `<option value="${esc(e.id)}" ${e.id === id ? 'selected' : ''}>${esc(e.name)}</option>`).join('') || `<option>ยังไม่มี${noun}</option>`}
      </select>
      <span class="pill ${hard ? 'warn' : 'ok'}" title="จำนวนจุดที่ชนทั้งโรงเรียน">${hard ? `ชน ${hard} จุด` : 'ไม่มีจุดชน'}</span>
      <span class="pill">เหลือจัด ${totalLeft} คาบ</span>
      ${lastSolve?.sec ? `<span class="pill" title="เวลาที่ใช้จัดอัตโนมัติครั้งล่าสุด">จัดล่าสุด ${lastSolve.sec} วินาที</span>` : ''}
      <span class="spacer"></span>
      <div class="progress" id="solve-progress" hidden><i></i></div>
      <button class="btn btn-sm" id="clear-auto" title="ลบคาบที่ไม่ได้ปักหมุดทั้งโรงเรียน">ล้างที่ไม่ปักหมุด</button>
      <button class="btn btn-primary btn-sm" id="auto-solve">${solving ? 'หยุดจัด' : 'จัดอัตโนมัติ'}</button>
    </div>
    ${guideHTML(totalLeft)}
    <div class="board">
      <aside class="card palette" id="palette">${paletteHTML(id)}</aside>
      <div>
        <div class="card grid-wrap">${gridHTML(id)}</div>
        ${issuesHTML()}
      </div>
    </div>`;

  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(el); }));
  el.querySelector('#ent-select')?.addEventListener('change', (e) => { selected[view] = e.target.value; render(el); });
  el.querySelector('#auto-solve').addEventListener('click', autoSolve);
  el.querySelector('#auto-solve-2')?.addEventListener('click', autoSolve);
  el.querySelector('#solve-report-close')?.addEventListener('click', () => { hideReport = true; render(el); });
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => gotoData(b.dataset.goto)));
  el.querySelector('#clear-auto').addEventListener('click', () => {
    const before = d.placements.length;
    d.placements = d.placements.filter((p) => p.pinned);
    store.commit('clear');
    toast(`ลบ ${before - d.placements.length} คาบที่ไม่ได้ปักหมุด`);
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
  const days = [...Array(d.term.days).keys()];
  let h = `<table class="tt"><thead><tr><th>คาบ</th>${days.map((i) => `<th>${DAY_NAMES[i]}</th>`).join('')}</tr></thead><tbody>`;
  d.term.periods.forEach((p, pi) => {
    const tm = p.start && p.end ? `${esc(p.start)}–${esc(p.end)}` : '';
    if (p.type === 'break') {
      h += `<tr class="brk"><th><span class="lbl">${esc(p.label || 'พัก')}</span><span class="tm">${tm}</span></th><td colspan="${days.length}">${esc(p.label || 'พัก')}</td></tr>`;
      return;
    }
    h += `<tr><th><span class="lbl">คาบ ${esc(p.label || pi + 1)}</span><span class="tm">${tm}</span></th>`;
    for (const day of days) {
      const lk = view === 'class' && id ? lockAt(id, day, pi) : null;
      const cells = id ? placementsAt(view, id, day, pi) : [];
      const unav = view === 'teacher' && id && teacherUnavailable(id, day, pi);
      if (lk && !cells.length) { h += `<td class="lock" data-day="${day}" data-period="${pi}">🔒 ${esc(lk.label || 'คาบล็อก')}</td>`; continue; }
      h += `<td class="${unav ? 'unavail' : ''}" data-day="${day}" data-period="${pi}">`;
      for (const pl of cells) {
        const a = idx.asg.get(pl.assignmentId), L = assignmentLabel(a);
        const bad = cellConflict([pl], day, pi);
        const sub = view === 'class' ? (L.tch?.short || L.tch?.name || '') : view === 'teacher' ? (L.cls?.name || '') : `${L.cls?.name || ''} · ${L.tch?.short || ''}`;
        const tip = bad.length ? bad.map((c) => CONFLICT_TEXT[c.type] || c.type).join(', ') : `${L.code} ${L.name}`;
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
    else if (a) toast('วิชานี้จัดครบแล้ว');
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
    if (why && !e.shiftKey) { toast(`วางไม่ได้: ${why} (กด Shift ค้างเพื่อวางทับ)`); return; }
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

/** ตรวจความจุแบบเร็ว (ชุดเดียวกับที่ solver ใช้ตัดสินว่าจัดไม่ครบแน่นอน) → รายการปัญหาพร้อมวิธีแก้ */
export function readiness() {
  const d = store.doc, days = d.term.days, P = d.term.periods.length;
  const out = [];
  const skipped = d.assignments.filter((a) => !idx.cls.has(a.classId) || !idx.tch.has(a.teacherId));
  if (skipped.length) out.push({ text: `การสอน ${skipped.length} รายการยังไม่ได้เลือกห้องเรียนหรือครู จึงไม่ถูกนำไปจัด`, fix: 'เลือกห้องเรียนและครูให้ครบ', goto: 'assignments' });
  const zero = d.assignments.filter((a) => !(a.perWeek > 0)).length;
  if (zero) out.push({ text: `การสอน ${zero} รายการตั้งคาบ/สัปดาห์เป็น 0`, fix: 'ใส่จำนวนคาบต่อสัปดาห์', goto: 'assignments' });
  const globalLock = (day, p) => d.locks.some((l) => l.classId == null && l.day === day && l.period === p);
  for (const c of d.classes) {
    const need = d.assignments.filter((a) => a.classId === c.id && idx.tch.has(a.teacherId)).reduce((s, a) => s + (a.perWeek || 0), 0);
    let free = 0;
    for (let day = 0; day < days; day++) for (let p = 0; p < P; p++) if (!isBreak(p) && !lockAt(c.id, day, p)) free++;
    if (need > free) out.push({ text: `${c.name} ต้องเรียนรวม ${need} คาบ/สัปดาห์ แต่มีช่องว่างเพียง ${free} คาบ`, fix: `ลดคาบ/สัปดาห์ของ ${c.name} ลง ${need - free} คาบ หรือเพิ่มคาบต่อวัน/ลดคาบล็อกในแท็บโครงคาบ`, goto: 'assignments' });
  }
  for (const t of d.teachers) {
    const need = d.assignments.filter((a) => a.teacherId === t.id && idx.cls.has(a.classId)).reduce((s, a) => s + (a.perWeek || 0), 0);
    if (!need) continue;
    let cap = 0;
    for (let day = 0; day < days; day++) {
      let n = 0;
      for (let p = 0; p < P; p++) if (!isBreak(p) && !globalLock(day, p) && !teacherUnavailable(t.id, day, p)) n++;
      cap += t.maxPerDay ? Math.min(n, t.maxPerDay) : n;
    }
    if (need > cap) {
      const unav = (t.unavailable || []).length;
      out.push({ text: `${t.name} ต้องสอน ${need} คาบ/สัปดาห์ แต่สอนได้สูงสุด ${cap} คาบ (สูงสุด ${t.maxPerDay || 'ไม่จำกัด'} คาบ/วัน${unav ? `, ไม่ว่าง ${unav} ช่อง` : ''})`,
        fix: `เพิ่ม “สูงสุด/วัน” ของครู${unav ? ' ลดช่องไม่ว่าง (สีแดง)' : ''} หรือย้ายบางวิชาไปให้ครูคนอื่น`, goto: 'teachers' });
    }
  }
  return out;
}

/** วิธีแก้ตามเหตุผลที่ solver ส่งมา (ข้อความจาก explainUnit/เหตุผลอื่นใน solver.js) */
function fixFor(reason) {
  const r = String(reason || '');
  if (/ต้องเรียนรวม/.test(r)) return ['ลดคาบ/สัปดาห์ของห้องนี้ หรือเพิ่มคาบต่อวัน/ลดคาบล็อก (แท็บโครงคาบ)', 'assignments'];
  if (/สอนได้สูงสุด|สอนได้วันละ/.test(r)) return ['เพิ่ม “สูงสุด/วัน” ของครู ลดช่องไม่ว่าง หรือย้ายบางวิชาไปให้ครูคนอื่น', 'teachers'];
  if (/คาบคู่/.test(r)) return ['ลดจำนวนคาบคู่ของวิชานี้ (แท็บข้อมูล → การสอน) หรือเลิกปักหมุดคาบคู่ที่ค้างครึ่งเดียว', 'assignments'];
  if (/ไม่มีคาบที่ครูว่าง/.test(r)) return ['ตรวจช่อง “คาบไม่ว่าง” ของครู (ช่องสีแดง = ครูไม่ว่าง ไม่ใช่คาบที่สอน) และคาบล็อกที่ปิดทุกช่อง', 'teachers'];
  if (/ห้องพิเศษ|ถูกใช้/.test(r)) return ['เพิ่มห้องพิเศษอีกห้อง หรือเลิกผูกห้องพิเศษกับบางวิชา', 'rooms'];
  if (/ไม่พบห้องเรียน/.test(r)) return ['เลือกห้องเรียนของการสอนนี้ใหม่', 'assignments'];
  return ['กด “จัดอัตโนมัติ” อีกครั้ง (ระบบสุ่มลำดับใหม่ทุกครั้ง) หรือเลิกปักหมุดบางคาบ แล้วลากวางส่วนที่เหลือเอง', null];
}

const SEC_NAME = { assignments: 'การสอน', teachers: 'ครู', rooms: 'ห้องพิเศษ', classes: 'ห้องเรียน' };
const gotoBtn = (k) => (k ? ` <button class="btn btn-sm" data-goto="${k}">ไปแก้ที่ ข้อมูล → ${SEC_NAME[k]}</button>` : '');

function gotoData(sec) {
  document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'data', section: sec } }));
}

function guideHTML(totalLeft) {
  const d = store.doc;
  if (lastSolve && lastSolve.termId === store.termId && !hideReport) return solveReportHTML();
  if (!d.assignments.length) {
    return `<div class="card callout"><b>เริ่มต้นใน 4 ขั้น</b><ol>
      <li>แท็บ <b>ข้อมูล</b> → เพิ่มห้องเรียน และครู</li><li>ข้อมูล → <b>การสอน</b>: จับคู่ วิชา × ห้อง × ครู และจำนวนคาบ/สัปดาห์</li>
      <li>แท็บ <b>โครงคาบ · คาบล็อก</b>: ตั้งเวลาเรียน และล็อกคาบกิจกรรม (ถ้ามี)</li><li>กลับมาหน้านี้แล้วกด <b>จัดอัตโนมัติ</b></li></ol>
      <p class="muted" style="margin:6px 0 0">มีภาคเรียนก่อนหน้าแล้ว? เลือก “＋ สร้างภาคเรียนใหม่…” ที่หัวจอ แล้วเลือกแบบ “สำเนาจาก…” ครู วิชา และการสอนจะตามมาครบ ไม่ต้องกรอกใหม่</p></div>`;
  }
  const issues = readiness();
  if (!totalLeft && !issues.length) return '';
  const list = issues.length ? `<ul>${issues.map((x) => `<li>${esc(x.text)}<br><span class="fix">วิธีแก้: ${esc(x.fix)}</span>${gotoBtn(x.goto)}</li>`).join('')}</ul>` : '';
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

function solveReportHTML() {
  const s = lastSolve;
  const close = '<button class="btn btn-sm" id="solve-report-close" aria-label="ปิดรายงาน">ปิด</button>';
  if (s.error) return `<div class="card callout warn"><div class="callout-head"><b>จัดอัตโนมัติไม่สำเร็จ</b>${close}</div><p style="margin:4px 0 0">${esc(s.error)}</p></div>`;
  const miss = s.unplaced.reduce((n, u) => n + (u.remaining || 0), 0);
  const skipped = s.skipped ? `<li>การสอน ${s.skipped} รายการยังไม่ได้เลือกห้องเรียนหรือครู จึงไม่ถูกนำไปจัด${gotoBtn('assignments')}</li>` : '';
  if (!miss && !s.skipped) {
    return `<div class="card callout go"><div class="callout-head"><b>จัดครบทุกคาบแล้ว ${s.placed} คาบ ไม่มีคาบชน</b>${close}</div>
      <p style="margin:4px 0 0">ใช้เวลา ${s.sec} วินาที · ลากคาบเพื่อปรับได้ (คาบที่ลากเองจะปักหมุด) · พร้อมพิมพ์ที่แท็บ <b>ส่งออก</b></p></div>`;
  }
  // รวมตามเหตุผล: เหตุผลเดียวกันแสดงครั้งเดียว พร้อมรายชื่อห้อง/วิชาที่เกี่ยวข้อง
  const groups = new Map();
  for (const u of s.unplaced) {
    const a = idx.asg.get(u.assignmentId);
    const L = a ? assignmentLabel(a) : null;
    const g = groups.get(u.reason) || { n: 0, items: [] };
    g.n += u.remaining || 0;
    g.items.push(L ? `${L.cls?.name || ''} ${L.name} (${u.remaining})` : `${u.assignmentId} (${u.remaining})`);
    groups.set(u.reason, g);
  }
  const rows = [...groups].sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([reason, g]) => {
    const [fix, goto] = fixFor(reason);
    const names = g.items.slice(0, 6).join(', ') + (g.items.length > 6 ? ` และอีก ${g.items.length - 6} รายการ` : '');
    return `<li><b>${esc(reason)}</b> — ${g.n} คาบ<br><span class="muted">${esc(names)}</span><br><span class="fix">วิธีแก้: ${esc(fix)}</span>${gotoBtn(goto)}</li>`;
  }).join('');
  const head = s.placed ? `จัดได้ ${s.placed} คาบ · วางไม่ลง ${miss} คาบ` : `ยังวางคาบไม่ได้เลย (วางไม่ลง ${miss} คาบ)`;
  return `<div class="card callout warn"><div class="callout-head"><b>${head}</b>${close}</div>
    <p style="margin:4px 0 0">สาเหตุและวิธีแก้ด้านล่าง แก้แล้วกด <b>จัดอัตโนมัติ</b> อีกครั้ง — คาบที่วางได้แล้วยังอยู่ ลากวางส่วนที่เหลือเองก็ได้</p>
    <ul>${skipped}${rows}</ul>${groups.size > 8 ? `<p class="muted" style="margin:0">และอีก ${groups.size - 8} สาเหตุ</p>` : ''}</div>`;
}

// ---------- จัดอัตโนมัติ (Web Worker) ----------
const secText = (ms) => (ms / 1000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SOLVE_OPTS = () => ({ timeLimitMs: 6000, seed: Date.now() % 100000 });

/** URL ของ worker พร้อมเลขเวอร์ชัน (import map ใช้กับ new Worker ไม่ได้ ต้อง resolve เอง) + ส่งเวอร์ชันของ solver.js ให้ worker import ไฟล์ใหม่ */
function workerURL() {
  let w = null, sv = null;
  try { w = import.meta.resolve('./solver/solver.worker.js'); sv = new URL(import.meta.resolve('./solver/solver.js')).searchParams.get('v'); } catch { /* เบราว์เซอร์เก่า */ }
  const u = new URL(w || './solver/solver.worker.js', import.meta.url);
  if (sv && /^\d+$/.test(sv)) u.searchParams.set('sv', sv);
  return u;
}

function autoSolve() {
  if (solving) { solving.terminate(); solving = null; render(root); toast('หยุดการจัดอัตโนมัติ'); return; }
  const input = solverInput(true);
  const skipped = store.doc.assignments.length - input.assignments.length;
  hideReport = false;
  if (!input.assignments.length) {
    lastSolve = { termId: store.termId, error: store.doc.assignments.length
      ? 'การสอนทุกรายการยังไม่ได้เลือกห้องเรียนหรือครู ไปที่แท็บข้อมูล → การสอน แล้วเลือกให้ครบ'
      : 'ยังไม่มีการสอนให้จัด ไปที่แท็บข้อมูล → การสอน เพื่อจับคู่วิชา ห้อง และครูก่อน' };
    render(root); toast(lastSolve.error, 6000); return;
  }
  const t0 = performance.now(); // นับตั้งแต่กดจนได้ผล (รวมเวลาเปิด worker) = เวลาที่ผู้ใช้รอจริง
  const opts = SOLVE_OPTS();
  let worker = null;
  try { worker = new Worker(workerURL(), { type: 'module' }); } catch (e) { console.warn('เปิด worker ไม่ได้', e); }
  if (!worker) { solveInPage(input, opts, t0, skipped); return; }
  solving = worker;
  render(root);
  const bar = root.querySelector('#solve-progress');
  bar.hidden = false;
  toast('กำลังจัดตาราง… ปักหมุดไว้จะไม่ถูกย้าย');
  let heard = false;
  const stop = () => { clearTimeout(silent); clearTimeout(hard); worker.terminate(); if (solving === worker) solving = null; };
  // เบราว์เซอร์ที่ไม่รองรับ module worker บางตัวไม่ error แต่เงียบไปเลย → 8 วิไม่มีข่าว = จัดในหน้าแทน
  const silent = setTimeout(() => { if (!heard) { stop(); solveInPage(input, opts, t0, skipped); } }, 8000);
  const hard = setTimeout(() => { stop(); failSolve('ตัวจัดตารางไม่ตอบกลับภายในเวลาที่กำหนด กรุณาลองกดอีกครั้ง หรือรีเฟรชหน้า'); }, opts.timeLimitMs + 20000);
  worker.onmessage = (ev) => {
    heard = true;
    const msg = ev.data || {};
    if (msg.type === 'progress') { bar.firstElementChild.style.width = Math.round((msg.pct || 0) * 100) + '%'; return; }
    if (msg.type === 'done') { stop(); applyResult(msg.result, t0, skipped); }
    if (msg.type === 'error') { stop(); failSolve('ตัวจัดตารางทำงานผิดพลาด: ' + (msg.message || 'ไม่ทราบสาเหตุ') + ' — กรุณาส่งไฟล์สำรอง (แท็บส่งออก) ให้ผู้ดูแลตรวจสอบ'); }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    console.warn('solver worker error', e.message);
    stop();
    // โหลด worker ไม่ได้ (เบราว์เซอร์เก่า/แอปในไลน์) → จัดในหน้าแทน ผู้ใช้ยังได้ผลเหมือนเดิม แค่หน้าค้างไม่กี่วินาที
    if (!heard) solveInPage(input, opts, t0, skipped);
    else failSolve('ตัวจัดตารางหยุดทำงานกลางคัน: ' + (e.message || 'ไม่ทราบสาเหตุ'));
  };
  worker.postMessage({ type: 'solve', input, options: opts });
}

/** สำรอง: จัดใน main thread (ช้ากว่าเล็กน้อยและหน้าค้างระหว่างจัด) ใช้เมื่อเบราว์เซอร์เปิด module worker ไม่ได้ */
async function solveInPage(input, opts, t0, skipped) {
  solving = null;
  toast('เบราว์เซอร์นี้จัดเบื้องหลังไม่ได้ กำลังจัดในหน้า หน้าจออาจค้างสักครู่…', 6000);
  try {
    const m = await import('./solver/solver.js');
    await new Promise((r) => setTimeout(r, 50)); // ให้ toast แสดงก่อนหน้าค้าง
    applyResult(m.solve(input, { ...opts, timeLimitMs: 4000 }), t0, skipped);
  } catch (e) {
    console.error(e);
    failSolve('เบราว์เซอร์นี้เปิดตัวจัดตารางไม่ได้ (' + (e.message || e) + ') ลองเปิดด้วย Chrome หรือ Safari รุ่นใหม่ ถ้าเปิดจากแอป LINE ให้กด “เปิดในเบราว์เซอร์”');
  }
}

function failSolve(message) {
  solving = null;
  lastSolve = { termId: store.termId, error: message };
  hideReport = false;
  if (root) render(root);
  toast('จัดอัตโนมัติไม่สำเร็จ ดูรายละเอียดเหนือตาราง', 6000);
}

function applyResult(result, t0, skipped) {
  solving = null;
  const pinnedKey = new Set(store.doc.placements.filter((p) => p.pinned).map((p) => `${p.assignmentId}|${p.day}|${p.period}`));
  const sec = secText(performance.now() - t0);
  store.doc.placements = (result.placements || []).map((p) => ({
    assignmentId: p.assignmentId, day: p.day, period: p.period, pinned: pinnedKey.has(`${p.assignmentId}|${p.day}|${p.period}`),
  }));
  const unplaced = result.unplaced || [];
  const miss = unplaced.reduce((s, u) => s + (u.remaining || 0), 0);
  lastSolve = { termId: store.termId, sec, placed: store.doc.placements.length, unplaced, warnings: result.stats?.warnings || [], skipped };
  hideReport = false;
  store.commit('solve');
  const n = store.doc.placements.length;
  toast(!miss ? `จัดครบทุกคาบแล้ว ใช้เวลา ${sec} วินาที`
    : `${n ? `จัดได้ ${n} คาบ · ` : 'ยังวางไม่ได้เลย · '}วางไม่ลง ${miss} คาบ — ดูสาเหตุและวิธีแก้เหนือตาราง`, miss ? 7000 : 3200);
}
