# rssCloud Server

[![MIT License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE.md)
[![CI](https://github.com/rsscloud/rsscloud/actions/workflows/ci.yml/badge.svg)](https://github.com/rsscloud/rsscloud/actions/workflows/ci.yml)
[![Andrew Shell's Weblog](https://img.shields.io/badge/weblog-rssCloud-brightgreen)](https://andrewshell.org/search/?keywords=rsscloud)

rssCloud Server implementation in Node.js.

Subscribers register a callback to be told when a feed updates; publishers announce a
change; the server fans the notification out to every subscriber. It speaks the
[rssCloud](http://rsscloud.org/) protocol (over REST and XML-RPC) **and** acts as a
[WebSub](https://www.w3.org/TR/websub/) hub — and a single publish reaches all of them
at once.

## Documentation

- **[Quick Start](docs/quick-start.md)** — publishing a feed? Advertise this hub and
  ping it when you update.
- **[rssCloud over REST](docs/rsscloud-rest.md)** — `POST /pleaseNotify` and
  `POST /ping` as form posts.
- **[rssCloud over XML-RPC](docs/rsscloud-xml-rpc.md)** — `rssCloud.hello`,
  `rssCloud.pleaseNotify`, and `rssCloud.ping` at `POST /RPC2`.
- **[WebSub](docs/websub.md)** — the hub endpoint, intent verification, leases, signed
  delivery, and how to advertise your hub from a feed.
- **[How it fits together](docs/cross-protocol.md)** — why one ping notifies every
  subscriber regardless of the protocol they used.

## Run with Docker

Published images live in the GitHub Container Registry at
[`ghcr.io/rsscloud/server`](https://github.com/orgs/rsscloud/packages) and are
built for `linux/amd64` and `linux/arm64`. If you just want to run a hub, this is
the shortest path — no checkout, no toolchain:

```bash
docker run -d --name rsscloud \
  -p 5337:5337 \
  -e DOMAIN=cloud.example.com \
  -e HUB_URL=https://cloud.example.com/websub \
  -v rsscloud-data:/app/apps/server/data \
  ghcr.io/rsscloud/server:latest
```

- `DOMAIN` is the externally-reachable hostname for this hub (no scheme, no
  port); it defaults to `localhost`, which is fine for a local trial but wrong
  for anything a subscriber has to reach.
- `HUB_URL` is the WebSub hub URL advertised to subscribers. It defaults to
  `http://$DOMAIN:$PORT/websub`, so set it explicitly when you terminate HTTPS at
  a reverse proxy.
- The volume matters: subscriptions and stats live in `/app/apps/server/data`
  inside the container and are lost on redeploy without it. See
  [Data storage](#data-storage).

`:latest` tracks the most recent published build; pin a release tag
(e.g. `ghcr.io/rsscloud/server:4.0.1`) for a deployment you don't want moving
underneath you.

For a fuller stack — the hub plus the [debug harness](../debug/README.md)
(`ghcr.io/rsscloud/debug`), on a dedicated network with healthchecks and a
persistent volume — see the Compose file in
[`examples/dockge/compose.yaml`](../../examples/dockge/compose.yaml). Every
setting is documented in [`config.js`](config.js).

### Feeds on the same machine

The hub refuses to fetch any URL whose host resolves to a non-public address
(see [SSRF egress protection](docs/websub.md#ssrf-egress-protection)). If your
feeds are served from the same machine as the hub, their hostname can resolve to
a private address inside the container, such as a Docker network address, the
host's LAN address, or a Tailscale address in `100.64.0.0/10`. The hub then
refuses to read a feed that the rest of the internet can reach.

The safer fix is to make that hostname resolve to the machine's public address
inside the container. Use `extra_hosts` in Compose, or `--add-host` with
`docker run`. This works as long as the container can reach that address.
Replace the example hostname and IP below with your feed's hostname and your
machine's public IP.

```yaml
services:
    rsscloud:
        extra_hosts:
            - 'feeds.example.com:203.0.113.10'
```

`WEBSUB_FETCH_ALLOW_CIDRS` also works, but it exempts the whole range. Anyone can
then subscribe to a URL in that range, ping it, and have the hub fetch the page
and deliver it to their WebSub callback. Use it only for feeds that really live
on a private network.

## How to install

Install from source if you intend to develop against the server or run an
unreleased revision; to just run a hub, prefer the [image](#run-with-docker)
above.

This project uses [pnpm](https://pnpm.io/) via corepack. Node.js 24+ is required.

```bash
git clone https://github.com/rsscloud/rsscloud.git
cd rsscloud
corepack enable
pnpm install
pnpm build
pnpm start
```

`pnpm build` is not optional. The server depends on the workspace packages
`@rsscloud/core` and `@rsscloud/express`, which are TypeScript and resolve to a
compiled `dist/`. `pnpm install` only links them into place — it does not compile
them — so starting without a build fails with a module-not-found error. Re-run
`pnpm build` after any pull that touches `packages/`.

## Data storage

State (resources and subscriptions) is held in memory and persisted to a JSON
file on disk, configured via `DATA_FILE_PATH` (default
`./data/subscriptions.json`). The store loads at startup and flushes atomically
on an interval, at shutdown, and on unexpected exit. No external database is
required.

## Upgrading from 2.x to 3.0

Version 3.0 removes MongoDB entirely; the JSON file is the only data store.
There is no automatic migration from MongoDB, so do **not** upgrade directly
from an older 2.x release to 3.0 or your existing subscriptions will be lost.

Migrate in two steps:

1. **Upgrade to 2.4.0 first.** This release dual-writes to both MongoDB and
   the JSON file. Run it until the data file (`DATA_FILE_PATH`, default
   `./data/subscriptions.json`) has been written and reflects your current
   subscriptions.
2. **Then upgrade to 3.0.** It reads only the JSON file and ignores
   `MONGODB_URI`. Make sure the data directory is on a persistent volume so
   the file survives restarts and redeploys.

Once on 3.0 you can decommission MongoDB.

## Upgrading from 3.x to 4.0

Version 4.0 restructures the project into a pnpm monorepo — the server itself moved
from the repo root into `apps/server`. If you deployed 3.x by running `node app.js`
from the repo root with a root-level `.env` and `./data` directory, no migration step
is required: a compatibility `app.js` at the repo root loads the root `.env` (if
present), points `DATA_FILE_PATH`/`STATS_FILE_PATH` at the root `./data` directory (if
present), then hands off to the real server in `apps/server`. Your existing
subscriptions and stats keep working untouched — the legacy data file is only ever
read, never rewritten (a new `.v2.json` sibling holds every write going forward).

Pull the new code, run `pnpm install` and `pnpm build` (see
[How to install](#how-to-install)), and start it exactly as before:

```bash
node app.js
```

There's no rush to change anything once it's running, but the supported path going
forward is `apps/server`: move `.env` and `data/` into `apps/server/`, and start it
with `pnpm start` instead of `node app.js` from the repo root.

## How to test

The API is tested using docker containers. Everything the suite needs is built
inside those containers, so you don't have to `pnpm build` or start the server
first — but you do need Docker installed _and running_.

1. **Install Docker.**
    - macOS — [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)
    - Windows — [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
    - Linux — [Docker Engine](https://docs.docker.com/engine/install/) with the Compose plugin

2. **Start Docker and wait for it to report that it's running.** Docker Desktop
   does not launch itself after installation or after a reboot, and `pnpm test`
   fails with a "cannot connect to the Docker daemon" error if the engine isn't
   up yet.

3. **Run the suite** from the repo root:

    ```bash
    pnpm test
    ```

This should build the appropriate containers and show the test output.

Our tests create mock API endpoints so we can verify rssCloud server works correctly when reading resources and notifying subscribers.

Most development happens on macOS; if you hit a platform-specific snag on Windows
or Linux, please [open an issue](https://github.com/rsscloud/rsscloud/issues) so
these notes can be improved.
