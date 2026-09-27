<?php
// ลงทะเบียนโรงเรียน (หลังล็อกอินด้วย Google/LINE ครั้งแรก)
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
require __DIR__ . '/lib/terms.php';

$u = current_user();
if (!$u) redirect('index.php');
if ($u['school_id']) redirect('app.php');

$error = null;
$v = ['name' => '', 'code' => '', 'tambon' => '', 'amphoe' => '', 'province' => '', 'template' => 'sample', 'band' => 'primary'];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    foreach ($v as $k => $_) $v[$k] = trim((string) ($_POST[$k] ?? ''));
    if (!in_array($v['template'], TEMPLATE_KINDS, true)) $v['template'] = 'sample';
    if (!in_array($v['band'], [...SUBJECT_BANDS, 'none'], true)) $v['band'] = 'primary';
    if (mb_strlen($v['name']) < 3) $error = 'กรุณากรอกชื่อโรงเรียน';
    elseif ($v['province'] === '') $error = 'กรุณาเลือกจังหวัด';
    elseif (mb_strlen($v['name']) > 200) $error = 'ชื่อโรงเรียนยาวเกินไป';
    if (!$error) {
        db_exec('INSERT INTO schools (name, school_code, tambon, amphoe, province, created_at) VALUES (?,?,?,?,?,?)',
            [$v['name'], $v['code'] ?: null, $v['tambon'] ?: null, $v['amphoe'] ?: null, $v['province'], now()]);
        $sid = (int) db()->lastInsertId();
        db_exec('UPDATE users SET school_id = ?, role = ? WHERE id = ?', [$sid, 'owner', $u['id']]);
        create_term($sid, (int) $u['id'], $v['template'], 'ภาคเรียนที่ 1/' . ((int) date('Y') + 543), $v['template'] === 'blank' ? $v['band'] : null);
        redirect('app.php');
    }
}

page_head('ลงทะเบียนโรงเรียน · ตารางบริบูรณ์', '<style>
  .top { display:flex; justify-content:space-between; align-items:center; padding-block:18px; }
  .box { max-width:640px; margin:12px auto 48px; padding:28px; display:grid; gap:18px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .who { display:flex; gap:10px; align-items:center; }
  .who img { width:36px; height:36px; border-radius:50%; }
  .tpl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
  .tpl label { border:1px solid var(--line); border-radius:10px; padding:12px; cursor:pointer; display:grid; gap:2px; }
  .tpl input { margin:0 6px 0 0; }
  .tpl label:has(input:checked) { border-color:var(--blue); background:var(--blue-soft); }
  @media (max-width:560px) { .grid2, .tpl { grid-template-columns:minmax(0,1fr); } }
</style>');
?>
<main class="wrap">
  <header class="top"><?= brand_html() ?><span class="muted">ขั้นตอนสุดท้าย</span></header>
  <form class="card box" method="post" autocomplete="off">
    <div>
      <h1 style="font-size:1.6rem">ลงทะเบียนโรงเรียน</h1>
      <p class="muted" style="margin:6px 0 0">พิมพ์ชื่อจังหวัดก่อน แล้วเลือกโรงเรียนจากรายการ ถ้าไม่มีในรายการพิมพ์ชื่อเองได้เลย</p>
    </div>
    <div class="who">
      <?php if ($u['avatar']): ?><img src="<?= h($u['avatar']) ?>" alt=""><?php endif; ?>
      <span>เข้าสู่ระบบเป็น <b><?= h($u['name'] ?: 'ผู้ใช้') ?></b> ผ่าน <?= $u['provider'] === 'line' ? 'LINE' : 'Google' ?></span>
    </div>
    <?php if ($error): ?><div class="flash"><?= h($error) ?></div><?php endif; ?>
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="code" id="code" value="<?= h($v['code']) ?>">

    <div class="field">
      <label for="province">จังหวัด</label>
      <input class="input" id="province" name="province" list="dl-province" required value="<?= h($v['province']) ?>" placeholder="เช่น นครพนม">
      <datalist id="dl-province"></datalist>
    </div>
    <div class="field">
      <label for="name">ชื่อโรงเรียน</label>
      <input class="input" id="name" name="name" list="dl-school" required value="<?= h($v['name']) ?>" placeholder="พิมพ์บางส่วนของชื่อ เช่น นาทม">
      <datalist id="dl-school"></datalist>
      <span class="hint" id="school-hint"></span>
    </div>
    <div class="grid2">
      <div class="field">
        <label for="amphoe">อำเภอ / เขต</label>
        <input class="input" id="amphoe" name="amphoe" list="dl-amphoe" value="<?= h($v['amphoe']) ?>">
        <datalist id="dl-amphoe"></datalist>
      </div>
      <div class="field">
        <label for="tambon">ตำบล / แขวง</label>
        <input class="input" id="tambon" name="tambon" list="dl-tambon" value="<?= h($v['tambon']) ?>">
        <datalist id="dl-tambon"></datalist>
      </div>
    </div>

    <div class="field">
      <label>เริ่มต้นด้วย</label>
      <div class="tpl">
        <label><span><input type="radio" name="template" value="sample-primary" <?= $v['template'] === 'sample-primary' ? 'checked' : '' ?>><b>ตัวอย่างประถม</b></span><span class="hint">ป.1–ป.6 ชั้นละห้อง ครู 9 คน วิชาตามหลักสูตรแกนกลาง ลองจัดได้ทันที</span></label>
        <label><span><input type="radio" name="template" value="sample" <?= $v['template'] === 'sample' ? 'checked' : '' ?>><b>ตัวอย่างมัธยม</b></span><span class="hint">ม.1–ม.6 ชั้นละ 2 ห้อง ครู 20 คน ลองจัดได้ทันที</span></label>
        <label><span><input type="radio" name="template" value="blank" <?= $v['template'] === 'blank' ? 'checked' : '' ?>><b>ตารางว่าง</b></span><span class="hint">5 วัน 8 คาบ แล้วกรอกห้อง ครู การสอนเอง</span></label>
      </div>
      <div class="field" id="band-field" style="margin-top:6px">
        <label for="band">รายวิชาพื้นฐานที่ใส่มาให้ (เฉพาะตารางว่าง)</label>
        <select class="input" id="band" name="band">
          <?php foreach (['primary' => 'ประถมศึกษา ป.1–ป.6', 'lower' => 'มัธยมศึกษาตอนต้น ม.1–ม.3', 'upper' => 'มัธยมศึกษาตอนปลาย ม.4–ม.6', 'none' => 'ไม่ต้องใส่ กรอกวิชาเอง'] as $k => $t): ?>
            <option value="<?= $k ?>" <?= $v['band'] === $k ? 'selected' : '' ?>><?= $t ?></option>
          <?php endforeach; ?>
        </select>
      </div>
    </div>
    <button class="btn btn-primary" type="submit" style="justify-self:start;padding:11px 22px">ลงทะเบียนและเริ่มใช้งาน</button>
    <p class="hint" style="margin:0">เมื่อกดลงทะเบียน ถือว่าคุณยอมรับ<a href="terms.php" target="_blank" rel="noopener">ข้อกำหนดการใช้งาน</a>และ<a href="privacy.php" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a></p>
  </form>
</main>
<script type="module">
import { attachGeo } from './assets/geo.js?v=<?= (int) @filemtime(APP_ROOT . '/assets/geo.js') ?>';
const $ = (id) => document.getElementById(id);
attachGeo({ province: $('province'), name: $('name'), amphoe: $('amphoe'), tambon: $('tambon'), code: $('code'), hint: $('school-hint') });
// ช่องเลือกรายวิชาแสดงเฉพาะตอนเลือกตารางว่าง
const syncBand = () => { $('band-field').hidden = document.querySelector('input[name=template]:checked')?.value !== 'blank'; };
document.querySelectorAll('input[name=template]').forEach((r) => r.addEventListener('change', syncBand));
syncBand();
</script>
<?php page_foot();
