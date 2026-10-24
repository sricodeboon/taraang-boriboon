// ส่วนร่วมหน้าเว็บ (component ใน lib/layout.php): กล่องเลี้ยงโอวัลติน #donate · ปุ่มคัดลอก · ฟอร์มข้อเสนอแนะ · ปุ่มหยุดภาพเคลื่อนไหว
// - page_head()/page_foot() โหลดไฟล์นี้เองเมื่อหน้ามี component · หน้าที่วาง markup ทีหลัง (เช่น แท็บส่งออกในแอป) เรียก init(กล่องนั้น) ซ้ำได้
// - ผูกปุ่มครั้งเดียวต่อ element (data-tt-bound) โหลดโมดูลซ้ำต่าง ?v ก็ไม่ผูกซ้ำ · ไม่มี inline onclick (CSP)

const STILL_KEY = 'tt-still';

/** ผูกครั้งเดียวต่อ element */
function once(el) {
  if (el.dataset.ttBound) return false;
  el.dataset.ttBound = '1';
  return true;
}

// 1) กล่องเลี้ยงโอวัลตินหุบไว้ — กางเองเมื่อมาจากลิงก์ #donate (ปุ่ม Sponsor บน GitHub, ลิงก์ "สนับสนุน" ท้ายหน้า/เมนูแอป)
function openFromHash() {
  const id = location.hash.slice(1);
  if (!id) return;
  const sec = document.getElementById(id);
  const d = sec?.querySelector('details[data-donate]');
  if (!d) return;
  d.open = true;
  // เบราว์เซอร์เลื่อนตาม hash ก่อนกล่องกาง → เลื่อนซ้ำหลังหน้าโหลดเสร็จ (บล็อก { } — Chrome 154 scrollIntoView คืน Promise)
  const go = () => { sec.scrollIntoView({ block: 'start' }); };
  if (document.readyState === 'complete') requestAnimationFrame(go);
  else addEventListener('load', () => { setTimeout(go, 50); }, { once: true });
}

// 2) คัดลอกเบอร์พร้อมเพย์/อีเมล: clipboard API → execCommand (http, LINE in-app) → แสดงข้อความให้กดค้างคัดลอกเอง
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* ไม่มี clipboard API หรือไม่ได้รับอนุญาต */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function bindCopy(btn) {
  if (!once(btn)) return;
  const label = btn.textContent;
  let timer = 0;
  btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    btn.textContent = ok ? (btn.dataset.done || 'คัดลอกแล้ว') : btn.dataset.copy;
    clearTimeout(timer);
    timer = setTimeout(() => { btn.textContent = label; }, ok ? 2000 : 6000);
  });
}

// 3) ฟอร์มข้อเสนอแนะ → feedback.php แบบ fetch (ตอบ JSON {ok,msg}|{ok:false,error}) · ไม่มี JS = POST ธรรมดา
function bindFeedback(form) {
  if (!once(form)) return;
  const box = form.closest('[data-fb]');
  const status = form.querySelector('[data-fb-status]');
  const done = box?.querySelector('[data-fb-done]');
  const btn = form.querySelector('button[type=submit]');
  const say = (msg, err = false) => {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('err', err);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    say('กำลังส่ง…');
    let r;
    try {
      r = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    } catch {
      btn.disabled = false;
      say('ส่งไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วกดส่งอีกครั้งนะครับ', true);
      return;
    }
    // โฮสต์ตอบเป็นหน้าเว็บแทน JSON (เช่น ด่านกันบอตของโฮสต์ฟรี) → ส่งแบบฟอร์มธรรมดาแทน ข้อความไม่หาย
    if (!(r.headers.get('content-type') || '').includes('json')) {
      form.submit();
      return;
    }
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!j.ok) {
      say(j.error || 'ส่งไม่สำเร็จ ลองอีกครั้งนะครับ', true);
      return;
    }
    say('');
    form.reset();
    if (!done) { say(j.msg || 'ได้รับแล้ว ขอบคุณครับ'); return; }
    form.hidden = true;
    done.hidden = false;
    done.focus();
  });

  box?.querySelector('[data-fb-again]')?.addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    form.querySelector('textarea')?.focus();
  });
}

// 4) ปุ่ม "หยุดภาพเคลื่อนไหว" — class tt-still ที่ <html> (สคริปต์ใน <head> ติดให้ก่อน paint จาก localStorage)
export function isStill() {
  return document.documentElement.classList.contains(STILL_KEY);
}

function syncStill() {
  const on = isStill();
  document.querySelectorAll('[data-still]').forEach((b) => {
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'เปิดภาพเคลื่อนไหว' : 'หยุดภาพเคลื่อนไหว';
  });
}

export function setStill(on) {
  document.documentElement.classList.toggle(STILL_KEY, on);
  try {
    if (on) localStorage.setItem(STILL_KEY, '1'); else localStorage.removeItem(STILL_KEY);
  } catch { /* โหมดส่วนตัว/บล็อกที่เก็บข้อมูล: มีผลแค่หน้านี้ */ }
  syncStill();
  // มาสคอต/หน้าแรกฟังเหตุการณ์นี้เพื่อหยุดสิ่งที่ขับด้วย JS (CSS หยุดเองจาก class)
  document.dispatchEvent(new CustomEvent('tt:still', { detail: { on } }));
}

function bindStill(btn) {
  if (!once(btn)) return;
  btn.addEventListener('click', () => { setStill(!isStill()); });
}

// 5) หน้าแรก (DELIGHT §3.1): ตัวเลขโรงเรียนนับขึ้น · ส่วนล่างไหลเข้าเมื่อเลื่อนถึง · ป้าย "จัดครบ 0 ชน" เด้ง + ครูบูรณ์พยักหน้า
//    motion.js โหลดเฉพาะหน้าที่มีของพวกนี้ (หน้าแรก) ไม่เพิ่มคำขอในหน้าอื่น · ลดภาพเคลื่อนไหว/หยุดภาพเคลื่อนไหว = แสดงผลปลายทันที
const reducedMotion = () => isStill() || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let motionP = null;
const motion = () => (motionP ??= import('./motion.js'));

function revealBelow() {
  if (!document.querySelector('.hero') || reducedMotion() || typeof IntersectionObserver !== 'function') return;
  const groups = [...document.querySelectorAll('.sec .feats, .how ol')].map((g) => [...g.children]);
  groups.push(...['.sister', '.support > *'].map((q) => [...document.querySelectorAll(q)]));
  const vh = innerHeight || 800;
  const io = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      e.target.classList.add('is-in');
    }
  }, { threshold: 0.15, rootMargin: '100000px 0px 0px 0px' }); // ขอบบนกว้าง = ที่เลื่อนผ่านไปแล้ว (กระโดดลงท้ายหน้า/ลิงก์ #feedback) ก็แสดง ไม่ค้างซ่อน
  for (const g of groups) {
    let i = 0;
    for (const el of g) {
      // ซ่อนเฉพาะสิ่งที่ยังอยู่ใต้จอ (สิ่งที่เห็นอยู่แล้วไม่กะพริบ) · ลำดับ --i ไล่ทีละใบในกลุ่มเดียวกัน
      if (el.classList.contains('reveal') || el.getBoundingClientRect().top < vh * 0.92) continue;
      el.style.setProperty('--i', String(i++));
      el.classList.add('reveal');
      el.addEventListener('animationend', (ev) => { if (ev.target === el) el.classList.remove('reveal', 'is-in'); }, { once: false });
      io.observe(el);
    }
  }
  // พิมพ์หน้า / กดหยุดภาพเคลื่อนไหวกลางทาง → แสดงทุกอย่างทันที
  const showAll = () => document.querySelectorAll('.reveal').forEach((el) => { io.unobserve(el); el.classList.remove('reveal', 'is-in'); });
  addEventListener('beforeprint', showAll);
  document.addEventListener('tt:still', (e) => { if (e.detail?.on) showAll(); });
}

function heroMotion() {
  const stat = document.querySelector('.stat b[data-count]');
  const badge = document.querySelector('.board-h span');
  if (!stat && !badge) return;
  const n = Number(stat?.dataset.count) || 0;
  motion().then((m) => {
    if (stat && n > 1 && !reducedMotion()) {
      const fmt = new Intl.NumberFormat('th-TH');
      const go = () => m.countUp(stat, n, { dur: 900, from: 0, fmt: (v) => fmt.format(v) });
      if (typeof IntersectionObserver !== 'function') go();
      else {
        const io = new IntersectionObserver((l) => { if (l.some((e) => e.isIntersecting)) { io.disconnect(); go(); } });
        io.observe(stat);
      }
    }
    // ช่องตารางในการ์ดลงครบ (ช่องสุดท้ายเล่นจบ) → ป้ายเด้ง 1 ครั้ง + ครูบูรณ์พยักหน้า
    const cells = document.querySelectorAll('.board .cell');
    const last = cells[cells.length - 1];
    const anims = last?.getAnimations?.() || [];
    Promise.all(anims.map((a) => a.finished)).then(() => {
      m.pop(badge);
      const boon = document.querySelector('.hero-art .boon');
      if (boon) m.nod(boon);
    }, () => {});
  }, () => { /* โหลด motion.js ไม่ได้ = ตัวเลขจริงแสดงอยู่แล้ว */ });
}

/** ผูกทุกอย่างใน root (ค่าเริ่มต้นทั้งหน้า) · เรียกซ้ำได้หลังวาง markup ใหม่ */
export function init(root = document) {
  root.querySelectorAll('[data-copy]').forEach(bindCopy);
  root.querySelectorAll('form[data-feedback]').forEach(bindFeedback);
  root.querySelectorAll('[data-still]').forEach(bindStill);
  syncStill();
  openFromHash();
}

if (!window.__ttHome) {
  window.__ttHome = true;
  addEventListener('hashchange', openFromHash);
  revealBelow();
  heroMotion();
}
init();
