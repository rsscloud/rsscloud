// Isolated in its own file/process: config.js computes its exports at
// require-time from process.env, so exercising a malformed value means
// setting it before the very first require of this module.
process.env.SESSION_GC_INTERVAL_MS = 'not-a-number';

const test = require('node:test');
const assert = require('node:assert/strict');

test('config.js fails loudly when a numeric env var is present but not a valid number', () => {
    assert.throws(() => {
        require('./config');
    }, /SESSION_GC_INTERVAL_MS/);
});
