const { array, buildMethodCall, i4, str } = require('@rsscloud/xml-rpc');

// The subscriber+publisher logic the dev harness runs on. Lifted out of the
// retired @rsscloud/client package — a real subscriber must host a notify
// endpoint, so this is app logic, not a standalone library. It still builds its
// XML-RPC on the shared @rsscloud/xml-rpc codec and talks to a hub over an
// injectable fetch.

const FORM_TYPE = 'application/x-www-form-urlencoded';
const XML_TYPE = 'text/xml';
// The REST endpoints negotiate their response format via `req.accepts()`,
// which resolves the 'xml' shorthand to this mime type (not the `text/xml`
// XML-RPC Content-Type convention above) — sending `text/xml` here would
// fail to match and get a 406.
const XML_ACCEPT_TYPE = 'application/xml';

// Build the rssCloud pleaseNotify methodCall — six positional params in wire
// order: notifyProcedure, port, path, protocol, urlList, domain.
function buildPleaseNotifyCall(params) {
    return buildMethodCall('rssCloud.pleaseNotify', [
        str(params.notifyProcedure),
        i4(params.port),
        str(params.path),
        str(params.protocol),
        array(params.urls.map(str)),
        str(params.domain)
    ]);
}

// Build the rssCloud ping methodCall carrying a single feed URL.
function buildPingCall(feedUrl) {
    return buildMethodCall('rssCloud.ping', [str(feedUrl)]);
}

// `accept` selects the Accept header for a REST call ('xml' | 'json'); the
// outgoing body is always urlencoded regardless — only the requested reply
// format varies. Absent, no Accept header override is sent.
function acceptHeader(accept) {
    if (!accept) {
        return undefined;
    }
    return { Accept: accept === 'json' ? 'application/json' : XML_ACCEPT_TYPE };
}

// Build a client bound to one hub. pleaseNotify/ping pick their front door from
// the request shape: an xml-rpc subscription and an xml-rpc ping go to /RPC2;
// everything else uses the REST front doors. `callback.domain` is optional and
// selects the hub's verification flow — given, the hub uses that host (with a
// challenge for http-post/https-post); omitted, it uses the caller's address.
// Every call accepts an explicit `url` to target instead of `serverUrl` +
// its conventional suffix — `serverUrl` is only required when no call ever
// passes one.
function createRssCloudClient(options) {
    const doFetch = options.fetch ?? fetch;
    const onRequest = options.onRequest;
    const base = options.serverUrl ? options.serverUrl.replace(/\/$/, '') : undefined;

    // Reports the exact request about to go out (method/url/headers/body) to
    // onRequest, synchronously and before the fetch resolves — so a caller
    // logging outgoing traffic observes the real bytes sent, never a
    // separately-reconstructed approximation that could drift from it.
    async function send(url, contentType, body, extraHeaders) {
        const request = {
            method: 'POST',
            url,
            headers: { 'Content-Type': contentType, ...extraHeaders },
            body
        };
        onRequest?.(request);
        const res = await doFetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body
        });
        return { status: res.status, body: await res.text() };
    }

    async function pleaseNotify(opts) {
        if (opts.protocol === 'xml-rpc') {
            return send(
                opts.url ?? `${base}/RPC2`,
                XML_TYPE,
                buildPleaseNotifyCall({
                    notifyProcedure: 'rssCloud.notify',
                    port: opts.callback.port,
                    path: opts.callback.path,
                    protocol: opts.protocol,
                    urls: [opts.feedUrl],
                    domain: opts.callback.domain ?? ''
                })
            );
        }
        const form = new URLSearchParams({
            port: String(opts.callback.port),
            path: opts.callback.path,
            protocol: opts.protocol,
            url1: opts.feedUrl
        });
        if (opts.callback.domain) {
            form.set('domain', opts.callback.domain);
        }
        return send(
            opts.url ?? `${base}/pleaseNotify`,
            FORM_TYPE,
            form.toString(),
            acceptHeader(opts.accept)
        );
    }

    async function ping(opts) {
        if (opts.transport === 'xml-rpc') {
            return send(opts.url ?? `${base}/RPC2`, XML_TYPE, buildPingCall(opts.feedUrl));
        }
        return send(
            opts.url ?? `${base}/ping`,
            FORM_TYPE,
            new URLSearchParams({ url: opts.feedUrl }).toString(),
            acceptHeader(opts.accept)
        );
    }

    return { pleaseNotify, ping };
}

module.exports = { createRssCloudClient };
