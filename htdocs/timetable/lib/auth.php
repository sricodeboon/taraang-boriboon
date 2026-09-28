<?php
// ผู้ใช้และโรงเรียน: ล็อกอินผ่าน Google/LINE, ผูกผู้ใช้กับโรงเรียน, ตรวจสิทธิ์
declare(strict_types=1);

function current_user(): ?array {
    static $cache = false;
    if ($cache !== false) return $cache;
    $id = $_SESSION['uid'] ?? null;
    $cache = $id ? db_one('SELECT * FROM users WHERE id = ?', [$id]) : null;
    return $cache;
}

function current_school(): ?array {
    $u = current_user();
    if (!$u || !$u['school_id']) return null;
    // ไม่ดึงคอลัมน์ logo (ใหญ่ได้ถึง ~200KB) — ส่งรูปผ่าน logo.php แยก
    return db_one('SELECT id, name, school_code, tambon, amphoe, province, created_at,
                          CASE WHEN logo IS NULL THEN 0 ELSE logo_rev END AS logo_rev FROM schools WHERE id = ?', [$u['school_id']]);
}

/** เรียกหลัง OAuth สำเร็จ: สร้างหรืออัปเดตผู้ใช้ แล้วเก็บใน session */
function login_user(string $provider, string $uid, ?string $name, ?string $email, ?string $avatar): array {
    $u = db_one('SELECT * FROM users WHERE provider = ? AND provider_uid = ?', [$provider, $uid]);
    if ($u) {
        db_exec('UPDATE users SET name = ?, email = ?, avatar = ? WHERE id = ?', [$name, $email, $avatar, $u['id']]);
        $id = (int) $u['id'];
    } else {
        db_exec('INSERT INTO users (provider, provider_uid, name, email, avatar, role, created_at) VALUES (?,?,?,?,?,?,?)',
            [$provider, $uid, $name, $email, $avatar, 'owner', now()]);
        $id = (int) db()->lastInsertId();
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    return db_one('SELECT * FROM users WHERE id = ?', [$id]);
}

function logout_user(): void {
    $_SESSION = [];
    session_regenerate_id(true);
}

/** หน้าที่ต้องล็อกอินและมีโรงเรียนแล้ว */
function require_school(bool $json = false): array {
    $u = current_user();
    if (!$u) {
        if ($json) json_out(['error' => 'กรุณาเข้าสู่ระบบ'], 401);
        redirect('index.php');
    }
    $s = current_school();
    if (!$s) {
        if ($json) json_out(['error' => 'กรุณาลงทะเบียนโรงเรียนก่อน'], 403);
        redirect('signup.php');
    }
    return [$u, $s];
}

function is_owner(array $u): bool { return ($u['role'] ?? '') === 'owner'; }

/** อีเมลผู้ดูแลระบบ (ตัวพิมพ์เล็ก) · ตั้งทับได้ด้วย 'admin_emails' ใน config.php */
function admin_emails(): array {
    $list = cfg('admin_emails');
    if (!is_array($list) || !$list) $list = ['sricodeboon@gmail.com', 'dev.nathom@gmail.com'];
    return array_values(array_unique(array_filter(array_map(fn($e) => strtolower(trim((string) $e)), $list))));
}

/** ผู้ดูแลระบบ = ล็อกอินด้วย Google เท่านั้น (อีเมล gmail ยืนยันโดย Google) และอีเมลอยู่ในรายการ · LINE/โหมดทดลองไม่นับ */
function is_admin(?array $u): bool {
    if (!$u || ($u['provider'] ?? '') !== 'google') return false;
    $email = strtolower(trim((string) ($u['email'] ?? '')));
    return $email !== '' && in_array($email, admin_emails(), true);
}

/** ข้อมูลโรงเรียนที่ส่งให้หน้าเว็บ (ไม่มีตัวรูปโลโก้) */
function school_public(array $s): array {
    return [
        'name' => $s['name'], 'code' => $s['school_code'], 'tambon' => $s['tambon'],
        'amphoe' => $s['amphoe'], 'province' => $s['province'], 'logoRev' => (int) ($s['logo_rev'] ?? 0),
    ];
}

function providers_ready(): array {
    return [
        'google' => cfg('google.client_id') !== '' && cfg('google.client_secret') !== '' && cfg('google.client_id') !== null,
        'line' => cfg('line.channel_id') !== '' && cfg('line.channel_secret') !== '' && cfg('line.channel_id') !== null,
    ];
}
