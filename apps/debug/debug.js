const bodyParser = require('body-parser'),
    crypto = require('crypto'),
    { URL } = require('url'),
    express = require('express'),
    morgan = require('morgan'),
    config = require('./config'),
    { createSessionStore } = require('./lib/session-store'),
    { createGuardedFetch } = require('./lib/guarded-fetch'),
    { describeActionError } = require('./lib/egress-error'),
    { createSessionSockets } = require('./session-sockets'),
    {
        createRssCloudClient,
        createWebSubClient,
        readVerification,
        buildNotifyResponse,
        renderCloudFeed,
        discoverFeed
    } = require('./lib'),
    textParser = bodyParser.text({ type: '*/xml' }),
    // Content distribution arrives with the origin feed's Content-Type relayed
    // verbatim, so the callback parses any media type as a raw string to log it.
    rawTextParser = bodyParser.text({ type: () => true }),
    urlencodedParser = bodyParser.urlencoded({ extended: false }),
    jsonParser = bodyParser.json();

// The hub's WebSub front door, advertised in feeds via <atom:link rel="hub">.
const hubUrl = `${config.hubServerUrl}/websub`;
// The hub's origin, decomposed for the <cloud> element's domain/port — its
// XML-RPC front door is always /RPC2, the rssCloud convention.
const hubOrigin = new URL(config.hubServerUrl);
const hubPort =
    Number(hubOrigin.port) || (hubOrigin.protocol === 'https:' ? 443 : 80);

// This session's callback URL the hub notifies for WebSub content
// distribution and intent verification.
function webSubCallbackUrl(sessionId) {
    return `http://${config.domain}:${config.port}/s/${sessionId}/websub-callback`;
}

// Build the feed URL an action targets: the caller's own external feedUrl
// when given (subscriber mode), else this session's own test feed.
function resolveFeedUrl(sessionId, { feedUrl, feedName }) {
    return feedUrl || `http://${config.domain}:${config.port}/s/${sessionId}/${feedName || 'rss-01.xml'}`;
}

// Pull the topic URL out of a delivery's Link header (`<url>; rel="self"`).
function selfLink(link) {
    const match = /<([^>]+)>\s*;\s*rel="self"/.exec(link || '');
    return match ? match[1] : undefined;
}

// Verify a relayed X-Hub-Signature (`<algo>=<hex>`) against the body using the
// secret this session subscribed with. Returns a human-readable verdict for
// the log.
function checkSignature(session, topicUrl, signature, body) {
    const secret = session.webSubSecrets[topicUrl];
    if (!secret) {
        return 'no stored secret — not verified';
    }
    const [algo, digest] = String(signature).split('=');
    if (!algo || !digest) {
        return 'malformed header';
    }
    let expected;
    try {
        expected = crypto.createHmac(algo, secret).update(body).digest('hex');
    } catch {
        return `unsupported algorithm: ${algo}`;
    }
    return expected === digest ? 'valid ✓' : 'INVALID ✗';
}

// Helper function to escape HTML entities
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Render the unified control box + live traffic log for a session.
// `hubServerUrl`/`hubUrl` prefill the server/hub override field with this
// harness's own defaults; the Discover action overwrites it client-side.
function renderPage(sessionId, wsUrl) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>rssCloud Debug Harness</title>
    <link href="/css/style.css" rel="stylesheet" />
    <style>
        /* Debug-harness-specific additions layered on the shared server stylesheet. */
        select {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 15px;
            font-size: 16px;
            background: white;
        }
        .controls {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .controls fieldset {
            border: none;
            padding: 0;
            margin: 0 0 20px;
        }
        .controls fieldset:last-of-type {
            margin-bottom: 0;
        }
        .controls legend {
            font-weight: bold;
            color: #2c3e50;
            padding: 0;
            margin-bottom: 10px;
        }
        .form-row {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }
        .form-row > label {
            flex: 1;
            min-width: 220px;
        }
        .input-with-button {
            display: flex;
            gap: 10px;
            align-items: flex-start;
        }
        .input-with-button input {
            flex: 1;
            margin-bottom: 0;
        }
        .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
    </style>
</head>
<body data-session-id="${escapeHtml(sessionId)}">
    <h1>rssCloud Debug Harness</h1>

    <div class="controls">
        <fieldset>
            <legend>Target</legend>
            <div class="form-row">
                <label for="protocol">
                    Protocol
                    <select id="protocol">
                        <option value="rsscloud-rest">rssCloud REST</option>
                        <option value="rsscloud-xml-rpc">rssCloud XML-RPC</option>
                        <option value="websub">WebSub</option>
                    </select>
                </label>
                <label for="serverOverride">
                    Server/hub override
                    <input type="text" id="serverOverride" placeholder="${escapeHtml(config.hubServerUrl)}">
                </label>
            </div>
        </fieldset>

        <fieldset>
            <legend>Feed</legend>
            <label for="feedUrl">
                Feed URL (external — leave blank to use this harness's own test feed)
            </label>
            <div class="input-with-button">
                <input type="text" id="feedUrl" placeholder="https://example.com/feed.xml">
                <button type="button" id="discoverButton">Discover</button>
            </div>
            <label for="feedName">
                Feed name (own test feed)
                <input type="text" id="feedName" value="rss-01.xml">
            </label>
        </fieldset>

        <fieldset class="websub-only">
            <legend>WebSub options</legend>
            <div class="form-row">
                <label for="leaseSeconds">
                    lease_seconds
                    <input type="text" id="leaseSeconds" placeholder="optional">
                </label>
                <label for="secret">
                    secret
                    <input type="text" id="secret" placeholder="optional">
                </label>
            </div>
        </fieldset>

        <div class="actions">
            <button type="button" id="subscribeButton">Subscribe</button>
            <button type="button" id="unsubscribeButton" class="websub-only">Unsubscribe</button>
            <button type="button" id="pingButton" class="rsscloud-only">Ping</button>
            <button type="button" id="publishButton" class="websub-only">Publish</button>
        </div>
    </div>

    <div id="actionError" class="action-error" role="alert" hidden></div>

    <h2>Traffic Log</h2>
    <p class="feed-url">Log stream: <code>${escapeHtml(wsUrl)}</code></p>
    <script type="module">
        import 'https://esm.sh/@andrewshell/socklog';
        const viewer = document.getElementById('viewer');
        const controls = document.getElementById('controls');
        controls.store = viewer.getStore();
    </script>
    <div class="log-panel">
        <socklog-controls id="controls"></socklog-controls>
        <socklog-viewer id="viewer" url="${escapeHtml(wsUrl)}"></socklog-viewer>
    </div>

    <script type="module" src="/app.js"></script>
</body>
</html>`;
}

// Build the Express app. `fetch` is injected into the rssCloud/WebSub clients
// (defaults to the global fetch); `sessionStore` defaults to a fresh
// in-memory store (defaults let tests inject fakes without touching real
// process state).
function createApp({
    fetch = createGuardedFetch({
        allowCidrs: config.debugFetchAllowCidrs,
        timeoutMs: config.requestTimeout
    }),
    sessionStore = createSessionStore(),
    sessionCallbackIdleMs = config.sessionCallbackIdleMs
} = {}) {
    const { attach, broadcast } = createSessionSockets({ sessionStore });

    // Every outbound action broadcasts its request as it's about to fire;
    // routing that broadcast through here keeps the session's idle clock
    // (lastOutgoingAt) in sync with actual activity, so requireLiveSession
    // doesn't treat a session mid-use as abandoned.
    function broadcastOutgoingRequest(sessionId, entry) {
        sessionStore.touchOutgoing(sessionId);
        broadcast(sessionId, {
            ...entry,
            direction: 'outgoing',
            phase: 'request'
        });
    }

    // UI/action routes create a session on demand.
    function ensureSession(req, res, next) {
        req.session = sessionStore.getOrCreate(req.params.sessionId);
        next();
    }

    // Machine-to-machine callback/feed routes never create a session, and go
    // dark (404) once it's idle past sessionCallbackIdleMs — a hub that never
    // stops probing a long-abandoned subscription shouldn't get a response.
    // A connected socklog socket overrides this (see session-store.js's
    // isIdle) — a tab left open overnight watching an external feed is
    // itself a sign of active use, not abandonment.
    function requireLiveSession(req, res, next) {
        if (sessionStore.isIdle(req.params.sessionId, sessionCallbackIdleMs)) {
            res.status(404).send('Not found');
            return;
        }
        next();
    }

    const app = express();

    morgan.format('mydate', () => {
        return new Date()
            .toLocaleTimeString('en-US', {
                hour12: false,
                fractionalSecondDigits: 3
            })
            .replace(/:/g, ':');
    });

    app.use(
        morgan(
            '[:mydate] :method :url :status :res[content-length] - :remote-addr - :response-time ms'
        )
    );

    // Handle static files in public directory
    app.use(
        express.static('public', {
            dotfiles: 'ignore',
            maxAge: '1d'
        })
    );

    // Route: mint a session id and hand the browser off to it.
    app.get('/', (req, res) => {
        res.redirect(302, `/s/${crypto.randomUUID()}`);
    });

    const sessionRouter = express.Router({ mergeParams: true });

    // Attach this request's session state, if it exists — never creates one
    // (ensureSession does that for UI/action routes). May leave req.session
    // undefined for a callback/feed route on an unknown id; requireLiveSession
    // gates those routes before their handler or the logging middleware below
    // ever reads it.
    sessionRouter.use((req, res, next) => {
        req.session = sessionStore.get(req.params.sessionId);
        next();
    });

    // Request logging middleware - captures all incoming requests
    sessionRouter.use((req, res, next) => {
        res.on('finish', () => {
            // No session (unknown/idle id on a callback route, already 404'd
            // by requireLiveSession) — nothing to log against.
            if (!req.session) {
                return;
            }
            // Don't log client UI requests to keep log clean
            if (req.path === '/' && req.method === 'GET') {
                return;
            }
            // The browser's own action-trigger POSTs are outbound; the real
            // hub-bound request/response they cause is already logged
            // explicitly (with direction: 'outgoing') by the handler itself.
            if (req.path.startsWith('/actions/')) {
                return;
            }
            if (req.path.startsWith('/.well-known/')) {
                return;
            }

            // Surface the WebSub delivery headers so the hub/self links and
            // the signature (with our verdict) are visible in the log.
            const headers = {};
            if (req.headers.link) {
                headers.Link = req.headers.link;
            }
            if (req.headers['x-hub-signature']) {
                const topic = selfLink(req.headers.link);
                headers['X-Hub-Signature'] =
                    `${req.headers['x-hub-signature']} (${checkSignature(
                        req.session,
                        topic,
                        req.headers['x-hub-signature'],
                        req.body
                    )})`;
            }

            broadcast(req.params.sessionId, {
                id: crypto.randomUUID(),
                direction: 'incoming',
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.originalUrl,
                headers: Object.keys(headers).length ? headers : null,
                body: req.body || null
            });
        });

        next();
    });

    // Route: Home page with UI
    sessionRouter.get('/', ensureSession, (req, res) => {
        const wsProtocol = req.protocol === 'https' ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${req.get('host')}/s/${req.params.sessionId}/logs`;
        res.type('html').send(renderPage(req.params.sessionId, wsUrl));
    });

    // Route: parse an arbitrary feed URL for rssCloud/WebSub support. Feeds
    // this outbound fetch through the same SSRF-guarded fetch as every other
    // action, since the URL is user-supplied.
    sessionRouter.post('/actions/discover', ensureSession, jsonParser, async(req, res) => {
        const sessionId = req.params.sessionId;
        const { feedUrl } = req.body;
        const logId = crypto.randomUUID();

        broadcastOutgoingRequest(sessionId, {
            id: logId,
            timestamp: new Date().toISOString(),
            method: 'GET',
            url: feedUrl,
            body: { action: 'discover', feedUrl }
        });

        try {
            const result = await discoverFeed({ url: feedUrl, fetch });
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                body: result
            });
            res.json(result);
        } catch (error) {
            const message = describeActionError(error);
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                error: message
            });
            res.json({ rssCloud: null, webSub: null, error: message });
        }
    });

    // Route: unified Subscribe action — branches by the selected protocol.
    // `server` optionally overrides the target: for rssCloud this is the hub
    // origin (pleaseNotify/RPC2 base); for WebSub it's the full hub front-door
    // URL (path defaults to '' so it isn't double-appended).
    sessionRouter.post('/actions/subscribe', ensureSession, jsonParser, async(req, res) => {
        const sessionId = req.params.sessionId;
        const { protocol, server: serverOverride, leaseSeconds, secret } =
            req.body;
        const feedUrl = resolveFeedUrl(sessionId, req.body);
        const logId = crypto.randomUUID();

        // `onSuccess`, when given, runs only once `call()` resolves without
        // throwing — session state (e.g. the WebSub secret) must never be
        // mutated on the strength of a request that might still fail.
        async function logAndRespond(action, targetUrl, requestBody, call, onSuccess) {
            broadcastOutgoingRequest(sessionId, {
                id: logId,
                timestamp: new Date().toISOString(),
                method: 'POST',
                url: targetUrl,
                body: { action, ...requestBody }
            });
            try {
                const result = await call();
                onSuccess?.(result);
                broadcast(sessionId, {
                    id: logId,
                    direction: 'outgoing',
                    phase: 'response',
                    timestamp: new Date().toISOString(),
                    ...result
                });
                res.json(result);
            } catch (error) {
                // An egress-guard refusal carries an actionable hint (set
                // DEBUG_FETCH_ALLOW_CIDRS) so the failure isn't mistaken for a
                // success in both the traffic log and the browser banner.
                const message = describeActionError(error);
                broadcast(sessionId, {
                    id: logId,
                    direction: 'outgoing',
                    phase: 'response',
                    timestamp: new Date().toISOString(),
                    error: message
                });
                res.json({ error: message });
            }
        }

        if (protocol === 'websub') {
            const hub = createWebSubClient({
                serverUrl: serverOverride || config.hubServerUrl,
                path: serverOverride ? '' : undefined,
                fetch
            });
            await logAndRespond(
                'websub-subscribe',
                serverOverride || hubUrl,
                // Redact the secret in the logged/broadcast copy — it's still
                // sent verbatim to the hub below, just never echoed into the
                // traffic log or session.requestLog.
                { topicUrl: feedUrl, leaseSeconds, secret: secret ? '(redacted)' : undefined },
                () => hub.subscribe({
                    callbackUrl: webSubCallbackUrl(sessionId),
                    topicUrl: feedUrl,
                    leaseSeconds,
                    secret
                }),
                () => {
                    if (secret) {
                        req.session.webSubSecrets[feedUrl] = secret;
                    } else {
                        delete req.session.webSubSecrets[feedUrl];
                    }
                }
            );
            return;
        }

        const useXmlRpc = protocol === 'rsscloud-xml-rpc';
        const rssCloudClient = createRssCloudClient({
            serverUrl: serverOverride || config.hubServerUrl,
            fetch
        });
        const subscribeParams = {
            protocol: useXmlRpc ? 'xml-rpc' : 'http-post',
            callback: {
                domain: config.domain,
                port: config.port,
                path: useXmlRpc
                    ? `/s/${sessionId}/RPC2`
                    : `/s/${sessionId}/notify`
            },
            feedUrl
        };
        await logAndRespond(
            'pleaseNotify',
            serverOverride || config.hubServerUrl,
            subscribeParams,
            () => rssCloudClient.pleaseNotify(subscribeParams)
        );
    });

    // Route: unified Unsubscribe action (WebSub only).
    sessionRouter.post('/actions/unsubscribe', ensureSession, jsonParser, async(req, res) => {
        const sessionId = req.params.sessionId;
        const { server: serverOverride } = req.body;
        const feedUrl = resolveFeedUrl(sessionId, req.body);
        const logId = crypto.randomUUID();

        const hub = createWebSubClient({
            serverUrl: serverOverride || config.hubServerUrl,
            path: serverOverride ? '' : undefined,
            fetch
        });

        broadcastOutgoingRequest(sessionId, {
            id: logId,
            timestamp: new Date().toISOString(),
            method: 'POST',
            url: serverOverride || hubUrl,
            body: { action: 'websub-unsubscribe', topicUrl: feedUrl }
        });

        try {
            const result = await hub.unsubscribe({
                callbackUrl: webSubCallbackUrl(sessionId),
                topicUrl: feedUrl
            });
            // Only drop the stored secret once the hub has actually
            // acknowledged the unsubscribe — a failed call shouldn't lose it.
            delete req.session.webSubSecrets[feedUrl];
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                ...result
            });
            res.json(result);
        } catch (error) {
            const message = describeActionError(error);
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                error: message
            });
            res.json({ error: message });
        }
    });

    // Route: unified Publish action (WebSub only). Deliberately accepts only
    // `feedName` — see the comment on /actions/ping for why.
    sessionRouter.post('/actions/publish', ensureSession, jsonParser, async(req, res) => {
        const sessionId = req.params.sessionId;
        const { feedName = 'rss-01.xml', server: serverOverride } = req.body;
        const feedUrl = `http://${config.domain}:${config.port}/s/${sessionId}/${feedName}`;
        const logId = crypto.randomUUID();

        if (!req.session.feedItems[feedName]) {
            req.session.feedItems[feedName] = [
                { title: 'initialized', timestamp: new Date() }
            ];
        }
        const now = new Date();
        req.session.feedItems[feedName].unshift({
            title: `Update at ${now.toISOString()}`,
            timestamp: now
        });

        const hub = createWebSubClient({
            serverUrl: serverOverride || config.hubServerUrl,
            path: serverOverride ? '' : undefined,
            fetch
        });

        broadcastOutgoingRequest(sessionId, {
            id: logId,
            timestamp: new Date().toISOString(),
            method: 'POST',
            url: serverOverride || hubUrl,
            body: { action: 'websub-publish', topicUrl: feedUrl }
        });

        try {
            const result = await hub.publish({ topicUrl: feedUrl });
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                ...result
            });
            res.json(result);
        } catch (error) {
            const message = describeActionError(error);
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                error: message
            });
            res.json({ error: message });
        }
    });

    // Route: unified Ping action. Deliberately accepts only `feedName` (never
    // an arbitrary feedUrl) — this session can only ever ping/publish a feed
    // it itself serves, never someone else's; that's the actual enforcement
    // point for "don't ping/publish someone else's feed" (the UI hiding
    // these controls in subscriber mode is a client-side mirror of this).
    sessionRouter.post('/actions/ping', ensureSession, jsonParser, async(req, res) => {
        const sessionId = req.params.sessionId;
        const { protocol, feedName = 'rss-01.xml', server: serverOverride } =
            req.body;
        const feedUrl = `http://${config.domain}:${config.port}/s/${sessionId}/${feedName}`;
        const logId = crypto.randomUUID();

        if (!req.session.feedItems[feedName]) {
            req.session.feedItems[feedName] = [
                { title: 'initialized', timestamp: new Date() }
            ];
        }
        const now = new Date();
        req.session.feedItems[feedName].unshift({
            title: `Update at ${now.toISOString()}`,
            timestamp: now
        });

        const rssCloudClient = createRssCloudClient({
            serverUrl: serverOverride || config.hubServerUrl,
            fetch
        });
        const pingParams = {
            feedUrl,
            transport: protocol === 'rsscloud-xml-rpc' ? 'xml-rpc' : 'rest'
        };

        broadcastOutgoingRequest(sessionId, {
            id: logId,
            timestamp: new Date().toISOString(),
            method: 'POST',
            url: serverOverride || config.hubServerUrl,
            body: { action: 'ping', ...pingParams }
        });

        try {
            const result = await rssCloudClient.ping(pingParams);
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                ...result
            });
            res.json(result);
        } catch (error) {
            const message = describeActionError(error);
            broadcast(sessionId, {
                id: logId,
                direction: 'outgoing',
                phase: 'response',
                timestamp: new Date().toISOString(),
                error: message
            });
            res.json({ error: message });
        }
    });

    // Route: WebSub intent verification — the hub GETs the callback with a
    // hub.challenge the subscriber must echo verbatim to confirm the subscription.
    sessionRouter.get('/websub-callback', requireLiveSession, (req, res) => {
        const verification = readVerification(req.query);
        if (verification) {
            res.send(verification.challenge);
            return;
        }
        res.status(404).send('Not a WebSub verification');
    });

    // Route: WebSub content distribution — the hub POSTs the full feed body
    // here. The request-logging middleware records the body, the hub/self
    // Link header, and the signature verdict; we just acknowledge with a 2xx.
    sessionRouter.post('/websub-callback', requireLiveSession, rawTextParser, (req, res) => {
        res.status(204).end();
    });

    // Route: Handle challenge verification for http-post subscriptions
    sessionRouter.get('/notify', requireLiveSession, (req, res) => {
        const challenge = req.query.challenge || '';
        res.send(challenge);
    });

    // Route: Handle HTTP-POST notifications
    sessionRouter.post('/notify', requireLiveSession, urlencodedParser, (req, res) => {
        // Body is already logged by middleware
        res.send('');
    });

    // Route: Handle XML-RPC notifications
    sessionRouter.post('/RPC2', requireLiveSession, textParser, (req, res) => {
        // Body is already logged by middleware; acknowledge with the boolean reply.
        res.type('text/xml').send(buildNotifyResponse());
    });

    // Route: Serve RSS feeds (must be after specific routes)
    sessionRouter.get('/:feedName', requireLiveSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const feedName = req.params.feedName;

        // Only serve .xml files as RSS feeds
        if (!feedName.endsWith('.xml')) {
            res.status(404).send('Not found');
            return;
        }

        const items = req.session.feedItems[feedName] || [
            { title: 'initialized', timestamp: new Date() }
        ];
        const feedUrl = `http://${config.domain}:${config.port}/s/${sessionId}/${feedName}`;

        const rssXml = renderCloudFeed({
            title: `Test Feed: ${feedName}`,
            link: feedUrl,
            description: 'Test feed for rssCloud',
            cloud: {
                domain: hubOrigin.hostname,
                port: hubPort,
                path: '/RPC2',
                registerProcedure: 'rssCloud.pleaseNotify',
                protocol: 'xml-rpc'
            },
            hub: hubUrl,
            items: items.map((item, index) => ({
                title: item.title,
                description: `Feed item: ${item.title}`,
                pubDate: item.timestamp,
                guid: `${feedName}-${index}`
            }))
        });
        res.type('application/rss+xml').send(rssXml);
    });

    app.use('/s/:sessionId', sessionRouter);

    app.locals.attachSessionSockets = attach;

    return app;
}

module.exports = { createApp };
