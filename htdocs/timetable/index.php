<?php
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/layout.php';
const GITHUB_URL = 'https://github.com/sricodeboon/taraang-boriboon';

$u = current_user();
if ($u) redirect($u['school_id'] ? 'app.php' : 'signup.php');
$ready = providers_ready();
$msg = flash();
$msgKind = flash_kind();
// นับเฉพาะโรงเรียนที่ลงทะเบียนจริง (Google/LINE) ไม่นับโรงเรียนทดลองจาก "ลองใช้ทันที"
try {
    $schoolCount = (int) (db_one("SELECT COUNT(DISTINCT school_id) AS n FROM users WHERE provider <> 'guest' AND school_id IS NOT NULL")['n'] ?? 0);
} catch (Throwable $e) {
    error_log('school count: ' . $e->getMessage());
    $schoolCount = 0;
}

// ภาพครูบูรณ์ hero (BRAND-MASCOT ข้อ 5): srcset 480/900 + preload + fetchpriority=high · ยังไม่มีไฟล์ = ไม่แสดง ไม่เกิด 404
$heroSet = [];
foreach (['boon-hero-480.webp' => 480, 'boon-hero-900.webp' => 900] as $f => $w) {
    $p = __DIR__ . '/assets/mascot/' . $f;
    if (is_file($p)) $heroSet[] = 'assets/mascot/' . $f . '?v=' . (int) filemtime($p) . ' ' . $w . 'w';
}
$heroSizes = '260px'; // จอใหญ่แสดงกว้าง 260px มือถือครอปครึ่งตัว → 1x ใช้ 480w · จอความละเอียดสูงใช้ 900w
$heroSrc = $heroSet ? strtok(end($heroSet), ' ') : '';
$preload = $heroSet ? '<link rel="preload" as="image" href="' . h($heroSrc) . '" imagesrcset="' . h(implode(', ', $heroSet)) . '" imagesizes="' . $heroSizes . '" fetchpriority="high">' : '';

// ตารางตัวอย่าง 5 วัน × 6 คาบ ใน hero (SVG ลงช่องทีละช่อง) · '' = ช่องว่าง · lock = คาบล็อก
$demo = [
    ['ไทย', 'คณิต', 'วิทย์', 'อังกฤษ', 'สังคม', 'พละ'],
    ['คณิต', 'ไทย', 'อังกฤษ', 'ศิลปะ', 'วิทย์', ''],
    ['วิทย์', 'อังกฤษ', 'ไทย', 'คณิต', 'ลูกเสือ', 'ลูกเสือ'],
    ['อังกฤษ', 'สังคม', 'คณิต', 'ไทย', 'การงาน', 'แนะแนว'],
    ['ไทย', 'วิทย์', 'สังคม', 'คณิต', 'ดนตรี', ''],
];
$tone = ['ไทย' => 'g', 'คณิต' => 's', 'วิทย์' => 's', 'อังกฤษ' => 'm', 'สังคม' => 'g', 'พละ' => 'p', 'ศิลปะ' => 'p',
         'การงาน' => 'm', 'ดนตรี' => 'p', 'ลูกเสือ' => 'l', 'แนะแนว' => 'l'];
$svgCells = '';
$i = 0;
foreach (['จ', 'อ', 'พ', 'พฤ', 'ศ'] as $d => $day) {
    $y = 30 + $d * 42;
    $svgCells .= '<text class="dl" x="17" y="' . ($y + 24) . '">' . $day . '</text>';
    foreach ($demo[$d] as $p => $name) {
        $x = 36 + $p * 50;
        if ($name === '') {
            $svgCells .= '<rect class="emp" x="' . ($x + 3) . '" y="' . ($y + 3) . '" width="44" height="36" rx="6"/>';
            continue;
        }
        $svgCells .= '<g class="cell ' . $tone[$name] . '" style="--i:' . $i++ . '"><rect x="' . ($x + 3) . '" y="' . ($y + 3) . '" width="44" height="36" rx="6"/>'
            . '<text x="' . ($x + 25) . '" y="' . ($y + 26) . '">' . $name . '</text></g>';
    }
}
$svgHead = '';
for ($p = 0; $p < 6; $p++) $svgHead .= '<text class="pl" x="' . (61 + $p * 50) . '" y="20">' . ($p + 1) . '</text>';

page_head('ตารางบริบูรณ์ · จัดตารางเรียนตารางสอนออนไลน์', $preload . '<style>
  /* หน้าแรกเป็นฉากค่ำ-ทองทั้งหน้า (BRAND-MASCOT ข้อ 1, 6.1): ใช้ชุดสีโหมดมืดของ app.css เสมอ component ของ layout.php จึงเข้าธีมเอง */
  :root { --bg:#0B141C; --surface:#111D27; --surface-2:#0E1922; --ink:#E8EDEA; --muted:#A3B2B7; --line:#233441;
    --gold:#E3B85A; --gold-bg:#E3B85A; --gold-soft:#2A2616; --blue:#7FB0E8; --blue-soft:#15263A; --pink:#F0A6BD;
    --danger:#FF8A7A; --danger-soft:#3A1A17; --shadow:0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
    --night:#0B141C; --navy:#0F2438; --sky:#7FB0E8; --blush:#F0A6BD; --mist:#F2F4F1;
    --ease:cubic-bezier(.2,.8,.2,1); --glass:rgba(15,36,56,.92); color-scheme:dark; }
  body { background:var(--night); }
  .top { position:relative; z-index:2; display:flex; justify-content:space-between; align-items:center; padding-block:16px; gap:10px; flex-wrap:wrap; }
  .top nav { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .top .btn { background:transparent; border-color:rgba(242,244,241,.22); color:var(--mist); }
  .top .btn:hover { border-color:var(--gold); }

  /* ---------- จอแรก: พื้น CSS ล้วน (gradient กรมท่า→ทอง + แสงทองล่างซ้าย + กริดเอียง 8° + ฝุ่นแสง) ---------- */
  .hero { position:relative; overflow:hidden; overflow:clip; isolation:isolate; min-height:100svh; padding-bottom:56px;
    background:linear-gradient(172deg, #0B141C 0%, #0F2438 58%, #3A3220 100%); }
  .hero::after { content:""; position:absolute; left:0; right:0; bottom:0; height:120px; z-index:-1; pointer-events:none; background:linear-gradient(transparent, var(--night)); } /* ต่อกับส่วนถัดลงแบบไม่มีรอยตัด */
  .sky, .sky::before, .sky::after { position:absolute; inset:0; z-index:-1; pointer-events:none; }
  .sky { background:radial-gradient(70% 55% at 12% 100%, rgba(227,184,90,.34), transparent 70%), radial-gradient(45% 40% at 85% 18%, rgba(127,176,232,.14), transparent 70%);
    animation:sky-in .6s var(--ease) both; }
  .sky::before { content:""; inset:-20%; transform:rotate(-8deg); opacity:.06;
    background:repeating-linear-gradient(0deg, var(--mist) 0 1px, transparent 1px 56px), repeating-linear-gradient(90deg, var(--mist) 0 1px, transparent 1px 56px);
    animation:grid-in .6s .12s var(--ease) both; }
  .sky i { position:absolute; width:3px; height:3px; border-radius:50%; background:var(--gold); opacity:.5; box-shadow:0 0 8px rgba(227,184,90,.8); }
  @keyframes sky-in { from { opacity:0; } }
  @keyframes grid-in { from { opacity:0; transform:rotate(-8deg) translateY(24px); } }

  .hero-grid { display:grid; grid-template-columns:minmax(0,55fr) minmax(0,45fr); gap:32px; align-items:center; padding-top:24px; }
  .eyebrow { margin:0; font-family:var(--mono); color:var(--gold); letter-spacing:.08em; font-size:.8rem; }
  .hero h1 { margin-top:10px; font-size:clamp(2.1rem,5.5vw,4rem); line-height:1.1; letter-spacing:-.01em; color:var(--mist); animation:rise .6s var(--ease) both; }
  .hero h1 em { position:relative; font-style:normal; color:var(--gold); white-space:nowrap; }
  .hero h1 em svg { position:absolute; left:0; right:0; bottom:-.16em; width:100%; height:.32em; fill:none; stroke:var(--gold); stroke-width:2.2; stroke-linecap:round; opacity:.85; }
  .lead { font-size:1.08rem; color:#C5D0D3; max-width:34rem; margin:16px 0 0; }
  @keyframes rise { from { transform:translateY(14px); } } /* H1/ภาพ hero ขยับอย่างเดียว ห้ามเฟด (LCP) */
  @keyframes fade-up { from { opacity:0; transform:translateY(10px); } }

  /* 3 ขั้นในจอแรก */
  .steps-mini { list-style:none; display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:0; margin:20px 0 0; color:var(--mist); font-weight:600; animation:fade-up .5s .26s var(--ease) both; }
  .steps-mini li { display:inline-flex; align-items:center; gap:8px; }
  .steps-mini li + li::before { content:"→"; color:var(--gold); font-family:var(--mono); margin-right:2px; }
  .ring { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; border:1px solid rgba(227,184,90,.6); color:var(--gold); }
  .ico { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }

  /* ปุ่มทอง "ลองใช้ทันที" 2 ปุ่ม (form POST เดิม name=kind) */
  .cta { margin-top:24px; display:grid; gap:8px; max-width:34rem; }
  .cta-btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .cta .btn { min-height:52px; font-size:1.02rem; padding:12px 18px; white-space:normal; text-align:center; line-height:1.3; }
  .cta .btn-primary { box-shadow:0 8px 28px rgba(227,184,90,.28); }
  .btn-gold-line { background:transparent; border-color:var(--gold); color:var(--mist); font-weight:600; }
  .btn-gold-line:hover { background:rgba(227,184,90,.12); border-color:var(--gold); }
  .cta small { color:#C5D0D3; font-size:.86rem; }
  .stat { display:inline-flex; align-items:baseline; gap:10px; margin:18px 0 0; color:#C5D0D3; animation:fade-up .5s .42s var(--ease) both; }
  .stat b { font-family:var(--mono); font-size:1.7rem; line-height:1; color:var(--gold); font-variant-numeric:tabular-nums; }

  /* การ์ดเข้าใช้งาน Google/LINE (เห็นบนเดสก์ท็อปเสมอ · $msg แสดงในการ์ดนี้) */
  .login { margin-top:22px; max-width:34rem; padding:18px; display:grid; gap:10px; border-radius:14px; background:var(--glass); border:1px solid rgba(227,184,90,.28); animation:fade-up .5s .42s var(--ease) both; }
  .login h2 { font-size:1.05rem; color:var(--mist); }
  .login-btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .login .btn { width:100%; padding:11px 14px; }
  .g-btn { background:#fff; color:#1f1f1f; border-color:#dadce0; }
  .g-btn:hover { border-color:var(--gold); }
  .line-btn { background:var(--navy); border-color:rgba(242,244,241,.5); color:#fff; font-weight:600; } /* LINE: ตัวขาวบนพื้นหมึก เลี่ยงเขียว */
  .soon { font-size:.78rem; font-weight:400; opacity:.8; }
  .login .hint { margin:0; color:#B5C2C6; }
  .login .hint a { color:var(--sky); }

  /* ฝั่งขวา: การ์ดกระจกตาราง SVG + ครูบูรณ์ยืนทับขอบล่าง */
  .hero-art { position:relative; min-height:560px; display:grid; align-items:start; padding-top:40px; }
  .board { position:relative; width:min(84%,360px); padding:16px 16px 12px; border-radius:18px; background:var(--glass); border:1px solid rgba(227,184,90,.35);
    box-shadow:0 30px 80px rgba(0,0,0,.45), inset 0 1px 0 rgba(242,244,241,.08); animation:fade-up .6s .26s var(--ease) both; }
  .board-h { display:flex; justify-content:space-between; align-items:center; margin:0 0 6px; font-size:.82rem; color:#C5D0D3; }
  .board-h b { color:var(--mist); font-family:var(--display); font-size:.95rem; }
  .board-h span { font-family:var(--mono); color:var(--gold); }
  .board svg { display:block; width:100%; height:auto; }
  .board text { font-family:var(--body); font-size:11px; font-weight:600; text-anchor:middle; fill:#0B141C; }
  .board .dl, .board .pl { fill:#A3B2B7; font-size:11px; font-family:var(--mono); font-weight:500; }
  .board .emp { fill:none; stroke:rgba(242,244,241,.18); stroke-dasharray:3 3; }
  .cell { transform-box:fill-box; transform-origin:center; animation:cell-in .42s var(--ease) both; animation-delay:calc(var(--i) * 60ms + 500ms); }
  .cell.s rect { fill:var(--sky); } .cell.g rect { fill:var(--gold); } .cell.m rect { fill:var(--mist); } .cell.p rect { fill:var(--blush); }
  .cell.l rect { fill:#22344A; stroke:rgba(242,244,241,.35); } .cell.l text { fill:var(--mist); font-size:10px; }
  @keyframes cell-in { from { opacity:0; transform:scale(.92); } }
  .boon { position:absolute; right:-20px; bottom:-24px; width:min(58%,260px); pointer-events:none; } /* ยืนทับมุมล่างขวาของการ์ด ไม่บังตาราง */
  .boon img { display:block; width:100%; height:auto; filter:drop-shadow(0 0 36px rgba(227,184,90,.28)); animation:rise .6s var(--ease) both, float 6s .6s ease-in-out infinite; }
  .boon::after { content:""; position:absolute; left:18%; right:18%; bottom:-4px; height:22px; z-index:-1; border-radius:50%;
    background:radial-gradient(closest-side, rgba(227,184,90,.42), transparent); animation:shadow 6s .6s ease-in-out infinite; }
  @keyframes float { 50% { transform:translateY(-6px) rotate(.6deg); } }
  @keyframes shadow { 50% { transform:scaleX(.96); opacity:.8; } }

  /* ---------- ส่วนถัดลง ---------- */
  .sec { padding-block:56px 8px; }
  .sec > h2, .sec-h { font-size:clamp(1.5rem,3.4vw,2.1rem); color:var(--mist); }
  .sec-lead { color:var(--muted); margin:8px 0 0; max-width:40rem; }
  .how { display:grid; grid-template-columns:200px minmax(0,1fr) minmax(0,1.15fr); gap:28px; align-items:center; margin-top:24px; }
  .how-boon img { display:block; width:100%; height:auto; }
  .how ol { list-style:none; padding:0; margin:0; display:grid; gap:14px; counter-reset:s; }
  .how li { display:grid; grid-template-columns:40px 1fr; gap:12px; align-items:start; counter-increment:s; }
  .how li::before { content:counter(s); display:grid; place-items:center; width:40px; height:40px; border-radius:50%; border:1px solid var(--gold); color:var(--gold); font-family:var(--mono); font-weight:700; }
  .how li b { display:block; color:var(--mist); font-family:var(--display); font-size:1.08rem; }
  .how li span { color:var(--muted); }
  .shot { margin:0; padding:10px; border-radius:16px; background:var(--glass); border:1px solid rgba(227,184,90,.3); box-shadow:0 24px 60px rgba(0,0,0,.4); transform:perspective(1200px) rotateY(-7deg) rotateX(2deg); }
  .shot img { display:block; width:100%; height:auto; border-radius:8px; }
  .shot figcaption { font-size:.82rem; color:var(--muted); margin-top:8px; text-align:center; }

  .feats { list-style:none; padding:0; margin:24px 0 0; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
  .feat { padding:20px; border-radius:14px; background:var(--surface); border:1px solid var(--line); display:grid; gap:8px; align-content:start; }
  .feat .ring { width:44px; height:44px; background:rgba(227,184,90,.08); }
  .feat .ico { width:22px; height:22px; }
  .feat h3 { font-size:1.08rem; color:var(--mist); }
  .feat p { margin:0; color:var(--muted); font-size:.94rem; }
  .also { margin:18px 0 0; color:var(--muted); font-size:.94rem; }
  .also b { color:var(--ink); font-weight:600; }

  .sister { display:flex; gap:16px; align-items:center; margin-top:56px; padding:18px 20px; border-radius:14px; background:var(--surface); border:1px solid var(--line); }
  .sister img { flex:none; }
  .sister p { margin:0; color:var(--muted); }
  .sister b { color:var(--mist); }

  .support { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 24px; align-items:start; margin-top:32px; }
  .support:has(.tt-donate-d[open]) { grid-template-columns:minmax(0,1fr); } /* กางกล่องบริจาค (3 คอลัมน์) = เต็มความกว้าง */

  .foot { margin-top:40px; padding-block:28px 40px; color:var(--muted); font-size:.86rem; border-top:1px solid var(--line); background:#081017; }
  .foot p { margin:0 0 8px; }

  @media (min-width:821px) {
    /* กระจกมืดเฉพาะจอใหญ่ ไม่เกิน 3 ชิ้น (การ์ดตาราง · การ์ดเข้าใช้งาน · กรอบภาพหน้าจอ) */
    .board, .login, .shot { --glass:rgba(15,36,56,.55); -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px); }
  }
  @media (max-width:1000px) { .support { grid-template-columns:minmax(0,1fr); } .feats { grid-template-columns:repeat(2,minmax(0,1fr)); } .how { grid-template-columns:150px minmax(0,1fr); } .shot { grid-column:1 / -1; transform:none; } }
  @media (max-width:820px) {
    .hero { min-height:0; padding-bottom:24px; }
    .hero-grid { grid-template-columns:minmax(0,1fr); gap:14px; padding-top:4px; }
    /* มือถือ: ตารางเล็ก + ครูบูรณ์ครึ่งตัว (≤40vh) ก่อน → H1 → ปุ่มทองเห็นโดยไม่เลื่อน */
    .hero-art { order:-1; min-height:0; height:min(34vh,280px); grid-template-columns:minmax(0,1fr) minmax(0,.9fr); align-items:center; gap:4px; }
    .hero-art { padding-top:0; }
    .board { width:100%; padding:10px 10px 6px; border-radius:14px; }
    .board-h { display:none; }
    .boon { position:relative; right:auto; bottom:auto; width:auto; height:100%; overflow:hidden; display:flex; justify-content:center;
      -webkit-mask-image:linear-gradient(#000 78%, transparent); mask-image:linear-gradient(#000 78%, transparent); }
    .boon img { width:auto; height:175%; max-width:none; }
    .boon::after { display:none; }
    .steps-mini { display:none; }
    .lead { font-size:1rem; margin-top:10px; }
    .cta { position:sticky; bottom:0; z-index:3; margin:16px -16px 0; padding:10px 16px calc(10px + env(safe-area-inset-bottom)); max-width:none;
      background:linear-gradient(rgba(11,20,28,.0), rgba(11,20,28,.94) 18%); }
    .cta .btn { min-height:48px; }
    .sec { padding-top:40px; }
  }
  @media (max-width:640px) {
    .top .gh, .top .kl { display:none; }
    .login-btns, .feats { grid-template-columns:minmax(0,1fr); }
    .how { grid-template-columns:minmax(0,1fr); }
    .how-boon { display:none; }
    .sister { align-items:flex-start; }
  }
  @media (max-width:380px) { .cta-btns { grid-template-columns:minmax(0,1fr); } }
  /* ส่วนล่างไหลเข้าเมื่อเลื่อนถึง (home.js ติด .reveal ให้เฉพาะสิ่งที่ยังอยู่ใต้จอ → ไม่มี JS = เห็นครบตั้งแต่แรก ไม่กระทบ LCP) */
  .reveal:not(.is-in) { opacity:0; }
  .reveal.is-in { animation:m-in var(--d-4) var(--e-out) both; animation-delay:calc(var(--i, 0) * 70ms * var(--m, 1)); }
  @media print { .reveal { opacity:1 !important; animation:none !important; } }
  @media (prefers-reduced-motion:reduce) {
    /* รวม pseudo-element: เงาใต้ครูบูรณ์ (.boon::after) และดาวบนฟ้า ต้องหยุดด้วย (เดิมยังวิ่งอยู่ — บั๊ก H) */
    .hero *, .hero, .sky::before, .hero *::before, .hero *::after, .boon::after { animation:none !important; }
    .shot { transform:none; }
  }
  html.tt-still .boon::after { animation:none !important; }
</style>', DEFAULT_DESC, []);
?>
<section class="hero" aria-labelledby="hero-h">
  <div class="sky" aria-hidden="true">
    <i style="left:8%;top:22%"></i><i style="left:19%;top:64%"></i><i style="left:27%;top:12%"></i><i style="left:36%;top:80%"></i>
    <i style="left:44%;top:34%"></i><i style="left:53%;top:9%"></i><i style="left:61%;top:72%"></i><i style="left:70%;top:28%"></i>
    <i style="left:78%;top:88%"></i><i style="left:86%;top:46%"></i><i style="left:92%;top:16%"></i><i style="left:4%;top:90%"></i>
  </div>
  <div class="wrap">
    <header class="top">
      <?= brand_html() ?>
      <nav aria-label="เมนูหลัก">
        <a class="btn btn-sm" href="guide.php">คู่มือการใช้งาน</a>
        <a class="btn btn-sm kl" href="../khlang/" title="ระบบทะเบียนครุภัณฑ์ ใช้บัญชีเดียวกัน">คลังบริบูรณ์ · ครุภัณฑ์</a>
        <a class="btn btn-sm gh" href="<?= GITHUB_URL ?>" target="_blank" rel="noopener" title="ซอร์สโค้ดบน GitHub">ดาวน์โหลดโปรแกรม</a>
      </nav>
    </header>

    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">ระบบจัดตารางเรียน ตารางสอน · ฟรีตลอดไป</p>
        <h1 id="hero-h">จัดตารางทั้งโรงเรียน<br>ให้เป็นเรื่อง<em>ง่าย<svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8c10-6 18 2 28-2s14-5 22-1 16 4 24-1 14-3 22 1"/></svg></em></h1>
        <p class="lead">กรอกห้องเรียน ครู และวิชา แล้วกดปุ่มเดียวให้ระบบจัดให้ ระบบเตือนทันทีเมื่อครูหรือห้องชนกัน จัดเสร็จส่งออกเป็น Excel และ PDF</p>
        <ol class="steps-mini" aria-label="ขั้นตอนใช้งาน">
          <li><span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><path d="M4 15.5V16h.5L14 6.5 13.5 6zM12.5 4.5l3 3"/></svg></span>กรอก</li>
          <li><span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 8h14M8 3v14"/></svg></span>กดจัด</li>
          <li><span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15h12"/></svg></span>ส่งออก</li>
        </ol>
        <form class="cta" method="post" action="auth/guest.php">
          <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
          <div class="cta-btns">
            <button class="btn btn-primary" type="submit" name="kind" value="sample-primary">ลองใช้ทันที · ประถม</button>
            <button class="btn btn-gold-line" type="submit" name="kind" value="sample">ลองใช้ทันที · มัธยม</button>
          </div>
          <small>ไม่ต้องสมัคร มีข้อมูลตัวอย่างให้ลองจัด ข้อมูลทดลองลบเองหลัง 2 วัน</small>
        </form>
        <p class="stat"><span>มีโรงเรียนใช้ระบบแล้ว</span><b data-count="<?= $schoolCount ?>" style="min-width:<?= strlen(number_format($schoolCount)) ?>ch"><?= number_format($schoolCount) ?></b><span>โรงเรียน</span></p>

        <div class="login">
          <h2>เข้าใช้งาน · สมัครโรงเรียน</h2>
          <?php if ($msg): ?><div class="flash" data-flash role="status"><?= h($msg) ?></div><?php endif; ?>
          <div class="login-btns">
            <?php if ($ready['google']): ?>
              <a class="btn g-btn" href="auth/login.php?p=google">เข้าสู่ระบบด้วย Google</a>
            <?php else: ?>
              <button class="btn g-btn" disabled>เข้าสู่ระบบด้วย Google <span class="soon">(เร็ว ๆ นี้)</span></button>
            <?php endif; ?>
            <?php if ($ready['line']): ?>
              <a class="btn line-btn" href="auth/login.php?p=line">เข้าสู่ระบบด้วย LINE</a>
            <?php else: ?>
              <button class="btn line-btn" disabled>เข้าสู่ระบบด้วย LINE <span class="soon">(เร็ว ๆ นี้)</span></button>
            <?php endif; ?>
          </div>
          <p class="hint">บัญชีเดียวใช้ได้ทั้งตารางบริบูรณ์และคลังบริบูรณ์ · การเข้าใช้งานถือว่ายอมรับ<a href="terms.php">ข้อกำหนดการใช้งาน</a>และ<a href="privacy.php">นโยบายความเป็นส่วนตัว</a></p>
        </div>
      </div>

      <div class="hero-art">
        <figure class="board" aria-label="ตัวอย่างตารางสอน 5 วัน 6 คาบ จัดครบไม่ชน">
          <figcaption class="board-h"><b>ป.4 · ตารางเรียน</b><span>จัดครบ 0 ชน</span></figcaption>
          <svg viewBox="0 0 340 242" width="340" height="242" aria-hidden="true"><?= $svgHead . $svgCells ?></svg>
        </figure>
        <?php if ($heroSet): ?>
          <div class="boon"><img src="<?= h($heroSrc) ?>" srcset="<?= h(implode(', ', $heroSet)) ?>" sizes="<?= $heroSizes ?>" width="900" height="1350" alt="ครูบูรณ์ ครูผู้ช่วยจัดตาราง ถือแท็บเล็ตตารางสอน" fetchpriority="high" decoding="async"></div>
        <?php endif; ?>
      </div>
    </div>
  </div>
</section>

<main class="wrap">
  <section class="sec" aria-labelledby="how-h">
    <h2 id="how-h">ง่ายแค่ 3 ขั้น</h2>
    <p class="sec-lead">ไม่ต้องติดตั้งโปรแกรม เปิดในเบราว์เซอร์ได้ทั้งคอมพิวเตอร์และมือถือ</p>
    <div class="how">
      <div class="how-boon" aria-hidden="true"><?= mascot_img('boon-point-420.webp', 420, 630) ?></div>
      <ol>
        <li><span><b>กรอกข้อมูลโรงเรียน</b>ห้องเรียน ครู วิชา และใครสอนอะไร วางรายชื่อจาก Excel ได้ทีเดียวทั้งโรงเรียน</span></li>
        <li><span><b>กดจัดอัตโนมัติ</b>ระบบวางวิชาให้ครบโดยครูไม่สอนซ้อน ห้องไม่ชน แล้วลากปรับเองต่อได้</span></li>
        <li><span><b>ส่งออก Excel · PDF</b>ตารางรายห้องและรายครู พร้อมพิมพ์ติดบอร์ด</span></li>
      </ol>
      <figure class="shot">
        <img src="assets/guide/g11-board-solved.webp" width="1100" height="688" loading="lazy" decoding="async" alt="หน้าจอตารางที่จัดอัตโนมัติครบทุกคาบ">
        <figcaption>หน้าจอจริงหลังกดจัดอัตโนมัติ</figcaption>
      </figure>
    </div>
  </section>

  <section class="sec" aria-labelledby="feat-h">
    <h2 id="feat-h">ช่วยครูตั้งแต่เริ่มจนจัดเสร็จ</h2>
    <ul class="feats">
      <li class="feat">
        <span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><path d="M10 2.5l1.8 4.2 4.2 1.8-4.2 1.8L10 14.5l-1.8-4.2L4 8.5l4.2-1.8z"/><path d="M15.5 13.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/></svg></span>
        <h3>ตัวช่วยเริ่มต้น</h3>
        <p>ตอบ 4 คำถาม ชั้นที่เปิดสอน ห้องต่อชั้น เวลาเรียน กิจกรรมประจำ ได้ห้องเรียน โครงคาบ และรายวิชาตามหลักสูตรพร้อมใช้</p>
      </li>
      <li class="feat">
        <span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><rect x="5" y="3.5" width="10" height="13" rx="1.5"/><path d="M8 3.5V2.5h4v1M7.5 8h5M7.5 11h5M7.5 14h3"/></svg></span>
        <h3>วางรายชื่อจาก Excel · LINE</h3>
        <p>คัดลอกรายชื่อครู วิชา หรือภาระสอนมาวางทีเดียว ระบบแยกคำนำหน้า ชื่อย่อ และกลุ่มสาระให้เอง</p>
      </li>
      <li class="feat">
        <span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><circle cx="8" cy="6.5" r="3"/><path d="M2.5 16.5c.6-3 2.8-4.5 5.5-4.5 1.2 0 2.3.3 3.2.9M13 13.5l1.8 1.8 3.2-3.6"/></svg></span>
        <h3>เติมครูอัตโนมัติ</h3>
        <p>กดปุ่มเดียว ระบบเลือกครูตามกลุ่มสาระ ครูประจำชั้น และภาระสอนที่ยังว่าง กดเลิกทำได้ทันที</p>
      </li>
      <li class="feat">
        <span class="ring" aria-hidden="true"><svg class="ico" viewBox="0 0 20 20"><path d="M12.5 3.5a3.5 3.5 0 00-4.3 4.4L3.5 12.6v3.9h3.9l4.7-4.7a3.5 3.5 0 004.4-4.3l-2 2-2.2-.6-.6-2.2z"/></svg></span>
        <h3>ติดแล้วกดแก้ให้เลย</h3>
        <p>จัดไม่ลงเพราะอะไร ระบบบอกเป็นภาษาคน พร้อมปุ่มแก้ให้ เช่น เพิ่มเพดานคาบต่อวันของครู แล้วจัดใหม่ได้ทันที</p>
      </li>
    </ul>
    <p class="also">และยังมี <b>จัดอัตโนมัติ</b> · <b>ลากวาง + ตรวจชนทันที</b> ครูสอนซ้อน ห้องใช้ซ้ำ ขึ้นเตือนสีแดง · <b>คาบล็อก</b> กิจกรรมหน้าเสาธง ลูกเสือ ชุมนุม ล็อกไว้ไม่ให้จัดทับ · <b>ส่งออก Excel · PDF</b> ตารางรายห้องและรายครู · อ่านวิธีใช้ทีละขั้นใน<a href="guide.php">คู่มือการใช้งาน</a></p>
  </section>

  <aside class="sister" aria-label="เครื่องมือพี่น้อง">
    <img src="../khlang/assets/brand/mark-on-dark.svg" alt="" width="44" height="44" loading="lazy">
    <p>บัญชีเดียวกันใช้ <a href="../khlang/"><b>คลังบริบูรณ์</b></a> ได้ด้วย · ทะเบียนครุภัณฑ์โรงเรียน ออกเลขอัตโนมัติ สติกเกอร์ QR ยืม–คืน ตรวจนับประจำปี</p>
  </aside>

  <div class="support">
    <?= donate_html() ?>
    <?= feedback_html(['page' => 'index']) ?>
  </div>
</main>

<footer class="foot">
  <div class="wrap">
    <p>ตารางบริบูรณ์ · โดย <a href="../">ศรีโค้ดบูรณ์</a> ครูแจ็ก นาทม นครพนม · <a href="guide.php">คู่มือ</a> · <a href="../khlang/">คลังบริบูรณ์ (ครุภัณฑ์)</a> · <a href="terms.php">ข้อกำหนดการใช้งาน</a> · <a href="privacy.php">นโยบายความเป็นส่วนตัว</a>
      · ดาวน์โหลดโปรแกรม: <a href="<?= GITHUB_URL ?>" target="_blank" rel="noopener">GitHub</a> (<a href="<?= GITHUB_URL ?>/archive/refs/heads/main.zip">.zip</a>)</p>
    <p><?= footer_links_html('#donate', '#feedback') ?></p>
  </div>
</footer>
<?= flash_script($msg, $msgKind) ?>
<?php page_foot();
