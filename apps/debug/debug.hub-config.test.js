// Isolated from debug.test.js: HUB_SERVER_URL must be set before config.js
// (required transitively by debug.js) reads process.env, and config.js is a
// module-level singleton — this can only be exercised in its own process,
// which `node --test` already gives each file.
process.env.HUB_SERVER_URL = 'http://hub.example.org:8080';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./debug');
const request = require('supertest');

test('the served test feed\'s <cloud> element derives domain/port from HUB_SERVER_URL', async() => {
    const app = createApp();

    await request(app).get('/s/cloud-config-session');
    const res = await request(app).get('/s/cloud-config-session/rss-01.xml');

    assert.match(res.text, /<cloud domain="hub\.example\.org" port="8080"/);
});
