<?php
// ฐานข้อมูล: SQLite (ค่าเริ่มต้น) หรือ MySQL ผ่าน PDO + สร้างตารางอัตโนมัติ
declare(strict_types=1);

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    $driver = cfg('db.driver', 'sqlite');
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    if ($driver === 'mysql') {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', cfg('db.host'), cfg('db.name'));
        $pdo = new PDO($dsn, (string) cfg('db.user'), (string) cfg('db.pass'), $opts);
    } else {
        $path = (string) cfg('db.sqlite_path', APP_ROOT . '/storage/timetable.sqlite');
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
    }
    migrate($pdo, $driver);
    return $pdo;
}

function migrate(PDO $pdo, string $driver): void {
    $id = $driver === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $text = $driver === 'mysql' ? 'MEDIUMTEXT' : 'TEXT';
    $tail = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $pdo->exec("CREATE TABLE IF NOT EXISTS schools (
        id $id,
        name VARCHAR(200) NOT NULL,
        school_code VARCHAR(20) NULL,
        tambon VARCHAR(100) NULL,
        amphoe VARCHAR(100) NULL,
        province VARCHAR(100) NULL,
        created_at DATETIME NOT NULL
    )$tail");
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id $id,
        school_id INT NULL,
        provider VARCHAR(20) NOT NULL,
        provider_uid VARCHAR(191) NOT NULL,
        name VARCHAR(200) NULL,
        email VARCHAR(200) NULL,
        avatar VARCHAR(500) NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'owner',
        created_at DATETIME NOT NULL,
        UNIQUE (provider, provider_uid)
    )$tail");
    $pdo->exec("CREATE TABLE IF NOT EXISTS terms (
        id $id,
        school_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        data_json $text NOT NULL,
        version INT NOT NULL DEFAULT 1,
        updated_at DATETIME NOT NULL,
        updated_by INT NULL
    )$tail");
    // จำกัดอัตราการสร้างข้อมูล (เพิ่ม 28 ก.ย. 69): เก็บแค่ชื่อถัง (IP แบบแฮช) + เวลา ลบทิ้งเองหลัง 1 วัน
    $pdo->exec("CREATE TABLE IF NOT EXISTS rate_hits (
        bucket VARCHAR(100) NOT NULL,
        at INT NOT NULL
    )$tail");
    // โลโก้โรงเรียน (เพิ่ม 27 ก.ย. 69): เก็บเป็น data URL PNG/JPEG ในฐาน · logo_rev ใช้เป็นเลขเวอร์ชันกันแคชรูปเก่า
    try {
        $pdo->query('SELECT logo_rev FROM schools LIMIT 0');
    } catch (PDOException) {
        $pdo->exec("ALTER TABLE schools ADD COLUMN logo $text NULL");
        $pdo->exec('ALTER TABLE schools ADD COLUMN logo_rev INT NOT NULL DEFAULT 0');
    }
}

function now(): string { return date('Y-m-d H:i:s'); }

function db_one(string $sql, array $args = []): ?array {
    $st = db()->prepare($sql);
    $st->execute($args);
    $row = $st->fetch();
    return $row ?: null;
}

function db_all(string $sql, array $args = []): array {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st->fetchAll();
}

function db_exec(string $sql, array $args = []): int {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st->rowCount();
}

/** IP ผู้ใช้แบบแฮช (ไม่เก็บ IP จริง) ใช้เป็นชื่อถังของ rate limit */
function client_key(): string {
    return substr(hash('sha256', 'tt-rl|' . ($_SERVER['REMOTE_ADDR'] ?? '-')), 0, 32);
}

/**
 * นับครั้งในหน้าต่างเวลา: เกิน $max ครั้งใน $window วินาที → true (ถูกจำกัด) · ไม่เกิน → บันทึกครั้งนี้แล้วคืน false
 * ใช้กับงานที่สร้างข้อมูลได้โดยไม่ต้องล็อกอิน เช่น โหมดทดลอง
 */
function rate_limited(string $bucket, int $max, int $window): bool {
    $now = time();
    db_exec('DELETE FROM rate_hits WHERE at < ?', [$now - 86400]); // ตารางเล็ก ลบของเก่ากว่า 1 วันทุกครั้ง
    $n = (int) db_one('SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND at > ?', [$bucket, $now - $window])['n'];
    if ($n >= $max) return true;
    db_exec('INSERT INTO rate_hits (bucket, at) VALUES (?, ?)', [$bucket, $now]);
    return false;
}
