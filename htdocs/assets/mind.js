/*
 * จิตแห่งโค้ด — อนุภาคลากเส้นแสง รวมเป็นรูปทรง 3 มิติที่เปลี่ยนร่างวนไปเรื่อย ๆ
 * ทรงกลมคลื่น (แบบถ่ายโอนเครื่อง) → สมองสองซีก → ปมเส้นทอ → วังวนเกลียว
 * การเปลี่ยนร่างกวาดจากบนลงล่างเหมือนเส้นสแกน · มีเส้นความคิดวิ่งข้ามรูปทรง
 */
(() => {
  'use strict';

  const canvas = document.getElementById('mind');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const label = document.getElementById('mind-label');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TAU = Math.PI * 2;
  const HOLD = 6.5;      // วินาทีที่ค้างรูปทรง
  const MORPH = 3.2;     // วินาทีที่ใช้เปลี่ยนร่าง
  const CYCLE = HOLD + MORPH;

  // สีแบรนด์: ทองนาค น้ำเงินโขง ชมพูบัว หมอกเช้า
  const PALETTE = ['227,184,90', '127,176,232', '240,166,189', '242,244,241'];
  const WEIGHTS = [0.34, 0.46, 0.08, 0.12];

  let W = 0, H = 0, DPR = 1, N = 0;
  let dir, seed, colorIdx, prevX, prevY, hasPrev;
  const out = [0, 0, 0];

  // ---------- รูปทรง (พิกัดหน่วย รัศมีราว 1) ----------
  function sphereWave(i, t) {
    const x = dir[i * 3], y = dir[i * 3 + 1], z = dir[i * 3 + 2];
    const lat = Math.acos(Math.max(-1, Math.min(1, y)));
    const r = 1 + 0.055 * Math.sin(lat * 14 - t * 2.6) + 0.02 * Math.sin(Math.atan2(z, x) * 6 + t);
    out[0] = x * r; out[1] = y * r; out[2] = z * r;
  }

  function mind(i, t) {
    const x = dir[i * 3], y = dir[i * 3 + 1], z = dir[i * 3 + 2];
    const folds = 0.11 * Math.sin(5.2 * x + 3.1 * y + t * 0.7) * Math.sin(4.3 * y - 2.2 * z)
                + 0.06 * Math.sin(11 * z + 7 * x - t * 0.5);
    const r = 0.92 + folds;
    const side = x >= 0 ? 1 : -1;
    out[0] = x * r * 1.18 + side * 0.1;
    out[1] = y * r * 0.86;
    out[2] = z * r * 1.05;
  }

  function knot(i, t) {
    // ปมทอรัส p=2 q=3 มีความหนาเป็นหลอด
    const s = i / N, phi = s * TAU + t * 0.05;
    const p = 2, q = 3;
    const R = 0.62 + 0.26 * Math.cos(q * phi);
    const cx = R * Math.cos(p * phi), cy = 0.26 * Math.sin(q * phi), cz = R * Math.sin(p * phi);
    const a = seed[i] * TAU, tube = 0.09 + 0.05 * seed[(i * 7) % N];
    out[0] = (cx + Math.cos(a) * tube) * 1.25;
    out[1] = (cy + Math.sin(a) * tube) * 1.25;
    out[2] = (cz + Math.cos(a + 1.3) * tube * 0.6) * 1.25;
  }

  function vortex(i, t) {
    // วังวนเกลียวสามแขน โป่งกลาง ปลายแขนม้วนขึ้น
    const s = seed[i], arm = i % 3;
    const rad = 0.08 + Math.pow(s, 0.62) * 1.12;
    const ang = arm * TAU / 3 + rad * 3.6 - t * 0.35 + (seed[(i * 13) % N] - 0.5) * 0.35;
    const lift = Math.sin(ang * 0.5 + t * 0.6) * 0.12 * rad + (seed[(i * 5) % N] - 0.5) * 0.12 * (1.2 - rad);
    out[0] = Math.cos(ang) * rad;
    out[1] = lift - 0.05;
    out[2] = Math.sin(ang) * rad;
  }

  const SHAPES = [
    { fn: sphereWave, name: 'ทรงกลมถ่ายโอน' },
    { fn: mind,       name: 'สมองสองซีก' },
    { fn: knot,       name: 'ปมเส้นทอ' },
    { fn: vortex,     name: 'วังวนความคิด' },
  ];

  // ---------- เตรียมอนุภาค ----------
  function build() {
    N = Math.round(Math.min(5200, Math.max(1600, (W * H) / 240)));
    if (W < 640) N = Math.min(N, 2400);
    dir = new Float32Array(N * 3);
    seed = new Float32Array(N);
    colorIdx = new Uint8Array(N);
    prevX = new Float32Array(N);
    prevY = new Float32Array(N);
    hasPrev = false;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      dir[i * 3] = Math.cos(th) * r;
      dir[i * 3 + 1] = y;
      dir[i * 3 + 2] = Math.sin(th) * r;
      seed[i] = Math.random();
      let u = Math.random(), c = 0;
      while (c < WEIGHTS.length - 1 && u > WEIGHTS[c]) { u -= WEIGHTS[c]; c++; }
      colorIdx[i] = c;
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
    ctx.fillStyle = '#0B141C';
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- การโต้ตอบ ----------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let pulse = 0, pulseAt = -10;
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / W - 0.5) * 2;
    pointer.ty = (e.clientY / H - 0.5) * 2;
  }, { passive: true });
  canvas.addEventListener('pointerdown', () => { pulse = 1; pulseAt = now; });

  // ---------- เส้นความคิด ----------
  const arcs = [];
  function spawnArc() {
    arcs.push({
      a: (Math.random() * N) | 0,
      b: (Math.random() * N) | 0,
      born: now,
      life: 1.1 + Math.random() * 0.9,
      c: Math.random() < 0.7 ? 0 : 2,
    });
  }

  // ---------- วาด ----------
  const smooth = (k) => k * k * (3 - 2 * k);
  let now = 0, last = 0, labelIdx = -1, running = false;
  let px, py, pz;

  // เครื่องช้าวาดไม่ทัน → ลดจำนวนอนุภาคลงเรื่อย ๆ (ไม่ให้บล็อก main thread/กระตุก)
  let workAvg = 0;
  function adapt(workMs) {
    workAvg = workAvg ? workAvg * 0.8 + workMs * 0.2 : workMs;
    if (workAvg > 10 && N > 500) { N = Math.floor(N * 0.75); workAvg = 0; hasPrev = false; }
  }

  function frame(ms) {
    const t0 = performance.now();
    now = ms / 1000;
    const dt = Math.min(0.05, now - last || 0.016);
    last = now;

    if (!px || px.length !== N) { px = new Float32Array(N); py = new Float32Array(N); pz = new Float32Array(N); }

    // เฟดพื้นหลังทีละนิด ให้เกิดหางเส้นแสง
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = hasPrev ? 'rgba(11,20,28,0.2)' : '#0B141C';
    ctx.fillRect(0, 0, W, H);

    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    pulse *= Math.pow(0.12, dt);

    const cyc = now / CYCLE;
    const cur = Math.floor(cyc) % SHAPES.length;
    const nxt = (cur + 1) % SHAPES.length;
    const inCycle = (cyc - Math.floor(cyc)) * CYCLE;
    const m = Math.max(0, (inCycle - HOLD) / MORPH);           // 0..1 ระหว่างเปลี่ยนร่าง
    const front = -1.6 + m * 3.2;                              // ตำแหน่งเส้นสแกน (บน→ล่าง)
    const showIdx = m > 0.5 ? nxt : cur;
    if (label && showIdx !== labelIdx) { labelIdx = showIdx; label.textContent = SHAPES[showIdx].name; }

    const yaw = now * 0.16 + pointer.x * 0.7;
    const pitch = 0.32 + pointer.y * 0.35;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const narrow = W < 860;
    const scale = narrow ? Math.min(W * 0.4, H * 0.24) : Math.min(W, H) * 0.33;
    const cx = narrow ? W / 2 : W * 0.62, cyScreen = narrow ? H * 0.34 : H * 0.46;
    const persp = 3.4;
    const kick = pulse * 0.28;
    const ripple = now - pulseAt;

    const A = SHAPES[cur].fn, B = SHAPES[nxt].fn;
    for (let i = 0; i < N; i++) {
      A(i, now); let x = out[0], y = out[1], z = out[2];
      if (m > 0) {
        const ax = x, ay = y, az = z;
        B(i, now);
        // การเปลี่ยนร่างไล่จากบนลงล่างตามเส้นสแกน
        const k = smooth(Math.max(0, Math.min(1, (front - dir[i * 3 + 1]) / 0.6 + 0.5)));
        x = ax + (out[0] - ax) * k; y = ay + (out[1] - ay) * k; z = az + (out[2] - az) * k;
      }
      if (kick > 0.001) {
        const d = Math.sqrt(x * x + y * y + z * z) || 1;
        const wave = Math.sin(d * 9 - ripple * 10) * kick;
        x += (x / d) * wave; y += (y / d) * wave; z += (z / d) * wave;
      }
      // หมุน (yaw แล้ว pitch)
      const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const f = persp / (persp - z2);
      px[i] = cx + x1 * scale * f;
      py[i] = cyScreen + y2 * scale * f;
      pz[i] = z2;
    }

    // วาดเส้นแยกตามสีและความลึก เพื่อลดจำนวนคำสั่งวาด
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let band = 0; band < 3; band++) {
      const lo = -1.4 + band * 0.93, hi = lo + 0.93;
      ctx.lineWidth = 0.6 + band * 0.45;
      for (let c = 0; c < PALETTE.length; c++) {
        ctx.strokeStyle = `rgba(${PALETTE[c]},${0.16 + band * 0.26})`;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (colorIdx[i] !== c) continue;
          const z = pz[i];
          if (z < lo || (band < 2 && z >= hi)) continue;
          const x0 = hasPrev ? prevX[i] : px[i] - 0.5, y0 = hasPrev ? prevY[i] : py[i];
          const dx = px[i] - x0, dy = py[i] - y0;
          if (dx * dx + dy * dy > 2500) { ctx.moveTo(px[i] - 0.5, py[i]); ctx.lineTo(px[i] + 0.5, py[i]); continue; }
          ctx.moveTo(x0, y0);
          ctx.lineTo(px[i] + (dx === 0 && dy === 0 ? 0.6 : 0), py[i]);
        }
        ctx.stroke();
      }
    }
    for (let i = 0; i < N; i++) { prevX[i] = px[i]; prevY[i] = py[i]; }
    hasPrev = true;

    // เส้นสแกนระหว่างเปลี่ยนร่าง
    if (m > 0 && m < 1) {
      const yLine = cyScreen + front * scale * 0.95;
      const alpha = Math.sin(m * Math.PI) * 0.55;
      const g = ctx.createLinearGradient(cx - scale * 1.5, 0, cx + scale * 1.5, 0);
      g.addColorStop(0, 'rgba(127,176,232,0)');
      g.addColorStop(0.5, `rgba(127,176,232,${alpha})`);
      g.addColorStop(1, 'rgba(127,176,232,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - scale * 1.5, yLine - 1, scale * 3, 2);
    }

    // เส้นความคิด: โค้งจากจุดหนึ่งไปอีกจุด มีหัวแสงวิ่ง
    if (arcs.length < 12 && Math.random() < dt * 5) spawnArc();
    for (let j = arcs.length - 1; j >= 0; j--) {
      const a = arcs[j];
      const p = (now - a.born) / a.life;
      if (p >= 1) { arcs.splice(j, 1); continue; }
      const ax = px[a.a], ay = py[a.a], bx = px[a.b], by = py[a.b];
      const mx = (ax + bx) / 2 + (cx - (ax + bx) / 2) * 0.35;
      const my = (ay + by) / 2 + (cyScreen - (ay + by) / 2) * 0.35 - 20;
      const head = smooth(Math.min(1, p * 1.4));
      const tail = smooth(Math.max(0, p * 1.4 - 0.4));
      const alpha = Math.sin(p * Math.PI) * 0.8;
      ctx.strokeStyle = `rgba(${PALETTE[a.c]},${alpha})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let s = 0; s <= 16; s++) {
        const u = tail + (head - tail) * (s / 16);
        const qx = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx;
        const qy = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
        s === 0 ? ctx.moveTo(qx, qy) : ctx.lineTo(qx, qy);
      }
      ctx.stroke();
    }

    // วงคลื่นตอนแตะ
    if (ripple < 1.4) {
      const rr = ripple * scale * 1.6;
      ctx.strokeStyle = `rgba(242,244,241,${(1 - ripple / 1.4) * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cyScreen, rr, rr * 0.92, 0, 0, TAU);
      ctx.stroke();
    }

    adapt(performance.now() - t0);
    if (!reduceMotion && !document.hidden) requestAnimationFrame(frame);
    else running = false;
  }

  resize();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); if (reduceMotion) frame(performance.now()); }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !reduceMotion && !running) { running = true; last = performance.now() / 1000; requestAnimationFrame(frame); }
  });

  if (reduceMotion) {
    // ผู้ที่ตั้งค่าลดการเคลื่อนไหว: วาดภาพนิ่งภาพเดียว
    hasPrev = false; frame(2000); frame(2016);
  } else {
    // เริ่มเคลื่อนไหวหลังหน้าโหลดเสร็จ ให้ข้อความและปุ่มขึ้นก่อน
    const start = () => { running = true; last = performance.now() / 1000; requestAnimationFrame(frame); };
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  }
})();
