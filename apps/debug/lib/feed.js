const { Builder } = require('xml2js');

// Render an RSS 2.0 feed carrying a <cloud> element — the document a publisher
// serves so a hub knows where to register for change notifications. Item
// pubDates are emitted in RFC 822 form. When `opts.hub` is given, the feed also
// advertises a WebSub hub via <atom:link rel="hub"> (with a rel="self" pointing
// at the feed's own URL), so the same document is discoverable over both
// protocols.
function renderCloudFeed(opts) {
    const rssAttrs = { version: '2.0' };
    const channel = {
        title: opts.title,
        link: opts.link,
        description: opts.description,
        cloud: {
            $: {
                domain: opts.cloud.domain,
                port: String(opts.cloud.port),
                path: opts.cloud.path,
                registerProcedure: opts.cloud.registerProcedure,
                protocol: opts.cloud.protocol
            }
        },
        item: opts.items.map(item => ({
            title: item.title,
            description: item.description,
            pubDate: item.pubDate.toUTCString(),
            guid: item.guid
        }))
    };

    if (opts.hub) {
        rssAttrs['xmlns:atom'] = 'http://www.w3.org/2005/Atom';
        channel['atom:link'] = [
            { $: { rel: 'hub', href: opts.hub } },
            { $: { rel: 'self', href: opts.link } }
        ];
    }

    return new Builder().buildObject({ rss: { $: rssAttrs, channel } });
}

module.exports = { renderCloudFeed };
