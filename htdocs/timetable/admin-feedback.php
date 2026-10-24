<?php
// ข้อเสนอแนะจากผู้ใช้ (ฟอร์ม #feedback → feedback.php): อ่าน กรอง เปลี่ยนสถานะ จดโน้ต ลบของเก่ากว่า 1 ปี
// เปิดได้เฉพาะบัญชี Google ที่อยู่ในรายการแอดมิน (admin_emails) · คนอื่นได้ 404 เหมือนหน้าไม่มีอยู่จริง · ทุกการแก้เป็น POST + CSRF
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
require __DIR__ . '/lib/admin.php';

header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow');

$me = current_user();
if (!is_admin($me)) admin_not_found();

$status = (string) ($_GET['s'] ?? '');
if (!isset(FEEDBACK_STATUS[$status])) $status = '';
$kind = (string) ($_GET['k'] ?? '');
if (!isset(FEEDBACK_KIND[$kind])) $kind = '';
$page = max(1, (int) ($_GET['page'] ?? 1));

/** ลิงก์หน้าเดิมโดยเปลี่ยนพารามิเตอร์บางตัว (เปลี่ยนตัวกรอง = กลับหน้า 1) */
function fb_url(array $change): string {
    global $status, $kind, $page;
    $p = array_merge(['s' => $status, 'k' => $kind, 'page' => $page > 1 ? $page : null], $change);
    $p = array_filter($p, fn($v) => $v !== null && $v !== '');
    return 'admin-feedback.php' . ($p ? '?' . http_build_query($p) : '');
}

// ---------- การแก้ไข (POST) → กลับหน้าเดิมพร้อม flash (PRG กันส่งซ้ำตอนรีเฟรช) ----------
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    // ตรวจ CSRF เอง: csrf_check() พากลับด้วย back_path() ซึ่งรับเฉพาะชื่อไฟล์ตัวอักษรล้วน (ชื่อหน้านี้มีขีด → ไปหน้าแรก)
    if (!csrf_valid()) { flash('หน้านี้เปิดค้างไว้นานจนหมดเวลา กรุณากดอีกครั้ง'); redirect('admin-feedback.php'); }
    $act = (string) ($_POST['act'] ?? '');
    $back = (string) ($_POST['back'] ?? '');
    if (!preg_match('#^admin-feedback\.php(\?[A-Za-z0-9=&%_.-]*)?$#', $back)) $back = 'admin-feedback.php';
    if ($act === 'save') {
        $id = (int) ($_POST['id'] ?? 0);
        $st = (string) ($_POST['status'] ?? '');
        if (!isset(FEEDBACK_STATUS[$st])) $st = 'read';
        $note = trim(str_replace("\r\n", "\n", is_string($_POST['note'] ?? null) ? $_POST['note'] : ''));
        $note = mb_substr($note, 0, 2000);
        $n = db_exec('UPDATE feedback SET status = ?, note_admin = ? WHERE id = ?', [$st, $note !== '' ? $note : null, $id]);
        flash($n ? 'บันทึกแล้ว · สถานะ “' . FEEDBACK_STATUS[$st] . '”' : 'ไม่พบข้อความนี้ (อาจถูกลบไปแล้ว)', $n ? 'ok' : 'warn');
        redirect($back . '#fb-' . $id);
    }
    if ($act === 'purge') {
        $n = feedback_purge_old();
        flash($n ? 'ลบข้อความที่เก่ากว่า 1 ปีแล้ว ' . number_format($n) . ' ข้อความ' : 'ไม่มีข้อความที่เก่ากว่า 1 ปี', 'ok');
        redirect($back);
    }
    flash('ไม่รู้จักคำสั่งนี้');
    redirect($back);
}

$counts = feedback_counts();
$list = feedback_rows($status, $kind, $page);
$msg = flash();
$msgKind = flash_kind();

page_head('ข้อเสนอแนะ · ผู้ดูแลระบบ · ตารางบริบูรณ์',
    '<meta name="robots" content="noindex, nofollow"><style>' . file_get_contents(APP_ROOT . '/assets/admin.css') . '</style>',
    'ข้อเสนอแนะจากผู้ใช้ตารางบริบูรณ์');
?>
<header class="bar adm-top">
  <?= brand_html('app.php') ?>
  <span class="adm-tag">ผู้ดูแลระบบ</span>
  <nav class="adm-nav">
    <span class="muted adm-me" title="<?= h($me['email']) ?>"><?= h($me['name'] ?? $me['email']) ?></span>
    <a class="btn btn-sm" href="admin.php">ภาพรวม</a>
    <a class="btn btn-sm" href="app.php">กลับไปจัดตาราง</a>
  </nav>
</header>

<main class="adm">
  <section aria-labelledby="h-fb" class="adm-head">
    <div class="adm-title">
      <h1 id="h-fb">ข้อเสนอแนะ</h1>
      <span class="muted">ใหม่ <b class="mono"><?= number_format($counts['status']['new']) ?></b> · ทั้งหมด <b class="mono"><?= number_format($counts['all']) ?></b> · เก็บไว้ 1 ปี</span>
    </div>
    <?php if ($msg): ?><div class="flash fb-flash" data-flash role="status"><?= h($msg) ?></div><?php endif; ?>
  </section>

  <section class="panel fb-panel" aria-label="รายการข้อเสนอแนะ">
    <div class="fb-filters">
      <nav class="seg adm-seg" aria-label="กรองตามสถานะ">
        <a class="<?= $status === '' ? 'on' : '' ?>" href="<?= h(fb_url(['s' => null, 'page' => null])) ?>"<?= $status === '' ? ' aria-current="page"' : '' ?>>ทุกสถานะ <b><?= number_format($counts['all']) ?></b></a>
        <?php foreach (FEEDBACK_STATUS as $k => $label): ?>
          <a class="<?= $status === $k ? 'on' : '' ?>" href="<?= h(fb_url(['s' => $k, 'page' => null])) ?>"<?= $status === $k ? ' aria-current="page"' : '' ?>><?= h($label) ?> <b><?= number_format($counts['status'][$k]) ?></b></a>
        <?php endforeach; ?>
      </nav>
      <nav class="seg adm-seg" aria-label="กรองตามหัวข้อ">
        <a class="<?= $kind === '' ? 'on' : '' ?>" href="<?= h(fb_url(['k' => null, 'page' => null])) ?>"<?= $kind === '' ? ' aria-current="page"' : '' ?>>ทุกหัวข้อ</a>
        <?php foreach (FEEDBACK_KIND as $k => $label): ?>
          <a class="<?= $kind === $k ? 'on' : '' ?>" href="<?= h(fb_url(['k' => $k, 'page' => null])) ?>"<?= $kind === $k ? ' aria-current="page"' : '' ?>><?= h($label) ?> <b><?= number_format($counts['kind'][$k]) ?></b></a>
        <?php endforeach; ?>
      </nav>
    </div>

    <?php if (!$list['rows']): ?>
      <p class="empty">ยังไม่มีข้อความ<?= $status !== '' || $kind !== '' ? 'ในตัวกรองนี้' : '' ?></p>
    <?php else: ?>
    <ol class="fb-list">
      <?php foreach ($list['rows'] as $r):
          $id = (int) $r['id'];
          $isGuest = $r['provider'] === 'guest';
          $who = $r['user_id'] ? ($r['user_name'] ?: '(ไม่มีชื่อ)') : 'ไม่ได้เข้าสู่ระบบ';
      ?>
      <li class="fb-item st-<?= h($r['status']) ?>" id="fb-<?= $id ?>">
        <div class="fb-meta">
          <span class="fb-kind k-<?= h($r['kind']) ?>"><?= h(FEEDBACK_KIND[$r['kind']] ?? $r['kind']) ?></span>
          <span class="fb-st"><?= h(FEEDBACK_STATUS[$r['status']] ?? $r['status']) ?></span>
          <?php if ($isGuest): ?><span class="badge">ทดลอง</span><?php endif; ?>
          <span class="dt" title="<?= h(th_datetime($r['created_at'])) ?>"><?= h(th_datetime($r['created_at'])) ?> <small class="muted"><?= h(th_ago($r['created_at'])) ?></small></span>
        </div>
        <p class="fb-msg"><?= nl2br(h($r['message'])) ?></p>
        <dl class="fb-from">
          <div><dt>จาก</dt><dd><?= h($who) ?><?php if ($r['provider'] !== '' && !$isGuest): ?> <span class="prov"><?= h(PROVIDER_LABEL[$r['provider']] ?? $r['provider']) ?></span><?php endif; ?><?php if ($r['user_email']): ?> · <a href="mailto:<?= h($r['user_email']) ?>"><?= h($r['user_email']) ?></a><?php endif; ?></dd></div>
          <?php if ($r['school_id']): ?><div><dt>โรงเรียน</dt><dd><?= $r['school'] !== null ? h($r['school']) . ($r['province'] ? ' <span class="muted">จ.' . h($r['province']) . '</span>' : '') : '<span class="muted">(ถูกลบแล้ว)</span>' ?></dd></div><?php endif; ?>
          <div><dt>ติดต่อกลับ</dt><dd><?php if ($r['contact'] !== null && $r['contact'] !== ''): ?><span class="fb-contact"><?= h($r['contact']) ?></span> <button class="btn btn-sm fb-copy" type="button" data-copy="<?= h($r['contact']) ?>">คัดลอกช่องทางติดต่อ</button><?php else: ?><span class="muted">ไม่ได้ฝากไว้</span><?php endif; ?></dd></div>
          <?php if ($r['page'] !== ''): ?><div><dt>หน้า</dt><dd class="mono"><?= h($r['page']) ?></dd></div><?php endif; ?>
          <?php if ($r['ua'] !== ''): ?><div class="fb-ua"><dt>อุปกรณ์</dt><dd><small class="muted"><?= h($r['ua']) ?></small></dd></div><?php endif; ?>
        </dl>
        <form class="fb-edit" method="post" action="admin-feedback.php">
          <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
          <input type="hidden" name="act" value="save">
          <input type="hidden" name="id" value="<?= $id ?>">
          <input type="hidden" name="back" value="<?= h(fb_url([])) ?>">
          <label class="fb-note"><span class="sr">โน้ตของผู้ดูแล</span>
            <textarea class="input" name="note" rows="2" maxlength="2000" placeholder="โน้ตของผู้ดูแล (ผู้ส่งไม่เห็น)"><?= h($r['note_admin']) ?></textarea>
          </label>
          <div class="fb-actions">
            <label><span class="sr">สถานะ</span>
              <select class="input input-sm" name="status">
                <?php foreach (FEEDBACK_STATUS as $k => $label): ?>
                  <option value="<?= h($k) ?>"<?= $r['status'] === $k || ($r['status'] === 'new' && $k === 'read') ? ' selected' : '' ?>><?= h($label) ?></option>
                <?php endforeach; ?>
              </select>
            </label>
            <button class="btn btn-sm" type="submit">บันทึก</button>
          </div>
        </form>
      </li>
      <?php endforeach; ?>
    </ol>
    <?php endif; ?>

    <?php if ($list['pages'] > 1): ?>
    <nav class="pager" aria-label="หน้า">
      <?php if ($list['page'] > 1): ?><a class="btn btn-sm" href="<?= h(fb_url(['page' => $list['page'] - 1])) ?>">‹ ก่อนหน้า</a><?php endif; ?>
      <span class="muted">หน้า <?= $list['page'] ?> / <?= $list['pages'] ?> · <?= number_format($list['total']) ?> ข้อความ</span>
      <?php if ($list['page'] < $list['pages']): ?><a class="btn btn-sm" href="<?= h(fb_url(['page' => $list['page'] + 1])) ?>">ถัดไป ›</a><?php endif; ?>
    </nav>
    <?php else: ?>
    <p class="muted pager"><?= number_format($list['total']) ?> ข้อความ</p>
    <?php endif; ?>
  </section>

  <form class="fb-purge" method="post" action="admin-feedback.php">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="act" value="purge">
    <input type="hidden" name="back" value="<?= h(fb_url(['page' => null])) ?>">
    <span class="muted">นโยบายความเป็นส่วนตัวสัญญาว่าเก็บข้อความไว้ 1 ปี (ระบบลบเองเมื่อมีข้อความใหม่เข้ามา)</span>
    <button class="btn btn-sm" type="submit">ลบที่เก่ากว่า 1 ปี</button>
  </form>
  <p class="muted foot">เวลาทั้งหมดเป็นเวลาไทย · ไม่เก็บที่อยู่ IP ของผู้ส่ง</p>
</main>
<?= flash_script($msg, $msgKind) ?>
<script type="module" nonce="<?= csp_nonce() ?>">
// ปุ่ม "คัดลอกช่องทางติดต่อ": clipboard API (ต้อง HTTPS/localhost) → ถอยไปเลือกข้อความแล้ว execCommand
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.fb-copy');
  if (!b) return;
  const text = b.dataset.copy || '';
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
  }
  const old = b.textContent;
  b.textContent = ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่ได้ เลือกข้อความเองครับ';
  setTimeout(() => { b.textContent = old; }, 2000);
});
</script>
<?php page_foot();
