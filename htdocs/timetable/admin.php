<?php
// หน้าผู้ดูแลระบบ (อ่านอย่างเดียว): ใครมาสมัคร โรงเรียนไหน อยู่ที่ไหน และใครควรได้รับความช่วยเหลือก่อน
// เปิดได้เฉพาะบัญชี Google ที่อยู่ในรายการแอดมิน (admin_emails) · คนอื่นได้ 404 เหมือนหน้าไม่มีอยู่จริง
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
require __DIR__ . '/lib/admin.php';

header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow');

$me = current_user();
if (!is_admin($me)) admin_not_found();
// ฟังก์ชัน JSON ด้านล่างเขียนสำหรับ SQLite
if (cfg('db.driver', 'sqlite') === 'mysql') { http_response_code(501); exit('หน้าแอดมินรองรับเฉพาะฐานข้อมูล SQLite'); }

$q = mb_substr(trim((string) ($_GET['q'] ?? '')), 0, 100);
$prio = (int) ($_GET['p'] ?? 0);
if (!isset(ADMIN_PRIO[$prio])) $prio = 0;
$all = ($_GET['all'] ?? '') === '1';
$page = max(1, (int) ($_GET['page'] ?? 1));

$t0 = microtime(true);
$sum = admin_summary();
$list = admin_rows($q, $prio, $all, $page);
$geo = admin_geo();
$ms = (int) round((microtime(true) - $t0) * 1000);

/** ลิงก์หน้าเดิมโดยเปลี่ยนพารามิเตอร์บางตัว */
function admin_url(array $change): string {
    global $q, $prio, $all, $page;
    $p = array_merge(['q' => $q, 'p' => $prio ?: null, 'all' => $all ? '1' : null, 'page' => null], $change);
    $p = array_filter($p, fn($v) => $v !== null && $v !== '');
    return 'admin.php' . ($p ? '?' . http_build_query($p) : '');
}

// สรุปจังหวัด → อำเภอ
$prov = [];
foreach ($geo as $g) {
    $prov[$g['province']]['n'] = ($prov[$g['province']]['n'] ?? 0) + (int) $g['n'];
    $prov[$g['province']]['amphoe'][] = $g;
}
uasort($prov, fn($a, $b) => $b['n'] <=> $a['n']);

$v = (int) @filemtime(APP_ROOT . '/assets/admin.js');
page_head('ผู้ดูแลระบบ · ตารางบริบูรณ์',
    '<meta name="robots" content="noindex, nofollow"><style>' . file_get_contents(APP_ROOT . '/assets/admin.css') . '</style>',
    'หน้าผู้ดูแลระบบตารางบริบูรณ์');
?>
<header class="bar adm-top">
  <?= brand_html('app.php') ?>
  <span class="adm-tag">ผู้ดูแลระบบ</span>
  <nav class="adm-nav">
    <span class="muted adm-me" title="<?= h($me['email']) ?>"><?= h($me['name'] ?? $me['email']) ?></span>
    <a class="btn btn-sm" href="app.php">กลับไปจัดตาราง</a>
  </nav>
</header>

<main class="adm">
  <section aria-labelledby="h-sum" class="adm-head">
    <div class="adm-title">
      <h1 id="h-sum">ภาพรวม</h1>
      <span class="muted">ณ <?= h(th_datetime(now())) ?> น.</span>
    </div>
    <dl class="kpi">
      <div><dt>โรงเรียนจริง</dt><dd><?= number_format($sum['schools']) ?></dd><small>ไม่นับทดลองและแอดมิน</small></div>
      <div><dt>ผู้ใช้จริง</dt><dd><?= number_format($sum['users']) ?></dd><small>ยังไม่มีโรงเรียน <?= number_format($sum['no_school']) ?> คน</small></div>
      <div><dt>สมัครใหม่</dt><dd><?= number_format($sum['new7']) ?></dd><small>7 วัน · วันนี้ <?= number_format($sum['new1']) ?></small></div>
      <div><dt>ใช้งานใน 24 ชม.</dt><dd><?= number_format($sum['active1']) ?></dd><small>โรงเรียนที่บันทึก</small></div>
    </dl>
    <p class="sys muted">
      <span>ทดลองค้าง <b><?= number_format($sum['guests']) ?></b><?= $sum['guest_oldest'] ? ' · เก่าสุด ' . h(th_ago($sum['guest_oldest'])) : '' ?></span>
      <span>ฐานข้อมูล <b><?= h(fmt_bytes($sum['db_bytes'])) ?></b></span>
      <span>ลองใช้ทันที <b><?= number_format($sum['rate_h1']) ?></b> / ชม. · <b><?= number_format($sum['rate_d1']) ?></b> / วัน</span>
    </p>
  </section>

  <div class="dash">
  <section aria-labelledby="h-care" class="panel">
    <div class="panel-h"><h2 id="h-care">ต้องดูแล</h2><span class="muted">เรียงตามความสำคัญ</span></div>
    <nav class="seg adm-seg" aria-label="กรองตามความสำคัญ">
      <a class="<?= $prio === 0 ? 'on' : '' ?>" href="<?= h(admin_url(['p' => null])) ?>"<?= $prio === 0 ? ' aria-current="page"' : '' ?>>ทั้งหมด <b><?= number_format(array_sum($list['counts'])) ?></b></a>
      <?php foreach (ADMIN_PRIO as $k => [$label, $tip, $cls]): ?>
        <a class="<?= $prio === $k ? 'on' : '' ?>" href="<?= h(admin_url(['p' => $k])) ?>" title="<?= h($tip) ?>"<?= $prio === $k ? ' aria-current="page"' : '' ?>><?= h($label) ?> <b><?= number_format($list['counts'][$k]) ?></b></a>
      <?php endforeach; ?>
    </nav>

    <form class="tools" method="get" action="admin.php" id="adm-form">
      <?php if ($prio): ?><input type="hidden" name="p" value="<?= $prio ?>"><?php endif; ?>
      <label class="search">
        <span class="sr">ค้นหา</span>
        <input class="input" type="search" name="q" id="flt" value="<?= h($q) ?>" placeholder="กรองชื่อ อีเมล โรงเรียน จังหวัด…" autocomplete="off">
      </label>
      <button class="btn btn-sm" type="submit" title="ค้นหาทั้งฐานข้อมูล (พิมพ์อย่างเดียว = กรองเฉพาะหน้านี้)">ค้นทั้งระบบ</button>
      <label class="switch"><input type="checkbox" name="all" value="1" id="all"<?= $all ? ' checked' : '' ?>> แสดงบัญชีแอดมิน/ทดลอง</label>
      <span class="muted count" id="flt-count" aria-live="polite"></span>
    </form>

    <?php if (!$list['rows']): ?>
      <p class="empty">ไม่มีรายการ<?= $q !== '' ? 'ที่ตรงกับ “' . h($q) . '”' : '' ?></p>
    <?php else: ?>
    <div class="frame">
      <table class="table adm-table" id="care">
        <thead><tr>
          <th><button type="button" data-k="prio" data-t="n">ความสำคัญ</button></th>
          <th><button type="button" data-k="user">ผู้ใช้</button></th>
          <th><button type="button" data-k="school">โรงเรียน</button></th>
          <th><button type="button" data-k="area">ตำบล / อำเภอ / จังหวัด</button></th>
          <th><button type="button" data-k="created">สมัครเมื่อ</button></th>
          <th><button type="button" data-k="last">ใช้ล่าสุด</button></th>
          <th class="num"><button type="button" data-k="terms" data-t="n">ภาคเรียน</button></th>
          <th><button type="button" data-k="size" data-t="n">ห้อง · ครู · วิชา</button></th>
          <th><button type="button" data-k="prog" data-t="n">คาบที่วางแล้ว</button></th>
          <th class="num"><button type="button" data-k="saves" data-t="n">บันทึก</button></th>
        </tr></thead>
        <tbody>
        <?php foreach ($list['rows'] as $r):
            $p = (int) $r['prio'];
            [$plabel, $ptip, $pcls] = ADMIN_PRIO[$p];
            $isGuest = $r['provider'] === 'guest';
            $need = (int) ($r['need'] ?? 0);
            $placed = (int) ($r['n_pl'] ?? 0);
            $pct = $need > 0 ? min(100, (int) floor($placed * 100 / $need)) : 0;
            // หมายเหตุย่อย: ช่วยแยก "ยังไม่เริ่ม" ออกจาก "ติดจริง"
            $note = '';
            if ($p === 2 && (int) $r['cur_version'] <= 1) $note = 'ยังไม่เคยบันทึก (ข้อมูลตั้งต้น)';
            elseif ($r['school_id'] && (int) ($r['n_asg'] ?? 0) === 0) $note = $r['term_id'] ? 'ยังไม่กรอกงานสอน' : 'ยังไม่มีภาคเรียน';
            elseif ($p === 1) $note = 'ล็อกอิน ' . th_ago($r['created_at']);
            $area = array_filter([$r['tambon'] ? 'ต.' . $r['tambon'] : '', $r['amphoe'] ? 'อ.' . $r['amphoe'] : '', $r['province'] ? 'จ.' . $r['province'] : '']);
            $search = mb_strtolower(implode(' ', [$r['name'], $r['email'], $r['school'], $r['school_code'], $r['tambon'], $r['amphoe'], $r['province']]));
        ?>
          <tr class="<?= $pcls ?><?= $r['is_adm'] ? ' is-adm' : '' ?><?= $isGuest ? ' is-guest' : '' ?>" data-q="<?= h($search) ?>">
            <td data-v="<?= $p ?>"><span class="prio" title="<?= h($ptip) ?>"><i class="lv"><?= $p ?></i><?= h($plabel) ?></span><?php if ($note): ?><small class="note"><?= h($note) ?></small><?php endif; ?></td>
            <td data-v="<?= h(mb_strtolower((string) $r['name'])) ?>">
              <b class="who"><?= h($r['name'] ?: '(ไม่มีชื่อ)') ?></b>
              <span class="prov prov-<?= h($r['provider']) ?>"><?= h(PROVIDER_LABEL[$r['provider']] ?? $r['provider']) ?></span>
              <?php if ($r['is_adm']): ?><span class="badge">แอดมิน</span><?php endif; ?>
              <?php if ($r['email']): ?><a class="mail" href="mailto:<?= h($r['email']) ?>"><?= h($r['email']) ?></a><?php elseif (!$isGuest): ?><small class="muted">ไม่มีอีเมล (LINE)</small><?php endif; ?>
            </td>
            <td data-v="<?= h((string) $r['school']) ?>"><?php if ($r['school_id']): ?><?= h($r['school']) ?><?php if ($r['school_code']): ?> <small class="mono muted"><?= h($r['school_code']) ?></small><?php endif; ?><?php else: ?><span class="muted">–</span><?php endif; ?></td>
            <td data-v="<?= h(($r['province'] ?? '') . ' ' . ($r['amphoe'] ?? '') . ' ' . ($r['tambon'] ?? '')) ?>" class="area"><?= $area ? h(implode(' ', $area)) : '<span class="muted">–</span>' ?></td>
            <td data-v="<?= h($r['created_at']) ?>" class="dt"><?= h(th_datetime($r['created_at'])) ?><small class="muted"><?= h(th_ago($r['created_at'])) ?></small></td>
            <td data-v="<?= h((string) $r['last_used']) ?>" class="dt"><?php if ($r['last_used']): ?><?= h(th_datetime($r['last_used'])) ?><small class="muted"><?= h(th_ago($r['last_used'])) ?></small><?php else: ?><span class="muted">–</span><?php endif; ?></td>
            <td data-v="<?= (int) $r['n_terms'] ?>" class="num"><?= (int) $r['n_terms'] ?: '<span class="muted">–</span>' ?></td>
            <td data-v="<?= (int) ($r['n_cls'] ?? 0) ?>" class="mono size"><?php if ($r['term_id']): ?><?= (int) $r['n_cls'] ?> · <?= (int) $r['n_tch'] ?> · <?= (int) $r['n_sub'] ?><?php if ((int) $r['n_room']): ?> <small class="muted">+ห้องพิเศษ <?= (int) $r['n_room'] ?></small><?php endif; ?><?php else: ?><span class="muted">–</span><?php endif; ?></td>
            <td data-v="<?= $need > 0 ? $pct : -1 ?>" class="prog-cell">
              <?php if ($need > 0): ?>
                <span class="prog<?= $pct >= 100 ? ' full' : '' ?>" role="img" aria-label="วางแล้ว <?= $pct ?>%"><span style="width:<?= $pct ?>%"></span></span>
                <span class="mono"><?= number_format($placed) ?>/<?= number_format($need) ?> <b><?= $pct ?>%</b></span>
              <?php else: ?><span class="muted">–</span><?php endif; ?>
            </td>
            <td data-v="<?= (int) $r['saves'] ?>" class="num mono"><?= $r['term_id'] ? number_format((int) $r['saves']) : '<span class="muted">–</span>' ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <?php endif; ?>

    <?php if ($list['pages'] > 1): ?>
    <nav class="pager" aria-label="หน้า">
      <?php if ($list['page'] > 1): ?><a class="btn btn-sm" href="<?= h(admin_url(['page' => $list['page'] - 1])) ?>">‹ ก่อนหน้า</a><?php endif; ?>
      <span class="muted">หน้า <?= $list['page'] ?> / <?= $list['pages'] ?> · <?= number_format($list['total']) ?> รายการ</span>
      <?php if ($list['page'] < $list['pages']): ?><a class="btn btn-sm" href="<?= h(admin_url(['page' => $list['page'] + 1])) ?>">ถัดไป ›</a><?php endif; ?>
    </nav>
    <?php else: ?>
    <p class="muted pager"><?= number_format($list['total']) ?> รายการ</p>
    <?php endif; ?>
  </section>

  <aside aria-labelledby="h-geo" class="panel side">
    <div class="panel-h"><h2 id="h-geo">จังหวัด / อำเภอ</h2><span class="muted"><?= number_format(count($prov)) ?> จังหวัด · <?= number_format(count($geo)) ?> อำเภอ</span></div>
    <?php if (!$prov): ?><p class="empty">ยังไม่มีโรงเรียนจริง</p><?php else: ?>
    <div class="geo">
      <?php $max = max(array_column($prov, 'n')); foreach ($prov as $name => $pv): ?>
        <details class="geo-row">
          <summary><span class="g-name"><?= h($name) ?></span><span class="g-bar"><span style="width:<?= max(4, (int) round($pv['n'] * 100 / $max)) ?>%"></span></span><b class="mono"><?= number_format($pv['n']) ?></b></summary>
          <ul><?php foreach ($pv['amphoe'] as $a): ?><li><span>อ.<?= h($a['amphoe']) ?></span><b class="mono"><?= number_format((int) $a['n']) ?></b></li><?php endforeach; ?></ul>
        </details>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>
  </aside>
  </div>

  <p class="muted foot">อ่านอย่างเดียว · เวลาทั้งหมดเป็นเวลาไทย · ประมวลผล <?= $ms ?> ms</p>
</main>
<script type="module" src="assets/admin.js?v=<?= $v ?>"></script>
<?php page_foot();
