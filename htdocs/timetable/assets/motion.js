// motion.js — ตัวช่วยแอนิเมชันกลางของตารางบริบูรณ์ (ES module ไม่มี dependency · import ใน node ได้ ไม่ throw แม้ไม่มี DOM)
// ใช้คู่กับ assets/motion.css (tokens --d-*, --e-*, --spring-* และ class m-*) · คู่มือเต็ม docs/redesign-2026-10/MOTION-API.md
// วิธีใช้: import * as motion from './motion.js'
//
// กติกาทุก API: เคารพ still() (prefers-reduced-motion หรือ html.tt-still) → ไม่เคลื่อนไหว แต่ "ผลปลายทาง" ต้องเกิดครบ
// (เช่น countUp ใส่เลขปลายทันที) · ใช้ transform/opacity · ไม่มี setTimeout ต่อชิ้น (ใช้ WAAPI delay) · state เก็บใน WeakMap
//
// still()                          → true เมื่อผู้ใช้ขอลดการเคลื่อนไหว (OS) หรือกดปุ่ม "หยุดภาพเคลื่อนไหว" (html.tt-still)
// play(el, keyframes, opts)        → el.animate(keyframes, {fill:'none', duration:320, easing:EASE.out, ...opts}) คืน Animation
//                                    still()/ไม่มี el.animate → stub {finished:Promise.resolve(), cancel(){}, finish(){}}
//                                    opts เป็นตัวเลขได้ = duration (ms)
// stagger(els, keyframes, {each=24, max=900, ...opts})
//                                  → play ทุกตัว delay = min(each, max/n) * i (+opts.delay) fill เริ่มต้น 'backwards'
//                                    (ซ่อนไว้ระหว่างรอคิว) คืน Promise เมื่อทุกตัวจบ (ไม่ reject แม้ถูก cancel)
// staggerVars(host, {each=24, max=900})
//                                  → สำหรับ CSS stagger (.m-stagger) ตั้ง --i บนลูกแต่ละตัว และ --step (ms) บน host คืน step
// countUp(el, to, {dur=700, from, fmt})
//                                  → นับเลข from→to ใน el.textContent ด้วย rAF เดียวต่อ element (tabular-nums)
//                                    ตั้ง el.dataset.to = to ทันที · เรียกซ้อน = ยกเลิกรอบก่อน · still()/ไม่มี rAF/แท็บซ่อน → ใส่ค่าปลายทันที
//                                    fmt(n) แปลงตัวเลขเป็นข้อความ (เช่น n => `เหลือ ${n} คาบ`) · from ไม่ใส่ = อ่านเลขจากข้อความเดิม
// confetti(host, {n=32, colors, dur=1800})
//                                  → คอนเฟตติ (ทอง/ฟ้า/ชมพู/ทองเข้ม ไม่มีเขียว) ในกล่อง .m-confetti ที่ใส่ใน host (host ต้อง position ไม่ใช่ static)
//                                    ลบตัวเองเมื่อจบ · ≤ 1 ครั้ง/15 วิ/host · still() → ไม่ทำ · คืน Promise<boolean> (true = ได้เล่น)
// once(el, cls)                    → ใส่ class แล้วลบเมื่อ animationend/animationcancel (เรียกซ้ำ = เริ่มใหม่) · still() → ไม่ใส่ · คืน Promise
// pulse/shake/pop/nod/flash(el)    → once(el, 'm-pulse' | 'm-shake' | 'm-pop' | 'm-nod' | 'm-flash')
// flyTo(fromEl, toEl, {html='', dur=520, easing})
//                                  → ghost .m-ghost (position:fixed ไม่รับคลิก) จากตำแหน่ง fromEl ลอยไปลง toEl ด้วย transform เท่านั้น (FLIP)
//                                    html = เนื้อใน ghost เป็นสตริง HTML (ผู้เรียกต้อง esc() ข้อความผู้ใช้เอง) หรือ Node · ว่าง = โคลน fromEl · ลบเองเมื่อจบ
//                                    still()/arg เป็น null → resolve ทันที ไม่สร้าง ghost · คืน Promise
// viewTransition(fn)               → document.startViewTransition(fn) เมื่อมีและไม่ still() ไม่งั้นเรียก fn() ตรง ๆ · คืน Promise
// hint(selector)                   → ชี้ปุ่มถัดไป: ล้าง hint เดิมทั้งหน้า แล้วปุ่มใหม่ได้ data-next-hint + .m-pulse (3 รอบ จาก CSS)
//                                    still() → .m-hint-still (ขอบทองค้าง) · ไม่พบ/selector ผิด/null → แค่ล้าง · คืน element หรือ null
//                                    (ไม่แตะ data-next-hint ของ <body> ซึ่ง mascot.js ใช้เก็บ selector)
// skipScene(root=document)         → finish() ทุก animation ใต้ [data-m="scene"] (ผู้ใช้คลิกระหว่างฉาก reveal) คืนจำนวนที่จบ
// EASE                             → easing สำหรับ WAAPI (CSS var ใช้ใน el.animate ไม่ได้): out/in/io/springSoft/springPop

const doc = () => globalThis.document;
const E_OUT = 'cubic-bezier(.2,.8,.2,1)';
const SPRING_SOFT = 'linear(0,.013,.05 2.6%,.188 6.5%,.479 12.6%,.742 19.1%,.869 23.2%,.961 27.5%,1.012 31.9%,1.038 36.7%,1.044 42.4%,1.025 56.5%,1.004 76.3%,1)';
const SPRING_POP = 'linear(0,.009,.035 2.1%,.141,.281 6.7%,.723 12.9%,.938 16.7%,1.017,1.077,1.121,1.149 24.3%,1.159,1.163,1.161,1.154 29.9%,1.129 32.8%,1.051 39.6%,1.017 43.1%,.991,.977 51%,.974 53.8%,.975 57.1%,.997 69.8%,1.003 76.9%,1)';
const hasLinear = (() => { try { return !!globalThis.CSS?.supports?.('animation-timing-function', 'linear(0,1)'); } catch { return false; } })();

export const EASE = Object.freeze({
  out: E_OUT,
  in: 'cubic-bezier(.4,0,1,1)',
  io: 'cubic-bezier(.65,0,.35,1)',
  springSoft: hasLinear ? SPRING_SOFT : E_OUT,
  springPop: hasLinear ? SPRING_POP : 'cubic-bezier(.34,1.56,.64,1)',
});

export function still() {
  try {
    if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch { /* เบราว์เซอร์เก่า */ }
  return !!doc()?.documentElement?.classList?.contains('tt-still');
}

const stub = () => ({ finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {} });
const settle = (a) => Promise.resolve(a && a.finished).then(() => {}, () => {});

export function play(el, keyframes, opts = {}) {
  if (!el || typeof el.animate !== 'function' || still()) return stub();
  const o = typeof opts === 'number' ? { duration: opts } : (opts || {});
  try { return el.animate(keyframes, { duration: 320, easing: E_OUT, fill: 'none', ...o }); } catch { return stub(); }
}

export function stagger(els, keyframes, { each = 24, max = 900, ...opts } = {}) {
  const list = Array.from(els || []).filter(Boolean);
  if (!list.length || still()) return Promise.resolve();
  const step = Math.min(each, max / list.length);
  const base = Number(opts.delay) || 0;
  return Promise.all(list.map((el, i) => settle(play(el, keyframes, { fill: 'backwards', ...opts, delay: base + step * i })))).then(() => {});
}

export function staggerVars(host, { each = 24, max = 900 } = {}) {
  const kids = host?.children ? Array.from(host.children) : [];
  if (!kids.length) return 0;
  const step = Math.min(each, max / kids.length);
  host.style?.setProperty?.('--step', step + 'ms');
  kids.forEach((k, i) => k.style?.setProperty?.('--i', String(i)));
  return step;
}

const counting = new WeakMap(); // el → {id, done}
const numIn = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };

export function countUp(el, to, { dur = 700, from, fmt = (n) => String(n) } = {}) {
  if (!el) return Promise.resolve();
  const end = Number(to) || 0;
  const prev = counting.get(el);
  if (prev) { try { globalThis.cancelAnimationFrame?.(prev.id); } catch { /* */ } counting.delete(el); prev.done(); }
  let start = from != null ? Number(from) : numIn(el.textContent);
  if (!Number.isFinite(start)) start = 0;
  const dec = (String(end).split('.')[1] || '').length;
  const show = (n) => { el.textContent = fmt(dec ? Number(n.toFixed(dec)) : Math.round(n)); };
  try { if (el.dataset) el.dataset.to = String(end); } catch { /* */ }
  try { if (el.style) el.style.fontVariantNumeric = 'tabular-nums'; } catch { /* */ }
  const raf = globalThis.requestAnimationFrame;
  if (still() || typeof raf !== 'function' || !(dur > 0) || start === end || doc()?.hidden) { show(end); return Promise.resolve(); }
  return new Promise((resolve) => {
    const run = { id: 0, done: resolve };
    counting.set(el, run);
    let t0 = 0;
    const tick = (t) => {
      if (counting.get(el) !== run) return;
      if (!t0) t0 = t;
      const k = Math.min(1, (t - t0) / dur);
      if (k >= 1) { show(end); counting.delete(el); resolve(); return; }
      show(start + (end - start) * (1 - Math.pow(1 - k, 3)));
      run.id = raf(tick);
    };
    run.id = raf(tick);
  });
}

const lastConfetti = new WeakMap(); // host → เวลาล่าสุด (ms)
export function confetti(host, { n = 32, colors = ['#E3B85A', '#7FB0E8', '#F0A6BD', '#C8962E'], dur = 1800 } = {}) {
  const d = doc();
  if (!host || !d || typeof host.appendChild !== 'function' || still()) return Promise.resolve(false);
  const now = Date.now();
  if (now - (lastConfetti.get(host) ?? -Infinity) < 15000) return Promise.resolve(false);
  lastConfetti.set(host, now);
  const box = d.createElement('span');
  box.className = 'm-confetti';
  box.setAttribute('aria-hidden', 'true');
  const h = Math.max(240, host.getBoundingClientRect?.().height || 0);
  const frag = d.createDocumentFragment();
  const bits = [];
  for (let i = 0; i < n; i++) {
    const b = d.createElement('i');
    const s = 6 + Math.random() * 4;
    b.style.cssText = `left:${(4 + Math.random() * 92).toFixed(1)}%;width:${s.toFixed(1)}px;height:${(s * (Math.random() < .5 ? 1 : 1.6)).toFixed(1)}px;background:${colors[i % colors.length]}`;
    frag.appendChild(b);
    bits.push(b);
  }
  box.appendChild(frag);
  host.appendChild(box);
  const anims = bits.map((b) => {
    const dx = (Math.random() - .5) * 120, dy = h * (.55 + Math.random() * .45), r = (Math.random() - .5) * 900;
    return play(b, [
      { transform: 'translate(0,-12px) rotate(0deg)', opacity: 1 },
      { transform: `translate(${(dx * .6).toFixed(1)}px,${(dy * .45).toFixed(1)}px) rotate(${(r * .5).toFixed(0)}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${r.toFixed(0)}deg)`, opacity: 0 },
    ], { duration: dur * (.7 + Math.random() * .22), delay: Math.random() * dur * .08, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'backwards' });
  });
  return Promise.all(anims.map(settle)).then(() => { box.remove(); return true; });
}

export function once(el, cls) {
  if (!el || !cls || !el.classList || still()) return Promise.resolve();
  el.classList.remove(cls);
  void el.offsetWidth; // บังคับเริ่มแอนิเมชันใหม่เมื่อเรียกซ้ำ
  el.classList.add(cls);
  return new Promise((resolve) => {
    const done = (e) => {
      if (e && e.target !== el) return; // แอนิเมชันของลูกที่ bubble ขึ้นมา
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
      el.classList.remove(cls);
      resolve();
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
  });
}
export const pulse = (el) => once(el, 'm-pulse');
export const shake = (el) => once(el, 'm-shake');
export const pop = (el) => once(el, 'm-pop');
export const nod = (el) => once(el, 'm-nod');
export const flash = (el) => once(el, 'm-flash');

export function flyTo(fromEl, toEl, { html = '', dur = 520, easing = E_OUT } = {}) {
  const d = doc();
  if (!fromEl || !toEl || !d?.body || typeof fromEl.getBoundingClientRect !== 'function' || typeof toEl.getBoundingClientRect !== 'function' || still()) return Promise.resolve();
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width && !a.height) return Promise.resolve();
  const g = d.createElement('div');
  g.className = 'm-ghost';
  g.setAttribute('aria-hidden', 'true');
  if (html && typeof html === 'object' && html.nodeType) g.appendChild(html);
  else if (html) g.innerHTML = String(html);
  else {
    const c = fromEl.cloneNode(true);
    c.removeAttribute?.('id');
    c.querySelectorAll?.('[id]').forEach((x) => x.removeAttribute('id'));
    g.style.width = a.width + 'px';
    g.style.height = a.height + 'px';
    g.appendChild(c);
  }
  g.style.transform = `translate(${a.left}px,${a.top}px)`;
  d.body.appendChild(g);
  const r = g.getBoundingClientRect(); // วัดครั้งเดียว (ขนาดจริงของ ghost)
  const gw = r.width || a.width, gh = r.height || a.height;
  const x0 = a.left + (a.width - gw) / 2, y0 = a.top + (a.height - gh) / 2;
  const s = Math.max(.25, Math.min(1.25, Math.min(b.width / gw, b.height / gh) || 1));
  const x1 = b.left + (b.width - gw * s) / 2, y1 = b.top + (b.height - gh * s) / 2;
  const lift = Math.min(40, Math.abs(y1 - y0) * .25 + 12);
  const anim = play(g, [
    { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1 },
    { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - lift}px) scale(${(1 + s) / 2 + .04})`, opacity: 1, offset: .5 },
    { transform: `translate(${x1}px,${y1}px) scale(${s})`, opacity: .85 },
  ], { duration: dur, easing, fill: 'forwards' });
  return settle(anim).then(() => g.remove());
}

export function viewTransition(fn) {
  const d = doc();
  const call = () => (typeof fn === 'function' ? fn() : undefined);
  if (d && typeof d.startViewTransition === 'function' && !still()) {
    try { return d.startViewTransition(call).finished.then(() => {}, () => {}); } catch { /* ใช้ทางปกติ */ }
  }
  try { return Promise.resolve(call()).then(() => {}); } catch (e) { return Promise.reject(e); }
}

export function hint(selector) {
  const d = doc();
  if (!d?.querySelectorAll) return null;
  d.querySelectorAll('[data-next-hint]').forEach((el) => {
    if (el === d.body || el === d.documentElement) return;
    el.removeAttribute('data-next-hint');
    el.classList.remove('m-pulse', 'm-hint-still');
  });
  if (!selector) return null;
  let t = null;
  try { t = d.querySelector(selector); } catch { return null; }
  if (!t || t === d.body) return null;
  t.setAttribute('data-next-hint', '');
  if (still()) t.classList.add('m-hint-still');
  else once(t, 'm-pulse');
  return t;
}

export function skipScene(root = doc()) {
  if (!root?.querySelectorAll) return 0;
  const scenes = Array.from(root.querySelectorAll('[data-m="scene"]'));
  if (root.matches?.('[data-m="scene"]')) scenes.unshift(root);
  let n = 0;
  for (const el of scenes) {
    for (const a of (el.getAnimations?.({ subtree: true }) || [])) {
      try { a.finish(); n++; } catch { /* infinite ไม่จบ ข้ามไป */ }
    }
  }
  return n;
}
