<?php
// หัวและท้ายหน้าร่วม
declare(strict_types=1);

const DEFAULT_DESC = 'ตารางบริบูรณ์ ระบบจัดตารางเรียนตารางสอนออนไลน์ฟรีสำหรับโรงเรียน จัดอัตโนมัติ ลากวาง ตรวจคาบชน ส่งออก Excel และ PDF โดยศรีโค้ดบูรณ์';

function page_head(string $title, string $extraHead = '', string $desc = DEFAULT_DESC): void { ?>
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?></title>
<meta name="description" content="<?= h($desc) ?>">
<meta name="theme-color" content="#0F2438">
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

function page_foot(): void { ?>
</body>
</html>
<?php }
