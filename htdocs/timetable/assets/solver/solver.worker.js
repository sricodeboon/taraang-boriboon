// solver.worker.js — module worker สำหรับจัดตารางเบื้องหลัง (ไม่ให้หน้าเว็บค้าง)
//
// ใช้งาน:
//   const w = new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'solve', input, options: { timeLimitMs: 4000, seed: 1 } });
//   w.onmessage = (e) => {
//     e.data.type === 'progress' → { pct (0..1), best: { hardViolations, softScore }, phase, iterations, ms,
//                                    pctMono (ไม่ถอยหลัง), placed, total,                       ← ใหม่ (optional)
//                                    placements?: [{assignmentId, day, period}] | delta?: {add, remove} }  ← snapshot ของคาบที่วางได้ไม่ชน
//     e.data.type === 'phase'    → { phase: 'greedy'|'hard'|'repair'|'soft', ms }   ← ใหม่: ยิงทันทีเมื่อเปลี่ยน (ไม่ throttle)
//     e.data.type === 'done'     → { result }   (รูปแบบตาม solve())
//     e.data.type === 'error'    → { message }
//   };
// ปิด snapshot: options.progressPlacements = false (หน้าเก่า/เครื่องช้า) · ผู้รับรุ่นเดิมไม่รู้จัก 'phase' ก็ข้ามได้ตามเดิม
// ยกเลิกกลางคัน: w.terminate()
// ส่วนเสริม: { type: 'validate', input, placements } → { type: 'validated', conflicts }

// solver.js โหลดแบบมีเลขเวอร์ชัน (?sv= จาก board.js) — worker ไม่ผ่าน import map ของหน้า ถ้า import ตรง ๆ
// เบราว์เซอร์จะใช้ solver.js เก่าจากแคชหลังอัปเดตเว็บ · รับเฉพาะตัวเลข กันการชี้ไปไฟล์อื่น
const sv = (() => { try { return new URL(self.location.href).searchParams.get('sv'); } catch { return null; } })();
const ready = import('./solver.js' + (sv && /^\d+$/.test(sv) ? '?v=' + sv : ''));

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const { solve, validate } = await ready;
    if (msg.type === 'solve') {
      const options = Object.assign({}, msg.options || {}, {
        onProgress: (p) => {
          const m = { type: 'progress', pct: p.pct, best: p.best, phase: p.phase, iterations: p.iterations, ms: p.ms, pctMono: p.pctMono, placed: p.placed, total: p.total };
          if (p.placements) m.placements = p.placements;
          if (p.delta) m.delta = p.delta;
          self.postMessage(m);
        },
        onPhase: (p) => self.postMessage({ type: 'phase', phase: p.phase, ms: p.ms }),
      });
      const result = solve(msg.input, options);
      self.postMessage({ type: 'done', result });
    } else if (msg.type === 'validate') {
      self.postMessage({ type: 'validated', conflicts: validate(msg.input, msg.placements) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
