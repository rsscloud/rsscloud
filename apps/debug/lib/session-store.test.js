const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('./session-store');

test('createSession mints a fresh session with the expected shape', () => {
    const store = createSessionStore({ now: () => 1000 });

    const { id, session } = store.createSession();

    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
    assert.deepEqual(session.feedItems, {});
    assert.deepEqual(session.feedLastUpdatedAt, {});
    assert.deepEqual(session.webSubSecrets, {});
    assert.equal(session.sockets.size, 0);
    assert.equal(session.createdAt, 1000);
    assert.equal(session.lastOutgoingAt, 1000);
});

test('createSession computes settings via the injected buildDefaultSettings, given the new session id', () => {
    const seen = [];
    const store = createSessionStore({
        now: () => 1000,
        buildDefaultSettings: id => {
            seen.push(id);
            return { feedUrl: `fake://${id}` };
        }
    });

    const { id, session } = store.createSession();

    assert.deepEqual(seen, [id]);
    assert.deepEqual(session.settings, { feedUrl: `fake://${id}` });
});

test('createSession defaults settings from the real config when buildDefaultSettings is not injected', () => {
    const store = createSessionStore({ now: () => 1000 });

    const { id, session } = store.createSession();

    assert.equal(session.settings.feedUrl, `http://localhost:9000/s/${id}/rss.xml`);
});

test('get returns the session created under an id, or undefined for an unknown id', () => {
    const store = createSessionStore({ now: () => 1000 });
    const { id, session } = store.createSession();

    assert.equal(store.get(id), session);
    assert.equal(store.get('unknown-id'), undefined);
});

test('getOrCreate creates a session under an unknown id, then returns the same session on repeat calls', () => {
    const store = createSessionStore({ now: () => 1000 });

    const first = store.getOrCreate('bookmarked-id');
    const second = store.getOrCreate('bookmarked-id');

    assert.equal(first, second);
    assert.equal(store.get('bookmarked-id'), first);
});

test('touchOutgoing updates lastOutgoingAt to the current time', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();

    currentTime = 5000;
    store.touchOutgoing(id);

    assert.equal(session.lastOutgoingAt, 5000);
});

test('touchOutgoing is a safe no-op for an unknown id', () => {
    const store = createSessionStore({ now: () => 1000 });

    assert.doesNotThrow(() => store.touchOutgoing('unknown-id'));
});

test('isIdle is true for an unknown id', () => {
    const store = createSessionStore({ now: () => 1000 });

    assert.equal(store.isIdle('unknown-id', 500), true);
});

test('isIdle boundary: exactly at the threshold is not idle, one past it is', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id } = store.createSession();

    currentTime = 1000 + 500;
    assert.equal(store.isIdle(id, 500), false);

    currentTime = 1000 + 501;
    assert.equal(store.isIdle(id, 500), true);
});

test('isIdle is false while the session has a live socket, however long since lastOutgoingAt', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();
    session.sockets.add({});

    currentTime = 1000 + 501;

    assert.equal(store.isIdle(id, 500), false);
});

test('sweep evicts only sessions idle beyond the threshold', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });

    const stale = store.createSession();

    currentTime = 1000 + 500;
    const fresh = store.createSession();

    currentTime = 1000 + 501;
    const evicted = store.sweep(500);

    assert.equal(evicted, 1);
    assert.equal(store.get(stale.id), undefined);
    assert.equal(store.get(fresh.id), fresh.session);
});

test('sweep does not evict a session that has a live socket, however long since lastOutgoingAt', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();
    session.sockets.add({});

    currentTime = 1000 + 501;
    const evicted = store.sweep(500);

    assert.equal(evicted, 0);
    assert.equal(store.get(id), session);
});

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

test('isIdle stops exempting a live-socket session once it exceeds the absolute max session age', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();
    session.sockets.add({});

    currentTime = 1000 + EIGHT_DAYS_MS;

    assert.equal(store.isIdle(id, 500), true);
});

test('isIdle still returns false past the absolute max session age given recent outgoing activity', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();
    session.sockets.add({});

    currentTime = 1000 + EIGHT_DAYS_MS;
    store.touchOutgoing(id);

    assert.equal(store.isIdle(id, 500), false);
});

test('sweep evicts a long-lived socket-holding session once it exceeds the absolute max session age, terminating its socket', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });
    const { id, session } = store.createSession();
    let terminated = false;
    session.sockets.add({ terminate: () => { terminated = true; } });

    currentTime = 1000 + EIGHT_DAYS_MS;
    const evicted = store.sweep(500);

    assert.equal(evicted, 1);
    assert.equal(store.get(id), undefined);
    assert.equal(terminated, true);
});

test('size reflects the number of live sessions, including after a sweep', () => {
    let currentTime = 1000;
    const store = createSessionStore({ now: () => currentTime });

    assert.equal(store.size(), 0);

    const stale = store.createSession();
    currentTime = 1000 + 500;
    store.createSession();

    assert.equal(store.size(), 2);

    currentTime = 1000 + 501;
    store.sweep(500);

    assert.equal(store.size(), 1);
    assert.equal(store.get(stale.id), undefined);
});
