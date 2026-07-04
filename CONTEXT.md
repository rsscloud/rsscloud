# rssCloud Server

The notification context of the [rssCloud](http://rsscloud.org/) protocol: subscribers
register a callback for a feed, publishers signal when a feed changes, and the server
fans notifications out to subscribers. `@rsscloud/core` is the protocol-neutral engine
(the **Hub** end); the transports and HTTP edge wrap it. `apps/debug` is the matching
**Client** end (the **Subscriber** + **Publisher** side), and `@rsscloud/xml-rpc` is the
**XML-RPC codec** both ends share.

## Language

**Resource**:
A feed or document the server watches, together with its change-detection state
(last hash, size, check/update counts). One per feed URL.
_Avoid_: feed (reserve "feed" for the parsed metadata on a resource), document, page.

**Subscription**:
A subscriber's standing request to be notified when a **Resource** changes — its
callback URL, protocol, error counters, and expiry. Many per **Resource**.
_Avoid_: subscriber (that's the remote party), registration, listener.

**Feed entry**:
One **Resource** plus its **Subscription**s — the unit the store reads and writes.
_Avoid_: record, row, document.

**Ping**:
A publisher's change signal for a **Resource** (`/ping`, `rssCloud.ping`). Triggers a
re-fetch, change detection, and fan-out. Always answered with success once well-formed.
_Avoid_: notify (that's the outbound direction), update, poke.

**pleaseNotify**:
A subscriber's call to establish or renew a **Subscription** (`/pleaseNotify`,
`rssCloud.pleaseNotify`). Distinct from the outbound notification it sets up.
_Avoid_: subscribe request (the verb is "pleaseNotify"; `SubscribeRequest` is the DTO it maps to).

**Front door**:
An HTTP entry point a remote party calls — `/ping`, `/pleaseNotify`, `/RPC2`. The same
use case (subscribe, ping) is reachable through more than one front door.
_Avoid_: endpoint, route, controller.

**Dispatcher**:
The wire-protocol adapter behind a **Front door** (REST or XML-RPC). It parses the
request off its transport, drives **core**, and renders the response in that
transport's voice — including the exact legacy wording. core speaks error *codes*;
the dispatcher chooses the *words* (wire-parity convention).
_Avoid_: handler, controller, parser.

**SubscribeParams**:
The wire-neutral fields a **Dispatcher** has already pulled off its transport
(`resourceUrls`, `port`, `path`, `protocol`, `clientAddress`, optional `domain` /
`notifyProcedure`) — the input to **buildSubscribeRequest**. Not yet a `SubscribeRequest`.
_Avoid_: SubscribeRequest (that's the assembled DTO core consumes), raw body, fields.

**buildSubscribeRequest**:
The single deep assembler shared by both **Dispatcher**s: takes **SubscribeParams** and
produces a `SubscribeRequest` — validating the protocol, deriving the scheme, gluing the
callback URL (`::ffff:` strip, IPv6 bracketing, path slash), resolving `diffDomain`, and
gating `notifyProcedure`. The one place the callback-URL assembly rules live.
_Avoid_: mapper, glueUrlParts (that's one step inside it).

**Protocol plugin**:
The delivery adapter for a notification protocol (`http-post`, `https-post`, `xml-rpc`):
verifies a new **Subscription** and delivers notifications. Selected by the
**Subscription**'s protocol.
_Avoid_: transport, notifier, driver.

**diffDomain**:
A **Subscription** whose callback host differs from the caller's address, requiring the
challenge handshake at verify time. Set by **buildSubscribeRequest** from the presence of
an explicit `domain`.
_Avoid_: cross-origin, external, remote.

**Hub**:
The server end of the protocol: it answers **pleaseNotify** and **Ping**, owns the
**Resource**/**Subscription** state, and fans **Notification**s out. `@rsscloud/core` is the
protocol-neutral hub engine; `apps/server` is one deployment of it. The same engine also
plays the [WebSub](https://www.w3.org/TR/websub/) **Hub** role (the W3C term is literally
"hub") — see the **WebSub** terms below; it never hosts source feeds in either protocol.
_Avoid_: server (that's a deployment of the hub, not the role), broker.

**Client**:
The **Subscriber** + **Publisher** end of the protocol — the mirror of the **Hub**,
living in `apps/debug`. Its `lib/` builds the **pleaseNotify**/**Ping** calls (on the
**XML-RPC codec**) and renders a feed's **Cloud element**; the app hosts the callback
endpoint that answers the verify challenge and acknowledges **Notification**s. Not a
published package — a real subscriber must host that endpoint, so it stays app logic.
_Avoid_: agent, consumer, SDK.

**Subscriber**:
The remote party — and the **Client** role — that registers to be notified: sends
**pleaseNotify**, answers the verify challenge, and receives **Notification**s. Its callback
host is what the stats `uniqueAggregators` count.
_Avoid_: subscription (that's the stored record), listener, consumer.

**Publisher**:
The remote party — and the **Client** role — that signals a **Resource** changed: sends
**Ping** and advertises the **Cloud element** in its feed. One **Client** can be both
Subscriber and Publisher.
_Avoid_: feed (that's the parsed metadata on a **Resource**), source, producer.

**Notification**:
The outbound delivery from the **Hub** to a **Subscriber**'s callback when a **Resource**
changes — an `http-post` `url=` form, an XML-RPC `rssCloud.notify` call, or (for WebSub) a
**Content distribution** POST carrying the body itself. What a **Protocol plugin** sends
and the **Client** receives and acknowledges.
_Avoid_: ping (that's the inbound publisher signal), pleaseNotify (the inbound subscribe),
message, event.

**Cloud element**:
The `<cloud>` element a **Publisher** places in its RSS feed (domain / port / path /
registerProcedure / protocol) telling a **Subscriber** where to **pleaseNotify**. Built by
the **Client**'s `renderCloudFeed`; the **Hub** doesn't host it — publishers reference the
hub from their own feeds.
_Avoid_: cloud (ambiguous on its own), hub link.

**XML-RPC codec**:
The generic XML-RPC `methodCall`/`methodResponse` encode + decode (`@rsscloud/xml-rpc`)
shared by the **Hub** and the **Client**. It speaks typed `XmlRpcValue`s and carries no
`rssCloud.*` semantics — each end maps its own method shapes onto it.
_Avoid_: parser (that's one half), serializer, XML library.

### WebSub

The **Hub** also speaks [WebSub](https://www.w3.org/TR/websub/), the W3C successor to
PubSubHubbub. Hub-only: `apps/debug` still owns the subscriber/publisher side, and the
hub never hosts source feeds (publishers point at it via `<link rel="hub">` in their own
feeds). These terms name what's WebSub-specific; they reuse the core terms above wherever
the concept is the same.

**Topic**:
The feed URL a WebSub **Subscriber** names in `hub.topic` — the WebSub-wire name for the
same URL core stores change-detection state about as a **Resource**. A subscriber's
`hub.topic` must be the *exact* URL string the publisher **Ping**s, because the store keys
feed entries by exact URL (the same exactness rssCloud already requires between the
subscribe-URL and the ping-URL; URL normalization is out of scope).
_Avoid_: Resource (that's core's stored state for the URL; "Topic" is the WebSub-wire name
for the URL the subscriber names), feed.

**Callback**:
The complete URL a WebSub **Subscriber** supplies in `hub.callback` — where **Content
distribution** POSTs and the **Intent verification** GET are sent. It becomes the
**Subscription**'s `url` directly: unlike rssCloud (where **buildSubscribeRequest** glues
the callback from port/path/domain), WebSub arrives with a finished URL, so the dispatcher
sets `callbackUrl = hub.callback` and skips the builder.
_Avoid_: Subscription.url (that's the stored field the callback becomes), notify endpoint,
apiurl.

**Intent verification**:
The WebSub handshake confirming a **Subscriber** actually requested a (un)subscribe: the
**Hub** GETs the **Callback** with `hub.mode` / `hub.topic` / `hub.challenge` (plus the
chosen **Lease**) and requires an exact `hub.challenge` echo with a `2xx`. WebSub *always*
verifies (spec mandate), so its **Protocol plugin** ignores **diffDomain** and never does
the rssCloud same-domain test-notify. Verification is async: the Hub answers the inbound
request `202` first, then runs the GET out of band via the **VerificationScheduler**.
_Avoid_: challenge handshake (rssCloud's term — related, but WebSub always verifies, echoes
a challenge, and runs async), diffDomain (WebSub ignores it).

**VerificationScheduler**:
The core-owned seam that runs the verify-then-persist task behind the async `202`. The
default runs it in-process, best-effort (one attempt, failures logged, a restart drops the
pending request). A future persisted-queue + retry implementation satisfies the same seam
with no change to the dispatcher, the plugin's verify, or the express factory. WebSub-only
and additive — rssCloud subscribe stays synchronous. See ADR-0002.
_Avoid_: queue (the default isn't durable yet), job runner, worker.

**Lease**:
The bounded lifetime of a WebSub **Subscription**. The **Hub** honors the subscriber's
requested `hub.lease_seconds` clamped to a configurable `[min, max]` (a default applies
when omitted), stores the chosen value in `details.leaseSeconds`, sets
`whenExpires = now + chosen`, and echoes the chosen value in the **Intent verification**
GET. `removeExpired()` drops the subscription on lapse, unchanged.
_Avoid_: expiry (that's the resulting `whenExpires`; the Lease is the requested-then-clamped
duration), TTL.

**Content distribution**:
The WebSub form of **Notification**: the **Hub** POSTs the changed **Topic**'s body
*verbatim* to the **Callback**, relaying the origin `Content-Type` and adding
`Link: <hub>; rel="hub", <topic>; rel="self"`. Where an rssCloud **Notification** sends
only the changed URL, Content distribution sends the content itself — so one rssCloud
**Ping** can drive both, from the same already-fetched body.
_Avoid_: notify (rssCloud's content-free signal), push, broadcast.

**Fat ping** (out of scope — not implemented):
A publish in which the **Publisher** POSTs the changed body itself, so the **Hub**
distributes it verbatim *without* re-fetching the **Topic**. Non-standard (a PubSubHubbub
0.4 extension) with no WebSub wire format, so we **deliberately don't implement it**
(decided 2026-06-15): the hub only ever does thin publishes — it names a **Topic** and
re-fetches through `core.ping`, exactly as rssCloud's **Ping** already works. The term is
kept here only to explain why our publish is called "thin."
_Avoid_: using "publish" to mean Fat ping (our publish is always thin); push.

**X-Hub-Signature**:
The HMAC the **Hub** adds over a **Content distribution** body (`X-Hub-Signature: sha256=…`)
when the **Subscriber** supplied a `hub.secret`, letting the subscriber authenticate the
delivery. The algorithm is a config knob (default `sha256`); no `hub.secret` → no header.
_Avoid_: HMAC (that's the algorithm; the header is the wire artifact), auth token, signature
(ambiguous — name the header).

**Egress guard** (`createSafeFetch`):
The screen on every outbound fetch — **Topic** re-fetch, **Intent verification** GET, and
**Content distribution** — that refuses a destination resolving to a non-public address
(loopback, private, link-local incl. cloud-metadata, ULA, CGNAT) or a non-`http(s)` scheme.
It exists because **Callback** and **Topic** are attacker-supplied, and Content distribution
relays a fetched body to the Callback (an SSRF exfiltration path absent from rssCloud's
URL-only **Notification**). Screens the *resolved IP* and pins the connection to it, so a
rebinding name or redirect that points inward is refused on every hop (see
[ADR-0003](docs/adr/0003-ssrf-egress-guard-on-outbound-fetch.md)). On by default; LAN feeds
opt in via `WEBSUB_FETCH_ALLOW_CIDRS`.
_Avoid_: firewall (that's the network layer), allowlist (the guard is deny-by-default; the
CIDR list is only the exemption), sanitizer.

## Example dialogue

> **Dev:** When a `pleaseNotify` comes in over XML-RPC, who decides the callback is `diffDomain`?
> **Domain expert:** The dispatcher just pulls the positional params into **SubscribeParams** and hands them to **buildSubscribeRequest**. The builder is the one that sees an explicit `domain`, sets `diffDomain`, and glues the callback URL. Same builder the REST front door uses.
> **Dev:** So if the protocol's unsupported, that's the builder too?
> **Domain expert:** Right — protocol validation moved inside the builder, so both front doors fault the same way. The dispatcher only owns its own wire's presence check and the wording it renders back.

> **Dev:** The **Client** and the **Hub** both speak XML-RPC — do they share the builder?
> **Domain expert:** They share the **XML-RPC codec** (`@rsscloud/xml-rpc`), not each other's calls. The Client builds `rssCloud.pleaseNotify`/`rssCloud.ping`; the Hub parses those and sends a **Notification**. Each maps its own `rssCloud.*` shapes onto the codec's typed values.
> **Dev:** And how does a **Publisher** point a **Subscriber** at us?
> **Domain expert:** Via the **Cloud element** in the publisher's own feed — the Client's `renderCloudFeed` writes it. The Hub never hosts the feed; it just answers the **pleaseNotify** the subscriber sends after reading that `<cloud>`.

> **Dev:** A WebSub subscriber names a **Topic** and core stores a **Resource** — are those two different things?
> **Domain expert:** Same URL, different vantage point. **Topic** is the WebSub-wire name for the feed URL the subscriber asks about; **Resource** is core's stored change-detection state for that URL. They have to be the *exact* same string — the store keys by exact URL, just like rssCloud already requires the subscribe-URL to match the ping-URL.
> **Dev:** So when an rssCloud **Publisher** **Ping**s, does a WebSub subscriber on that Topic hear about it?
> **Domain expert:** Yes — that's the headline. One **Ping** fetches the body once and fans out per **Subscription**: the rssCloud sub gets a **Notification**, the WebSub sub gets a **Content distribution** POST of that same body. The publisher never speaks WebSub; it only added `<link rel="hub">` to its feed.
> **Dev:** And the subscriber's `202`?
> **Domain expert:** That's just "accepted". **Intent verification** runs async behind the **VerificationScheduler** — the Hub GETs the **Callback**, checks the `hub.challenge` echo, and only then records the **Subscription**. So a test polls `/subscriptions.json`; it doesn't assert the record exists the instant the `202` lands.
