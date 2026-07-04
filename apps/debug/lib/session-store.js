const { randomUUID } = require('crypto');

const MAX_LOG_ENTRIES = 100;
// Absolute ceiling on how long a live socket alone can keep a session
// exempt from idle/GC checks — long enough to cover "left a tab open over a
// long weekend," but a hard backstop against an indefinitely-held
// connection pinning a session in memory forever on a public deployment.
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Per-session in-memory state for the client harness: request log, served
// feed items, and WebSub secrets, isolated per session id so concurrent
// public users don't see each other's traffic.
function createSessionStore({ now = () => Date.now(), idGenerator = randomUUID } = {}) {
    const sessions = new Map();

    function newSession() {
        const createdAt = now();
        return {
            requestLog: [],
            feedItems: {},
            webSubSecrets: {},
            sockets: new Set(),
            createdAt,
            lastOutgoingAt: createdAt
        };
    }

    function createSession() {
        const id = idGenerator();
        const session = newSession();
        sessions.set(id, session);
        return { id, session };
    }

    function get(id) {
        return sessions.get(id);
    }

    function getOrCreate(id) {
        if (!sessions.has(id)) {
            sessions.set(id, newSession());
        }
        return sessions.get(id);
    }

    function touchOutgoing(id) {
        const session = sessions.get(id);
        if (session) {
            session.lastOutgoingAt = now();
        }
    }

    // A live socklog viewer is itself a sign of active use — e.g. someone
    // left a tab open overnight watching an external feed — but only up to
    // MAX_SESSION_AGE_MS; past that, a held-open connection stops overriding
    // the idle/GC checks and falls back to the normal lastOutgoingAt rules
    // below, same as a session with no socket at all.
    function hasExemptSocket(session) {
        return (
            session.sockets.size > 0 &&
            now() - session.createdAt <= MAX_SESSION_AGE_MS
        );
    }

    function isIdle(id, idleMs) {
        const session = sessions.get(id);
        if (!session) {
            return true;
        }
        if (hasExemptSocket(session)) {
            return false;
        }
        return now() - session.lastOutgoingAt > idleMs;
    }

    function sweep(maxIdleMs) {
        let evicted = 0;
        for (const [id, session] of sessions) {
            if (hasExemptSocket(session)) {
                continue;
            }
            if (now() - session.lastOutgoingAt > maxIdleMs) {
                for (const socket of session.sockets) {
                    socket.terminate?.();
                }
                sessions.delete(id);
                evicted += 1;
            }
        }
        return evicted;
    }

    function size() {
        return sessions.size;
    }

    // Owns the request log's lifecycle (append + cap) so callers (the
    // WebSocket layer, the incoming-request middleware) don't each
    // reimplement the truncation policy.
    function appendLog(id, entry) {
        const session = sessions.get(id);
        if (!session) {
            return;
        }
        session.requestLog.unshift(entry);
        if (session.requestLog.length > MAX_LOG_ENTRIES) {
            session.requestLog.pop();
        }
    }

    return {
        createSession,
        get,
        getOrCreate,
        touchOutgoing,
        isIdle,
        sweep,
        size,
        appendLog
    };
}

module.exports = { createSessionStore };
