const { array, buildMethodCall, i4, str } = require('@rsscloud/xml-rpc');

// The subscriber+publisher logic the dev harness runs on. Lifted out of the
// retired @rsscloud/client package — a real subscriber must host a notify
// endpoint, so this is app logic, not a standalone library. It still builds its
// XML-RPC on the shared @rsscloud/xml-rpc codec and talks to a hub over an
// injectable fetch.

const FORM_TYPE = 'application/x-www-form-urlencoded';
const XML_TYPE = 'text/xml';

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

// Build a client bound to one hub. pleaseNotify/ping pick their front door from
// the request shape: an xml-rpc subscription and an xml-rpc ping go to /RPC2;
// everything else uses the REST front doors. `callback.domain` is optional and
// selects the hub's verification flow — given, the hub uses that host (with a
// challenge for http-post/https-post); omitted, it uses the caller's address.
function createRssCloudClient(options) {
    const doFetch = options.fetch ?? fetch;
    const base = options.serverUrl.replace(/\/$/, '');

    async function send(path, contentType, body) {
        const res = await doFetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body
        });
        return { status: res.status, body: await res.text() };
    }

    async function pleaseNotify(opts) {
        if (opts.protocol === 'xml-rpc') {
            return send(
                '/RPC2',
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
        return send('/pleaseNotify', FORM_TYPE, form.toString());
    }

    async function ping(opts) {
        if (opts.transport === 'xml-rpc') {
            return send('/RPC2', XML_TYPE, buildPingCall(opts.feedUrl));
        }
        return send(
            '/ping',
            FORM_TYPE,
            new URLSearchParams({ url: opts.feedUrl }).toString()
        );
    }

    return { pleaseNotify, ping };
}

module.exports = { createRssCloudClient };
