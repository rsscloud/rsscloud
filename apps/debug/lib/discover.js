const { Parser } = require('xml2js');

// xml2js (with explicitArray: false) collapses a lone matching child to a
// bare object but promotes two-or-more to an array — normalize once here so
// every hub-link lookup can treat it uniformly.
function asArray(value) {
    if (value == null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

// Find a rel="hub" link among a channel/feed's <atom:link>/<link> children,
// however xml2js happened to collapse them.
function findHubLink(links) {
    const hub = asArray(links).find(link => link?.$?.rel === 'hub');
    return hub ? { hubUrl: hub.$.href } : null;
}

// Detect what a feed advertises: an rssCloud <cloud> element, and/or a
// WebSub hub link (`<atom:link rel="hub">` in RSS, `<link rel="hub">` in
// Atom). Used by the harness's "enter a feed URL" discovery feature.
async function parseFeedDiscovery(xmlText) {
    let parsed;
    try {
        parsed = await new Parser({ explicitArray: false }).parseStringPromise(
            xmlText
        );
    } catch {
        return { rssCloud: null, webSub: null, error: 'not parseable as XML' };
    }

    const channel = parsed.rss?.channel;
    const cloudAttrs = channel?.cloud?.$;
    const rssCloud = cloudAttrs
        ? {
            domain: cloudAttrs.domain,
            port: Number(cloudAttrs.port),
            path: cloudAttrs.path,
            registerProcedure: cloudAttrs.registerProcedure,
            protocol: cloudAttrs.protocol
        }
        : null;

    // <cloud> only ever appears under an RSS channel; a hub link can appear
    // there (`atom:link`) or under an Atom feed root (`link`). This assumes
    // the RSS document uses the conventional `atom:` namespace prefix (as
    // every real-world generator does) — a feed that binds the Atom
    // namespace to a different alias would go undetected here.
    const hubLinks = channel?.['atom:link'] ?? parsed.feed?.link;
    const webSub = findHubLink(hubLinks);

    return { rssCloud, webSub };
}

// Fetch an arbitrary feed URL and report what protocols it advertises. A
// fetch rejection (network error, SSRF block) propagates to the caller; a
// non-2xx response or unparseable body is reported via `.error` instead.
async function discoverFeed({ url, fetch = globalThis.fetch }) {
    const res = await fetch(url);
    if (res.status < 200 || res.status >= 300) {
        return {
            rssCloud: null,
            webSub: null,
            error: `fetch failed: ${res.status}`
        };
    }
    return parseFeedDiscovery(await res.text());
}

module.exports = { parseFeedDiscovery, discoverFeed };
