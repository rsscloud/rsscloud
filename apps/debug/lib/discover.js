const { Parser } = require('xml2js');
const { URL } = require('url');
const { parseLinkHeader, findLinkByRel } = require('./link-header');

// xml2js (with explicitArray: false) collapses a lone matching child to a
// bare object but promotes two-or-more to an array — normalize once here so
// every hub-link lookup can treat it uniformly.
function asArray(value) {
    if (value == null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

// Find a rel="<rel>" link among a channel/feed's <atom:link>/<link>
// children, however xml2js happened to collapse them.
function findRelInBodyLinks(links, rel) {
    return asArray(links).find(link => link?.$?.rel === rel)?.$?.href;
}

const SOURCE_CLOUD_NS = 'https://source.scripting.com/';
const ATOM_NS = 'http://www.w3.org/2005/Atom';

// xml2js (explicitArray: false) puts an element's attributes on `$`,
// colon-and-all — so an `xmlns:x="..."` declaration shows up as `$['xmlns:x']`.
function namespaceDeclarations(node) {
    const attrs = node?.$ ?? {};
    return Object.fromEntries(
        Object.entries(attrs)
            .filter(([key]) => key.startsWith('xmlns:'))
            .map(([key, value]) => [key.slice('xmlns:'.length), value])
    );
}

// Resolve whichever alias a document bound to `uri`, checking each candidate
// node in declaration-search order (a binding can live on either the root
// element or the channel). Returns undefined when the document never bound it.
function resolveNamespacePrefix(uri, ...nodes) {
    for (const node of nodes) {
        const hit = Object.entries(namespaceDeclarations(node)).find(([, value]) => value === uri);
        if (hit) {
            return hit[0];
        }
    }
    return undefined;
}

function parseCloudAttrs(attrs) {
    if (!attrs) {
        return null;
    }
    return {
        domain: attrs.domain,
        port: Number(attrs.port),
        path: attrs.path,
        registerProcedure: attrs.registerProcedure,
        protocol: attrs.protocol
    };
}

// Per https://source.scripting.com/ : <source:cloud> has no attributes —
// its value is a plain URL, the scheme being the one extra bit of info
// (http vs https) the original <cloud> element couldn't express. It's
// meant to replace SOAP/XML-RPC outright, so it only ever resolves to
// http-post/https-post — there's no way to spell "this is xml-rpc" here.
function parseSourceCloudUrl(value) {
    if (typeof value !== 'string') {
        return null;
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    return {
        domain: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        registerProcedure: '',
        protocol: url.protocol === 'https:' ? 'https-post' : 'http-post'
    };
}

// Detect what a feed advertises: an rssCloud <cloud> element, and/or a
// WebSub hub link (`<atom:link rel="hub">` in RSS, `<link rel="hub">` in
// Atom). Used by the harness's "enter a feed URL" discovery feature.
async function parseFeedDiscovery(xmlText, { linkHeader } = {}) {
    let parsed;
    try {
        parsed = await new Parser({ explicitArray: false }).parseStringPromise(
            xmlText
        );
    } catch {
        return { rssCloud: null, webSub: null, selfUrl: undefined, error: 'not parseable as XML' };
    }

    const channel = parsed.rss?.channel;

    // A <source:cloud> (whatever prefix it's actually bound to) is canonical
    // over a traditional <cloud> when a feed advertises both.
    const traditionalCloud = parseCloudAttrs(channel?.cloud?.$);
    const sourceCloudPrefix = resolveNamespacePrefix(SOURCE_CLOUD_NS, parsed.rss, channel);
    const sourceCloud = sourceCloudPrefix
        ? parseSourceCloudUrl(channel?.[`${sourceCloudPrefix}:cloud`])
        : null;
    const rssCloud = sourceCloud ?? traditionalCloud ?? null;

    // A hub/self link can appear under an RSS channel (conventionally
    // `atom:link`) or under an Atom feed root (`link`). Resolve whatever
    // alias the document actually bound to the Atom namespace, falling back
    // to the ubiquitous `atom` convention when it's used without an explicit
    // xmlns binding.
    const atomPrefix = resolveNamespacePrefix(ATOM_NS, parsed.rss, channel) ?? 'atom';
    const bodyLinks = channel?.[`${atomPrefix}:link`] ?? parsed.feed?.link;
    const headerLinks = parseLinkHeader(linkHeader);
    const hubUrl = findLinkByRel(headerLinks, 'hub') ?? findRelInBodyLinks(bodyLinks, 'hub');
    const selfUrl = findLinkByRel(headerLinks, 'self') ?? findRelInBodyLinks(bodyLinks, 'self');
    const webSub = hubUrl ? { hubUrl } : null;

    return { rssCloud, webSub, selfUrl };
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
            selfUrl: undefined,
            error: `fetch failed: ${res.status}`
        };
    }
    const linkHeader = typeof res.headers?.get === 'function' ? res.headers.get('link') : undefined;
    return parseFeedDiscovery(await res.text(), { linkHeader });
}

module.exports = { parseFeedDiscovery, discoverFeed };
