# rssCloud

[![MIT License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE.md)
[![CI](https://github.com/rsscloud/rsscloud/actions/workflows/ci.yml/badge.svg)](https://github.com/rsscloud/rsscloud/actions/workflows/ci.yml)
[![Andrew Shell's Weblog](https://img.shields.io/badge/weblog-rssCloud-brightgreen)](https://andrewshell.org/search/?keywords=rsscloud)

A monorepo for the [rssCloud](http://rsscloud.org/) notification protocol.

## Packages

- **[`apps/server`](apps/server/README.md)** — rssCloud Server: an Express implementation of the rssCloud notification protocol. Handles subscriptions, ping, and notifications for RSS feed updates.
- **[`apps/debug`](apps/debug/README.md)** — a private, interactive debug harness for the rssCloud protocol's Client (subscriber/publisher) side: a Subscribe/Ping UI with a request log that hosts a notify endpoint and drives a server. Not published.
- **[`packages/core`](packages/core/README.md)** — `@rsscloud/core`: shared primitives for subscriptions, notifications, and feed processing.
- **[`packages/express`](packages/express/README.md)** — `@rsscloud/express`: Express middleware for the rssCloud front doors — `pleaseNotify`, `ping`, and the `RPC2` endpoint, built on `@rsscloud/core`.
- **[`packages/xml-rpc`](packages/xml-rpc/README.md)** — `@rsscloud/xml-rpc`: a generic XML-RPC codec — parse and build `methodCall`/`methodResponse` documents.

## Docker images

The server and the debug harness are published to the GitHub Container Registry
as [`ghcr.io/rsscloud/server`](https://github.com/orgs/rsscloud/packages) and
[`ghcr.io/rsscloud/debug`](https://github.com/orgs/rsscloud/packages), built for
`linux/amd64` and `linux/arm64`. Running a hub needs neither a checkout nor a
Node toolchain:

```bash
docker run -d -p 5337:5337 \
  -e DOMAIN=cloud.example.com \
  -v rsscloud-data:/app/apps/server/data \
  ghcr.io/rsscloud/server:latest
```

See [`apps/server`](apps/server/README.md#run-with-docker) for the settings worth
overriding, and [`examples/dockge/compose.yaml`](examples/dockge/compose.yaml)
for a full Compose stack. Images are published by hand with
[`scripts/docker-build-push.sh`](scripts/README.md) — `:latest` follows the most
recent push, so pin a version tag for real deployments.

## Development

This repo is a [pnpm](https://pnpm.io/) workspace using [Turborepo](https://turborepo.com/) for task orchestration. Node.js 24+ is required.

```bash
git clone https://github.com/rsscloud/rsscloud.git
cd rsscloud
corepack enable
pnpm install
pnpm build          # build all packages — required before pnpm start
pnpm start          # start the server in dev mode
```

`pnpm build` has to run before `pnpm start`. `apps/server` consumes the workspace
packages through their compiled `dist/` output, and `pnpm install` links them
without compiling them. Build again after any change to `packages/`.

Other tasks:

```bash
pnpm lint           # lint all packages
pnpm typecheck      # typecheck all packages
pnpm test:unit      # run unit tests across all packages
pnpm test           # run docker-based end-to-end tests (requires Docker to be running)
```

See each package's README for package-specific usage and API documentation.
