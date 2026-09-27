// solver.worker.js — module worker สำหรับจัดตารางเบื้องหลัง (ไม่ให้หน้าเว็บค้าง)
//
// ใช้งาน:
//   const w = new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'solve', input, options: { timeLimitMs: 4000, seed: 1 } });
//   w.onmessage = (e) => {
//     e.data.type === 'progress' → { pct (0..1), best: { hardViolations, softScore }, phase, iterations, ms }
//     e.data.type === 'done'     → { result }   (รูปแบบตาม solve())
//     e.data.type === 'error'    → { message }
//   };
// ยกเลิกกลางคัน: w.terminate()
// ส่วนเสริม: { type: 'validate', input, placements } → { type: 'validated', conflicts }

import { solve, validate } from './solver.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'solve') {
      const options = Object.assign({}, msg.options || {}, {
        onProgress: (p) => self.postMessage({ type: 'progress', pct: p.pct, best: p.best, phase: p.phase, iterations: p.iterations, ms: p.ms }),
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
