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
        $pdo = new PDO('sqlite:' . $path, null, null, $opts + [PDO::ATTR_TIMEOUT => 4]);
        // busy_timeout ต้องมาก่อนคำสั่งอื่น: หลายโรงเรียนบันทึกพร้อมกัน → รอคิวล็อกแทนที่จะล้มทันที (เดิมตั้งหลัง journal_mode)
        $pdo->exec('PRAGMA busy_timeout = 4000');
        sqlite_journal($pdo);
        $pdo->exec('PRAGMA foreign_keys = ON');
        // SQLite: migrate เฉพาะเมื่อ lib/db.php เปลี่ยน (เก็บ mtime ไว้ใน user_version) — เดิมรัน CREATE TABLE ×4 + SELECT ทุก request
        // ใครเพิ่ม migration ใน migrate() ไม่ต้องทำอะไรเพิ่ม: แก้ไฟล์นี้แล้ว mtime เปลี่ยน migrate จะรันเองหนึ่งครั้ง (ทุกคำสั่งต้องรันซ้ำได้)
        $stamp = (int) @filemtime(__FILE__);
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== $stamp) {
            migrate($pdo, $driver);
            $pdo->exec('PRAGMA user_version = ' . $stamp);
        }
        return $pdo;
    }
    // MySQL: ใช้ไฟล์ stamp แทน user_version (CREATE INDEX ที่มีอยู่แล้วจะ error ทุกครั้ง ไม่ควรรันทุก request)
    $stampFile = APP_ROOT . '/storage/mysql-schema.stamp';
    $stamp = (string) @filemtime(__FILE__);
    if (@file_get_contents($stampFile) !== $stamp) {
        migrate($pdo, $driver);
        @file_put_contents($stampFile, $stamp, LOCK_EX);
    }
    return $pdo;
}

/**
 * โหมด journal ของ SQLite: ค่าเริ่มต้นขอ WAL (อ่านพร้อมเขียนได้ เขียนเร็วกว่า) ถ้าโฮสต์ใช้ WAL ไม่ได้
 * (ไฟล์ -shm สร้าง/mmap ไม่ได้ ระบบไฟล์เครือข่าย) SQLite จะคืนโหมดเดิมมา → ถอยไป DELETE ซึ่งปลอดภัยทุกระบบไฟล์
 * ตั้งทับได้ด้วย 'db' => ['sqlite_journal' => 'delete'] ใน config.php ถ้าพบปัญหา WAL บนโฮสต์
 * synchronous: WAL ใช้ NORMAL (ปลอดภัยเมื่อ PHP ล่ม เสียได้แค่ธุรกรรมล่าสุดถ้าไฟดับ) · DELETE คง FULL
 */
function sqlite_journal(PDO $pdo): string {
    $want = strtolower((string) cfg('db.sqlite_journal', 'wal'));
    if (!in_array($want, ['wal', 'delete', 'truncate'], true)) $want = 'wal';
    $mode = strtolower((string) $pdo->query('PRAGMA journal_mode')->fetchColumn());
    if ($mode !== $want) {
        try { $mode = strtolower((string) $pdo->query('PRAGMA journal_mode = ' . strtoupper($want))->fetchColumn()); }
        catch (PDOException $e) { error_log('sqlite journal_mode ' . $want . ' ไม่ได้: ' . $e->getMessage()); }
        if ($mode !== $want && $want === 'wal') {
            error_log("sqlite: ใช้ WAL ไม่ได้ (ได้ $mode) ถอยไปใช้ DELETE");
            try { $mode = strtolower((string) $pdo->query('PRAGMA journal_mode = DELETE')->fetchColumn()); } catch (PDOException) { /* ใช้โหมดเดิม */ }
        }
    }
    $pdo->exec('PRAGMA synchronous = ' . ($mode === 'wal' ? 'NORMAL' : 'FULL'));
    return $mode;
}

/** ข้อมูลสุขภาพฐานข้อมูล (ให้หน้าแอดมินแสดง): โหมด journal, เวอร์ชัน, ขนาดไฟล์ */
function db_info(): array {
    if (cfg('db.driver', 'sqlite') === 'mysql') return ['driver' => 'mysql'];
    $pdo = db();
    $path = (string) cfg('db.sqlite_path', APP_ROOT . '/storage/timetable.sqlite');
    $pages = (int) $pdo->query('PRAGMA page_count')->fetchColumn();
    $free = (int) $pdo->query('PRAGMA freelist_count')->fetchColumn();
    $size = (int) $pdo->query('PRAGMA page_size')->fetchColumn();
    return [
        'driver' => 'sqlite',
        'journal_mode' => (string) $pdo->query('PRAGMA journal_mode')->fetchColumn(),
        'synchronous' => (int) $pdo->query('PRAGMA synchronous')->fetchColumn(),
        'sqlite_version' => (string) $pdo->query('SELECT sqlite_version()')->fetchColumn(),
        'db_bytes' => (int) @filesize($path),
        'wal_bytes' => (int) @filesize($path . '-wal'),
        'free_bytes' => $free * $size,
        'used_bytes' => ($pages - $free) * $size,
    ];
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
    // ดัชนี (เพิ่ม 28 ก.ย. 69 รองรับหลายโรงเรียน): เดิมไม่มีเลย ทุกคำค้นเป็น full scan
    // - terms_school_upd: รายการภาคเรียนของโรงเรียน (me/app.php/นับเพดาน) + หน้าแอดมิน (สรุปความเคลื่อนไหว)
    // - users_school: หาผู้ใช้ของโรงเรียน (แอดมิน) · users_provider_created: ลบ/นับโรงเรียนทดลอง
    // - rate_hits_bucket_at / rate_hits_at: นับครั้งในหน้าต่างเวลา + ลบของเก่า
    // (users(provider, provider_uid) มี UNIQUE อยู่แล้ว = มีดัชนีในตัว)
    foreach ([
        'terms_school_upd' => 'terms (school_id, updated_at, version)',
        'users_school' => 'users (school_id)',
        'users_provider_created' => 'users (provider, created_at)',
        'rate_hits_bucket_at' => 'rate_hits (bucket, at)',
        'rate_hits_at' => 'rate_hits (at)',
    ] as $name => $on) {
        if ($driver === 'mysql') {
            // MySQL ไม่มี CREATE INDEX IF NOT EXISTS → สร้างแล้วเงียบถ้ามีอยู่แล้ว
            try { $pdo->exec("CREATE INDEX $name ON $on"); } catch (PDOException) { /* มีแล้ว */ }
        } else {
            $pdo->exec("CREATE INDEX IF NOT EXISTS $name ON $on");
        }
    }
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
    return db_retry(function () use ($sql, $args) {
        $st = db()->prepare($sql);
        $st->execute($args);
        return $st->rowCount();
    });
}

/** SQLITE_BUSY/LOCKED (5/6) ที่ busy_timeout รอแล้วยังไม่ได้ → รอสุ่มสั้น ๆ แล้วลองใหม่ (รวม 3 ครั้ง) · error อื่นโยนต่อทันที */
function db_is_busy(PDOException $e): bool {
    $code = (int) ($e->errorInfo[1] ?? 0);
    return in_array($code, [5, 6], true) || str_contains($e->getMessage(), 'database is locked');
}

function db_retry(callable $fn, int $tries = 3) {
    for ($i = 1; ; $i++) {
        try { return $fn(); }
        catch (PDOException $e) {
            // ในธุรกรรม ห้ามลองซ้ำทีละคำสั่ง (ให้ db_tx() ย้อนแล้วลองทั้งก้อน)
            if ($i >= $tries || !db_is_busy($e) || !empty($GLOBALS['DB_IN_TX'])) throw $e;
            usleep(random_int(50_000, 250_000) * $i);
        }
    }
}

/** ธุรกรรมสั้น ๆ: รวมหลายคำสั่งเขียนเป็นการ fsync ครั้งเดียว (SQLite เร็วขึ้นมาก) · IMMEDIATE จองสิทธิ์เขียนตั้งแต่ต้น ไม่ชนกลางทาง */
function db_tx(callable $fn) {
    return db_retry(function () use ($fn) {
        $pdo = db();
        $pdo->exec(cfg('db.driver', 'sqlite') === 'mysql' ? 'START TRANSACTION' : 'BEGIN IMMEDIATE');
        $GLOBALS['DB_IN_TX'] = true;
        try {
            $r = $fn();
            $pdo->exec('COMMIT');
            return $r;
        } catch (Throwable $e) {
            try { $pdo->exec('ROLLBACK'); } catch (PDOException) { /* ไม่มีธุรกรรมค้าง */ }
            throw $e;
        } finally {
            $GLOBALS['DB_IN_TX'] = false;
        }
    });
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
    db_exec('DELETE FROM rate_hits WHERE at < ?', [$now - 86400]); // ตารางเล็ก ลบของเก่ากว่า 1 วันทุกครั้ง (มีดัชนี at แล้ว) — หน้าแอดมินนับแถวในตารางนี้เป็น "1 วัน"
    $n = (int) db_one('SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND at > ?', [$bucket, $now - $window])['n'];
    if ($n >= $max) return true;
    db_exec('INSERT INTO rate_hits (bucket, at) VALUES (?, ?)', [$bucket, $now]);
    return false;
}
