// ตัวควบคุมหลัก: โหลด/บันทึกภาคเรียน, แท็บ, สถานะบันทึก
import { store, index } from './store.js';
import { toast } from './ui.js';
import * as board from './board.js';
import * as data from './data.js';
import * as periods from './periods.js';
import * as exporter from './export.js';

const TABS = { board, data, periods, export: exporter };
let tab = sessionGet('tab') || 'board';
let terms = [];
let saveTimer = null, saving = false, dirty = false;

const $ = (s) => document.querySelector(s);
const saveState = (text, cls = '') => { const el = $('#save-state'); el.textContent = text; el.className = 'pill ' + cls; };

async function api(r, body, query = {}, retried = false) {
  const qs = new URLSearchParams({ r, ...query });
  const res = await fetch('api.php?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': window.TT.csrf, Accept: 'application/json' } : { Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let j = null;
  try { j = await res.json(); } catch { /* ไม่ใช่ JSON */ }
  // token เปลี่ยน (ออก/เข้าระบบจากแท็บอื่น) แต่ยังอยู่ในระบบ → ขอ token ใหม่แล้วลองซ้ำครั้งเดียว
  if (res.status === 419 && body && !retried) { await refreshCsrf(); return api(r, body, query, true); }
  if (!res.ok) { const err = new Error(j?.error || `เกิดข้อผิดพลาด (${res.status})`); err.status = res.status; err.body = j; throw err; }
  return j;
}

export async function refreshCsrf() {
  const me = await api('me');
  window.TT.csrf = me.csrf;
}

function renderTab() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const k of Object.keys(TABS)) $('#tab-' + k).hidden = k !== tab;
  if (store.doc) TABS[tab].render($('#tab-' + tab));
}

function renderTermSelect() {
  const sel = $('#term-select');
  sel.innerHTML = terms.map((t) => `<option value="${t.id}" ${+t.id === store.termId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')
    + '<option value="__new">＋ สร้างภาคเรียนใหม่…</option>';
}

async function loadTerm(id) {
  saveState('กำลังโหลด…');
  // ครั้งแรก: ใช้ข้อมูลที่ app.php ฝังมา (ถ้าตรงกับภาคเรียนที่ต้องการ) ไม่ต้องเรียก API
  const boot = window.TT.boot?.term;
  if (window.TT.boot) window.TT.boot.term = null;
  const t = boot && +boot.id === +id ? boot : await api('term', undefined, { id });
  store.termId = t.id; store.version = t.version; store.doc = t.data;
  index();
  sessionSet('term', t.id);
  renderTermSelect();
  renderTab();
  saveState('บันทึกแล้ว', 'ok');
}

async function refreshTerms(selectId) {
  if (window.TT.boot?.terms) { terms = window.TT.boot.terms; window.TT.boot.terms = null; }
  else {
    const me = await api('me');
    window.TT.csrf = me.csrf;
    terms = me.terms;
  }
  const want = selectId || +sessionGet('term') || terms[0]?.id;
  await loadTerm(terms.some((t) => +t.id === +want) ? want : terms[0].id);
}

// ---------- บันทึกอัตโนมัติ ----------
store.onChange(() => {
  dirty = true;
  saveState('ยังไม่บันทึก…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 900);
  TABS[tab].render($('#tab-' + tab));
});

async function save() {
  if (saving) { saveTimer = setTimeout(save, 400); return; }
  if (!dirty) return;
  saving = true; dirty = false;
  saveState('กำลังบันทึก…');
  try {
    const r = await api('term.save', { id: store.termId, version: store.version, data: store.doc });
    store.version = r.version;
    const t = terms.find((x) => +x.id === store.termId);
    if (t) { t.name = store.doc.term.name; renderTermSelect(); }
    saveState(dirty ? 'ยังไม่บันทึก…' : 'บันทึกแล้ว', dirty ? '' : 'ok');
  } catch (e) {
    dirty = true;
    if (e.status === 409) {
      saveState('ข้อมูลไม่ตรงกัน', 'warn');
      if (confirm('มีการแก้ไขภาคเรียนนี้จากเครื่องอื่น\nกด OK เพื่อโหลดข้อมูลล่าสุด (การแก้ไขล่าสุดของคุณจะหายไป)\nกด Cancel เพื่อบันทึกทับด้วยข้อมูลของคุณ')) {
        dirty = false; await loadTerm(store.termId);
      } else { store.version = e.body.version; saveTimer = setTimeout(save, 100); }
    } else if (e.status === 401 || e.status === 403) {
      saveState('หมดเวลาเข้าสู่ระบบ', 'warn');
      toast('หมดเวลาเข้าสู่ระบบ การแก้ไขล่าสุดยังไม่ถูกบันทึก กรุณาเข้าสู่ระบบใหม่', 8000);
    } else {
      saveState('บันทึกไม่สำเร็จ', 'warn'); toast(e.message + ' จะลองใหม่อัตโนมัติ');
      saveTimer = setTimeout(save, 5000);
    }
  } finally { saving = false; }
}

window.addEventListener('beforeunload', (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });

// ---------- จัดการภาคเรียน ----------
const NEW_TERM_KINDS = [
  ['blank:primary', 'ตารางว่าง + รายวิชาพื้นฐานประถม'], ['blank:lower', 'ตารางว่าง + รายวิชาพื้นฐาน ม.ต้น'],
  ['blank:upper', 'ตารางว่าง + รายวิชาพื้นฐาน ม.ปลาย'], ['blank:', 'ตารางว่าง (ไม่มีวิชา)'],
  ['sample-primary:', 'ข้อมูลตัวอย่างประถม'], ['sample:', 'ข้อมูลตัวอย่างมัธยม'],
];
async function newTerm() {
  renderTermSelect();
  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg';
  dlg.innerHTML = `<form method="dialog" style="display:grid;gap:12px">
    <h3 style="font-size:1.1rem">สร้างภาคเรียนใหม่</h3>
    <div class="field"><label for="nt-name">ชื่อภาคเรียน</label>
      <input class="input" id="nt-name" required maxlength="200" value="ภาคเรียนที่ 2/${new Date().getFullYear() + 543}"></div>
    <div class="field"><label for="nt-kind">เริ่มต้นด้วย</label>
      <select class="input" id="nt-kind">${NEW_TERM_KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
      <span class="hint">ถ้าจะใช้ครูและวิชาชุดเดิม ใช้ “ทำสำเนาภาคเรียนนี้” ในแท็บโครงคาบแทน</span></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" value="cancel" formnovalidate>ยกเลิก</button><button class="btn btn-primary" value="ok">สร้าง</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const ok = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
  const name = dlg.querySelector('#nt-name').value.trim();
  const [template, band] = dlg.querySelector('#nt-kind').value.split(':');
  dlg.remove();
  if (!ok || !name) return;
  try { const r = await api('term.create', { name, template, band: band || null }); await refreshTerms(r.id); toast('สร้างภาคเรียนแล้ว'); }
  catch (e) { toast(e.message); renderTermSelect(); }
}
async function copyTerm() {
  await flush();
  try { const r = await api('term.create', { template: 'copy', from: store.termId }); await refreshTerms(r.id); toast('ทำสำเนาแล้ว ข้อมูลครู วิชา และตารางถูกคัดลอกมาทั้งหมด'); }
  catch (e) { toast(e.message); }
}
async function deleteTerm() {
  if (!confirm(`ลบ “${store.doc.term.name}” ถาวร ยืนยันไหม`)) return;
  try { await api('term.delete', { id: store.termId }); sessionSet('term', ''); await refreshTerms(); toast('ลบภาคเรียนแล้ว'); }
  catch (e) { toast(e.message); }
}
async function flush() { clearTimeout(saveTimer); if (dirty) await save(); }
periods.setActions({ newTerm, copyTerm, deleteTerm });

// ---------- เริ่ม ----------
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; sessionSet('tab', tab); renderTab(); }));
$('#term-select').addEventListener('change', async (e) => {
  if (e.target.value === '__new') { await newTerm(); return; }
  await flush();
  await loadTerm(+e.target.value);
});

if (window.TT.flash) toast(window.TT.flash, 6000);
refreshTerms().catch((e) => { saveState('โหลดไม่สำเร็จ', 'warn'); toast(e.message); });

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sessionGet(k) { try { return sessionStorage.getItem('tt:' + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem('tt:' + k, v); } catch { /* ไม่เป็นไร */ } }
