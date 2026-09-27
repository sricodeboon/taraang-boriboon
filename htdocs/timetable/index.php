<?php
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
const GITHUB_URL = 'https://github.com/sricodeboon/taraang-boriboon';

$u = current_user();
if ($u) redirect($u['school_id'] ? 'app.php' : 'signup.php');
$ready = providers_ready();
$msg = flash();
// นับเฉพาะโรงเรียนที่ลงทะเบียนจริง (Google/LINE) ไม่นับโรงเรียนทดลองจาก "ลองใช้ทันที"
try {
    $schoolCount = (int) (db_one("SELECT COUNT(DISTINCT school_id) AS n FROM users WHERE provider <> 'guest' AND school_id IS NOT NULL")['n'] ?? 0);
} catch (Throwable $e) {
    error_log('school count: ' . $e->getMessage());
    $schoolCount = 0;
}

page_head('ตารางบริบูรณ์ · จัดตารางเรียนตารางสอนออนไลน์', '<style>
  .hero { display:grid; grid-template-columns:1.1fr .9fr; gap:32px; align-items:center; padding-block:40px 56px; }
  .hero h1 { font-size:clamp(2rem,4.6vw,3.2rem); }
  .hero h1 em { font-style:normal; color:var(--gold); }
  .lead { font-size:1.08rem; color:var(--muted); max-width:34rem; margin:14px 0 0; }
  .stat { display:inline-flex; align-items:baseline; gap:10px; margin:20px 0 0; padding:10px 16px; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
  .stat b { font-family:var(--mono); font-size:1.9rem; line-height:1; color:var(--ink); }
  .stat span { color:var(--muted); }
  .feats { list-style:none; padding:0; margin:22px 0 0; display:grid; gap:10px; }
  .feats li { display:grid; grid-template-columns:28px 1fr; gap:6px; }
  .feats .k { font-family:var(--mono); color:var(--gold); font-weight:700; }
  .login { padding:26px; display:grid; gap:12px; }
  .login h2 { font-size:1.3rem; }
  .login .btn { width:100%; padding:12px 16px; }
  .g-btn { background:#fff; color:#1f1f1f; border-color:#dadce0; }
  .line-btn { background:#06C755; border-color:#06C755; color:#fff; font-weight:600; }
  .or { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:.85rem; }
  .or::before, .or::after { content:""; flex:1; border-top:1px solid var(--line); }
  .top { display:flex; justify-content:space-between; align-items:center; padding-block:18px; gap:10px; flex-wrap:wrap; }
  .soon { font-size:.78rem; color:var(--muted); font-weight:400; }
  .foot { padding-block:24px 40px; color:var(--muted); font-size:.86rem; border-top:1px solid var(--line); }
  @media (max-width:820px) { .hero { grid-template-columns:1fr; padding-top:16px; } }
</style>');
?>
<main class="wrap">
  <header class="top">
    <?= brand_html() ?>
    <nav style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <a class="btn btn-sm" href="<?= GITHUB_URL ?>" target="_blank" rel="noopener" title="ซอร์สโค้ดบน GitHub">ดาวน์โหลดโปรแกรม</a>
      <a class="btn btn-sm" href="guide.php">คู่มือการใช้งาน</a>
    </nav>
  </header>

  <section class="hero">
    <div>
      <p class="mono muted" style="margin:0;letter-spacing:.1em;font-size:.8rem">ระบบจัดตารางเรียน ตารางสอน · ฟรี</p>
      <h1>จัดตารางทั้งโรงเรียน<br><em>ในไม่กี่นาที</em></h1>
      <p class="lead">กรอกห้องเรียน ครู และวิชา แล้วกดปุ่มเดียวให้ระบบจัดให้ หรือจะลากวางเองก็ได้ ระบบเตือนทันทีเมื่อครูหรือห้องชนกัน จัดเสร็จส่งออกเป็น Excel และ PDF</p>
      <p class="stat" aria-label="จำนวนโรงเรียนที่ใช้ระบบ"><span>มีโรงเรียนใช้ระบบแล้ว</span><b><?= number_format($schoolCount) ?></b><span>โรงเรียน</span></p>
      <ul class="feats">
        <li><span class="k">›</span><span><b>จัดอัตโนมัติ</b> ระบบวางวิชาให้ครบโดยไม่ชน แล้วปรับเองต่อได้</span></li>
        <li><span class="k">›</span><span><b>ลากวาง + ตรวจชนทันที</b> ครูสอนซ้อน ห้องใช้ซ้ำ คาบล็อก ขึ้นเตือนเป็นสีแดง</span></li>
        <li><span class="k">›</span><span><b>คาบล็อก</b> กิจกรรมหน้าเสาธง ลูกเสือ ชุมนุม ล็อกไว้ไม่ให้จัดทับ</span></li>
        <li><span class="k">›</span><span><b>ส่งออก Excel · PDF</b> ตารางรายห้องและรายครู พร้อมพิมพ์ติดบอร์ด</span></li>
      </ul>
    </div>

    <div class="card login">
      <h2>เข้าใช้งาน</h2>
      <?php if ($msg): ?><div class="flash"><?= h($msg) ?></div><?php endif; ?>
      <?php if ($ready['google']): ?>
        <a class="btn g-btn" href="auth/login.php?p=google">เข้าสู่ระบบด้วย Google</a>
      <?php else: ?>
        <button class="btn g-btn" disabled>เข้าสู่ระบบด้วย Google <span class="soon">(เร็ว ๆ นี้)</span></button>
      <?php endif; ?>
      <?php if ($ready['line']): ?>
        <a class="btn line-btn" href="auth/login.php?p=line">เข้าสู่ระบบด้วย LINE</a>
      <?php else: ?>
        <button class="btn line-btn" disabled>เข้าสู่ระบบด้วย LINE <span class="soon" style="color:#e8fff1">(เร็ว ๆ นี้)</span></button>
      <?php endif; ?>
      <div class="or">หรือ</div>
      <form method="post" action="auth/guest.php">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <button class="btn btn-primary" type="submit">ลองใช้ทันที ไม่ต้องสมัคร</button>
      </form>
      <p class="hint" style="margin:0">โหมดทดลองมีข้อมูลตัวอย่างโรงเรียนมัธยมให้ลองจัด ข้อมูลทดลองจะถูกลบเองหลัง 2 วัน</p>
      <p class="hint" style="margin:0">การเข้าใช้งานถือว่ายอมรับ<a href="terms.php">ข้อกำหนดการใช้งาน</a>และ<a href="privacy.php">นโยบายความเป็นส่วนตัว</a></p>
    </div>
  </section>

  <footer class="foot">
    ตารางบริบูรณ์ · โดย <a href="../">ศรีโค้ดบูรณ์</a> ครูแจ็ก นาทม นครพนม · <a href="guide.php">คู่มือ</a> · <a href="terms.php">ข้อกำหนดการใช้งาน</a> · <a href="privacy.php">นโยบายความเป็นส่วนตัว</a>
    · ดาวน์โหลดโปรแกรม: <a href="<?= GITHUB_URL ?>" target="_blank" rel="noopener">GitHub</a> (<a href="<?= GITHUB_URL ?>/archive/refs/heads/main.zip">.zip</a>)
  </footer>
</main>
<?php page_foot();
