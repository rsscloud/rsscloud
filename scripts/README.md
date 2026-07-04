# Scripts

## docker-build-push.sh

Builds a Docker image for the `server` or `client` app and pushes it to the
GitHub Container Registry as `ghcr.io/rsscloud/server` or
`ghcr.io/rsscloud/client`.

### Features

- ✅ **Quality checks** — runs `typecheck`, `lint`, and unit tests before building
- 🐳 **Docker validation** — checks Docker is running and you're authenticated to ghcr.io
- 🏷️ **Smart tagging** — tags with the version from the target app's `package.json` + `latest`
- 🎯 **Custom tags** — pass an extra tag as a positional argument
- 🚀 **Multi-platform** — builds `linux/amd64` and `linux/arm64` via `docker buildx`
- 🔍 **Dry run** — preview the tags without building/pushing

### Usage

```bash
# Full build with quality checks
pnpm docker:build-push server
pnpm docker:build-push client

# Dry run — show what would happen without building/pushing
pnpm docker:dry-run server
pnpm docker:dry-run client

# Direct script usage (e.g. with a custom tag)
./scripts/docker-build-push.sh server beta
./scripts/docker-build-push.sh --help
```

### Requirements

- Docker installed and running, with `buildx`
- ghcr.io authentication (`docker login ghcr.io`) — the script prompts if needed;
  use a GitHub personal access token with the `write:packages` scope as the password
- Node.js + pnpm
- Run from the repository root

### Tags pushed

- `ghcr.io/rsscloud/<target>:<version>` (from `apps/<target>/package.json`)
- `ghcr.io/rsscloud/<target>:latest`
- `ghcr.io/rsscloud/<target>:<custom-tag>` (if provided)

### Running the published images

The server keeps subscriptions/stats on disk under `/app/apps/server/data`, so
mount a volume there to persist state across restarts. Set `DOMAIN`/`HUB_URL` to
the externally-reachable host so the hub advertises the right callback URL.

```bash
docker run -d -p 5337:5337 \
  -e DOMAIN=cloud.example.com \
  -e HUB_URL=https://cloud.example.com/websub \
  -v rsscloud-data:/app/apps/server/data \
  ghcr.io/rsscloud/server:latest
```

The client (the rssCloud/WebSub test harness) holds no persistent state — sessions
live in memory for the process lifetime — so no volume is needed.

```bash
docker run -d -p 9000:9000 \
  -e DOMAIN=cloud.example.com \
  -e HUB_SERVER_URL=https://cloud.example.com/websub \
  ghcr.io/rsscloud/client:latest
```

> The `docker-compose.yml` under `apps/e2e/` relaxes the SSRF egress protection so
> the test mock servers are reachable. A real deployment should **not** copy those
> `WEBSUB_*_ALLOW_CIDRS` / SSRF env vars — keep the strict defaults.
