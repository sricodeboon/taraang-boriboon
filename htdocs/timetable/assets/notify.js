// การแจ้งเตือนทั้งระบบ (SweetAlert2 11 จาก cdnjs + SRI) — ทุกหน้าเรียกผ่านโมดูลนี้เท่านั้น ไม่ใช้ alert()/confirm()/prompt()
// - โหลด Swal เมื่อใช้ครั้งแรก (หรือ warm() ตอนหน้าว่าง) ไม่กิน hits ของโฮสต์ · โหลดไม่ได้ → ใช้ toast/กล่องโต้ตอบของระบบเอง
// - toast มุมจอมีลำดับความสำคัญ: สถานะบันทึก < ข้อความทั่วไป < ผลลัพธ์/ปุ่มเลิกทำ · Swal แสดงได้ทีละกล่อง
//   จึงไม่ให้ toast ต่ำกว่าเขียนทับกล่องยืนยัน/toast สำคัญที่เปิดอยู่ (เก็บไว้แสดงต่อเมื่อกล่องนั้นปิด)
const VER = '11.26.25';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/sweetalert2/${VER}/`;
// SRI คำนวณเองจากไฟล์บน cdnjs (openssl dgst -sha512 -binary | base64) ตรงกับที่ cdnjs ประกาศ · เปลี่ยนเวอร์ชันต้องเปลี่ยน hash
const JS_SRI = 'sha512-dmAN1QwqVuU3dD62u4+wOeqNPKpS9Me5pqOf4NROrcryBWUn1Z65+u3U+GFuwqIm9dw6Y2VPI0g/UVaB4gI54g==';
const CSS_SRI = 'sha512-6/+HUJuCrUvBnvz1/099uvZ8kFmzGn1EPDfXBX9W2sNukWwduYJ2VkteUX/DARp8mtr845p97CxyVLpok8axRg==';

let loadP = null;
let Swal = null;         // มิกซ์อินที่ตั้งค่าภาษาไทย/ธีมแล้ว
let failed = false;      // โหลดไม่ได้ → ใช้ตัวสำรองตลอดหน้านี้
let modalOpen = 0;       // กล่องโต้ตอบที่ต้องรอผู้ใช้ (ห้าม toast ทับ)
let shown = null;        // { prio, until } toast ที่แสดงอยู่
let pending = null;      // toast ลำดับต่ำที่รอแสดงหลังกล่องปัจจุบันปิด (เก็บเฉพาะอันล่าสุด)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (s) => esc(s).replace(/\n/g, '<br>');

function addTag(tag, attrs) {
  return new Promise((ok, fail) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.crossOrigin = 'anonymous';
    el.referrerPolicy = 'no-referrer';
    el.onload = ok; el.onerror = () => fail(new Error('load ' + tag));
    document.head.appendChild(el);
  });
}

/** โหลด SweetAlert2 (ครั้งเดียว) · คืน Swal หรือ null ถ้าใช้ตัวสำรอง */
export function load() {
  if (Swal || failed) return Promise.resolve(Swal);
  loadP ??= Promise.race([
    Promise.all([
      addTag('link', { rel: 'stylesheet', href: BASE + 'sweetalert2.min.css', integrity: CSS_SRI }),
      window.Sweetalert2 ? Promise.resolve() : addTag('script', { src: BASE + 'sweetalert2.min.js', integrity: JS_SRI }),
    ]),
    new Promise((_, fail) => setTimeout(() => fail(new Error('timeout')), 9000)),
  ]).then(() => {
    const S = window.Sweetalert2 || window.Swal;
    if (!S?.mixin) throw new Error('no swal');
    Swal = S.mixin({
      confirmButtonText: 'ตกลง', cancelButtonText: 'ยกเลิก', denyButtonText: 'ไม่',
      buttonsStyling: false, reverseButtons: true,
      customClass: { popup: 'tt-swal', confirmButton: 'btn btn-swal-ok', cancelButton: 'btn', denyButton: 'btn btn-swal-deny', input: 'input', validationMessage: 'tt-swal-valid' },
      showClass: { popup: 'swal2-show', backdrop: 'swal2-backdrop-show', icon: 'swal2-icon-show' },
    });
    return Swal;
  }).catch((e) => { failed = true; console.warn('โหลด SweetAlert2 ไม่ได้ ใช้กล่องแจ้งเตือนสำรอง', e.message); return null; });
  return loadP;
}
/** โหลดล่วงหน้าตอนหน้าว่าง (toast แรกขึ้นทันที) */
export function warm() {
  const go = () => load();
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1200);
}

// ---------- toast ----------
const PRIO = { status: 1, info: 2, ok: 2, warn: 3, error: 3, action: 4, loading: 3 };
const ICON = { ok: 'success', info: 'info', warn: 'warning', error: 'error', status: undefined, action: 'info', loading: undefined };
const wide = () => window.matchMedia?.('(max-width: 560px)').matches;

/**
 * toast มุมจอ ไม่บังงาน · kind: status|info|ok|warn|error · ms: เวลาแสดง
 * คืน Promise ที่จบเมื่อ toast ปิด (ผลของ Swal)
 */
export async function toast(msg, kind = 'info', ms) {
  const prio = PRIO[kind] || 2;
  ms ??= kind === 'status' ? 1800 : kind === 'error' || kind === 'warn' ? 6500 : 3600;
  const S = await load();
  if (!S) return fallbackToast(msg, ms);
  // มีกล่องสำคัญกว่าเปิดอยู่ → รอแสดงต่อ (อันล่าสุดชนะ) ไม่เขียนทับ
  if (modalOpen || (shown && shown.prio > prio && Date.now() < shown.until && S.isVisible())) {
    if (!pending || prio >= pending.prio) pending = { msg, kind, ms, prio, at: Date.now() };
    return undefined;
  }
  return fireToast(S, { msg, kind, ms, prio });
}

function fireToast(S, { msg, kind, ms, prio, html, confirm, onOpen }) {
  const me = shown = { prio, until: Date.now() + ms };
  const p = S.fire({
    toast: true, position: wide() ? 'bottom' : 'bottom-end', icon: ICON[kind], titleText: html ? undefined : String(msg), html, // titleText = ข้อความล้วน (title ของ Swal เป็น HTML → ห้ามใช้กับชื่อที่ผู้ใช้กรอก)
    showConfirmButton: !!confirm, confirmButtonText: confirm, timer: ms, timerProgressBar: kind === 'action',
    customClass: { popup: 'tt-swal tt-toast tt-' + kind, confirmButton: 'btn btn-sm btn-swal-ok' },
    didOpen: (el) => {
      el.addEventListener('mouseenter', S.stopTimer); el.addEventListener('mouseleave', S.resumeTimer);
      if (kind === 'loading') S.showLoading();
      onOpen?.(el);
    },
  });
  p.then(() => { if (shown === me) shown = null; drain(); });
  return p;
}

function drain(tries = 0) {
  if (!pending || modalOpen || !Swal) return;
  // กล่องเดิมกำลังเลื่อนออก (Swal.isVisible ยังจริงชั่วครู่) → ลองใหม่อีกนิด ถ้ายังมี toast อื่นที่สำคัญกว่าค้างอยู่ก็รอ .then ของมัน
  if (Swal.isVisible()) { if (!shown && tries < 8) setTimeout(() => drain(tries + 1), 150); return; }
  const t = pending; pending = null;
  // สถานะเก่ากว่า 12 วินาทีไม่ต้องแสดงแล้ว (เช่น "กำลังบันทึก" ที่บันทึกเสร็จไปแล้ว)
  if (Date.now() - t.at > 12000) return;
  fireToast(Swal, t);
}

export const ok = (msg, ms) => toast(msg, 'ok', ms);
export const info = (msg, ms) => toast(msg, 'info', ms);
export const warn = (msg, ms) => toast(msg, 'warn', ms);
export const error = (msg, ms) => toast(msg, 'error', ms);
/** สถานะบันทึก/เชื่อมต่อ: สั้น ลำดับต่ำสุด */
export const status = (msg, ms) => toast(msg, 'status', ms);

/**
 * toast ที่มีปุ่ม (เช่น "เลิกทำ") แสดง ms มิลลิวินาที · กดปุ่ม = เรียก onAction
 * สำคัญกว่า toast อื่น: สถานะบันทึกที่เกิดระหว่างนี้จะรอจนกว่าจะปิด
 */
export async function action(msg, button, onAction, ms = 10000) {
  const S = await load();
  if (!S) return fallbackToast(msg, ms, button, onAction);
  pending = null;
  const r = await fireToast(S, { msg, kind: 'action', ms, prio: PRIO.action, confirm: button });
  if (r?.isConfirmed) await onAction();
  drain();
  return !!r?.isConfirmed;
}

/** toast กำลังทำงาน (หมุน) ปิดเองเมื่อเรียก close() หรือเมื่อ toast ถัดไปขึ้น */
export function loading(msg) {
  let closed = false;
  load().then((S) => {
    if (closed) return;
    if (!S) { fallbackToast(msg, 30000); return; }
    if (modalOpen) return;
    fireToast(S, { msg, kind: 'loading', ms: 60000, prio: PRIO.loading });
  });
  return {
    close() {
      closed = true;
      if (Swal && shown?.prio === PRIO.loading && Swal.isVisible()) { shown = null; Swal.close(); }
      else if (failed) hideFallbackToast();
    },
  };
}

// ---------- กล่องโต้ตอบ ----------
async function modal(opts) {
  const S = await load();
  if (!S) return fallbackDialog(opts);
  modalOpen++; pending = null; shown = null;
  try {
    return await S.fire({
      icon: opts.icon, titleText: opts.title, html: opts.html ?? (opts.text ? lines(opts.text) : undefined),
      showCancelButton: opts.cancel !== false, showDenyButton: !!opts.deny,
      confirmButtonText: opts.ok || 'ตกลง', cancelButtonText: opts.cancel || 'ยกเลิก', denyButtonText: opts.deny,
      customClass: { popup: 'tt-swal', confirmButton: 'btn ' + (opts.danger ? 'btn-swal-danger' : 'btn-swal-ok'), cancelButton: 'btn', denyButton: 'btn btn-swal-deny', input: 'input' },
      input: opts.input, inputLabel: opts.inputLabel, inputPlaceholder: opts.placeholder, inputValue: opts.value ?? '',
      inputAttributes: opts.inputAttributes, inputValidator: opts.validate,
      preConfirm: opts.read ? () => { const v = opts.read(S.getPopup()); if (v?.error) { S.showValidationMessage(v.error); return false; } return v; } : undefined,
      returnFocus: true, allowOutsideClick: opts.outside ?? true, allowEscapeKey: opts.outside ?? true, focusConfirm: !opts.input && !opts.danger, focusCancel: !!opts.danger && !opts.input,
      didOpen: opts.didOpen,
    });
  } finally { modalOpen--; setTimeout(drain, 50); }
}

/** แจ้งเตือนมีปุ่มตกลงปุ่มเดียว */
export async function alertBox(title, text, icon = 'info') { await modal({ title, text, icon, cancel: false }); }
/** ยืนยัน → true/false */
export async function confirm({ title, text, html, ok = 'ตกลง', cancel = 'ยกเลิก', icon = 'question' }) {
  return !!(await modal({ title, text, html, ok, cancel, icon }))?.isConfirmed;
}
/** ยืนยัน 3 ทาง → 'confirm' | 'deny' | null (ยกเลิก/ปิด) */
export async function choose({ title, text, html, ok, deny, cancel = 'ยกเลิก', icon = 'question', outside = false }) {
  const r = await modal({ title, text, html, ok, deny, cancel, icon, outside });
  return r?.isConfirmed ? 'confirm' : r?.isDenied ? 'deny' : null;
}
/**
 * ยืนยันการลบที่อันตราย: ต้องพิมพ์คำ (ค่าเริ่มต้น "ลบ") ให้ตรงก่อนจึงกดปุ่มลบได้
 */
export async function confirmDanger({ title, text, html, word = 'ลบ', ok = 'ลบ' }) {
  const r = await modal({
    title, icon: 'warning', danger: true, ok, html: (html ?? lines(text)) + `<p class="tt-swal-type">พิมพ์คำว่า <b>${esc(word)}</b> เพื่อยืนยัน</p>`,
    input: 'text', placeholder: 'พิมพ์ที่นี่', inputAttributes: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `พิมพ์คำว่า ${word} เพื่อยืนยัน` },
    validate: (v) => (String(v || '').trim() === word ? undefined : `พิมพ์คำว่า “${word}” ให้ตรงก่อน`),
  });
  return !!r?.isConfirmed;
}
/** ฟอร์มสั้น ๆ ในกล่อง: html มีช่องกรอก · read(root) คืนค่า หรือ { error } ให้แสดงใต้ฟอร์ม → ค่า หรือ null ถ้ายกเลิก */
export async function form({ title, html, ok = 'ตกลง', read }) {
  const r = await modal({ title, html, ok, read, didOpen: (el) => el.querySelector('input,select,textarea')?.focus() });
  return r?.isConfirmed ? r.value : null;
}
/** ถามข้อความ → string หรือ null */
export async function prompt({ title, text, value = '', placeholder = '', ok = 'ตกลง' }) {
  const r = await modal({ title, text, input: 'text', value, placeholder, ok, validate: (v) => (String(v || '').trim() ? undefined : 'กรุณากรอกข้อมูล') });
  return r?.isConfirmed ? String(r.value).trim() : null;
}

// ---------- ตัวสำรอง (โหลด Swal ไม่ได้) ----------
let fbTimer = null;
function fbEl() {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    el.setAttribute('role', 'status'); el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}
function hideFallbackToast() { const el = document.getElementById('toast'); if (el) el.hidden = true; }
function fallbackToast(msg, ms, button, onAction) {
  const el = fbEl();
  el.textContent = String(msg);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(fbTimer); el.hidden = true; resolve(v); };
    if (button) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm', textContent: button });
      b.addEventListener('click', async () => { finish(true); await onAction?.(); });
      el.append(' ', b);
    }
    el.hidden = false;
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => finish(false), ms);
  });
}
/** กล่องโต้ตอบสำรองด้วย <dialog> (Esc = ยกเลิก, Enter = ตกลง) */
function fallbackDialog(o) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'card dlg';
    const html = o.html ?? (o.text ? lines(o.text) : '');
    dlg.innerHTML = `<form method="dialog" style="display:grid;gap:12px">
      ${o.title ? `<h3 style="font-size:1.1rem">${esc(o.title)}</h3>` : ''}<div>${html}</div>
      ${o.input ? `<input class="input" name="v" autocomplete="off" placeholder="${esc(o.placeholder || '')}" value="${esc(o.value || '')}"><span class="hint" data-err role="alert"></span>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        ${o.cancel !== false ? `<button class="btn" value="cancel" formnovalidate>${esc(o.cancel || 'ยกเลิก')}</button>` : ''}
        ${o.deny ? `<button class="btn" value="deny">${esc(o.deny)}</button>` : ''}
        <button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(o.ok || 'ตกลง')}</button></div></form>`;
    document.body.appendChild(dlg);
    const inp = dlg.querySelector('input[name=v]');
    let readValue;
    dlg.querySelector('form').addEventListener('submit', (e) => {
      const v = e.submitter?.value;
      if (v === 'ok' && o.read) {
        readValue = o.read(dlg);
        if (readValue?.error) { e.preventDefault(); alertLine(dlg, readValue.error); }
      }
      if (v === 'ok' && inp && o.validate) {
        const msg = o.validate(inp.value);
        if (msg) { e.preventDefault(); dlg.querySelector('[data-err]').textContent = msg; inp.focus(); }
      }
    });
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      dlg.remove();
      resolve({ isConfirmed: v === 'ok', isDenied: v === 'deny', isDismissed: v !== 'ok' && v !== 'deny', value: o.read ? readValue : inp ? inp.value : undefined });
    }, { once: true });
    dlg.showModal();
    (inp || dlg.querySelector(o.danger ? 'button[value=cancel]' : 'button[value=ok]'))?.focus();
  });
}

function alertLine(dlg, msg) {
  let el = dlg.querySelector('[data-err-form]');
  if (!el) { el = Object.assign(document.createElement('p'), { className: 'hint' }); el.dataset.errForm = ''; el.setAttribute('role', 'alert'); el.style.color = 'var(--danger)'; dlg.querySelector('form').insertBefore(el, dlg.querySelector('form').lastElementChild); }
  el.textContent = msg;
}

/** สำหรับทดสอบ: ใช้ตัวสำรองแล้วหรือยัง */
export const usingFallback = () => failed;
