// แท็บข้อมูล → โรงเรียน: แก้ชื่อ/รหัส/ที่ตั้ง และอัปโหลดโลโก้ (ย่อรูปในเบราว์เซอร์ก่อนส่ง ไม่กิน CPU โฮสต์)
import { esc } from './store.js';
import * as notify from './notify.js';
import { attachGeo } from './geo.js';

const LOGO_SIDE = 256;          // ย่อด้านยาวสุดเหลือเท่านี้
const LOGO_MAX_CHARS = 266_000; // ≈ 200KB หลังถอด base64 (ตรงกับ LOGO_MAX_BYTES ฝั่ง PHP)
let saving = false;             // กำลังส่งโลโก้ (เลือกรูปแล้วบันทึกทันที ไม่มีขั้นกดบันทึกแยก เดิมผู้ใช้เลือกรูปแล้วออกไปก่อนกดบันทึก รูปจึงหาย)

async function post(r, body, retried = false) {
  const res = await fetch('api.php?' + new URLSearchParams({ r }), {
    method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.TT.csrf, Accept: 'application/json' },
  });
  let j = null;
  try { j = await res.json(); } catch { /* ไม่ใช่ JSON */ }
  if (res.status === 419 && !retried) {
    // token เปลี่ยนจากแท็บอื่น → ขอใหม่แล้วลองซ้ำครั้งเดียว
    const me = await (await fetch('api.php?r=me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })).json().catch(() => null);
    if (me?.csrf) { window.TT.csrf = me.csrf; return post(r, body, true); }
  }
  if (res.status === 401) throw new Error('หมดเวลาเข้าสู่ระบบ กรุณารีเฟรชหน้าแล้วเข้าสู่ระบบใหม่');
  if (!res.ok) throw new Error(j?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return j;
}

export const logoUrl = () => (window.TT.school.logoRev ? 'logo.php?v=' + window.TT.school.logoRev : '');

export function render(el) {
  const s = window.TT.school, owner = window.TT.owner;
  const ro = owner ? '' : 'disabled';
  const shown = logoUrl();
  el.innerHTML = `<div class="data-head"><div><h3 style="font-size:1.05rem">ข้อมูลโรงเรียน</h3>
      <p>${owner ? 'ชื่อและโลโก้จะแสดงที่หัวแอป หัวตาราง PDF และทุกชีตใน Excel' : 'เฉพาะเจ้าของโรงเรียน (ผู้ลงทะเบียน) แก้ไขส่วนนี้ได้'}</p></div></div>
    <div class="school-form">
      <div class="field"><label>โลโก้โรงเรียน</label>
        <div class="logo-row">
          <div class="logo-box">${shown ? `<img src="${esc(shown)}" alt="โลโก้โรงเรียน">` : '<span class="hint">ยังไม่มี</span>'}</div>
          ${owner ? `<div style="display:grid;gap:6px">
            <div class="logo-actions">
              <label class="btn btn-sm">${s.logoRev ? 'เปลี่ยนรูป…' : 'เลือกรูป…'}<input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" hidden></label>
              ${s.logoRev && !saving ? '<button class="btn btn-sm btn-danger" id="logo-del">ลบโลโก้</button>' : ''}
              ${saving ? '<span class="hint" role="status">กำลังบันทึกโลโก้…</span>' : ''}
            </div>
            <span class="hint">PNG หรือ JPG · พื้นหลังโปร่งใสจะดูดีที่สุด · ระบบย่อรูปให้เหลือ ${LOGO_SIDE}×${LOGO_SIDE} อัตโนมัติ</span>
          </div>` : ''}
        </div>
      </div>
      <input type="hidden" id="s-code" value="${esc(s.code || '')}">
      <div class="field"><label for="s-province">จังหวัด</label>
        <input class="input" id="s-province" list="dl-s-province" value="${esc(s.province || '')}" ${ro} autocomplete="off"><datalist id="dl-s-province"></datalist></div>
      <div class="field"><label for="s-name">ชื่อโรงเรียน</label>
        <input class="input" id="s-name" list="dl-s-school" value="${esc(s.name)}" ${ro} autocomplete="off"><datalist id="dl-s-school"></datalist>
        <span class="hint" id="s-hint"></span></div>
      <div class="grid2">
        <div class="field"><label for="s-amphoe">อำเภอ / เขต</label>
          <input class="input" id="s-amphoe" list="dl-s-amphoe" value="${esc(s.amphoe || '')}" ${ro} autocomplete="off"><datalist id="dl-s-amphoe"></datalist></div>
        <div class="field"><label for="s-tambon">ตำบล / แขวง</label>
          <input class="input" id="s-tambon" list="dl-s-tambon" value="${esc(s.tambon || '')}" ${ro} autocomplete="off"><datalist id="dl-s-tambon"></datalist></div>
      </div>
      <div class="field"><label for="s-code-view">รหัสโรงเรียน</label>
        <input class="input mono" id="s-code-view" value="${esc(s.code || '')}" ${ro} maxlength="20" placeholder="ถ้ามี (เลือกโรงเรียนจากรายการแล้วจะเติมให้เอง)"></div>
      ${owner ? '<button class="btn btn-primary" id="s-save" style="justify-self:start">บันทึกข้อมูลโรงเรียน</button>' : ''}
    </div>`;
  if (!owner) return;

  const $ = (id) => el.querySelector('#' + id);
  // รหัสที่ geo.js เติมให้ → แสดงในช่องรหัสด้วย · พิมพ์รหัสเองก็ได้
  const code = $('s-code'), codeView = $('s-code-view');
  const syncCode = () => { codeView.value = code.value; };
  attachGeo({ province: $('s-province'), name: $('s-name'), amphoe: $('s-amphoe'), tambon: $('s-tambon'), code, hint: $('s-hint') });
  $('s-name').addEventListener('input', syncCode);
  codeView.addEventListener('input', () => { code.value = codeView.value; });

  $('s-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await post('school.save', {
        name: $('s-name').value, code: codeView.value, province: $('s-province').value, amphoe: $('s-amphoe').value, tambon: $('s-tambon').value,
      });
      window.TT.school = r.school;
      applyHeader();
      notify.ok('บันทึกข้อมูลโรงเรียนแล้ว');
      render(el);
    } catch (err) { notify.error('บันทึกไม่สำเร็จ: ' + err.message); btn.disabled = false; }
  });

  $('logo-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let url;
    try { url = await shrink(f); } catch (err) { notify.warn(err.message); return; }
    saveLogo(el, url);
  });
  $('logo-del')?.addEventListener('click', async () => { if (await notify.confirm({ title: 'ลบโลโก้โรงเรียน?', text: 'โลโก้จะหายจากหัวแอป PDF และ Excel (อัปโหลดใหม่ได้ภายหลัง)', ok: 'ลบโลโก้', icon: 'warning' })) saveLogo(el, null); });
}

async function saveLogo(el, logo) {
  if (saving) return;
  saving = true; render(el);
  const busy = notify.loading(logo ? 'กำลังอัปโหลดโลโก้…' : 'กำลังลบโลโก้…');
  try {
    const r = await post('school.logo', { logo });
    window.TT.school.logoRev = r.logoRev;
    applyHeader();
    busy.close();
    notify.ok(logo ? 'อัปโหลดโลโก้แล้ว แสดงที่หัวแอป PDF และ Excel' : 'ลบโลโก้แล้ว');
  } catch (err) { busy.close(); notify.error('บันทึกโลโก้ไม่สำเร็จ: ' + err.message, 7000); }
  finally { saving = false; render(el); }
}

/** อัปเดตชื่อ/โลโก้ที่หัวแอปทันทีโดยไม่ต้องรีโหลด */
function applyHeader() {
  const s = window.TT.school;
  const name = document.getElementById('school-name'), img = document.getElementById('school-logo');
  if (name) name.textContent = s.name;
  document.title = 'จัดตาราง · ' + s.name;
  if (img) { if (s.logoRev) { img.src = logoUrl(); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } }
}

/** ย่อรูปให้ด้านยาวสุด ≤ LOGO_SIDE แล้วเข้ารหัส PNG (คงพื้นโปร่งใส) ถ้าใหญ่เกินจึงใช้ JPEG พื้นขาว */
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('รองรับเฉพาะรูป PNG, JPG หรือ WebP');
  if (file.size > 10 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 10MB');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('เปิดไฟล์รูปนี้ไม่ได้'); }
  const k = Math.min(1, LOGO_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(16, Math.round(bmp.width * k)), h = Math.max(16, Math.round(bmp.height * k));
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  let url = cv.toDataURL('image/png');
  if (url.length > LOGO_MAX_CHARS) {
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, w, h);
    url = cv.toDataURL('image/jpeg', 0.9);
  }
  if (url.length > LOGO_MAX_CHARS) throw new Error('รูปนี้ย่อแล้วยังใหญ่เกินไป ลองใช้รูปที่เรียบง่ายกว่านี้');
  return url;
}
