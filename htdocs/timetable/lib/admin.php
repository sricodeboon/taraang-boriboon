<?php
// หน้าผู้ดูแลระบบ (อ่านอย่างเดียว): ตัวเลขสรุป, รายชื่อผู้ใช้เรียงตามความสำคัญ, สรุปจังหวัด/อำเภอ
// ใช้ฟังก์ชัน JSON ของ SQLite (json_array_length/json_each) นับในฐานข้อมูลเลย ไม่ json_decode ทั้งก้อนใน PHP
// เวลาในฐาน (created_at/updated_at) เขียนด้วย now() = date() ของ PHP ที่ตั้ง Asia/Bangkok ใน bootstrap → เป็น "เวลาไทย" อยู่แล้ว
// จึงต้องเทียบกับค่าที่ PHP สร้าง (ห้ามใช้ datetime('now') ของ SQLite ซึ่งเป็น UTC)
declare(strict_types=1);

const ADMIN_PAGE_SIZE = 100;
const ADMIN_QUIET_DAYS = 14;

/** ความสำคัญ 1 = ต้องดูแลก่อน · [ชื่อสั้น, คำแนะนำ, คลาสสี] */
const ADMIN_PRIO = [
    1 => ['ลงทะเบียนไม่เสร็จ', 'ล็อกอินแล้วแต่ยังไม่ลงทะเบียนโรงเรียน — ส่งอีเมลชวนทำต่อ', 'p1'],
    2 => ['อาจติดจัดตาราง', 'กรอกงานสอนแล้วแต่ยังไม่มีคาบในตาราง — ถามว่าติดตรงไหน', 'p2'],
    3 => ['สมัครใหม่', 'สมัครภายใน 7 วัน — ทักทาย/ส่งคู่มือ', 'p3'],
    4 => ['ใช้งานอยู่', 'บันทึกภายใน 14 วัน', 'p4'],
    5 => ['เงียบเกิน 14 วัน', 'ไม่ได้บันทึกนานแล้ว', 'p5'],
];

/** ตอบ 404 แบบเดียวกับหน้าที่ไม่มีอยู่จริง (ไม่บอกว่ามีหน้านี้) */
function admin_not_found(): never {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    readfile(dirname(APP_ROOT) . '/404.html');
    exit;
}

/** เงื่อนไข SQL "บัญชีแอดมิน" ของตาราง users (alias u) + พารามิเตอร์ */
function admin_sql_is_admin(): array {
    $emails = admin_emails();
    if (!$emails) return ['0', []];
    return ["(u.provider = 'google' AND LOWER(u.email) IN (" . implode(',', array_fill(0, count($emails), '?')) . '))', $emails];
}

function admin_ago(int $sec): string { return date('Y-m-d H:i:s', time() - $sec); }

/** ตัวเลขสรุปด้านบน (query เล็ก ๆ ไม่แตะ data_json) */
function admin_summary(): array {
    [$isAdm, $admArgs] = admin_sql_is_admin();
    $real = "u.provider <> 'guest' AND NOT $isAdm";
    $d1 = admin_ago(86400);
    $d7 = admin_ago(7 * 86400);

    $u = db_one("SELECT COUNT(*) AS users,
                        COUNT(DISTINCT u.school_id) AS schools,
                        SUM(u.school_id IS NULL) AS no_school,
                        SUM(u.created_at >= ?) AS new1, SUM(u.created_at >= ?) AS new7
                 FROM users u WHERE $real", [$d1, $d7, ...$admArgs]);
    $active = db_one("SELECT COUNT(DISTINCT t.school_id) AS n FROM terms t
                      WHERE t.updated_at >= ? AND t.school_id IN (SELECT u.school_id FROM users u WHERE $real AND u.school_id IS NOT NULL)",
                      [$d1, ...$admArgs]);
    $guest = db_one("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM users WHERE provider = 'guest'");
    $now = time();
    $rate = db_one('SELECT SUM(at > ?) AS h1, COUNT(*) AS d1 FROM rate_hits', [$now - 3600]);

    // ขนาดไฟล์ฐานข้อมูล (รวม -wal) · MySQL ไม่มีไฟล์ให้ดู
    $size = null;
    if (cfg('db.driver', 'sqlite') !== 'mysql') {
        $path = (string) cfg('db.sqlite_path', APP_ROOT . '/storage/timetable.sqlite');
        clearstatcache();
        $size = (is_file($path) ? filesize($path) : 0) + (is_file("$path-wal") ? filesize("$path-wal") : 0);
    }
    return [
        'schools' => (int) $u['schools'], 'users' => (int) $u['users'], 'no_school' => (int) $u['no_school'],
        'new1' => (int) $u['new1'], 'new7' => (int) $u['new7'], 'active1' => (int) $active['n'],
        'guests' => (int) $guest['n'], 'guest_oldest' => $guest['oldest'],
        'rate_h1' => (int) $rate['h1'], 'rate_d1' => (int) $rate['d1'], 'db_bytes' => $size,
    ];
}

/**
 * รายชื่อผู้ใช้เรียงตามความสำคัญ แบ่งหน้า
 * ขั้น 1: คำนวณความสำคัญของทุกแถว (ต้องอ่าน data_json เฉพาะภาคเรียนล่าสุดของแต่ละโรงเรียน นับแค่ assignments/placements)
 * ขั้น 2: ดึงรายละเอียด (ห้อง/ครู/วิชา/คาบที่ต้องวาง) เฉพาะแถวในหน้าที่แสดง
 * @return array{rows:array,total:int,counts:array,page:int,pages:int}
 */
function admin_rows(string $q, int $prio, bool $all, int $page): array {
    [$isAdm, $admArgs] = admin_sql_is_admin();
    $d7 = admin_ago(7 * 86400);
    $quiet = admin_ago(ADMIN_QUIET_DAYS * 86400);

    $where = [];
    $args = [$d7, $quiet, ...$admArgs];
    if (!$all) { $where[] = "u.provider <> 'guest' AND NOT $isAdm"; $args = [...$args, ...$admArgs]; }
    if ($q !== '') {
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $cols = ['u.name', 'u.email', 's.name', 's.school_code', 's.tambon', 's.amphoe', 's.province'];
        $where[] = '(' . implode(' OR ', array_map(fn($c) => "$c LIKE ? ESCAPE '\\'", $cols)) . ')';
        $args = [...$args, ...array_fill(0, count($cols), $like)];
    }
    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $sql = "WITH agg AS (
              SELECT school_id, COUNT(*) AS n_terms, SUM(version - 1) AS saves, MAX(updated_at) AS last_used
              FROM terms GROUP BY school_id),
            lt AS (
              SELECT id, school_id, ROW_NUMBER() OVER (PARTITION BY school_id ORDER BY updated_at DESC, id DESC) AS rn FROM terms),
            cur AS (
              SELECT lt.school_id, lt.id AS term_id, t.version,
                     json_array_length(t.data_json, '$.assignments') AS n_asg,
                     json_array_length(t.data_json, '$.placements') AS n_pl
              FROM lt JOIN terms t ON t.id = lt.id WHERE lt.rn = 1)
            SELECT u.id, cur.term_id, cur.n_asg, cur.n_pl, cur.version AS cur_version, agg.n_terms, agg.saves, agg.last_used,
                   CASE WHEN u.school_id IS NULL THEN 1
                        WHEN COALESCE(cur.n_asg, 0) > 0 AND COALESCE(cur.n_pl, 0) = 0 THEN 2
                        WHEN u.created_at >= ? THEN 3
                        WHEN COALESCE(agg.last_used, u.created_at) >= ? THEN 4
                        ELSE 5 END AS prio,
                   $isAdm AS is_adm
            FROM users u
            LEFT JOIN schools s ON s.id = u.school_id
            LEFT JOIN agg ON agg.school_id = u.school_id
            LEFT JOIN cur ON cur.school_id = u.school_id
            $whereSql
            ORDER BY prio, COALESCE(agg.last_used, u.created_at) DESC, u.id DESC";
    $all_rows = db_all($sql, $args);

    $counts = array_fill_keys(array_keys(ADMIN_PRIO), 0);
    foreach ($all_rows as $r) $counts[(int) $r['prio']]++;
    if ($prio) $all_rows = array_values(array_filter($all_rows, fn($r) => (int) $r['prio'] === $prio));

    $total = count($all_rows);
    $pages = max(1, (int) ceil($total / ADMIN_PAGE_SIZE));
    $page = min(max(1, $page), $pages);
    $slice = array_slice($all_rows, ($page - 1) * ADMIN_PAGE_SIZE, ADMIN_PAGE_SIZE);
    if (!$slice) return ['rows' => [], 'total' => $total, 'counts' => $counts, 'page' => $page, 'pages' => $pages];

    // ขั้น 2: รายละเอียดผู้ใช้/โรงเรียน
    $ids = array_map(fn($r) => (int) $r['id'], $slice);
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $info = [];
    foreach (db_all("SELECT u.id, u.name, u.provider, u.email, u.created_at, u.school_id,
                            s.name AS school, s.school_code, s.tambon, s.amphoe, s.province
                     FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id IN ($ph)", $ids) as $r) {
        $info[(int) $r['id']] = $r;
    }
    // ขั้น 2: ตัวเลขในภาคเรียนล่าสุด (นับในฐานข้อมูล) · คาบที่ต้องวาง = ผลรวม perWeek ของงานสอน
    $tids = array_values(array_unique(array_filter(array_map(fn($r) => (int) $r['term_id'], $slice))));
    $stats = [];
    if ($tids) {
        $tph = implode(',', array_fill(0, count($tids), '?'));
        foreach (db_all("SELECT t.id,
                                json_array_length(t.data_json, '$.classes') AS n_cls,
                                json_array_length(t.data_json, '$.teachers') AS n_tch,
                                json_array_length(t.data_json, '$.subjects') AS n_sub,
                                json_array_length(t.data_json, '$.rooms') AS n_room,
                                (SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.perWeek') AS INTEGER)), 0)
                                   FROM json_each(t.data_json, '$.assignments') j) AS need
                         FROM terms t WHERE t.id IN ($tph)", $tids) as $r) {
            $stats[(int) $r['id']] = $r;
        }
    }
    $rows = [];
    foreach ($slice as $r) {
        $rows[] = $r + ($info[(int) $r['id']] ?? []) + ($stats[(int) $r['term_id']] ?? []);
    }
    return ['rows' => $rows, 'total' => $total, 'counts' => $counts, 'page' => $page, 'pages' => $pages];
}

/** จำนวนโรงเรียนจริงแยกจังหวัด/อำเภอ (ไม่นับโรงเรียนทดลองและโรงเรียนที่มีแต่บัญชีแอดมิน) */
function admin_geo(): array {
    [$isAdm, $admArgs] = admin_sql_is_admin();
    return db_all("SELECT COALESCE(NULLIF(s.province, ''), '(ไม่ระบุ)') AS province, COALESCE(NULLIF(s.amphoe, ''), '(ไม่ระบุ)') AS amphoe,
                          COUNT(*) AS n
                   FROM schools s
                   WHERE s.id IN (SELECT u.school_id FROM users u WHERE u.school_id IS NOT NULL AND u.provider <> 'guest' AND NOT $isAdm)
                   GROUP BY 1, 2 ORDER BY 1, 2", $admArgs);
}

// ---------- ตัวช่วยแสดงผล ----------
const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2026-09-28 14:05:00' (เวลาไทยในฐาน) → '28 ก.ย. 2569 14:05' */
function th_datetime(?string $s, bool $time = true): string {
    if (!$s || !($ts = strtotime($s))) return '–';
    $out = (int) date('j', $ts) . ' ' . TH_MONTHS[(int) date('n', $ts)] . ' ' . ((int) date('Y', $ts) + 543);
    return $time ? $out . ' ' . date('H:i', $ts) : $out;
}

/** ระยะเวลาที่ผ่านมาแบบสั้น: 'เมื่อสักครู่' '5 นาที' '3 ชม.' '12 วัน' */
function th_ago(?string $s): string {
    if (!$s || !($ts = strtotime($s))) return '';
    $d = time() - $ts;
    if ($d < 60) return 'เมื่อสักครู่';
    if ($d < 3600) return intdiv($d, 60) . ' นาทีที่แล้ว';
    if ($d < 86400) return intdiv($d, 3600) . ' ชม.ที่แล้ว';
    return intdiv($d, 86400) . ' วันที่แล้ว';
}

function fmt_bytes(?int $b): string {
    if ($b === null) return '–';
    if ($b < 1024 * 1024) return number_format($b / 1024, 0) . ' KB';
    return number_format($b / 1048576, 1) . ' MB';
}

const PROVIDER_LABEL = ['google' => 'Google', 'line' => 'LINE', 'guest' => 'ทดลอง'];
