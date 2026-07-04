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

// Per https://source.scripting.com/ : <source:cloud> has no attributes —
// its value is a plain URL, the one bit of extra information being the
// scheme (http vs https). It can't represent xml-rpc (the whole point is to
// replace SOAP/XML-RPC with a plain URL), so it always resolves to
// http-post/https-post.
const SOURCE_CLOUD_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:source="https://source.scripting.com/">
    <channel>
        <title>Source Cloud Feed</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>Advertises source:cloud only</description>
        <source:cloud>http://hub.example:5337/pleaseNotify</source:cloud>
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('detects a <source:cloud> element per the source.scripting.com namespace', async() => {
    const result = await parseFeedDiscovery(SOURCE_CLOUD_FEED);

    assert.deepEqual(result.rssCloud, {
        domain: 'hub.example',
        port: 5337,
        path: '/pleaseNotify',
        registerProcedure: '',
        protocol: 'http-post'
    });
});

const SOURCE_CLOUD_HTTPS_DEFAULT_PORT_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:source="https://source.scripting.com/">
    <channel>
        <title>Source Cloud Feed (https, default port)</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>No explicit port in the URL — https implies 443</description>
        <source:cloud>https://hub.example/pleaseNotify</source:cloud>
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('infers https-post and the default 443 port from a bare https:// source:cloud URL', async() => {
    const result = await parseFeedDiscovery(SOURCE_CLOUD_HTTPS_DEFAULT_PORT_FEED);

    assert.deepEqual(result.rssCloud, {
        domain: 'hub.example',
        port: 443,
        path: '/pleaseNotify',
        registerProcedure: '',
        protocol: 'https-post'
    });
});

const BOTH_CLOUD_KINDS_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:src="https://source.scripting.com/">
    <channel>
        <title>Both Cloud Kinds</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>Advertises both cloud and source:cloud</description>
        <cloud domain="old-hub.example" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post" />
        <src:cloud>http://new-hub.example:5337/pleaseNotify</src:cloud>
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('prefers source:cloud (under any bound prefix) over a traditional <cloud> when both are present', async() => {
    const result = await parseFeedDiscovery(BOTH_CLOUD_KINDS_FEED);

    assert.deepEqual(result.rssCloud, {
        domain: 'new-hub.example',
        port: 5337,
        path: '/pleaseNotify',
        registerProcedure: '',
        protocol: 'http-post'
    });
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

const NONSTANDARD_ATOM_PREFIX_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:a="http://www.w3.org/2005/Atom">
    <channel>
        <title>Nonstandard Atom Prefix Feed</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>Hub link under a non-"atom" prefix bound to the Atom namespace</description>
        <a:link rel="hub" href="http://hub.example/websub" />
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('detects a hub link under whichever prefix a feed actually bound to the Atom namespace', async() => {
    const result = await parseFeedDiscovery(NONSTANDARD_ATOM_PREFIX_FEED);

    assert.deepEqual(result.webSub, { hubUrl: 'http://hub.example/websub' });
});

const MIXED_CASE_REL_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>Mixed-case rel Feed</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>Uses rel="Hub" (mixed case)</description>
        <atom:link rel="Hub" href="http://hub.example/websub" />
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

// RFC 8288 §3.3: relation types SHOULD be treated case-insensitively.
test('detects a body-embedded hub link with a mixed-case rel value', async() => {
    const result = await parseFeedDiscovery(MIXED_CASE_REL_FEED);

    assert.deepEqual(result.webSub, { hubUrl: 'http://hub.example/websub' });
});

const UNDECLARED_ATOM_PREFIX_FEED = `<?xml version="1.0"?>
<rss version="2.0">
    <channel>
        <title>Undeclared Atom Prefix Feed</title>
        <link>http://sub.example:9000/rss-01.xml</link>
        <description>Uses atom:link by convention with no xmlns:atom declaration</description>
        <atom:link rel="hub" href="http://hub.example/websub" />
        <item><title>Entry one</title><guid>g0</guid></item>
    </channel>
</rss>`;

test('falls back to the conventional atom: prefix when the namespace is not explicitly bound', async() => {
    const result = await parseFeedDiscovery(UNDECLARED_ATOM_PREFIX_FEED);

    assert.deepEqual(result.webSub, { hubUrl: 'http://hub.example/websub' });
});

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

test('prefers a Link header hub over a body-embedded hub link when both are present', async() => {
    const xml = sampleFeed({ hub: 'http://body-hub.example/websub' });

    const result = await parseFeedDiscovery(xml, {
        linkHeader: '<http://header-hub.example/websub>; rel="hub"'
    });

    assert.deepEqual(result.webSub, { hubUrl: 'http://header-hub.example/websub' });
});

test('detects a rel=self link embedded in the feed body', async() => {
    const result = await parseFeedDiscovery(ATOM_FEED);

    assert.equal(result.selfUrl, 'http://sub.example:9000/atom.xml');
});

test('prefers a Link header self over a body-embedded self link when both are present', async() => {
    const result = await parseFeedDiscovery(ATOM_FEED, {
        linkHeader: '<http://header-self.example/atom.xml>; rel="self"'
    });

    assert.equal(result.selfUrl, 'http://header-self.example/atom.xml');
});

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

test('discoverFeed picks up a hub link from the response\'s Link header', async() => {
    const fetch = async() => ({
        status: 200,
        headers: { get: name => (name === 'link' ? '<http://header-hub.example/websub>; rel="hub"' : null) },
        text: async() => PLAIN_RSS_FEED
    });

    const result = await discoverFeed({ url: 'http://sub.example/plain.xml', fetch });

    assert.deepEqual(result.webSub, { hubUrl: 'http://header-hub.example/websub' });
});

test('discoverFeed tolerates a fetch fixture with no headers.get (no Link header available)', async() => {
    const fetch = async() => ({
        status: 200,
        text: async() => PLAIN_RSS_FEED
    });

    const result = await discoverFeed({ url: 'http://sub.example/plain.xml', fetch });

    assert.equal(result.webSub, null);
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
