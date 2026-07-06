const packageJson = require('./package.json');

// Simple config utility that reads from process.env with defaults
function getConfig(key, defaultValue) {
    return process.env[key] ?? defaultValue;
}

// Parse numeric values. Only the unset case falls back to defaultValue — a
// present-but-malformed value fails loudly instead of silently becoming NaN
// (which would otherwise break setInterval/app.listen/idle-time comparisons
// downstream without any visible error).
function getNumericConfig(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric value for ${key}: "${value}"`);
    }
    return parsed;
}

// Parse a comma-separated CIDR list, dropping blank entries.
function getCidrListConfig(key) {
    return String(getConfig(key, ''))
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

const domain = getConfig('DOMAIN', 'localhost');
const port = getNumericConfig('PORT', 9000);

module.exports = {
    appName: 'rssCloudDebug',
    appVersion: packageJson.version,
    domain,
    port,
    // The externally-reachable base URL this harness advertises for its own
    // WebSub callback, rssCloud callback, and self-hosted feed links — distinct
    // from DOMAIN/PORT above (the internal listen address), since a reverse
    // proxy in front of a public deployment typically terminates TLS on a
    // different port than the one this process actually binds. Defaults to
    // DOMAIN/PORT for a direct, non-proxied local dev setup.
    publicUrl: getConfig('PUBLIC_URL', `http://${domain}:${port}`).replace(/\/$/, ''),
    hubServerUrl: getConfig('HUB_SERVER_URL', 'http://localhost:5337'),
    requestTimeout: getNumericConfig('REQUEST_TIMEOUT', 4000),
    debugFetchAllowCidrs: getCidrListConfig('DEBUG_FETCH_ALLOW_CIDRS'),
    // 1h — past this, incoming callback/feed routes 404 for the session.
    sessionCallbackIdleMs: getNumericConfig(
        'SESSION_CALLBACK_IDLE_MS',
        3600000
    ),
    // 24h — past this, a session is fully evicted from memory by the GC sweep.
    sessionGcIdleMs: getNumericConfig('SESSION_GC_IDLE_MS', 86400000),
    // 15m — how often the GC sweep runs.
    sessionGcIntervalMs: getNumericConfig('SESSION_GC_INTERVAL_MS', 900000)
};
