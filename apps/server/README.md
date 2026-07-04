# rssCloud Server

[![MIT License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE.md)
[![CI](https://github.com/rsscloud/rsscloud-server/actions/workflows/ci.yml/badge.svg)](https://github.com/rsscloud/rsscloud-server/actions/workflows/ci.yml)
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

## How to install

This project uses [pnpm](https://pnpm.io/) via corepack. Node.js 22+ is required.

```bash
git clone https://github.com/rsscloud/rsscloud-server.git
cd rsscloud-server
corepack enable
pnpm install
pnpm start
```

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

## How to test

The API is tested using docker containers. I've only tested on MacOS so if you have experience testing on other platforms I'd love having these notes updated for those platforms.

### MacOS

First install [Docker Desktop for Mac](https://hub.docker.com/editions/community/docker-ce-desktop-mac)

```bash
pnpm test
```

This should build the appropriate containers and show the test output.

Our tests create mock API endpoints so we can verify rssCloud server works correctly when reading resources and notifying subscribers.
