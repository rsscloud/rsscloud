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
    {
        applyDiscoveryToSettings,
        isSelfHostedFeedUrl,
        feedNameFromSelfHostedUrl,
        selfHostedPrefixes,
        computeDefaultSettings
    } = require('./lib/settings'),
    textParser = bodyParser.text({ type: '*/xml' }),
    // Content distribution arrives with the origin feed's Content-Type relayed
    // verbatim, so the callback parses any media type as a raw string to log it.
    rawTextParser = bodyParser.text({ type: () => true }),
    urlencodedParser = bodyParser.urlencoded({ extended: false }),
    jsonParser = bodyParser.json();

// Derive a self-served test feed's <cloud> element from a session's own
// rssCloud settings — undefined (omitted entirely) when rssCloud is
// disabled. The RPC2 endpoint doubles as both ping and subscribe front door.
// Split a parsed URL into rssCloud's wire {domain, port} shape — hostname,
// and an explicit port or the scheme's conventional one (80/443) when
// omitted (a bare hostname URL still needs a real port on the wire).
function hostPortFromUrl(target) {
    return {
        domain: target.hostname,
        port: Number(target.port) || (target.protocol === 'https:' ? 443 : 80)
    };
}

function cloudFromSettings(rssCloud) {
    if (rssCloud.disabled) {
        return undefined;
    }
    const useXmlRpc = rssCloud.protocol === 'xml-rpc';
    const target = new URL(useXmlRpc ? rssCloud.rpcUrl : rssCloud.subscribeUrl);
    return {
        ...hostPortFromUrl(target),
        path: target.pathname,
        registerProcedure: useXmlRpc ? 'rssCloud.pleaseNotify' : '',
        protocol: rssCloud.protocol
    };
}

// A blank or malformed URL here would otherwise only surface later, as a
// 500 from cloudFromSettings the next time the self-served feed is
// requested — reject it at save time instead.
function isValidHttpUrl(value) {
    if (!value) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// This session's callback URL the hub notifies for WebSub content
// distribution and intent verification.
function webSubCallbackUrl(sessionId) {
    return `${config.publicUrl}/s/${sessionId}/websub-callback`;
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

// Debug-harness-specific additions layered on the shared server stylesheet,
// shared between the main page and the settings page.
const debugStyles = `
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
        /* style.css's label { display: block } stretches these checkbox
           labels across the whole fieldset, so clicking far past the
           "Disabled" text still toggles the checkbox. Shrink to content. */
        .checkbox-label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            width: auto;
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
        /* The settings form's own Save/Cancel bar (a direct child of <form>,
           unlike the per-fieldset action rows nested inside it) needs space
           from the last fieldset above it, and vertical centering so the
           plain-text Cancel link lines up with the Save button. */
        form > .actions {
            margin-top: 20px;
            align-items: center;
        }
        .page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .page-header h1 {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }
        .settings-link {
            color: #2c3e50;
            line-height: 0;
        }
        /* style.css sets an explicit display on label/div, which otherwise
           overrides the [hidden] attribute's implicit display:none. */
        .rsscloud-rest-only[hidden],
        .rsscloud-xmlrpc-only[hidden],
        .websub-fields-body[hidden] {
            display: none;
        }
`;

// A generic gear/cog icon — the settings page's entry point, right-justified
// from the heading.
const gearIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 00-.6.22L2.66 8.84a.5.5 0 00.12.64l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94L2.76 14.5a.5.5 0 00-.12.64l1.92 3.32c.14.24.42.34.68.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.28.27.42.5.42h3.84c.28 0 .46-.14.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.28.12.54 0 .68-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.02-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/>
</svg>`;

// Render the simplified control box (Feed / rssCloud / WebSub rows, each
// driven entirely by the session's saved settings) + live traffic log.
// Row/button visibility is computed server-side by the caller (see
// `GET /` below) and baked into the markup, not toggled client-side.
function renderPage(sessionId, wsUrl, settings, { isSelfHosted, showPing, lastUpdatedAt }) {
    const feedRow = isSelfHosted
        ? `<p class="feed-url">Feed URL: <code>${escapeHtml(settings.feedUrl)}</code></p>
            <div class="actions">
                <button type="button" id="updateFeedButton">Update Feed</button>
            </div>
            <p class="feed-url">Last updated: <span id="feedLastUpdated">${escapeHtml(lastUpdatedAt.toISOString())}</span></p>`
        : `<p class="feed-url">External feed: <code>${escapeHtml(settings.feedUrl)}</code></p>`;

    const rssCloudRow = settings.rssCloud.disabled
        ? ''
        : `<fieldset>
            <legend>rssCloud</legend>
            <div class="actions">
                <button type="button" id="rsscloudSubscribeButton">Subscribe</button>
                ${showPing ? '<button type="button" id="rsscloudPingButton">Ping</button>' : ''}
            </div>
        </fieldset>`;

    const webSubRow = settings.webSub.disabled
        ? ''
        : `<fieldset>
            <legend>WebSub</legend>
            <div class="actions">
                <button type="button" id="websubSubscribeButton">Subscribe</button>
                <button type="button" id="websubUnsubscribeButton">Unsubscribe</button>
                <button type="button" id="websubPublishButton">Publish</button>
            </div>
        </fieldset>`;

    return `<!DOCTYPE html>
<html>
<head>
    <title>rssCloud Debug</title>
    <link href="/css/style.css" rel="stylesheet" />
    <style>${debugStyles}</style>
</head>
<body data-session-id="${escapeHtml(sessionId)}">
    <div class="page-header">
        <h1>rssCloud Debug</h1>
        <a class="settings-link" href="/s/${escapeHtml(sessionId)}/settings" aria-label="Settings" title="Settings">${gearIconSvg}</a>
    </div>

    <div class="controls">
        <fieldset>
            <legend>Feed</legend>
            ${feedRow}
        </fieldset>
        ${rssCloudRow}
        ${webSubRow}
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

// Render the settings page — starts from the session's current settings
// (computed defaults on first visit, whatever was last saved after that).
// Protocol-dependent field visibility is toggled client-side (public/settings.js)
// since it must react live to the form's own dropdown/checkbox changes.
function renderSettingsPage(sessionId, settings, { error } = {}) {
    const ctx = { publicUrl: config.publicUrl, sessionId };
    const context = {
        selfHostedPrefixes: selfHostedPrefixes(ctx),
        defaultSettings: computeDefaultSettings({ ...ctx, hubServerUrl: config.hubServerUrl })
    };

    return `<!DOCTYPE html>
<html>
<head>
    <title>rssCloud Debug: Settings</title>
    <link href="/css/style.css" rel="stylesheet" />
    <style>${debugStyles}</style>
</head>
<body>
    <h1>rssCloud Debug: Settings</h1>

    <form method="POST" action="/s/${escapeHtml(sessionId)}/settings" data-context='${escapeHtml(JSON.stringify(context))}'>
        <label for="feedUrl">Feed URL</label>
        <div class="input-with-button">
            <input type="text" id="feedUrl" name="feedUrl" value="${escapeHtml(settings.feedUrl)}">
            <button type="button" id="feedUrlResetButton"${isSelfHostedFeedUrl(settings.feedUrl, ctx) ? ' disabled' : ''}>Reset</button>
        </div>

        <fieldset id="rsscloudFields">
            <legend>rssCloud</legend>
            <label class="checkbox-label">
                <input type="checkbox" id="rssCloudDisabled" name="rssCloudDisabled" ${settings.rssCloud.disabled ? 'checked' : ''}>
                Disabled
            </label>
            <div class="rsscloud-fields-body">
                <div class="form-row">
                    <label for="rssCloudProtocol">
                        Protocol
                        <select id="rssCloudProtocol" name="rssCloudProtocol">
                            <option value="http-post" ${settings.rssCloud.protocol === 'http-post' ? 'selected' : ''}>http-post</option>
                            <option value="https-post" ${settings.rssCloud.protocol === 'https-post' ? 'selected' : ''}>https-post</option>
                            <option value="xml-rpc" ${settings.rssCloud.protocol === 'xml-rpc' ? 'selected' : ''}>xml-rpc</option>
                        </select>
                    </label>
                    <label for="rssCloudAccepts" class="rsscloud-rest-only">
                        Accepts
                        <select id="rssCloudAccepts" name="rssCloudAccepts">
                            <option value="xml" ${settings.rssCloud.accepts === 'xml' ? 'selected' : ''}>xml</option>
                            <option value="json" ${settings.rssCloud.accepts === 'json' ? 'selected' : ''}>json</option>
                        </select>
                    </label>
                </div>
                <div class="form-row rsscloud-rest-only">
                    <label for="rssCloudPingUrl">
                        Ping URL
                        <input type="text" id="rssCloudPingUrl" name="rssCloudPingUrl" value="${escapeHtml(settings.rssCloud.pingUrl)}">
                    </label>
                    <label for="rssCloudSubscribeUrl">
                        Subscribe URL
                        <input type="text" id="rssCloudSubscribeUrl" name="rssCloudSubscribeUrl" value="${escapeHtml(settings.rssCloud.subscribeUrl)}">
                    </label>
                </div>
                <label for="rssCloudRpcUrl" class="rsscloud-xmlrpc-only">
                    RPC2 endpoint
                    <input type="text" id="rssCloudRpcUrl" name="rssCloudRpcUrl" value="${escapeHtml(settings.rssCloud.rpcUrl)}">
                </label>
            </div>
        </fieldset>

        <fieldset id="webSubFields">
            <legend>WebSub</legend>
            <label class="checkbox-label">
                <input type="checkbox" id="webSubDisabled" name="webSubDisabled" ${settings.webSub.disabled ? 'checked' : ''}>
                Disabled
            </label>
            <div class="websub-fields-body">
                <label for="webSubHubUrl">
                    Hub URL
                    <input type="text" id="webSubHubUrl" name="webSubHubUrl" value="${escapeHtml(settings.webSub.hubUrl)}">
                </label>
                <div class="form-row">
                    <label for="webSubLeaseSeconds">
                        lease_seconds
                        <input type="text" id="webSubLeaseSeconds" name="webSubLeaseSeconds" value="${escapeHtml(String(settings.webSub.leaseSeconds ?? ''))}" placeholder="optional">
                    </label>
                    <label for="webSubSecret">
                        secret
                        <input type="password" id="webSubSecret" name="webSubSecret" value="${escapeHtml(settings.webSub.secret ?? '')}" placeholder="optional">
                    </label>
                </div>
            </div>
        </fieldset>

        <div id="actionError" class="action-error" role="alert"${error ? '' : ' hidden'}>${error ? escapeHtml(error) : ''}</div>
        <div class="actions">
            <button type="submit">Save</button>
            <a href="/s/${escapeHtml(sessionId)}">Cancel</a>
        </div>
    </form>

    <script type="module" src="/settings.js"></script>
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

    app.set('trust proxy', true);

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
        const sessionId = req.params.sessionId;
        const wsProtocol = req.protocol === 'https' ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${req.get('host')}/s/${sessionId}/logs`;
        const { settings } = req.session;
        const ctx = { publicUrl: config.publicUrl, sessionId };
        const isSelfHosted = isSelfHostedFeedUrl(settings.feedUrl, ctx);
        const showPing = settings.rssCloud.protocol === 'xml-rpc' || Boolean(settings.rssCloud.pingUrl);
        const lastUpdatedAt = isSelfHosted
            ? req.session.feedLastUpdatedAt[feedNameFromSelfHostedUrl(settings.feedUrl, ctx)] ?? new Date(req.session.createdAt)
            : undefined;
        res.type('html').send(
            renderPage(sessionId, wsUrl, settings, { isSelfHosted, showPing, lastUpdatedAt })
        );
    });

    // Route: settings page — starts from the session's current settings.
    sessionRouter.get('/settings', ensureSession, (req, res) => {
        res.type('html').send(renderSettingsPage(req.params.sessionId, req.session.settings));
    });

    // Route: Save — a real <form> POST (not a fetch action), so the browser
    // navigates back to the main page on success. body-parser's urlencoded
    // mode doesn't support nested keys, so the form uses flat field names,
    // reassembled here into the nested settings shape.
    sessionRouter.post('/settings', ensureSession, urlencodedParser, (req, res) => {
        const rssCloud = {
            disabled: req.body.rssCloudDisabled === 'on',
            protocol: req.body.rssCloudProtocol,
            accepts: req.body.rssCloudAccepts,
            pingUrl: req.body.rssCloudPingUrl || '',
            subscribeUrl: req.body.rssCloudSubscribeUrl,
            rpcUrl: req.body.rssCloudRpcUrl
        };

        // Whichever URL cloudFromSettings will actually read (rpcUrl for
        // xml-rpc, else subscribeUrl) must be valid before it's saved — a
        // blank/malformed one otherwise only surfaces later as a 500 the
        // next time the self-served feed is requested.
        if (!rssCloud.disabled) {
            const requiredUrl = rssCloud.protocol === 'xml-rpc' ? rssCloud.rpcUrl : rssCloud.subscribeUrl;
            if (!isValidHttpUrl(requiredUrl)) {
                res.status(400).type('html').send(renderSettingsPage(req.params.sessionId, {
                    feedUrl: req.body.feedUrl,
                    rssCloud,
                    webSub: {
                        disabled: req.body.webSubDisabled === 'on',
                        hubUrl: req.body.webSubHubUrl,
                        leaseSeconds: req.body.webSubLeaseSeconds || '',
                        secret: req.body.webSubSecret || ''
                    }
                }, {
                    error: rssCloud.protocol === 'xml-rpc'
                        ? 'rssCloud is enabled but the RPC2 endpoint URL is missing or invalid.'
                        : 'rssCloud is enabled but the subscribe URL is missing or invalid.'
                }));
                return;
            }
        }

        req.session.settings = {
            feedUrl: req.body.feedUrl,
            rssCloud,
            webSub: {
                disabled: req.body.webSubDisabled === 'on',
                hubUrl: req.body.webSubHubUrl,
                leaseSeconds: req.body.webSubLeaseSeconds || '',
                secret: req.body.webSubSecret || ''
            }
        };
        res.redirect(302, `/s/${req.params.sessionId}`);
    });

    // Route: preview what settings a feed URL would produce, for the
    // settings page's Feed-URL-blur discovery. Never writes
    // req.session.settings — only POST /settings (Save) persists anything.
    sessionRouter.post('/actions/discover-settings', ensureSession, jsonParser, async(req, res) => {
        const { feedUrl, currentSettings } = req.body;

        try {
            const result = await discoverFeed({ url: feedUrl, fetch });
            if (result.error) {
                res.json({ settings: null, error: result.error });
                return;
            }
            res.json({ settings: applyDiscoveryToSettings(currentSettings, result) });
        } catch (error) {
            res.json({ settings: null, error: describeActionError(error) });
        }
    });

    // A urlencoded wire body is logged as a plain object (matching how the
    // incoming-request logging middleware already logs req.body); an XML-RPC
    // body is already human-readable, so it's logged as-is.
    function parseLoggedBody(headers, body) {
        if (headers['Content-Type'] === 'application/x-www-form-urlencoded') {
            return Object.fromEntries(new URLSearchParams(body));
        }
        return body;
    }

    // The client's onRequest hook fires with the real request (method/url/
    // headers/body) synchronously, before the fetch is dispatched — logging
    // that directly means the traffic log can never drift from what's
    // actually sent. `redact` optionally scrubs sensitive fields from the
    // logged copy only (the real request, already captured by the client,
    // is unaffected).
    function onOutgoingRequest(sessionId, logId, redact) {
        return request => {
            const body = parseLoggedBody(request.headers, request.body);
            if (redact && body && typeof body === 'object') {
                redact(body);
            }
            broadcastOutgoingRequest(sessionId, {
                id: logId,
                timestamp: new Date().toISOString(),
                method: request.method,
                url: request.url,
                body
            });
        };
    }

    // Shared by every settings-driven action below: broadcasts the response
    // half of the request/response pair around `call()` (the request half is
    // already broadcast by the client's onRequest hook — see above), and
    // never mutates session state (via `onSuccess`) on the strength of a
    // request that might still fail.
    function logAndRespondAction(sessionId, res, logId, call, onSuccess) {
        return call()
            .then(result => {
                onSuccess?.(result);
                broadcast(sessionId, {
                    id: logId,
                    direction: 'outgoing',
                    phase: 'response',
                    timestamp: new Date().toISOString(),
                    ...result
                });
                res.json(result);
            })
            .catch(error => {
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
            });
    }

    // Route: rssCloud Subscribe — targets whichever endpoint the session's
    // settings configure (the RPC2 endpoint for xml-rpc, else the configured
    // subscribe URL).
    sessionRouter.post('/actions/rsscloud-subscribe', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const { disabled, protocol, accepts, subscribeUrl, rpcUrl } = settings.rssCloud;

        if (disabled) {
            res.json({ error: 'rssCloud is disabled in settings' });
            return;
        }

        const useXmlRpc = protocol === 'xml-rpc';
        const targetUrl = useXmlRpc ? rpcUrl : subscribeUrl;
        const logId = crypto.randomUUID();
        const rssCloudClient = createRssCloudClient({
            fetch,
            onRequest: onOutgoingRequest(sessionId, logId)
        });
        const subscribeParams = {
            url: targetUrl,
            protocol,
            accept: useXmlRpc ? undefined : accepts,
            callback: {
                ...hostPortFromUrl(new URL(config.publicUrl)),
                path: useXmlRpc
                    ? `/s/${sessionId}/RPC2`
                    : `/s/${sessionId}/notify`
            },
            feedUrl: settings.feedUrl
        };

        logAndRespondAction(
            sessionId,
            res,
            logId,
            () => rssCloudClient.pleaseNotify(subscribeParams)
        );
    });

    // Route: rssCloud Ping — targets the RPC2 endpoint for xml-rpc, else the
    // configured ping URL (which may be blank — the caller isn't testing
    // ping — in which case there's nothing to call).
    sessionRouter.post('/actions/rsscloud-ping', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const { disabled, protocol, accepts, pingUrl, rpcUrl } = settings.rssCloud;

        if (disabled) {
            res.json({ error: 'rssCloud is disabled in settings' });
            return;
        }

        const useXmlRpc = protocol === 'xml-rpc';
        if (!useXmlRpc && !pingUrl) {
            res.json({ error: 'no ping URL configured' });
            return;
        }

        const targetUrl = useXmlRpc ? rpcUrl : pingUrl;
        const logId = crypto.randomUUID();
        const rssCloudClient = createRssCloudClient({
            fetch,
            onRequest: onOutgoingRequest(sessionId, logId)
        });
        const pingParams = {
            url: targetUrl,
            feedUrl: settings.feedUrl,
            transport: useXmlRpc ? 'xml-rpc' : 'rest',
            accept: useXmlRpc ? undefined : accepts
        };

        logAndRespondAction(
            sessionId,
            res,
            logId,
            () => rssCloudClient.ping(pingParams)
        );
    });

    // Route: WebSub Subscribe — targets the session's configured hub URL.
    sessionRouter.post('/actions/websub-subscribe', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const feedUrl = settings.feedUrl;

        if (settings.webSub.disabled) {
            res.json({ error: 'WebSub is disabled in settings' });
            return;
        }

        const { hubUrl: targetUrl, leaseSeconds, secret } = settings.webSub;
        const logId = crypto.randomUUID();
        const hub = createWebSubClient({
            serverUrl: targetUrl,
            path: '',
            fetch,
            // Redact the secret in the logged/broadcast copy only — it's
            // still sent verbatim to the hub below, just never echoed into
            // the log.
            onRequest: onOutgoingRequest(sessionId, logId, body => {
                if (body['hub.secret']) {
                    body['hub.secret'] = '(redacted)';
                }
            })
        });

        logAndRespondAction(
            sessionId,
            res,
            logId,
            () => hub.subscribe({
                callbackUrl: webSubCallbackUrl(sessionId),
                topicUrl: feedUrl,
                leaseSeconds: leaseSeconds || undefined,
                secret: secret || undefined
            }),
            () => {
                if (secret) {
                    req.session.webSubSecrets[feedUrl] = secret;
                } else {
                    delete req.session.webSubSecrets[feedUrl];
                }
            }
        );
    });

    // Route: WebSub Unsubscribe — targets the session's configured hub URL.
    sessionRouter.post('/actions/websub-unsubscribe', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const feedUrl = settings.feedUrl;

        if (settings.webSub.disabled) {
            res.json({ error: 'WebSub is disabled in settings' });
            return;
        }

        const targetUrl = settings.webSub.hubUrl;
        const logId = crypto.randomUUID();
        const hub = createWebSubClient({
            serverUrl: targetUrl,
            path: '',
            fetch,
            onRequest: onOutgoingRequest(sessionId, logId)
        });

        logAndRespondAction(
            sessionId,
            res,
            logId,
            () => hub.unsubscribe({
                callbackUrl: webSubCallbackUrl(sessionId),
                topicUrl: feedUrl
            }),
            // Only drop the stored secret once the hub has actually
            // acknowledged the unsubscribe — a failed call shouldn't lose it.
            () => { delete req.session.webSubSecrets[feedUrl]; }
        );
    });

    // Route: WebSub Publish — targets the session's configured hub URL. No
    // longer touches feedItems (see Update Feed below) — Publish just
    // notifies about whatever the feed currently holds.
    sessionRouter.post('/actions/websub-publish', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const feedUrl = settings.feedUrl;

        if (settings.webSub.disabled) {
            res.json({ error: 'WebSub is disabled in settings' });
            return;
        }

        const targetUrl = settings.webSub.hubUrl;
        const logId = crypto.randomUUID();
        const hub = createWebSubClient({
            serverUrl: targetUrl,
            path: '',
            fetch,
            onRequest: onOutgoingRequest(sessionId, logId)
        });

        logAndRespondAction(
            sessionId,
            res,
            logId,
            () => hub.publish({ topicUrl: feedUrl })
        );
    });

    // Route: Update Feed — the only action that adds a new item to a
    // self-hosted feed and bumps its "last updated" timestamp. Ping/Publish
    // above just notify about whatever content is already there.
    sessionRouter.post('/actions/update-feed', ensureSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const { settings } = req.session;
        const ctx = { publicUrl: config.publicUrl, sessionId };

        if (!isSelfHostedFeedUrl(settings.feedUrl, ctx)) {
            res.json({ error: 'feed is not self-hosted' });
            return;
        }

        const feedName = feedNameFromSelfHostedUrl(settings.feedUrl, ctx);
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
        req.session.feedLastUpdatedAt[feedName] = now;

        res.json({ lastUpdatedAt: now });
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

    // Route: Serve RSS feeds (must be after specific routes). The <cloud>/hub
    // this session's own test feed advertises reflects its own settings, not
    // the global default — so discovering your own test feed round-trips
    // against whatever hub you're actually testing.
    sessionRouter.get('/:feedName', requireLiveSession, (req, res) => {
        const sessionId = req.params.sessionId;
        const feedName = req.params.feedName;

        // Only serve .xml files as RSS feeds
        if (!feedName.endsWith('.xml')) {
            res.status(404).send('Not found');
            return;
        }

        const { settings } = req.session;
        const items = req.session.feedItems[feedName] || [
            { title: 'initialized', timestamp: new Date() }
        ];
        const feedUrl = `${config.publicUrl}/s/${sessionId}/${feedName}`;
        const hub = settings.webSub.disabled ? undefined : settings.webSub.hubUrl;

        const rssXml = renderCloudFeed({
            title: `Test Feed: ${feedName}`,
            link: feedUrl,
            description: 'Test feed for rssCloud',
            cloud: cloudFromSettings(settings.rssCloud),
            hub,
            items: items.map((item, index) => ({
                title: item.title,
                description: `Feed item: ${item.title}`,
                pubDate: item.timestamp,
                guid: `${feedName}-${index}`
            }))
        });
        // Advertise the hub via the HTTP Link header too, not just the feed
        // body — a real WebSub-supporting server typically does both.
        if (hub) {
            res.set('Link', `<${hub}>; rel="hub"`);
        }
        res.type('application/rss+xml').send(rssXml);
    });

    app.use('/s/:sessionId', sessionRouter);

    app.locals.attachSessionSockets = attach;

    return app;
}

module.exports = { createApp };
