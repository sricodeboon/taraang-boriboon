// หน้าผู้ดูแลระบบ: กรองแถวในหน้านี้ทันทีที่พิมพ์ + เรียงคอลัมน์ + สวิตช์แสดงบัญชีแอดมิน/ทดลอง (โหลดหน้าใหม่)
// ไม่มี inline handler (CSP) — ผูกเหตุการณ์ที่นี่ทั้งหมด
const table = document.getElementById('care');
const flt = document.getElementById('flt');
const count = document.getElementById('flt-count');
const all = document.getElementById('all');

// สวิตช์: ส่งฟอร์ม GET ใหม่ (ข้อมูลแอดมิน/ทดลองไม่ได้ส่งมากับหน้าตั้งแต่แรก)
all?.addEventListener('change', () => all.form.submit());

if (table) {
  const tbody = table.tBodies[0];
  const rows = [...tbody.rows];
  const total = rows.length;

  // กรองเฉพาะแถวที่โหลดมาแล้ว (กด Enter/ปุ่ม "ค้นทั้งระบบ" = ค้นในฐานข้อมูล)
  const applyFilter = () => {
    const words = flt.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const tr of rows) {
      const ok = words.every((w) => tr.dataset.q.includes(w));
      tr.hidden = !ok;
      if (ok) shown++;
    }
    count.textContent = words.length ? `แสดง ${shown} จาก ${total} แถวในหน้านี้` : '';
  };
  flt.addEventListener('input', applyFilter);

  // เรียงคอลัมน์: กดซ้ำสลับน้อย→มาก / มาก→น้อย · ข้อความเรียงแบบไทย
  const coll = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
  const heads = [...table.tHead.rows[0].cells];
  heads.forEach((th, col) => {
    const btn = th.querySelector('button');
    btn.addEventListener('click', () => {
      const asc = th.getAttribute('aria-sort') !== 'ascending';
      heads.forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
      const num = btn.dataset.t === 'n';
      const val = (tr) => tr.cells[col].dataset.v ?? '';
      rows.sort((a, b) => {
        const x = val(a), y = val(b);
        // ค่าว่างไว้ท้ายเสมอ
        if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
        const d = num ? Number(x) - Number(y) : coll.compare(x, y);
        return asc ? d : -d;
      });
      tbody.append(...rows);
    });
  });
  if (flt.value) applyFilter();
}
