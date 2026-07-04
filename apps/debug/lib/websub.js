const FORM_TYPE = 'application/x-www-form-urlencoded';

// Build a WebSub client bound to one hub. subscribe/unsubscribe/publish all POST
// an `hub.*` urlencoded form to the hub's single front door (default `/websub`)
// over an injectable fetch, and resolve to the hub's raw reply ({ status, body })
// without throwing on a non-2xx — inspect `status` yourself.
function createWebSubClient(options) {
    const doFetch = options.fetch ?? fetch;
    const base = options.serverUrl.replace(/\/$/, '');
    const path = options.path ?? '/websub';

    async function send(form) {
        const res = await doFetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': FORM_TYPE },
            body: form.toString()
        });
        return { status: res.status, body: await res.text() };
    }

    // The callback+topic form both subscribe and unsubscribe open with.
    function callbackForm(mode, opts) {
        return new URLSearchParams({
            'hub.mode': mode,
            'hub.callback': opts.callbackUrl,
            'hub.topic': opts.topicUrl
        });
    }

    async function subscribe(opts) {
        const form = callbackForm('subscribe', opts);
        if (opts.leaseSeconds !== undefined) {
            form.set('hub.lease_seconds', String(opts.leaseSeconds));
        }
        if (opts.secret !== undefined) {
            form.set('hub.secret', opts.secret);
        }
        return send(form);
    }

    async function unsubscribe(opts) {
        return send(callbackForm('unsubscribe', opts));
    }

    async function publish(opts) {
        return send(
            new URLSearchParams({
                'hub.mode': 'publish',
                'hub.url': opts.topicUrl
            })
        );
    }

    return { subscribe, unsubscribe, publish };
}

// Read a hub's intent-verification GET query (Express `req.query`). A WebSub
// verification always carries `hub.mode` and a `hub.challenge` the subscriber
// must echo verbatim; returns the parsed fields, or `null` when the query isn't
// a verification (so the callback can fall through). `hub.lease_seconds` rides
// along on subscribe verifications only.
function readVerification(query) {
    const mode = query['hub.mode'];
    const challenge = query['hub.challenge'];
    if (typeof mode !== 'string' || typeof challenge !== 'string') {
        return null;
    }
    const parsed = {
        mode,
        topic: query['hub.topic'],
        challenge
    };
    const lease = query['hub.lease_seconds'];
    if (lease !== undefined) {
        parsed.leaseSeconds = Number(lease);
    }
    return parsed;
}

module.exports = { createWebSubClient, readVerification };
