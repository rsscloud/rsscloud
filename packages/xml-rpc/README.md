# @rsscloud/xml-rpc

A small, generic [XML-RPC](http://xmlrpc.com/) codec — parse and build
`methodCall` / `methodResponse` documents — shared by the
[rssCloud](https://github.com/rsscloud/rsscloud-server) packages.

`@rsscloud/core` (the hub) and the `apps/debug` harness (the subscriber/publisher
end) both speak XML-RPC over the `/RPC2` front door; this package is the one home
for the encode/decode dance, so a wire bug has a single place to live. It holds no
rssCloud semantics of its own — callers map their own `rssCloud.*` method shapes
onto it.

## License

MIT — see [LICENSE.md](./LICENSE.md).
