const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createSessionStore } = require('./lib/session-store');
const { createSessionSockets } = require('./session-sockets');

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

function waitForMessage(ws) {
    return new Promise(resolve => {
        ws.once('message', data => resolve(JSON.parse(data.toString())));
    });
}

test('broadcast delivers a JSON message to a socket connected on a known session', async() => {
    const sessionStore = createSessionStore();
    const { id: sessionId } = sessionStore.createSession();
    const { attach, broadcast } = createSessionSockets({ sessionStore });
    const server = http.createServer();
    attach(server);
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${sessionId}/logs`);
    await waitForOpen(ws);
    const received = waitForMessage(ws);

    broadcast(sessionId, { id: '1', direction: 'incoming', method: 'GET' });

    assert.deepEqual(await received, {
        id: '1',
        direction: 'incoming',
        method: 'GET'
    });

    ws.close();
    server.close();
});

test('a connection for an unknown session id is refused', async() => {
    const sessionStore = createSessionStore();
    const { attach } = createSessionSockets({ sessionStore });
    const server = http.createServer();
    attach(server);
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/unknown-id/logs`);
    const outcome = await new Promise(resolve => {
        ws.once('error', () => resolve('refused'));
        ws.once('open', () => resolve('opened'));
    });

    assert.equal(outcome, 'refused');

    server.close();
});

function waitForClose(ws) {
    return new Promise(resolve => ws.once('close', resolve));
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

test('a closed socket is removed from the session\'s socket set', async() => {
    const sessionStore = createSessionStore();
    const { id: sessionId, session } = sessionStore.createSession();
    const { attach } = createSessionSockets({ sessionStore });
    const server = http.createServer();
    attach(server);
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${sessionId}/logs`);
    await waitForOpen(ws);
    assert.equal(session.sockets.size, 1);

    ws.close();
    await waitForClose(ws);
    // The server-side 'close' handler fires from the same close handshake,
    // but not necessarily by the time the client's own 'close' event does.
    await waitUntil(() => session.sockets.size === 0);

    assert.equal(session.sockets.size, 0);

    server.close();
});

test('sweeping does not evict or close a session with a live socket connection', async() => {
    let currentTime = 1000;
    const sessionStore = createSessionStore({ now: () => currentTime });
    const { id: sessionId } = sessionStore.createSession();
    const { attach } = createSessionSockets({ sessionStore });
    const server = http.createServer();
    attach(server);
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${sessionId}/logs`);
    await waitForOpen(ws);
    let closed = false;
    ws.once('close', () => { closed = true; });

    // Someone leaving a tab open overnight watching an external feed: no
    // outgoing action for way past the GC threshold, but the socket is
    // still connected — sweeping must leave both the session and the
    // connection alone.
    currentTime = 1000 + 86400001;
    const evicted = sessionStore.sweep(86400000);

    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(evicted, 0);
    assert.equal(closed, false);
    assert.ok(sessionStore.get(sessionId));

    ws.close();
    server.close();
});

test('connecting replays buffered history oldest-first before any new broadcast', async() => {
    const sessionStore = createSessionStore();
    const { id: sessionId, session } = sessionStore.createSession();
    // requestLog is maintained newest-first (unshift), as today.
    session.requestLog = [
        { id: '2', method: 'POST' },
        { id: '1', method: 'GET' }
    ];
    const { attach } = createSessionSockets({ sessionStore });
    const server = http.createServer();
    attach(server);
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${sessionId}/logs`);
    const replayed = [];
    ws.on('message', data => replayed.push(JSON.parse(data.toString())));
    await waitForOpen(ws);
    await waitUntil(() => replayed.length === 2);

    assert.deepEqual(replayed.map(e => e.id), ['1', '2']);

    ws.close();
    server.close();
});
