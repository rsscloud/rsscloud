# Changelog

## [4.0.1](https://github.com/rsscloud/rsscloud/compare/server-v4.0.0...server-v4.0.1) (2026-07-21)


### Bug Fixes

* **deps:** bump morgan to 1.11.0 and brace-expansion to 5.0.7 ([a8ec325](https://github.com/rsscloud/rsscloud/commit/a8ec32598003bd83eb5ad556070ed753c8e0e715))

## [4.0.0](https://github.com/rsscloud/rsscloud-server/compare/server-v3.0.0...server-v4.0.0) (2026-07-05)


### ⚠ BREAKING CHANGES

* **server:** apps/server no longer exposes the mocha test suite or its devDependencies. Anything that ran 'pnpm --filter @rsscloud/server run test' (none externally) must switch to 'pnpm --filter @rsscloud/e2e run e2e-test' inside the docker container, or 'pnpm test' at the root.
* project restructured as pnpm monorepo

### Features

* add realtime log page and improved test infrastructure ([0e5ac48](https://github.com/rsscloud/rsscloud-server/commit/0e5ac485b9004fc20eab6ae1f56430c43b1b50a6))
* convert to pnpm monorepo with server app ([a4e3d41](https://github.com/rsscloud/rsscloud-server/commit/a4e3d412d855cb26631accfc65898383eb7ea094))
* distribute feed content to WebSub subscribers on fan-out ([9615369](https://github.com/rsscloud/rsscloud-server/commit/9615369ce4bd61cc5f6b168cb634a8517d8d0409))
* honor WebSub lease requests, clamped to configured bounds ([7328aef](https://github.com/rsscloud/rsscloud-server/commit/7328aefdffc224eb0c117de55c2a980872bad04b))
* **server:** add a Quick Start doc for feed publishers ([5255512](https://github.com/rsscloud/rsscloud-server/commit/5255512d50b81c9b4b7294f5b59889a0dc630a87))
* **server:** add a root-level compatibility entry point for 3.x upgrades ([acd9593](https://github.com/rsscloud/rsscloud-server/commit/acd95938333815ab64475e23be23ba4f650ea265))
* **server:** consolidate home page navigation into one page list ([782544e](https://github.com/rsscloud/rsscloud-server/commit/782544e93a70241369005e9d09df1aa17921ce93))
* **server:** mount the WebSub hub front door ([6f57343](https://github.com/rsscloud/rsscloud-server/commit/6f573432e6be554e19b810bb030ffe66975beb3b))
* **server:** screen outbound fetches with the SSRF egress guard ([cc81ebe](https://github.com/rsscloud/rsscloud-server/commit/cc81ebe8a22e5e99359f5cf1a414e529e3b66033))
* sign WebSub deliveries with X-Hub-Signature ([7f3349e](https://github.com/rsscloud/rsscloud-server/commit/7f3349e4dc26a0df882c358061e1364e74b7529b))


### Bug Fixes

* **core:** preserve caller abort signal in safeFetch timeout path ([2ae15ef](https://github.com/rsscloud/rsscloud-server/commit/2ae15efeee996a4c6c2094ba65bf7ba09141ad4b))
* **server:** add missing DOCTYPE to HTML views ([fa9bb44](https://github.com/rsscloud/rsscloud-server/commit/fa9bb443f25de88fdbcb8901516ea1c7a711c972))
* **server:** build @rsscloud/xml-rpc in the Docker image ([2321097](https://github.com/rsscloud/rsscloud-server/commit/232109723731553903f771c761bffcb1289de548))
* **server:** normalize WEBSUB_PATH to a leading slash ([090db46](https://github.com/rsscloud/rsscloud-server/commit/090db46654ac7381ce0af37216b28a798ba51d31))
* **server:** repair broken /viewLog bootstrap script ([9466543](https://github.com/rsscloud/rsscloud-server/commit/9466543c7aaabb28dbb5d99bf4837577d242b4b7))
* **server:** restore /docs and /LICENSE.md routes after monorepo split ([8b127de](https://github.com/rsscloud/rsscloud-server/commit/8b127ded6e45d33867b5a1d92f2619bd6d973fb1))
* **server:** scope the SSRF allowlist to topic fetch, keep callbacks strict ([71241cb](https://github.com/rsscloud/rsscloud-server/commit/71241cbb8e1d269055eeeb1ecbb26f4479af28ac))
* **server:** stop the stats label hardcoding "7 days" ([26e1d50](https://github.com/rsscloud/rsscloud-server/commit/26e1d5026330aaac3f1211983512210a5ef88815))
* **server:** url-encode the ping curl example in the Quick Start doc ([f0cfb13](https://github.com/rsscloud/rsscloud-server/commit/f0cfb131b3d00d1fa756573e5a76ae8e94144148))


### Code Refactoring

* **server:** extract e2e test suite into apps/e2e ([7013512](https://github.com/rsscloud/rsscloud-server/commit/701351285a586db003d25388e7ba664f626e3c1c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @rsscloud/core bumped to 1.0.0
    * @rsscloud/express bumped to 1.0.0

## [3.0.0](https://github.com/rsscloud/rsscloud-server/compare/v2.4.0...v3.0.0) (2026-05-15)

### ⚠ BREAKING CHANGES

- MONGODB_URI is no longer read. Deployments must mount a persistent volume at the data directory (DATA_FILE_PATH, default ./data/subscriptions.json) instead of relying on MongoDB. The bin/import-data.js script is removed.

### Features

- add test HTTP CRUD endpoints and store-api helper ([18b6570](https://github.com/rsscloud/rsscloud-server/commit/18b6570ae33729faf96ccf2d066b1bce64b2a013))
- expand stats feed list with Show All toggle and last-updated timestamps ([525b76e](https://github.com/rsscloud/rsscloud-server/commit/525b76e55aa7c012c46d2095610308d01df97337))
- extract feed metadata and add OPML subscription list ([94a6ef9](https://github.com/rsscloud/rsscloud-server/commit/94a6ef9ee67eb1f4d48df5429bf8dcf9f0034eb8))
- remove MongoDB, jsonStore is sole data store ([5fa07b2](https://github.com/rsscloud/rsscloud-server/commit/5fa07b2f2fe2afd50b4ab4d4fd29df32aa58ada3))
- render stats "Generated at" in browser's local timezone ([adac238](https://github.com/rsscloud/rsscloud-server/commit/adac2388fd00b1d024e3a23d3c698129a7818ce2))
- retain empty-subscriber entries within feedsChangedWindowDays ([db6c16f](https://github.com/rsscloud/rsscloud-server/commit/db6c16f8973938ecbe28a303dad31120faf94774))
- retain empty-subscriber entries within feedsChangedWindowDays ([631f234](https://github.com/rsscloud/rsscloud-server/commit/631f234b60822321a18f46c1e7140b203422d4b3))
- show WebSocket feed URL on viewLog page ([f0a0b0f](https://github.com/rsscloud/rsscloud-server/commit/f0a0b0f115c6cca162d3c8e0c6feeee484613a23))

### Bug Fixes

- harden json-store durability and exclude host files from image ([ff96994](https://github.com/rsscloud/rsscloud-server/commit/ff9699462c45f16c7de92e16c2740aa37dd236d3))
- serve /LICENSE.md with a header so the docs link works ([085c65f](https://github.com/rsscloud/rsscloud-server/commit/085c65fc5110a81f7802efd8a442eac7ffe22079))
- update dependencies and patch serialize-javascript ([b7b4bcf](https://github.com/rsscloud/rsscloud-server/commit/b7b4bcfc8536be1e5b96795bdddf99632f1dd698))

## [2.4.0](https://github.com/rsscloud/rsscloud-server/compare/v2.3.1...v2.4.0) (2026-03-20)

### Features

- add dual-write JSON file store alongside MongoDB ([096f46a](https://github.com/rsscloud/rsscloud-server/commit/096f46ac9408b8af8cce5bbac7dc3111ba54536a))
- add dual-write JSON file store alongside MongoDB ([b00f6dd](https://github.com/rsscloud/rsscloud-server/commit/b00f6ddff09d88aee8b55f289fed2c4771a87fed))
- add stats page with cached operational statistics ([5e8731f](https://github.com/rsscloud/rsscloud-server/commit/5e8731f8d379cd403eacfc69e53e06f0579a4172))

### Bug Fixes

- allow pleaseNotify when ping frequency check triggers ([a31cf02](https://github.com/rsscloud/rsscloud-server/commit/a31cf02ca7c7266dd06c1b95c08e6cc3075cb44a))
- clean up orphaned resources and subscriptions ([21464c4](https://github.com/rsscloud/rsscloud-server/commit/21464c413fa31543b093e454427bb8f21d6cc8f8))
- clean up orphaned resources and subscriptions ([d84d3d7](https://github.com/rsscloud/rsscloud-server/commit/d84d3d7adb252360f292e3648515d648bba61dd2))
- clean up stale and orphaned entries from subscriptions.json ([ff3fa87](https://github.com/rsscloud/rsscloud-server/commit/ff3fa87d1df075ac3a1b3e6107006d4ab77e3029))
- clean up subscription docs with empty pleaseNotify arrays ([c272b96](https://github.com/rsscloud/rsscloud-server/commit/c272b9605f644c51bc27a3d10fcf8c5544abb224))
- normalize IPv4-mapped IPv6 addresses in subscription URLs ([c37902f](https://github.com/rsscloud/rsscloud-server/commit/c37902fdfbb70d507f26347c39513582601c835e))
- remove ping of feeds with missing resource during cleanup ([725daeb](https://github.com/rsscloud/rsscloud-server/commit/725daebf816dbd2eb93d1f9f5ac43437084a2b81))
- use https scheme for http-post subscriptions on port 443 ([c796df3](https://github.com/rsscloud/rsscloud-server/commit/c796df32fb9916cd47dde21390f06ddb6eee1746))
- use whenLastUpdate instead of whenLastCheck for stats ([e1ac16c](https://github.com/rsscloud/rsscloud-server/commit/e1ac16c9d9baad78bae2dbbf727738f16913fe46))

## [2.3.1](https://github.com/rsscloud/rsscloud-server/compare/v2.3.0...v2.3.1) (2026-03-18)

### Bug Fixes

- use protocol-aware WebSocket URL for viewLog page ([9eba9a6](https://github.com/rsscloud/rsscloud-server/commit/9eba9a64bfe8ce5aa13632389128a775fdb6962c))

## [2.3.0](https://github.com/rsscloud/rsscloud-server/compare/2.2.1...v2.3.0) (2026-03-18)

### Features

- add realtime log page and improved test infrastructure ([0e5ac48](https://github.com/rsscloud/rsscloud-server/commit/0e5ac485b9004fc20eab6ae1f56430c43b1b50a6))
