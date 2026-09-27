// ตัวช่วยหน้าจอเล็ก ๆ ที่ใช้ร่วมกัน
let timer;
export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, ms);
}
