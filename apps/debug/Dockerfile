FROM node:22 AS base

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/debug/package.json apps/debug/
COPY packages/xml-rpc/package.json packages/xml-rpc/
COPY packages/core/package.json packages/core/

# Build the workspace packages (TS → CJS/ESM dist) the harness consumes.
FROM base AS build

COPY packages/xml-rpc packages/xml-rpc
COPY packages/core packages/core
RUN pnpm install --frozen-lockfile --filter "@rsscloud/core..."
RUN pnpm --filter "@rsscloud/core..." run build

FROM base AS dependencies

RUN pnpm install --frozen-lockfile --filter "@rsscloud/debug..." --prod --ignore-scripts

FROM dependencies AS runtime

COPY --chown=node:node apps/debug apps/debug
COPY --from=build --chown=node:node /app/packages/xml-rpc/dist packages/xml-rpc/dist
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist

WORKDIR /app/apps/debug

# Default listen port (config.js's PORT default). Documentation only —
# override PORT at runtime and publish the matching port if you change it.
# This harness holds no persistent state to volume-mount: sessions live only
# in memory for the process lifetime.
EXPOSE 9000

# node:22 ships a pre-created, unprivileged `node` user (uid 1000) for
# exactly this purpose — the app never writes to disk, so it only ever needs
# read access to what was just copied in.
USER node

CMD ["node", "--use_strict", "index.js"]
