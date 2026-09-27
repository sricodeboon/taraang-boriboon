// autocomplete จังหวัด → อำเภอ → ตำบล และรายชื่อโรงเรียนรายจังหวัด (ใช้ร่วมกันในหน้าสมัครและแท็บข้อมูลโรงเรียน)
// f = { province, name, amphoe, tambon, code, hint } — input ต้องผูก datalist ผ่าน attribute list="…"
// base = ที่อยู่โฟลเดอร์ data/ เทียบกับหน้าเว็บ
export function attachGeo(f, base = 'data/') {
  const fill = (inp, items) => inp.list?.replaceChildren(...items.slice(0, 400).map((v) => Object.assign(document.createElement('option'), { value: v })));
  let geo = null, schools = [], loadedProvince = '', dups = new Map();

  fetch(base + 'geo.json').then((r) => r.ok ? r.json() : null).then((g) => {
    if (!g) return;
    geo = g;
    fill(f.province, g.provinces.map((p) => p.n));
    onProvince();
  }).catch(() => {});

  const province = () => geo && geo.provinces.find((p) => p.n === f.province.value.trim());
  const amphoe = () => { const p = province(); return p && p.a.find((a) => a.n === f.amphoe.value.trim()); };

  function onProvince() {
    const p = province();
    fill(f.amphoe, p ? p.a.map((a) => a.n) : []);
    onAmphoe();
    if (p && p.n !== loadedProvince) {
      loadedProvince = p.n;
      fetch(base + 'schools/' + encodeURIComponent(p.n) + '.json').then((r) => r.ok ? r.json() : []).then((list) => {
        schools = Array.isArray(list) ? list : [];
        dups = dupNames();
        if (f.hint) f.hint.textContent = schools.length ? `มีรายชื่อ ${schools.length.toLocaleString('th-TH')} โรงเรียนใน${p.n}` : '';
        onAmphoe();
      }).catch(() => { schools = []; dups = new Map(); });
    }
  }
  function onAmphoe() {
    const a = amphoe();
    fill(f.tambon, a ? a.t : []);
    const inA = f.amphoe.value.trim();
    const list = inA ? schools.filter((s) => s.a === inA) : schools;
    fill(f.name, list.map(label));
  }
  // ชื่อซ้ำในจังหวัดเดียวกัน (คนละโรงเรียน) → ต่อท้ายตำบล/อำเภอให้เลือกถูกตัว
  const dupNames = () => { const seen = new Map(); for (const s of schools) seen.set(s.n, (seen.get(s.n) || 0) + 1); return seen; };
  const label = (s) => dups.get(s.n) > 1 ? `${s.n} · ต.${s.t || '-'} อ.${s.a || '-'}` : s.n;
  function onSchool() {
    const typed = f.name.value.trim();
    let s = schools.find((x) => label(x) === typed);
    if (!s) {
      const same = schools.filter((x) => x.n === typed);
      const inA = f.amphoe.value.trim(), inT = f.tambon.value.trim();
      const narrowed = same.filter((x) => (!inA || x.a === inA) && (!inT || x.t === inT));
      s = narrowed.length === 1 ? narrowed[0] : null;
    }
    if (!s) { f.code.value = ''; return; }
    if (typed !== s.n) f.name.value = s.n;
    f.code.value = s.c || '';
    if (s.a) f.amphoe.value = s.a;
    if (s.t) f.tambon.value = s.t;
    fill(f.tambon, (amphoe() || { t: [] }).t);
  }
  f.province.addEventListener('input', onProvince);
  f.amphoe.addEventListener('input', onAmphoe);
  f.name.addEventListener('input', onSchool);
}
