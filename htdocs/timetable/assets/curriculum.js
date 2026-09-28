// เพิ่มวิชาจากรายวิชาพื้นฐานตามหลักสูตรแกนกลาง (data/curriculum.json) — เลือกชั้น ดูรายการ แล้วเพิ่มเฉพาะรหัสที่ยังไม่มี
import { store, uid, esc } from './store.js';
import * as notify from './notify.js';
import { hoursHint } from './rules.js';

let cache = null;
const load = () => (cache ??= fetch('data/curriculum.json').then((r) => { if (!r.ok) throw new Error('โหลดรายวิชาไม่สำเร็จ'); return r.json(); })
  .catch((e) => { cache = null; throw e; }));

export async function openCatalog(onDone) {
  let cur;
  try { cur = await load(); } catch (e) { notify.error(e.message); return; }
  const d = store.doc;
  const have = new Set(d.subjects.map((s) => (s.code || '').trim()).filter(Boolean));
  const classLevels = new Set(d.classes.map((c) => (c.level || '').trim()));
  let sem = /ภาคเรียนที่\s*2/.test(d.term.name || '') ? 2 : 1;
  // เริ่มด้วยชั้นที่โรงเรียนมีห้องเรียนอยู่แล้ว ถ้ายังไม่มีห้องเลยให้เลือกเอง
  const picked = new Set(cur.levels.filter((l) => classLevels.has(l.name)).map((l) => l.name));
  const off = new Set(); // รหัสที่ผู้ใช้เอาติ๊กออก

  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg';
  dlg.style.width = 'min(680px, calc(100vw - 32px))';
  document.body.appendChild(dlg);

  const levelsOf = () => cur.levels.filter((l) => picked.has(l.name) && (!l.sem || l.sem === sem));
  const draw = () => {
    const rows = levelsOf().flatMap((l) => l.subjects.map((s) => ({ ...s, level: l.name })));
    const addable = rows.filter((s) => !have.has(s.code) && !off.has(s.code));
    const names = [...new Set(cur.levels.map((l) => l.name))];
    dlg.innerHTML = `<form method="dialog" style="display:grid;gap:12px">
      <h3 style="font-size:1.1rem">เพิ่มวิชาจากหลักสูตรแกนกลาง</h3>
      <p class="hint" style="margin:0">${esc(cur.note)}</p>
      <div class="field"><label>เลือกชั้น</label>
        <div class="cur-levels">${names.map((n) => `<label><input type="checkbox" data-lv="${esc(n)}" ${picked.has(n) ? 'checked' : ''}>${esc(n)}</label>`).join('')}</div></div>
      <div class="field"><label>ภาคเรียนของวิชามัธยม</label>
        <div class="cur-levels">${[1, 2].map((n) => `<label><input type="radio" name="sem" value="${n}" ${n === sem ? 'checked' : ''}>ภาคเรียนที่ ${n}</label>`).join('')}</div></div>
      <div class="cur-list">${rows.length ? `<table class="table"><thead><tr><th></th><th>ชั้น</th><th>รหัส</th><th>ชื่อวิชา</th><th>คาบ/สัปดาห์</th></tr></thead><tbody>
        ${rows.map((s) => have.has(s.code)
          ? `<tr class="muted"><td></td><td>${esc(s.level)}</td><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td><td>มีแล้ว</td></tr>`
          : `<tr><td><input type="checkbox" data-code="${esc(s.code)}" ${off.has(s.code) ? '' : 'checked'}></td><td>${esc(s.level)}</td><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}${s.type === 'เพิ่มเติม' ? ' <span class="hint">(เพิ่มเติม)</span>' : ''}</td><td>${s.perWeek} <span class="hint">${esc(hoursHint(s.code, s.perWeek))}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="hint" style="padding:12px;margin:0">เลือกชั้นด้านบนก่อน</p>'}</div>
      <span class="hint">คาบ/สัปดาห์ตามโครงสร้างเวลาเรียน (ประถม 1 คาบ/สัปดาห์ = 40 ชม./ปี · มัธยม 2 คาบ/สัปดาห์ = 1 หน่วยกิต/ภาค) ติดไปกับวิชา ใช้เป็นค่าเริ่มต้นตอนเพิ่ม “การสอน” แก้ได้ที่ ข้อมูล → วิชา</span>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" value="cancel">ยกเลิก</button>
        <button class="btn btn-primary" value="ok" ${addable.length ? '' : 'disabled'}>เพิ่ม ${addable.length} วิชา</button></div>
    </form>`;
    dlg.querySelectorAll('[data-lv]').forEach((c) => c.addEventListener('change', () => { c.checked ? picked.add(c.dataset.lv) : picked.delete(c.dataset.lv); draw(); }));
    dlg.querySelectorAll('input[name=sem]').forEach((r) => r.addEventListener('change', () => { sem = +r.value; draw(); }));
    dlg.querySelectorAll('[data-code]').forEach((c) => c.addEventListener('change', () => { c.checked ? off.delete(c.dataset.code) : off.add(c.dataset.code); draw(); }));
  };
  draw();
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const add = levelsOf().flatMap((l) => l.subjects).filter((s) => !have.has(s.code) && !off.has(s.code));
      for (const s of add) { d.subjects.push({ id: uid('s'), code: s.code, name: s.name, color: s.color, perWeek: s.perWeek || null }); have.add(s.code); }
      if (add.length) { store.commit('data'); notify.ok(`เพิ่ม ${add.length} วิชาแล้ว พร้อมคาบ/สัปดาห์ตามหลักสูตร`); onDone?.(); }
    }
    dlg.remove();
  }, { once: true });
}
