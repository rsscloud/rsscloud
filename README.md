# rssCloud

[![MIT License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE.md)
[![CI](https://github.com/rsscloud/rsscloud-server/actions/workflows/ci.yml/badge.svg)](https://github.com/rsscloud/rsscloud-server/actions/workflows/ci.yml)
[![Andrew Shell's Weblog](https://img.shields.io/badge/weblog-rssCloud-brightgreen)](https://andrewshell.org/search/?keywords=rsscloud)

A monorepo for the [rssCloud](http://rsscloud.org/) notification protocol.

## Packages

- **[`apps/server`](apps/server/README.md)** — rssCloud Server: an Express implementation of the rssCloud notification protocol. Handles subscriptions, ping, and notifications for RSS feed updates.
- **[`apps/debug`](apps/debug/README.md)** — a private, interactive debug harness for the rssCloud protocol's Client (subscriber/publisher) side: a Subscribe/Ping UI with a request log that hosts a notify endpoint and drives a server. Not published.
- **[`packages/core`](packages/core/README.md)** — `@rsscloud/core`: shared primitives for subscriptions, notifications, and feed processing.
- **[`packages/express`](packages/express/README.md)** — `@rsscloud/express`: Express middleware for the rssCloud front doors — `pleaseNotify`, `ping`, and the `RPC2` endpoint, built on `@rsscloud/core`.
- **[`packages/xml-rpc`](packages/xml-rpc/README.md)** — `@rsscloud/xml-rpc`: a generic XML-RPC codec — parse and build `methodCall`/`methodResponse` documents.

## Development

This repo is a [pnpm](https://pnpm.io/) workspace using [Turborepo](https://turborepo.com/) for task orchestration. Node.js 22+ is required.

```bash
git clone https://github.com/rsscloud/rsscloud-server.git
cd rsscloud-server
corepack enable
pnpm install
pnpm start          # start the server in dev mode
pnpm build          # build all packages
pnpm lint           # lint all packages
pnpm typecheck      # typecheck all packages
pnpm test:unit      # run unit tests across all packages
pnpm test           # run docker-based end-to-end tests (server)
```

See each package's README for package-specific usage and API documentation.
