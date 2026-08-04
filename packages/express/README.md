# @rsscloud/express

[Express](https://expressjs.com/) middleware for the
[rssCloud](https://github.com/rsscloud/rsscloud) notification protocol.

Each endpoint is a separate, drop-in handler built from a `@rsscloud/core`
engine, so an app mounts only the front doors it wants to expose:

```ts
import express from 'express';
import {
    createRssCloudCore,
    createInMemoryStore,
    createRestProtocolPlugin,
    resolveConfig
} from '@rsscloud/core';
import { pleaseNotify, ping, rpc2 } from '@rsscloud/express';

const config = resolveConfig();
const core = createRssCloudCore({
    store: createInMemoryStore(),
    plugins: [createRestProtocolPlugin()],
    config
});

const app = express();

app.post('/pleaseNotify', pleaseNotify({ core }));
app.post('/ping', ping({ core }));
app.post('/RPC2', rpc2({ core }));
```

Each handler parses its own request body (`urlencoded` for the REST front
doors, `text/*xml` for `RPC2`), resolves the caller address from
`X-Forwarded-For` or the socket, negotiates the response format from the
`Accept` header, and delegates the protocol work to `@rsscloud/core`'s
dispatchers. The handlers hold no rssCloud logic of their own.

## Install

```bash
pnpm add @rsscloud/express @rsscloud/core express
```

`express` is a peer dependency.

## License

MIT — see [LICENSE.md](./LICENSE.md).
