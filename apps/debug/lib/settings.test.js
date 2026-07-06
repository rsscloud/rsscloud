const test = require('node:test');
const assert = require('node:assert/strict');
const {
    computeDefaultSettings,
    selfHostedPrefixes,
    feedNameFromSelfHostedUrl,
    isSelfHostedFeedUrl,
    applyDiscoveryToSettings
} = require('./settings');

test('computeDefaultSettings builds the self-hosted feed URL from publicUrl/session', () => {
    const settings = computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'http://localhost:9000',
        hubServerUrl: 'http://localhost:5337'
    });

    assert.equal(settings.feedUrl, 'http://localhost:9000/s/abc-123/rss.xml');
});

test('computeDefaultSettings builds the self-hosted feed URL using publicUrl\'s own scheme, not a hardcoded http', () => {
    const settings = computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'https://debug.rsscloud.io',
        hubServerUrl: 'http://localhost:5337'
    });

    assert.equal(settings.feedUrl, 'https://debug.rsscloud.io/s/abc-123/rss.xml');
});

test('computeDefaultSettings defaults rssCloud to http-post against the configured hub', () => {
    const settings = computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'http://localhost:9000',
        hubServerUrl: 'http://localhost:5337'
    });

    assert.deepEqual(settings.rssCloud, {
        disabled: false,
        protocol: 'http-post',
        accepts: 'xml',
        pingUrl: 'http://localhost:5337/ping',
        subscribeUrl: 'http://localhost:5337/pleaseNotify',
        rpcUrl: 'http://localhost:5337/RPC2'
    });
});

test('computeDefaultSettings defaults webSub to enabled with a blank lease/secret', () => {
    const settings = computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'http://localhost:9000',
        hubServerUrl: 'http://localhost:5337'
    });

    assert.deepEqual(settings.webSub, {
        disabled: false,
        hubUrl: 'http://localhost:5337/websub',
        leaseSeconds: '',
        secret: ''
    });
});

test('computeDefaultSettings strips a trailing slash from the hub server URL', () => {
    const settings = computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'http://localhost:9000',
        hubServerUrl: 'http://localhost:5337/'
    });

    assert.equal(settings.rssCloud.pingUrl, 'http://localhost:5337/ping');
});

test('selfHostedPrefixes lists both scheme prefixes for this session, using publicUrl\'s host', () => {
    const prefixes = selfHostedPrefixes({
        publicUrl: 'http://localhost:9000',
        sessionId: 'abc-123'
    });

    assert.deepEqual(prefixes, [
        'http://localhost:9000/s/abc-123/',
        'https://localhost:9000/s/abc-123/'
    ]);
});

test('selfHostedPrefixes derives both scheme prefixes from an https publicUrl, still matching an http-typed feed URL', () => {
    const prefixes = selfHostedPrefixes({
        publicUrl: 'https://debug.rsscloud.io',
        sessionId: 'abc-123'
    });

    assert.deepEqual(prefixes, [
        'https://debug.rsscloud.io/s/abc-123/',
        'http://debug.rsscloud.io/s/abc-123/'
    ]);
});

const ctx = { publicUrl: 'http://localhost:9000', sessionId: 'abc-123' };

test('feedNameFromSelfHostedUrl extracts the feed name from a self-hosted URL', () => {
    const name = feedNameFromSelfHostedUrl(
        'http://localhost:9000/s/abc-123/rss.xml',
        ctx
    );

    assert.equal(name, 'rss.xml');
});

test('feedNameFromSelfHostedUrl returns null for an external URL', () => {
    const name = feedNameFromSelfHostedUrl(
        'https://example.com/feed.xml',
        ctx
    );

    assert.equal(name, null);
});

test('isSelfHostedFeedUrl is true for this session\'s own feed URL', () => {
    assert.equal(
        isSelfHostedFeedUrl('http://localhost:9000/s/abc-123/rss.xml', ctx),
        true
    );
});

test('isSelfHostedFeedUrl is false for an external feed URL', () => {
    assert.equal(
        isSelfHostedFeedUrl('https://example.com/feed.xml', ctx),
        false
    );
});

function baseSettings() {
    return computeDefaultSettings({
        sessionId: 'abc-123',
        publicUrl: 'http://localhost:9000',
        hubServerUrl: 'http://localhost:5337'
    });
}

test('applyDiscoveryToSettings updates the rssCloud group from a discovered http-post <cloud>', () => {
    const next = applyDiscoveryToSettings(baseSettings(), {
        rssCloud: {
            domain: 'other-hub.example',
            port: 80,
            path: '/pleaseNotify',
            registerProcedure: '',
            protocol: 'http-post'
        },
        webSub: null
    });

    assert.equal(next.rssCloud.protocol, 'http-post');
    assert.equal(next.rssCloud.subscribeUrl, 'http://other-hub.example:80/pleaseNotify');
    assert.equal(next.rssCloud.pingUrl, 'http://other-hub.example:80/ping');
});

test('applyDiscoveryToSettings disables webSub when a feed advertises rssCloud but no WebSub hub', () => {
    const next = applyDiscoveryToSettings(baseSettings(), {
        rssCloud: {
            domain: 'other-hub.example',
            port: 80,
            path: '/pleaseNotify',
            registerProcedure: '',
            protocol: 'http-post'
        },
        webSub: null
    });

    assert.equal(next.webSub.disabled, true);
});

test('applyDiscoveryToSettings re-enables a disabled rssCloud when discovery finds a recognized protocol', () => {
    const settings = baseSettings();
    settings.rssCloud.disabled = true;

    const next = applyDiscoveryToSettings(settings, {
        rssCloud: {
            domain: 'other-hub.example',
            port: 80,
            path: '/pleaseNotify',
            registerProcedure: '',
            protocol: 'http-post'
        },
        webSub: null
    });

    assert.equal(next.rssCloud.disabled, false);
});

test('applyDiscoveryToSettings sets the single rpcUrl for a discovered xml-rpc <cloud>, not ping/subscribe', () => {
    const next = applyDiscoveryToSettings(baseSettings(), {
        rssCloud: {
            domain: 'other-hub.example',
            port: 5337,
            path: '/RPC2',
            registerProcedure: 'rssCloud.pleaseNotify',
            protocol: 'xml-rpc'
        },
        webSub: null
    });

    assert.equal(next.rssCloud.protocol, 'xml-rpc');
    assert.equal(next.rssCloud.rpcUrl, 'http://other-hub.example:5337/RPC2');
});

test('applyDiscoveryToSettings picks https when the discovered protocol is https-post', () => {
    const next = applyDiscoveryToSettings(baseSettings(), {
        rssCloud: {
            domain: 'secure-hub.example',
            port: 443,
            path: '/pleaseNotify',
            registerProcedure: '',
            protocol: 'https-post'
        },
        webSub: null
    });

    assert.equal(next.rssCloud.subscribeUrl, 'https://secure-hub.example:443/pleaseNotify');
    assert.equal(next.rssCloud.pingUrl, 'https://secure-hub.example:443/ping');
});

test('applyDiscoveryToSettings enables webSub and sets its hub URL from discovery', () => {
    const settings = baseSettings();
    settings.webSub.disabled = true;

    const next = applyDiscoveryToSettings(settings, {
        rssCloud: null,
        webSub: { hubUrl: 'http://discovered-hub.example/websub' }
    });

    assert.equal(next.webSub.disabled, false);
    assert.equal(next.webSub.hubUrl, 'http://discovered-hub.example/websub');
});

test('applyDiscoveryToSettings overrides feedUrl with a discovered rel=self canonical URL', () => {
    const next = applyDiscoveryToSettings(baseSettings(), {
        rssCloud: null,
        webSub: null,
        selfUrl: 'https://canonical.example/feed.xml'
    });

    assert.equal(next.feedUrl, 'https://canonical.example/feed.xml');
});

test('applyDiscoveryToSettings disables rssCloud and webSub when a successful discovery found neither', () => {
    const settings = baseSettings();

    const next = applyDiscoveryToSettings(settings, { rssCloud: null, webSub: null });

    assert.equal(next.rssCloud.disabled, true);
    assert.equal(next.webSub.disabled, true);
    // Only the disabled flag flips — a feed's discovered URLs aren't erased
    // just because a *different* re-discovery came back empty.
    assert.equal(next.rssCloud.subscribeUrl, settings.rssCloud.subscribeUrl);
    assert.equal(next.webSub.hubUrl, settings.webSub.hubUrl);
});
