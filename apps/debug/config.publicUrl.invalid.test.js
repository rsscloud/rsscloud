// Isolated in its own file/process: config.js computes its exports at
// require-time from process.env, so exercising a malformed PUBLIC_URL means
// setting it before the very first require of this module.
process.env.PUBLIC_URL = 'not-a-url';

const test = require('node:test');
const assert = require('node:assert/strict');

test('config.js fails loudly when PUBLIC_URL is present but not a valid URL', () => {
    assert.throws(() => {
        require('./config');
    }, /Invalid URL value for PUBLIC_URL/);
});
