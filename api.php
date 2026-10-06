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
define('CACHE_TTL', 43200);
define('MARKET_CACHE_TTL', 21600);
define('CARDMARKET_GUIDE_URL', 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json');
define('RIFTBOUND_MARKET_MAP_URL', 'https://api.dotgg.gg/cgfw/getcards?game=riftbound');
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
elseif ($action === 'market_listings' && $method === 'GET') { handleMarketListings(); }
elseif ($action === 'market_seller' && $method === 'GET') { handleMarketSeller(); }
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
    sendJson($dataset, 200);
}

function handleMarketListings() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    @session_write_close();
    $idProduct = isset($_GET['idProduct']) ? (int)$_GET['idProduct'] : 0;
    if ($idProduct <= 0) { sendJson(array('error' => 'invalid Cardmarket product'), 400); }
    $dataset = getMarketDataset(false);
    $card = $dataset === null ? null : findMarketCard($dataset['cards'], $idProduct);
    if ($card === null) { sendJson(array('error' => 'Epic card was not found in the current guide'), 404); }

    $target = 'https://www.cardmarket.com/en/Riftbound/Products?idProduct=' . $idProduct;
    $html = scraperApiGet($target);
    if ($html === false) { sendJson(array('error' => scraperApiConfigured() ? 'Cardmarket live sellers could not be reached' : 'Set RIFTARCHIVE_SCRAPERAPI_KEY on the server to enable live sellers'), 503); }
    if (isChallengePage($html)) { sendJson(array('error' => 'Cardmarket returned a protection page; try this card again shortly'), 502); }
    $offers = parseMarketOffers($html, isset($card['price']['trend']) ? $card['price']['trend'] : null, 30);
    if ($offers === null) { sendJson(array('error' => 'The live seller page format could not be read'), 502); }
    sendJson(array('id_product' => $idProduct, 'fetched_at' => gmdate('c'), 'offers' => $offers), 200);
}

function handleMarketSeller() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    @session_write_close();
    $seller = isset($_GET['seller']) ? trim((string)$_GET['seller']) : '';
    if ($seller === '' || strlen($seller) > 100 || !preg_match('/^[\pL\pN_.-]+$/u', $seller)) { sendJson(array('error' => 'invalid seller'), 400); }
    $dataset = getMarketDataset(false);
    if ($dataset === null) { sendJson(array('error' => 'Cardmarket guide is unavailable'), 502); }
    $target = 'https://www.cardmarket.com/en/Riftbound/Users/' . rawurlencode($seller) . '/Offers/Singles';
    $html = scraperApiGet($target);
    if ($html === false) { sendJson(array('error' => scraperApiConfigured() ? 'Seller inventory could not be reached' : 'Live seller inventory needs the server proxy key'), 503); }
    if (isChallengePage($html)) { sendJson(array('error' => 'Cardmarket returned a protection page'), 502); }
    $cards = parseSellerEpicOffers($html, $dataset['cards'], 16);
    if ($cards === null) { sendJson(array('error' => 'The seller inventory format could not be read'), 502); }
    sendJson(array('seller' => $seller, 'fetched_at' => gmdate('c'), 'cards' => $cards), 200);
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

function findMarketCard($cards, $idProduct) {
    foreach ($cards as $card) { if (isset($card['id_product']) && (int)$card['id_product'] === (int)$idProduct) { return $card; } }
    return null;
}

function scraperApiConfigured() {
    $key = scraperApiKey();
    return !($key === false || $key === '');
}

function scraperApiGet($target) {
    $key = scraperApiKey();
    if ($key === false || $key === '') { return false; }
    $url = 'https://api.scraperapi.com/?api_key=' . rawurlencode($key) . '&url=' . rawurlencode($target);
    return httpGetDocument($url, 'text/html,application/xhtml+xml');
}

function scraperApiKey() {
    $key = getenv('RIFTARCHIVE_SCRAPERAPI_KEY');
    if (($key === false || $key === '') && isset($_SERVER['RIFTARCHIVE_SCRAPERAPI_KEY'])) { $key = $_SERVER['RIFTARCHIVE_SCRAPERAPI_KEY']; }
    if ($key === false || $key === '') { $key = getenv('SCRAPERAPI_KEY'); }
    if (($key === false || $key === '') && isset($_SERVER['SCRAPERAPI_KEY'])) { $key = $_SERVER['SCRAPERAPI_KEY']; }
    return $key;
}

function isChallengePage($html) {
    $sample = strtolower(substr((string)$html, 0, 120000));
    return strpos($sample, 'just a moment') !== false || strpos($sample, 'cf-chl-') !== false || strpos($sample, 'captcha') !== false;
}

function parseMarketOffers($html, $trend, $limit) {
    $parsed = marketDom($html); if ($parsed === null) { return null; }
    $dom = $parsed[0]; $xpath = $parsed[1];
    $rows = $xpath->query("//*[contains(concat(' ', normalize-space(@class), ' '), ' article-row ') or starts-with(@id,'articleRow')]");
    $offers = array();
    foreach ($rows as $row) {
        $sellerNode = queryFirstNode($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' seller-name ')]//a",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' col-seller ')]//a",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' seller-info ')]//a"
        ), $row);
        $seller = $sellerNode ? cleanMarketText($sellerNode->textContent) : '';
        if ($seller === '') { continue; }
        $priceText = queryFirstText($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' price-container ')]//*[contains(concat(' ', normalize-space(@class), ' '), ' color-primary ')]",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' price-container ')]"
        ), $row);
        $price = parseEuropeanPrice($priceText); if ($price === null) { continue; }
        $quantityText = queryFirstText($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' amount-container ')]//*[contains(concat(' ', normalize-space(@class), ' '), ' item-count ')]",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' amount-container ')]"
        ), $row);
        $condition = queryFirstText($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' article-condition ')]//span",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' product-attributes ')]//*[contains(concat(' ', normalize-space(@class), ' '), ' badge ')]"
        ), $row);
        if ($condition !== '') { $condition = strtoupper(substr($condition, 0, 2)); }
        $country = queryFirstAttribute($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' seller-info ')]//*[@aria-label or @data-bs-original-title or @title]",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' col-seller ')]//*[@aria-label or @data-bs-original-title or @title]"
        ), array('aria-label','data-bs-original-title','title'), $row);
        $sellerType = queryFirstAttribute($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' seller-name ')]//*[@aria-label or @data-bs-original-title or @title]"
        ), array('aria-label','data-bs-original-title','title'), $row);
        $offers[] = array(
            'seller' => $seller,
            'country' => $country,
            'seller_type' => $sellerType,
            'condition' => $condition,
            'quantity' => extractInteger($quantityText),
            'price' => $price,
            'vs_trend' => is_numeric($trend) && (float)$trend > 0 ? round(($price - (float)$trend) / (float)$trend, 4) : null
        );
        if (count($offers) >= $limit) { break; }
    }
    return $offers;
}

function parseSellerEpicOffers($html, $marketCards, $limit) {
    $parsed = marketDom($html); if ($parsed === null) { return null; }
    $xpath = $parsed[1]; $byName = array(); $byId = array();
    foreach ($marketCards as $card) {
        $key = normalizeMarketName($card['name']); if ($key !== '' && !isset($byName[$key])) { $byName[$key] = $card; }
        $byId[(string)$card['id_product']] = $card;
    }
    $rows = $xpath->query("//*[contains(concat(' ', normalize-space(@class), ' '), ' article-row ') or starts-with(@id,'articleRow')]");
    $found = array(); $seen = array();
    foreach ($rows as $row) {
        $link = queryFirstNode($xpath, array(".//a[contains(@href,'/Products/')]"), $row); if (!$link) { continue; }
        $href = $link->getAttribute('href'); $name = cleanMarketText($link->textContent); $card = null; $idProduct = 0;
        if (preg_match('/[?&]idProduct=(\d+)/', $href, $match)) { $idProduct = (int)$match[1]; if (isset($byId[(string)$idProduct])) { $card = $byId[(string)$idProduct]; } }
        if ($card === null) {
            $key = normalizeMarketName($name); if (isset($byName[$key])) { $card = $byName[$key]; }
            else { foreach ($byName as $epicKey => $candidate) { if ($epicKey !== '' && strlen($key) >= strlen($epicKey) && substr($key, -strlen($epicKey)) === $epicKey) { $card = $candidate; break; } } }
        }
        if ($card === null || isset($seen[$card['id_product']])) { continue; }
        $priceText = queryFirstText($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' price-container ')]//*[contains(concat(' ', normalize-space(@class), ' '), ' color-primary ')]",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' price-container ')]"
        ), $row);
        $price = parseEuropeanPrice($priceText); if ($price === null) { continue; }
        $quantityText = queryFirstText($xpath, array(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' amount-container ')]//*[contains(concat(' ', normalize-space(@class), ' '), ' item-count ')]",
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' amount-container ')]"
        ), $row);
        $trend = isset($card['price']['trend']) ? $card['price']['trend'] : null; $seen[$card['id_product']] = true;
        $found[] = array(
            'id_product' => $card['id_product'], 'name' => $card['name'], 'image_url' => $card['image_url'],
            'product_url' => $card['product_url'], 'price' => $price, 'quantity' => extractInteger($quantityText),
            'trend' => $trend, 'below_trend' => is_numeric($trend) && $price <= (float)$trend
        );
        if (count($found) >= $limit) { break; }
    }
    return $found;
}

function marketDom($html) {
    if (!class_exists('DOMDocument')) { return null; }
    $dom = new DOMDocument(); $previous = libxml_use_internal_errors(true);
    $loaded = $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html); libxml_clear_errors(); libxml_use_internal_errors($previous);
    return $loaded ? array($dom, new DOMXPath($dom)) : null;
}

function queryFirstNode($xpath, $queries, $context) {
    foreach ($queries as $query) { $nodes = $xpath->query($query, $context); if ($nodes && $nodes->length > 0) { return $nodes->item(0); } }
    return null;
}

function queryFirstText($xpath, $queries, $context) {
    $node = queryFirstNode($xpath, $queries, $context); return $node ? cleanMarketText($node->textContent) : '';
}

function queryFirstAttribute($xpath, $queries, $attributes, $context) {
    foreach ($queries as $query) {
        $nodes = $xpath->query($query, $context); if (!$nodes) { continue; }
        foreach ($nodes as $node) { foreach ($attributes as $attribute) { if ($node->hasAttribute($attribute) && trim($node->getAttribute($attribute)) !== '') { return cleanMarketText($node->getAttribute($attribute)); } } }
    }
    return '';
}

function cleanMarketText($value) { return trim(preg_replace('/\s+/u', ' ', html_entity_decode((string)$value, ENT_QUOTES, 'UTF-8'))); }

function normalizeMarketName($value) {
    $value = preg_replace('/\s*\(V\.\d+\s*-\s*[^)]+\)\s*$/i', '', cleanMarketText($value));
    $value = function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    return preg_replace('/[^a-z0-9]+/', '', $value);
}

function parseEuropeanPrice($value) {
    if (!preg_match('/([0-9][0-9.,]*)/', (string)$value, $match)) { return null; }
    $number = $match[1];
    if (strpos($number, ',') !== false) { $number = str_replace('.', '', $number); $number = str_replace(',', '.', $number); }
    return is_numeric($number) ? round((float)$number, 2) : null;
}

function extractInteger($value) { return preg_match('/\d+/', (string)$value, $match) ? (int)$match[0] : null; }

function httpGetDocument($url, $accept) {
    if (function_exists('curl_init')) {
        $handle = curl_init($url); curl_setopt($handle, CURLOPT_RETURNTRANSFER, true); curl_setopt($handle, CURLOPT_CONNECTTIMEOUT, 15); curl_setopt($handle, CURLOPT_TIMEOUT, 60); curl_setopt($handle, CURLOPT_FOLLOWLOCATION, true); curl_setopt($handle, CURLOPT_USERAGENT, 'Mozilla/5.0 RiftArchive/1.0'); curl_setopt($handle, CURLOPT_HTTPHEADER, array('Accept: ' . $accept));
        $body = curl_exec($handle); $code = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE); curl_close($handle);
        return ($code >= 200 && $code < 300 && $body !== false && $body !== '') ? $body : false;
    }
    $context = stream_context_create(array('http' => array('method' => 'GET', 'timeout' => 60, 'header' => "User-Agent: Mozilla/5.0 RiftArchive/1.0\r\nAccept: " . $accept . "\r\n")));
    return @file_get_contents($url, false, $context);
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
