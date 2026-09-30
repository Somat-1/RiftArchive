<?php
// Cached DotGG tournament-deck aggregation. PHP 5.3 compatible.
define('DOTGG_DECKS_URL', 'https://api.dotgg.gg/cgfw/getdecks');
define('LEGEND_STATS_TTL', 21600);
define('LEGEND_STATS_COOLDOWN', 600);
define('LEGEND_STATS_MAX_PAGES', 2);
define('LEGEND_STATS_PAGE_SIZE', 30);

function handleLegendStatsGet() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    $id = lsLegendId(isset($_GET['legend_id']) ? $_GET['legend_id'] : '');
    if ($id === '') { sendJson(array('error' => 'valid legend_id required'), 400); }
    $path = lsCachePath($id);
    $cached = lsReadCache($path);
    if ($cached === null) { sendJson(array('error' => 'No cached analysis for this Legend yet.', 'cache_miss' => true), 404); }
    $cached['cache']['stale'] = (time() - @filemtime($path)) > LEGEND_STATS_TTL;
    sendJson($cached, 200);
}

function handleLegendStatsRefresh() {
    if (!isAdmin()) { sendJson(array('error' => 'authentication required'), 401); }
    $raw = @file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 12000) { sendJson(array('error' => 'invalid payload'), 400); }
    $input = json_decode($raw, true);
    $id = lsLegendId(is_array($input) && isset($input['legend_id']) ? $input['legend_id'] : '');
    if ($id === '') { sendJson(array('error' => 'valid legend_id required'), 400); }
    $name = is_array($input) && isset($input['legend_name']) ? trim(strip_tags((string)$input['legend_name'])) : $id;
    $name = substr($name, 0, 100);
    $days = is_array($input) && isset($input['days']) ? (int)$input['days'] : 180;
    if (!in_array($days, array(30, 90, 180, 365), true)) { $days = 180; }

    if (!ensureDataDir()) { sendJson(array('error' => 'statistics cache is not writable'), 500); }
    $path = lsCachePath($id);
    $cached = lsReadCache($path);
    if ($cached !== null && (time() - @filemtime($path)) < LEGEND_STATS_COOLDOWN) {
        $cached['cache']['stale'] = false;
        $cached['cache']['throttled'] = true;
        $cached['cache']['message'] = 'Refresh cooldown active; serving the current cache.';
        sendJson($cached, 200);
    }

    $lockPath = CACHE_DIR . '/legend-stats-refresh.lock';
    $lock = @fopen($lockPath, 'c');
    if ($lock === false || !@flock($lock, LOCK_EX | LOCK_NB)) {
        if (is_resource($lock)) { @fclose($lock); }
        if ($cached !== null) {
            $cached['cache']['stale'] = true;
            $cached['cache']['message'] = 'Another refresh is running; serving the previous cache.';
            sendJson($cached, 200);
        }
        sendJson(array('error' => 'Another statistics refresh is already running.'), 409);
    }

    $result = lsFetchDeckSample($id, $days);
    if (isset($result['error'])) {
        @flock($lock, LOCK_UN); @fclose($lock);
        if ($cached !== null) {
            $cached['cache']['stale'] = true;
            $cached['cache']['message'] = 'DotGG is unavailable; serving the previous cache.';
            sendJson($cached, 200);
        }
        sendJson(array('error' => $result['error']), 502);
    }

    $payload = lsAggregateDecks($id, $name, $days, $result);
    if (!writeJsonFile($path, $payload)) {
        @flock($lock, LOCK_UN); @fclose($lock);
        sendJson(array('error' => 'Could not save the statistics cache.'), 500);
    }
    @flock($lock, LOCK_UN); @fclose($lock);
    sendJson($payload, 200);
}

function lsLegendId($value) {
    $id = strtoupper(trim((string)$value));
    return preg_match('/^[A-Z0-9]{2,6}-[0-9]{3}$/', $id) ? $id : '';
}

function lsCachePath($id) { return CACHE_DIR . '/legend-stats-' . strtolower(str_replace('-', '_', $id)) . '.json'; }

function lsReadCache($path) {
    if (!is_file($path)) { return null; }
    $data = json_decode(@file_get_contents($path), true);
    return is_array($data) && isset($data['cards']) && is_array($data['cards']) ? $data : null;
}

function lsFetchDeckSample($legendId, $days) {
    $unique = array(); $duplicates = 0; $pagesRead = 0;
    for ($page = 1; $page <= LEGEND_STATS_MAX_PAGES; $page++) {
        $request = array(
            'page' => $page, 'limit' => LEGEND_STATS_PAGE_SIZE, 'srt' => 'date', 'direct' => 'desc',
            'type' => '', 'my' => 0, 'myarchive' => 0, 'fav' => 0,
            'getdecks' => array(
                'hascrd' => array($legendId), 'nothascrd' => array(), 'youtube' => 0, 'smartsrch' => '',
                'date' => (string)$days, 'color' => array(), 'collection' => 0, 'topset' => '', 'at' => 0,
                'format' => 'standard', 'is_tournament' => '1', 'legalonly' => 1,
                'priceMin' => '', 'priceMax' => '', 'priceCurrency' => 'usd', 'placement' => ''
            )
        );
        $url = DOTGG_DECKS_URL . '?game=riftbound&rq=' . rawurlencode(json_encode($request));
        $raw = lsDotggGet($url);
        if ($raw === false || strlen($raw) > 8000000) { return array('error' => 'DotGG deck search is temporarily unavailable.'); }
        $rows = json_decode($raw, true);
        if (!is_array($rows)) { return array('error' => 'DotGG returned an unexpected response.'); }
        $pagesRead++;
        foreach ($rows as $deck) {
            if (!is_array($deck) || !isset($deck['deck']) || !is_array($deck['deck'])) { continue; }
            $fingerprint = isset($deck['fingerprint']) && $deck['fingerprint'] !== '' ? (string)$deck['fingerprint'] : md5(json_encode($deck['deck']));
            if (isset($unique[$fingerprint])) { $duplicates++; continue; }
            $unique[$fingerprint] = $deck;
        }
        if (count($rows) < LEGEND_STATS_PAGE_SIZE) { break; }
    }
    return array('decks' => array_values($unique), 'duplicates_removed' => $duplicates, 'pages_read' => $pagesRead);
}

function lsDotggGet($url) {
    // The refresh lock serializes callers; this timestamp also spaces separate refresh jobs.
    $stampPath = CACHE_DIR . '/dotgg-last-request.txt';
    $last = is_file($stampPath) ? (float)@file_get_contents($stampPath) : 0;
    $wait = 1.1 - (microtime(true) - $last);
    if ($wait > 0) { usleep((int)ceil($wait * 1000000)); }
    @file_put_contents($stampPath, (string)microtime(true), LOCK_EX);
    return httpGet($url);
}

function lsAggregateDecks($legendId, $legendName, $days, $sample) {
    $decks = $sample['decks']; $cardMap = lsCardMap();
    $main = array(); $side = array(); $topCount = 0; $tournamentCount = 0; $deckSummaries = array();
    foreach ($decks as $deck) {
        $place = isset($deck['tournament']['place']) ? (int)$deck['tournament']['place'] : 0;
        $isTop = $place > 0 && $place <= 16;
        if (isset($deck['tournament']) && is_array($deck['tournament'])) { $tournamentCount++; }
        if ($isTop) { $topCount++; }
        $boards = isset($deck['boards']) && is_array($deck['boards']) ? $deck['boards'] : array();
        $mainCards = isset($boards[0]) && is_array($boards[0]) ? $boards[0] : $deck['deck'];
        $sideCards = isset($boards[1]) && is_array($boards[1]) ? $boards[1] : (isset($deck['sideboard']) && is_array($deck['sideboard']) ? $deck['sideboard'] : array());
        lsCountCards($main, $mainCards, $isTop, $legendId, $cardMap);
        lsCountCards($side, $sideCards, $isTop, $legendId, $cardMap);
        if (count($deckSummaries) < 10) {
            $deckSummaries[] = array(
                'name' => isset($deck['humanname']) ? (string)$deck['humanname'] : 'Tournament deck',
                'slug' => isset($deck['slug']) ? (string)$deck['slug'] : '',
                'date' => isset($deck['date']) ? (string)$deck['date'] : '',
                'place' => $place,
                'event' => isset($deck['tournament']['tournament_name']) ? (string)$deck['tournament']['tournament_name'] : ''
            );
        }
    }
    $deckCount = count($decks);
    $mainRows = lsFinalizeCards($main, $deckCount, $topCount);
    $sideRows = lsFinalizeCards($side, $deckCount, $topCount);
    return array(
        'schema_version' => 1,
        'legend' => array('id' => $legendId, 'name' => $legendName),
        'sample' => array(
            'decks' => $deckCount, 'tournament_decks' => $tournamentCount, 'top_16_decks' => $topCount,
            'duplicates_removed' => (int)$sample['duplicates_removed'], 'pages_read' => (int)$sample['pages_read'],
            'window_days' => $days
        ),
        'cards' => array('main' => $mainRows, 'sideboard' => $sideRows),
        'decks' => $deckSummaries,
        'methodology' => 'Popularity is the share of sampled tournament decklists containing a card. Top-16 lift is the difference between Top-16 inclusion and overall inclusion; it is an association, not a match win rate.',
        'source' => array('name' => 'DotGG public API', 'url' => 'https://dotgg.gg/api/'),
        'cache' => array('generated_at' => gmdate('c'), 'stale' => false, 'throttled' => false)
    );
}

function lsCountCards(&$stats, $cards, $isTop, $legendId, $cardMap) {
    $seen = array();
    foreach ($cards as $rawId => $rawQuantity) {
        $id = strtoupper((string)$rawId); $quantity = max(0, (int)$rawQuantity);
        if ($quantity < 1 || $id === $legendId || isset($seen[$id])) { continue; }
        $seen[$id] = true;
        $card = isset($cardMap[$id]) ? $cardMap[$id] : lsUnknownCard($id);
        $type = strtolower(isset($card['type']) ? $card['type'] : '');
        if ($type === 'legend' || $type === 'rune') { continue; }
        if (!isset($stats[$id])) {
            $stats[$id] = $card;
            $stats[$id]['deck_count'] = 0; $stats[$id]['copies'] = 0; $stats[$id]['top_deck_count'] = 0;
        }
        $stats[$id]['deck_count']++;
        $stats[$id]['copies'] += $quantity;
        if ($isTop) { $stats[$id]['top_deck_count']++; }
    }
}

function lsFinalizeCards($stats, $deckCount, $topCount) {
    $rows = array();
    foreach ($stats as $card) {
        $included = (int)$card['deck_count']; $topIncluded = (int)$card['top_deck_count'];
        $inclusion = $deckCount > 0 ? round(100 * $included / $deckCount, 1) : 0;
        $topInclusion = $topCount > 0 ? round(100 * $topIncluded / $topCount, 1) : null;
        $card['inclusion'] = $inclusion;
        $card['average_copies'] = $included > 0 ? round($card['copies'] / $included, 2) : 0;
        $card['top_inclusion'] = $topInclusion;
        $card['top_16_lift'] = $topInclusion === null ? null : round($topInclusion - $inclusion, 1);
        unset($card['copies']);
        $rows[] = $card;
    }
    usort($rows, 'lsComparePopularity');
    return $rows;
}

function lsComparePopularity($a, $b) {
    if ($a['inclusion'] == $b['inclusion']) { return $a['name'] === $b['name'] ? 0 : ($a['name'] < $b['name'] ? -1 : 1); }
    return $a['inclusion'] > $b['inclusion'] ? -1 : 1;
}

function lsCardMap() {
    $paths = array(CACHE_FILE, dirname(__FILE__) . '/catalog.json'); $items = array();
    foreach ($paths as $path) {
        if (!is_file($path)) { continue; }
        $payload = json_decode(@file_get_contents($path), true);
        if (is_array($payload) && isset($payload['items']) && is_array($payload['items'])) { $items = $payload['items']; break; }
    }
    $map = array();
    foreach ($items as $card) {
        if (!is_array($card)) { continue; }
        $set = isset($card['set']['set_id']) ? strtoupper((string)$card['set']['set_id']) : '';
        $collector = isset($card['collector_number']) ? (int)$card['collector_number'] : 0;
        if ($set === '' || $collector < 1) { continue; }
        $id = $set . '-' . str_pad((string)$collector, 3, '0', STR_PAD_LEFT);
        $special = isset($card['metadata']['alternate_art']) && $card['metadata']['alternate_art'] || isset($card['metadata']['overnumbered']) && $card['metadata']['overnumbered'] || isset($card['metadata']['signature']) && $card['metadata']['signature'];
        if (isset($map[$id]) && $special) { continue; }
        $name = isset($card['name']) ? preg_replace('/\s*\((?:Alternate Art|Overnumbered|Signature|Metal|Showcase)\)\s*$/i', '', $card['name']) : $id;
        $name = preg_replace('/\s+-\s+/', ', ', $name);
        $map[$id] = array(
            'id' => $id, 'name' => $name,
            'image_url' => isset($card['media']['image_url']) ? $card['media']['image_url'] : 'https://static.dotgg.gg/riftbound/cards/' . $id . '.webp',
            'type' => isset($card['classification']['type']) ? $card['classification']['type'] : 'Card',
            'rarity' => isset($card['classification']['rarity']) ? $card['classification']['rarity'] : '',
            'energy' => isset($card['attributes']['energy']) ? $card['attributes']['energy'] : null,
            'domains' => isset($card['classification']['domain']) && is_array($card['classification']['domain']) ? $card['classification']['domain'] : array()
        );
    }
    return $map;
}

function lsUnknownCard($id) {
    return array('id' => $id, 'name' => $id, 'image_url' => 'https://static.dotgg.gg/riftbound/cards/' . rawurlencode($id) . '.webp', 'type' => 'Card', 'rarity' => '', 'energy' => null, 'domains' => array());
}
