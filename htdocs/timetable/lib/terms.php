<?php
// ภาคเรียน: สร้างจากแม่แบบ, โหลด, บันทึกแบบตรวจ version
declare(strict_types=1);

const TERM_MAX_BYTES = 1_500_000;

const TEMPLATE_KINDS = ['sample', 'sample-primary', 'blank'];
const SUBJECT_BANDS = ['primary', 'lower', 'upper'];

/**
 * kind: sample = ตัวอย่างมัธยม · sample-primary = ตัวอย่างประถม · blank = ตารางว่าง
 * band (เฉพาะ blank): ใส่รายวิชาพื้นฐานของ primary|lower|upper มาให้ · sem: ภาคเรียนของวิชามัธยม (1|2)
 */
function term_template(string $kind, ?string $band = null, int $sem = 1): array {
    if ($kind === 'sample' || $kind === 'sample-primary') {
        $file = APP_ROOT . '/assets/solver/' . ($kind === 'sample' ? 'sample-school.json' : 'sample-primary.json');
        $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($data)) {
            unset($data['meta']);
            $data['placements'] = [];
            return $data;
        }
    }
    // ตารางว่าง: 5 วัน 8 คาบ พักเที่ยงหลังคาบ 4
    $times = [['08:30', '09:20'], ['09:20', '10:10'], ['10:10', '11:00'], ['11:00', '11:50'],
              ['12:50', '13:40'], ['13:40', '14:30'], ['14:30', '15:20'], ['15:20', '16:10']];
    $periods = [];
    foreach ($times as $i => [$s, $e]) {
        if ($i === 4) $periods[] = ['label' => 'พักกลางวัน', 'start' => '11:50', 'end' => '12:50', 'type' => 'break'];
        $periods[] = ['label' => (string) ($i + 1), 'start' => $s, 'end' => $e, 'type' => 'class'];
    }
    return [
        'term' => ['name' => 'ภาคเรียนที่ 1', 'days' => 5, 'periods' => $periods],
        'classes' => [], 'teachers' => [], 'rooms' => [], 'subjects' => curriculum_subjects($band, $sem),
        'assignments' => [], 'locks' => [], 'placements' => [],
    ];
}

/** รายวิชาจาก data/curriculum.json ของทุกชั้นในช่วงชั้น (มัธยมเลือกภาคเรียน) · band ไม่รู้จัก → [] */
function curriculum_subjects(?string $band, int $sem = 1): array {
    if (!in_array($band, SUBJECT_BANDS, true)) return [];
    $c = json_decode((string) @file_get_contents(APP_ROOT . '/data/curriculum.json'), true);
    $out = [];
    foreach ($c['levels'] ?? [] as $lv) {
        if ($lv['band'] !== $band || ($lv['sem'] && $lv['sem'] !== $sem)) continue;
        foreach ($lv['subjects'] as $s) {
            $row = ['id' => 's' . (count($out) + 1), 'code' => $s['code'], 'name' => $s['name'], 'color' => $s['color']];
            if ((int) ($s['perWeek'] ?? 0) > 0) $row['perWeek'] = (int) $s['perWeek']; // คาบ/สัปดาห์ตามหลักสูตร (ค่าเริ่มต้นตอนสร้างการสอน)
            $out[] = $row;
        }
    }
    return $out;
}

/** ชื่อภาคเรียนมี "ภาคเรียนที่ 2" → วิชามัธยมภาค 2 */
function term_sem(?string $name): int { return preg_match('/ภาคเรียนที่\s*2/u', (string) $name) ? 2 : 1; }

function create_term(int $schoolId, int $userId, string $kind, ?string $name = null, ?string $band = null): int {
    $data = term_template($kind, $band, term_sem($name));
    $name = $name ?: ($data['term']['name'] ?? 'ภาคเรียนใหม่');
    $data['term']['name'] = $name;
    db_exec('INSERT INTO terms (school_id, name, data_json, version, updated_at, updated_by) VALUES (?,?,?,?,?,?)',
        [$schoolId, $name, json_encode($data, JSON_UNESCAPED_UNICODE), 1, now(), $userId]);
    return (int) db()->lastInsertId();
}

function load_term(int $schoolId, int $termId): ?array {
    $t = db_one('SELECT * FROM terms WHERE id = ? AND school_id = ?', [$termId, $schoolId]);
    if (!$t) return null;
    return ['id' => (int) $t['id'], 'name' => $t['name'], 'version' => (int) $t['version'],
            'updated_at' => $t['updated_at'], 'data' => json_decode($t['data_json'], true)];
}

/** ตรวจโครงเอกสารแบบหยาบ ๆ กันข้อมูลเสีย */
function validate_term_doc($d): ?string {
    if (!is_array($d) || !is_array($d['term'] ?? null)) return 'ข้อมูลภาคเรียนไม่ถูกต้อง';
    $days = $d['term']['days'] ?? 0;
    if (!is_int($days) || $days < 1 || $days > 7) return 'จำนวนวันต้องอยู่ระหว่าง 1–7';
    $periods = $d['term']['periods'] ?? null;
    if (!is_array($periods) || count($periods) < 1 || count($periods) > 20) return 'จำนวนคาบต้องอยู่ระหว่าง 1–20';
    foreach (['classes', 'teachers', 'rooms', 'subjects', 'assignments', 'locks', 'placements'] as $k) {
        if (!is_array($d[$k] ?? null)) return "ข้อมูล $k ไม่ถูกต้อง";
        if (count($d[$k]) > 5000) return "ข้อมูล $k มากเกินไป";
    }
    return null;
}

/**
 * ลบโรงเรียนทดลองที่อายุเกิน 48 ชม. (ผู้ใช้ + โรงเรียน + ภาคเรียน) ทีละไม่เกิน $limit รายการ ในธุรกรรมเดียว
 * โฮสต์ไม่มี cron → เรียกตอนสร้างโรงเรียนทดลองใหม่ (auth/guest.php) และสุ่มจาก api.php
 */
function cleanup_guests(int $limit = 100): int {
    $cutoff = date('Y-m-d H:i:s', time() - 48 * 3600);
    $old = db_all("SELECT id, school_id FROM users WHERE provider = 'guest' AND created_at < ? LIMIT " . max(1, min(500, $limit)), [$cutoff]);
    if (!$old) return 0;
    db_tx(function () use ($old) {
        foreach ($old as $g) {
            if ($g['school_id']) {
                db_exec('DELETE FROM terms WHERE school_id = ?', [$g['school_id']]);
                db_exec('DELETE FROM schools WHERE id = ?', [$g['school_id']]);
            }
            db_exec('DELETE FROM users WHERE id = ?', [$g['id']]);
        }
    });
    return count($old);
}
