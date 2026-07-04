const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SsrfBlockedError } = require('@rsscloud/core');
const { createGuardedFetch } = require('./guarded-fetch');

function withLoopbackServer(handler) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('rejects a loopback target by default', async() => {
    const fetch = createGuardedFetch({});

    await assert.rejects(() => fetch('http://127.0.0.1:8080/'), err => {
        assert.ok(err.cause instanceof SsrfBlockedError);
        return true;
    });
});

test('reaches a loopback target when its CIDR is allow-listed', async() => {
    const server = await withLoopbackServer((req, res) => res.end('ok'));
    const { port } = server.address();

    try {
        const fetch = createGuardedFetch({ allowCidrs: ['127.0.0.0/8'] });
        const res = await fetch(`http://127.0.0.1:${port}/`);

        assert.equal(res.status, 200);
        assert.equal(await res.text(), 'ok');
    } finally {
        server.close();
    }
});
