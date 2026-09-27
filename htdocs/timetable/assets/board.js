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
let lastSolve = null;        // { sec, full } ผลการจัดอัตโนมัติครั้งล่าสุด แสดงค้างในแถบเครื่องมือ
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
      ${lastSolve ? `<span class="pill" title="เวลาที่ใช้จัดอัตโนมัติครั้งล่าสุด">จัดล่าสุด ${lastSolve.sec} วินาที</span>` : ''}
      <span class="spacer"></span>
      <div class="progress" id="solve-progress" hidden><i></i></div>
      <button class="btn btn-sm" id="clear-auto" title="ลบคาบที่ไม่ได้ปักหมุดทั้งโรงเรียน">ล้างที่ไม่ปักหมุด</button>
      <button class="btn btn-primary btn-sm" id="auto-solve">${solving ? 'หยุดจัด' : 'จัดอัตโนมัติ'}</button>
    </div>
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

// ---------- จัดอัตโนมัติ (Web Worker) ----------
const secText = (ms) => (ms / 1000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function autoSolve() {
  if (solving) { solving.terminate(); solving = null; render(root); toast('หยุดการจัดอัตโนมัติ'); return; }
  const input = solverInput(true);
  if (!input.assignments.length) { toast('ยังไม่มีการสอนให้จัด เพิ่มที่แท็บข้อมูลก่อน'); return; }
  let worker;
  try { worker = new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' }); }
  catch (e) { toast('เบราว์เซอร์นี้ไม่รองรับการจัดอัตโนมัติ'); return; }
  solving = worker;
  render(root);
  const bar = root.querySelector('#solve-progress');
  bar.hidden = false;
  toast('กำลังจัดตาราง… ปักหมุดไว้จะไม่ถูกย้าย');
  const t0 = performance.now(); // นับตั้งแต่กดจนได้ผล (รวมเวลาเปิด worker) = เวลาที่ผู้ใช้รอจริง
  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'progress') { bar.firstElementChild.style.width = Math.round((msg.pct || 0) * 100) + '%'; return; }
    if (msg.type === 'done') {
      worker.terminate(); solving = null;
      const pinnedKey = new Set(store.doc.placements.filter((p) => p.pinned).map((p) => `${p.assignmentId}|${p.day}|${p.period}`));
      const sec = secText(performance.now() - t0);
      store.doc.placements = (msg.result.placements || []).map((p) => ({
        assignmentId: p.assignmentId, day: p.day, period: p.period, pinned: pinnedKey.has(`${p.assignmentId}|${p.day}|${p.period}`),
      }));
      const miss = (msg.result.unplaced || []).reduce((s, u) => s + (u.remaining || 0), 0);
      lastSolve = { sec, full: !miss };
      store.commit('solve');
      toast(miss ? `จัดเสร็จใน ${sec} วินาที · เหลือ ${miss} คาบที่วางไม่ลง ดูรายการในแต่ละห้อง` : `จัดครบทุกคาบแล้ว ใช้เวลา ${sec} วินาที`);
    }
    if (msg.type === 'error') { worker.terminate(); solving = null; render(root); toast('จัดอัตโนมัติไม่สำเร็จ: ' + (msg.message || '')); }
  };
  worker.onerror = (e) => { worker.terminate(); solving = null; render(root); toast('ตัวจัดตารางยังไม่พร้อม: ' + (e.message || 'ไม่ทราบสาเหตุ')); };
  worker.postMessage({ type: 'solve', input, options: { timeLimitMs: 6000, seed: Date.now() % 100000 } });
}
