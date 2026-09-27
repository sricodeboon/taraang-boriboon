// แท็บโครงคาบ · คาบล็อก · จัดการภาคเรียน
import { store, DAY_NAMES, esc } from './store.js';
import { toast } from './ui.js';

let lockClass = '';       // '' = ทุกห้อง
let lockLabel = 'กิจกรรม';
let root = null;
let actions = {};          // จาก app.js: newTerm, copyTerm, deleteTerm

export function setActions(a) { actions = a; }

export function render(el) {
  root = el;
  const d = store.doc, t = d.term;
  el.innerHTML = `<div class="two-col">
    <div class="card" style="padding:16px;display:grid;gap:14px">
      <div><h3 style="font-size:1.05rem">ภาคเรียนและโครงคาบ</h3>
        <p class="muted" style="margin:4px 0 0;font-size:.88rem">กำหนดจำนวนวัน คาบ เวลา และช่องพัก เปลี่ยนแล้วคาบในตารางที่อยู่นอกช่วงจะถูกนำออก</p></div>
      <div style="display:grid;grid-template-columns:1fr 140px;gap:10px">
        <div class="field"><label for="term-name">ชื่อภาคเรียน</label><input id="term-name" class="input" value="${esc(t.name)}"></div>
        <div class="field"><label for="term-days">วันเรียน</label>
          <select id="term-days" class="input">${[5, 6, 7].map((n) => `<option value="${n}" ${t.days === n ? 'selected' : ''}>${n} วัน (${DAY_NAMES[0]}–${DAY_NAMES[n - 1]})</option>`).join('')}</select></div>
      </div>
      <div class="scroll-x"><table class="table"><thead><tr><th>ชื่อคาบ</th><th>เริ่ม</th><th>จบ</th><th>ชนิด</th><th></th></tr></thead><tbody>
        ${t.periods.map((p, i) => `<tr>
          <td><input class="input" data-p="${i}" data-f="label" value="${esc(p.label)}" style="min-width:70px"></td>
          <td><input class="input mono" type="time" data-p="${i}" data-f="start" value="${esc(p.start || '')}"></td>
          <td><input class="input mono" type="time" data-p="${i}" data-f="end" value="${esc(p.end || '')}"></td>
          <td><select class="input" data-p="${i}" data-f="type"><option value="class" ${p.type !== 'break' ? 'selected' : ''}>คาบเรียน</option><option value="break" ${p.type === 'break' ? 'selected' : ''}>พัก</option></select></td>
          <td style="white-space:nowrap"><button class="btn btn-icon" data-up="${i}" aria-label="เลื่อนขึ้น" ${i ? '' : 'disabled'}>↑</button>
            <button class="btn btn-icon" data-ins="${i}" aria-label="แทรกคาบด้านล่าง">＋</button>
            <button class="btn btn-icon btn-danger" data-rm="${i}" aria-label="ลบคาบ">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="card" style="padding:16px;display:grid;gap:12px">
      <div><h3 style="font-size:1.05rem">คาบล็อก</h3>
        <p class="muted" style="margin:4px 0 0;font-size:.88rem">คาบที่ห้ามจัดวิชา เช่น ลูกเสือ ชุมนุม แนะแนว กิจกรรมหน้าเสาธง เลือกห้อง พิมพ์ชื่อกิจกรรม แล้วคลิกช่องเพื่อล็อกหรือปลดล็อก</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <select id="lock-class" class="input input-sm"><option value="">ทุกห้องเรียน</option>${d.classes.map((c) => `<option value="${esc(c.id)}" ${c.id === lockClass ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <input id="lock-label" class="input input-sm" value="${esc(lockLabel)}" placeholder="ชื่อกิจกรรม" style="max-width:200px">
      </div>
      <div class="scroll-x"><table class="tt lock-grid" style="min-width:0"><thead><tr><th>คาบ</th>${[...Array(t.days).keys()].map((i) => `<th>${DAY_NAMES[i].slice(0, 3)}</th>`).join('')}</tr></thead><tbody>
        ${t.periods.map((p, pi) => p.type === 'break'
          ? `<tr class="brk"><th>${esc(p.label)}</th><td colspan="${t.days}">${esc(p.label)}</td></tr>`
          : `<tr><th>${esc(p.label)}</th>${[...Array(t.days).keys()].map((day) => {
              const lk = d.locks.find((l) => l.day === day && l.period === pi && (l.classId ?? '') === lockClass);
              const inherited = lockClass && d.locks.find((l) => l.day === day && l.period === pi && l.classId == null);
              return `<td class="${lk || inherited ? 'lock' : ''}" data-ld="${day}" data-lp="${pi}" title="${inherited ? 'ล็อกทุกห้อง: ' + esc(inherited.label) : ''}">${lk ? '🔒 ' + esc(lk.label) : inherited ? '🔒 ' + esc(inherited.label) : ''}</td>`;
            }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <p class="hint" style="margin:0">ล็อกไว้ ${d.locks.length} ช่อง · ล็อกแบบ “ทุกห้อง” จะมีผลกับทุกห้องเรียน</p>
    </div>
  </div>

  <div class="card" style="padding:16px;margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <b style="margin-right:auto">จัดการภาคเรียน</b>
    <button class="btn btn-sm" id="t-new">＋ ภาคเรียนใหม่</button>
    <button class="btn btn-sm" id="t-copy">ทำสำเนาภาคเรียนนี้</button>
    <button class="btn btn-sm btn-danger" id="t-del">ลบภาคเรียนนี้</button>
  </div>`;

  el.querySelector('#term-name').addEventListener('change', (e) => { t.name = e.target.value.trim() || 'ภาคเรียน'; store.commit('term'); });
  el.querySelector('#term-days').addEventListener('change', (e) => {
    const n = +e.target.value;
    const out = d.placements.filter((p) => p.day >= n).length;
    if (out && !confirm(`มี ${out} คาบในวันที่จะถูกตัดออก ยืนยันไหม`)) { e.target.value = t.days; return; }
    t.days = n;
    d.placements = d.placements.filter((p) => p.day < n);
    d.locks = d.locks.filter((l) => l.day < n);
    for (const te of d.teachers) te.unavailable = (te.unavailable || []).filter(([x]) => x < n);
    store.commit('term'); render(root);
  });
  el.querySelectorAll('[data-f][data-p]').forEach((inp) => inp.addEventListener('change', () => {
    const p = t.periods[+inp.dataset.p];
    p[inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'type' && inp.value === 'break') {
      const i = +inp.dataset.p;
      d.placements = d.placements.filter((x) => x.period !== i);
      d.locks = d.locks.filter((x) => x.period !== i);
    }
    store.commit('term'); render(root);
  }));
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    if (t.periods.length <= 1) return;
    const i = +b.dataset.rm;
    const n = d.placements.filter((p) => p.period === i).length;
    if (n && !confirm(`คาบนี้มีวิชาจัดอยู่ ${n} คาบ ลบแล้วจะถูกนำออก ยืนยันไหม`)) return;
    t.periods.splice(i, 1);
    shift(i, -1);
    store.commit('term'); render(root);
  }));
  el.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.ins;
    const prev = t.periods[i];
    t.periods.splice(i + 1, 0, { label: String(t.periods.filter((p) => p.type !== 'break').length + 1), start: prev?.end || '', end: '', type: 'class' });
    shift(i + 1, +1);
    store.commit('term'); render(root);
  }));
  el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.up;
    if (!i) return;
    [t.periods[i - 1], t.periods[i]] = [t.periods[i], t.periods[i - 1]];
    const swap = (x) => (x === i ? i - 1 : x === i - 1 ? i : x);
    for (const p of d.placements) p.period = swap(p.period);
    for (const l of d.locks) l.period = swap(l.period);
    for (const te of d.teachers) te.unavailable = (te.unavailable || []).map(([x, y]) => [x, swap(y)]);
    store.commit('term'); render(root);
  }));

  el.querySelector('#lock-class').addEventListener('change', (e) => { lockClass = e.target.value; render(root); });
  el.querySelector('#lock-label').addEventListener('input', (e) => { lockLabel = e.target.value; });
  el.querySelectorAll('td[data-ld]').forEach((td) => td.addEventListener('click', () => {
    const day = +td.dataset.ld, period = +td.dataset.lp;
    const cls = lockClass || null;
    const k = d.locks.findIndex((l) => l.day === day && l.period === period && (l.classId ?? null) === cls);
    if (k >= 0) d.locks.splice(k, 1);
    else {
      d.locks.push({ classId: cls, day, period, label: lockLabel.trim() || 'กิจกรรม' });
      const hit = d.placements.filter((p) => p.day === day && p.period === period && (!cls || store.doc.assignments.find((a) => a.id === p.assignmentId)?.classId === cls));
      if (hit.length) toast(`มี ${hit.length} คาบวางทับช่องนี้อยู่ ย้ายออกได้ที่แท็บจัดตาราง`);
    }
    store.commit('lock'); render(root);
  }));

  el.querySelector('#t-new').addEventListener('click', () => actions.newTerm?.());
  el.querySelector('#t-copy').addEventListener('click', () => actions.copyTerm?.());
  el.querySelector('#t-del').addEventListener('click', () => actions.deleteTerm?.());
}

/** เลื่อนเลขคาบของ placements/locks/unavailable เมื่อแทรก (+1) หรือลบ (-1) คาบที่ index i */
function shift(i, dir) {
  const d = store.doc;
  if (dir < 0) {
    d.placements = d.placements.filter((p) => p.period !== i);
    d.locks = d.locks.filter((l) => l.period !== i);
    for (const t of d.teachers) t.unavailable = (t.unavailable || []).filter(([, y]) => y !== i);
  }
  const f = (x) => (x > i || (dir > 0 && x >= i) ? x + dir : x);
  for (const p of d.placements) p.period = f(p.period);
  for (const l of d.locks) l.period = f(l.period);
  for (const t of d.teachers) t.unavailable = (t.unavailable || []).map(([x, y]) => [x, f(y)]);
}
