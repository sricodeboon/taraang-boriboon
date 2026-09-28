<?php
declare(strict_types=1);
date_default_timezone_set('Asia/Bangkok');
// บีบอัด HTML/JSON ด้วย gzip (โฮสต์ฟรีบางที่ไม่บีบให้ และ php -S ไม่บีบเลย) — ob_gzhandler ดู Accept-Encoding เอง
if (PHP_SAPI !== 'cli' && extension_loaded('zlib') && !ini_get('zlib.output_compression')) ob_start('ob_gzhandler');
// CSP: หน้านี้ใช้แค่ไฟล์ในเว็บเดียวกัน (mind.js, ฟอนต์, รูป) + <style> inline — ไม่มี inline script จึงห้าม script อื่นทั้งหมด
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");

$services = [
    ['เว็บไซต์', 'ร้านค้า ธุรกิจ หน่วยงาน เปิดบนมือถือได้สวย'],
    ['แอปมือถือ', 'Android และ iOS เชื่อมกับระบบหลังบ้านของคุณ'],
    ['ระบบหลังบ้าน', 'สมาชิก สต็อก ออกบิล รายงาน ใช้งานผ่านเว็บ'],
    ['ระบบชุมชน', 'สหกรณ์ กลุ่มอาชีพ ร้านค้าท้องถิ่น'],
];
$assetVersion = (string) @filemtime(__DIR__ . '/assets/mind.js');
?>
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ศรีโค้ดบูรณ์ · ครูแจ็ก รับเขียนโปรแกรม</title>
<meta name="description" content="โค้ดครบ งานบริบูรณ์ · เขียนให้ใช้ได้ สอนให้ใช้เป็น รับเขียนเว็บ แอป และระบบหลังบ้าน โดยครูแจ็ก นาทม นครพนม">
<meta name="theme-color" content="#0B141C">
<link rel="icon" href="assets/icon-180.png">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<link rel="preload" href="/assets/fonts/IBMPlexSansThai-400-thai.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ChakraPetch-700-thai.woff2" as="font" type="font/woff2" crossorigin>
<style><?php readfile(__DIR__ . '/assets/fonts/fonts.css'); ?></style>
<style>
  :root {
    --night:#0B141C; --ink:#0F2438; --gold:#E3B85A; --blue:#7FB0E8; --pink:#F0A6BD;
    --mist:#F2F4F1; --muted:#9FB0B5; --line:rgba(242,244,241,.12);
    --display:"Chakra Petch","IBM Plex Sans Thai",system-ui,sans-serif;
    --body:"IBM Plex Sans Thai",system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
    color-scheme: dark;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; background:var(--night); color:var(--mist); font-family:var(--body); }
  body { -webkit-font-smoothing:antialiased; }
  a { color:inherit; }

  #mind { position:fixed; inset:0; display:block; touch-action:pan-y; }

  .top { position:fixed; top:0; left:0; right:0; z-index:3; display:flex; justify-content:space-between; align-items:center;
         padding:calc(16px + env(safe-area-inset-top,0px)) clamp(16px,4vw,48px) 22px; pointer-events:none;
         background:linear-gradient(to bottom, var(--night) 55%, rgba(11,20,28,0)); }
  .top > * { pointer-events:auto; }
  .wm { font-family:var(--display); font-weight:700; font-size:1.15rem; text-decoration:none; letter-spacing:.01em; }
  .wm .b { font-family:var(--mono); color:var(--gold); }
  .wm .c { color:var(--blue); }
  .chat-link { font-size:.9rem; text-decoration:none; padding:8px 14px; border:1px solid var(--line); border-radius:999px;
               background:rgba(11,20,28,.4); backdrop-filter:blur(6px); }
  .chat-link:hover, .chat-link:focus-visible { border-color:var(--gold); }

  .hero { position:relative; z-index:2; min-height:100svh; display:flex; align-items:flex-end;
          padding:0 clamp(16px,4vw,48px) clamp(32px,8vh,88px); pointer-events:none; }
  .hero-text { max-width:30rem; display:grid; gap:14px; }
  .eyebrow { font-family:var(--mono); font-size:.78rem; letter-spacing:.12em; color:var(--blue); margin:0; }
  h1 { font-family:var(--display); font-weight:700; font-size:clamp(2.4rem,6.4vw,4.6rem); line-height:1.05; margin:0; text-wrap:balance; }
  h1 em { font-style:normal; color:var(--gold); }
  .lede { margin:0; color:#C9D2D4; font-size:clamp(1rem,1.6vw,1.15rem); line-height:1.7; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:6px; pointer-events:auto; }
  .btn { display:inline-flex; align-items:center; gap:8px; padding:12px 20px; border-radius:999px; font-weight:600;
         text-decoration:none; font-size:.98rem; transition:transform .15s ease, background .15s ease; }
  .btn:active { transform:scale(.97); }
  .btn-primary { background:var(--gold); color:var(--ink); }
  .btn-primary:hover, .btn-primary:focus-visible { background:#EFC874; }
  .btn-ghost { border:1px solid var(--line); background:rgba(11,20,28,.45); backdrop-filter:blur(6px); }
  .btn-ghost:hover, .btn-ghost:focus-visible { border-color:var(--blue); }
  :focus-visible { outline:2px solid var(--blue); outline-offset:3px; }

  .shape-label { position:fixed; z-index:2; right:clamp(16px,4vw,48px); bottom:calc(18px + env(safe-area-inset-bottom,0px));
                 font-family:var(--mono); font-size:.78rem; color:var(--muted); text-align:right; pointer-events:none; line-height:1.6; }
  .shape-label b { color:var(--mist); font-weight:500; }
  .shape-label .br { color:var(--gold); }

  .panel { position:relative; z-index:2; background:var(--night); border-top:1px solid var(--line);
           padding:clamp(48px,9vh,96px) clamp(16px,4vw,48px); }
  .panel-inner { max-width:1040px; margin:0 auto; display:grid; gap:32px; }
  .panel h2 { font-family:var(--display); font-size:clamp(1.6rem,3.4vw,2.3rem); margin:0; }
  .panel h2 span { color:var(--gold); }
  .svc { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-top:1px solid var(--line); }
  .svc li { padding:22px 20px 22px 0; display:grid; gap:6px; }
  .svc li + li { padding-left:20px; border-left:1px solid var(--line); }
  .svc b { font-family:var(--display); font-size:1.15rem; font-weight:600; }
  .svc span { color:var(--muted); font-size:.95rem; line-height:1.6; }
  .promise { display:grid; grid-template-columns:auto 1fr; gap:14px 20px; align-items:start; padding:22px; border:1px solid var(--line); border-radius:14px; }
  .promise .k { font-family:var(--mono); color:var(--gold); font-size:1.6rem; line-height:1; }
  .promise p { margin:0; line-height:1.7; color:#C9D2D4; }
  .promise p b { color:var(--mist); }
  footer { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; color:var(--muted); font-size:.88rem;
           border-top:1px solid var(--line); padding-top:22px; }
  footer a { text-decoration:none; }
  footer a:hover { color:var(--mist); }

  .work { display:grid; gap:14px; }
  .work h3 { font-family:var(--display); font-size:1.3rem; margin:0; }
  .work h3 span { color:var(--gold); }
  .work-list { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; }
  .work-card { display:grid; gap:6px; padding:18px 20px; border:1px solid var(--line); border-radius:14px; text-decoration:none; color:inherit;
    background:rgba(127,176,232,.05); transition:border-color .15s; }
  .work-card:hover, .work-card:focus-visible { border-color:var(--gold); }
  .work-card b { font-family:var(--display); font-size:1.1rem; }
  .work-card span { color:var(--muted); font-size:.93rem; line-height:1.6; }
  .work-top { display:flex; align-items:center; justify-content:space-between; }
  .work-top img { border-radius:10px; }
  .work-card i { font-style:normal; font-family:var(--mono); font-size:.8rem; color:var(--gold); }
  .top-links { display:flex; gap:8px; align-items:center; }
  @media (max-width:860px) {
    .hero { align-items:flex-end; }
    .hero-text { background:linear-gradient(to top, rgba(11,20,28,.92) 55%, rgba(11,20,28,0)); padding-top:48px; max-width:none; }
    .svc { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .svc li + li { border-left:0; padding-left:0; }
    .svc li:nth-child(even) { padding-left:20px; border-left:1px solid var(--line); }
    .svc li:nth-child(n+3) { border-top:1px solid var(--line); }
    .shape-label { display:none; }
  }
  @media (max-width:420px) {
    .svc { grid-template-columns:minmax(0,1fr); }
    .svc li, .svc li:nth-child(even) { padding-left:0; border-left:0; }
    .svc li + li { border-top:1px solid var(--line); }
  }
</style>
</head>
<body>
<canvas id="mind" aria-hidden="true"></canvas>

<header class="top">
  <a class="wm" href="./" aria-label="ศรีโค้ดบูรณ์ หน้าแรก">ศรี<span class="b">{</span><span class="c">โค้ด</span><span class="b">}</span>บูรณ์</a>
  <nav class="top-links">
    <a class="chat-link" href="#work">ผลงาน</a>
    <a class="chat-link" href="https://m.me/sricodeboon" target="_blank" rel="noopener">ทักแชต</a>
  </nav>
</header>

<main>
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow">ครูแจ็ก · นาทม นครพนม</p>
      <h1>โค้ดครบ<br><em>งานบริบูรณ์</em></h1>
      <p class="lede">เขียนให้ใช้ได้ สอนให้ใช้เป็น รับเขียนเว็บ แอป และระบบหลังบ้าน ส่งงานพร้อมคู่มือ</p>
      <div class="actions">
        <a class="btn btn-primary" href="https://m.me/sricodeboon" target="_blank" rel="noopener">ทักแชตคุยงาน</a>
        <a class="btn btn-ghost" href="#services">ดูบริการ</a>
      </div>
    </div>
  </section>

  <section class="panel" id="services">
    <div class="panel-inner">
      <h2>รับทำ<span>อะไรบ้าง</span></h2>
      <ul class="svc">
        <?php foreach ($services as [$name, $desc]): ?>
          <li><b><?= htmlspecialchars($name) ?></b><span><?= htmlspecialchars($desc) ?></span></li>
        <?php endforeach; ?>
      </ul>
      <div class="work" id="work">
        <h3>ผลงาน<span>ตัวอย่าง</span></h3>
        <ul class="work-list">
          <li><a class="work-card" href="timetable/">
            <span class="work-top"><img src="timetable/assets/brand/taraang-app-icon-192.png" alt="" width="44" height="44"><i>/timetable</i></span>
            <b>ตารางบริบูรณ์</b>
            <span>ระบบจัดตารางเรียนตารางสอนออนไลน์ ลากวาง ตรวจคาบชน จัดอัตโนมัติ ส่งออก Excel และ PDF ลองใช้ได้ทันทีโดยไม่ต้องสมัคร</span>
          </a></li>
          <li><a class="work-card" href="dpa/">
            <span class="work-top"><img src="dpa/icon-192.png" alt="" width="44" height="44"><i>/dpa</i></span>
            <b>DPA พร้อมส่ง</b>
            <span>ย่อวิดีโอการสอนหลาย GB ให้เหลือ 500 MB แปลง MOV จาก iPhone เป็น MP4 ตัดให้ไม่เกิน 60 นาที รวม PDF ทำในเครื่องครูเอง ฟรี ไม่ต้องลงโปรแกรม</span>
          </a></li>
          <li><a class="work-card" href="khlang/">
            <span class="work-top"><img src="khlang/assets/brand/app-icon-192.png" alt="" width="44" height="44"><i>/khlang</i></span>
            <b>คลังบริบูรณ์</b>
            <span>ระบบทะเบียนครุภัณฑ์โรงเรียน ออกเลขอัตโนมัติ ถ่ายรูป พิมพ์สติกเกอร์ QR สแกนตรวจนับประจำปี ยืม–คืน ทะเบียนคุมพร้อมค่าเสื่อมราคา ใช้บัญชีเดียวกับตารางบริบูรณ์</span>
          </a></li>
        </ul>
      </div>
      <div class="promise">
        <span class="k">{ }</span>
        <p><b>ทำไมต้องครูแจ็ก</b><br>ส่งงานแล้วไม่หายไปไหน ทุกงานสอนใช้จนเป็น มีคู่มือให้ และตอบคำถามหลังส่งงาน</p>
      </div>
      <footer>
        <span>© <?= date('Y') ?> ศรีโค้ดบูรณ์ · ครูแจ็ก</span>
        <span><a href="mailto:sricodeboon@gmail.com">sricodeboon@gmail.com</a> · <a href="https://www.facebook.com/sricodeboon" target="_blank" rel="noopener">facebook.com/sricodeboon</a></span>
      </footer>
    </div>
  </section>
</main>

<div class="shape-label" aria-live="off"><span class="br">{</span> <b id="mind-label">ทรงกลมถ่ายโอน</b> <span class="br">}</span><br>ขยับเมาส์ หรือแตะเพื่อส่งคลื่น</div>

<script src="assets/mind.js?v=<?= htmlspecialchars($assetVersion) ?>" defer></script>
</body>
</html>
