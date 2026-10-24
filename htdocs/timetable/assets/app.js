// ตัวควบคุมหลัก: โหลด/บันทึกภาคเรียน, แท็บ, สถานะบันทึก
import { store, index, merge3, esc, remaining, noTeacher as noTch } from './store.js';
import * as notify from './notify.js';
import * as board from './board.js';
import * as data from './data.js';
import * as periods from './periods.js';
import * as exporter from './export.js';

const TABS = { board, data, periods, export: exporter };
store.curriculum = window.TT.cur || null; // รหัสวิชา → คาบ/สัปดาห์ตามหลักสูตร (เติมให้ข้อมูลเก่าตอน sanitize)
notify.warm();
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
  // finally: แท็บพังกับข้อมูลเก่าที่ไม่คาดไว้ → ยังแสดง <main> (.tt-ready) ให้สลับแท็บ/ส่งออกไฟล์สำรองได้ ไม่ใช่จอว่าง
  // .tt-ready ใส่ในงาน JS เดียวกับที่วาดแถบขั้นตอน (ยังไม่ paint ระหว่างกัน) จึงไม่เกิด CLS
  try { if (store.doc) TABS[tab].render($('#tab-' + tab)); } finally { if (store.doc) $('#app').classList.add('tt-ready'); renderSteps(); }
}

// ---------- แถบขั้นตอน 1-2-3-4 (ครู → ใครสอนอะไร → ตรวจ → จัด) ----------
// อ่านสถานะจากเอกสารทุกครั้ง ไม่เก็บ state เพิ่ม · ภาคเรียนว่าง = มีปุ่ม "เริ่มด้วยตัวช่วย" (wizard.js โหลดเมื่อใช้)
let wizardMod = null;
const wizard = () => (wizardMod ??= import('./wizard.js').catch((e) => { wizardMod = null; throw e; }));
const blankDoc = (d) => !!d && !d.classes.length && !d.teachers.length && !d.assignments.length;
async function openWizard(auto) {
  try { const w = await wizard(); auto ? w.maybeOpen() : w.open(); } catch (e) { if (!auto) notify.error('เปิดตัวช่วยไม่สำเร็จ: ' + e.message); }
}
const STEP_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
function stepState(d) {
  const asg = d.assignments;
  const noTeacher = asg.filter(noTch).length;
  const left = asg.reduce((n, a) => n + remaining(a), 0);
  let issues = 0;
  try { issues = board.readiness().length; } catch { /* ข้อมูลยังไม่ครบ */ }
  const s1 = d.teachers.length > 0, s2 = s1 && asg.length > 0 && !noTeacher, s4 = s2 && !!d.placements.length && !left;
  return [
    { n: 1, t: 'ครู', done: s1, go: { tab: 'data', section: 'teachers' }, tip: s1 ? `ครู ${d.teachers.length} คน` : 'เพิ่มครู หรือวางรายชื่อครู' },
    { n: 2, t: 'ใครสอนอะไร', done: s2, go: { tab: 'data', section: 'assignments', ...(noTeacher && s1 ? { filter: 'noTeacher' } : {}) }, tip: !asg.length ? 'ยังไม่มีการสอน' : noTeacher ? `ยังไม่มีครู ${noTeacher} แถว` : `การสอน ${asg.length} แถว ครบทุกแถว`, badge: noTeacher && asg.length ? noTeacher : 0 },
    { n: 3, t: 'ตรวจ', done: s2 && (s4 || !issues), go: { tab: 'board' }, tip: !s2 ? 'ทำขั้น 1–2 ให้ครบก่อน' : issues ? `พบ ${issues} จุดที่ทำให้จัดไม่ครบ` : 'ข้อมูลพร้อมจัด', badge: s2 ? issues : 0 },
    { n: 4, t: 'จัด', done: s4, go: { tab: 'board' }, tip: s4 ? 'จัดครบทุกคาบแล้ว' : `เหลือจัด ${left} คาบ` },
  ];
}
function renderSteps() {
  let nav = $('#tt-steps');
  if (!nav) {
    stepsCss();
    nav = Object.assign(document.createElement('nav'), { id: 'tt-steps', className: 'tt-steps' });
    nav.setAttribute('aria-label', 'ขั้นตอนการจัดตาราง');
    $('.tabs').after(nav);
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (b) document.dispatchEvent(new CustomEvent('tt:goto', { detail: JSON.parse(b.dataset.step) }));
    });
  }
  const d = store.doc;
  if (!d) { nav.hidden = true; return; }
  nav.hidden = false;
  $('#app').classList.add('tt-ready'); // แสดง <main> พร้อมแถบขั้นตอน/ครูบูรณ์ในเฟรมเดียวกัน (board.css) ไม่ให้เนื้อหาถูกดันลง (CLS)
  const steps = stepState(d);
  const cur = steps.find((s) => !s.done)?.n || 0;
  nav.innerHTML = `<ol>${steps.map((s) => `<li><button type="button" class="${s.done ? 'done' : s.n === cur ? 'cur' : ''}" data-step="${esc(JSON.stringify(s.go))}" title="${esc(s.tip)}" ${s.n === cur ? 'aria-current="step"' : ''}>
      <span class="n">${s.done ? STEP_ICON : s.n}</span>${s.t}${s.badge ? ` <span class="b" aria-label="${esc(s.tip)}">${s.badge}</span>` : ''}</button></li>`).join('')}</ol>
    ${blankDoc(d) ? '<button type="button" class="btn btn-sm btn-primary" data-open-wizard>เริ่มด้วยตัวช่วย 4 คำถาม</button>' : ''}`;
}
// สไตล์แถบขั้นตอน (ใส่ครั้งเดียว · ใช้ตัวแปรสีของ app.css: เสร็จ = น้ำเงิน, ขั้นปัจจุบัน = ทอง · ไม่มีแถบสีขอบซ้าย)
function stepsCss() {
  const s = document.createElement('style');
  s.textContent = `.tt-steps{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 16px;background:var(--surface-2);border-bottom:1px solid var(--line)}
.tt-steps[hidden]{display:none}
.tt-steps ol{display:flex;gap:4px;margin:0;padding:0;list-style:none;flex-wrap:wrap}
.tt-steps li{display:flex;align-items:center}.tt-steps li+li::before{content:"";width:14px;height:1px;background:var(--line);margin-right:4px}
.tt-steps ol button{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:none;border-radius:999px;padding:3px 10px 3px 4px;cursor:pointer;color:var(--muted);font:inherit;font-size:.88rem;min-height:32px}
.tt-steps ol button:hover{border-color:var(--line);background:var(--surface)}
.tt-steps .n{width:22px;height:22px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid var(--line);background:var(--surface);font-size:.78rem;font-weight:600}
.tt-steps .done{color:var(--ink)}.tt-steps .done .n{background:var(--blue);border-color:var(--blue);color:var(--surface)}
.tt-steps .cur{color:var(--ink);font-weight:600;border-color:var(--gold-bg);background:var(--gold-soft)}.tt-steps .cur .n{border-color:var(--gold-bg);background:var(--gold-bg);color:#0F2438}
.tt-steps .b{min-width:18px;padding:0 5px;border-radius:999px;background:var(--gold-soft);border:1px solid var(--gold-bg);color:var(--ink);font-size:.72rem;line-height:16px;text-align:center}
@media (max-width:560px){.tt-steps{padding:6px 12px;gap:6px}.tt-steps li+li::before{width:6px}.tt-steps ol button{padding:2px 8px 2px 3px;font-size:.84rem}}`;
  document.head.appendChild(s);
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
  renderTab();
  await restoreDraft(t);
  if (!isDirty()) saveState('บันทึกแล้ว', 'ok');
  // ภาคเรียนว่าง (ไม่มีห้อง ครู การสอน) → เปิดตัวช่วยเริ่มต้นเอง (ยกเว้นเคยกด "ไว้ทีหลัง" ของภาคเรียนนี้)
  if (blankDoc(store.doc)) openWizard(true);
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
const URGENT = new Set(['solve', 'import', 'clear', 'wizard']); // การเปลี่ยนแปลงก้อนใหญ่ ส่งเร็วโดยไม่รอ MIN_GAP
let saveTimer = null, savePromise = null, draftTimer = null;
let savedText = '';            // JSON ของเอกสารฉบับที่เซิร์ฟเวอร์มีแล้ว = ฐานสำหรับเทียบ "เปลี่ยนไหม" และรวมการแก้ไขเมื่อชน (409)
let firstDirtyAt = 0, lastChangeAt = 0, lastSaveAt = 0, urgent = false, retryMs = 0;

const isDirty = () => !!store.doc && JSON.stringify(store.doc) !== savedText;

store.onChange((reason) => {
  TABS[tab].render($('#tab-' + tab));
  renderSteps();
  if (!isDirty()) { if (!savePromise) markClean(store.termId); return; } // กดแล้วเนื้อหาเท่าเดิม (เช่น ล็อกแล้วปลด) ไม่ต้องส่ง
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  lastChangeAt = now;
  if (URGENT.has(reason)) urgent = true;
  saveState('แก้ไขแล้ว · รอบันทึก', '');
  // บอกครั้งแรกของรอบแก้ไข (ไม่เกินทุก 3 นาที) ว่าเก็บในเครื่องแล้ว ไม่ต้องกดบันทึก
  if (firstDirtyAt === now && now - lastLocalNote > 180000) { lastLocalNote = now; notify.status('บันทึกในเครื่องแล้ว · รอส่งขึ้นระบบอัตโนมัติ'); }
  writeDraftSoon();
  schedule();
});
let lastLocalNote = 0;

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
  // ส่งนานเกิน 0.8 วิ (เน็ตช้า) จึงขึ้น toast "กำลังบันทึก" ส่งเร็วเห็นแค่ "บันทึกแล้ว"
  const slow = setTimeout(() => notify.status('กำลังบันทึก…', 4000), 800);
  try {
    const r = await api('term.save', body, {}, false, keepalive && utf8Bytes(body) < KEEPALIVE_MAX);
    clearTimeout(slow);
    if (store.termId !== termId) return; // สลับภาคเรียนไประหว่างส่ง
    store.version = r.version;
    savedText = text; retryMs = 0;
    const t = terms.find((x) => +x.id === termId);
    if (t && t.name !== store.doc.term.name) { t.name = store.doc.term.name; renderTermSelect(); }
    const wasOffline = retryMs > 0 || offline;
    offline = false;
    if (isDirty()) { saveState('แก้ไขแล้ว · รอบันทึก'); writeDraft(); schedule(); } else markClean(termId);
    notify.status(wasOffline ? 'เชื่อมต่อใหม่แล้ว · ส่งการแก้ไขที่ค้างขึ้นระบบแล้ว' : 'บันทึกแล้ว', wasOffline ? 3500 : 1600);
  } catch (e) {
    clearTimeout(slow);
    if (store.termId !== termId) return;
    if (e.status === 409) {
      await resolveConflict();
    } else if (e.status === 404) {
      saveState('ไม่พบภาคเรียน', 'warn');
      notify.error('ไม่พบภาคเรียนนี้บนเซิร์ฟเวอร์ (อาจถูกลบจากหน้าต่างอื่น) การแก้ไขเก็บไว้ในเครื่องนี้ ดาวน์โหลดไฟล์สำรองได้ที่แท็บส่งออก', 9000);
    } else if (e.status === 401 || e.status === 403) {
      saveState('หมดเวลาเข้าสู่ระบบ', 'warn');
      notify.alertBox('หมดเวลาเข้าสู่ระบบ', 'การแก้ไขเก็บไว้ในเครื่องนี้แล้ว เข้าสู่ระบบใหม่แล้วเปิดภาคเรียนนี้ ระบบจะกู้คืนให้', 'warning');
    } else if (e.status >= 400 && e.status < 500) {
      // ข้อมูลไม่ผ่านการตรวจ (422/413 ฯลฯ) ส่งซ้ำก็ไม่ผ่าน → ไม่วนส่ง (เปลือง hits) รอผู้ใช้แก้แล้วค่อยส่งรอบใหม่
      saveState('บันทึกไม่สำเร็จ', 'warn'); notify.error('บันทึกไม่สำเร็จ: ' + e.message + ' — การแก้ไขเก็บไว้ในเครื่องแล้ว', 9000);
    } else {
      // เน็ตหลุด/เซิร์ฟเวอร์ไม่ว่าง → ลองใหม่แบบเว้นระยะเพิ่มขึ้นเรื่อย ๆ (20 วิ → สูงสุด 5 นาที) ไม่ยิงถี่ใส่โฮสต์ที่กำลังเต็ม
      retryMs = Math.min(300000, retryMs ? retryMs * 2 : 20000);
      saveState(navigator.onLine === false ? 'ออฟไลน์ · เก็บในเครื่อง' : 'บันทึกไม่สำเร็จ', 'warn');
      if (retryMs === 20000) notify.warn((navigator.onLine === false ? 'ออฟไลน์อยู่' : 'ส่งขึ้นระบบไม่สำเร็จ (' + e.message + ')') + ' — การแก้ไขเก็บในเครื่องแล้ว จะลองส่งใหม่อัตโนมัติ');
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
const PART_NAMES = { term: 'ชื่อภาคเรียน/โครงคาบ', classes: 'ห้องเรียน', teachers: 'ครู', rooms: 'ห้องพิเศษ', subjects: 'วิชา', assignments: 'การสอน', locks: 'คาบล็อก', placements: 'ตารางที่จัดไว้', settings: 'ค่าตั้งของภาคเรียน', meta: 'ผลจัดล่าสุด' };
/** รวมแล้วถามเฉพาะเมื่อชนจริง คืนเอกสารที่รวมแล้ว */
async function mergeAsk(base, mine, theirs, intro) {
  let { merged, clashes } = merge3(base, mine, theirs);
  if (clashes.length) {
    const names = clashes.map((k) => PART_NAMES[k] || 'ข้อมูลอื่น').join(', '); // ไม่ให้ชื่อคีย์ภาษาอังกฤษขึ้นจอ
    const pick = await notify.choose({
      title: 'มีการแก้ไขจากสองที่พร้อมกัน', icon: 'warning',
      html: `<p style="margin:0">${esc(intro)}</p><p style="margin:8px 0 0">ส่วนที่ถูกแก้ทั้งสองที่ (รายการเดียวกัน): <b>${esc(names)}</b><br><span class="muted">ส่วนอื่นรวมให้อัตโนมัติแล้ว</span></p><p style="margin:8px 0 0">ในรายการที่ชน จะใช้ฉบับไหน</p>`,
      ok: 'ใช้ฉบับของหน้าจอนี้', deny: 'ใช้ฉบับล่าสุดจากอีกที่', cancel: false, outside: false,
    });
    merged = merge3(base, mine, theirs, pick === 'deny' ? 'theirs' : 'mine').merged;
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
  try { t = await api('term', undefined, { id: termId }); } catch (e) { saveState('บันทึกไม่สำเร็จ', 'warn'); notify.warn(e.message); saveTimer = setTimeout(() => save(), 20000); return; }
  if (store.termId !== termId) return;
  const base = savedText ? JSON.parse(savedText) : null;
  const { merged, clashes } = await mergeAsk(base, store.doc, t.data, 'ภาคเรียนนี้ถูกแก้จากอีกหน้าต่างหรืออีกเครื่องในเวลาเดียวกัน');
  store.doc = merged; store.version = t.version;
  index();
  savedText = JSON.stringify(t.data);
  renderTab();
  notify.info(clashes.length ? 'รวมการแก้ไขแล้ว กำลังบันทึก' : 'รวมการแก้ไขจากอีกหน้าต่างให้อัตโนมัติแล้ว', 5000);
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
async function restoreDraft(t) {
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
    if (base) doc = (await mergeAsk(base, doc, t.data, `พบการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ (${when}) และข้อมูลบนเซิร์ฟเวอร์ถูกแก้หลังจากนั้น`)).merged;
    else {
      const pick = await notify.choose({
        title: 'พบฉบับร่างในเครื่องนี้', icon: 'question', outside: false, cancel: false,
        text: `พบการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ (${when})\nแต่ข้อมูลบนเซิร์ฟเวอร์ถูกแก้หลังจากนั้น จะใช้ฉบับไหน`,
        ok: 'ใช้ฉบับในเครื่องนี้ (บันทึกทับ)', deny: 'ใช้ข้อมูลบนเซิร์ฟเวอร์',
      });
      if (pick !== 'confirm') { clearDraft(t.id); return; }
    }
  }
  if (store.termId !== +t.id) return;
  store.doc = doc;
  index();
  firstDirtyAt = lastChangeAt = Date.now(); urgent = true;
  saveState('แก้ไขแล้ว · รอบันทึก');
  renderTab();
  notify.info(`กู้ฉบับร่างที่ยังไม่ได้บันทึก (${when}) กลับมาแล้ว กำลังส่งขึ้นระบบ`, 6000);
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
  const res = await notify.form({
    title: 'สร้างภาคเรียนใหม่', ok: 'สร้าง',
    html: `<div style="display:grid;gap:12px;text-align:left">
    <div class="field"><label for="nt-name">ชื่อภาคเรียน</label>
      <input class="input" id="nt-name" required maxlength="200" value="ภาคเรียนที่ 2/${new Date().getFullYear() + 543}"></div>
    <div class="field"><label for="nt-kind">เริ่มต้นด้วย</label>
      <select class="input" id="nt-kind">${kinds.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('')}</select>
      <span class="hint">แบบสำเนา: ครู ห้อง วิชา และการสอนตามมาครบ ไม่ต้องกรอกใหม่ · แบบตารางว่าง: ต้องกรอกครูและการสอนเองทั้งหมด</span></div></div>`,
    read: (root) => {
      const name = root.querySelector('#nt-name').value.trim();
      if (!name) return { error: 'กรุณาตั้งชื่อภาคเรียน' };
      return { name, kind: root.querySelector('#nt-kind').value };
    },
  });
  if (!res) { renderTermSelect(); return; }
  const { name } = res;
  const [template, band] = res.kind.split(':');
  const busy = notify.loading(template === 'copy' ? 'กำลังสำเนาภาคเรียน…' : 'กำลังสร้างภาคเรียน…');
  try {
    await flush();
    const body = template === 'copy' ? { name, template, from: store.termId, clear: band === 'clear' } : { name, template, band: band || null };
    const r = await api('term.create', body);
    await refreshTerms(r.id);
    busy.close();
    notify.ok(template === 'copy' ? 'สร้างภาคเรียนใหม่จากสำเนาแล้ว ครู วิชา และการสอนตามมาครบ' : 'สร้างภาคเรียนแล้ว');
  } catch (e) { busy.close(); notify.error('สร้างภาคเรียนไม่สำเร็จ: ' + e.message); renderTermSelect(); }
}
async function copyTerm() {
  const busy = notify.loading('กำลังทำสำเนาภาคเรียน…');
  try {
    await flush();
    const r = await api('term.create', { template: 'copy', from: store.termId }); await refreshTerms(r.id);
    busy.close(); notify.ok('ทำสำเนาแล้ว ข้อมูลครู วิชา และตารางถูกคัดลอกมาทั้งหมด');
  } catch (e) { busy.close(); notify.error('ทำสำเนาไม่สำเร็จ: ' + e.message); }
}
async function deleteTerm() {
  const ok = await notify.confirmDanger({ title: 'ลบภาคเรียนนี้ถาวร', html: `ลบ “<b>${esc(store.doc.term.name)}</b>” ทั้งภาคเรียน (ห้อง ครู วิชา การสอน และตาราง) <b>กู้คืนไม่ได้</b><br><span class="muted">แนะนำให้ดาวน์โหลดไฟล์สำรองที่แท็บส่งออกก่อน</span>`, ok: 'ลบภาคเรียน' });
  if (!ok) return;
  clearTimeout(saveTimer);
  try { await savePromise; } catch { /* ไม่เป็นไร */ }
  const id = store.termId;
  try { await api('term.delete', { id }); clearDraft(id); savedText = JSON.stringify(store.doc); sessionSet('term', ''); await refreshTerms(); notify.ok('ลบภาคเรียนแล้ว'); }
  catch (e) { notify.error('ลบไม่สำเร็จ: ' + e.message); }
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

// ปุ่ม "ไปแก้ที่…" / "ไปจัดตาราง" / แถบขั้นตอน จากโมดูลอื่น
// detail: { tab, section?, filter? ('noTeacher'), teacherId?, classId? (แท็บโครงคาบ: เลือกห้องในตัวเลือกคาบล็อก) }
document.addEventListener('tt:goto', (e) => {
  const { tab: t, section, filter, teacherId, classId } = e.detail || {};
  if (section) data.setSection(section, { filter, teacherId });
  if (t === 'periods' && classId) periods.setLockClass(classId);
  if (t && TABS[t]) { tab = t; sessionSet('tab', tab); renderTab(); window.scrollTo({ top: 0 }); }
});
// ปุ่ม [data-open-wizard] ที่ไหนก็ได้ในหน้า (แถบขั้นตอน / board / periods) = เปิดตัวช่วยเริ่มต้น
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-open-wizard]')) openWizard(false); });
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
  if (isDirty() && !(await notify.confirm({ title: 'ยังบันทึกไม่สำเร็จ', text: 'การแก้ไขล่าสุดยังส่งขึ้นระบบไม่สำเร็จ ถ้าออกจากระบบตอนนี้การแก้ไขนั้นจะหาย', ok: 'ออกจากระบบเลย', icon: 'warning' }))) return;
  clearAllDrafts();
  f.dataset.ready = '1';
  f.submit();
});

if (window.TT.flash) (window.TT.flashKind === 'ok' ? notify.ok : window.TT.flashKind === 'info' ? notify.info : notify.warn)(window.TT.flash, 6000);
refreshTerms().catch((e) => { $('#app').classList.add('tt-ready'); saveState('โหลดไม่สำเร็จ', 'warn'); notify.error('โหลดข้อมูลไม่สำเร็จ: ' + e.message); });

// ออฟไลน์/กลับมาออนไลน์: บอกสถานะ และส่งที่ค้างทันทีเมื่อเน็ตกลับมา
let offline = false;
window.addEventListener('offline', () => { offline = true; saveState('ออฟไลน์ · เก็บในเครื่อง', 'warn'); notify.warn('ออฟไลน์ — แก้ไขต่อได้ ระบบเก็บในเครื่องไว้ก่อน แล้วส่งให้เมื่อเน็ตกลับมา', 6000); });
window.addEventListener('online', () => {
  if (isDirty()) { retryMs = 0; urgent = true; save(); } else { offline = false; notify.ok('เชื่อมต่อใหม่แล้ว', 2500); }
});

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sessionGet(k) { try { return sessionStorage.getItem('tt:' + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem('tt:' + k, v); } catch { /* ไม่เป็นไร */ } }
