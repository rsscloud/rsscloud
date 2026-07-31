const test = require('node:test');
const assert = require('node:assert/strict');
const xml2js = require('xml2js');
const {
    createRssCloudCore,
    createInMemoryStore,
    resolveConfig
} = require('@rsscloud/core');
const config = require('../config');
const { createFeedsOpml } = require('./feeds-opml');

// A fresh in-memory-backed core + the service under it, isolated per test.
function setup() {
    const core = createRssCloudCore({
        store: createInMemoryStore(),
        plugins: [],
        config: resolveConfig({})
    });
    return { core, ...createFeedsOpml({ core }) };
}

function makeResource(feedUrl, feed) {
    const resource = {
        url: feedUrl,
        lastHash: '',
        lastSize: 0,
        ctChecks: 0,
        whenLastCheck: new Date(0),
        ctUpdates: 0,
        whenLastUpdate: new Date(0)
    };
    if (feed) resource.feed = feed;
    return resource;
}

function makeSubscription(overrides = {}) {
    return {
        url: 'http://sub.example.com/notify',
        protocol: 'http-post',
        ctUpdates: 0,
        ctErrors: 0,
        ctConsecutiveErrors: 0,
        whenCreated: new Date(),
        whenLastUpdate: null,
        whenLastError: null,
        whenExpires: new Date(Date.now() + 86400000),
        ...overrides
    };
}

async function parseOpml(xml) {
    return new xml2js.Parser().parseStringPromise(xml);
}

test('generateOpml renders a feed with full metadata as an outline', async() => {
    const { core, generateOpml } = setup();
    await core.seedResource('https://a.example.com/feed.xml', makeResource('https://a.example.com/feed.xml', {
        type: 'atom',
        title: 'Alpha',
        description: 'The Alpha feed',
        htmlUrl: 'https://a.example.com/',
        language: 'en-us'
    }));

    const result = await parseOpml(await generateOpml());

    assert.equal(result.opml.$.version, '2.0');
    assert.equal(
        result.opml.head[0].title[0],
        `rssCloud Server feeds (${config.domain})`
    );
    const dateCreated = result.opml.head[0].dateCreated[0];
    assert.ok(!Number.isNaN(Date.parse(dateCreated)));

    const outlines = result.opml.body[0].outline;
    assert.equal(outlines.length, 1);
    assert.deepEqual(outlines[0].$, {
        type: 'atom',
        text: 'Alpha',
        xmlUrl: 'https://a.example.com/feed.xml',
        title: 'Alpha',
        description: 'The Alpha feed',
        htmlUrl: 'https://a.example.com/',
        language: 'en-us'
    });
});

test('generateOpml sorts case-insensitively and falls back to the feed URL', async() => {
    const { core, generateOpml } = setup();
    // Untitled feed: text falls back to the URL, type defaults to rss, and no
    // title/description/htmlUrl/language attributes are emitted.
    await core.seedResource('https://apple.example.com/feed.xml', makeResource('https://apple.example.com/feed.xml'));
    await core.seedResource('https://b.example.com/feed.xml', makeResource('https://b.example.com/feed.xml', { title: 'banana' }));
    await core.seedResource('https://z.example.com/feed.xml', makeResource('https://z.example.com/feed.xml', { title: 'Cherry' }));

    const result = await parseOpml(await generateOpml());
    const outlines = result.opml.body[0].outline;

    assert.deepEqual(
        outlines.map(o => o.$.text),
        ['banana', 'Cherry', 'https://apple.example.com/feed.xml']
    );
    assert.deepEqual(outlines[2].$, {
        type: 'rss',
        text: 'https://apple.example.com/feed.xml',
        xmlUrl: 'https://apple.example.com/feed.xml'
    });
});

// OPML 2.0, "Inclusion": an outline pointing at another OPML file is
// type="include" with a `url` attribute — not a type="rss" outline with an
// `xmlUrl`, which would tell an aggregator to subscribe to the list as a feed.
test('generateOpml renders an OPML subscription list as an inclusion', async() => {
    const { core, generateOpml } = setup();
    await core.seedResource('https://iheartrss.com/subscriptions.opml', makeResource('https://iheartrss.com/subscriptions.opml', {
        type: 'opml',
        title: 'I ♥ RSS'
    }));

    const result = await parseOpml(await generateOpml());
    const outlines = result.opml.body[0].outline;

    assert.equal(outlines.length, 1);
    assert.deepEqual(outlines[0].$, {
        type: 'include',
        text: 'I ♥ RSS',
        title: 'I ♥ RSS',
        url: 'https://iheartrss.com/subscriptions.opml'
    });
});

test('generateOpml lists a subscribed feed that was never pinged', async() => {
    const { core, generateOpml } = setup();
    await core.seedSubscriptions('https://new.example.com/feed.xml', [makeSubscription()]);

    const result = await parseOpml(await generateOpml());
    const outlines = result.opml.body[0].outline;

    assert.equal(outlines.length, 1);
    assert.deepEqual(outlines[0].$, {
        type: 'rss',
        text: 'https://new.example.com/feed.xml',
        xmlUrl: 'https://new.example.com/feed.xml'
    });
});
