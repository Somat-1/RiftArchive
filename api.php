<?php
// Same-origin Riftcodex catalog cache. Kept PHP 5.3 compatible for shared hosts.
error_reporting(0);
@set_time_limit(120);

define('RIFTCODEX_BASE', 'https://api.riftcodex.com');
define('CACHE_DIR', dirname(__FILE__) . '/data');
define('CACHE_FILE', CACHE_DIR . '/catalog-cache.json');
define('COLLECTION_FILE', CACHE_DIR . '/collection.json');
define('CACHE_TTL', 43200);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$secure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off';
@session_set_cookie_params(0, '/', '', $secure, true);
@session_start();

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($action === 'catalog' && $method === 'GET') { handleCatalog(); }
elseif ($action === 'collection' && $method === 'GET') { handleCollectionGet(); }
elseif ($action === 'collection' && $method === 'POST') { handleCollectionSave(); }
elseif ($action === 'login' && $method === 'POST') { handleLogin(); }
elseif ($action === 'session' && $method === 'GET') { sendJson(array('authenticated' => isAdmin()), 200); }
elseif ($action === 'logout' && $method === 'POST') { $_SESSION = array(); @session_destroy(); sendJson(array('ok' => true), 200); }
else { sendJson(array('error' => 'not found'), 404); }

function handleCatalog() {
    $cached = loadCache();
    if ($cached !== null && (time() - filemtime(CACHE_FILE)) < CACHE_TTL) {
        $cached['cached'] = true;
        $cached['stale'] = false;
        sendJson($cached, 200);
    }

    $fresh = fetchCatalog();
    if ($fresh !== null) {
        ensureDataDir();
        writeJsonFile(CACHE_FILE, $fresh);
        $fresh['cached'] = false;
        $fresh['stale'] = false;
        sendJson($fresh, 200);
    }

    if ($cached !== null) {
        $cached['cached'] = true;
        $cached['stale'] = true;
        sendJson($cached, 200);
    }
    sendJson(array('error' => 'Riftcodex catalog is temporarily unavailable'), 502);
}

function handleCollectionGet() {
    $path = is_file(COLLECTION_FILE) ? COLLECTION_FILE : dirname(__FILE__) . '/cards.json';
    $payload = json_decode(@file_get_contents($path), true);
    if (!is_array($payload) || !isset($payload['cards']) || !is_array($payload['cards'])) {
        sendJson(array('error' => 'collection unavailable'), 500);
    }
    sendJson($payload, 200);
}

function handleCollectionSave() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    $raw = @file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 20000000) { sendJson(array('error' => 'invalid payload'), 400); }
    $payload = json_decode($raw, true);
    $database = is_array($payload) && isset($payload['database']) ? $payload['database'] : $payload;
    if (!is_array($database) || !isset($database['cards']) || !is_array($database['cards']) || count($database['cards']) > 10000) {
        sendJson(array('error' => 'invalid collection'), 400);
    }
    $database['schema_version'] = 3;
    $database['updated_at'] = gmdate('c');
    if (!ensureDataDir() || !writeJsonFile(COLLECTION_FILE, $database)) {
        sendJson(array('error' => 'collection storage is not writable'), 500);
    }
    sendJson(array('ok' => true, 'records' => count($database['cards']), 'copies' => countCopies($database['cards']), 'updated_at' => $database['updated_at']), 200);
}

function handleLogin() {
    $payload = json_decode(@file_get_contents('php://input'), true);
    $password = is_array($payload) && isset($payload['password']) ? (string)$payload['password'] : '';
    $expected = getenv('RIFTARCHIVE_ADMIN_PASSWORD');
    if ($expected === false || $expected === '') { $expected = '123'; }
    $valid = function_exists('hash_equals') ? hash_equals($expected, $password) : ($expected === $password);
    if (!$valid) { sendJson(array('error' => 'incorrect password'), 401); }
    $_SESSION['riftarchive_admin'] = true;
    sendJson(array('ok' => true), 200);
}

function isAdmin() { return isset($_SESSION['riftarchive_admin']) && $_SESSION['riftarchive_admin'] === true; }

function countCopies($cards) {
    $total = 0;
    foreach ($cards as $card) { $total += isset($card['quantity']) ? max(0, (int)$card['quantity']) : 0; }
    return $total;
}

function ensureDataDir() { return is_dir(CACHE_DIR) || @mkdir(CACHE_DIR, 0755, true); }

function writeJsonFile($path, $payload) {
    $encoded = json_encode($payload);
    if ($encoded === false) { return false; }
    $temporary = $path . '.tmp';
    if (@file_put_contents($temporary, $encoded, LOCK_EX) === false) { return false; }
    if (!@rename($temporary, $path)) { @unlink($temporary); return false; }
    return true;
}

function fetchCatalog() {
    $firstRaw = httpGet(RIFTCODEX_BASE . '/cards?size=100&page=1&sort=name');
    if ($firstRaw === false) { return null; }
    $first = json_decode($firstRaw, true);
    if (!is_array($first) || !isset($first['items']) || !is_array($first['items'])) { return null; }

    $pages = isset($first['pages']) ? max(1, (int)$first['pages']) : 1;
    $all = $first['items'];
    $urls = array();
    for ($page = 2; $page <= $pages; $page++) {
        $urls[] = RIFTCODEX_BASE . '/cards?size=100&page=' . $page . '&sort=name';
    }

    $responses = httpGetMany($urls, 4);
    if ($responses === false || count($responses) !== count($urls)) { return null; }
    foreach ($responses as $raw) {
        $payload = json_decode($raw, true);
        if (!is_array($payload) || !isset($payload['items']) || !is_array($payload['items'])) { return null; }
        $all = array_merge($all, $payload['items']);
    }

    $seen = array();
    $cards = array();
    foreach ($all as $card) {
        $id = isset($card['riftbound_id']) ? $card['riftbound_id'] : (isset($card['id']) ? $card['id'] : '');
        if ($id === '' || isset($seen[$id])) { continue; }
        $seen[$id] = true;
        $cards[] = compactCard($card, $id);
    }

    return array(
        'updated_at' => gmdate('c'),
        'total' => count($cards),
        'items' => $cards
    );
}

function compactCard($card, $id) {
    $image = '';
    if (isset($card['media']) && is_array($card['media']) && isset($card['media']['image_url'])) { $image = $card['media']['image_url']; }
    return array(
        'name' => isset($card['name']) ? $card['name'] : '',
        'riftbound_id' => $id,
        'collector_number' => isset($card['collector_number']) ? $card['collector_number'] : null,
        'classification' => isset($card['classification']) ? $card['classification'] : array(),
        'set' => isset($card['set']) ? $card['set'] : array(),
        'attributes' => isset($card['attributes']) ? $card['attributes'] : array('energy' => null, 'might' => null, 'power' => null),
        'media' => array('image_url' => $image),
        'metadata' => isset($card['metadata']) ? $card['metadata'] : array(),
        'orientation' => isset($card['orientation']) ? $card['orientation'] : 'portrait'
    );
}

function httpGetMany($urls, $concurrency) {
    if (count($urls) === 0) { return array(); }
    if (!function_exists('curl_multi_init')) {
        $results = array();
        foreach ($urls as $url) {
            $body = httpGet($url);
            if ($body === false) { return false; }
            $results[] = $body;
        }
        return $results;
    }

    $results = array();
    foreach (array_chunk($urls, $concurrency) as $batch) {
        $multi = curl_multi_init();
        $handles = array();
        foreach ($batch as $index => $url) {
            $handle = curl_init($url);
            setCurlOptions($handle);
            curl_multi_add_handle($multi, $handle);
            $handles[$index] = $handle;
        }
        do {
            $status = curl_multi_exec($multi, $active);
            if ($active) { curl_multi_select($multi, 1.0); }
        } while ($active && $status === CURLM_OK);

        foreach ($handles as $handle) {
            $body = curl_multi_getcontent($handle);
            $code = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($multi, $handle);
            curl_close($handle);
            if ($code < 200 || $code >= 300 || $body === false || $body === '') { curl_multi_close($multi); return false; }
            $results[] = $body;
        }
        curl_multi_close($multi);
    }
    return $results;
}

function httpGet($url) {
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        setCurlOptions($handle);
        $body = curl_exec($handle);
        $code = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        return ($code >= 200 && $code < 300 && $body !== false) ? $body : false;
    }
    $context = stream_context_create(array('http' => array(
        'method' => 'GET',
        'timeout' => 30,
        'header' => "User-Agent: RiftArchive/1.0\r\nAccept: application/json\r\n"
    )));
    return @file_get_contents($url, false, $context);
}

function setCurlOptions($handle) {
    curl_setopt($handle, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($handle, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($handle, CURLOPT_TIMEOUT, 30);
    curl_setopt($handle, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($handle, CURLOPT_USERAGENT, 'RiftArchive/1.0');
    curl_setopt($handle, CURLOPT_HTTPHEADER, array('Accept: application/json'));
}

function loadCache() {
    if (!is_file(CACHE_FILE)) { return null; }
    $payload = json_decode(@file_get_contents(CACHE_FILE), true);
    return (is_array($payload) && isset($payload['items']) && is_array($payload['items'])) ? $payload : null;
}

function sendJson($payload, $status) {
    http_response_code_compat($status);
    echo json_encode($payload);
    exit;
}

function http_response_code_compat($status) {
    if (function_exists('http_response_code')) { http_response_code($status); return; }
    $messages = array(200 => 'OK', 400 => 'Bad Request', 401 => 'Unauthorized', 404 => 'Not Found', 500 => 'Internal Server Error', 502 => 'Bad Gateway');
    $message = isset($messages[$status]) ? $messages[$status] : '';
    header('HTTP/1.1 ' . $status . ' ' . $message);
}
