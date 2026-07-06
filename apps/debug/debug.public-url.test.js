// Isolated from debug.test.js: PUBLIC_URL must be set before config.js
// (required transitively by debug.js) reads process.env, and config.js is a
// module-level singleton — this can only be exercised in its own process,
// which `node --test` already gives each file.
process.env.PUBLIC_URL = 'https://debug.rsscloud.io';
process.env.DOMAIN = 'debug.rsscloud.io';
process.env.PORT = '3013';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./debug');
const request = require('supertest');

test('websub-subscribe sends hub.callback built from PUBLIC_URL, not the internal listen DOMAIN/PORT', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 202, text: async() => '' };
    };
    const app = createApp({ fetch });
    const sessionId = 'public-url-session';

    await request(app).get(`/s/${sessionId}`);
    await request(app)
        .post(`/s/${sessionId}/actions/websub-subscribe`)
        .send({});

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(
        body.get('hub.callback'),
        `https://debug.rsscloud.io/s/${sessionId}/websub-callback`
    );
});

test('rsscloud-subscribe sends a callback domain/port derived from PUBLIC_URL, not the internal listen PORT', async() => {
    const calls = [];
    const fetch = async(url, init) => {
        calls.push({ url: String(url), init });
        return { status: 200, text: async() => 'ok' };
    };
    const app = createApp({ fetch });
    const sessionId = 'public-url-rsscloud-session';

    await request(app).get(`/s/${sessionId}`);
    await request(app)
        .post(`/s/${sessionId}/actions/rsscloud-subscribe`)
        .send({});

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('domain'), 'debug.rsscloud.io');
    // PUBLIC_URL carries no explicit port, and its scheme is https, so the
    // externally-reachable port is 443 — not the internal PORT=3013 this
    // process actually binds to.
    assert.equal(body.get('port'), '443');
});

test('the self-hosted feed\'s <link> is built from PUBLIC_URL, not the internal listen DOMAIN/PORT', async() => {
    const app = createApp();
    const sessionId = 'public-url-feed-link-session';

    await request(app).get(`/s/${sessionId}`);
    const res = await request(app).get(`/s/${sessionId}/rss.xml`);

    assert.match(
        res.text,
        new RegExp(`<link>https://debug\\.rsscloud\\.io/s/${sessionId}/rss\\.xml</link>`)
    );
});
