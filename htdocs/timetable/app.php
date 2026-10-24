<?php
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
require __DIR__ . '/lib/terms.php';
require __DIR__ . '/lib/admin.php';
[$user, $school] = require_school();
// ฝังรายการภาคเรียน + ภาคเรียนล่าสุดมากับหน้า ตารางขึ้นได้ทันทีโดยไม่ต้องรอ API 2 รอบ
$bootTerms = db_all('SELECT id, name, version, updated_at FROM terms WHERE school_id = ? ORDER BY id DESC', [(int) $school['id']]);
$bootTerm = $bootTerms ? load_term((int) $school['id'], (int) $bootTerms[0]['id']) : null;
$js = fn($v) => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
$v = fn(string $f) => @filemtime(APP_ROOT . '/' . $f);

// import map: ทุกโมดูลได้ ?v=เวลาแก้ไฟล์ — อัปโหลดเวอร์ชันใหม่แล้วเบราว์เซอร์ไม่ใช้ไฟล์เก่าจากแคชปนกับของใหม่
// (import './data.js' ภายในโมดูลถูกแมปผ่าน URL เต็มจึงได้เวอร์ชันด้วย · worker ใช้ import.meta.resolve() อ่านเวอร์ชันจาก map นี้)
$mods = ['store.js', 'rules.js', 'notify.js', 'board.js', 'mascot.js', 'data.js', 'periods.js', 'export.js', 'school.js', 'geo.js', 'curriculum.js', 'wizard.js', 'import.js', 'pdf.js', 'solver/solver.js', 'solver/solver.worker.js'];
$preloadN = 11; // ถึง curriculum.js (wizard.js/import.js/pdf.js/solver โหลดทีหลัง)
$map = [];
foreach ($mods as $m) $map['./assets/' . $m] = './assets/' . $m . '?v=' . $v('assets/' . $m);
$importMap = '<script type="importmap" nonce="' . csp_nonce() . '">' . $js(['imports' => $map]) . '</script>';
// ฝัง board.css และ preload โมดูลที่ใช้ตอนเปิดหน้า (ไม่ต้องรอ app.js โหลดเสร็จก่อนจึงค่อยเห็น import ถัดไป)
$preload = implode('', array_map(fn($m) => '<link rel="modulepreload" href="' . h($map['./assets/' . $m]) . '">', array_slice($mods, 0, $preloadN)));
// รหัสวิชา → คาบ/สัปดาห์ตามหลักสูตรแกนกลาง (~4KB) ฝังมากับหน้า ใช้เติม subject.perWeek ให้ข้อมูลเก่า โดยไม่ต้องโหลด curriculum.json เพิ่ม (ประหยัด hits)
$curMap = [];
foreach ((json_decode((string) @file_get_contents(APP_ROOT . '/data/curriculum.json'), true)['levels'] ?? []) as $lv) {
    foreach ($lv['subjects'] ?? [] as $cs) if (!empty($cs['code']) && (int) ($cs['perWeek'] ?? 0) > 0) $curMap[$cs['code']] = (int) $cs['perWeek'];
}
// ภาพครูบูรณ์ที่มีจริง → mascot.js (ไม่มีไฟล์ = ไม่ขอภาพนั้น ไม่เกิด 404) · ?v = เวลาแก้ไฟล์ เปลี่ยนภาพแล้วไม่ติดแคชเก่า
$mascotV = [];
foreach (glob(APP_ROOT . '/assets/mascot/boon-*.webp') ?: [] as $f) $mascotV[basename($f)] = (int) filemtime($f);
// ป้ายข้อเสนอแนะใหม่ (เฉพาะแอดมิน 1 query ตอนเปิดหน้า)
$fbNew = is_admin($user) ? feedback_new_count() : 0;
// กล่องเลี้ยงโอวัลติน (config donate.promptpay ว่าง = '' → ไม่มีลิงก์ "สนับสนุน") + ฟอร์มข้อเสนอแนะรุ่นย่อ ท้ายแท็บส่งออก
$donateBox = donate_html(['compact' => true, 'h' => 'h3']);
$fbBox = feedback_html(['compact' => true, 'h' => 'h3', 'page' => 'app']);
page_head('จัดตาราง · ' . $school['name'], '<style>' . file_get_contents(APP_ROOT . '/assets/board.css') . '</style>' . $importMap . $preload);
?>
<div id="app" class="app">
  <header class="bar">
    <?= brand_html('app.php') ?>
    <div class="bar-school">
      <img id="school-logo" class="school-logo" alt="" width="28" height="28" <?= $school['logo_rev'] ? 'src="logo.php?v=' . (int) $school['logo_rev'] . '"' : 'hidden' ?>>
      <b id="school-name"><?= h($school['name']) ?></b>
      <select id="term-select" class="input input-sm" aria-label="ภาคเรียน"></select>
    </div>
    <span id="save-state" class="pill" aria-live="polite">กำลังโหลด…</span>
    <div class="bar-user">
      <?php if (is_admin($user)): ?><a class="btn btn-sm" href="<?= $fbNew ? 'admin-feedback.php?s=new' : 'admin.php' ?>"<?= $fbNew ? ' title="มีข้อเสนอแนะใหม่ ' . $fbNew . ' ข้อความ"' : '' ?>>ผู้ดูแลระบบ<?php if ($fbNew): ?><span class="nbadge" aria-label="ใหม่ <?= $fbNew ?> ข้อความ"><?= $fbNew > 99 ? '99+' : $fbNew ?></span><?php endif; ?></a><?php endif; ?>
      <?php // ปุ่มเดียว: กล่องบริจาคกับฟอร์มข้อเสนอแนะอยู่ติดกันในแท็บส่งออก — สองปุ่มทำให้แถบบนจอ 390px ขึ้น 2 แถว ?>
      <?php if ($donateBox !== ''): ?><a class="btn btn-sm bar-support" href="#donate" title="เลี้ยงโอวัลตินครูแจ็ก · ส่งข้อเสนอแนะ · ช่องทางติดต่อ">สนับสนุน·ติดต่อ</a>
      <?php else: ?><a class="btn btn-sm bar-support" href="#feedback">แนะนำ·ติดต่อ</a><?php endif; ?>
      <a class="btn btn-sm" href="../khlang/" title="คลังบริบูรณ์ ทะเบียนครุภัณฑ์ (ใช้บัญชีเดียวกัน)">ครุภัณฑ์</a>
      <a class="btn btn-sm" href="guide.php" target="_blank" rel="noopener">คู่มือ</a>
      <form method="post" action="auth/logout.php">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <button class="btn btn-sm" type="submit" title="<?= h($user['name'] ?? '') ?>">ออกจากระบบ</button>
      </form>
    </div>
  </header>

  <nav class="tabs" role="tablist">
    <button role="tab" data-tab="board" aria-selected="true">จัดตาราง</button>
    <button role="tab" data-tab="periods">โครงคาบ · คาบล็อก</button>
    <button role="tab" data-tab="data">ข้อมูล</button>
    <button role="tab" data-tab="export">ส่งออก</button>
  </nav>
  <div id="boon" class="boon" hidden></div><!-- ครูบูรณ์ (assets/mascot.js) · อยู่นอก <main> ไม่ถูกวาดใหม่ตอนกระดานเปลี่ยน แอนิเมชันจึงไม่สะดุด -->

  <main>
    <section id="tab-board" class="tab" role="tabpanel"></section>
    <section id="tab-periods" class="tab" role="tabpanel" hidden></section>
    <section id="tab-data" class="tab" role="tabpanel" hidden></section>
    <section id="tab-export" class="tab" role="tabpanel" hidden></section>
  </main>
  <!-- ท้ายแท็บส่งออก: export.js ย้ายกล่องนี้เข้าไปตอนวาดแท็บ (ย้ายทั้งก้อน ข้อความที่พิมพ์ค้างไม่หาย) · #donate/#feedback เปิดแท็บส่งออกให้เอง -->
  <div id="tt-support" class="tt-support" hidden>
    <?= $donateBox !== '' ? mascot_img('boon-ovaltine-420.webp', 420, 630, 'tt-support-art') : '' ?>
    <?= $donateBox ?>
    <?= $fbBox ?>
    <p class="tt-support-foot"><button type="button" class="btn btn-sm" data-still aria-pressed="false">หยุดภาพเคลื่อนไหว</button><span class="hint">ปิดการขยับของครูบูรณ์และคอนเฟตติ (จำค่าไว้ในเครื่องนี้)</span></p>
  </div>
  <div id="toast" class="toast" role="status" hidden></div>
</div>
<script nonce="<?= csp_nonce() ?>">window.TT = { csrf: <?= json_encode(csrf_token()) ?>, school: <?= $js(school_public($school)) ?>, owner: <?= is_owner($user) ? 'true' : 'false' ?>, flash: <?= $js(flash()) ?>, flashKind: <?= $js(flash_kind()) ?>, cur: <?= $js($curMap ?: new stdClass()) ?>, boot: <?= $js(['terms' => $bootTerms, 'term' => $bootTerm]) ?>, mascot: <?= $js($mascotV ?: new stdClass()) ?> };</script>
<script type="module" nonce="<?= csp_nonce() ?>" src="assets/app.js?v=<?= $v('assets/app.js') ?>"></script>
<?php page_foot();
