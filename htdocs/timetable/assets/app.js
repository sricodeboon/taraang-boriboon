// ตัวควบคุมหลัก: โหลด/บันทึกภาคเรียน, แท็บ, สถานะบันทึก
import { store, index, merge3 } from './store.js';
import { toast } from './ui.js';
import * as board from './board.js';
import * as data from './data.js';
import * as periods from './periods.js';
import * as exporter from './export.js';

const TABS = { board, data, periods, export: exporter };
let tab = sessionGet('tab') || 'board';
let terms = [];

const $ = (s) => document.querySelector(s);
const saveState = (text, cls = '') => { const el = $('#save-state'); el.textContent = text; el.className = 'pill ' + cls; };

/** body: อ็อบเจกต์ (แปลงเป็น JSON ให้) หรือสตริง JSON ที่เตรียมไว้แล้ว · keepalive: ส่งต่อได้แม้ปิดหน้า (จำกัด ~64KB) */
async function api(r, body, query = {}, retried = false, keepalive = false) {
  const qs = new URLSearchParams({ r, ...query });
  const res = await fetch('api.php?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': window.TT.csrf, Accept: 'application/json' } : { Accept: 'application/json' },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    credentials: 'same-origin',
    keepalive,
  });
  let j = null;
  try { j = await res.json(); } catch { /* ไม่ใช่ JSON */ }
  // token เปลี่ยน (ออก/เข้าระบบจากแท็บอื่น) แต่ยังอยู่ในระบบ → ขอ token ใหม่แล้วลองซ้ำครั้งเดียว
  if (res.status === 419 && body && !retried) { await refreshCsrf(); return api(r, body, query, true, keepalive); }
  if (!res.ok) { const err = new Error(j?.error || `เกิดข้อผิดพลาด (${res.status})`); err.status = res.status; err.body = j; throw err; }
  // โฮสต์ฟรีบางครั้งตอบหน้า HTML (หน้ากันบอต/เกินโควตา) ด้วยสถานะ 200 → ถือว่าล้มเหลว จะได้ลองใหม่ ไม่ใช่ทำเหมือนบันทึกสำเร็จ
  if (j === null) { const err = new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (อาจเกินโควตาชั่วคราว)'); err.status = res.status; throw err; }
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
  clearTimeout(saveTimer);
  store.termId = +t.id; store.version = t.version; store.doc = t.data;
  index();
  savedText = JSON.stringify(store.doc); // หลัง index() (sanitize) — ค่าที่ถูกจัดรูปใหม่ไม่นับเป็นการแก้ไข
  firstDirtyAt = 0;
  sessionSet('term', t.id);
  renderTermSelect();
  restoreDraft(t);
  renderTab();
  if (!isDirty()) saveState('บันทึกแล้ว', 'ok');
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
// โฮสต์ฟรีจำกัด ~50k hits/วัน: เดิมส่งทุก 0.9 วิหลังแก้ทุกช่อง (ผู้ใช้จริงคนแรก 442 ครั้งใน 1.5 ชม.)
// ตอนนี้: เก็บฉบับร่างในเครื่อง (localStorage) ทันทีทุกครั้งที่แก้ → ส่งขึ้นเซิร์ฟเวอร์เมื่อหยุดแก้ IDLE_MS
// และห่างจากครั้งก่อน ≥ MIN_GAP_MS (แต่ไม่ค้างเกิน MAX_WAIT_MS) · ไม่ส่งถ้าเนื้อหาไม่เปลี่ยน
// จำลองการกรอกข้อมูล 1.5–3 ชม.: เดิม 400–600 ครั้ง → ใหม่ ~70–180 ครั้ง (≈1 ครั้ง/นาทีที่แก้อยู่)
// · ซ่อนแท็บ/สลับแอป = ส่งทันที · ปิดหน้า = ส่งแบบ keepalive · ถ้าส่งไม่ทัน ฉบับร่างจะถูกกู้คืนตอนเปิดครั้งหน้า
const IDLE_MS = 3000, MIN_GAP_MS = 30000, MAX_WAIT_MS = 90000, KEEPALIVE_MAX = 60000; // KEEPALIVE_MAX นับเป็นไบต์ UTF-8 (เบราว์เซอร์จำกัด 64KB · ไทย 1 ตัว = 3 ไบต์)
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
const URGENT = new Set(['solve', 'import', 'clear']); // การเปลี่ยนแปลงก้อนใหญ่ ส่งเร็วโดยไม่รอ MIN_GAP
let saveTimer = null, savePromise = null, draftTimer = null;
let savedText = '';            // JSON ของเอกสารฉบับที่เซิร์ฟเวอร์มีแล้ว = ฐานสำหรับเทียบ "เปลี่ยนไหม" และรวมการแก้ไขเมื่อชน (409)
let firstDirtyAt = 0, lastChangeAt = 0, lastSaveAt = 0, urgent = false, retryMs = 0;

const isDirty = () => !!store.doc && JSON.stringify(store.doc) !== savedText;

store.onChange((reason) => {
  TABS[tab].render($('#tab-' + tab));
  if (!isDirty()) { if (!savePromise) markClean(store.termId); return; } // กดแล้วเนื้อหาเท่าเดิม (เช่น ล็อกแล้วปลด) ไม่ต้องส่ง
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  lastChangeAt = now;
  if (URGENT.has(reason)) urgent = true;
  saveState('แก้ไขแล้ว · รอบันทึก', '');
  writeDraftSoon();
  schedule();
});

function schedule() {
  clearTimeout(saveTimer);
  const now = Date.now();
  let at = lastChangeAt + IDLE_MS;
  if (!urgent) at = Math.max(at, lastSaveAt + MIN_GAP_MS);
  if (firstDirtyAt) at = Math.min(at, firstDirtyAt + MAX_WAIT_MS);
  saveTimer = setTimeout(() => save(), Math.max(0, at - now));
}

function save(opts = {}) {
  clearTimeout(saveTimer);
  if (savePromise) return savePromise.then(() => (isDirty() ? save(opts) : undefined));
  savePromise = doSave(opts).finally(() => { savePromise = null; });
  return savePromise;
}

async function doSave({ keepalive = false } = {}) {
  if (!store.doc) return;
  const termId = store.termId;
  const text = JSON.stringify(store.doc);
  if (text === savedText) { markClean(termId); return; } // ไม่เปลี่ยน = ไม่ส่ง
  const body = `{"id":${termId},"version":${store.version},"data":${text}}`;
  lastSaveAt = Date.now(); urgent = false;
  saveState('กำลังบันทึก…');
  try {
    const r = await api('term.save', body, {}, false, keepalive && utf8Bytes(body) < KEEPALIVE_MAX);
    if (store.termId !== termId) return; // สลับภาคเรียนไประหว่างส่ง
    store.version = r.version;
    savedText = text; retryMs = 0;
    const t = terms.find((x) => +x.id === termId);
    if (t && t.name !== store.doc.term.name) { t.name = store.doc.term.name; renderTermSelect(); }
    if (isDirty()) { saveState('แก้ไขแล้ว · รอบันทึก'); writeDraft(); schedule(); } else markClean(termId);
  } catch (e) {
    if (store.termId !== termId) return;
    if (e.status === 409) {
      await resolveConflict();
    } else if (e.status === 404) {
      saveState('ไม่พบภาคเรียน', 'warn');
      toast('ไม่พบภาคเรียนนี้บนเซิร์ฟเวอร์ (อาจถูกลบจากหน้าต่างอื่น) การแก้ไขเก็บไว้ในเครื่องนี้ ดาวน์โหลดไฟล์สำรองได้ที่แท็บส่งออก', 9000);
    } else if (e.status === 401 || e.status === 403) {
      saveState('หมดเวลาเข้าสู่ระบบ', 'warn');
      toast('หมดเวลาเข้าสู่ระบบ การแก้ไขเก็บไว้ในเครื่องนี้แล้ว เข้าสู่ระบบใหม่แล้วเปิดภาคเรียนนี้ ระบบจะกู้คืนให้', 9000);
    } else if (e.status >= 400 && e.status < 500) {
      // ข้อมูลไม่ผ่านการตรวจ (422/413 ฯลฯ) ส่งซ้ำก็ไม่ผ่าน → ไม่วนส่ง (เปลือง hits) รอผู้ใช้แก้แล้วค่อยส่งรอบใหม่
      saveState('บันทึกไม่สำเร็จ', 'warn'); toast(e.message + ' — การแก้ไขเก็บไว้ในเครื่องแล้ว', 9000);
    } else {
      // เน็ตหลุด/เซิร์ฟเวอร์ไม่ว่าง → ลองใหม่แบบเว้นระยะเพิ่มขึ้นเรื่อย ๆ (20 วิ → สูงสุด 5 นาที) ไม่ยิงถี่ใส่โฮสต์ที่กำลังเต็ม
      retryMs = Math.min(300000, retryMs ? retryMs * 2 : 20000);
      saveState('บันทึกไม่สำเร็จ', 'warn'); toast(e.message + ' — เก็บไว้ในเครื่องแล้ว จะลองส่งใหม่อัตโนมัติ');
      clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), retryMs);
      return;
    }
  }
}

function markClean(termId) {
  firstDirtyAt = 0;
  clearDraft(termId);
  saveState('บันทึกแล้ว', 'ok');
}

// ---------- ชนกัน (409): รวมการแก้ไขอัตโนมัติรายหมวด ----------
// เดิมถามแค่ "โหลดใหม่ (ของเราหาย) / บันทึกทับ (ของอีกที่หาย)" → เปิดสองแท็บแล้วกด Cancel ทำตารางที่จัดไว้หายทั้งหมดได้
// ตอนนี้เทียบ 3 ทาง (ฐาน = ฉบับที่บันทึกล่าสุดของหน้านี้, ของเรา, ของเซิร์ฟเวอร์) รายหมวด: แก้ฝั่งเดียว = เอาฝั่งนั้น, แก้ทั้งสองฝั่ง = ถาม
const PART_NAMES = { term: 'ชื่อภาคเรียน/โครงคาบ', classes: 'ห้องเรียน', teachers: 'ครู', rooms: 'ห้องพิเศษ', subjects: 'วิชา', assignments: 'การสอน', locks: 'คาบล็อก', placements: 'ตารางที่จัดไว้' };
/** รวมแล้วถามเฉพาะเมื่อชนจริง คืนเอกสารที่รวมแล้ว */
function mergeAsk(base, mine, theirs, intro) {
  let { merged, clashes } = merge3(base, mine, theirs);
  if (clashes.length) {
    const names = clashes.map((k) => PART_NAMES[k] || k).join(', ');
    const useMine = confirm(`${intro}\nส่วนที่ถูกแก้ทั้งสองที่ (รายการเดียวกัน): ${names}\n(ส่วนอื่นรวมให้อัตโนมัติแล้ว)\n\nกด OK = ใช้ฉบับของหน้าจอนี้ในรายการที่ชน\nกด Cancel = ใช้ฉบับล่าสุดจากอีกที่ในรายการที่ชน`);
    merged = merge3(base, mine, theirs, useMine ? 'mine' : 'theirs').merged;
  }
  // คาบที่อ้างถึงการสอนที่ถูกลบไปจากอีกที่ → ตัดทิ้ง
  if (Array.isArray(merged.placements) && Array.isArray(merged.assignments)) {
    const ids = new Set(merged.assignments.map((a) => a && a.id));
    merged.placements = merged.placements.filter((p) => p && ids.has(p.assignmentId));
  }
  return { merged, clashes };
}

async function resolveConflict() {
  const termId = store.termId;
  saveState('กำลังรวมการแก้ไข…', 'warn');
  let t;
  try { t = await api('term', undefined, { id: termId }); } catch (e) { saveState('บันทึกไม่สำเร็จ', 'warn'); toast(e.message); saveTimer = setTimeout(() => save(), 20000); return; }
  if (store.termId !== termId) return;
  const base = savedText ? JSON.parse(savedText) : null;
  const { merged, clashes } = mergeAsk(base, store.doc, t.data, 'ภาคเรียนนี้ถูกแก้จากอีกหน้าต่างหรืออีกเครื่องในเวลาเดียวกัน');
  store.doc = merged; store.version = t.version;
  index();
  savedText = JSON.stringify(t.data);
  renderTab();
  toast(clashes.length ? 'รวมการแก้ไขแล้ว กำลังบันทึก' : 'รวมการแก้ไขจากอีกหน้าต่างให้อัตโนมัติแล้ว', 5000);
  if (isDirty()) { urgent = true; lastChangeAt = Date.now() - IDLE_MS; schedule(); } else markClean(termId);
}

// ---------- ฉบับร่างในเครื่อง ----------
const DRAFT_KEY = (id) => 'tt:draft:' + id;
function writeDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 400); }
function writeDraft() {
  if (!store.doc) return;
  // เก็บฉบับฐาน (ที่เซิร์ฟเวอร์มีตอนนั้น) ไว้ด้วย → เปิดครั้งหน้ารวม 3 ทางได้แม้เซิร์ฟเวอร์ถูกแก้ไปแล้ว · ที่ไม่พอ = เก็บแค่ฉบับร่าง
  const rec = { v: store.version, at: Date.now(), doc: JSON.stringify(store.doc), base: savedText };
  try { localStorage.setItem(DRAFT_KEY(store.termId), JSON.stringify(rec)); }
  catch { try { delete rec.base; localStorage.setItem(DRAFT_KEY(store.termId), JSON.stringify(rec)); } catch { /* เต็ม/ถูกปิด */ } }
}
function clearDraft(id) { clearTimeout(draftTimer); try { localStorage.removeItem(DRAFT_KEY(id)); } catch { /* ไม่เป็นไร */ } }
function clearAllDrafts() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('tt:draft:')) localStorage.removeItem(k); } catch { /* ไม่เป็นไร */ }
}

/** เปิดภาคเรียนแล้วพบฉบับร่างที่ยังไม่ได้ส่ง (ปิดหน้า/เน็ตหลุด/หมดเวลาเข้าสู่ระบบ) → กู้คืน */
function restoreDraft(t) {
  let dr = null;
  try { dr = JSON.parse(localStorage.getItem(DRAFT_KEY(t.id)) || 'null'); } catch { /* เสีย */ }
  if (!dr || typeof dr.doc !== 'string') return;
  if (dr.doc === savedText || Date.now() - (dr.at || 0) > 14 * 86400e3) { clearDraft(t.id); return; }
  let doc;
  try { doc = JSON.parse(dr.doc); } catch { clearDraft(t.id); return; }
  const when = new Date(dr.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  if (dr.v !== t.version) {
    // เซิร์ฟเวอร์ถูกแก้หลังจากร่างนี้ → รวม 3 ทางถ้ามีฉบับฐาน · ไม่มีฐาน = ถามว่าจะเอาฉบับไหน
    let base = null;
    try { base = typeof dr.base === 'string' && dr.base ? JSON.parse(dr.base) : null; } catch { /* เสีย */ }
    if (base) doc = mergeAsk(base, doc, t.data, `พบการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ (${when}) และข้อมูลบนเซิร์ฟเวอร์ถูกแก้หลังจากนั้น`).merged;
    else if (!confirm(`พบการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ (${when})\nแต่ข้อมูลบนเซิร์ฟเวอร์ถูกแก้หลังจากนั้น\n\nกด OK = ใช้ฉบับในเครื่องนี้ (บันทึกทับ)\nกด Cancel = ใช้ข้อมูลบนเซิร์ฟเวอร์ และทิ้งฉบับในเครื่อง`)) { clearDraft(t.id); return; }
  }
  store.doc = doc;
  index();
  firstDirtyAt = lastChangeAt = Date.now(); urgent = true;
  saveState('แก้ไขแล้ว · รอบันทึก');
  toast(`กู้การแก้ไขที่ยังไม่ได้บันทึก (${when}) กลับมาแล้ว`, 6000);
  schedule();
}

// ซ่อนแท็บ/สลับแอป (มือถือมักฆ่าหน้าหลังจากนี้) → ส่งทันที · ปิดหน้า → keepalive (ถ้าเอกสารเล็กพอ) + ฉบับร่างสำรอง
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isDirty()) { writeDraft(); save({ keepalive: true }); }
});
window.addEventListener('pagehide', () => { if (isDirty()) { writeDraft(); if (!savePromise) save({ keepalive: true }); } });
window.addEventListener('beforeunload', (e) => {
  // ยังถามก่อนปิดเมื่อส่งแบบ keepalive ไม่ได้ (เอกสารใหญ่) หรือกำลังส่งอยู่ — ฉบับร่างในเครื่องยังกู้คืนได้อีกชั้น
  if (savePromise || (isDirty() && utf8Bytes(JSON.stringify(store.doc)) > KEEPALIVE_MAX - 200)) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- จัดการภาคเรียน ----------
const NEW_TERM_KINDS = [
  ['blank:primary', 'ตารางว่าง + รายวิชาพื้นฐานประถม (กรอกครู/การสอนเอง)'], ['blank:lower', 'ตารางว่าง + รายวิชาพื้นฐาน ม.ต้น'],
  ['blank:upper', 'ตารางว่าง + รายวิชาพื้นฐาน ม.ปลาย'], ['blank:', 'ตารางว่าง (ไม่มีวิชา)'],
  ['sample-primary:', 'ข้อมูลตัวอย่างประถม'], ['sample:', 'ข้อมูลตัวอย่างมัธยม'],
];
async function newTerm() {
  renderTermSelect();
  // ผู้ใช้จริงคนแรกเลือกค่าเริ่มต้นเดิม (ตารางว่าง) แล้วกรอกครู/การสอนใหม่ทั้งหมดเกือบ 1.5 ชม. → ให้ "สำเนาจากภาคเรียนเดิม" เป็นค่าเริ่มต้น
  const cur = store.doc ? store.doc.term.name : '';
  const kinds = cur ? [['copy:keep', `สำเนาจาก “${cur}” (ครู ห้อง วิชา การสอน และตาราง)`], ['copy:clear', `สำเนาจาก “${cur}” แต่ล้างตาราง (จัดใหม่)`], ...NEW_TERM_KINDS] : NEW_TERM_KINDS;
  const dlg = document.createElement('dialog');
  dlg.className = 'card dlg';
  dlg.innerHTML = `<form method="dialog" style="display:grid;gap:12px">
    <h3 style="font-size:1.1rem">สร้างภาคเรียนใหม่</h3>
    <div class="field"><label for="nt-name">ชื่อภาคเรียน</label>
      <input class="input" id="nt-name" required maxlength="200" value="ภาคเรียนที่ 2/${new Date().getFullYear() + 543}"></div>
    <div class="field"><label for="nt-kind">เริ่มต้นด้วย</label>
      <select class="input" id="nt-kind">${kinds.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('')}</select>
      <span class="hint">แบบสำเนา: ครู ห้อง วิชา และการสอนตามมาครบ ไม่ต้องกรอกใหม่ · แบบตารางว่าง: ต้องกรอกครูและการสอนเองทั้งหมด</span></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" value="cancel" formnovalidate>ยกเลิก</button><button class="btn btn-primary" value="ok">สร้าง</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const ok = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
  const name = dlg.querySelector('#nt-name').value.trim();
  const [template, band] = dlg.querySelector('#nt-kind').value.split(':');
  dlg.remove();
  if (!ok || !name) { renderTermSelect(); return; }
  try {
    await flush();
    const body = template === 'copy' ? { name, template, from: store.termId, clear: band === 'clear' } : { name, template, band: band || null };
    const r = await api('term.create', body);
    await refreshTerms(r.id);
    toast(template === 'copy' ? 'สร้างภาคเรียนใหม่จากสำเนาแล้ว ครู วิชา และการสอนตามมาครบ' : 'สร้างภาคเรียนแล้ว');
  } catch (e) { toast(e.message); renderTermSelect(); }
}
async function copyTerm() {
  await flush();
  try { const r = await api('term.create', { template: 'copy', from: store.termId }); await refreshTerms(r.id); toast('ทำสำเนาแล้ว ข้อมูลครู วิชา และตารางถูกคัดลอกมาทั้งหมด'); }
  catch (e) { toast(e.message); }
}
async function deleteTerm() {
  if (!confirm(`ลบ “${store.doc.term.name}” ถาวร ยืนยันไหม`)) return;
  clearTimeout(saveTimer);
  try { await savePromise; } catch { /* ไม่เป็นไร */ }
  const id = store.termId;
  try { await api('term.delete', { id }); clearDraft(id); savedText = JSON.stringify(store.doc); sessionSet('term', ''); await refreshTerms(); toast('ลบภาคเรียนแล้ว'); }
  catch (e) { toast(e.message); }
}
async function flush() { clearTimeout(saveTimer); if (savePromise || isDirty()) await save(); }
periods.setActions({ newTerm, copyTerm, deleteTerm });

// ---------- เริ่ม ----------
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; sessionSet('tab', tab); renderTab(); }));
$('#term-select').addEventListener('change', async (e) => {
  if (e.target.value === '__new') { await newTerm(); return; }
  await flush();
  await loadTerm(+e.target.value);
});

// ปุ่ม "ไปแก้ที่…" / "ไปจัดตาราง" จากโมดูลอื่น
document.addEventListener('tt:goto', (e) => {
  const { tab: t, section } = e.detail || {};
  if (section) data.setSection(section);
  if (t && TABS[t]) { tab = t; sessionSet('tab', tab); renderTab(); window.scrollTo({ top: 0 }); }
});
// คลิกสถานะ = บันทึกทันที
$('#save-state').title = 'บันทึกอัตโนมัติ (เก็บในเครื่องทันที ส่งขึ้นระบบทุก ~30 วินาทีขณะแก้ไข) · คลิกเพื่อบันทึกทันที';
$('#save-state').style.cursor = 'pointer';
$('#save-state').addEventListener('click', () => { if (isDirty()) save(); });
// ออกจากระบบ: ส่งการแก้ไขที่ค้างก่อน แล้วลบฉบับร่างในเครื่อง (เครื่องที่ใช้ร่วมกันจะไม่เหลือข้อมูลโรงเรียน)
document.querySelector('form[action="auth/logout.php"]')?.addEventListener('submit', async (e) => {
  const f = e.currentTarget;
  if (f.dataset.ready) return;
  e.preventDefault();
  try { await flush(); } catch { /* ส่งไม่ได้ก็ออกต่อ */ }
  if (isDirty() && !confirm('ยังบันทึกการแก้ไขล่าสุดไม่สำเร็จ ออกจากระบบเลยไหม (การแก้ไขนั้นจะหาย)')) return;
  clearAllDrafts();
  f.dataset.ready = '1';
  f.submit();
});

if (window.TT.flash) toast(window.TT.flash, 6000);
refreshTerms().catch((e) => { saveState('โหลดไม่สำเร็จ', 'warn'); toast(e.message); });

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sessionGet(k) { try { return sessionStorage.getItem('tt:' + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem('tt:' + k, v); } catch { /* ไม่เป็นไร */ } }
