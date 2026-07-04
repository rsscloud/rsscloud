const { Builder } = require('xml2js');
const { URL } = require('url');

const SOURCE_CLOUD_NS = 'https://source.scripting.com/';

// Per https://source.scripting.com/ : "The <source:cloud> element has no
// attributes and its value is the URL of the cloud server" — a single URL,
// whose scheme is the one extra bit of information (http vs https) the
// original <cloud> element couldn't express. It's meant to replace
// SOAP/XML-RPC outright, so there's no way to represent an xml-rpc endpoint
// this way — callers should only pass an http-post/https-post cloud.
function sourceCloudUrl(cloud) {
    const scheme = cloud.protocol === 'https-post' ? 'https' : 'http';
    return new URL(`${scheme}://${cloud.domain}:${cloud.port}${cloud.path}`).toString();
}

// Render an RSS 2.0 feed, optionally carrying a <cloud> element (plus its
// <source:cloud> counterpart, the https://source.scripting.com/ convention,
// for http-post/https-post clouds — it has no way to represent xml-rpc) —
// the document a publisher serves so a hub knows where to register for
// change notifications. Item pubDates are emitted in RFC 822 form. When
// `opts.hub` is given, the feed also advertises a WebSub hub via
// <atom:link rel="hub"> (with a rel="self" pointing at the feed's own URL),
// so the same document is discoverable over both protocols. The
// cloud/source:cloud/atom:link elements are placed before <item> so a
// consumer sees discovery info without scanning past the entries.
function renderCloudFeed(opts) {
    const rssAttrs = { version: '2.0' };
    const channel = {
        title: opts.title,
        link: opts.link,
        description: opts.description
    };

    if (opts.cloud) {
        channel.cloud = {
            $: {
                domain: opts.cloud.domain,
                port: String(opts.cloud.port),
                path: opts.cloud.path,
                registerProcedure: opts.cloud.registerProcedure,
                protocol: opts.cloud.protocol
            }
        };
        if (opts.cloud.protocol !== 'xml-rpc') {
            rssAttrs['xmlns:source'] = SOURCE_CLOUD_NS;
            channel['source:cloud'] = sourceCloudUrl(opts.cloud);
        }
    }

    if (opts.hub) {
        rssAttrs['xmlns:atom'] = 'http://www.w3.org/2005/Atom';
        channel['atom:link'] = [
            { $: { rel: 'hub', href: opts.hub } },
            { $: { rel: 'self', href: opts.link } }
        ];
    }

    channel.item = opts.items.map(item => ({
        title: item.title,
        description: item.description,
        pubDate: item.pubDate.toUTCString(),
        guid: item.guid
    }));

    return new Builder().buildObject({ rss: { $: rssAttrs, channel } });
}

module.exports = { renderCloudFeed };
