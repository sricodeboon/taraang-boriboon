// แท็บข้อมูล: ห้องเรียน ครู วิชา ห้องพิเศษ การสอน (ตารางแก้ไขในที่)
import { store, idx, uid, DAY_NAMES, SUBJECT_COLORS, classPeriods, esc, remaining } from './store.js';
import * as school from './school.js';
import { openCatalog } from './curriculum.js';

let section = 'assignments';
let filterClass = null; // null = ยังไม่ได้เลือก → โรงเรียนใหญ่เริ่มที่ห้องแรก (ทุกห้องพร้อมกันหน่วงบนมือถือ)
let root = null;

const SECTIONS = [
  ['classes', 'ห้องเรียน'], ['teachers', 'ครู'], ['subjects', 'วิชา'], ['rooms', 'ห้องพิเศษ'], ['assignments', 'การสอน'], ['school', 'โรงเรียน'],
];

/** เปิดหมวดข้อมูลที่ต้องการ (จากปุ่ม "ไปแก้ที่…" ในรายงานผลการจัด) */
export function setSection(k) { if (SECTIONS.some(([x]) => x === k)) section = k; }

export function render(el) {
  root = el;
  const d = store.doc;
  const counts = { classes: d.classes.length, teachers: d.teachers.length, subjects: d.subjects.length, rooms: d.rooms.length, assignments: d.assignments.length };
  el.innerHTML = `<div class="data-nav" role="group" aria-label="ประเภทข้อมูล">
      ${SECTIONS.map(([k, n]) => `<button data-sec="${k}" aria-pressed="${k === section}">${n}${k in counts ? ` <span class="muted">${counts[k]}</span>` : ''}</button>`).join('')}
    </div>
    <div class="card data-card" id="data-body"></div>`;
  el.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec; render(el); }));
  const body = el.querySelector('#data-body');
  ({ classes: classesView, teachers: teachersView, subjects: subjectsView, rooms: roomsView, assignments: assignmentsView, school: school.render })[section](body);
}

// ---------- ตัวช่วย ----------
const opt = (list, cur, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

function head(title, desc, addLabel, extra = '') {
  return `<div class="data-head"><div><h3 style="font-size:1.05rem">${title}</h3><p>${desc}</p></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${extra}<button class="btn btn-sm btn-primary" data-add>${addLabel}</button></div></div>`;
}

/** ผูกช่องกรอก: data-f = ชื่อฟิลด์, data-i = index ใน list */
function bindInputs(el, list, { numeric = [], after } = {}) {
  el.querySelectorAll('[data-f]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const row = list[+inp.dataset.i];
      if (!row) return;
      const f = inp.dataset.f;
      let v = inp.value;
      if (numeric.includes(f)) v = Math.max(0, parseInt(v, 10) || 0);
      if (inp.dataset.nullable !== undefined && v === '') v = null;
      row[f] = v;
      after?.(row, f);
      store.commit('data');
    });
  });
}

function bindDelete(el, list, onDelete) {
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const row = list[+b.dataset.del];
    if (!row) return;
    const used = onDelete ? onDelete(row, true) : 0;
    if (used && !confirm(`รายการนี้ถูกใช้อยู่ ${used} รายการ ลบแล้วการสอนและคาบในตารางที่เกี่ยวข้องจะถูกลบด้วย ยืนยันไหม`)) return;
    list.splice(list.indexOf(row), 1);
    onDelete?.(row, false);
    store.commit('data');
    render(root);
  }));
}

/** ลบการสอนที่อ้างถึง id นี้ พร้อมคาบในตาราง */
function cascade(field, id, dryRun) {
  const d = store.doc;
  const dead = d.assignments.filter((a) => a[field] === id);
  if (dryRun) return dead.length;
  const ids = new Set(dead.map((a) => a.id));
  d.assignments = d.assignments.filter((a) => !ids.has(a.id));
  d.placements = d.placements.filter((p) => !ids.has(p.assignmentId));
  return dead.length;
}

// ---------- ห้องเรียน ----------
function classesView(el) {
  const list = store.doc.classes;
  const cap = classPeriods() * store.doc.term.days;
  el.innerHTML = head('ห้องเรียน', `เช่น ม.1/1 ป.6/2 · แต่ละห้องมีคาบเรียนได้ ${cap} คาบต่อสัปดาห์ (ไม่รวมคาบล็อก)`, '+ เพิ่มห้องเรียน') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อห้อง</th><th>ระดับชั้น</th><th>คาบที่มอบหมาย</th><th></th></tr></thead><tbody>
    ${list.map((c, i) => {
      const load = store.doc.assignments.filter((a) => a.classId === c.id).reduce((s, a) => s + (a.perWeek || 0), 0);
      const locks = store.doc.locks.filter((l) => l.classId == null || l.classId === c.id).length;
      const free = cap - locks;
      return `<tr><td><input class="input" data-i="${i}" data-f="name" value="${esc(c.name)}"></td>
        <td><input class="input" data-i="${i}" data-f="level" value="${esc(c.level || '')}" placeholder="เช่น ม.1"></td>
        <td><span class="pill ${load > free ? 'warn' : ''}">${load} / ${free} คาบ</span></td>
        <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">ยังไม่มีห้องเรียน</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    const last = list[list.length - 1];
    let name = 'ห้องใหม่';
    const m = last?.name.match(/^(.*\/)(\d+)$/);
    if (m) name = m[1] + (+m[2] + 1);
    list.push({ id: uid('c'), name, level: last?.level || '' });
    store.commit('data'); render(root);
  });
  bindInputs(el, list);
  bindDelete(el, list, (row, dry) => {
    const n = cascade('classId', row.id, dry);
    if (!dry) store.doc.locks = store.doc.locks.filter((l) => l.classId !== row.id);
    return n;
  });
}

// ---------- ครู ----------
function teachersView(el) {
  const d = store.doc, list = d.teachers;
  el.innerHTML = head('ครู', 'ตั้งจำนวนคาบสูงสุดต่อวัน และคลิกช่องในตารางเล็กเพื่อระบุคาบที่ไม่ว่าง (สีแดง)', '+ เพิ่มครู') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อครู</th><th>ชื่อย่อ</th><th>สูงสุด/วัน</th><th>คาบไม่ว่าง</th><th>ภาระสอน</th><th></th></tr></thead><tbody>
    ${list.map((t, i) => {
      const load = d.assignments.filter((a) => a.teacherId === t.id).reduce((s, a) => s + (a.perWeek || 0), 0);
      return `<tr><td><input class="input" data-i="${i}" data-f="name" value="${esc(t.name)}"></td>
        <td style="width:110px"><input class="input" data-i="${i}" data-f="short" value="${esc(t.short || '')}"></td>
        <td class="num"><input class="input" type="number" min="0" max="20" data-i="${i}" data-f="maxPerDay" value="${t.maxPerDay || 0}" title="0 = ไม่จำกัด"></td>
        <td>${miniGrid(t, i)}</td>
        <td><span class="pill">${load} คาบ/สัปดาห์</span></td>
        <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">ยังไม่มีครู</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    list.push({ id: uid('t'), name: 'ครูคนใหม่', short: '', maxPerDay: 6, unavailable: [] });
    store.commit('data'); render(root);
  });
  bindInputs(el, list, { numeric: ['maxPerDay'] });
  bindDelete(el, list, (row, dry) => cascade('teacherId', row.id, dry));
  el.querySelectorAll('.mini-grid button[data-t]').forEach((b) => b.addEventListener('click', () => {
    const t = list[+b.dataset.t], day = +b.dataset.d, p = +b.dataset.p;
    t.unavailable = t.unavailable || [];
    const k = t.unavailable.findIndex(([x, y]) => x === day && y === p);
    if (k >= 0) t.unavailable.splice(k, 1); else t.unavailable.push([day, p]);
    b.classList.toggle('on');
    store.commit('data');
  }));
}

function miniGrid(t, ti) {
  const d = store.doc;
  const un = new Set((t.unavailable || []).map(([x, y]) => x + ':' + y));
  const cols = d.term.days;
  let h = `<div class="mini-grid" style="grid-template-columns:repeat(${cols},22px)" title="แถว = คาบ, คอลัมน์ = วัน (${DAY_NAMES.slice(0, cols).map((x) => x[0]).join(' ')})">`;
  d.term.periods.forEach((p, pi) => {
    for (let day = 0; day < cols; day++) {
      h += p.type === 'break' ? `<button class="brk" tabindex="-1" aria-hidden="true"></button>`
        : `<button type="button" data-t="${ti}" data-d="${day}" data-p="${pi}" class="${un.has(day + ':' + pi) ? 'on' : ''}" aria-label="${DAY_NAMES[day]} คาบ ${esc(p.label)}"></button>`;
    }
  });
  return h + '</div>';
}

// ---------- วิชา ----------
function subjectsView(el) {
  const list = store.doc.subjects;
  el.innerHTML = head('วิชา', 'รหัสวิชาและชื่อวิชา สีใช้แยกวิชาในตาราง', '+ เพิ่มวิชา', '<button class="btn btn-sm" data-catalog>เพิ่มจากหลักสูตรแกนกลาง…</button>') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>สี</th><th>รหัส</th><th>ชื่อวิชา</th><th>ใช้ในการสอน</th><th></th></tr></thead><tbody>
    ${list.map((s, i) => `<tr><td style="width:60px"><input type="color" class="swatch" data-i="${i}" data-f="color" value="${esc(s.color || '#7FB0E8')}"></td>
      <td style="width:140px"><input class="input mono" data-i="${i}" data-f="code" value="${esc(s.code || '')}" placeholder="ท21101"></td>
      <td><input class="input" data-i="${i}" data-f="name" value="${esc(s.name)}"></td>
      <td><span class="pill">${store.doc.assignments.filter((a) => a.subjectId === s.id).length} ห้อง</span></td>
      <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">ยังไม่มีวิชา</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    list.push({ id: uid('s'), code: '', name: 'วิชาใหม่', color: SUBJECT_COLORS[list.length % SUBJECT_COLORS.length] });
    store.commit('data'); render(root);
  });
  el.querySelector('[data-catalog]').addEventListener('click', () => openCatalog());
  bindInputs(el, list);
  bindDelete(el, list, (row, dry) => cascade('subjectId', row.id, dry));
}

// ---------- ห้องพิเศษ ----------
function roomsView(el) {
  const list = store.doc.rooms;
  el.innerHTML = head('ห้องพิเศษ', 'ห้องที่ใช้ร่วมกันหลายห้องเรียน เช่น ห้องคอม ห้องวิทย์ สนาม ระบบจะกันไม่ให้ใช้ซ้อนคาบ', '+ เพิ่มห้องพิเศษ') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อห้อง</th><th>ประเภท</th><th>ใช้ในการสอน</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr><td><input class="input" data-i="${i}" data-f="name" value="${esc(r.name)}"></td>
      <td><input class="input" data-i="${i}" data-f="kind" value="${esc(r.kind || '')}" placeholder="เช่น ห้องปฏิบัติการ"></td>
      <td><span class="pill">${store.doc.assignments.filter((a) => a.roomId === r.id).length} รายการ</span></td>
      <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">ยังไม่มีห้องพิเศษ (ไม่จำเป็นต้องมี)</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => { list.push({ id: uid('r'), name: 'ห้องใหม่', kind: '' }); store.commit('data'); render(root); });
  bindInputs(el, list);
  bindDelete(el, list, (row, dry) => {
    if (dry) return 0;
    for (const a of store.doc.assignments) if (a.roomId === row.id) a.roomId = null;
    return 0;
  });
}

// ---------- การสอน ----------
function assignmentsView(el) {
  const d = store.doc;
  const all = d.assignments;
  if (filterClass && !d.classes.some((c) => c.id === filterClass)) filterClass = null;
  if (filterClass === null) filterClass = d.classes.length > 4 ? d.classes[0].id : '';
  const list = filterClass ? all.filter((a) => a.classId === filterClass) : all;
  const ready = d.classes.length && d.teachers.length && d.subjects.length;
  el.innerHTML = head('การสอน', 'จับคู่ วิชา × ห้องเรียน × ครู และจำนวนคาบต่อสัปดาห์ รายการนี้คือสิ่งที่ระบบนำไปจัดลงตาราง', '+ เพิ่มการสอน') +
    `<div class="toolbar" style="padding:10px 14px;margin:0;border-bottom:1px solid var(--line)">
      <label class="muted" for="flt">ดูเฉพาะห้อง</label>
      <select id="flt" class="input input-sm">${opt(d.classes, filterClass, 'ทุกห้อง')}</select>
      ${ready ? '' : '<span class="pill warn">ต้องมีห้องเรียน ครู และวิชาก่อน</span>'}
    </div>
    <div class="scroll-x"><table class="table"><thead><tr><th>ห้อง</th><th>วิชา</th><th>ครู</th><th>ห้องพิเศษ</th><th>คาบ/สัปดาห์</th><th>คาบคู่</th><th>จัดแล้ว</th><th></th></tr></thead><tbody>
    ${list.map((a) => {
      const i = all.indexOf(a);
      return `<tr>
        <td><select class="input" data-i="${i}" data-f="classId">${opt(d.classes, a.classId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="subjectId">${opt(d.subjects, a.subjectId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="teacherId">${opt(d.teachers, a.teacherId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="roomId" data-nullable>${opt(d.rooms, a.roomId, '— ไม่ใช้ —')}</select></td>
        <td class="num"><input class="input" type="number" min="1" max="20" data-i="${i}" data-f="perWeek" value="${a.perWeek || 1}"></td>
        <td class="num"><input class="input" type="number" min="0" max="10" data-i="${i}" data-f="doubles" value="${a.doubles || 0}" title="จำนวนคู่คาบติดกันต่อสัปดาห์"></td>
        <td><span class="pill ${remaining(a) ? '' : 'ok'}">${(a.perWeek || 0) - remaining(a)}/${a.perWeek || 0}</span></td>
        <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">ยังไม่มีการสอน</td></tr>'}</tbody></table></div>
    ${summary()}`;
  el.querySelector('#flt').addEventListener('change', (e) => { filterClass = e.target.value; render(root); });
  el.querySelector('[data-go-board]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'board' } })));
  el.querySelector('[data-add]').addEventListener('click', () => {
    if (!ready) { alert('เพิ่มห้องเรียน ครู และวิชาอย่างน้อยอย่างละ 1 รายการก่อน'); return; }
    all.push({ id: uid('a'), ...guessNew(filterClass || d.classes[0].id), roomId: null, perWeek: 2, doubles: 0 });
    store.commit('data'); render(root);
  });
  bindInputs(el, all, { numeric: ['perWeek', 'doubles'], after: (row, f) => {
    if (f === 'doubles' && row.doubles * 2 > row.perWeek) row.doubles = Math.floor(row.perWeek / 2);
    if (f === 'classId' || f === 'teacherId') store.doc.placements = store.doc.placements.filter((p) => p.assignmentId !== row.id);
  } });
  bindDelete(el, all, (row, dry) => {
    const n = store.doc.placements.filter((p) => p.assignmentId === row.id).length;
    if (!dry) store.doc.placements = store.doc.placements.filter((p) => p.assignmentId !== row.id);
    return dry ? 0 : n;
  });
}

/**
 * ค่าเริ่มต้นของการสอนใหม่: วิชาถัดไปของชั้นนี้ที่ยังไม่ได้มอบหมาย + ครูที่สอนห้องนี้มากที่สุด (ครูประจำชั้น)
 * เดิมเริ่มที่วิชาแรกของทั้งรายการ + ครูคนแรกเสมอ → ต้องเปลี่ยน 2 ช่องทุกแถว และถ้าลืมเปลี่ยน ครูคนแรกภาระล้นจนจัดไม่ครบ
 */
function guessNew(classId) {
  const d = store.doc;
  const cls = d.classes.find((c) => c.id === classId);
  const mine = d.assignments.filter((a) => a.classId === classId);
  const used = new Set(mine.map((a) => a.subjectId));
  const level = (cls?.level || cls?.name || '').trim().split('/')[0];
  const free = d.subjects.filter((s) => !used.has(s.id));
  const sameLevel = level ? free.filter((s) => (s.name || '').trim().endsWith(' ' + level)) : [];
  const subject = sameLevel[0] || free[0] || d.subjects[0];
  const count = new Map();
  for (const a of mine) count.set(a.teacherId, (count.get(a.teacherId) || 0) + 1);
  const top = [...count].sort((x, y) => y[1] - x[1])[0]?.[0];
  return { classId, subjectId: subject.id, teacherId: idx.tch.has(top) ? top : d.teachers[0].id };
}

function summary() {
  const d = store.doc;
  const total = d.assignments.reduce((s, a) => s + (a.perWeek || 0), 0);
  const placed = d.placements.length;
  // ผู้ใช้กรอกการสอนครบแล้วมักไม่รู้ว่าต้องไปกด "จัดอัตโนมัติ" ที่แท็บจัดตาราง → มีปุ่มพาไปตรงนี้
  const next = d.assignments.length && placed < total
    ? `<button class="btn btn-primary btn-sm" data-go-board style="margin-left:auto">ขั้นต่อไป: ไปจัดตาราง →</button>` : '';
  return `<div class="sum-bar"><span>การสอนทั้งหมด <b>${d.assignments.length}</b> รายการ</span><span>รวม <b>${total}</b> คาบ/สัปดาห์</span><span>จัดลงตารางแล้ว <b>${placed}</b> คาบ</span>${next}</div>`;
}
