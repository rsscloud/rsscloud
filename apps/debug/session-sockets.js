const { WebSocketServer } = require('ws');
const { URL } = require('url');

const LOGS_PATH = /^\/s\/([^/]+)\/logs$/;

// Per-session socklog WebSocket feed. `attach(server)` wires the upgrade
// handling once the real http.Server exists (after `.listen()`); `broadcast`
// only needs the session store, so route handlers can use it immediately.
function createSessionSockets({ sessionStore }) {
    const wss = new WebSocketServer({ noServer: true });

    function attach(server) {
        server.on('upgrade', (request, socket, head) => {
            const pathname = new URL(
                request.url,
                `http://${request.headers.host}`
            ).pathname;
            const match = LOGS_PATH.exec(pathname);
            const session = match && sessionStore.get(match[1]);

            if (!session) {
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, ws => {
                session.sockets.add(ws);
                // Backfill a late-connecting viewer with this session's
                // history, oldest-first (requestLog itself is newest-first).
                for (const entry of session.requestLog.slice().reverse()) {
                    ws.send(JSON.stringify(entry));
                }
                ws.on('close', () => session.sockets.delete(ws));
            });
        });
    }

    function broadcast(sessionId, entry) {
        const session = sessionStore.get(sessionId);
        if (!session) {
            return;
        }

        sessionStore.appendLog(sessionId, entry);

        const message = JSON.stringify(entry);
        for (const ws of session.sockets) {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            }
        }
    }

    return { attach, broadcast };
}

module.exports = { createSessionSockets };
