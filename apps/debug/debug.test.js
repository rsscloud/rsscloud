const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createApp } = require('./debug');
const { createSessionStore } = require('./lib/session-store');
const request = require('supertest');

function listen(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function waitForOpen(ws) {
    return new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
}

async function waitUntil(predicate, timeoutMs = 2000) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitUntil timed out');
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

// The traffic log is purely live (no server-side storage) — to assert on
// what an action broadcasts, connect a real WebSocket to the session's log
// feed on a real listening server, same pattern as session-sockets.test.js.
async function startTestServer(app) {
    const server = http.createServer(app);
    app.locals.attachSessionSockets(server);
    const port = await listen(server);
    return {
        request: request(server),
        async openLogSocket(sessionId) {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${sessionId}/logs`);
            const received = [];
            ws.on('message', data => received.push(JSON.parse(data.toString())));
            await waitForOpen(ws);
            return { ws, received };
        },
        close() {
            return new Promise(resolve => server.close(resolve));
        }
    };
}

test('GET /s/:id/notify 404s once the session has been idle past the callback threshold', async() => {
    let currentTime = 1000;
    const sessionStore = createSessionStore({ now: () => currentTime });
    const app = createApp({ sessionStore, sessionCallbackIdleMs: 500 });

    // Visiting the UI creates the session (lazy getOrCreate), starting its
    // idle clock at currentTime.
    await request(app).get('/s/idle-session');

    currentTime += 501;

    const notifyRes = await request(app)
        .get('/s/idle-session/notify')
        .query({ challenge: 'abc' });
    assert.equal(notifyRes.status, 404);

    const homeRes = await request(app).get('/s/idle-session');
    assert.equal(homeRes.status, 200);
});

test('GET /s/:id/notify does not 404 past the callback threshold while a socklog socket is connected', async() => {
    let currentTime = 1000;
    const sessionStore = createSessionStore({ now: () => currentTime });
    const app = createApp({ sessionStore, sessionCallbackIdleMs: 500 });

    await request(app).get('/s/watched-session');
    // Simulate a page left open: a live socklog-viewer connection attached
    // to the session, same as session-sockets.js tracks on a real one.
    sessionStore.get('watched-session').sockets.add({
        readyState: 1,
        OPEN: 1,
        send: () => {}
    });

    currentTime += 501;

    const notifyRes = await request(app)
        .get('/s/watched-session/notify')
        .query({ challenge: 'abc' });

    assert.equal(notifyRes.status, 200);
    assert.equal(notifyRes.text, 'abc');
});

test('an outbound action refreshes the idle clock, keeping callback routes live', async() => {
    let currentTime = 1000;
    const sessionStore = createSessionStore({ now: () => currentTime });
    const fetch = async() => ({ status: 200, text: async() => 'ok' });
    const app = createApp({ sessionStore, fetch, sessionCallbackIdleMs: 500 });

    await request(app).get('/s/active-session');

    currentTime += 400;
    await request(app)
        .post('/s/active-session/actions/rsscloud-ping')
        .send({});

    // Past the threshold from session creation, but not from the ping above.
    currentTime += 400;

    const notifyRes = await request(app)
        .get('/s/active-session/notify')
        .query({ challenge: 'abc' });

    assert.equal(notifyRes.status, 200);
    assert.equal(notifyRes.text, 'abc');
});

test('a session evicted by the GC sweep is transparently recreated on the next visit', async() => {
    let currentTime = 1000;
    const sessionStore = createSessionStore({ now: () => currentTime });
    const app = createApp({ sessionStore });

    await request(app).get('/s/gc-session');
    assert.equal(sessionStore.size(), 1);

    currentTime += 86400001; // past the 24h GC default
    sessionStore.sweep(86400000);
    assert.equal(sessionStore.size(), 0);

    const res = await request(app).get('/s/gc-session');
    assert.equal(res.status, 200);
    assert.equal(sessionStore.size(), 1);
});

test('GET / redirects to a fresh /s/<uuid> session URL', async() => {
    const app = createApp();

    const res = await request(app).get('/');

    assert.equal(res.status, 302);
    assert.match(
        res.headers.location,
        /^\/s\/[0-9a-f-]{36}$/
    );
});

test('GET /s/:id 200s for a session id never referenced before', async() => {
    const app = createApp();

    const res = await request(app).get('/s/never-seen-before');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /html/);
});

test('GET /s/:id embeds a socklog-viewer pointed at this session\'s WS log feed', async() => {
    const app = createApp();

    const res = await request(app).get('/s/my-log-session');

    assert.match(
        res.text,
        /<socklog-viewer[^>]*url=['"]ws:\/\/[^'"]*\/s\/my-log-session\/logs['"]/
    );
});

test('GET /s/:id uses wss:// for the WS log feed when behind an HTTPS-terminating proxy', async() => {
    const app = createApp();

    const res = await request(app)
        .get('/s/proxied-https-session')
        .set('X-Forwarded-Proto', 'https');

    assert.match(
        res.text,
        /<socklog-viewer[^>]*url=['"]wss:\/\/[^'"]*\/s\/proxied-https-session\/logs['"]/
    );
});

test('GET /s/:id renders the session id on <body> and a settings gear icon link', async() => {
    const app = createApp();

    const res = await request(app).get('/s/my-ui-session');

    assert.match(res.text, /<body[^>]*data-session-id=['"]my-ui-session['"]/);
    assert.match(res.text, /<a[^>]*href=['"]\/s\/my-ui-session\/settings['"][^>]*>/);
});

test('GET /s/:id shows an Update Feed button and last-updated label for a self-hosted feed', async() => {
    const app = createApp();

    const res = await request(app).get('/s/self-hosted-session');

    assert.match(res.text, /<button[^>]*id=['"]updateFeedButton['"]/);
    assert.match(res.text, /Last updated/);
});

test('GET /s/:id shows the self-hosted feed\'s own URL alongside the Update Feed button', async() => {
    const app = createApp();

    const res = await request(app).get('/s/self-hosted-url-session');

    assert.match(res.text, /http:\/\/localhost:9000\/s\/self-hosted-url-session\/rss\.xml/);
});

test('GET /s/:id shows the read-only feed URL, no Update Feed button, for a remote feed', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'remote-feed-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.feedUrl = 'https://example.com/feed.xml';

    const res = await request(app).get(`/s/${sessionId}`);

    assert.doesNotMatch(res.text, /id=['"]updateFeedButton['"]/);
    assert.match(res.text, /https:\/\/example\.com\/feed\.xml/);
});

test('GET /s/:id omits the rssCloud row entirely when rssCloud is disabled', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-disabled-row-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.disabled = true;

    const res = await request(app).get(`/s/${sessionId}`);

    assert.doesNotMatch(res.text, /id=['"]rsscloudSubscribeButton['"]/);
    assert.doesNotMatch(res.text, /id=['"]rsscloudPingButton['"]/);
});

test('GET /s/:id hides just the Ping button when rssCloud has a subscribe URL but no ping URL', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'no-ping-row-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.pingUrl = '';

    const res = await request(app).get(`/s/${sessionId}`);

    assert.match(res.text, /id=['"]rsscloudSubscribeButton['"]/);
    assert.doesNotMatch(res.text, /id=['"]rsscloudPingButton['"]/);
});

test('GET /s/:id always shows Ping for xml-rpc, which has no separate ping URL concept', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'xmlrpc-ping-row-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.protocol = 'xml-rpc';

    const res = await request(app).get(`/s/${sessionId}`);

    assert.match(res.text, /id=['"]rsscloudPingButton['"]/);
});

test('GET /s/:id omits the WebSub row entirely when webSub is disabled', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'websub-disabled-row-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.disabled = true;

    const res = await request(app).get(`/s/${sessionId}`);

    assert.doesNotMatch(res.text, /id=['"]websubSubscribeButton['"]/);
    assert.doesNotMatch(res.text, /id=['"]websubUnsubscribeButton['"]/);
    assert.doesNotMatch(res.text, /id=['"]websubPublishButton['"]/);
});

test('GET /s/:id shows Subscribe/Unsubscribe/Publish when webSub is enabled', async() => {
    const app = createApp();

    const res = await request(app).get('/s/websub-enabled-row-session');

    assert.match(res.text, /id=['"]websubSubscribeButton['"]/);
    assert.match(res.text, /id=['"]websubUnsubscribeButton['"]/);
    assert.match(res.text, /id=['"]websubPublishButton['"]/);
});

test('POST /s/:id/actions/rsscloud-subscribe over http-post calls pleaseNotify at the configured subscribe URL', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'thanks' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'rsscloud-subscribe-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.subscribeUrl =
        'http://other-hub.example/pleaseNotify';

    const res = await request(app)
        .post(`/s/${sessionId}/actions/rsscloud-subscribe`)
        .send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 200, body: 'thanks' });
    assert.equal(calls[0].url, 'http://other-hub.example/pleaseNotify');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('protocol'), 'http-post');
    assert.equal(body.get('path'), `/s/${sessionId}/notify`);
});

test('POST /s/:id/actions/rsscloud-subscribe over xml-rpc posts to the configured RPC2 URL', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'ok' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'rsscloud-subscribe-xmlrpc-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.protocol = 'xml-rpc';
    sessionStore.get(sessionId).settings.rssCloud.rpcUrl =
        'http://other-hub.example/RPC2';

    await request(app)
        .post(`/s/${sessionId}/actions/rsscloud-subscribe`)
        .send({});

    assert.equal(calls[0].url, 'http://other-hub.example/RPC2');
});

test('POST /s/:id/actions/rsscloud-subscribe errors without calling out when rssCloud is disabled', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'ok' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'rsscloud-subscribe-disabled-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.disabled = true;

    const res = await request(app)
        .post(`/s/${sessionId}/actions/rsscloud-subscribe`)
        .send({});

    assert.ok(res.body.error);
    assert.equal(calls.length, 0);
});

test('POST /s/:id/actions/websub-subscribe posts hub.mode=subscribe to the configured hub URL', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'websub-subscribe-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.hubUrl =
        'http://other-hub.example/custom-websub';
    sessionStore.get(sessionId).settings.webSub.leaseSeconds = 3600;

    const res = await request(app)
        .post(`/s/${sessionId}/actions/websub-subscribe`)
        .send({});

    assert.equal(res.body.status, 202);
    assert.equal(calls[0].url, 'http://other-hub.example/custom-websub');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'subscribe');
    assert.equal(body.get('hub.lease_seconds'), '3600');
});

test('POST /s/:id/actions/websub-subscribe errors without calling out when webSub is disabled', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'websub-subscribe-disabled-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.disabled = true;

    const res = await request(app)
        .post(`/s/${sessionId}/actions/websub-subscribe`)
        .send({});

    assert.ok(res.body.error);
    assert.equal(calls.length, 0);
});

test('POST /s/:id/actions/rsscloud-ping calls ping at the configured ping URL and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'pinged' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/rsscloud-ping')
        .send({});

    assert.deepEqual(res.body, { status: 200, body: 'pinged' });
    assert.equal(calls[0].url, 'http://localhost:5337/ping');
});

test('POST /s/:id/actions/rsscloud-ping surfaces the allowlist hint when the egress guard refuses the call', async() => {
    const fetch = async() => {
        throw Object.assign(
            new Error(
                'Refusing to connect to localhost (127.0.0.1): loopback address'
            ),
            { name: 'SsrfBlockedError' }
        );
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/rsscloud-ping')
        .send({});

    assert.ok(res.body.error.includes('loopback address'));
    assert.ok(res.body.error.includes('DEBUG_FETCH_ALLOW_CIDRS'));
});

test('POST /s/:id/actions/rsscloud-ping errors without calling out when there is no ping URL configured', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'pinged' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'no-ping-url-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.pingUrl = '';

    const res = await request(app)
        .post(`/s/${sessionId}/actions/rsscloud-ping`)
        .send({});

    assert.ok(res.body.error);
    assert.equal(calls.length, 0);
});

test('POST /s/:id/actions/websub-publish calls hub.mode=publish and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/websub-publish')
        .send({});

    assert.equal(res.body.status, 202);
    assert.equal(calls[0].url, 'http://localhost:5337/websub');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'publish');
});

test('POST /s/:id/actions/websub-unsubscribe calls hub.mode=unsubscribe and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/websub-unsubscribe')
        .send({});

    assert.equal(res.body.status, 202);
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'unsubscribe');
});

test('POST /s/:id/actions/discover-settings fetches a feed and returns settings merged with what it advertises', async() => {
    const feedXml = `<?xml version="1.0"?>
<rss version="2.0">
<channel><title>t</title><link>http://feed.example/rss</link><description>d</description>
<cloud domain="hub.example" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post" />
</channel></rss>`;
    const fetch = async() => ({ status: 200, text: async() => feedXml });
    const app = createApp({ fetch });
    const currentSettings = {
        feedUrl: 'http://feed.example/rss',
        rssCloud: {
            protocol: 'http-post',
            accepts: 'xml',
            pingUrl: 'http://localhost:5337/ping',
            subscribeUrl: 'http://localhost:5337/pleaseNotify',
            rpcUrl: 'http://localhost:5337/RPC2'
        },
        webSub: { disabled: false, hubUrl: 'http://localhost:5337/websub', leaseSeconds: '', secret: '' }
    };

    const res = await request(app)
        .post('/s/my-session/actions/discover-settings')
        .send({ feedUrl: 'http://feed.example/rss', currentSettings });

    assert.equal(res.body.settings.rssCloud.subscribeUrl, 'http://hub.example:80/pleaseNotify');
    assert.equal(res.body.settings.rssCloud.pingUrl, 'http://hub.example:80/ping');
});

test('POST /s/:id/actions/discover-settings reports an error instead of settings on a non-2xx fetch', async() => {
    const fetch = async() => ({ status: 404, text: async() => 'Not Found' });
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/discover-settings')
        .send({ feedUrl: 'http://feed.example/missing.xml', currentSettings: {} });

    assert.equal(res.body.settings, null);
    assert.match(res.body.error, /404/);
});

function fakeFetch(status = 200, responseBody = 'OK') {
    return async() => ({ status, text: async() => responseBody });
}

test('updating session A\'s feed does not affect session B\'s same-named feed', async() => {
    const app = createApp({ fetch: fakeFetch() });

    // Visiting the UI is what creates a session; a feed/callback route on an
    // id that was never visited 404s (see the idle-404 tests below).
    await request(app).get('/s/session-a');
    await request(app).get('/s/session-b');

    await request(app).post('/s/session-a/actions/update-feed').send({});

    const feedA = await request(app).get('/s/session-a/rss.xml');
    const feedB = await request(app).get('/s/session-b/rss.xml');

    assert.match(feedA.text, /Update at/);
    assert.doesNotMatch(feedB.text, /Update at/);
    assert.match(feedB.text, /initialized/);
});

test('rsscloud-ping does not add a feed item — it only notifies about existing content', async() => {
    const app = createApp({ fetch: fakeFetch() });
    const sessionId = 'ping-no-bump-session';

    await request(app).get(`/s/${sessionId}`);
    await request(app).post(`/s/${sessionId}/actions/rsscloud-ping`).send({});

    const feed = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.doesNotMatch(feed.text, /Update at/);
    assert.match(feed.text, /initialized/);
});

test('websub-publish does not add a feed item — it only notifies about existing content', async() => {
    const app = createApp({ fetch: fakeFetch(202, '') });
    const sessionId = 'publish-no-bump-session';

    await request(app).get(`/s/${sessionId}`);
    await request(app).post(`/s/${sessionId}/actions/websub-publish`).send({});

    const feed = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.doesNotMatch(feed.text, /Update at/);
    assert.match(feed.text, /initialized/);
});

test('GET /s/:id/rss.xml <cloud> element reflects this session\'s own rssCloud settings, not the global default', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'feed-cloud-override-session';

    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.subscribeUrl =
        'http://other-hub.example:1234/pleaseNotify';

    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.match(res.text, /<cloud domain="other-hub\.example" port="1234" path="\/pleaseNotify"/);
});

test('GET /s/:id/rss.xml omits the <cloud> element when rssCloud is disabled in settings', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'feed-cloud-disabled-session';

    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.disabled = true;

    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.doesNotMatch(res.text, /<cloud/);
});

test('GET /s/:id/rss.xml omits the WebSub hub link when webSub is disabled in settings', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'feed-hub-disabled-session';

    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.disabled = true;

    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.doesNotMatch(res.text, /rel="hub"/);
});

test('GET /s/:id/rss.xml sets a Link response header advertising the hub', async() => {
    const app = createApp();
    const sessionId = 'feed-link-header-session';
    await request(app).get(`/s/${sessionId}`);

    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.equal(res.headers.link, '<http://localhost:5337/websub>; rel="hub"');
});

test('GET /s/:id/rss.xml omits the Link response header when webSub is disabled', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'feed-link-header-disabled-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.disabled = true;

    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.equal(res.headers.link, undefined);
});

test('GET /s/:id/notify echoes the challenge query param', async() => {
    const app = createApp();

    await request(app).get('/s/my-session');

    const res = await request(app)
        .get('/s/my-session/notify')
        .query({ challenge: 'abc123' });

    assert.equal(res.text, 'abc123');
});

test('without an injected fetch, an outbound call to the default (loopback) hub is SSRF-blocked cleanly, not a crash', async() => {
    const app = createApp();

    const res = await request(app)
        .post('/s/my-session/actions/rsscloud-ping')
        .send({});

    assert.equal(res.status, 200);
    // The guard rejects loopback; the response unwraps undici's "fetch failed"
    // to the guard's own message and appends the allowlist hint.
    assert.match(res.body.error, /loopback address/);
    assert.match(res.body.error, /DEBUG_FETCH_ALLOW_CIDRS/);
});

test('subscribing logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(200, 'thanks'), sessionStore });
    const sessionId = 'log-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/rsscloud-subscribe`).send({});
    await waitUntil(() => received.length === 2);

    const [requestEntry, responseEntry] = received; // live order: request, then response
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 200);
    assert.equal(responseEntry.body, 'thanks');

    ws.close();
    await harness.close();
});

test('pinging logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(200, 'ok'), sessionStore });
    const sessionId = 'ping-log-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/rsscloud-ping`).send({});
    await waitUntil(() => received.length === 2);

    const [requestEntry, responseEntry] = received;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 200);

    ws.close();
    await harness.close();
});

test('websub-subscribe logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-log-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/websub-subscribe`).send({});
    await waitUntil(() => received.length === 2);

    const [requestEntry, responseEntry] = received;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 202);

    ws.close();
    await harness.close();
});

test('websub-subscribe redacts the secret in the logged request, but sends it verbatim to the hub', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'websub-secret-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.secret = 's3cr3t';
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/websub-subscribe`).send({});
    await waitUntil(() => received.length === 2);

    const requestEntry = received.find(
        e => e.direction === 'outgoing' && e.phase === 'request'
    );
    assert.notEqual(requestEntry.body.secret, 's3cr3t');

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.secret'), 's3cr3t');

    ws.close();
    await harness.close();
});

test('a failed websub subscribe does not store the secret', async() => {
    const fetch = async() => {
        throw new Error('network down');
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'websub-failed-subscribe';

    await request(app).get(`/s/${sessionId}`);
    const { settings } = sessionStore.get(sessionId);
    settings.webSub.secret = 's3cr3t';

    await request(app)
        .post(`/s/${sessionId}/actions/websub-subscribe`)
        .send({});

    assert.equal(sessionStore.get(sessionId).webSubSecrets[settings.feedUrl], undefined);
});

test('a failed websub unsubscribe does not clear a previously stored secret', async() => {
    const sessionStore = createSessionStore();
    const { id: sessionId, session } = sessionStore.createSession();
    session.webSubSecrets[session.settings.feedUrl] = 'existing-secret';

    const fetch = async() => {
        throw new Error('network down');
    };
    const app = createApp({ fetch, sessionStore });

    await request(app)
        .post(`/s/${sessionId}/actions/websub-unsubscribe`)
        .send({});

    assert.equal(session.webSubSecrets[session.settings.feedUrl], 'existing-secret');
});

test('websub-unsubscribe logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-unsub-log-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/websub-unsubscribe`).send({});
    await waitUntil(() => received.length === 2);

    const [requestEntry, responseEntry] = received;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);

    ws.close();
    await harness.close();
});

test('websub-publish logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-publish-log-session';
    const harness = await startTestServer(app);
    await harness.request.get(`/s/${sessionId}`);
    const { ws, received } = await harness.openLogSocket(sessionId);

    await harness.request.post(`/s/${sessionId}/actions/websub-publish`).send({});
    await waitUntil(() => received.length === 2);

    const [requestEntry, responseEntry] = received;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);

    ws.close();
    await harness.close();
});

test('GET /s/:id/settings renders a form prefilled with the session\'s current settings', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'settings-page-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.subscribeUrl =
        'http://other-hub.example/pleaseNotify';

    const res = await request(app).get(`/s/${sessionId}/settings`);

    assert.equal(res.status, 200);
    assert.match(res.text, /<form[^>]*action=['"]\/s\/settings-page-session\/settings['"]/);
    assert.match(res.text, /value=['"]http:\/\/other-hub\.example\/pleaseNotify['"]/);
});

test('GET /s/:id/settings renders the WebSub secret field as a masked password input', async() => {
    const app = createApp();

    const res = await request(app).get('/s/mask-secret-session/settings');

    assert.match(res.text, /<input(?=[^>]*id=['"]webSubSecret['"])(?=[^>]*type=['"]password['"])[^>]*>/);
});

test('GET /s/:id/settings renders an rssCloudDisabled checkbox reflecting the session\'s current settings', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-checkbox-render-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.disabled = true;

    const res = await request(app).get(`/s/${sessionId}/settings`);

    assert.match(res.text, /<input[^>]*id=['"]rssCloudDisabled['"][^>]*checked/);
});

test('GET /s/:id/settings\' Protocol select no longer offers a disabled option', async() => {
    const app = createApp();

    const res = await request(app).get('/s/no-disabled-option-session/settings');

    assert.doesNotMatch(res.text, /<option value=['"]disabled['"]/);
});

test('GET /s/:id/settings embeds this session\'s self-hosted URL prefixes for the blur-discovery script', async() => {
    const app = createApp();

    const res = await request(app).get('/s/context-session/settings');

    assert.match(res.text, /data-context=/);
    assert.match(res.text, /http:\/\/localhost:9000\/s\/context-session\//);
});

test('GET /s/:id/settings embeds this session\'s computed default settings for the Reset button', async() => {
    const app = createApp();

    const res = await request(app).get('/s/default-settings-context-session/settings');

    assert.match(res.text, /http:\/\/localhost:9000\/s\/default-settings-context-session\/rss\.xml/);
    assert.match(res.text, /http:\/\/localhost:5337\/pleaseNotify/);
});

test('GET /s/:id/settings disables the Feed URL Reset button when the feed is still self-hosted', async() => {
    const app = createApp();

    const res = await request(app).get('/s/reset-disabled-session/settings');

    assert.match(res.text, /<button[^>]*id=['"]feedUrlResetButton['"][^>]*disabled/);
});

test('GET /s/:id/settings enables the Feed URL Reset button when the feed has been changed to a remote URL', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'reset-enabled-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.feedUrl = 'https://example.com/feed.xml';

    const res = await request(app).get(`/s/${sessionId}/settings`);

    assert.doesNotMatch(res.text, /<button[^>]*id=['"]feedUrlResetButton['"][^>]*disabled/);
});

test('GET /s/:id/settings\' stylesheet forces [hidden] on the protocol-toggled fields, overriding style.css\'s explicit label/div display', async() => {
    const app = createApp();

    const res = await request(app).get('/s/hidden-css-session/settings');

    assert.match(res.text, /\.rsscloud-rest-only\[hidden\][^{]*\{[^}]*display:\s*none/);
    assert.match(res.text, /\.rsscloud-xmlrpc-only\[hidden\][^{]*\{[^}]*display:\s*none/);
    assert.match(res.text, /\.websub-fields-body\[hidden\][^{]*\{[^}]*display:\s*none/);
});

test('POST /s/:id/settings persists the submitted form and redirects back to the main page', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'settings-save-session';
    await request(app).get(`/s/${sessionId}`);

    const res = await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: 'http://localhost:9000/s/settings-save-session/rss.xml',
            rssCloudProtocol: 'xml-rpc',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: 'http://localhost:5337/pleaseNotify',
            rssCloudRpcUrl: 'http://custom-hub.example/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '3600',
            webSubSecret: 's3cr3t'
        });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/s/${sessionId}`);
    const { settings } = sessionStore.get(sessionId);
    assert.equal(settings.rssCloud.protocol, 'xml-rpc');
    assert.equal(settings.rssCloud.rpcUrl, 'http://custom-hub.example/RPC2');
    assert.equal(settings.webSub.leaseSeconds, '3600');
    assert.equal(settings.webSub.secret, 's3cr3t');
});

test('POST /s/:id/settings treats an absent webSubDisabled checkbox as false', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'settings-checkbox-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.webSub.disabled = true;

    await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: 'http://localhost:9000/s/settings-checkbox-session/rss.xml',
            rssCloudProtocol: 'http-post',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: 'http://localhost:5337/pleaseNotify',
            rssCloudRpcUrl: 'http://localhost:5337/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(sessionStore.get(sessionId).settings.webSub.disabled, false);
});

test('POST /s/:id/settings treats an absent rssCloudDisabled checkbox as false', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-checkbox-absent-session';
    await request(app).get(`/s/${sessionId}`);
    sessionStore.get(sessionId).settings.rssCloud.disabled = true;

    await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: 'http://localhost:9000/s/rsscloud-checkbox-absent-session/rss.xml',
            rssCloudProtocol: 'http-post',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: 'http://localhost:5337/pleaseNotify',
            rssCloudRpcUrl: 'http://localhost:5337/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(sessionStore.get(sessionId).settings.rssCloud.disabled, false);
});

test('POST /s/:id/settings sets rssCloud.disabled when the checkbox is present', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-checkbox-present-session';
    await request(app).get(`/s/${sessionId}`);

    await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: 'http://localhost:9000/s/rsscloud-checkbox-present-session/rss.xml',
            rssCloudDisabled: 'on',
            rssCloudProtocol: 'http-post',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: 'http://localhost:5337/pleaseNotify',
            rssCloudRpcUrl: 'http://localhost:5337/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(sessionStore.get(sessionId).settings.rssCloud.disabled, true);
});

test('POST /s/:id/settings rejects (without saving) a blank subscribeUrl when rssCloud is enabled over http-post', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-blank-subscribe-url-session';
    await request(app).get(`/s/${sessionId}`);
    const before = sessionStore.get(sessionId).settings;

    const res = await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: `http://localhost:9000/s/${sessionId}/rss.xml`,
            rssCloudProtocol: 'http-post',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: '',
            rssCloudRpcUrl: 'http://localhost:5337/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(res.status, 400);
    // The rejected save must not overwrite the session's (still-valid) settings.
    assert.deepEqual(sessionStore.get(sessionId).settings, before);

    // ...and the feed route that would otherwise throw on a malformed URL
    // keeps working, since the bad save never took effect.
    const feedRes = await request(app).get(`/s/${sessionId}/rss.xml`);
    assert.equal(feedRes.status, 200);
});

test('POST /s/:id/settings rejects a malformed rpcUrl when rssCloud is enabled over xml-rpc', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-malformed-rpc-url-session';
    await request(app).get(`/s/${sessionId}`);

    const res = await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: `http://localhost:9000/s/${sessionId}/rss.xml`,
            rssCloudProtocol: 'xml-rpc',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: 'http://localhost:5337/pleaseNotify',
            rssCloudRpcUrl: 'not-a-url',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(res.status, 400);
});

test('POST /s/:id/settings does not require a valid subscribeUrl when rssCloud is xml-rpc (only rpcUrl is used)', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-xmlrpc-ignores-subscribe-url-session';
    await request(app).get(`/s/${sessionId}`);

    const res = await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: `http://localhost:9000/s/${sessionId}/rss.xml`,
            rssCloudProtocol: 'xml-rpc',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: '',
            rssCloudRpcUrl: 'http://localhost:5337/RPC2',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(res.status, 302);
    assert.equal(sessionStore.get(sessionId).settings.rssCloud.rpcUrl, 'http://localhost:5337/RPC2');
});

test('POST /s/:id/settings does not require a valid rssCloud URL when rssCloud is disabled', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ sessionStore });
    const sessionId = 'rsscloud-disabled-skips-validation-session';
    await request(app).get(`/s/${sessionId}`);

    const res = await request(app)
        .post(`/s/${sessionId}/settings`)
        .type('form')
        .send({
            feedUrl: `http://localhost:9000/s/${sessionId}/rss.xml`,
            rssCloudDisabled: 'on',
            rssCloudProtocol: 'http-post',
            rssCloudAccepts: 'xml',
            rssCloudPingUrl: '',
            rssCloudSubscribeUrl: '',
            rssCloudRpcUrl: '',
            webSubHubUrl: 'http://localhost:5337/websub',
            webSubLeaseSeconds: '',
            webSubSecret: ''
        });

    assert.equal(res.status, 302);
});
