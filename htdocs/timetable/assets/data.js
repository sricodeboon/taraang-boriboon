// แท็บข้อมูล: ห้องเรียน ครู วิชา ห้องพิเศษ การสอน (ตารางแก้ไขในที่)
import { store, idx, uid, DAY_NAMES, SUBJECT_COLORS, classPeriods, esc, remaining, noTeacher as noTch } from './store.js';
import {
  orientation, periodText, hoursHint, subjectChoices, usedSubjects, duplicateGroups, splitAssignment, mergeRows, markSplit,
  perWeekStatus, sameRows, removeAssignments, removeSubjects, undoRemove,
  SUBJECT_GROUP_CODES, SUBJECT_GROUP_NAMES, autoAssign, applyAssign, undoAssign, teacherLoad, defaultAssignOpts, guessNew,
} from './rules.js';
import * as notify from './notify.js';
import * as school from './school.js';
import { openCatalog } from './curriculum.js';
import { bustImg } from './mascot.js';

let section = null; // null = ยังไม่ได้เลือก → "ห้องเรียน" เมื่อยังไม่มีครู, "การสอน" เมื่อมีครูแล้ว (ตัวช่วยเริ่มต้นพามาที่ "ครู" เอง)
let filterClass = null; // null = ยังไม่ได้เลือก → โรงเรียนใหญ่เริ่มที่ห้องแรก (ทุกห้องพร้อมกันหน่วงบนมือถือ)
let onlyNoTeacher = false; // แท็บการสอน: ดูเฉพาะแถวที่ยังไม่มีครู (ปุ่ม "ไปเติมครู" ในรายงานผลการจัดเปิดให้)
let focusTeacher = null;   // แท็บครู: ไฮไลต์แถวครูคนนี้ครั้งเดียว (ปุ่ม "ไปดูช่องไม่ว่างของครู")
let root = null;

const SECTIONS = [
  ['classes', 'ห้องเรียน'], ['teachers', 'ครู'], ['subjects', 'วิชา'], ['rooms', 'ห้องพิเศษ'], ['assignments', 'การสอน'], ['school', 'โรงเรียน'],
];

/**
 * เปิดหมวดข้อมูลที่ต้องการ (จากปุ่ม "ไปแก้ที่…" ในรายงานผลการจัด)
 * opts.filter = 'noTeacher' → แท็บการสอนกรองแถวที่ยังไม่มีครู (ทุกห้อง) · opts.teacherId → แท็บครูไฮไลต์ครูคนนั้น · ไม่ส่ง opts = ไม่แตะตัวกรองเดิม
 */
export function setSection(k, opts) {
  if (!SECTIONS.some(([x]) => x === k)) return;
  section = k;
  if (!opts) return;
  if (k === 'assignments') { onlyNoTeacher = opts.filter === 'noTeacher'; if (onlyNoTeacher) filterClass = ''; }
  if (k === 'teachers') focusTeacher = opts.teacherId || null;
}
// รับ filter/teacherId จาก tt:goto เอง — โมดูลนี้ประเมินก่อน app.js จึงตั้งค่าก่อน app.js สั่งวาดแท็บ
// (app.js เรียก setSection(section) ไม่มี opts ตามมา ซึ่งไม่ล้างค่าที่ตั้งตรงนี้)
document.addEventListener('tt:goto', (e) => {
  const g = e.detail || {};
  if (g.tab === 'data' && g.section) setSection(g.section, { filter: g.filter, teacherId: g.teacherId });
});

export function render(el) {
  root = el;
  const d = store.doc;
  ensureStyle();
  const sec = section || (d.teachers.length ? 'assignments' : 'classes');
  const counts = { classes: d.classes.length, teachers: d.teachers.length, subjects: d.subjects.length, rooms: d.rooms.length, assignments: d.assignments.length };
  el.innerHTML = `<div class="data-nav" role="group" aria-label="ประเภทข้อมูล">
      ${SECTIONS.map(([k, n]) => `<button data-sec="${k}" aria-pressed="${k === sec}">${n}${k in counts ? ` <span class="muted">${counts[k]}</span>` : ''}</button>`).join('')}
    </div>
    <div class="card data-card" id="data-body"></div>`;
  el.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec; onlyNoTeacher = false; render(el); }));
  const body = el.querySelector('#data-body');
  // ปุ่มในกล่อง "ยังไม่มี…" กดแทนปุ่มเดิมบนหัวตาราง (ใช้ตัวจัดการเดิม ไม่เขียนซ้ำ)
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-proxy]');
    if (b) body.querySelector(`.data-head [data-${b.dataset.proxy}]`)?.click();
  });
  ({ classes: classesView, teachers: teachersView, subjects: subjectsView, rooms: roomsView, assignments: assignmentsView, school: school.render })[sec](body);
}

// สไตล์ของส่วนที่เพิ่มในรุ่นนี้ (ชิปกลุ่มสาระ แถวยังไม่มีครู แถบภาระครู กล่องวางรายชื่อ) — ฝังครั้งเดียวต่อหน้า
// สี "ยังว่าง/ต้องตรวจ" = ทอง-ส้ม (--gold/--gold-soft มีค่าโหมดมืดแล้ว) · ไม่มี border-left · ไม่มีสีเขียว
const CSS = `.pill.todo{color:var(--gold);border-color:#C8962E;background:var(--gold-soft)}
.asg-table tr.todo-row td{background:var(--gold-soft)}
.tchips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.tchip{font-size:.78rem;padding:1px 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);white-space:nowrap}
.tchip.home{color:var(--blue);border-color:var(--blue);background:var(--blue-soft)}
.tchips .btn{padding:1px 10px;font-size:.8rem}
.table tr.tr-focus td{background:var(--blue-soft)}
.auto-bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface-2);font-size:.88rem}
.auto-bar label{display:inline-flex;gap:6px;align-items:center}
.auto-bar input[type=number]{width:70px;padding:4px 8px}
.auto-bar .hint{flex-basis:100%}
.load-box{border-top:1px solid var(--line);padding:8px 14px;font-size:.86rem}
.load-box summary{cursor:pointer;padding:2px 0}
.load-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 16px;margin-top:8px}
.load-row{display:grid;grid-template-columns:minmax(0,1fr) 64px 52px;gap:8px;align-items:center}
.load-row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.load-row .bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}
.load-row .bar i{display:block;height:100%;background:var(--blue)}
.load-row.over .bar i{background:var(--gold-bg)}
.load-row.over b{color:var(--gold)}
.load-row b{text-align:right;font-variant-numeric:tabular-nums}
.dlg.imp-dlg{width:min(900px,calc(100vw - 32px))}
.imp-dlg textarea{min-height:190px;resize:vertical;line-height:1.6}
.imp-ex{margin:0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);font-size:.82rem;white-space:pre;overflow:auto}
.imp-dlg .cur-list{max-height:min(52vh,520px)}
.imp-table td,.imp-table th{padding:5px 8px;font-size:.88rem;vertical-align:top}
.imp-table .input{padding:5px 8px;min-width:96px}
.imp-table input[type=number].input{min-width:0;width:64px}
.imp-table tr.fix td{background:var(--gold-soft)}
.imp-issue{display:block;color:var(--gold);font-size:.8rem;line-height:1.4}
.imp-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.imp-acts .spacer{flex:1}`;
function ensureStyle() {
  if (document.getElementById('tt-data-css')) return;
  const s = document.createElement('style');
  s.id = 'tt-data-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ชื่อสั้นของกลุ่มสาระสำหรับชิป (ชื่อเต็มอยู่ใน title)
const GROUP_SHORT = { TH: 'ไทย', MA: 'คณิต', SC: 'วิทย์', SO: 'สังคม', HE: 'สุข-พละ', AR: 'ศิลปะ', OC: 'การงาน', FL: 'ต่างประเทศ', EC: 'ปฐมวัย', GU: 'แนะแนว' };

// ค่าของสวิตช์ "เติมครูอัตโนมัติ": ค่าเริ่มต้นตามชนิดโรงเรียน (defaultAssignOpts) + ค่าที่ผู้ใช้ปรับในภาคเรียนนี้ (ไม่เก็บลงเอกสาร)
let userOpts = {}, optsTerm = null;
function assignOpts() {
  if (optsTerm !== store.termId) { userOpts = {}; optsTerm = store.termId; }
  return { ...defaultAssignOpts(store.doc), ...userOpts };
}
const capOf = (t, ao) => { const n = Math.trunc(Number(t.maxPerWeek)); return n > 0 ? n : ao.maxPerWeek; }; // ช่องนี้อาจมาจากไฟล์สำรอง → แปลงเป็นตัวเลขก่อนพิมพ์

// ---------- ตัวช่วย ----------
const opt = (list, cur, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

/**
 * แถวว่างของตาราง: ครูบูรณ์ (bust) + ประโยคเดียว + ปุ่มกลางพื้นที่
 * btns: [[ข้อความ, 'add'|'paste'|'catalog' (= ปุ่มบนหัวตาราง) หรือ 'wizard', หลัก?]]
 */
function emptyRow(cols, text, btns = []) {
  const b = btns.map(([label, k, main]) => `<button type="button" class="btn btn-sm${main ? ' btn-primary' : ''}" ${k === 'wizard' ? 'data-open-wizard' : `data-proxy="${k}"`}>${label}</button>`).join('');
  return `<tr class="empty-row"><td colspan="${cols}"><div class="boon-empty">${bustImg()}<p>${text}</p>${b ? `<div class="boon-empty-acts">${b}</div>` : ''}</div></td></tr>`;
}
const blankTerm = () => !store.doc.classes.length && !store.doc.teachers.length && !store.doc.assignments.length;

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
    }).join('') || emptyRow(4, 'ยังไม่มีห้องเรียนครับ ตอบ 4 คำถามให้ระบบสร้างให้ หรือเพิ่มเองทีละห้องก็ได้',
      [...(blankTerm() ? [['เริ่มด้วยตัวช่วย 4 คำถาม', 'wizard', true]] : []), ['+ เพิ่มห้องเรียน', 'add', !blankTerm()]])}</tbody></table></div>`;
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
  const load = teacherLoad(d), ao = assignOpts();
  const focus = focusTeacher;
  focusTeacher = null; // ไฮไลต์ครั้งเดียว วาดใหม่รอบหน้าไม่ต้องมี
  el.innerHTML = head('ครู', `ตั้งจำนวนคาบสูงสุดต่อวัน และคลิกช่องในตารางเล็กเพื่อระบุคาบที่ไม่ว่าง (สีแดง) · ${orientation(d) === 'days' ? 'ตารางเล็ก: แถว = วัน คอลัมน์ = คาบ' : 'ตารางเล็ก: แถว = คาบ คอลัมน์ = วัน'} · <b>กลุ่มสาระ/ประจำชั้น</b> ใช้ตอนเติมครูอัตโนมัติ`, '+ เพิ่มครู',
    '<button class="btn btn-sm" data-paste="teachers" title="วางรายชื่อที่คัดลอกจาก Excel, Google Sheets, LINE หรือ Word">วางรายชื่อครู…</button>') +
    `<div class="scroll-x"><table class="table"><thead><tr><th>ชื่อครู</th><th>ชื่อย่อ</th><th>กลุ่มสาระ · ประจำชั้น</th><th title="จำนวนคาบสูงสุดต่อวัน 0 = ไม่จำกัด">สูงสุด (คาบ/วัน)</th><th>คาบไม่ว่าง</th><th>ภาระสอน</th><th></th></tr></thead><tbody>
    ${list.map((t, i) => {
      const n = load.get(t.id) || 0, cap = capOf(t, ao);
      return `<tr${t.id === focus ? ' class="tr-focus"' : ''}><td><input class="input" data-i="${i}" data-f="name" value="${esc(t.name)}" aria-label="ชื่อครู"></td>
        <td style="width:110px"><input class="input" data-i="${i}" data-f="short" value="${esc(t.short || '')}" aria-label="ชื่อย่อ"></td>
        <td>${teacherChips(t, i)}</td>
        <td class="num"><input class="input" type="number" min="0" max="20" data-i="${i}" data-f="maxPerDay" value="${t.maxPerDay || 0}" title="0 = ไม่จำกัด" aria-label="คาบสูงสุดต่อวัน"></td>
        <td>${miniGrid(t, i)}</td>
        <td><span class="pill${n > cap ? ' todo' : ''}" title="${n > cap ? `เกินเพดาน ${cap} คาบ/สัปดาห์ (ตั้งที่ การสอน → เติมครูอัตโนมัติ)` : ''}">${n} คาบ/สัปดาห์</span></td>
        <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || emptyRow(7, 'ยังไม่มีครูครับ คัดลอกรายชื่อจาก Excel หรือ LINE มาวางทีเดียวทั้งโรงเรียนได้เลย',
      [['วางรายชื่อครู…', 'paste', true], ['+ เพิ่มทีละคน', 'add']])}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    list.push({ id: uid('t'), name: 'ครูคนใหม่', short: '', maxPerDay: 6, unavailable: [] });
    store.commit('data'); render(root);
  });
  el.querySelector('[data-paste]').addEventListener('click', () => openPaste('teachers'));
  el.querySelectorAll('[data-groups]').forEach((b) => b.addEventListener('click', () => editGroups(list[+b.dataset.groups])));
  bindInputs(el, list, { numeric: ['maxPerDay'] });
  bindDelete(el, list, (row, dry) => cascade('teacherId', row.id, dry));
  const tr = focus && el.querySelector('tr.tr-focus');
  // บล็อก { } — scrollIntoView ใน Chrome 154 คืน Promise ห้ามเป็นค่าคืนของ callback
  if (tr) requestAnimationFrame(() => { tr.scrollIntoView({ block: 'center' }); });
  el.querySelectorAll('.mini-grid button[data-t]').forEach((b) => b.addEventListener('click', () => {
    const t = list[+b.dataset.t], day = +b.dataset.d, p = +b.dataset.p;
    t.unavailable = t.unavailable || [];
    const k = t.unavailable.findIndex(([x, y]) => x === day && y === p);
    if (k >= 0) t.unavailable.splice(k, 1); else t.unavailable.push([day, p]);
    b.classList.toggle('on');
    store.commit('data');
  }));
}

/** ชิปกลุ่มสาระ + ประจำชั้นในแถวครู (ฟิลด์ optional ทั้งคู่ ผ่าน sanitize แล้ว) + ปุ่มแก้ */
function teacherChips(t, i) {
  const groups = Array.isArray(t.subjects) ? t.subjects : [];
  const home = t.homeroom ? idx.cls.get(t.homeroom) : null;
  const chips = groups.map((g) => `<span class="tchip" title="${esc(SUBJECT_GROUP_NAMES[g] || g)}">${esc(GROUP_SHORT[g] || g)}</span>`).join('')
    + (home ? `<span class="tchip home" title="ครูประจำชั้น">ประจำชั้น ${esc(home.name)}</span>` : '');
  return `<div class="tchips">${chips || '<span class="muted" style="font-size:.82rem">ยังไม่ระบุ</span>'}
    <button type="button" class="btn btn-sm" data-groups="${i}" aria-label="แก้กลุ่มสาระและประจำชั้นของ ${esc(t.name)}">${chips ? 'แก้' : 'ระบุ'}</button></div>`;
}

async function editGroups(t) {
  if (!t) return;
  const d = store.doc;
  const have = new Set(Array.isArray(t.subjects) ? t.subjects : []);
  const v = await notify.form({
    title: `กลุ่มสาระและประจำชั้น · ${t.name || 'ครู'}`, ok: 'บันทึก',
    html: `<div class="field"><label>กลุ่มสาระที่สอนได้ (เลือกได้หลายกลุ่ม)</label>
        <div class="cur-levels">${SUBJECT_GROUP_CODES.map((g) => `<label title="${esc(SUBJECT_GROUP_NAMES[g])}"><input type="checkbox" data-g="${g}" ${have.has(g) ? 'checked' : ''}>${esc(GROUP_SHORT[g])}</label>`).join('')}</div></div>
      <div class="field" style="margin-top:12px"><label for="tt-homeroom">ครูประจำชั้นของห้อง</label>
        <select id="tt-homeroom" class="input">${opt(d.classes, t.homeroom, '— ไม่ได้เป็นครูประจำชั้น —')}</select></div>
      <p class="hint" style="margin:10px 0 0">“เติมครูอัตโนมัติ” ใช้ข้อมูลนี้: วิชาตรงกลุ่มสาระไปหาครูกลุ่มนั้น · ห้องประถมให้ครูประจำชั้นสอนวิชาหลักเองได้</p>`,
    read: (pop) => ({ groups: [...pop.querySelectorAll('[data-g]:checked')].map((x) => x.dataset.g), homeroom: pop.querySelector('#tt-homeroom')?.value || '' }),
  });
  if (!v || store.doc !== d || !d.teachers.includes(t)) return;
  const groups = SUBJECT_GROUP_CODES.filter((g) => v.groups.includes(g));
  if (groups.length) t.subjects = groups; else delete t.subjects;
  if (v.homeroom && idx.cls.has(v.homeroom)) t.homeroom = v.homeroom; else delete t.homeroom;
  const other = t.homeroom && d.teachers.find((x) => x !== t && x.homeroom === t.homeroom);
  store.commit('data');
  if (other) notify.info(`${idx.cls.get(t.homeroom)?.name || 'ห้องนี้'} มีครูประจำชั้น 2 คนแล้ว (${other.name}) · ตอนเติมครูอัตโนมัติ ระบบใช้คนที่อยู่ก่อนในรายชื่อ`, 7000);
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
    `<button class="btn btn-sm" data-catalog>เพิ่มจากหลักสูตรแกนกลาง…</button><button class="btn btn-sm" data-paste="subjects" title="วางรายวิชา รหัส | ชื่อ | คาบ ที่คัดลอกจาก Excel หรือเอกสาร">วางรายชื่อวิชา…</button>${list.length ? '<button class="btn btn-sm btn-danger" data-del-all>ลบวิชาทั้งหมด…</button>' : ''}`) +
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
    }).join('') || emptyRow(6, 'ยังไม่มีวิชาครับ เพิ่มจากหลักสูตรแกนกลางได้วิชาพื้นฐานพร้อมคาบ/สัปดาห์ในคลิกเดียว',
      [['เพิ่มจากหลักสูตรแกนกลาง…', 'catalog', true], ['วางรายชื่อวิชา…', 'paste']])}</tbody></table></div>`;
  el.querySelector('[data-add]').addEventListener('click', () => {
    list.push({ id: uid('s'), code: '', name: 'วิชาใหม่', color: SUBJECT_COLORS[list.length % SUBJECT_COLORS.length], perWeek: null });
    store.commit('data'); render(root);
  });
  el.querySelector('[data-catalog]').addEventListener('click', () => openCatalog());
  el.querySelector('[data-paste]').addEventListener('click', () => openPaste('subjects'));
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
      <td><button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`).join('') || emptyRow(4, 'ยังไม่มีห้องพิเศษครับ ไม่จำเป็นต้องมี ใช้เมื่อบางวิชาต้องเรียนห้องเฉพาะ เช่น ห้องคอมพิวเตอร์', [['+ เพิ่มห้องพิเศษ', 'add']])}</tbody></table></div>`;
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
  const noTeacher = all.filter(noTch);
  if (!noTeacher.length) onlyNoTeacher = false; // เติมครบแล้ว → กลับมาดูทุกแถว
  let list = filterClass ? all.filter((a) => a.classId === filterClass) : all;
  if (onlyNoTeacher) list = list.filter(noTch);
  // ครูเว้นว่างได้ (ตัวช่วยเริ่มต้นสร้างการสอนร่างที่ยังไม่มีครู แล้วเติมทีหลัง) — ต้องมีแค่ห้องเรียนกับวิชา
  const ready = d.classes.length && d.subjects.length;
  const ao = assignOpts();
  const used = usedSubjects(d);
  const subjById = new Map(d.subjects.map((x) => [x.id, x]));
  // แถวซ้ำ (ห้อง+วิชาเดียวกันที่ไม่ได้ตั้งเป็นแบ่งสอน) — ข้อมูลเก่าอาจมีอยู่แล้ว
  const dupOf = new Map();
  for (const g of duplicateGroups(d)) for (const a of g) dupOf.set(a.id, g);
  const dupHere = duplicateGroups(d).filter((g) => !filterClass || g[0].classId === filterClass);
  const clsName = filterClass ? idx.cls.get(filterClass)?.name || '' : '';
  const delLabel = filterClass ? `ลบการสอนของ ${esc(clsName)} ทั้งหมด…` : 'ลบการสอนทั้งหมด…';
  el.innerHTML = head('การสอน', `จับคู่ วิชา × ห้องเรียน × ครู และจำนวน <b>คาบ/สัปดาห์</b> รายการนี้คือสิ่งที่ระบบนำไปจัดลงตาราง · ${esc(periodText(d))}`, '+ เพิ่มการสอน',
    '<button class="btn btn-sm" data-paste="workload" title="วางตาราง ครู | วิชา | ห้อง | คาบ ที่คัดลอกจาก Excel หรือ LINE">วางภาระสอน…</button>') +
    `<div class="toolbar" style="padding:10px 14px;margin:0;border-bottom:1px solid var(--line)">
      <label class="muted" for="flt">ดูเฉพาะห้อง</label>
      <select id="flt" class="input input-sm">${opt(d.classes, filterClass, 'ทุกห้อง')}</select>
      ${noTeacher.length ? `<button class="btn btn-sm" data-only-none aria-pressed="${onlyNoTeacher}">เฉพาะที่ยังไม่มีครู <span class="muted">${noTeacher.length}</span></button>` : ''}
      ${ready ? '' : '<span class="pill warn">ต้องมีห้องเรียนและวิชาก่อน</span>'}
      <span class="spacer"></span>
      ${list.length && !onlyNoTeacher ? `<button class="btn btn-sm btn-danger" data-del-all>${delLabel}</button>` : ''}
    </div>
    ${autoBar(d, noTeacher.length, ao)}
    ${dupHere.length ? `<div class="dup-note" role="alert"><b>พบวิชาซ้ำในห้องเดียวกัน ${dupHere.length} จุด</b> — แถวที่มีป้าย <span class="pill warn">ซ้ำ</span> กด “รวม” เพื่อรวมเป็นแถวเดียว หรือตั้งเป็นแบ่งสอน (2 ครูสอนวิชาเดียวกัน)</div>` : ''}
    <div class="scroll-x"><table class="table asg-table"><thead><tr><th>ห้อง</th><th>วิชา</th><th>ครู</th><th>ห้องพิเศษ</th><th title="จำนวนคาบต่อสัปดาห์">คาบ/สัปดาห์</th><th title="จำนวนคู่คาบติดกันต่อสัปดาห์">คาบคู่</th><th>จัดแล้ว</th><th></th></tr></thead><tbody>
    ${list.map((a) => {
      const i = all.indexOf(a);
      const st = perWeekStatus(d, a, subjById);
      const rows = a.split ? sameRows(d, a).filter((r) => r.split === a.split) : [];
      const part = rows.length > 1 ? rows.indexOf(a) + 1 : 0;
      const dup = dupOf.has(a.id);
      const none = noTch(a);
      const notes = [
        none ? '<span class="pill todo" title="แถวนี้ยังไม่ถูกนำไปจัดลงตารางจนกว่าจะเลือกครู">ยังไม่มีครู</span>' : '',
        part ? `<span class="pill split" title="วิชาเดียวกัน ห้องเดียวกัน แบ่งให้ครู ${rows.length} คนสอน">แบ่งสอน ${part}/${rows.length}</span>` : '',
        dup ? `<span class="pill warn" title="ห้องนี้มีวิชานี้มากกว่า 1 แถว">ซ้ำ</span> <button class="btn btn-sm" data-merge="${i}">รวม</button>` : '',
        st && !st.ok ? `<span class="pill soft" title="คาบ/สัปดาห์ตามหลักสูตรของวิชานี้ (ตั้งที่ ข้อมูล → วิชา)">หลักสูตร ${st.target} คาบ/สัปดาห์${rows.length > 1 || dup ? ` · รวมตอนนี้ ${st.total}` : ''}</span>` : '',
      ].filter(Boolean).join(' ');
      return `<tr class="${dup ? 'dup-row' : none ? 'todo-row' : part ? 'split-row' : ''}">
        <td><select class="input" data-i="${i}" data-f="classId" aria-label="ห้องเรียน">${opt(d.classes, a.classId)}</select></td>
        <td><select class="input" data-i="${i}" data-f="subjectId" aria-label="วิชา">${opt(subjectChoices(d, a, dup ? null : used), a.subjectId)}</select>${notes ? `<div class="row-note">${notes}</div>` : ''}</td>
        <td><select class="input" data-i="${i}" data-f="teacherId" data-nullable aria-label="ครู">${opt(d.teachers, a.teacherId, '— ยังไม่มีครู —')}</select></td>
        <td><select class="input" data-i="${i}" data-f="roomId" data-nullable aria-label="ห้องพิเศษ">${opt(d.rooms, a.roomId, '— ไม่ใช้ —')}</select></td>
        <td class="num"><input class="input" type="number" min="1" max="20" data-i="${i}" data-f="perWeek" value="${a.perWeek || 1}" aria-label="คาบต่อสัปดาห์"></td>
        <td class="num"><input class="input" type="number" min="0" max="10" data-i="${i}" data-f="doubles" value="${a.doubles || 0}" title="จำนวนคู่คาบติดกันต่อสัปดาห์" aria-label="จำนวนคาบคู่"></td>
        <td><span class="pill ${remaining(a) ? '' : 'ok'}">${(a.perWeek || 0) - remaining(a)}/${a.perWeek || 0}</span></td>
        <td class="act-cell">${part ? `<button class="btn btn-sm" data-unsplit="${i}" title="รวมแถวแบ่งสอนกลับเป็นแถวเดียว">รวมกลับ</button>` : dup ? '' : `<button class="btn btn-sm" data-split="${i}" title="วิชาเดียวกันสอนโดย 2 ครู แยกคาบกัน">แบ่งสอน</button>`}
          <button class="btn btn-sm btn-danger" data-del="${i}">ลบ</button></td></tr>`;
    }).join('') || (onlyNoTeacher ? '<tr><td colspan="8" class="muted">ห้องนี้ทุกแถวมีครูแล้ว — กด “เฉพาะที่ยังไม่มีครู” อีกครั้งเพื่อดูทุกแถว</td></tr>'
      : emptyRow(8, 'ยังไม่มีการสอนครับ บอกว่าใครสอนวิชาอะไร ห้องไหน กี่คาบ ขั้นนี้ขั้นเดียวแล้วกดจัดได้เลย', [['+ เพิ่มการสอน', 'add', true], ['วางภาระสอน…', 'paste']]))}</tbody></table></div>
    ${loadBar(d, ao)}
    ${summary()}`;
  el.querySelector('#flt').addEventListener('change', (e) => { filterClass = e.target.value; render(root); });
  el.querySelector('[data-only-none]')?.addEventListener('click', () => { onlyNoTeacher = !onlyNoTeacher; render(root); });
  el.querySelector('[data-go-board]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tt:goto', { detail: { tab: 'board' } })));
  el.querySelector('[data-go-teachers]')?.addEventListener('click', () => { section = 'teachers'; render(root); });
  el.querySelector('[data-paste]').addEventListener('click', () => openPaste('workload'));
  el.querySelector('[data-auto]')?.addEventListener('click', () => runAutoAssign());
  el.querySelector('[data-opt-core]')?.addEventListener('change', (e) => { userOpts.homeroomTeachesCore = e.target.checked; render(root); });
  el.querySelector('[data-opt-max]')?.addEventListener('change', (e) => {
    const n = Math.trunc(Number(e.target.value));
    if (n >= 1 && n <= 60) userOpts.maxPerWeek = n; else delete userOpts.maxPerWeek;
    render(root);
  });
  el.querySelector('[data-add]').addEventListener('click', () => {
    if (!ready) { notify.warn('เพิ่มห้องเรียนและวิชาอย่างน้อยอย่างละ 1 รายการก่อน (ครูเลือกทีหลังได้)'); return; }
    const g = guessNew(d, filterClass || d.classes[0].id, assignOpts());
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

// ---------- เติมครูอัตโนมัติ (ตรรกะอยู่ใน rules.autoAssign) ----------
/** แถบเหนือตาราง: ปุ่มเติม + สวิตช์ครูประจำชั้น + เพดานคาบ · แสดงเมื่อมีแถวที่ยังไม่มีครู */
function autoBar(d, n, ao) {
  if (!n) return '';
  if (!d.teachers.length) {
    return `<div class="auto-bar"><span><b>ยังไม่มีครู ${n} แถว</b> — เพิ่มรายชื่อครูก่อน แล้วกลับมากด “เติมครูอัตโนมัติ”</span>
      <button class="btn btn-sm" data-go-teachers>ไปที่ ครู →</button></div>`;
  }
  const hasInfo = d.teachers.some((t) => (Array.isArray(t.subjects) && t.subjects.length) || t.homeroom);
  return `<div class="auto-bar" role="group" aria-label="เติมครูอัตโนมัติ">
      <button class="btn btn-sm btn-primary" data-auto>เติมครูอัตโนมัติ (${n} แถว)</button>
      <label><input type="checkbox" data-opt-core ${ao.homeroomTeachesCore ? 'checked' : ''}> ครูประจำชั้นสอนวิชาหลักเอง</label>
      <label>เพดาน <input class="input input-sm" type="number" min="1" max="60" data-opt-max value="${ao.maxPerWeek}" aria-label="เพดานคาบต่อสัปดาห์ของครูแต่ละคน"> คาบ/สัปดาห์/คน</label>
      <span class="hint">${hasInfo
        ? 'เติมเฉพาะแถวที่ยังไม่มีครู ไม่ทับครูที่เลือกไว้: ครูคนเดียวกับห้องอื่นในชั้น → ครูตรงกลุ่มสาระที่ภาระน้อยสุด → ครูประจำชั้น'
        : 'ครูยังไม่มีใครระบุกลุ่มสาระหรือประจำชั้น ระบบจะเดาได้น้อย — ระบุที่ <button type="button" class="btn btn-sm" data-go-teachers>ข้อมูล → ครู</button> ก่อนจะเติมได้มากขึ้น'}</span>
    </div>`;
}

function runAutoAssign() {
  const d = store.doc;
  const r = autoAssign(d, assignOpts());
  if (!r.changes.length) {
    notify.warn(`ยังหาครูให้ไม่ได้สักแถว (${r.unresolved.length} แถว) — ระบุกลุ่มสาระ/ประจำชั้นของครูที่ ข้อมูล → ครู หรือเพิ่มเพดานคาบ แล้วลองอีกครั้ง`, 8000);
    return;
  }
  const n = applyAssign(d, r.changes);
  store.commit('autoassign'); // แท็บนี้วาดใหม่เองผ่าน onChange
  const left = d.assignments.filter(noTch).length;
  notify.action(`เติมครู ${n} แถว${left ? ` · เหลือ ${left} แถวยังไม่มีครู` : ' · ครบทุกแถวแล้ว'}`, 'เลิกทำ', () => {
    if (store.doc !== d) return; // เปลี่ยนภาคเรียนไปแล้ว
    const k = undoAssign(d, r.changes);
    store.commit('undo');
    notify.ok(`คืนค่าแล้ว ${k} แถว`);
  }, 10000);
}

/** แถบภาระครูใต้ตาราง: คาบ/สัปดาห์ของแต่ละคนเทียบเพดาน (เกิน = สีส้ม) */
function loadBar(d, ao) {
  if (!d.teachers.length || !d.assignments.length) return '';
  const load = teacherLoad(d);
  let over = 0;
  const rows = d.teachers.map((t) => {
    const n = load.get(t.id) || 0, cap = capOf(t, ao);
    if (n > cap) over++;
    return `<div class="load-row${n > cap ? ' over' : ''}" title="${esc(t.name)} ${n} / ${cap} คาบ/สัปดาห์${n > cap ? ' (เกินเพดาน)' : ''}">
      <span>${esc(t.short || t.name)}</span><span class="bar"><i style="width:${Math.min(100, Math.round((n / cap) * 100))}%"></i></span><b>${n}/${cap}</b></div>`;
  }).join('');
  // โรงเรียนใหญ่ยุบไว้ (40 ครูบนมือถือยาวมาก) ยกเว้นมีคนเกินเพดาน
  return `<details class="load-box"${over || d.teachers.length <= 12 ? ' open' : ''}><summary><b>ภาระครู</b> คาบ/สัปดาห์ · เพดาน ${ao.maxPerWeek}${over ? ` · <span class="pill todo">เกินเพดาน ${over} คน</span>` : ''}</summary>
    <div class="load-grid">${rows}</div></details>`;
}

// ---------- วางรายชื่อ (ตัวแยกข้อความอยู่ใน import.js โหลดเมื่อกดครั้งแรก) ----------
const PASTE = {
  teachers: { title: 'วางรายชื่อครู', unit: 'คน', hint: 'คัดลอกจาก Excel, Google Sheets, LINE หรือ Word แล้ววางได้เลย · 1 บรรทัด = ครู 1 คน · ใส่คอลัมน์ กลุ่มสาระ และ ประจำชั้น ด้วยก็ได้ (คำนำหน้า นาย/นาง/ครู ตัดให้เอง)' },
  subjects: { title: 'วางรายชื่อวิชา', unit: 'วิชา', hint: 'รูปแบบ รหัส | ชื่อวิชา | คาบ/สัปดาห์ · ไม่ใส่คาบ = ใช้ตามหลักสูตรถ้ารหัสตรง · รหัสที่มีอยู่แล้วจะข้ามให้' },
  workload: { title: 'วางภาระสอน', unit: 'แถว', hint: 'รูปแบบ ครู | วิชา | ห้อง | คาบ (| คาบคู่) · ห้องเขียน “ม.1 ทุกห้อง” หรือ “ม.1/1-3” ได้ · ครูที่ยังไม่มีในระบบติ๊กให้สร้างพร้อมกันได้' },
};
const drafts = {}; // ข้อความที่วางไว้ล่าสุดของแต่ละแบบ (ปิดกล่องแล้วเปิดใหม่ไม่ต้องวางซ้ำ) — อยู่ในหน่วยความจำเท่านั้น

async function openPaste(kind) {
  let imp;
  try { imp = await import('./import.js'); } catch { notify.error('โหลดตัวช่วยวางรายชื่อไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง'); return; }
  const d = store.doc, cfg = PASTE[kind];
  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg imp-dlg';
  dlg.setAttribute('aria-label', cfg.title);
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  let res = null; // ผลของ parseXxx ที่ผู้ใช้กำลังแก้ในพรีวิว
  const existing = new Map(d.assignments.map((a) => [a.subjectId + '|' + a.classId, a]));

  const pasteStep = () => {
    dlg.innerHTML = `<div style="display:grid;gap:12px">
      <h3 style="font-size:1.1rem">${cfg.title}</h3>
      <p class="hint" style="margin:0">${cfg.hint}</p>
      <textarea class="input" data-text rows="9" spellcheck="false" aria-label="ข้อความที่จะวาง" placeholder="วางข้อความที่นี่ (กด Ctrl+V หรือแตะค้างแล้วเลือก วาง)">${esc(drafts[kind] || '')}</textarea>
      <pre class="imp-ex" data-ex hidden></pre>
      <p class="hint" data-msg role="alert" style="margin:0;color:var(--danger)"></p>
      <div class="imp-acts">
        <button type="button" class="btn btn-sm" data-example aria-expanded="false">ตัวอย่างรูปแบบ</button><span class="spacer"></span>
        <button type="button" class="btn" data-close>ยกเลิก</button>
        <button type="button" class="btn btn-primary" data-next>ตรวจก่อนเพิ่ม →</button></div></div>`;
    const ta = dlg.querySelector('[data-text]');
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-example]').addEventListener('click', (e) => {
      const ex = dlg.querySelector('[data-ex]');
      ex.textContent = imp.EXAMPLES[kind].replace(/\t/g, '  |  ');
      ex.hidden = !ex.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!ex.hidden));
      if (!ta.value.trim()) ta.value = imp.EXAMPLES[kind]; // ช่องว่าง → ใส่ตัวอย่างให้ลองกดต่อได้เลย
    });
    dlg.querySelector('[data-next]').addEventListener('click', () => {
      const text = ta.value;
      drafts[kind] = text;
      const msg = dlg.querySelector('[data-msg]');
      if (!text.trim()) { msg.textContent = 'ยังไม่ได้วางข้อความ'; ta.focus(); return; }
      res = kind === 'teachers' ? imp.parseTeachers(text, d) : kind === 'subjects' ? imp.parseSubjects(text, d, store.curriculum) : imp.parseWorkload(text, d);
      if (!res.rows.length) { msg.textContent = 'อ่านรายการจากข้อความนี้ไม่ได้ ลองกด “ตัวอย่างรูปแบบ” ดูรูปแบบที่อ่านได้'; return; }
      previewStep();
    });
    ta.focus();
  };

  // ---------- พรีวิว ----------
  const nt = (key) => res.newTeachers?.find((t) => t.key === key);
  const complete = (r) => !!(r.subjectId && r.classId && (r.teacherId || r.newTeacher));
  const willAdd = (r) => {
    if (kind === 'teachers') return r.include && !!r.name.trim();
    if (kind === 'subjects') return r.include && !!(r.name.trim() || r.code.trim());
    const teacherOk = !!r.teacherId || !!nt(r.newTeacher)?.include;
    if (r.status === 'dup') return r.action === 'merge' && typeof r.dupOf === 'string' && teacherOk;
    return r.include && complete(r) && teacherOk;
  };
  const needsFix = (r) => (r.status !== 'new' && r.status !== 'ok') || r.issues.length > 0;
  const issues = (r) => (r.issues.length ? r.issues.map((x) => `<span class="imp-issue">${esc(x)}</span>`).join('') : '');
  const nameOf = (list, id) => esc(list.find((x) => x.id === id)?.name || '');
  const subjOpts = d.subjects.map((s) => ({ id: s.id, name: (s.code ? s.code + ' ' : '') + s.name }));
  const teacherSel = (r, i) => `<select class="input" data-r="${i}" data-k="teacher" aria-label="ครู">
      <option value="">— เลือกครู —</option>${d.teachers.map((t) => `<option value="${esc(t.id)}" ${t.id === r.teacherId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      ${(res.newTeachers || []).map((t) => `<option value="new:${esc(t.key)}" ${t.key === r.newTeacher ? 'selected' : ''}>${esc(t.name)} (ใหม่)</option>`).join('')}</select>`;

  const rowHTML = (r, i) => {
    const fix = needsFix(r) ? ' class="fix"' : '';
    const chk = (dis) => `<input type="checkbox" data-r="${i}" data-k="include" ${r.include ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="เพิ่มแถวนี้">`;
    if (kind === 'teachers') {
      return `<tr${fix} data-row="${i}"><td>${chk(r.status === 'unresolved' && !r.name)}</td>
        <td><input class="input" data-r="${i}" data-k="name" value="${esc(r.name)}" aria-label="ชื่อครู"></td>
        <td><input class="input" data-r="${i}" data-k="short" value="${esc(r.short)}" aria-label="ชื่อย่อ" style="width:110px"></td>
        <td><div class="tchips">${r.subjects.map((g) => `<span class="tchip">${esc(GROUP_SHORT[g] || g)}</span>`).join('') || '<span class="muted">—</span>'}</div></td>
        <td><select class="input" data-r="${i}" data-k="homeroom" aria-label="ประจำชั้น">${opt(d.classes, r.homeroom, '— ไม่มี —')}</select>${r.homeroomText && !r.homeroom ? `<span class="imp-issue">เขียนไว้: ${esc(r.homeroomText)}</span>` : ''}</td>
        <td>${issues(r)}</td></tr>`;
    }
    if (kind === 'subjects') {
      return `<tr${fix} data-row="${i}"><td>${chk(false)}</td>
        <td><input class="input mono" data-r="${i}" data-k="code" value="${esc(r.code)}" aria-label="รหัสวิชา" style="width:110px"></td>
        <td><input class="input" data-r="${i}" data-k="name" value="${esc(r.name)}" aria-label="ชื่อวิชา"></td>
        <td><input class="input" type="number" min="1" max="40" data-r="${i}" data-k="perWeek" value="${r.perWeek}" aria-label="คาบต่อสัปดาห์"></td>
        <td>${issues(r)}</td></tr>`;
    }
    // ภาระสอน: แถวที่ต้องแก้ใช้ select · แถวที่จับคู่ได้แล้วแสดงเป็นข้อความ (250 แถว × select ครู/วิชา/ห้อง หนักเกินบนมือถือ)
    const sel = needsFix(r);
    const tCell = sel ? teacherSel(r, i) : r.teacherId ? nameOf(d.teachers, r.teacherId) : `${esc(nt(r.newTeacher)?.name || '')} <span class="tchip">ใหม่</span>`;
    const sCell = sel ? `<select class="input" data-r="${i}" data-k="subjectId" aria-label="วิชา">${opt(subjOpts, r.subjectId, '— เลือกวิชา —')}</select>` : nameOf(subjOpts, r.subjectId);
    const cCell = sel ? `<select class="input" data-r="${i}" data-k="classId" aria-label="ห้องเรียน">${opt(d.classes, r.classId, '— เลือกห้อง —')}</select>` : nameOf(d.classes, r.classId);
    const first = r.status === 'dup'
      ? `<select class="input" data-r="${i}" data-k="action" aria-label="แถวซ้ำ" style="min-width:120px"><option value="skip" ${r.action !== 'merge' ? 'selected' : ''}>ข้าม</option>${typeof r.dupOf === 'string' ? `<option value="merge" ${r.action === 'merge' ? 'selected' : ''}>แทนแถวเดิม</option>` : ''}</select>`
      : chk(!complete(r));
    const raw = sel && r.raw ? `<span class="imp-issue">วางมา: ${esc([r.raw.teacher, r.raw.subject, r.raw.class].filter(Boolean).join(' | '))}</span>` : '';
    return `<tr${fix} data-row="${i}"><td>${first}</td><td>${tCell}</td><td>${sCell}</td><td>${cCell}</td>
      <td><input class="input" type="number" min="1" max="40" data-r="${i}" data-k="perWeek" value="${r.perWeek}" aria-label="คาบต่อสัปดาห์"></td>
      <td><input class="input" type="number" min="0" max="20" data-r="${i}" data-k="doubles" value="${r.doubles}" aria-label="คาบคู่"></td>
      <td>${issues(r)}${raw}</td></tr>`;
  };
  const HEAD = {
    teachers: '<th></th><th>ชื่อครู</th><th>ชื่อย่อ</th><th>กลุ่มสาระ</th><th>ประจำชั้น</th><th>ต้องตรวจ</th>',
    subjects: '<th></th><th>รหัส</th><th>ชื่อวิชา</th><th>คาบ/สัปดาห์</th><th>ต้องตรวจ</th>',
    workload: '<th></th><th>ครู</th><th>วิชา</th><th>ห้อง</th><th>คาบ</th><th>คู่</th><th>ต้องตรวจ</th>',
  };

  const counts = () => {
    const add = res.rows.filter(willAdd).length, fix = res.rows.filter(needsFix).length;
    const nNew = kind === 'workload' ? (res.newTeachers || []).filter((t) => t.include && res.rows.some((r) => r.newTeacher === t.key && willAdd(r))).length : 0;
    dlg.querySelector('[data-sum]').innerHTML = `อ่านได้ <b>${res.rows.length}</b> แถว · จะเพิ่ม <b>${add}</b> ${cfg.unit}${nNew ? ` · สร้างครูใหม่ <b>${nNew}</b> คน` : ''}${fix ? ` · <span class="pill todo">ต้องตรวจ ${fix} แถว</span>` : ''}`;
    const ok = dlg.querySelector('[data-ok]');
    ok.textContent = add ? `เพิ่ม ${add} ${cfg.unit}` : 'ไม่มีรายการที่จะเพิ่ม';
    ok.disabled = !add;
  };

  const previewStep = () => {
    const nts = res.newTeachers || [];
    dlg.innerHTML = `<div style="display:grid;gap:12px">
      <h3 style="font-size:1.1rem">ตรวจก่อนเพิ่ม · ${cfg.title}</h3>
      <p class="hint" style="margin:0">แถว<b>พื้นสีส้ม</b> = ต้องตรวจ แก้ในช่องได้เลย · เอาติ๊กออก = ไม่เพิ่มแถวนั้น · ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดปุ่มเพิ่ม</p>
      ${nts.length ? `<div class="field"><label>ครูที่ยังไม่มีในระบบ ${nts.length} คน — ติ๊กเพื่อสร้างให้พร้อมกัน</label>
        <div class="cur-levels">${nts.map((t, j) => `<label><input type="checkbox" data-nt="${j}" ${t.include ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div></div>` : ''}
      <div class="cur-list"><table class="table imp-table"><thead><tr>${HEAD[kind]}</tr></thead><tbody>${res.rows.map(rowHTML).join('')}</tbody></table></div>
      <p class="hint" data-sum style="margin:0" aria-live="polite"></p>
      <div class="imp-acts">
        <button type="button" class="btn btn-sm" data-back>← แก้ข้อความ</button><span class="spacer"></span>
        <button type="button" class="btn" data-close>ยกเลิก</button>
        <button type="button" class="btn btn-primary" data-ok></button></div></div>`;
    counts();
    dlg.querySelector('[data-back]').addEventListener('click', pasteStep);
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-ok]').addEventListener('click', () => {
      // ครูใหม่ที่ไม่มีแถวไหนได้เพิ่มจริง (แถวถูกข้าม/ติ๊กออก) → ไม่สร้าง ให้ตรงกับตัวเลขที่บอกไว้
      for (const t of res.newTeachers || []) if (!res.rows.some((r) => r.newTeacher === t.key && willAdd(r))) t.include = false;
      const r = res;
      dlg.close();
      commitImport(imp, kind, d, r);
    });
    dlg.querySelector('[data-ok]').focus();
  };

  // แถวภาระสอนที่แก้ครู/วิชา/ห้อง → ตรวจครบ/ซ้ำใหม่ (ซ้ำกับการสอนเดิม หรือกับแถวอื่นที่จะเพิ่ม)
  const recheck = (r) => {
    if (!complete(r)) { r.status = 'unresolved'; r.include = false; r.action = 'add'; r.dupOf = null; return; }
    const prev = existing.get(r.subjectId + '|' + r.classId);
    const twin = res.rows.findIndex((x) => x !== r && x.status === 'ok' && x.subjectId === r.subjectId && x.classId === r.classId);
    if (prev || twin >= 0) {
      if (r.status !== 'dup' || r.dupOf !== (prev ? prev.id : twin)) { r.status = 'dup'; r.include = false; r.action = 'skip'; r.dupOf = prev ? prev.id : twin; }
      r.issues = [prev ? 'ห้องนี้มีการสอนวิชานี้แล้ว' : 'ซ้ำกับแถวอื่นในรายการ'];
    } else { r.status = 'ok'; r.include = true; r.action = 'add'; r.dupOf = null; r.issues = []; }
  };

  // ตัวจับเดียวทั้งกล่อง (แถวถูกวาดใหม่ทีละแถว ไม่ต้องผูกปุ่มใหม่)
  dlg.addEventListener('change', (e) => {
    const x = e.target;
    if (!res) return;
    if (x.dataset.nt != null) { const t = res.newTeachers[+x.dataset.nt]; if (t) t.include = x.checked; counts(); return; }
    if (x.dataset.r == null) return;
    const i = +x.dataset.r, r = res.rows[i], k = x.dataset.k;
    if (!r) return;
    let redraw = false;
    if (k === 'include') r.include = x.checked;
    else if (k === 'perWeek') r.perWeek = Math.max(1, Math.min(40, Math.trunc(Number(x.value)) || 1));
    else if (k === 'doubles') r.doubles = Math.max(0, Math.min(Math.floor(r.perWeek / 2), Math.trunc(Number(x.value)) || 0));
    else if (k === 'action') r.action = x.value === 'merge' ? 'merge' : 'skip';
    else if (k === 'homeroom') { r.homeroom = x.value || null; r.issues = r.issues.filter((s) => !/ห้อง|ประจำชั้น/.test(s)); redraw = true; }
    else if (k === 'name' || k === 'short' || k === 'code') {
      r[k] = x.value.trim();
      if (r.status === 'unresolved' && (r.name || r.code)) { r.status = 'new'; r.include = true; r.issues = []; redraw = true; }
    } else if (k === 'teacher') {
      if (x.value.startsWith('new:')) { r.newTeacher = x.value.slice(4); r.teacherId = null; } else { r.teacherId = x.value || null; r.newTeacher = null; }
      recheck(r); redraw = true;
    } else if (k === 'subjectId' || k === 'classId') { r[k] = x.value || null; recheck(r); redraw = true; }
    if (redraw) {
      const tr = dlg.querySelector(`tr[data-row="${i}"]`);
      if (tr) {
        tr.outerHTML = rowHTML(r, i);
        dlg.querySelector(`tr[data-row="${i}"] [data-k="${k}"]`)?.focus(); // คืนโฟกัสช่องเดิม (คีย์บอร์ด/โปรแกรมอ่านจอ)
      }
    }
    counts();
  });

  pasteStep();
  dlg.showModal();
}

/** ยืนยันการวาง: แก้เอกสารครั้งเดียว → commit('import') ครั้งเดียว → toast เลิกทำ 10 วินาที */
function commitImport(imp, kind, d, res) {
  if (store.doc !== d) { notify.warn('เปลี่ยนภาคเรียนไปแล้ว ลองวางใหม่อีกครั้ง'); return; }
  let out, msg;
  const dropped = [];
  if (kind === 'teachers') {
    out = imp.applyTeachers(d, res.rows);
    msg = `เพิ่มครู ${out.teachers.length} คน`;
  } else if (kind === 'subjects') {
    out = imp.applySubjects(d, res.rows);
    msg = `เพิ่มวิชา ${out.subjects.length} วิชา`;
  } else {
    out = imp.applyWorkload(d, res);
    // แทนแถวเดิมแล้วครูเปลี่ยน → คาบที่วางไว้ของแถวนั้นไม่ใช่ครูคนนี้แล้ว เอาออก (เหมือนเปลี่ยนครูในตาราง) เก็บไว้คืนตอนเลิกทำ
    const moved = new Set(out.changed.filter((c) => d.assignments.find((a) => a.id === c.id)?.teacherId !== c.before.teacherId).map((c) => c.id));
    if (moved.size) d.placements = d.placements.filter((p) => (moved.has(p.assignmentId) ? (dropped.push(p), false) : true));
    msg = [`เพิ่มการสอน ${out.assignments.length} แถว`, out.teachers.length ? `ครูใหม่ ${out.teachers.length} คน` : '', out.changed.length ? `แทนแถวเดิม ${out.changed.length} แถว` : ''].filter(Boolean).join(' · ');
  }
  const n = (out.teachers?.length || 0) + (out.subjects?.length || 0) + (out.assignments?.length || 0) + (out.changed?.length || 0);
  if (!n) { notify.info('ไม่มีรายการที่เพิ่ม'); return; }
  store.commit('import'); // แท็บนี้วาดใหม่เองผ่าน onChange
  notify.action(msg, 'เลิกทำ', () => {
    if (store.doc !== d) return;
    imp.undoImport(d, out);
    const gone = new Set(out.assignments || []);
    if (gone.size) d.placements = d.placements.filter((p) => !gone.has(p.assignmentId)); // จัดตารางไปก่อนกดเลิกทำ
    d.placements.push(...dropped);
    store.commit('undo');
    notify.ok('เลิกทำการวางรายชื่อแล้ว');
  }, 10000);
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
