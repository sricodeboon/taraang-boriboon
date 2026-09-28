// แท็บข้อมูล: ห้องเรียน ครู วิชา ห้องพิเศษ การสอน (ตารางแก้ไขในที่)
import { store, idx, uid, DAY_NAMES, SUBJECT_COLORS, classPeriods, esc, remaining } from './store.js';
import {
  orientation, periodText, hoursHint, subjectChoices, usedSubjects, duplicateGroups, splitAssignment, mergeRows, markSplit,
  perWeekStatus, sameRows, removeAssignments, removeSubjects, undoRemove,
} from './rules.js';
import * as notify from './notify.js';
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
      const old = row[f];
      if (inp.dataset.nullable !== undefined && v.trim() === '') v = null;
      else if (numeric.includes(f)) v = Math.max(0, parseInt(v, 10) || 0);
      row[f] = v;
      if (after?.(row, f, old) === false) { row[f] = old; render(root); return; }
      store.commit('data');
    });
  });
}

function bindDelete(el, list, onDelete) {
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const row = list[+b.dataset.del];
    if (!row) return;
    const used = onDelete ? onDelete(row, true) : 0;
    if (used && !(await notify.confirm({ title: 'ลบรายการนี้?', icon: 'warning', ok: 'ลบ',
      text: `“${row.name || 'รายการนี้'}” ถูกใช้ในการสอน ${used} รายการ ลบแล้วการสอนและคาบในตารางที่เกี่ยวข้องจะถูกลบด้วย` }))) return;
    if (!list.includes(row)) return;
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
  el.innerHTML = head('ห้องเรียน', `เช่น ม.1/1 ป.6/2 · แต่ละห้องมีคาบเรียนได้ ${cap} คาบ/สัปดาห์ (ก่อนหักคาบล็อก) · ${esc(periodText(store.doc))}`, '+ เพิ่มห้องเรียน') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อห้อง</th><th>ระดับชั้น</th><th title="คาบ/สัปดาห์ที่มอบหมาย / ช่องว่างที่มี">คาบ/สัปดาห์ที่มอบหมาย</th><th></th></tr></thead><tbody>
    ${list.map((c, i) => {
      const load = store.doc.assignments.filter((a) => a.classId === c.id).reduce((s, a) => s + (a.perWeek || 0), 0);
      const locks = store.doc.locks.filter((l) => l.classId == null || l.classId === c.id).length;
      const free = cap - locks;
      return `<tr><td><input class="input" data-i="${i}" data-f="name" value="${esc(c.name)}"></td>
        <td><input class="input" data-i="${i}" data-f="level" value="${esc(c.level || '')}" placeholder="เช่น ม.1"></td>
        <td><span class="pill ${load > free ? 'warn' : ''}" title="มอบหมายแล้ว / ช่องที่เรียนได้ (หักคาบล็อกแล้ว)">${load} / ${free} คาบ/สัปดาห์</span></td>
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
  el.innerHTML = head('ครู', `ตั้งจำนวนคาบสูงสุดต่อวัน และคลิกช่องในตารางเล็กเพื่อระบุคาบที่ไม่ว่าง (สีแดง) · ${orientation(d) === 'days' ? 'ตารางเล็ก: แถว = วัน คอลัมน์ = คาบ' : 'ตารางเล็ก: แถว = คาบ คอลัมน์ = วัน'}`, '+ เพิ่มครู') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อครู</th><th>ชื่อย่อ</th><th title="จำนวนคาบสูงสุดต่อวัน 0 = ไม่จำกัด">สูงสุด (คาบ/วัน)</th><th>คาบไม่ว่าง</th><th>ภาระสอน</th><th></th></tr></thead><tbody>
    ${list.map((t, i) => {
      const load = d.assignments.filter((a) => a.teacherId === t.id).reduce((s, a) => s + (a.perWeek || 0), 0);
      return `<tr><td><input class="input" data-i="${i}" data-f="name" value="${esc(t.name)}" aria-label="ชื่อครู"></td>
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
  const days = d.term.days, P = d.term.periods;
  const byDay = orientation(d) === 'days';
  const cell = (day, pi) => (P[pi].type === 'break' ? `<button class="brk" tabindex="-1" aria-hidden="true"></button>`
    : `<button type="button" data-t="${ti}" data-d="${day}" data-p="${pi}" class="${un.has(day + ':' + pi) ? 'on' : ''}" aria-label="${DAY_NAMES[day]} คาบ ${esc(P[pi].label)}"></button>`);
  const title = byDay ? `แถว = วัน (${DAY_NAMES.slice(0, days).map((x) => x[0]).join(' ')}), คอลัมน์ = คาบ` : `แถว = คาบ, คอลัมน์ = วัน (${DAY_NAMES.slice(0, days).map((x) => x[0]).join(' ')})`;
  let h = `<div class="mini-grid${byDay ? ' by-day' : ''}" style="grid-template-columns:repeat(${byDay ? P.length : days},${byDay ? 16 : 22}px)" title="${title}">`;
  if (byDay) { for (let day = 0; day < days; day++) P.forEach((p, pi) => { h += cell(day, pi); }); }
  else P.forEach((p, pi) => { for (let day = 0; day < days; day++) h += cell(day, pi); });
  return h + '</div>';
}

// ---------- วิชา ----------
function subjectsView(el) {
  const d = store.doc, list = d.subjects;
  const classesOf = new Map();
  for (const a of d.assignments) { if (!classesOf.has(a.subjectId)) classesOf.set(a.subjectId, new Set()); classesOf.get(a.subjectId).add(a.classId); }
  el.innerHTML = head('วิชา', `รหัสวิชา ชื่อวิชา และ <b>คาบ/สัปดาห์ตามหลักสูตร</b> (ใช้เป็นค่าเริ่มต้นตอนเพิ่มการสอน) · ${esc(periodText(d))} · ประถม 1 คาบ/สัปดาห์ = 40 ชม./ปี · มัธยม 2 คาบ/สัปดาห์ = 1 หน่วยกิต/ภาค`, '+ เพิ่มวิชา',
    `<button class="btn btn-sm" data-catalog>เพิ่มจากหลักสูตรแกนกลาง…</button>${list.length ? '<button class="btn btn-sm btn-danger" data-del-all>ลบวิชาทั้งหมด…</button>' : ''}`) +
    `<div class="scroll-x"><table class="table"><thead><tr><th>สี</th><th>รหัส</th><th>ชื่อวิชา</th><th title="จำนวนคาบต่อสัปดาห์ตามโครงสร้างหลักสูตร">คาบ/สัปดาห์<br>ตามหลักสูตร</th><th>สอนใน</th><th></th></tr></thead><tbody>
    ${list.map((s, i) => {
      const n = classesOf.get(s.id)?.size || 0;
      return `<tr><td style="width:60px"><input type="color" class="swatch" data-i="${i}" data-f="color" value="${esc(s.color || '#7FB0E8')}" aria-label="สีวิชา"></td>
      <td style="width:130px"><input class="input mono" data-i="${i}" data-f="code" value="${esc(s.code || '')}" placeholder="ท21101" aria-label="รหัสวิชา"></td>
      <td><input class="input" data-i="${i}" data-f="name" value="${esc(s.name)}" aria-label="ชื่อวิชา"></td>
      <td class="num pw-cell"><input class="input" type="number" min="1" max="40" data-i="${i}" data-f="perWeek" data-nullable value="${s.perWeek ?? ''}" placeholder="—" aria-label="คาบต่อสัปดาห์ตามหลักสูตร ${esc(s.name)}">
        <span class="pw-hint">${esc(hoursHint(s.code, s.perWeek))}</span></td>
      <td><span class="pill" title="จำนวนห้องเรียนที่มีการสอนวิชานี้">${n ? `สอนใน ${n} ห้องเรียน` : 'ยังไม่ได้สอน'}</span></td>
      <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">ยังไม่มีวิชา กด “เพิ่มจากหลักสูตรแกนกลาง…” เพื่อเพิ่มวิชาพื้นฐานพร้อมคาบ/สัปดาห์</td></tr>'}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    list.push({ id: uid('s'), code: '', name: 'วิชาใหม่', color: SUBJECT_COLORS[list.length % SUBJECT_COLORS.length], perWeek: null });
    store.commit('data'); render(root);
  });
  el.querySelector('[data-catalog]').addEventListener('click', () => openCatalog());
  el.querySelector('[data-del-all]')?.addEventListener('click', () => deleteAllSubjects());
  bindInputs(el, list, { numeric: ['perWeek'], after: (row, f) => { if (f === 'perWeek' && row.perWeek === 0) row.perWeek = null; } });
  bindDelete(el, list, (row, dry) => cascade('subjectId', row.id, dry));
}

// ---------- ลบทั้งหมด + เลิกทำ 10 วินาที ----------
async function deleteWithUndo({ title, html, run, done }) {
  if (!(await notify.confirmDanger({ title, html }))) return;
  const token = run();
  store.commit('clear');
  render(root);
  notify.action(done(token), 'เลิกทำ', () => {
    const n = undoRemove(store.doc, token);
    store.commit('undo');
    render(root);
    notify.ok(`คืนข้อมูลแล้ว ${n} รายการ (รวมคาบที่วางไว้ ${token.placements.length} คาบ)`);
  }, 10000);
}

function deleteAllSubjects() {
  const d = store.doc;
  const nA = d.assignments.length, nP = d.placements.length;
  deleteWithUndo({
    title: 'ลบวิชาทั้งหมด?',
    html: `จะลบ <b>วิชา ${d.subjects.length} วิชา</b> พร้อม <b>การสอน ${nA} รายการ</b> และ <b>คาบที่จัดไว้ในตาราง ${nP} คาบ</b><br><span class="muted">หลังลบกด “เลิกทำ” ได้ภายใน 10 วินาที</span>`,
    run: () => removeSubjects(d),
    done: (t) => `ลบวิชา ${t.subjects.length} วิชา การสอน ${t.assignments.length} รายการ แล้ว`,
  });
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
  const used = usedSubjects(d);
  const subjById = new Map(d.subjects.map((x) => [x.id, x]));
  // แถวซ้ำ (ห้อง+วิชาเดียวกันที่ไม่ได้ตั้งเป็นแบ่งสอน) — ข้อมูลเก่าอาจมีอยู่แล้ว
  const dupOf = new Map();
  for (const g of duplicateGroups(d)) for (const a of g) dupOf.set(a.id, g);
  const dupHere = duplicateGroups(d).filter((g) => !filterClass || g[0].classId === filterClass);
  const clsName = filterClass ? idx.cls.get(filterClass)?.name || '' : '';
  const delLabel = filterClass ? `ลบการสอนของ ${esc(clsName)} ทั้งหมด…` : 'ลบการสอนทั้งหมด…';
  el.innerHTML = head('การสอน', `จับคู่ วิชา × ห้องเรียน × ครู และจำนวน <b>คาบ/สัปดาห์</b> รายการนี้คือสิ่งที่ระบบนำไปจัดลงตาราง · ${esc(periodText(d))}`, '+ เพิ่มการสอน') +
    `<div class="toolbar" style="padding:10px 14px;margin:0;border-bottom:1px solid var(--line)">
      <label class="muted" for="flt">ดูเฉพาะห้อง</label>
      <select id="flt" class="input input-sm">${opt(d.classes, filterClass, 'ทุกห้อง')}</select>
      ${ready ? '' : '<span class="pill warn">ต้องมีห้องเรียน ครู และวิชาก่อน</span>'}
      <span class="spacer"></span>
      ${list.length ? `<button class="btn btn-sm btn-danger" data-del-all>${delLabel}</button>` : ''}
    </div>
    ${dupHere.length ? `<div class="dup-note" role="alert"><b>พบวิชาซ้ำในห้องเดียวกัน ${dupHere.length} จุด</b> — แถวที่มีป้าย <span class="pill warn">ซ้ำ</span> กด “รวม” เพื่อรวมเป็นแถวเดียว หรือตั้งเป็นแบ่งสอน (2 ครูสอนวิชาเดียวกัน)</div>` : ''}
    <div class="scroll-x"><table class="table asg-table"><thead><tr><th>ห้อง</th><th>วิชา</th><th>ครู</th><th>ห้องพิเศษ</th><th title="จำนวนคาบต่อสัปดาห์">คาบ/สัปดาห์</th><th title="จำนวนคู่คาบติดกันต่อสัปดาห์">คาบคู่</th><th>จัดแล้ว</th><th></th></tr></thead><tbody>
    ${list.map((a) => {
      const i = all.indexOf(a);
      const st = perWeekStatus(d, a, subjById);
      const rows = a.split ? sameRows(d, a).filter((r) => r.split === a.split) : [];
      const part = rows.length > 1 ? rows.indexOf(a) + 1 : 0;
      const dup = dupOf.has(a.id);
      const notes = [
        part ? `<span class="pill split" title="วิชาเดียวกัน ห้องเดียวกัน แบ่งให้ครู ${rows.length} คนสอน">แบ่งสอน ${part}/${rows.length}</span>` : '',
        dup ? `<span class="pill warn" title="ห้องนี้มีวิชานี้มากกว่า 1 แถว">ซ้ำ</span> <button class="btn btn-sm" data-merge="${i}">รวม</button>` : '',
        st && !st.ok ? `<span class="pill soft" title="คาบ/สัปดาห์ตามหลักสูตรของวิชานี้ (ตั้งที่ ข้อมูล → วิชา)">หลักสูตร ${st.target} คาบ/สัปดาห์${rows.length > 1 || dup ? ` · รวมตอนนี้ ${st.total}` : ''}</span>` : '',
      ].filter(Boolean).join(' ');
      return `<tr class="${dup ? 'dup-row' : part ? 'split-row' : ''}">
        <td><select class="input" data-i="${i}" data-f="classId" aria-label="ห้องเรียน">${opt(d.classes, a.classId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="subjectId" aria-label="วิชา">${opt(subjectChoices(d, a, dup ? null : used), a.subjectId)}</select>${notes ? `<div class="row-note">${notes}</div>` : ''}</td>
        <td><select class="input" data-i="${i}" data-f="teacherId" aria-label="ครู">${opt(d.teachers, a.teacherId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="roomId" data-nullable aria-label="ห้องพิเศษ">${opt(d.rooms, a.roomId, '— ไม่ใช้ —')}</select></td>
        <td class="num"><input class="input" type="number" min="1" max="20" data-i="${i}" data-f="perWeek" value="${a.perWeek || 1}" aria-label="คาบต่อสัปดาห์"></td>
        <td class="num"><input class="input" type="number" min="0" max="10" data-i="${i}" data-f="doubles" value="${a.doubles || 0}" title="จำนวนคู่คาบติดกันต่อสัปดาห์" aria-label="จำนวนคาบคู่"></td>
        <td><span class="pill ${remaining(a) ? '' : 'ok'}">${(a.perWeek || 0) - remaining(a)}/${a.perWeek || 0}</span></td>
        <td class="act-cell">${part ? `<button class="btn btn-sm" data-unsplit="${i}" title="รวมแถวแบ่งสอนกลับเป็นแถวเดียว">รวมกลับ</button>` : dup ? '' : `<button class="btn btn-sm" data-split="${i}" title="วิชาเดียวกันสอนโดย 2 ครู แยกคาบกัน">แบ่งสอน</button>`}
          <button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">ยังไม่มีการสอน</td></tr>'}</tbody></table></div>
    ${summary()}`;
  el.querySelector('#flt').addEventListener('change', (e) => { filterClass = e.target.value; render(root); });
  el.querySelector('[data-go-board]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'board' } })));
  el.querySelector('[data-add]').addEventListener('click', () => {
    if (!ready) { notify.warn('เพิ่มห้องเรียน ครู และวิชาอย่างน้อยอย่างละ 1 รายการก่อน'); return; }
    const g = guessNew(filterClass || d.classes[0].id);
    if (!g) { notify.warn(`${idx.cls.get(filterClass || d.classes[0].id)?.name || 'ห้องนี้'} มีการสอนครบทุกวิชาในรายการแล้ว — เพิ่มวิชาใหม่ที่ ข้อมูล → วิชา หรือใช้ปุ่ม “แบ่งสอน” ถ้าวิชาเดียวสอนโดย 2 ครู`); return; }
    const perWeek = idx.subj.get(g.subjectId)?.perWeek || 2;
    all.push({ id: uid('a'), ...g, roomId: null, perWeek, doubles: 0 });
    store.commit('data'); render(root);
  });
  el.querySelector('[data-del-all]')?.addEventListener('click', () => {
    const target = filterClass;
    const rows = target ? all.filter((a) => a.classId === target) : all.slice();
    const ids = new Set(rows.map((a) => a.id));
    const nP = d.placements.filter((p) => ids.has(p.assignmentId)).length;
    deleteWithUndo({
      title: target ? `ลบการสอนของ ${clsName} ทั้งหมด?` : 'ลบการสอนทุกห้องทั้งหมด?',
      html: `จะลบ <b>การสอน ${rows.length} รายการ</b>${target ? ` ของห้อง <b>${esc(clsName)}</b> เท่านั้น` : ' <b>ของทุกห้อง</b>'} และ <b>คาบที่จัดไว้ในตาราง ${nP} คาบ</b><br><span class="muted">ห้องเรียน ครู และวิชายังอยู่ · หลังลบกด “เลิกทำ” ได้ภายใน 10 วินาที</span>`,
      run: () => removeAssignments(d, (a) => ids.has(a.id)),
      done: (t) => `ลบการสอน ${t.assignments.length} รายการ${target ? ` ของ ${clsName}` : ''} แล้ว`,
    });
  });
  bindInputs(el, all, { numeric: ['perWeek', 'doubles'], after: (row, f, old) => {
    if (f === 'doubles' && row.doubles * 2 > row.perWeek) row.doubles = Math.floor(row.perWeek / 2);
    if (f === 'classId') {
      // ย้ายไปห้องที่มีวิชานี้อยู่แล้ว = ซ้ำ → ไม่ยอม (ใช้ปุ่มแบ่งสอนแทน)
      if (all.some((x) => x !== row && x.classId === row.classId && x.subjectId === row.subjectId)) {
        notify.warn(`${idx.cls.get(row.classId)?.name || 'ห้องนั้น'} มีวิชา “${idx.subj.get(row.subjectId)?.name || ''}” อยู่แล้ว ถ้าวิชาเดียวสอนโดย 2 ครู ให้กด “แบ่งสอน” ที่แถวเดิม`, 7000);
        return false;
      }
      delete row.split;
    }
    if (f === 'subjectId') {
      const before = idx.subj.get(old), now = idx.subj.get(row.subjectId);
      // คาบ/สัปดาห์ยังเป็นค่าของวิชาเดิม (ผู้ใช้ไม่ได้แก้เอง) → เปลี่ยนตามหลักสูตรของวิชาใหม่
      const group = row.split ? all.filter((x) => x !== row && x.split === row.split && x.classId === row.classId) : [];
      if (!group.length && now?.perWeek && (!before?.perWeek || row.perWeek === before.perWeek)) row.perWeek = now.perWeek;
      for (const x of group) x.subjectId = row.subjectId; // แบ่งสอนเปลี่ยนวิชาพร้อมกันทั้งกลุ่ม
    }
    if (f === 'classId' || f === 'teacherId') store.doc.placements = store.doc.placements.filter((p) => p.assignmentId !== row.id);
    return true;
  } });
  el.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', () => {
    const a = all[+b.dataset.split];
    if (!a) return;
    if (d.teachers.length < 2) { notify.warn('ต้องมีครูอย่างน้อย 2 คนจึงแบ่งสอนได้ (เพิ่มครูที่ ข้อมูล → ครู)'); return; }
    const nb = splitAssignment(d, a, uid('a'));
    store.commit('data'); render(root);
    notify.ok(`แบ่งสอนแล้ว: ${a.perWeek} + ${nb.perWeek} คาบ/สัปดาห์ · เลือกครูคนที่สองในแถวใหม่ (ตอนนี้: ${idx.tch.get(nb.teacherId)?.name || '-'})`, 6000);
  }));
  el.querySelectorAll('[data-unsplit]').forEach((b) => b.addEventListener('click', async () => {
    const a = all[+b.dataset.unsplit];
    if (!a) return;
    const rows = all.filter((x) => x.split === a.split && x.classId === a.classId);
    const t = idx.tch.get(rows[0].teacherId)?.name || '';
    if (!(await notify.confirm({ title: 'รวมแบ่งสอนกลับเป็นแถวเดียว?', text: `รวม ${rows.length} แถวเป็นแถวเดียว ครูผู้สอน: ${t} คาบรวม ${rows.reduce((n, r) => n + (r.perWeek || 0), 0)} คาบ/สัปดาห์ (คาบที่วางไว้แล้วยังอยู่)`, ok: 'รวมกลับ' }))) return;
    mergeRows(d, rows);
    store.commit('data'); render(root);
    notify.ok('รวมกลับเป็นแถวเดียวแล้ว');
  }));
  el.querySelectorAll('[data-merge]').forEach((b) => b.addEventListener('click', async () => {
    const a = all[+b.dataset.merge];
    const g = a && dupOf.get(a.id);
    if (!g) return;
    const teachers = [...new Set(g.map((r) => r.teacherId))];
    const total = g.reduce((n, r) => n + (r.perWeek || 0), 0);
    const sName = idx.subj.get(a.subjectId)?.name || '', cName = idx.cls.get(a.classId)?.name || '';
    const pick = await notify.choose({
      title: 'รวมวิชาที่ซ้ำ', icon: 'question',
      html: `<b>${esc(cName)}</b> มีวิชา <b>${esc(sName)}</b> อยู่ ${g.length} แถว (${g.map((r) => `${esc(idx.tch.get(r.teacherId)?.name || '-')} ${r.perWeek || 0} คาบ`).join(', ')})<br><br>
        <b>รวมเป็นแถวเดียว</b>: ครู ${esc(idx.tch.get(g[0].teacherId)?.name || '-')} ${total} คาบ/สัปดาห์ (คาบที่วางไว้ย้ายมารวมกัน)${teachers.length > 1 ? '<br><b>ตั้งเป็นแบ่งสอน</b>: เก็บทั้ง 2 ครูไว้ แยกคาบกันสอน' : ''}`,
      ok: 'รวมเป็นแถวเดียว', deny: teachers.length > 1 ? 'ตั้งเป็นแบ่งสอน' : undefined,
    });
    if (!pick) return;
    if (pick === 'deny') markSplit(g); else mergeRows(d, g);
    store.commit('data'); render(root);
    notify.ok(pick === 'deny' ? 'ตั้งเป็นแบ่งสอนแล้ว' : 'รวมเป็นแถวเดียวแล้ว');
  }));
  bindDelete(el, all, (row, dry) => {
    const n = store.doc.placements.filter((p) => p.assignmentId === row.id).length;
    if (!dry) {
      store.doc.placements = store.doc.placements.filter((p) => p.assignmentId !== row.id);
      // เหลือแถวแบ่งสอนแถวเดียว → ไม่ใช่แบ่งสอนแล้ว
      const rest = row.split ? store.doc.assignments.filter((x) => x.split === row.split && x.classId === row.classId) : [];
      if (rest.length === 1) delete rest[0].split;
    }
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
  const subject = sameLevel[0] || free[0];
  if (!subject) return null; // ห้องนี้มีทุกวิชาแล้ว (ไม่เพิ่มวิชาซ้ำ)
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
