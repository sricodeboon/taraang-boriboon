<?php
// JSON API ของแอป: ทุกคำขอผูกกับโรงเรียนของผู้ใช้ที่ล็อกอิน
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/terms.php';
require __DIR__ . '/lib/school.php';

[$user, $school] = require_school(true);
$sid = (int) $school['id'];
$r = $_GET['r'] ?? '';
$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($isPost) csrf_check();

function body(): array {
    $raw = file_get_contents('php://input', false, null, 0, TERM_MAX_BYTES + 1);
    if ($raw === false || strlen($raw) > TERM_MAX_BYTES) json_out(['error' => 'ข้อมูลใหญ่เกินไป'], 413);
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

try {
    switch ($r) {
        case 'me':
            $terms = db_all('SELECT id, name, version, updated_at FROM terms WHERE school_id = ? ORDER BY id DESC', [$sid]);
            json_out([
                'user' => ['name' => $user['name'], 'avatar' => $user['avatar'], 'provider' => $user['provider'], 'role' => $user['role']],
                'school' => school_public($school),
                'terms' => $terms,
                'csrf' => csrf_token(),
            ]);

        case 'term':
            $t = load_term($sid, (int) ($_GET['id'] ?? 0));
            if (!$t) json_out(['error' => 'ไม่พบภาคเรียน'], 404);
            json_out($t);

        case 'term.save':
            if (!$isPost) json_out(['error' => 'ต้องใช้ POST'], 405);
            $b = body();
            $id = (int) ($b['id'] ?? 0);
            $err = validate_term_doc($b['data'] ?? null);
            if ($err) json_out(['error' => $err], 422);
            $name = trim((string) ($b['data']['term']['name'] ?? 'ภาคเรียน')) ?: 'ภาคเรียน';
            $n = db_exec('UPDATE terms SET data_json = ?, name = ?, version = version + 1, updated_at = ?, updated_by = ?
                          WHERE id = ? AND school_id = ? AND version = ?',
                [json_encode($b['data'], JSON_UNESCAPED_UNICODE), mb_substr($name, 0, 200), now(), $user['id'], $id, $sid, (int) ($b['version'] ?? 0)]);
            if ($n === 0) {
                $cur = db_one('SELECT version FROM terms WHERE id = ? AND school_id = ?', [$id, $sid]);
                if (!$cur) json_out(['error' => 'ไม่พบภาคเรียน'], 404);
                json_out(['error' => 'มีการแก้ไขจากที่อื่นก่อนหน้า กรุณาโหลดข้อมูลล่าสุด', 'conflict' => true, 'version' => (int) $cur['version']], 409);
            }
            $v = db_one('SELECT version, updated_at FROM terms WHERE id = ?', [$id]);
            json_out(['ok' => true, 'version' => (int) $v['version'], 'updated_at' => $v['updated_at']]);

        case 'term.create':
            if (!$isPost) json_out(['error' => 'ต้องใช้ POST'], 405);
            $b = body();
            $count = (int) db_one('SELECT COUNT(*) AS n FROM terms WHERE school_id = ?', [$sid])['n'];
            if ($count >= 20) json_out(['error' => 'สร้างได้ไม่เกิน 20 ภาคเรียนต่อโรงเรียน'], 422);
            $kind = in_array($b['template'] ?? '', [...TEMPLATE_KINDS, 'copy'], true) ? $b['template'] : 'blank';
            $band = in_array($b['band'] ?? null, SUBJECT_BANDS, true) ? $b['band'] : null;
            $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 200) ?: null;
            if ($kind === 'copy') {
                $src = load_term($sid, (int) ($b['from'] ?? 0));
                if (!$src) json_out(['error' => 'ไม่พบภาคเรียนต้นฉบับ'], 404);
                $data = $src['data'];
                $data['term']['name'] = $name ?: ($src['name'] . ' (สำเนา)');
                db_exec('INSERT INTO terms (school_id, name, data_json, version, updated_at, updated_by) VALUES (?,?,?,?,?,?)',
                    [$sid, $data['term']['name'], json_encode($data, JSON_UNESCAPED_UNICODE), 1, now(), $user['id']]);
                $id = (int) db()->lastInsertId();
            } else {
                $id = create_term($sid, (int) $user['id'], $kind, $name, $band);
            }
            json_out(['ok' => true, 'id' => $id]);

        case 'term.delete':
            if (!$isPost) json_out(['error' => 'ต้องใช้ POST'], 405);
            $b = body();
            $count = (int) db_one('SELECT COUNT(*) AS n FROM terms WHERE school_id = ?', [$sid])['n'];
            if ($count <= 1) json_out(['error' => 'ต้องมีอย่างน้อย 1 ภาคเรียน'], 422);
            db_exec('DELETE FROM terms WHERE id = ? AND school_id = ?', [(int) ($b['id'] ?? 0), $sid]);
            json_out(['ok' => true]);

        case 'school.save':
            if (!$isPost) json_out(['error' => 'ต้องใช้ POST'], 405);
            if (!is_owner($user)) json_out(['error' => 'เฉพาะเจ้าของโรงเรียนแก้ข้อมูลโรงเรียนได้'], 403);
            $v = body();
            $err = validate_school($v);
            if ($err) json_out(['error' => $err], 422);
            db_exec('UPDATE schools SET name = ?, school_code = ?, tambon = ?, amphoe = ?, province = ? WHERE id = ?',
                [$v['name'], $v['code'], $v['tambon'], $v['amphoe'], $v['province'], $sid]);
            json_out(['ok' => true, 'school' => school_public(current_school())]);

        case 'school.logo':
            if (!$isPost) json_out(['error' => 'ต้องใช้ POST'], 405);
            if (!is_owner($user)) json_out(['error' => 'เฉพาะเจ้าของโรงเรียนเปลี่ยนโลโก้ได้'], 403);
            $b = body();
            $logo = null;
            if (($b['logo'] ?? null) !== null) {
                [$logo, $err] = validate_logo((string) $b['logo']);
                if ($err) json_out(['error' => $err], 422);
            }
            // logo_rev เพิ่มทุกครั้ง แม้ตอนลบ เพื่อให้เบราว์เซอร์ไม่ใช้รูปเก่าจากแคช
            db_exec('UPDATE schools SET logo = ?, logo_rev = logo_rev + 1 WHERE id = ?', [$logo, $sid]);
            $rev = (int) db_one('SELECT logo_rev FROM schools WHERE id = ?', [$sid])['logo_rev'];
            json_out(['ok' => true, 'logoRev' => $logo === null ? 0 : $rev]);

        default:
            json_out(['error' => 'ไม่รู้จักคำสั่ง'], 404);
    }
} catch (Throwable $e) {
    error_log('API error: ' . $e->getMessage());
    json_out(['error' => 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่'], 500);
}
