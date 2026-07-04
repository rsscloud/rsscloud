const { createSafeFetch, createCidrAllowList } = require('@rsscloud/core');

// SSRF-guarded fetch for the harness's own outbound calls (feed discovery,
// pleaseNotify/ping, WebSub hub.*): refuses loopback/private/link-local
// targets by default, with an allowlist escape hatch for local dev — the
// same tension apps/server's guardedFetchOption already solves.
function createGuardedFetch({ allowCidrs = [], timeoutMs } = {}) {
    const options = { timeoutMs };
    if (allowCidrs.length > 0) {
        options.allow = createCidrAllowList(allowCidrs);
    }
    return createSafeFetch(options);
}

module.exports = { createGuardedFetch };
