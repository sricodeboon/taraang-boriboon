<?php
// หัวและท้ายหน้าร่วม + component ภาพลักษณ์ (เลี้ยงโอวัลติน · ข้อเสนอแนะ · ช่องทางติดต่อ · ลิงก์ท้ายหน้า)
declare(strict_types=1);

const DEFAULT_DESC = 'ตารางบริบูรณ์ ระบบจัดตารางเรียนตารางสอนออนไลน์ฟรีสำหรับโรงเรียน จัดอัตโนมัติ ลากวาง ตรวจคาบชน ส่งออก Excel และ PDF โดยศรีโค้ดบูรณ์';

// ค่าเริ่มต้นเมื่อ config.php ไม่มีคีย์นี้ · ตั้งเป็น '' ใน config = ปิดส่วนนั้น (กล่องหาย)
const BRAND_DEFAULTS = [
    'donate.promptpay' => '0930732896',
    'donate.name' => 'รัชเดช ศรีแก้ว',
    'contact.facebook' => 'https://www.facebook.com/sricodeboon',
    'contact.email' => 'sricodeboon@gmail.com',
];
// QR ใน assets/brand/ สร้างจากเบอร์นี้เท่านั้น → ตั้งเบอร์อื่นใน config แล้วไม่แสดง QR (กันโอนผิดคน) เหลือเบอร์ + ปุ่มคัดลอก
const DONATE_QR_NO = '0930732896';

/**
 * $og: null = ไม่ใส่ og meta (หน้าในแอป/แอดมิน) · [] = ใช้ค่าเริ่มต้น · ใส่คีย์ title/desc/image/url ทับได้
 * ภาพ og (assets/og-image.jpg 1200×630) ใส่เฉพาะเมื่อมีไฟล์จริง
 */
function page_head(string $title, string $extraHead = '', string $desc = DEFAULT_DESC, ?array $og = null): void { ?>
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?></title>
<meta name="description" content="<?= h($desc) ?>">
<meta name="theme-color" content="#0F2438">
<?= $og === null ? '' : og_meta($og + ['title' => $title, 'desc' => $desc]) ?>
<script nonce="<?= csp_nonce() ?>">try{if(localStorage.getItem('tt-still')==='1')document.documentElement.classList.add('tt-still')}catch(e){}</script>
<style>html.tt-still *,html.tt-still *::before,html.tt-still *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style>
<link rel="icon" href="assets/brand/taraang-favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/brand/taraang-favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="assets/brand/taraang-app-icon-180.png">
<link rel="preload" href="/assets/fonts/IBMPlexSansThai-400-thai.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ChakraPetch-700-thai.woff2" as="font" type="font/woff2" crossorigin>
<style><?php readfile(dirname(APP_ROOT) . '/assets/fonts/fonts.css'); ?></style>
<style><?php readfile(APP_ROOT . '/assets/app.css'); /* ฝังในหน้า ไม่ให้ CSS บล็อกการแสดงผล */ ?></style>
<?= $extraHead ?>
</head>
<body>
<?php }

/** og/twitter meta สำหรับแชร์ลิงก์ (Facebook/LINE ต้องใช้ URL เต็ม) */
function og_meta(array $o): string {
    $url = (string) ($o['url'] ?? base_url(basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'index.php'))));
    $img = (string) ($o['image'] ?? 'assets/og-image.jpg');
    $out = '<meta property="og:type" content="website"><meta property="og:site_name" content="ตารางบริบูรณ์"><meta property="og:locale" content="th_TH">'
        . '<meta property="og:title" content="' . h((string) $o['title']) . '"><meta property="og:description" content="' . h((string) $o['desc']) . '">'
        . '<meta property="og:url" content="' . h($url) . '">';
    if (preg_match('#^https?://#', $img)) {
        $abs = $img;
    } elseif (is_file(APP_ROOT . '/' . $img)) {
        $abs = base_url($img) . '?v=' . (int) @filemtime(APP_ROOT . '/' . $img);
    } else {
        return $out . '<meta name="twitter:card" content="summary">';
    }
    return $out . '<meta property="og:image" content="' . h($abs) . '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
        . '<meta property="og:image:alt" content="ครูบูรณ์ถือแท็บเล็ตตารางสอน · ตารางบริบูรณ์ จัดตารางสอนฟรี"><meta name="twitter:card" content="summary_large_image">';
}

function brand_html(string $href = 'index.php'): string {
    return '<a class="brand" href="' . h($href) . '"><img class="brand-mark" src="assets/brand/taraang-mark-color.svg" alt="" width="32" height="32"><span>ตาราง<span class="b">{</span><span class="c">บริบูรณ์</span><span class="b">}</span></span></a>';
}

/**
 * แสดงข้อความ flash ด้วย SweetAlert2 (assets/notify.js): ok/info = toast มุมจอ · warn/error = กล่องแจ้งเตือน
 * กล่อง .flash ในหน้า (ไม่ต้องใช้ JS) ถูกซ่อนเมื่อโหลด SweetAlert2 ได้ · โหลดไม่ได้ = คงกล่องเดิมไว้
 */
function flash_script(?string $msg, string $kind = 'warn'): string {
    if (!$msg) return '';
    $j = fn($v) => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    return '<script type="module" nonce="' . csp_nonce() . '">import * as n from "./assets/notify.js?v=' . (int) @filemtime(APP_ROOT . '/assets/notify.js') . '";'
        . 'const m=' . $j($msg) . ',k=' . $j($kind) . ';'
        . 'n.load().then((S)=>{if(!S)return;document.querySelectorAll(".flash[data-flash]").forEach((e)=>{e.hidden=true;});'
        . 'if(k==="ok"||k==="info")n.toast(m,k,6000);else n.alertBox(k==="error"?"เกิดข้อผิดพลาด":"แจ้งเตือน",m,k==="error"?"error":"warning");});</script>';
}

function page_foot(): void {
    // หน้าที่มี component ด้านล่าง → โหลด home.js ครั้งเดียวท้ายหน้า (ปุ่มคัดลอก/ฟอร์ม/กาง #donate/หยุดภาพเคลื่อนไหว)
    if (!empty($GLOBALS['TT_HOME_JS'])) echo home_script_tag(); ?>
</body>
</html>
<?php }

// ================= component ภาพลักษณ์ (BRAND-MASCOT ข้อ 6.4–6.6) =================
// ทุกตัวคืนสตริง HTML · สไตล์ฝังครั้งเดียวต่อหน้าพร้อม component แรก · ไม่มี inline onclick (ผูกใน assets/home.js)

/** ค่า config ของแบรนด์ (มีค่าเริ่มต้นใน BRAND_DEFAULTS) */
function brand_cfg(string $key): string {
    return trim((string) cfg($key, BRAND_DEFAULTS[$key] ?? ''));
}

/** <script> โหลด assets/home.js (?v=เวลาแก้ไฟล์) · page_foot() ใส่ให้เองเมื่อหน้ามี component */
function home_script_tag(): string {
    $GLOBALS['TT_HOME_JS'] = false;
    return '<script type="module" nonce="' . csp_nonce() . '" src="assets/home.js?v=' . (int) @filemtime(APP_ROOT . '/assets/home.js') . '"></script>';
}

/** ภาพมาสคอตจาก assets/mascot/ · ยังไม่มีไฟล์ = ไม่แสดง (ไม่เสีย hit กับ 404) · width/height = ขนาดจริงของไฟล์ */
function mascot_img(string $file, int $w, int $h, string $class = '', bool $lazy = true): string {
    $p = APP_ROOT . '/assets/mascot/' . $file;
    if (!preg_match('/^[a-z0-9-]+\.webp$/', $file) || !is_file($p)) return '';
    return '<img class="' . h($class) . '" src="assets/mascot/' . h($file) . '?v=' . (int) @filemtime($p) . '" width="' . $w . '" height="' . $h . '" alt=""'
        . ($lazy ? ' loading="lazy"' : '') . ' decoding="async">';
}

/**
 * สไตล์ component ฝังในหน้าเป็นชิ้น (ส่งครั้งเดียวต่อชิ้นต่อหน้า) → หน้าที่มีแค่ลิงก์ท้ายหน้าไม่ต้องแบกสไตล์กล่องบริจาค/ฟอร์ม
 * ใช้ token สีจาก app.css · ไม่มีเขียว · ไม่มีแถบขอบซ้าย · บีบช่องว่างตอนส่ง (อ่านง่ายในซอร์ส หน้าเบาลง)
 */
function brand_css(string $part): string {
    static $sent = [];
    $GLOBALS['TT_HOME_JS'] ??= true;
    $css = [
        'base' => '.tt-ico { width:20px; height:20px; flex:none; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }',
        'donate' => '.tt-donate { margin-block:24px; }
.tt-donate-d { background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
.tt-donate-sum { display:flex; align-items:center; gap:14px; padding:16px 20px; cursor:pointer; list-style:none; min-height:68px; }
.tt-donate-sum::-webkit-details-marker { display:none; }
.tt-donate-sum:focus-visible { outline:2px solid var(--blue); outline-offset:-2px; }
.tt-donate-sum h2, .tt-donate-sum h3 { font-size:1.15rem; }
.tt-donate-sum p { margin:2px 0 0; color:var(--muted); font-size:.9rem; }
.tt-cup { display:grid; place-items:center; width:44px; height:44px; flex:none; border-radius:50%; background:var(--gold-soft); border:1px solid var(--gold-bg); color:var(--gold); }
.tt-toggle { margin-left:auto; display:flex; align-items:center; gap:6px; color:var(--blue); font-weight:600; white-space:nowrap; }
.tt-toggle .tt-ico { transition:transform .32s cubic-bezier(.2,.8,.2,1); }
.tt-donate-d[open] .tt-toggle .tt-ico { transform:rotate(180deg); }
.tt-toggle .t-close, .tt-donate-d[open] .tt-toggle .t-open { display:none; }
.tt-donate-d[open] .tt-toggle .t-close { display:inline; }
.tt-donate-d[open] > .tt-donate-sum { border-bottom:1px solid var(--line); }
.tt-donate-body { display:grid; grid-template-columns:minmax(0,1fr) 270px 190px; }
.tt-donate.compact .tt-donate-body { grid-template-columns:minmax(0,1fr) 270px; }
.tt-donate-text { padding:20px 24px; display:grid; gap:10px; align-content:start; max-width:40rem; }
.tt-donate-text p { margin:0; }
.tt-pp { padding:20px; background:var(--surface-2); border:1px solid var(--gold-bg); border-radius:12px; margin:16px; display:grid; justify-items:center; gap:2px; text-align:center; }
.tt-pp-head { font-family:var(--display); font-weight:600; margin-bottom:8px; }
.tt-pp-qr { display:block; width:200px; height:200px; border:1px solid var(--line); border-radius:6px; background:#fff; padding:6px; }
.tt-pp-name { font-weight:600; margin:8px 0 0; }
.tt-pp-no { margin:0; font-size:1.15rem; letter-spacing:.02em; font-variant-numeric:tabular-nums; }
.tt-pp-btns { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; justify-self:stretch; }
.tt-pp-btns.one { grid-template-columns:1fr; }
.tt-pp-btns .btn { padding-inline:8px; white-space:normal; }
.tt-donate-art { position:relative; display:grid; place-items:end center; padding:12px 12px 0; }
.tt-donate-art img { display:block; width:100%; max-width:170px; height:auto; }
.tt-steam { position:absolute; top:18%; left:50%; width:40px; height:44px; margin-left:-20px; fill:none; stroke:var(--muted); stroke-width:2; stroke-linecap:round; opacity:.5; }
.tt-steam path { animation:tt-steam 3.2s cubic-bezier(.2,.8,.2,1) infinite; transform-box:fill-box; transform-origin:center; }
.tt-steam path + path { animation-delay:1.6s; }
@keyframes tt-steam { 0% { opacity:0; transform:translateY(8px); } 40% { opacity:1; } 100% { opacity:0; transform:translateY(-8px); } }
@media (max-width:820px) {
  .tt-donate-body, .tt-donate.compact .tt-donate-body { grid-template-columns:minmax(0,1fr); }
  .tt-donate-art { display:none; }
  .tt-pp { margin:0 16px 16px; }
}
@media (max-width:640px) {
  .tt-toggle span { display:none !important; }
  .tt-donate-sum { padding:14px 16px; }
  .tt-donate-text { padding:16px; }
}
@media (prefers-reduced-motion:reduce) { .tt-steam path { animation:none; opacity:.6; } .tt-toggle .tt-ico { transition:none; } }',
        'fb' => '.tt-fb { margin-block:24px; display:grid; grid-template-columns:150px minmax(0,1fr); gap:20px; padding:20px 24px; background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
.tt-fb.no-art { grid-template-columns:minmax(0,1fr); }
.tt-fb h2, .tt-fb h3 { font-size:1.15rem; }
.tt-fb-art { align-self:end; }
.tt-fb-art img { display:block; width:100%; height:auto; }
.tt-fb-main { display:grid; gap:12px; align-content:start; min-width:0; }
.tt-fb-main > p { margin:0; color:var(--muted); }
.tt-fb-form { display:grid; gap:12px; }
.tt-fb-form fieldset { border:0; margin:0; padding:0; min-width:0; }
.tt-fb-form legend { font-size:.88rem; color:var(--muted); font-weight:500; padding:0; margin-bottom:6px; }
.tt-chips { display:flex; flex-wrap:wrap; gap:8px; }
.tt-chip { position:relative; cursor:pointer; }
.tt-chip input { position:absolute; opacity:0; inset:0; margin:0; cursor:pointer; }
.tt-chip span { display:inline-flex; align-items:center; padding:6px 14px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); font-size:.92rem; }
.tt-chip input:checked + span { background:var(--gold-soft); border-color:var(--gold-bg); color:var(--ink); font-weight:600; }
.tt-chip input:focus-visible + span { outline:2px solid var(--blue); outline-offset:2px; }
.tt-fb-form textarea { min-height:110px; resize:vertical; }
.tt-hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
.tt-fb-send { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
.tt-fb-status { margin:0; font-size:.9rem; color:var(--muted); }
.tt-fb-status.err { color:var(--danger); }
.tt-fb-done { padding:14px 16px; border-radius:10px; background:var(--blue-soft); border:1px solid var(--blue); display:grid; gap:8px; }
.tt-fb-done p { margin:0; }
.tt-fb-done:focus { outline:none; }
@media (max-width:640px) { .tt-fb { grid-template-columns:minmax(0,1fr); padding:16px; } .tt-fb-art { display:none; } }',
        'contact' => '.tt-contact { display:grid; gap:6px; padding-top:12px; border-top:1px solid var(--line); }
.tt-contact-h { margin:0; font-weight:600; }
.tt-contact-btns { display:flex; flex-wrap:wrap; gap:8px; }
.tt-mail { display:inline-flex; flex-wrap:wrap; gap:4px; }
.tt-contact .hint { margin:0; }',
        'foot' => '.tt-foot-links button { font:inherit; color:var(--blue); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }',
    ];
    $out = '';
    foreach ($part === 'foot' ? ['foot'] : ['base', $part] as $k) {
        if (isset($sent[$k]) || !isset($css[$k])) continue;
        $sent[$k] = true;
        $out .= preg_replace(['/\s*\n\s*/', '/\s*([{};:,>])\s*/'], ['', '$1'], $css[$k]);
    }
    return $out === '' ? '' : '<style>' . $out . '</style>';
}

/** เบอร์พร้อมเพย์แบบอ่านง่าย 0930732896 → 093-073-2896 (เลขอื่นแสดงตามเดิม) */
function promptpay_display(string $digits): string {
    return preg_match('/^0\d{9}$/', $digits) ? substr($digits, 0, 3) . '-' . substr($digits, 3, 3) . '-' . substr($digits, 6) : $digits;
}

/**
 * กล่อง "เลี้ยงโอวัลตินครูแจ็กสักแก้ว" (หุบไว้ กางเองเมื่อ URL มี #<id>)
 * $o: id (ค่าเริ่มต้น 'donate') · compact (true = ไม่มีภาพครูบูรณ์ ข้อความสั้น สำหรับแท็บส่งออก) · h ('h2'|'h3')
 * config donate.promptpay ว่าง = ไม่แสดงกล่อง (คืน '')
 */
function donate_html(array $o = []): string {
    $no = preg_replace('/\D/', '', brand_cfg('donate.promptpay'));
    if ($no === '') return '';
    $name = brand_cfg('donate.name');
    $id = preg_match('/^[a-z][a-z0-9-]*$/', (string) ($o['id'] ?? '')) ? $o['id'] : 'donate';
    $hx = ($o['h'] ?? 'h2') === 'h3' ? 'h3' : 'h2';
    $compact = !empty($o['compact']);
    $shown = promptpay_display($no);
    $qr = $no === DONATE_QR_NO && is_file(APP_ROOT . '/assets/brand/promptpay-qr.svg');
    $cup = '<svg class="tt-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h10v5a4 4 0 01-4 4H8a4 4 0 01-4-4z"/><path d="M14 8.5h1.3a2 2 0 010 4H14"/><path d="M7 2.5c-.8 1 .8 1.8 0 3M10.5 2.5c-.8 1 .8 1.8 0 3"/></svg>';
    $chev = '<svg class="tt-ico" viewBox="0 0 20 20"><path d="M5.5 8l4.5 4.5L14.5 8"/></svg>';

    $text = $compact
        ? '<p>ตารางบริบูรณ์ใช้ฟรีทุกฟีเจอร์ ถ้าช่วยให้จัดตารางเสร็จก่อนเลิกงาน เลี้ยงโอวัลตินครูแจ็กสักแก้วเป็นกำลังใจได้ครับ</p>'
          . '<p class="hint">ยอดเท่าไรก็ได้ตามสะดวก · เงินใช้เป็นค่าโดเมน ค่าโฮสต์ และทำเครื่องมือครูตัวต่อไป</p>'
        : '<p>ตารางบริบูรณ์ทำโดยครูแจ็ก ครูโรงเรียนเล็กชายแดน ในเวลาหลังเลิกสอน อยากให้ครูทุกคนจัดตารางเสร็จก่อนเลิกงาน ไม่ต้องนั่งตัดกระดาษทั้งคืน</p>'
          . '<p>เงินสนับสนุนใช้เป็นค่าโดเมน ค่าโฮสต์ และเวลาพัฒนาเครื่องมือครูตัวต่อไป</p>'
          . '<p class="hint">ยอดเท่าไรก็ได้ตามสะดวก ไม่บังคับ · บนมือถือ กด "บันทึกรูป QR" แล้วเปิดรูปในแอปธนาคาร</p>';

    $card = '<figure class="tt-pp"><figcaption class="tt-pp-head">พร้อมเพย์ · PromptPay</figcaption>'
        . ($qr ? '<img class="tt-pp-qr" src="assets/brand/promptpay-qr.svg" width="220" height="220" loading="lazy" alt="QR พร้อมเพย์ ' . h($shown) . ' ' . h($name) . '">' : '')
        . ($name !== '' ? '<p class="tt-pp-name">' . h($name) . '</p>' : '')
        . '<p class="tt-pp-no mono">' . h($shown) . '</p>'
        . '<div class="tt-pp-btns' . ($qr ? '' : ' one') . '">'
        . '<button class="btn btn-sm" type="button" data-copy="' . h($no) . '" data-done="คัดลอกแล้ว ขอบคุณครับ">คัดลอกเบอร์</button>'
        . ($qr ? '<a class="btn btn-sm" href="assets/brand/promptpay-qr.png" download="พร้อมเพย์-ตารางบริบูรณ์.png">บันทึกรูป QR</a>' : '')
        . '</div></figure>';

    $art = '';
    if (!$compact && ($img = mascot_img('boon-ovaltine-420.webp', 420, 630))) {
        // ควันโอวัลติน SVG 2 เส้น (หยุดเมื่อ reduced-motion / ปุ่มหยุดภาพเคลื่อนไหว)
        $art = '<div class="tt-donate-art" aria-hidden="true"><svg class="tt-steam" viewBox="0 0 40 44"><path d="M14 40c-5-6 5-10 0-17s4-10 0-17"/><path d="M26 40c-5-6 5-10 0-17s4-10 0-17"/></svg>' . $img . '</div>';
    }

    return brand_css('donate')
        . '<section class="tt-donate' . ($compact || $art === '' ? ' compact' : '') . '" id="' . h($id) . '" aria-labelledby="' . h($id) . '-h">'
        . '<details class="tt-donate-d" id="' . h($id) . '-d" data-donate>'
        . '<summary class="tt-donate-sum"><span class="tt-cup" aria-hidden="true">' . $cup . '</span>'
        . '<div><' . $hx . ' id="' . h($id) . '-h">เลี้ยงโอวัลตินครูแจ็กสักแก้ว</' . $hx . '><p>ไม่บังคับ ใช้ฟรีทุกฟีเจอร์เหมือนเดิม</p></div>'
        . '<span class="tt-toggle" aria-hidden="true"><span class="t-open">ดูช่องทางสนับสนุน</span><span class="t-close">ซ่อน</span>' . $chev . '</span></summary>'
        . '<div class="tt-donate-body"><div class="tt-donate-text">' . $text . '</div>' . $card . $art . '</div>'
        . '</details></section>';
}

/**
 * ฟอร์มข้อเสนอแนะ ส่งไป feedback.php (สัญญา WP2: csrf, kind, message 10–2000, contact ≤200, website = honeypot, page ≤100)
 * JS: home.js ส่งแบบ fetch (Accept: application/json) · ไม่มี JS = POST ธรรมดา → feedback.php redirect กลับพร้อม flash
 * $o: id (ค่าเริ่มต้น 'feedback') · page (ชื่อหน้า ค่าเริ่มต้น = ชื่อไฟล์ PHP) · compact (ไม่มีภาพ) · h ('h2'|'h3') · contact (false = ไม่แสดงช่องทางติดต่อใต้ฟอร์ม)
 */
function feedback_html(array $o = []): string {
    // time-trap: feedback.php ทิ้งเงียบถ้าส่งเร็วกว่า 4 วินาทีหลังฟอร์มแสดงครั้งแรกของ session
    // ตั้งเฉพาะครั้งแรก (??=) — session ใช้ร่วมทุกแท็บ ถ้าตั้งใหม่ทุกหน้า เปิดคู่มือแท็บใหม่แล้วกดส่งจากแท็บเดิมจะถูกทิ้งเงียบ
    // feedback.php ตั้งค่าใหม่หลังส่งสำเร็จเอง
    if (session_status() === PHP_SESSION_ACTIVE) $_SESSION['fb_t'] ??= time();
    $id = preg_match('/^[a-z][a-z0-9-]*$/', (string) ($o['id'] ?? '')) ? $o['id'] : 'feedback';
    $hx = ($o['h'] ?? 'h2') === 'h3' ? 'h3' : 'h2';
    $page = mb_substr((string) ($o['page'] ?? basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'index.php'), '.php')), 0, 100);
    $art = empty($o['compact']) ? mascot_img('boon-listen-420.webp', 420, 630) : '';
    $kinds = ['bug' => 'ติดปัญหา', 'feature' => 'อยากได้ฟีเจอร์', 'praise' => 'ชมเชย', 'other' => 'อื่น ๆ'];
    $chips = '';
    foreach ($kinds as $k => $label) {
        $chips .= '<label class="tt-chip"><input type="radio" name="kind" value="' . $k . '" required><span>' . $label . '</span></label>';
    }
    return brand_css('fb')
        . '<section class="tt-fb' . ($art === '' ? ' no-art' : '') . '" id="' . h($id) . '" aria-labelledby="' . h($id) . '-h" data-fb>'
        . ($art !== '' ? '<div class="tt-fb-art" aria-hidden="true">' . $art . '</div>' : '')
        . '<div class="tt-fb-main">'
        . '<' . $hx . ' id="' . h($id) . '-h">บอกครูบูรณ์ได้เลยครับ</' . $hx . '>'
        . '<p>ติดปัญหาตรงไหน อยากได้อะไรเพิ่ม หรืออยากชม เล่ามาได้เลย ครูแจ็กอ่านทุกข้อความ</p>'
        . '<form class="tt-fb-form" action="feedback.php" method="post" data-feedback>'
        . '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '"><input type="hidden" name="page" value="' . h($page) . '">'
        . '<fieldset><legend>เรื่องที่อยากบอก</legend><div class="tt-chips">' . $chips . '</div></fieldset>'
        . '<div class="field"><label for="' . h($id) . '-msg">ข้อความ</label>'
        . '<textarea class="input" id="' . h($id) . '-msg" name="message" required minlength="10" maxlength="2000" rows="4" placeholder="เล่ามาได้เลยครับ"></textarea></div>'
        . '<div class="field"><label for="' . h($id) . '-ct">ช่องทางติดต่อกลับ (ไม่บังคับ)</label>'
        . '<input class="input" id="' . h($id) . '-ct" name="contact" maxlength="200" autocomplete="email" placeholder="อีเมล หรือ LINE ID"></div>'
        . '<div class="tt-hp" aria-hidden="true"><label>เว็บไซต์ <input name="website" tabindex="-1" autocomplete="off"></label></div>'
        . '<div class="tt-fb-send"><button class="btn btn-primary" type="submit">ส่งถึงครูแจ็ก</button>'
        . '<p class="tt-fb-status" role="status" aria-live="polite" data-fb-status></p></div>'
        . '</form>'
        . '<div class="tt-fb-done" tabindex="-1" hidden data-fb-done><p><b>ได้รับแล้ว ขอบคุณครับ</b></p>'
        . '<p>ครูแจ็กอ่านทุกข้อความ ถ้าฝากช่องทางไว้จะตอบกลับช่วงเย็นหลังเลิกสอน (ไม่มีอีเมลยืนยันอัตโนมัติ)</p>'
        . '<p><button class="btn btn-sm" type="button" data-fb-again>ส่งอีกเรื่อง</button></p></div>'
        . (($o['contact'] ?? true) ? contact_html() : '')
        . '</div></section>';
}

/** ช่องทางติดต่อ 2 ทาง: เพจ Facebook ศรีโค้ดบูรณ์ + อีเมล (mailto + ปุ่มคัดลอก) · config ว่างทั้งคู่ = '' */
function contact_html(): string {
    $fb = brand_cfg('contact.facebook');
    $mail = brand_cfg('contact.email');
    if (!preg_match('#^https://#', $fb)) $fb = '';
    if (!filter_var($mail, FILTER_VALIDATE_EMAIL)) $mail = '';
    if ($fb === '' && $mail === '') return '';
    $btns = '';
    if ($fb !== '') {
        $btns .= '<a class="btn btn-sm" href="' . h($fb) . '" target="_blank" rel="noopener">'
            . '<svg class="tt-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 9.5a6.5 6 0 1113 0 6.5 6 0 01-9.6 5.3L3.5 16l1-3.1a5.8 5.8 0 01-1-3.4z"/></svg>เพจ ศรีโค้ดบูรณ์</a>';
    }
    if ($mail !== '') {
        $btns .= '<span class="tt-mail"><a class="btn btn-sm" href="mailto:' . h($mail) . '">'
            . '<svg class="tt-ico" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M3 5.5l7 5.5 7-5.5"/></svg><span class="mono">' . h($mail) . '</span></a>'
            . '<button class="btn btn-sm" type="button" data-copy="' . h($mail) . '" data-done="คัดลอกแล้ว" aria-label="คัดลอก อีเมล ' . h($mail) . '">คัดลอก</button></span>';
    }
    return brand_css('contact')
        . '<div class="tt-contact"><p class="tt-contact-h">ติดต่อครูแจ็ก</p><div class="tt-contact-btns">' . $btns . '</div>'
        . '<p class="hint">ครูแจ็ก รร.ตชด. อ.นาทม จ.นครพนม ตอบช่วงเย็นหลังเลิกสอนครับ</p></div>';
}

/**
 * ลิงก์ท้ายหน้า (ใส่ต่อท้ายใน <footer> ของแต่ละหน้า): สนับสนุน · แนะนำ·ติดต่อ · เพจ/อีเมล · ปุ่มหยุดภาพเคลื่อนไหว
 * หน้าที่มีกล่องในตัว (index) ส่ง '#donate', '#feedback' · หน้าอื่นใช้ค่าเริ่มต้นไปหน้าแรก
 */
function footer_links_html(string $donateHref = 'index.php#donate', string $feedbackHref = 'index.php#feedback'): string {
    $parts = [];
    if (preg_replace('/\D/', '', brand_cfg('donate.promptpay')) !== '') $parts[] = '<a href="' . h($donateHref) . '">สนับสนุน</a>';
    $parts[] = '<a href="' . h($feedbackHref) . '">แนะนำ·ติดต่อ</a>';
    $fb = brand_cfg('contact.facebook');
    if (preg_match('#^https://#', $fb)) $parts[] = '<a href="' . h($fb) . '" target="_blank" rel="noopener">เพจ ศรีโค้ดบูรณ์</a>';
    $mail = brand_cfg('contact.email');
    if (filter_var($mail, FILTER_VALIDATE_EMAIL)) $parts[] = '<a href="mailto:' . h($mail) . '">' . h($mail) . '</a>';
    $parts[] = '<button type="button" data-still aria-pressed="false">หยุดภาพเคลื่อนไหว</button>';
    return brand_css('foot') . '<span class="tt-foot-links">' . implode(' · ', $parts) . '</span>';
}
