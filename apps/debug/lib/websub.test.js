const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebSubClient, readVerification } = require('./websub');

function fakeFetch(status = 202, responseBody = '') {
    const calls = [];
    const fn = async(url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return { status, text: async() => responseBody };
    };
    return { fn, calls };
}

function form(init) {
    return new URLSearchParams(init.body);
}

test('subscribe posts the hub.* subscribe form to /websub', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    const res = await client.subscribe({
        callbackUrl: 'http://sub.example:9000/websub-callback',
        topicUrl: 'https://feed.example/rss'
    });

    assert.equal(calls[0].url, 'http://hub.example:5337/websub');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(
        calls[0].init.headers['Content-Type'],
        'application/x-www-form-urlencoded'
    );
    const body = form(calls[0].init);
    assert.equal(body.get('hub.mode'), 'subscribe');
    assert.equal(
        body.get('hub.callback'),
        'http://sub.example:9000/websub-callback'
    );
    assert.equal(body.get('hub.topic'), 'https://feed.example/rss');
    assert.equal(body.get('hub.verify'), 'async');
    assert.deepEqual(res, { status: 202, body: '' });
});

test('subscribe carries hub.lease_seconds and hub.secret when supplied', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.subscribe({
        callbackUrl: 'http://sub.example:9000/websub-callback',
        topicUrl: 'https://feed.example/rss',
        leaseSeconds: 3600,
        secret: 's3cr3t'
    });

    const body = form(calls[0].init);
    assert.equal(body.get('hub.lease_seconds'), '3600');
    assert.equal(body.get('hub.secret'), 's3cr3t');
});

test('subscribe omits hub.lease_seconds and hub.secret when not supplied', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.subscribe({
        callbackUrl: 'http://sub.example:9000/websub-callback',
        topicUrl: 'https://feed.example/rss'
    });

    const body = form(calls[0].init);
    assert.equal(body.has('hub.lease_seconds'), false);
    assert.equal(body.has('hub.secret'), false);
});

test('publish posts hub.mode=publish with the topic as hub.url', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    const res = await client.publish({ topicUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].url, 'http://hub.example:5337/websub');
    assert.equal(calls[0].init.method, 'POST');
    const body = form(calls[0].init);
    assert.equal(body.get('hub.mode'), 'publish');
    assert.equal(body.get('hub.url'), 'https://feed.example/rss');
    assert.deepEqual(res, { status: 202, body: '' });
});

test('unsubscribe posts hub.mode=unsubscribe with callback and topic', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.unsubscribe({
        callbackUrl: 'http://sub.example:9000/websub-callback',
        topicUrl: 'https://feed.example/rss'
    });

    const body = form(calls[0].init);
    assert.equal(body.get('hub.mode'), 'unsubscribe');
    assert.equal(
        body.get('hub.callback'),
        'http://sub.example:9000/websub-callback'
    );
    assert.equal(body.get('hub.topic'), 'https://feed.example/rss');
    assert.equal(body.get('hub.verify'), 'async');
});

test('subscribe reports the exact outgoing request via onRequest before the fetch resolves', async() => {
    const { fn, calls } = fakeFetch();
    const seen = [];
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn,
        onRequest: request => seen.push(request)
    });

    await client.subscribe({
        callbackUrl: 'http://sub.example:9000/websub-callback',
        topicUrl: 'https://feed.example/rss',
        secret: 's3cr3t'
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, 'http://hub.example:5337/websub');
    assert.equal(
        seen[0].headers['Content-Type'],
        'application/x-www-form-urlencoded'
    );
    // The reported body is exactly what the fetch call actually sent — same
    // string, not a reconstruction — so the log can never drift from reality.
    assert.equal(seen[0].body, calls[0].init.body);
    assert.match(seen[0].body, /hub\.secret=s3cr3t/);
});

test('targets a configurable hub path', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337',
        path: '/hub',
        fetch: fn
    });

    await client.publish({ topicUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].url, 'http://hub.example:5337/hub');
});

test('strips a trailing slash from the server URL', async() => {
    const { fn, calls } = fakeFetch();
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337/',
        fetch: fn
    });

    await client.publish({ topicUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].url, 'http://hub.example:5337/websub');
});

test('defaults to the global fetch when none is injected', () => {
    const client = createWebSubClient({
        serverUrl: 'http://hub.example:5337'
    });

    assert.equal(typeof client.subscribe, 'function');
    assert.equal(typeof client.unsubscribe, 'function');
    assert.equal(typeof client.publish, 'function');
});

test('readVerification parses a subscribe verification GET', () => {
    const parsed = readVerification({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://feed.example/rss',
        'hub.challenge': 'abc123',
        'hub.lease_seconds': '3600'
    });

    assert.deepEqual(parsed, {
        mode: 'subscribe',
        topic: 'https://feed.example/rss',
        challenge: 'abc123',
        leaseSeconds: 3600
    });
});

test('readVerification omits leaseSeconds for an unsubscribe verification', () => {
    const parsed = readVerification({
        'hub.mode': 'unsubscribe',
        'hub.topic': 'https://feed.example/rss',
        'hub.challenge': 'xyz789'
    });

    assert.deepEqual(parsed, {
        mode: 'unsubscribe',
        topic: 'https://feed.example/rss',
        challenge: 'xyz789'
    });
});

test('readVerification returns null when the query carries no challenge', () => {
    assert.equal(readVerification({ 'hub.mode': 'subscribe' }), null);
    assert.equal(readVerification({}), null);
});
