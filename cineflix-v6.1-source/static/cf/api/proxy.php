<?php
/* ═══════════════════════════════════════════════════════════════════════
   CineFliX · Same-origin API proxy  (cf/api/proxy.php)
   ───────────────────────────────────────────────────────────────────────
   Used automatically by cf-api.js when the browser cannot reach the
   MovieBox-Pro API directly (CORS / network). Also caches JSON on disk so
   repeat visitors get the home feed instantly.

   GET ?action=<verified action>&...          → MovieBox-Pro JSON
   GET ?espn=<url-encoded ESPN site API url>  → ESPN JSON (football)
   GET ?sub=<url-encoded subtitle url>        → subtitle text (aoneroom CDN)

   Video is NOT proxied here — the client streams through the upstream
   ?action=video endpoint so your hosting bandwidth is never used.
═══════════════════════════════════════════════════════════════════════ */

declare(strict_types=1);

const UPSTREAM  = 'https://api.omegatech.app/api/movie/MovieBox-pro';
const CACHE_DIR = __DIR__ . '/cache';
const ALLOWED_ACTIONS = [
    'country' => 86400, 'home' => 300, 'trending' => 300, 'suggest' => 600,
    'search' => 600, 'filter' => 900, 'detail' => 1800, 'recommend' => 1800,
    'staffrel' => 3600, 'download' => 0,   // never cache signed media URLs
];
const ALLOWED_PARAMS = ['keyword', 'page', 'genre', 'year', 'subjectId', 'staffId', 'detailPath', 'se', 'ep'];
const ESPN_PREFIXES = [
    'https://site.api.espn.com/apis/site/v2/sports/soccer/',
    'https://site.api.espn.com/apis/v2/sports/soccer/',
];
const SUB_HOST_PATTERN = '/(^|\.)aoneroom\.com$|(^|\.)hakunaymatata\.com$/i';

header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: ' . allowedOrigin());
header('Vary: Origin');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    fail(405, 'Method not allowed');
}

/* ── Route ─────────────────────────────────────────────────────────── */
if (isset($_GET['espn'])) {
    $url = (string)$_GET['espn'];
    $ok = false;
    foreach (ESPN_PREFIXES as $p) { if (strncmp($url, $p, strlen($p)) === 0) { $ok = true; break; } }
    if (!$ok) fail(400, 'URL not allowed');
    $ttl = strpos($url, '/standings') !== false ? 1800 : 60;
    serveJson($url, $ttl);
}

if (isset($_GET['sub'])) {
    $url  = (string)$_GET['sub'];
    $host = parse_url($url, PHP_URL_HOST) ?: '';
    if (parse_url($url, PHP_URL_SCHEME) !== 'https' || !preg_match(SUB_HOST_PATTERN, $host)) fail(400, 'URL not allowed');
    [$code, $body] = upstream($url);
    if ($code >= 400 || $body === null) fail(502, 'Subtitle unavailable');
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: public, max-age=86400');
    echo $body;
    exit;
}

$action = (string)($_GET['action'] ?? '');
if (!array_key_exists($action, ALLOWED_ACTIONS)) fail(400, 'Unknown action');

$params = ['action' => $action];
foreach (ALLOWED_PARAMS as $k) {
    if (isset($_GET[$k]) && $_GET[$k] !== '') $params[$k] = substr((string)$_GET[$k], 0, 200);
}
serveJson(UPSTREAM . '?' . http_build_query($params), ALLOWED_ACTIONS[$action]);

/* ── Helpers ───────────────────────────────────────────────────────── */
function serveJson(string $url, int $ttl): void
{
    header('Content-Type: application/json; charset=utf-8');
    $file = CACHE_DIR . '/' . sha1($url) . '.json';

    if ($ttl > 0 && is_file($file) && (time() - filemtime($file)) < $ttl) {
        header('X-CF-Cache: HIT');
        header('Cache-Control: public, max-age=' . min($ttl, 300));
        readfile($file);
        exit;
    }

    [$code, $body] = upstream($url);
    $valid = $body !== null && $code < 400 && json_decode($body) !== null;

    if (!$valid) {
        // Serve stale cache rather than an error if we have one.
        if (is_file($file)) { header('X-CF-Cache: STALE'); readfile($file); exit; }
        fail($code >= 400 ? $code : 502, 'Upstream unavailable');
    }

    if ($ttl > 0) {
        if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0755, true);
        @file_put_contents($file, $body, LOCK_EX);
    }
    header('X-CF-Cache: MISS');
    header('Cache-Control: ' . ($ttl > 0 ? 'public, max-age=' . min($ttl, 300) : 'no-store'));
    echo $body;
    exit;
}

function upstream(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_ENCODING       => '',
        CURLOPT_USERAGENT      => 'CineFliX/6.1 (+https://cineflix.t-lyfe.com.ng)',
        CURLOPT_HTTPHEADER     => ['Accept: application/json, text/plain, */*'],
    ]);
    $raw  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code ?: 502, $raw === false ? null : (string)$raw];
}

function allowedOrigin(): string
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    return preg_match('#^https://([a-z0-9-]+\.)*t-lyfe\.com\.ng$#i', $origin) ? $origin : 'https://cineflix.t-lyfe.com.ng';
}

function fail(int $code, string $msg): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'statusCode' => $code, 'error' => $msg]);
    exit;
}
