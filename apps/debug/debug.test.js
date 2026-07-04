const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./debug');
const { createSessionStore } = require('./lib/session-store');
const request = require('supertest');

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
        .post('/s/active-session/actions/ping')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

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

test('GET /s/:id renders a unified protocol select and the session id on <body>', async() => {
    const app = createApp();

    const res = await request(app).get('/s/my-ui-session');

    assert.match(res.text, /<body[^>]*data-session-id=['"]my-ui-session['"]/);
    assert.match(res.text, /<select[^>]*id=['"]protocol['"]/);
    assert.match(res.text, /<option value=['"]rsscloud-rest['"]/);
    assert.match(res.text, /<option value=['"]rsscloud-xml-rpc['"]/);
    assert.match(res.text, /<option value=['"]websub['"]/);
});

test('POST /s/:id/actions/subscribe over rsscloud-rest calls pleaseNotify and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'thanks' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/subscribe')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 200, body: 'thanks' });
    assert.equal(calls[0].url, 'http://localhost:5337/pleaseNotify');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('protocol'), 'http-post');
    assert.equal(body.get('path'), '/s/my-session/notify');
});

test('POST /s/:id/actions/subscribe over rsscloud-xml-rpc posts to /RPC2', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'ok' };
    };
    const app = createApp({ fetch });

    await request(app)
        .post('/s/my-session/actions/subscribe')
        .send({ protocol: 'rsscloud-xml-rpc', feedName: 'rss-01.xml' });

    assert.equal(calls[0].url, 'http://localhost:5337/RPC2');
});

test('POST /s/:id/actions/subscribe over websub posts hub.mode=subscribe to the hub', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/subscribe')
        .send({ protocol: 'websub', feedName: 'rss-01.xml', leaseSeconds: 3600 });

    assert.equal(res.body.status, 202);
    assert.equal(calls[0].url, 'http://localhost:5337/websub');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'subscribe');
    assert.equal(body.get('hub.lease_seconds'), '3600');
});

test('POST /s/:id/actions/subscribe honors a server override for rssCloud', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'ok' };
    };
    const app = createApp({ fetch });

    await request(app)
        .post('/s/my-session/actions/subscribe')
        .send({
            protocol: 'rsscloud-rest',
            feedName: 'rss-01.xml',
            server: 'http://other-hub.example'
        });

    assert.equal(calls[0].url, 'http://other-hub.example/pleaseNotify');
});

test('POST /s/:id/actions/subscribe honors a server override for websub (full hub URL, no double path)', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    await request(app)
        .post('/s/my-session/actions/subscribe')
        .send({
            protocol: 'websub',
            feedName: 'rss-01.xml',
            server: 'http://other-hub.example/custom-websub'
        });

    assert.equal(calls[0].url, 'http://other-hub.example/custom-websub');
});

test('POST /s/:id/actions/ping calls ping and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'pinged' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/ping')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    assert.deepEqual(res.body, { status: 200, body: 'pinged' });
    assert.equal(calls[0].url, 'http://localhost:5337/ping');
});

test('POST /s/:id/actions/ping surfaces the allowlist hint when the egress guard refuses the call', async() => {
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
        .post('/s/my-session/actions/ping')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    assert.ok(res.body.error.includes('loopback address'));
    assert.ok(res.body.error.includes('DEBUG_FETCH_ALLOW_CIDRS'));
});

test('POST /s/:id/actions/publish calls hub.mode=publish and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/publish')
        .send({ feedName: 'rss-01.xml' });

    assert.equal(res.body.status, 202);
    assert.equal(calls[0].url, 'http://localhost:5337/websub');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'publish');
});

test('POST /s/:id/actions/unsubscribe calls hub.mode=unsubscribe and returns JSON', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/unsubscribe')
        .send({ feedName: 'rss-01.xml' });

    assert.equal(res.body.status, 202);
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.mode'), 'unsubscribe');
});

test('POST /s/:id/actions/discover fetches and reports what a feed advertises', async() => {
    const feedXml = `<?xml version="1.0"?>
<rss version="2.0">
<channel><title>t</title><link>http://feed.example/rss</link><description>d</description>
<cloud domain="hub.example" port="80" path="/RPC2" registerProcedure="rssCloud.pleaseNotify" protocol="xml-rpc" />
</channel></rss>`;
    const fetch = async() => ({ status: 200, text: async() => feedXml });
    const app = createApp({ fetch });

    const res = await request(app)
        .post('/s/my-session/actions/discover')
        .send({ feedUrl: 'http://feed.example/rss' });

    assert.equal(res.body.rssCloud.domain, 'hub.example');
    assert.equal(res.body.webSub, null);
});

function fakeFetch(status = 200, responseBody = 'OK') {
    return async() => ({ status, text: async() => responseBody });
}

test('pinging session A does not affect session B\'s same-named feed', async() => {
    const app = createApp({ fetch: fakeFetch() });

    // Visiting the UI is what creates a session; a feed/callback route on an
    // id that was never visited 404s (see the idle-404 tests below).
    await request(app).get('/s/session-a');
    await request(app).get('/s/session-b');

    await request(app)
        .post('/s/session-a/actions/ping')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    const feedA = await request(app).get('/s/session-a/rss-01.xml');
    const feedB = await request(app).get('/s/session-b/rss-01.xml');

    assert.match(feedA.text, /Update at/);
    assert.doesNotMatch(feedB.text, /Update at/);
    assert.match(feedB.text, /initialized/);
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
        .post('/s/my-session/actions/ping')
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

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

    await request(app)
        .post(`/s/${sessionId}/actions/subscribe`)
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    const { requestLog } = sessionStore.get(sessionId);
    const outgoing = requestLog.filter(e => e.direction === 'outgoing');

    assert.equal(outgoing.length, 2);
    const [responseEntry, requestEntry] = outgoing; // newest-first
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 200);
    assert.equal(responseEntry.body, 'thanks');
});

test('pinging logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(200, 'ok'), sessionStore });
    const sessionId = 'ping-log-session';

    await request(app)
        .post(`/s/${sessionId}/actions/ping`)
        .send({ protocol: 'rsscloud-rest', feedName: 'rss-01.xml' });

    const { requestLog } = sessionStore.get(sessionId);
    const outgoing = requestLog.filter(e => e.direction === 'outgoing');

    assert.equal(outgoing.length, 2);
    const [responseEntry, requestEntry] = outgoing;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 200);
});

test('websub-subscribe logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-log-session';

    await request(app)
        .post(`/s/${sessionId}/actions/subscribe`)
        .send({ protocol: 'websub', feedName: 'rss-01.xml' });

    const { requestLog } = sessionStore.get(sessionId);
    const outgoing = requestLog.filter(e => e.direction === 'outgoing');

    assert.equal(outgoing.length, 2);
    const [responseEntry, requestEntry] = outgoing;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
    assert.equal(responseEntry.status, 202);
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

    await request(app)
        .post(`/s/${sessionId}/actions/subscribe`)
        .send({ protocol: 'websub', feedName: 'rss-01.xml', secret: 's3cr3t' });

    const { requestLog } = sessionStore.get(sessionId);
    const requestEntry = requestLog.find(
        e => e.direction === 'outgoing' && e.phase === 'request'
    );
    assert.notEqual(requestEntry.body.secret, 's3cr3t');

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('hub.secret'), 's3cr3t');
});

test('a failed websub subscribe does not store the secret', async() => {
    const fetch = async() => {
        throw new Error('network down');
    };
    const sessionStore = createSessionStore();
    const app = createApp({ fetch, sessionStore });
    const sessionId = 'websub-failed-subscribe';

    await request(app).get(`/s/${sessionId}`);
    const feedUrl = `http://localhost:9000/s/${sessionId}/rss-01.xml`;

    await request(app)
        .post(`/s/${sessionId}/actions/subscribe`)
        .send({ protocol: 'websub', feedName: 'rss-01.xml', secret: 's3cr3t' });

    assert.equal(sessionStore.get(sessionId).webSubSecrets[feedUrl], undefined);
});

test('a failed websub unsubscribe does not clear a previously stored secret', async() => {
    const sessionStore = createSessionStore();
    const { id: sessionId, session } = sessionStore.createSession();
    const feedUrl = `http://localhost:9000/s/${sessionId}/rss-01.xml`;
    session.webSubSecrets[feedUrl] = 'existing-secret';

    const fetch = async() => {
        throw new Error('network down');
    };
    const app = createApp({ fetch, sessionStore });

    await request(app)
        .post(`/s/${sessionId}/actions/unsubscribe`)
        .send({ feedName: 'rss-01.xml' });

    assert.equal(session.webSubSecrets[feedUrl], 'existing-secret');
});

test('websub-unsubscribe logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-unsub-log-session';

    await request(app)
        .post(`/s/${sessionId}/actions/unsubscribe`)
        .send({ feedName: 'rss-01.xml' });

    const { requestLog } = sessionStore.get(sessionId);
    const outgoing = requestLog.filter(e => e.direction === 'outgoing');

    assert.equal(outgoing.length, 2);
    const [responseEntry, requestEntry] = outgoing;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
});

test('websub-publish logs an outgoing request entry and a paired response entry', async() => {
    const sessionStore = createSessionStore();
    const app = createApp({ fetch: fakeFetch(202, ''), sessionStore });
    const sessionId = 'websub-publish-log-session';

    await request(app)
        .post(`/s/${sessionId}/actions/publish`)
        .send({ feedName: 'rss-01.xml' });

    const { requestLog } = sessionStore.get(sessionId);
    const outgoing = requestLog.filter(e => e.direction === 'outgoing');

    assert.equal(outgoing.length, 2);
    const [responseEntry, requestEntry] = outgoing;
    assert.equal(requestEntry.phase, 'request');
    assert.equal(responseEntry.phase, 'response');
    assert.equal(responseEntry.id, requestEntry.id);
});
