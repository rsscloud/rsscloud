const test = require('node:test');
const assert = require('node:assert/strict');
const { describeActionError } = require('./egress-error');

const HINT = 'DEBUG_FETCH_ALLOW_CIDRS';

test('appends the allowlist hint for an SsrfBlockedError by name', () => {
    const error = Object.assign(
        new Error('Refusing to connect to localhost (127.0.0.1): loopback address'),
        { name: 'SsrfBlockedError' }
    );

    const message = describeActionError(error);

    assert.ok(
        message.includes('loopback address'),
        'keeps the original guard message'
    );
    assert.ok(message.includes(HINT), 'points the user at the allowlist env var');
});

test('unwraps the SsrfBlockedError undici nests under a "fetch failed" cause', () => {
    // undici surfaces a connector rejection as a generic TypeError with the real
    // guard error on `.cause` — this is the shape a real blocked call produces.
    const error = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(
            new Error('Refusing to connect to 10.0.0.1: private address'),
            { name: 'SsrfBlockedError' }
        )
    });

    const message = describeActionError(error);

    assert.ok(
        message.includes('private address'),
        'surfaces the guard message, not the useless "fetch failed"'
    );
    assert.ok(message.includes(HINT), 'still adds the allowlist hint');
});

test('recognises the guard by its message shape even without the name', () => {
    const error = new Error(
        'Refusing to connect to hub (10.0.0.7): private address'
    );

    const message = describeActionError(error);

    assert.ok(message.includes(HINT), 'still adds the hint from the message shape');
});

test('leaves an ordinary error message untouched', () => {
    const error = new Error('feed discovery timed out');

    const message = describeActionError(error);

    assert.equal(message, 'feed discovery timed out');
    assert.ok(!message.includes(HINT), 'no spurious egress hint');
});
