# @rsscloud/core

Core primitives for [rssCloud](https://github.com/rsscloud/rsscloud) — subscriptions, notifications, and feed-update processing.

> **Status:** The protocol-neutral engine and the rssCloud **REST** transport
> (`http-post` / `https-post`) are implemented. XML-RPC and WebSub delivery
> plugins are not yet provided.

## Install

```bash
pnpm add @rsscloud/core
```

## Usage

Assemble the engine in your composition root from a `Store`, the protocol
plugins you want, and resolved config:

```ts
import {
    createRssCloudCore,
    createInMemoryStore,
    createRestProtocolPlugin,
    resolveConfig
} from '@rsscloud/core';

const config = resolveConfig();

const core = createRssCloudCore({
    store: createInMemoryStore(),
    // Inject a fetch to carry an outbound timeout + SSRF guard, e.g.
    // `createRestProtocolPlugin({ fetch: createSafeFetch({ timeoutMs: 4000 }) })`.
    plugins: [createRestProtocolPlugin()],
    config
});

// A subscriber registers a callback (rssCloud `pleaseNotify`).
await core.subscribe({
    resourceUrls: ['https://example.com/feed.xml'],
    callbackUrl: 'https://subscriber.example/notify',
    protocol: 'http-post',
    diffDomain: true
});

// A publisher pings — re-check the feed and fan out on a change.
await core.ping({ resourceUrl: 'https://example.com/feed.xml' });
```

`createInMemoryStore` is a reference `Store`; provide your own (file- or
database-backed) for durability. Core never touches HTTP, the filesystem, or a
clock directly — those are injected, so the engine stays testable and portable.

## License

MIT — see [LICENSE.md](./LICENSE.md).
