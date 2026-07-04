# @rsscloud/debug

An interactive **test harness** for the [rssCloud](https://github.com/rsscloud/rsscloud-server)
notification protocol and [WebSub](https://www.w3.org/TR/websub/) — the subscriber +
publisher end, the mirror of `@rsscloud/core` (the hub end). Unlike most of this monorepo
it's designed to be deployable as a **public utility**: it can test a hub running locally,
a hub deployed live, or any third party's rssCloud/WebSub implementation.

The Express app ([`debug.js`](debug.js)) serves a simple three-row action box (Feed / rssCloud /
WebSub) driven by a per-session **Settings** page, reachable via the gear icon next to the
heading. Settings start at computed defaults (based on `HUB_SERVER_URL`) and can point this
session's own test feed or an arbitrary external one at whichever rssCloud protocol (REST or
XML-RPC) and/or WebSub hub you're testing — entering an external feed URL triggers discovery
(traditional `<cloud>` or the newer `<source:cloud>`, a WebSub hub via `Link` header or feed
element) to prefill the rest of the form. Saving settings navigates back to the main page,
where the row of buttons acts against whatever's configured; the outcome — and everything this
harness receives — shows up as a live traffic log via
[`@andrewshell/socklog`](https://www.npmjs.com/package/@andrewshell/socklog) (purely live, not
stored server-side — a reload always starts with an empty log). All the protocol wire work
lives in [`lib/`](lib/) and is reusable on its own.

## Sessions

Visiting `/` mints a session id and redirects to `/s/<id>` — that path prefix is the root
for everything this browser session does: the UI, its test feed(s), and every callback route
a hub calls back into (`/notify`, `/RPC2`, `/websub-callback`). This keeps concurrent public
users' logs, feeds, and subscriptions from ever crossing.

A session's callback/feed routes 404 once it's gone `SESSION_CALLBACK_IDLE_MS` (default 1h)
without an outgoing action — a hub that keeps probing a long-abandoned subscription gets
nothing back. The UI itself keeps working past that point (acting again resumes it). A
session is fully evicted from memory after `SESSION_GC_IDLE_MS` (default 24h) of inactivity,
independent of the callback cutoff, so a long-running public deployment doesn't leak memory.

Both cutoffs are suspended while a session has a live socklog connection — leaving the page
open (e.g. watching an external feed overnight) counts as active use on its own, even with no
button clicked, so its callback surface stays reachable and it's never evicted.

## Running

From the repo root:

```bash
pnpm debug           # start in watch mode (nodemon)
```

Or from this package:

```bash
pnpm --filter @rsscloud/debug run dev    # watch mode
pnpm --filter @rsscloud/debug start      # one-shot
```

Copy `.env.example` to `.env` and adjust — the defaults target a hub at
`http://localhost:5337` (this repo's own server, run locally) with loopback exempted from
the outbound SSRF guard for local dev. See `.env.example` for the full list of env vars
(`DOMAIN`, `PORT`, `HUB_SERVER_URL`, `DEBUG_FETCH_ALLOW_CIDRS`, `REQUEST_TIMEOUT`,
`SESSION_CALLBACK_IDLE_MS`, `SESSION_GC_IDLE_MS`, `SESSION_GC_INTERVAL_MS`). Requires Node 22+.

Every outbound call this harness makes (feed discovery, pleaseNotify/ping, WebSub `hub.*`) is
routed through the same SSRF-guarded fetch `@rsscloud/core` gives the hub server — refusing
loopback/private/link-local targets by default, since a public deployment lets any visitor
make it originate arbitrary requests. `DEBUG_FETCH_ALLOW_CIDRS` re-enables loopback for local
dev; delete it before deploying publicly.

## Docker

```bash
docker build -f apps/debug/Dockerfile -t rsscloud-debug .
docker run -p 9000:9000 --env-file apps/debug/.env rsscloud-debug
```

See [`examples/dockge/compose.yaml`](../../examples/dockge/compose.yaml) for a stack pairing
this harness with the hub server.

## The `lib/` API

`require('./lib')` exposes these helpers (CommonJS):

- **`createRssCloudClient({ serverUrl?, fetch? })`** — send `pleaseNotify` (subscribe) and
  `ping` (publish) to a hub over an injectable `fetch`. Returns `{ pleaseNotify, ping }`; both
  accept an explicit `url` to target instead of `serverUrl` + its conventional suffix (so
  `serverUrl` is only required when no call ever passes one), and an `accept` (`'xml'|'json'`)
  that sets the `Accept` header on a REST call — the outgoing body is always urlencoded
  regardless, since the real wire protocol only ever parses that.
- **`createWebSubClient({ serverUrl, path?, fetch? })`** — send WebSub `hub.*` requests to a
  hub's front door (`path` defaults to `/websub`). Returns `{ subscribe, unsubscribe, publish }`;
  each resolves to the hub's raw reply (`{ status, body }`) and does **not** throw on a non-2xx.
- **`readVerification(query)`** — given a callback GET's query, return
  `{ mode, topic, challenge, leaseSeconds }` when it's a WebSub intent-verification request
  (the subscriber must echo `challenge` verbatim), else `null`.
- **`renderCloudFeed(feed)`** — emit an RSS 2.0 document, optionally carrying the `<cloud>`
  element that advertises a hub (pass `cloud`; omitted entirely when not given). Pass `hub`
  (a URL) to also advertise a WebSub hub via `<atom:link rel="hub">` plus a `rel="self"` link.
- **`buildNotifyResponse(success)`** — build the XML-RPC notify acknowledgement a subscriber
  returns to the hub.
- **`discoverFeed({ url, fetch? })`** — fetch an arbitrary feed URL and report what it
  advertises: `{ rssCloud: {domain,port,path,registerProcedure,protocol} | null, webSub:
  {hubUrl} | null, selfUrl?, error? }`. rssCloud discovery prefers a `<source:cloud>` element
  (the [source.scripting.com](https://source.scripting.com/) convention, resolved by its actual
  bound namespace prefix) over a traditional `<cloud>` when both are present; WebSub hub/self
  discovery prefers the HTTP `Link` response header over a feed-embedded link when both are
  present. Backs the settings page's Feed-URL-blur discovery action.
- **`parseFeedDiscovery(xmlText, { linkHeader? })`** — the parsing half of `discoverFeed`,
  given an already-fetched body and optionally its response's `Link` header.

Two more `lib/` modules hold the session-settings model (not part of the portable barrel above,
since they're this app's own domain shape, not reusable protocol plumbing):

- **`lib/settings.js`**'s `computeDefaultSettings({ sessionId, domain, port, hubServerUrl })` —
  the settings a new session starts with; `applyDiscoveryToSettings(settings, discoveryResult)`
  — merges a `discoverFeed()` result into a settings snapshot; `isSelfHostedFeedUrl`/
  `feedNameFromSelfHostedUrl`/`selfHostedPrefixes` — whether/what a feed URL names this
  session's own served feed.
- **`lib/link-header.js`**'s `parseLinkHeader(value)`/`findLinkByRel(links, rel)` — parse an
  HTTP `Link` header's `rel="hub"`/`rel="self"` link-values (handles multiple comma-separated
  values per RFC 8288).

Two more app-root modules (not part of the portable `lib/` barrel, since they're
Express/`ws`-coupled):

- **`lib/session-store.js`**'s `createSessionStore({ now?, idGenerator?, buildDefaultSettings? })`
  — the in-memory per-session state (settings, feed items, WebSub secrets, idle tracking)
  described above. The traffic log itself is never stored here — see `session-sockets.js`.
- **`session-sockets.js`**'s `createSessionSockets({ sessionStore })` — the per-session
  socklog WebSocket feed (`/s/:id/logs`), returning `{ attach(server), broadcast(sessionId,
  entry) }`. Purely live — a socket connecting late sees only what's broadcast after it connects.
- **`lib/guarded-fetch.js`**'s `createGuardedFetch({ allowCidrs?, timeoutMs? })` — the
  SSRF-guarded fetch described above.

### WebSub

```js
const { createWebSubClient } = require('./lib');

const hub = createWebSubClient({ serverUrl: 'http://localhost:5337' });

await hub.subscribe({
    callbackUrl: 'http://localhost:9000/s/<session-id>/websub-callback',
    topicUrl: 'http://localhost:9000/s/<session-id>/rss.xml',
    leaseSeconds: 3600, // optional; the hub clamps to its configured bounds
    secret: 's3cr3t' // optional; opts into a signed X-Hub-Signature delivery
});

await hub.publish({ topicUrl: 'http://localhost:9000/s/<session-id>/rss.xml' }); // hub.mode=publish
await hub.unsubscribe({ callbackUrl: '…', topicUrl: '…' });
```

### Subscribe

```js
const { createRssCloudClient } = require('./lib');

const client = createRssCloudClient({ serverUrl: 'http://localhost:5337' });

const { status, body } = await client.pleaseNotify({
    protocol: 'https-post',
    callback: { port: 443, path: '/notify' },
    feedUrl: 'https://feed.example/rss'
});
```

`callback.domain` is optional and selects the hub's verification flow: when given, the hub
verifies against that host (with a challenge for `http-post`/`https-post`); when omitted, the
hub uses the caller's address. `pleaseNotify` resolves to the hub's raw reply
(`{ status, body }`) and does **not** throw on a non-2xx — inspect `status` yourself. Pass
`protocol: 'xml-rpc'` to subscribe over the `/RPC2` front door instead of REST.

### Ping

```js
const { createRssCloudClient } = require('./lib');

const client = createRssCloudClient({ serverUrl: 'http://localhost:5337' });

await client.ping({ feedUrl: 'https://feed.example/rss' }); // REST /ping
await client.ping({ transport: 'xml-rpc', feedUrl: '…' }); // /RPC2
```

### Feed discovery

```js
const { discoverFeed } = require('./lib');

const { rssCloud, webSub, selfUrl, error } = await discoverFeed({
    url: 'https://feed.example/rss'
});
// rssCloud: { domain, port, path, registerProcedure, protocol } | null — <source:cloud> wins
//           over a traditional <cloud> when a feed advertises both
// webSub:   { hubUrl } | null — a Link header wins over a feed-embedded link
// selfUrl:  the feed's declared canonical URL (rel="self"), if any
```
