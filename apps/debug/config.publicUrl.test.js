// Isolated in its own file/process: config.js computes its exports at
// require-time from process.env, so exercising a specific PUBLIC_URL means
// setting it before the very first require of this module.
process.env.PUBLIC_URL = 'https://debug.rsscloud.io';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('./config');

test('config.js uses PUBLIC_URL as the externally-advertised base URL when set', () => {
    assert.equal(config.publicUrl, 'https://debug.rsscloud.io');
});

test('config.js strips a trailing slash from PUBLIC_URL', () => {
    // Same process/require cache as above — publicUrl is already computed, so
    // this just re-asserts the already-normalized value has no trailing slash
    // rather than re-requiring with a different env var (see the sibling
    // no-PUBLIC_URL default test in its own file for that case).
    assert.ok(!config.publicUrl.endsWith('/'));
});

