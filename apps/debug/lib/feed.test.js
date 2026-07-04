const { Parser } = require('xml2js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCloudFeed } = require('./feed');

function reparse(xml) {
    return new Parser({ explicitArray: false }).parseStringPromise(xml);
}

const CLOUD = {
    domain: 'localhost',
    port: 5337,
    path: '/RPC2',
    registerProcedure: 'rssCloud.pleaseNotify',
    protocol: 'xml-rpc'
};

test('renders a channel with the cloud element and an item', async() => {
    const xml = renderCloudFeed({
        title: 'Test Feed',
        link: 'http://sub.example:9000/rss-01.xml',
        description: 'Test feed for rssCloud',
        cloud: CLOUD,
        items: [
            {
                title: 'Update one',
                description: 'first',
                pubDate: new Date('2026-01-02T03:04:05Z'),
                guid: 'rss-01-0'
            }
        ]
    });

    const { rss } = await reparse(xml);
    assert.equal(rss.$.version, '2.0');
    assert.equal(rss.channel.title, 'Test Feed');
    assert.equal(rss.channel.link, 'http://sub.example:9000/rss-01.xml');
    assert.deepEqual(rss.channel.cloud.$, {
        domain: 'localhost',
        port: '5337',
        path: '/RPC2',
        registerProcedure: 'rssCloud.pleaseNotify',
        protocol: 'xml-rpc'
    });
    assert.equal(rss.channel.item.title, 'Update one');
    assert.equal(rss.channel.item.guid, 'rss-01-0');
    assert.equal(rss.channel.item.pubDate, 'Fri, 02 Jan 2026 03:04:05 GMT');
});

test('advertises a WebSub hub via atom:link rel=hub and rel=self', async() => {
    const xml = renderCloudFeed({
        title: 'Test Feed',
        link: 'http://sub.example:9000/rss-01.xml',
        description: 'Test feed for rssCloud',
        cloud: CLOUD,
        hub: 'http://localhost:5337/websub',
        items: [
            {
                title: 'Update one',
                description: 'first',
                pubDate: new Date('2026-01-02T03:04:05Z'),
                guid: 'rss-01-0'
            }
        ]
    });

    const { rss } = await reparse(xml);
    assert.equal(rss.$['xmlns:atom'], 'http://www.w3.org/2005/Atom');
    assert.deepEqual(
        rss.channel['atom:link'].map(link => link.$),
        [
            { rel: 'hub', href: 'http://localhost:5337/websub' },
            { rel: 'self', href: 'http://sub.example:9000/rss-01.xml' }
        ]
    );
    // the rssCloud <cloud> element is still emitted alongside the hub links
    assert.equal(rss.channel.cloud.$.protocol, 'xml-rpc');
});

test('omits the atom namespace and links when no hub is given', async() => {
    const xml = renderCloudFeed({
        title: 'Test Feed',
        link: 'http://sub.example:9000/rss-01.xml',
        description: 'Test feed for rssCloud',
        cloud: CLOUD,
        items: [
            {
                title: 'Update one',
                description: 'first',
                pubDate: new Date('2026-01-02T03:04:05Z'),
                guid: 'rss-01-0'
            }
        ]
    });

    const { rss } = await reparse(xml);
    assert.equal(rss.$['xmlns:atom'], undefined);
    assert.equal(rss.channel['atom:link'], undefined);
});

test('renders multiple items in order', async() => {
    const xml = renderCloudFeed({
        title: 'Test Feed',
        link: 'http://sub.example:9000/rss-01.xml',
        description: 'Test feed for rssCloud',
        cloud: CLOUD,
        items: [
            {
                title: 'one',
                description: 'a',
                pubDate: new Date('2026-01-02T00:00:00Z'),
                guid: 'g0'
            },
            {
                title: 'two',
                description: 'b',
                pubDate: new Date('2026-01-03T00:00:00Z'),
                guid: 'g1'
            }
        ]
    });

    const { rss } = await reparse(xml);
    assert.deepEqual(
        rss.channel.item.map(i => i.title),
        ['one', 'two']
    );
});
