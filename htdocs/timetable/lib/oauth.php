<?php
// OAuth: Google (OpenID Connect) และ LINE Login v2.1
declare(strict_types=1);

function http_post_form(string $url, array $fields): array {
    return http_request('POST', $url, http_build_query($fields), ['Content-Type: application/x-www-form-urlencoded']);
}

function http_get_json(string $url, string $bearer): array {
    return http_request('GET', $url, null, ['Authorization: Bearer ' . $bearer]);
}

function http_request(string $method, string $url, ?string $body, array $headers): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers),
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    if ($raw === false) throw new RuntimeException('เชื่อมต่อผู้ให้บริการไม่ได้: ' . $err);
    $data = json_decode((string) $raw, true);
    if ($status >= 400 || !is_array($data)) {
        error_log("OAuth HTTP $status from $url: " . substr((string) $raw, 0, 300));
        throw new RuntimeException('ผู้ให้บริการตอบกลับผิดพลาด (' . $status . ')');
    }
    return $data;
}

function oauth_redirect_uri(string $p): string {
    return base_url('auth/callback.php?p=' . $p);
}

function oauth_start(string $p): never {
    $state = bin2hex(random_bytes(16));
    $nonce = bin2hex(random_bytes(16));
    // PKCE (S256): code ที่ถูกขโมย/ฉีดเข้ามาแลก token ไม่ได้ถ้าไม่มี verifier ที่อยู่ใน session นี้
    $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    $_SESSION['oauth'] = ['p' => $p, 'state' => $state, 'nonce' => $nonce, 'verifier' => $verifier, 'at' => time()];

    if ($p === 'google') {
        $q = [
            'client_id' => cfg('google.client_id'),
            'redirect_uri' => oauth_redirect_uri('google'),
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => $state,
            'nonce' => $nonce,
            'prompt' => 'select_account',
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ];
        redirect('https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($q));
    }
    if ($p === 'line') {
        $q = [
            'response_type' => 'code',
            'client_id' => cfg('line.channel_id'),
            'redirect_uri' => oauth_redirect_uri('line'),
            'state' => $state,
            // ขออีเมลได้เฉพาะเมื่อ LINE อนุมัติสิทธิ์ email ให้ช่องนี้แล้ว (ตั้ง line.email = true ใน config)
            'scope' => cfg('line.email') ? 'profile openid email' : 'profile openid',
            'nonce' => $nonce,
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ];
        redirect('https://access.line.me/oauth2/v2.1/authorize?' . http_build_query($q));
    }
    throw new InvalidArgumentException('ไม่รู้จักผู้ให้บริการ');
}

/** @return array{uid:string,name:?string,email:?string,avatar:?string} */
function oauth_finish(string $p, string $code, string $state): array {
    $s = $_SESSION['oauth'] ?? null;
    unset($_SESSION['oauth']);
    if (!$s || $s['p'] !== $p || $state === '' || !hash_equals($s['state'], $state) || time() - $s['at'] > 600) {
        throw new RuntimeException('คำขอเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
    }

    if ($p === 'google') {
        $tok = http_post_form('https://oauth2.googleapis.com/token', [
            'code' => $code,
            'client_id' => cfg('google.client_id'),
            'client_secret' => cfg('google.client_secret'),
            'redirect_uri' => oauth_redirect_uri('google'),
            'grant_type' => 'authorization_code',
            'code_verifier' => $s['verifier'] ?? '',
        ]);
        $info = http_get_json('https://openidconnect.googleapis.com/v1/userinfo', (string) ($tok['access_token'] ?? ''));
        if (empty($info['sub'])) throw new RuntimeException('ไม่ได้รับข้อมูลบัญชี Google');
        return ['uid' => (string) $info['sub'], 'name' => $info['name'] ?? null, 'email' => $info['email'] ?? null, 'avatar' => $info['picture'] ?? null];
    }

    if ($p === 'line') {
        $tok = http_post_form('https://api.line.me/oauth2/v2.1/token', [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => oauth_redirect_uri('line'),
            'client_id' => cfg('line.channel_id'),
            'client_secret' => cfg('line.channel_secret'),
            'code_verifier' => $s['verifier'] ?? '',
        ]);
        // ตรวจ id_token กับ LINE โดยตรง (ตรวจลายเซ็น, ผู้รับ, nonce ให้)
        $info = http_post_form('https://api.line.me/oauth2/v2.1/verify', [
            'id_token' => (string) ($tok['id_token'] ?? ''),
            'client_id' => cfg('line.channel_id'),
            'nonce' => $s['nonce'],
        ]);
        if (empty($info['sub'])) throw new RuntimeException('ไม่ได้รับข้อมูลบัญชี LINE');
        // ตรวจซ้ำฝั่งเราอีกชั้น: token ต้องออกโดย LINE ให้ช่องของเรา และยังไม่หมดอายุ
        if (($info['iss'] ?? '') !== 'https://access.line.me' || (string) ($info['aud'] ?? '') !== (string) cfg('line.channel_id')
            || (int) ($info['exp'] ?? 0) < time() || (isset($info['nonce']) && !hash_equals($s['nonce'], (string) $info['nonce']))) {
            throw new RuntimeException('ยืนยันบัญชี LINE ไม่ผ่าน กรุณาลองใหม่');
        }
        return ['uid' => (string) $info['sub'], 'name' => $info['name'] ?? null, 'email' => $info['email'] ?? null, 'avatar' => $info['picture'] ?? null];
    }
    throw new InvalidArgumentException('ไม่รู้จักผู้ให้บริการ');
}
