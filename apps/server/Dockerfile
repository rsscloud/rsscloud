FROM node:24 AS base

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/e2e/package.json apps/e2e/
COPY packages/xml-rpc/package.json packages/xml-rpc/
COPY packages/core/package.json packages/core/
COPY packages/express/package.json packages/express/

# Build the workspace packages (TS → CJS/ESM dist) the server now consumes.
FROM base AS build

COPY packages/xml-rpc packages/xml-rpc
COPY packages/core packages/core
COPY packages/express packages/express
RUN pnpm install --frozen-lockfile --filter "@rsscloud/express..."
RUN pnpm --filter "@rsscloud/express..." run build

FROM base AS dependencies

RUN pnpm install --frozen-lockfile --filter "@rsscloud/server..." --prod --ignore-scripts

FROM dependencies AS runtime

COPY apps/server apps/server
COPY --from=build /app/packages/xml-rpc/dist packages/xml-rpc/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/express/dist packages/express/dist

WORKDIR /app/apps/server

# Default listen port (config.js PORT default). Documentation only — override
# PORT at runtime and publish the matching port if you change it. Persistence of
# ./data (subscriptions + stats) is handled by the runtime volume mount, e.g.
# the `volumes:` entry in examples/dockge/compose.yaml — not declared here.
EXPOSE 5337

CMD ["node", "--use_strict", "app.js"]
