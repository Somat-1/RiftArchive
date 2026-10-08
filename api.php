<?php
// Same-origin Riftcodex catalog cache. Kept PHP 5.3 compatible for shared hosts.
error_reporting(0);
@set_time_limit(120);

define('RIFTCODEX_BASE', 'https://api.riftcodex.com');
define('CACHE_DIR', dirname(__FILE__) . '/data');
define('CACHE_FILE', CACHE_DIR . '/catalog-cache.json');
define('COLLECTION_FILE', CACHE_DIR . '/collection.json');
define('TRACKER_FILE', CACHE_DIR . '/play-tracker.json');
define('MARKET_CACHE_FILE', CACHE_DIR . '/cardmarket-market-cache.json');
define('MARKET_HISTORY_FILE', CACHE_DIR . '/cardmarket-price-history.json');
define('MARKET_ENGLISH_CACHE_FILE', CACHE_DIR . '/riftbound-zone-english-price-cache.json');
define('MARKET_ENGLISH_HISTORY_FILE', CACHE_DIR . '/english-price-history.json');
define('MARKET_SHIPPING_FILE', dirname(__FILE__) . '/cardmarket_shipping_to_NL.csv');
define('CACHE_TTL', 43200);
define('MARKET_CACHE_TTL', 21600);
define('MARKET_ENGLISH_CACHE_TTL', 86400);
define('CARDMARKET_GUIDE_URL', 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json');
define('RIFTBOUND_MARKET_MAP_URL', 'https://api.dotgg.gg/cgfw/getcards?game=riftbound');
define('RIFTBOUND_ZONE_PRICES_URL', 'https://riftbound.zone/wp-admin/admin-ajax.php?action=rbz_prezzi_tiles&lang=en&q=&rarity=&set=&sort=&page=');
require_once dirname(__FILE__) . '/legend-stats-service.php';

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
elseif ($action === 'tracker' && $method === 'GET') { handleTrackerGet(); }
elseif ($action === 'tracker' && $method === 'POST') { handleTrackerSave(); }
elseif ($action === 'market_prices' && $method === 'GET') { handleMarketPrices(); }
elseif ($action === 'legend_stats' && $method === 'GET') { handleLegendStatsGet(); }
elseif ($action === 'legend_stats' && $method === 'POST') { handleLegendStatsRefresh(); }
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

function emptyTracker() {
    return array('schema_version' => 1, 'updated_at' => null, 'decks' => array(), 'matches' => array());
}

function handleTrackerGet() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    $path = is_file(TRACKER_FILE) ? TRACKER_FILE : dirname(__FILE__) . '/tracker.json';
    $payload = is_file($path) ? json_decode(@file_get_contents($path), true) : emptyTracker();
    if (!is_array($payload) || !isset($payload['decks']) || !is_array($payload['decks']) || !isset($payload['matches']) || !is_array($payload['matches'])) {
        sendJson(array('error' => 'tracker unavailable'), 500);
    }
    sendJson($payload, 200);
}

function handleTrackerSave() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    $raw = @file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 20000000) { sendJson(array('error' => 'invalid payload'), 400); }
    $payload = json_decode($raw, true);
    $tracker = is_array($payload) && isset($payload['tracker']) ? $payload['tracker'] : $payload;
    if (!is_array($tracker) || !isset($tracker['decks']) || !is_array($tracker['decks']) || !isset($tracker['matches']) || !is_array($tracker['matches']) || count($tracker['decks']) > 500 || count($tracker['matches']) > 10000) {
        sendJson(array('error' => 'invalid tracker'), 400);
    }
    $tracker['schema_version'] = 1;
    $tracker['updated_at'] = gmdate('c');
    if (!ensureDataDir() || !writeJsonFile(TRACKER_FILE, $tracker)) {
        sendJson(array('error' => 'tracker storage is not writable'), 500);
    }
    sendJson(array('ok' => true, 'decks' => count($tracker['decks']), 'matches' => count($tracker['matches']), 'updated_at' => $tracker['updated_at']), 200);
}

function handleMarketPrices() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    @session_write_close();
    $force = isset($_GET['refresh']) && $_GET['refresh'] === '1';
    $dataset = getMarketDataset($force);
    if ($dataset === null) { sendJson(array('error' => 'Cardmarket price guide is temporarily unavailable'), 502); }
    $englishDataset = getEnglishMarketPrices($force, $dataset['cards']);
    $dataset = applyEnglishMarketPrices($dataset, $englishDataset);
    recordEnglishMarketHistory($dataset);
    $dataset['shipping'] = getMarketShippingRates();
    sendJson($dataset, 200);
}

function applyEnglishMarketPrices($dataset, $englishDataset) {
    $records = is_array($englishDataset) && isset($englishDataset['prices']) && is_array($englishDataset['prices']) ? $englishDataset['prices'] : array();
    $localMetrics = getLocalEnglishHistoryMetrics();
    $matched = 0; $historyMatched = 0;
    if (!isset($dataset['cards']) || !is_array($dataset['cards'])) { return $dataset; }
    foreach ($dataset['cards'] as $index => $card) {
        if (!isset($dataset['cards'][$index]['price']) || !is_array($dataset['cards'][$index]['price'])) { $dataset['cards'][$index]['price'] = array(); }
        $guide = $dataset['cards'][$index]['price'];
        $dataset['cards'][$index]['price']['guide_low'] = isset($guide['guide_low']) ? $guide['guide_low'] : (isset($guide['low']) ? $guide['low'] : null);
        $dataset['cards'][$index]['price']['guide_trend'] = isset($guide['guide_trend']) ? $guide['guide_trend'] : (isset($guide['trend']) ? $guide['trend'] : null);
        $dataset['cards'][$index]['price']['guide_avg7'] = isset($guide['guide_avg7']) ? $guide['guide_avg7'] : (isset($guide['avg7']) ? $guide['avg7'] : null);
        $dataset['cards'][$index]['price']['guide_avg30'] = isset($guide['guide_avg30']) ? $guide['guide_avg30'] : (isset($guide['avg30']) ? $guide['avg30'] : null);
        $dataset['cards'][$index]['price']['low'] = null;
        $dataset['cards'][$index]['price']['trend'] = null;
        $dataset['cards'][$index]['price']['avg7'] = null;
        $dataset['cards'][$index]['price']['avg30'] = null;
        $dataset['cards'][$index]['price']['change7'] = null;
        $dataset['cards'][$index]['price']['history_days'] = 0;
        $dataset['cards'][$index]['price']['history_updated_at'] = null;
        $dataset['cards'][$index]['price']['low_language'] = 'English';
        $dataset['cards'][$index]['price']['low_source'] = null;
        $code = isset($card['id']) ? strtoupper(trim((string)$card['id'])) : '';
        $name = isset($card['name']) ? (string)$card['name'] : '';
        $match = matchEnglishPriceRecord($records, $code, $name);
        if ($match === null) { continue; }
        $dataset['cards'][$index]['price']['low'] = round((float)$match['price'], 2);
        $dataset['cards'][$index]['price']['low_source'] = 'Riftbound Zone';
        $metrics = isset($match['history']) && is_array($match['history']) ? $match['history'] : (isset($localMetrics[$code]) ? $localMetrics[$code] : null);
        if (is_array($metrics)) {
            $dataset['cards'][$index]['price']['avg7'] = isset($metrics['avg7']) ? $metrics['avg7'] : null;
            $dataset['cards'][$index]['price']['avg30'] = isset($metrics['avg30']) ? $metrics['avg30'] : null;
            $dataset['cards'][$index]['price']['change7'] = isset($metrics['change7']) ? $metrics['change7'] : null;
            $dataset['cards'][$index]['price']['history_days'] = isset($metrics['history_days']) ? (int)$metrics['history_days'] : 0;
            $dataset['cards'][$index]['price']['history_updated_at'] = isset($metrics['updated_at']) ? $metrics['updated_at'] : null;
            if ($dataset['cards'][$index]['price']['avg7'] !== null || $dataset['cards'][$index]['price']['avg30'] !== null) { $historyMatched++; }
        }
        $matched++;
    }
    $available = is_array($englishDataset) && count($records) > 0;
    $dataset['english_prices'] = array(
        'available' => $available,
        'matched' => $matched,
        'history_matched' => $historyMatched,
        'total' => count($dataset['cards']),
        'updated_at' => $available && isset($englishDataset['updated_at']) ? $englishDataset['updated_at'] : null,
        'cached' => $available && !empty($englishDataset['cached']),
        'stale' => $available && !empty($englishDataset['stale']),
        'source' => 'Riftbound Zone Cardmarket EN minimum and daily history',
        'url' => 'https://riftbound.zone/en/prices/?market=eu'
    );
    $dataset['source'] = $available ? 'Riftbound Zone English Cardmarket floor and history' : 'English Cardmarket pricing unavailable';
    return $dataset;
}

function matchEnglishPriceRecord($records, $code, $name) {
    if ($code === '' || !isset($records[$code]) || !is_array($records[$code]) || count($records[$code]) === 0) { return null; }
    $candidates = $records[$code];
    if (count($candidates) === 1) { return isset($candidates[0]['price']) && is_numeric($candidates[0]['price']) ? $candidates[0] : null; }
    $wanted = normalizeMarketName($name);
    foreach ($candidates as $candidate) {
        if (isset($candidate['name']) && normalizeMarketName($candidate['name']) === $wanted && isset($candidate['price']) && is_numeric($candidate['price'])) { return $candidate; }
    }
    return null;
}

function normalizeMarketName($name) {
    $value = html_entity_decode((string)$name, ENT_QUOTES, 'UTF-8');
    $value = function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    $value = preg_replace('/[^a-z0-9]+/', ' ', $value);
    return trim(preg_replace('/\s+/', ' ', $value));
}

function getEnglishMarketPrices($force, $marketCards) {
    $cached = readJsonFile(MARKET_ENGLISH_CACHE_FILE);
    $cacheValid = is_array($cached) && isset($cached['schema_version']) && (int)$cached['schema_version'] >= 2 && isset($cached['prices']) && is_array($cached['prices']);
    if (!$force && $cacheValid && is_file(MARKET_ENGLISH_CACHE_FILE) && (time() - @filemtime(MARKET_ENGLISH_CACHE_FILE)) < MARKET_ENGLISH_CACHE_TTL) {
        $cached['cached'] = true; $cached['stale'] = false; return $cached;
    }
    $fresh = fetchEnglishMarketPrices($marketCards);
    if ($fresh !== null) {
        ensureDataDir(); writeJsonFile(MARKET_ENGLISH_CACHE_FILE, $fresh);
        $fresh['cached'] = false; $fresh['stale'] = false; return $fresh;
    }
    if ($cacheValid) {
        $cached['cached'] = true; $cached['stale'] = true; return $cached;
    }
    return null;
}

function fetchEnglishMarketPrices($marketCards) {
    $firstRaw = httpGet(RIFTBOUND_ZONE_PRICES_URL . '1');
    if ($firstRaw === false) { return null; }
    $first = json_decode($firstRaw, true);
    if (!is_array($first) || empty($first['success']) || !isset($first['data']) || !is_array($first['data']) || !isset($first['data']['html'])) { return null; }
    $shown = isset($first['data']['shown']) ? max(0, (int)$first['data']['shown']) : 0;
    $pageSize = max(1, substr_count((string)$first['data']['html'], '<article class="pc-tile'));
    $pages = $shown > 0 ? (int)ceil($shown / $pageSize) : 1;
    $pages = max(1, min(30, $pages));
    $responses = array($firstRaw);
    $urls = array();
    for ($page = 2; $page <= $pages; $page++) { $urls[] = RIFTBOUND_ZONE_PRICES_URL . $page; }
    $remaining = httpGetMany($urls, 4);
    if ($remaining === false || count($remaining) !== count($urls)) { return null; }
    $responses = array_merge($responses, $remaining);
    $records = array();
    foreach ($responses as $raw) {
        $payload = json_decode($raw, true);
        if (!is_array($payload) || empty($payload['success']) || !isset($payload['data']['html'])) { return null; }
        extractEnglishPricesFromHtml((string)$payload['data']['html'], $records);
    }
    if (count($records) === 0) { return null; }
    $historyRecords = enrichEnglishPriceHistories($records, $marketCards);
    return array(
        'schema_version' => 2,
        'updated_at' => gmdate('c'),
        'source' => 'Riftbound Zone Cardmarket EN minimum and daily history',
        'source_url' => 'https://riftbound.zone/en/prices/?market=eu',
        'history_records' => $historyRecords,
        'prices' => $records
    );
}

function extractEnglishPricesFromHtml($html, &$records) {
    if (!preg_match_all('/<article\b[^>]*class="[^"]*\bpc-tile\b[^"]*"[^>]*>.*?<\/article>/is', $html, $articles)) { return; }
    foreach ($articles[0] as $article) {
        if (!preg_match('/\bdata-en="([0-9]+(?:\.[0-9]+)?)"/i', $article, $priceMatch)) { continue; }
        $price = (float)$priceMatch[1];
        if ($price <= 0) { continue; }
        if (!preg_match('/class="[^"]*\bpc-set-badge\b[^"]*"[^>]*>(.*?)<\/span>/is', $article, $codeMatch)) { continue; }
        $code = strtoupper(trim(strip_tags(html_entity_decode($codeMatch[1], ENT_QUOTES, 'UTF-8'))));
        if ($code === '' || !preg_match('/^[A-Z0-9]+(?:-[A-Z0-9*]+)+$/', $code)) { continue; }
        $name = '';
        if (preg_match('/class="[^"]*\bpc-name-text\b[^"]*"[^>]*>(.*?)<\/span>/is', $article, $nameMatch)) {
            $name = trim(strip_tags(html_entity_decode($nameMatch[1], ENT_QUOTES, 'UTF-8')));
        }
        $historyUrl = null;
        if (preg_match('/class="[^"]*\bpc-tile-link\b[^"]*"[^>]*href="([^"]+)"/is', $article, $hrefMatch)) {
            $href = html_entity_decode($hrefMatch[1], ENT_QUOTES, 'UTF-8');
            $codePattern = preg_quote(strtolower($code), '#');
            if (preg_match('#/prices/' . $codePattern . '-([0-9]+)(?:-[^/]*)?/?#i', $href, $pathMatch)) {
                $historyUrl = 'https://riftbound.zone/wp-json/rbz/v1/hist/cm/' . rawurlencode($code) . '/' . (int)$pathMatch[1] . '?lang=eng&range=month';
            }
        }
        $record = array('name' => $name, 'price' => round($price, 2), 'history_url' => $historyUrl);
        if (!isset($records[$code])) { $records[$code] = array(); }
        $records[$code][] = $record;
    }
}

function enrichEnglishPriceHistories(&$records, $marketCards) {
    if (!is_array($marketCards)) { return 0; }
    $jobs = array();
    foreach ($marketCards as $card) {
        $code = isset($card['id']) ? strtoupper(trim((string)$card['id'])) : '';
        $name = isset($card['name']) ? (string)$card['name'] : '';
        if ($code === '' || !isset($records[$code]) || !is_array($records[$code])) { continue; }
        $wanted = normalizeMarketName($name); $selected = null;
        foreach ($records[$code] as $candidateIndex => $candidate) {
            if (count($records[$code]) === 1 || (isset($candidate['name']) && normalizeMarketName($candidate['name']) === $wanted)) { $selected = $candidateIndex; break; }
        }
        if ($selected === null || empty($records[$code][$selected]['history_url'])) { continue; }
        $jobs[] = array('code' => $code, 'index' => $selected, 'url' => $records[$code][$selected]['history_url']);
    }
    $enriched = 0;
    foreach (array_chunk($jobs, 20) as $batch) {
        $urls = array(); foreach ($batch as $job) { $urls[] = $job['url']; }
        $responses = httpGetMany($urls, 4);
        if ($responses === false || count($responses) !== count($batch)) {
            $responses = array(); foreach ($batch as $job) { $responses[] = httpGet($job['url']); }
        }
        foreach ($batch as $offset => $job) {
            $raw = isset($responses[$offset]) ? $responses[$offset] : false;
            $metrics = parseEnglishHistoryMetrics($raw);
            if ($metrics === null) { continue; }
            $records[$job['code']][$job['index']]['history'] = $metrics;
            $enriched++;
        }
    }
    return $enriched;
}

function parseEnglishHistoryMetrics($raw) {
    if ($raw === false || $raw === '') { return null; }
    $payload = json_decode($raw, true);
    if (!is_array($payload) || !isset($payload['skus']) || !is_array($payload['skus'])) { return null; }
    $points = null;
    foreach ($payload['skus'] as $sku) {
        if (is_array($sku) && isset($sku['variant']) && $sku['variant'] === 'eu' && isset($sku['pts']) && is_array($sku['pts'])) { $points = $sku['pts']; break; }
    }
    if ($points === null && isset($payload['skus'][0]['pts']) && is_array($payload['skus'][0]['pts'])) { $points = $payload['skus'][0]['pts']; }
    return $points === null ? null : calculateEnglishHistoryMetrics($points);
}

function calculateEnglishHistoryMetrics($points) {
    $series = array();
    foreach ($points as $point) {
        if (!is_array($point) || !isset($point['d']) || !isset($point['p']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$point['d']) || !is_numeric($point['p']) || (float)$point['p'] <= 0) { continue; }
        $series[(string)$point['d']] = (float)$point['p'];
    }
    if (count($series) < 2) { return null; }
    ksort($series);
    $dates = array_keys($series); $endDate = $dates[count($dates) - 1]; $startDate = $dates[0];
    $endStamp = strtotime($endDate . ' 00:00:00 UTC'); $startStamp = strtotime($startDate . ' 00:00:00 UTC');
    if ($endStamp === false || $startStamp === false) { return null; }
    $values7 = array(); $values30 = array(); $cutoff7 = $endStamp - (6 * 86400); $cutoff30 = $endStamp - (29 * 86400);
    foreach ($series as $date => $price) {
        $stamp = strtotime($date . ' 00:00:00 UTC');
        if ($stamp === false) { continue; }
        if ($stamp >= $cutoff7) { $values7[] = $price; }
        if ($stamp >= $cutoff30) { $values30[] = $price; }
    }
    $spanDays = (int)floor(($endStamp - $startStamp) / 86400) + 1;
    $avg7 = $spanDays >= 6 && count($values7) >= 4 ? round(array_sum($values7) / count($values7), 2) : null;
    $avg30 = $spanDays >= 28 && count($values30) >= 20 ? round(array_sum($values30) / count($values30), 2) : null;
    $change7 = null;
    if (count($values7) >= 2 && $values7[0] > 0) { $change7 = round((($values7[count($values7) - 1] - $values7[0]) / $values7[0]) * 100, 1); }
    return array('avg7' => $avg7, 'avg30' => $avg30, 'change7' => $change7, 'samples7' => count($values7), 'samples30' => count($values30), 'history_days' => $spanDays, 'updated_at' => $endDate);
}

function recordEnglishMarketHistory($dataset) {
    if (!isset($dataset['cards']) || !is_array($dataset['cards']) || !isset($dataset['english_prices']['available']) || !$dataset['english_prices']['available']) { return; }
    $date = isset($dataset['english_prices']['updated_at']) ? substr((string)$dataset['english_prices']['updated_at'], 0, 10) : gmdate('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { $date = gmdate('Y-m-d'); }
    $history = readJsonFile(MARKET_ENGLISH_HISTORY_FILE);
    if (!is_array($history) || !isset($history['snapshots']) || !is_array($history['snapshots'])) { $history = array('schema_version' => 1, 'snapshots' => array()); }
    $points = array();
    foreach ($dataset['cards'] as $card) {
        $low = isset($card['price']['low']) && is_numeric($card['price']['low']) ? (float)$card['price']['low'] : null;
        if ($low === null || $low <= 0 || empty($card['id'])) { continue; }
        $points[] = array('id' => strtoupper((string)$card['id']), 'low' => round($low, 2));
    }
    $replacement = array('date' => $date, 'cards' => $points); $updated = false;
    foreach ($history['snapshots'] as $index => $snapshot) {
        if (isset($snapshot['date']) && $snapshot['date'] === $date) { $history['snapshots'][$index] = $replacement; $updated = true; break; }
    }
    if (!$updated) { $history['snapshots'][] = $replacement; }
    if (count($history['snapshots']) > 120) { $history['snapshots'] = array_slice($history['snapshots'], -120); }
    $history['updated_at'] = gmdate('c'); writeJsonFile(MARKET_ENGLISH_HISTORY_FILE, $history);
}

function getLocalEnglishHistoryMetrics() {
    $history = readJsonFile(MARKET_ENGLISH_HISTORY_FILE); $series = array(); $metrics = array();
    if (!is_array($history) || !isset($history['snapshots']) || !is_array($history['snapshots'])) { return $metrics; }
    foreach ($history['snapshots'] as $snapshot) {
        if (!isset($snapshot['date']) || !isset($snapshot['cards']) || !is_array($snapshot['cards'])) { continue; }
        foreach ($snapshot['cards'] as $card) {
            if (empty($card['id']) || !isset($card['low']) || !is_numeric($card['low'])) { continue; }
            $code = strtoupper((string)$card['id']); if (!isset($series[$code])) { $series[$code] = array(); }
            $series[$code][] = array('d' => $snapshot['date'], 'p' => (float)$card['low']);
        }
    }
    foreach ($series as $code => $points) { $value = calculateEnglishHistoryMetrics($points); if ($value !== null) { $metrics[$code] = $value; } }
    return $metrics;
}

function getMarketDataset($force) {
    $cached = readJsonFile(MARKET_CACHE_FILE);
    if (!$force && is_array($cached) && isset($cached['cards']) && is_array($cached['cards']) && is_file(MARKET_CACHE_FILE) && (time() - @filemtime(MARKET_CACHE_FILE)) < MARKET_CACHE_TTL) {
        $cached['cached'] = true; $cached['stale'] = false; return $cached;
    }

    $guideRaw = httpGet(CARDMARKET_GUIDE_URL);
    $mapRaw = httpGet(RIFTBOUND_MARKET_MAP_URL);
    $guide = $guideRaw === false ? null : json_decode($guideRaw, true);
    $mapping = $mapRaw === false ? null : json_decode($mapRaw, true);
    if (is_array($guide) && isset($guide['priceGuides']) && is_array($guide['priceGuides']) && is_array($mapping)) {
        $prices = array();
        foreach ($guide['priceGuides'] as $price) {
            if (!is_array($price) || !isset($price['idProduct'])) { continue; }
            $prices[(string)(int)$price['idProduct']] = $price;
        }
        $cards = array(); $seen = array();
        foreach ($mapping as $mapped) {
            if (!is_array($mapped) || !isset($mapped['rarity']) || strcasecmp((string)$mapped['rarity'], 'Epic') !== 0) { continue; }
            $idProduct = isset($mapped['cmid']) ? (int)$mapped['cmid'] : 0;
            if ($idProduct <= 0 || isset($seen[$idProduct])) { continue; }
            $seen[$idProduct] = true;
            $price = isset($prices[(string)$idProduct]) ? $prices[(string)$idProduct] : array();
            $productUrl = isset($mapped['cmurl']) && strpos($mapped['cmurl'], 'https://www.cardmarket.com/en/Riftbound/') === 0 ? $mapped['cmurl'] : 'https://www.cardmarket.com/en/Riftbound/Products?idProduct=' . $idProduct;
            if (strpos($productUrl, 'language=') === false) { $productUrl .= strpos($productUrl, '?') === false ? '?language=1' : '&language=1'; }
            $cards[] = array(
                'id' => isset($mapped['id']) ? (string)$mapped['id'] : '',
                'id_product' => $idProduct,
                'name' => isset($mapped['name']) ? (string)$mapped['name'] : 'Unknown Epic',
                'set_name' => isset($mapped['set_name']) ? (string)$mapped['set_name'] : 'Riftbound',
                'image_url' => isset($mapped['image']) ? (string)$mapped['image'] : '',
                'product_url' => $productUrl,
                'price' => array(
                    'low' => arrayNumber($price, 'low'),
                    'trend' => arrayNumber($price, 'trend'),
                    'avg7' => arrayNumber($price, 'avg7'),
                    'avg30' => arrayNumber($price, 'avg30')
                )
            );
        }
        usort($cards, 'compareMarketCards');
        $payload = array(
            'updated_at' => isset($guide['createdAt']) ? $guide['createdAt'] : gmdate('c'),
            'source' => 'Cardmarket public price guide',
            'cached' => false,
            'stale' => false,
            'cards' => $cards
        );
        ensureDataDir(); writeJsonFile(MARKET_CACHE_FILE, $payload); recordMarketHistory($payload);
        return $payload;
    }

    if (is_array($cached) && isset($cached['cards']) && is_array($cached['cards'])) {
        $cached['cached'] = true; $cached['stale'] = true; return $cached;
    }
    return null;
}

function compareMarketCards($a, $b) {
    $left = isset($a['name']) ? $a['name'] : ''; $right = isset($b['name']) ? $b['name'] : '';
    return strcasecmp($left, $right);
}

function arrayNumber($source, $key) {
    if (!is_array($source) || !isset($source[$key]) || $source[$key] === '' || !is_numeric($source[$key])) { return null; }
    return round((float)$source[$key], 2);
}

function getMarketShippingRates() {
    if (!is_file(MARKET_SHIPPING_FILE)) { return array(); }
    $handle = @fopen(MARKET_SHIPPING_FILE, 'r');
    if ($handle === false) { return array(); }
    $header = fgetcsv($handle);
    if (!is_array($header)) { fclose($handle); return array(); }
    $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', $header[0]);
    $rates = array();
    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) !== count($header)) { continue; }
        $source = array_combine($header, $row);
        if (!is_array($source) || !isset($source['from_code']) || trim($source['from_code']) === '') { continue; }
        $rates[] = array(
            'code' => strtoupper(trim($source['from_code'])),
            'country' => isset($source['from_country']) ? trim($source['from_country']) : '',
            'untracked_20g' => csvNumber($source, 'est_cm_untracked_20g_eur'),
            'tracked' => csvNumber($source, 'est_cm_tracked_eur'),
            'tracked_above' => csvNumber($source, 'tracked_mandatory_above_eur'),
            'tariff_year' => isset($source['tariff_year']) ? (int)$source['tariff_year'] : null,
            'notes' => isset($source['notes']) ? trim($source['notes']) : ''
        );
    }
    fclose($handle);
    return $rates;
}

function csvNumber($source, $key) {
    if (!isset($source[$key]) || trim($source[$key]) === '' || !is_numeric($source[$key])) { return null; }
    return round((float)$source[$key], 2);
}

function readJsonFile($path) {
    if (!is_file($path)) { return null; }
    $payload = json_decode(@file_get_contents($path), true);
    return is_array($payload) ? $payload : null;
}

function recordMarketHistory($dataset) {
    if (!isset($dataset['updated_at']) || !isset($dataset['cards']) || !is_array($dataset['cards'])) { return; }
    $date = substr((string)$dataset['updated_at'], 0, 10);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { $date = gmdate('Y-m-d'); }
    $history = readJsonFile(MARKET_HISTORY_FILE);
    if (!is_array($history) || !isset($history['snapshots']) || !is_array($history['snapshots'])) { $history = array('schema_version' => 1, 'snapshots' => array()); }
    $points = array();
    foreach ($dataset['cards'] as $card) {
        $points[] = array('id_product' => $card['id_product'], 'low' => $card['price']['low'], 'trend' => $card['price']['trend']);
    }
    $replacement = array('date' => $date, 'cards' => $points); $updated = false;
    foreach ($history['snapshots'] as $index => $snapshot) {
        if (isset($snapshot['date']) && $snapshot['date'] === $date) { $history['snapshots'][$index] = $replacement; $updated = true; break; }
    }
    if (!$updated) { $history['snapshots'][] = $replacement; }
    if (count($history['snapshots']) > 60) { $history['snapshots'] = array_slice($history['snapshots'], -60); }
    $history['updated_at'] = gmdate('c'); writeJsonFile(MARKET_HISTORY_FILE, $history);
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
        'tags' => isset($card['tags']) && is_array($card['tags']) ? $card['tags'] : array(),
        'text' => isset($card['text']) && is_array($card['text']) ? $card['text'] : array(),
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
    $messages = array(200 => 'OK', 400 => 'Bad Request', 401 => 'Unauthorized', 404 => 'Not Found', 409 => 'Conflict', 429 => 'Too Many Requests', 500 => 'Internal Server Error', 502 => 'Bad Gateway', 503 => 'Service Unavailable');
    $message = isset($messages[$status]) ? $messages[$status] : '';
    header('HTTP/1.1 ' . $status . ' ' . $message);
}
