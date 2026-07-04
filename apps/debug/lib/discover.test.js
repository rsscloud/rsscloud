const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCloudFeed } = require('./feed');
const { parseFeedDiscovery, discoverFeed } = require('./discover');

const CLOUD = {
    domain: 'localhost',
    port: 5337,
    path: '/RPC2',
    registerProcedure: 'rssCloud.pleaseNotify',
    protocol: 'xml-rpc'
};

function sampleFeed(opts = {}) {
    return renderCloudFeed({
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
        ],
        ...opts
    });
}

test('detects the <cloud> element rendered by renderCloudFeed', async() => {
    const xml = sampleFeed();

    const result = await parseFeedDiscovery(xml);

    assert.deepEqual(result.rssCloud, CLOUD);
    assert.equal(result.webSub, null);
});

test('detects both <cloud> and an atom:link rel=hub when a feed advertises both', async() => {
    const xml = sampleFeed({ hub: 'http://localhost:5337/websub' });

    const result = await parseFeedDiscovery(xml);

    assert.deepEqual(result.rssCloud, CLOUD);
    assert.deepEqual(result.webSub, { hubUrl: 'http://localhost:5337/websub' });
});

const ATOM_FEED = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Test Feed</title>
    <link rel="self" href="http://sub.example:9000/atom.xml" />
    <link rel="hub" href="http://hub.example/websub" />
    <entry>
        <title>Entry one</title>
        <id>urn:uuid:1</id>
    </entry>
</feed>`;

test('detects a WebSub hub link in an Atom feed with no <cloud> element', async() => {
    const result = await parseFeedDiscovery(ATOM_FEED);

    assert.equal(result.rssCloud, null);
    assert.deepEqual(result.webSub, { hubUrl: 'http://hub.example/websub' });
});

const PLAIN_RSS_FEED = `<?xml version="1.0"?>
<rss version="2.0">
    <channel>
        <title>Plain Feed</title>
        <link>http://sub.example:9000/plain.xml</link>
        <description>No cloud, no hub</description>
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('reports null for both when a feed advertises neither protocol', async() => {
    const result = await parseFeedDiscovery(PLAIN_RSS_FEED);

    assert.equal(result.rssCloud, null);
    assert.equal(result.webSub, null);
});

test('reports an error instead of throwing when the body is not parseable XML', async() => {
    const result = await parseFeedDiscovery('<not>xml<');

    assert.equal(result.rssCloud, null);
    assert.equal(result.webSub, null);
    assert.equal(result.error, 'not parseable as XML');
});

test('discoverFeed propagates a fetch rejection (e.g. an SSRF block) to the caller', async() => {
    const fetch = async() => {
        throw new Error('blocked');
    };

    await assert.rejects(
        () => discoverFeed({ url: 'http://blocked.example/rss', fetch }),
        /blocked/
    );
});

test('discoverFeed short-circuits on a non-2xx response without parsing the body', async() => {
    let textCalled = false;
    const fetch = async() => ({
        status: 404,
        text: async() => {
            textCalled = true;
            return 'Not Found';
        }
    });

    const result = await discoverFeed({
        url: 'http://sub.example/missing.xml',
        fetch
    });

    assert.equal(result.rssCloud, null);
    assert.equal(result.webSub, null);
    assert.equal(result.error, 'fetch failed: 404');
    assert.equal(textCalled, false);
});
