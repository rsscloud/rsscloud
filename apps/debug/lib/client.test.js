const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMethodCall } = require('@rsscloud/xml-rpc');
const { createRssCloudClient } = require('./client');

function fakeFetch(status = 200, responseBody = 'OK') {
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

test('ping posts the feed URL to /ping by default', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    const res = await client.ping({ feedUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].url, 'http://hub.example:5337/ping');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(
        calls[0].init.headers['Content-Type'],
        'application/x-www-form-urlencoded'
    );
    assert.equal(form(calls[0].init).get('url'), 'https://feed.example/rss');
    assert.deepEqual(res, { status: 200, body: 'OK' });
});

test('ping posts to an explicit url override instead of serverUrl + /ping', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.ping({
        feedUrl: 'https://feed.example/rss',
        url: 'http://other.example/custom-ping'
    });

    assert.equal(calls[0].url, 'http://other.example/custom-ping');
});

test('ping posts to /RPC2 over xml-rpc', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.ping({
        feedUrl: 'https://feed.example/rss',
        transport: 'xml-rpc'
    });

    assert.equal(calls[0].url, 'http://hub.example:5337/RPC2');
    assert.equal(calls[0].init.headers['Content-Type'], 'text/xml');
    const call = await parseMethodCall(calls[0].init.body);
    assert.equal(call.methodName, 'rssCloud.ping');
    assert.deepEqual(call.params, ['https://feed.example/rss']);
});

test('ping sets the Accept header to application/json when accept is json', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.ping({ feedUrl: 'https://feed.example/rss', accept: 'json' });

    assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('ping sets the Accept header to application/xml when accept is xml (not text/xml — the server negotiates on the mime type, not the XML-RPC Content-Type convention)', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.ping({ feedUrl: 'https://feed.example/rss', accept: 'xml' });

    assert.equal(calls[0].init.headers.Accept, 'application/xml');
});

test('ping sends no Accept override when accept is not given', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.ping({ feedUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].init.headers.Accept, undefined);
});

test('pleaseNotify over http-post sends the form with an explicit domain', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { domain: 'sub.example', port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss'
    });

    assert.equal(calls[0].url, 'http://hub.example:5337/pleaseNotify');
    const body = form(calls[0].init);
    assert.equal(body.get('port'), '9000');
    assert.equal(body.get('path'), '/notify');
    assert.equal(body.get('protocol'), 'http-post');
    assert.equal(body.get('url1'), 'https://feed.example/rss');
    assert.equal(body.get('domain'), 'sub.example');
});

test('pleaseNotify over http-post omits domain when none is given', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss'
    });

    assert.equal(form(calls[0].init).has('domain'), false);
});

test('pleaseNotify posts to an explicit url override instead of serverUrl + /pleaseNotify', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss',
        url: 'http://other.example/custom-subscribe'
    });

    assert.equal(calls[0].url, 'http://other.example/custom-subscribe');
});

test('pleaseNotify sets the Accept header to application/json when accept is json', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss',
        accept: 'json'
    });

    assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('pleaseNotify sets the Accept header to application/xml when accept is xml', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss',
        accept: 'xml'
    });

    assert.equal(calls[0].init.headers.Accept, 'application/xml');
});

test('pleaseNotify sends no Accept override when accept is not given', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'http-post',
        callback: { port: 9000, path: '/notify' },
        feedUrl: 'https://feed.example/rss'
    });

    assert.equal(calls[0].init.headers.Accept, undefined);
});

test('pleaseNotify over xml-rpc sends the six params', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'xml-rpc',
        callback: { domain: 'sub.example', port: 9000, path: '/RPC2' },
        feedUrl: 'https://feed.example/rss'
    });

    assert.equal(calls[0].url, 'http://hub.example:5337/RPC2');
    const call = await parseMethodCall(calls[0].init.body);
    assert.equal(call.methodName, 'rssCloud.pleaseNotify');
    assert.deepEqual(call.params, [
        'rssCloud.notify',
        9000,
        '/RPC2',
        'xml-rpc',
        ['https://feed.example/rss'],
        'sub.example'
    ]);
});

test('pleaseNotify over xml-rpc sends an empty domain when none is given', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337',
        fetch: fn
    });

    await client.pleaseNotify({
        protocol: 'xml-rpc',
        callback: { port: 9000, path: '/RPC2' },
        feedUrl: 'https://feed.example/rss'
    });

    const call = await parseMethodCall(calls[0].init.body);
    assert.equal(call.params[5], '');
});

test('strips a trailing slash from the server URL', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337/',
        fetch: fn
    });

    await client.ping({ feedUrl: 'https://feed.example/rss' });

    assert.equal(calls[0].url, 'http://hub.example:5337/ping');
});

test('serverUrl is optional when every call passes an explicit url', async() => {
    const { fn, calls } = fakeFetch();
    const client = createRssCloudClient({ fetch: fn });

    await client.ping({
        feedUrl: 'https://feed.example/rss',
        url: 'http://other.example/custom-ping'
    });

    assert.equal(calls[0].url, 'http://other.example/custom-ping');
});

test('defaults to the global fetch when none is injected', () => {
    const client = createRssCloudClient({
        serverUrl: 'http://hub.example:5337'
    });

    assert.equal(typeof client.ping, 'function');
    assert.equal(typeof client.pleaseNotify, 'function');
});
