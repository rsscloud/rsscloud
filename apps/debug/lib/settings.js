const { URL } = require('url');

const SELF_HOSTED_FEED_NAME = 'rss.xml';

function computeDefaultSettings({ sessionId, publicUrl, hubServerUrl }) {
    const hub = hubServerUrl.replace(/\/$/, '');
    return {
        feedUrl: `${publicUrl}/s/${sessionId}/${SELF_HOSTED_FEED_NAME}`,
        rssCloud: {
            disabled: false,
            protocol: 'http-post',
            accepts: 'xml',
            pingUrl: `${hub}/ping`,
            subscribeUrl: `${hub}/pleaseNotify`,
            rpcUrl: `${hub}/RPC2`
        },
        webSub: {
            disabled: false,
            hubUrl: `${hub}/websub`,
            leaseSeconds: '',
            secret: ''
        }
    };
}

// Match either scheme against publicUrl's own host — a feed URL typed or
// discovered with the other scheme against the same host:port should still
// be recognized as self-hosted.
function selfHostedPrefixes({ publicUrl, sessionId }) {
    const url = new URL(publicUrl);
    const otherScheme = url.protocol === 'https:' ? 'http' : 'https';
    return [
        `${url.protocol}//${url.host}/s/${sessionId}/`,
        `${otherScheme}://${url.host}/s/${sessionId}/`
    ];
}

function feedNameFromSelfHostedUrl(feedUrl, ctx) {
    const prefix = selfHostedPrefixes(ctx).find(p => feedUrl.startsWith(p));
    return prefix ? feedUrl.slice(prefix.length) : null;
}

function isSelfHostedFeedUrl(feedUrl, ctx) {
    return feedNameFromSelfHostedUrl(feedUrl, ctx) !== null;
}

const RECOGNIZED_RSSCLOUD_PROTOCOLS = ['http-post', 'https-post', 'xml-rpc'];

// Mirrors packages/core/src/protocols/subscribe-request.ts's scheme rule —
// not imported, since that module isn't part of @rsscloud/core's public
// exports (this app already duplicates small cross-boundary helpers rather
// than reaching into another package's internals).
function schemeFor(protocol, port) {
    return protocol === 'https-post' || String(port) === '443' ? 'https' : 'http';
}

function normalizePath(path) {
    return path.startsWith('/') ? path : `/${path}`;
}

// Merge a discoverFeed() result into a settings snapshot. Only called after
// a *successful* fetch+parse (the caller short-circuits to an error before
// ever reaching here), so "not found" is a confident signal — this feed was
// fully checked and genuinely doesn't advertise that protocol — not an
// ambiguous "couldn't tell." Each group is enabled+configured when found,
// disabled when not.
function applyDiscoveryToSettings(settings, discovery) {
    const next = {
        feedUrl: settings.feedUrl,
        rssCloud: { ...settings.rssCloud },
        webSub: { ...settings.webSub }
    };

    if (discovery.rssCloud && RECOGNIZED_RSSCLOUD_PROTOCOLS.includes(discovery.rssCloud.protocol)) {
        const { domain, port, path, protocol } = discovery.rssCloud;
        const origin = `${schemeFor(protocol, port)}://${domain}:${port}`;
        next.rssCloud.disabled = false;
        next.rssCloud.protocol = protocol;
        if (protocol === 'xml-rpc') {
            next.rssCloud.rpcUrl = `${origin}${normalizePath(path)}`;
        } else {
            next.rssCloud.subscribeUrl = `${origin}${normalizePath(path)}`;
            // A feed never carries a ping URL, only a registration endpoint —
            // default ping to the discovered origin's conventional path.
            next.rssCloud.pingUrl = `${origin}/ping`;
        }
    } else {
        next.rssCloud.disabled = true;
    }

    if (discovery.webSub) {
        next.webSub.disabled = false;
        next.webSub.hubUrl = discovery.webSub.hubUrl;
    } else {
        next.webSub.disabled = true;
    }

    if (discovery.selfUrl) {
        next.feedUrl = discovery.selfUrl;
    }

    return next;
}

module.exports = {
    computeDefaultSettings,
    selfHostedPrefixes,
    feedNameFromSelfHostedUrl,
    isSelfHostedFeedUrl,
    applyDiscoveryToSettings
};
