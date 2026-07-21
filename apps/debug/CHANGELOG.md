# Changelog

## [1.0.4](https://github.com/rsscloud/rsscloud/compare/debug-v1.0.3...debug-v1.0.4) (2026-07-21)


### Bug Fixes

* **deps:** bump morgan to 1.11.0 and brace-expansion to 5.0.7 ([a8ec325](https://github.com/rsscloud/rsscloud/commit/a8ec32598003bd83eb5ad556070ed753c8e0e715))

## [1.0.3](https://github.com/rsscloud/rsscloud/compare/debug-v1.0.2...debug-v1.0.3) (2026-07-06)


### Bug Fixes

* **debug:** advertise a correct externally-reachable PUBLIC_URL, log real outgoing requests ([2f00c93](https://github.com/rsscloud/rsscloud/commit/2f00c93fb7f1a2ab2de559f898aec0c3be2ff60d))
* **debug:** validate PUBLIC_URL at startup instead of at request time ([bfe1f18](https://github.com/rsscloud/rsscloud/commit/bfe1f1895998128379ff633a104fe8fd99fb392d))

## [1.0.2](https://github.com/rsscloud/rsscloud/compare/debug-v1.0.1...debug-v1.0.2) (2026-07-06)


### Bug Fixes

* **debug:** send hub.verify on WebSub subscribe/unsubscribe ([ec27963](https://github.com/rsscloud/rsscloud/commit/ec27963736689de7aa4728bcdea33af5af8fbd43))
* **debug:** shrink the settings page's Disabled checkbox labels to content ([cecdc2e](https://github.com/rsscloud/rsscloud/commit/cecdc2e4a9c1bfba35965f4ffa726fe5a5f7fedf))
* **debug:** style the settings page's secret input like other fields ([c674588](https://github.com/rsscloud/rsscloud/commit/c674588d773b4b5e46a615c9113293e5bc1d71f8))

## [1.0.1](https://github.com/rsscloud/rsscloud-server/compare/debug-v1.0.0...debug-v1.0.1) (2026-07-05)


### Bug Fixes

* **debug:** trust the proxy so wss:// is used behind HTTPS termination ([6090d6a](https://github.com/rsscloud/rsscloud-server/commit/6090d6afb1f8995885b8a69d49dc59f2be81e8ad))

## 1.0.0 (2026-07-05)


### Features

* add realtime log page and improved test infrastructure ([0e5ac48](https://github.com/rsscloud/rsscloud-server/commit/0e5ac485b9004fc20eab6ae1f56430c43b1b50a6))
* **debug:** add a session settings page for rssCloud/WebSub configuration ([4d581ac](https://github.com/rsscloud/rsscloud-server/commit/4d581ac2995fd71b5963b6fc390e74b476ff0bbc))


### Bug Fixes

* **debug:** add favicon and match page-header underline to server ([e553449](https://github.com/rsscloud/rsscloud-server/commit/e553449deaf751f462c7a99761a5028695536f0f))
* **debug:** address settings-page code review findings ([0813c16](https://github.com/rsscloud/rsscloud-server/commit/0813c16ded630a2485120a9545d04b6842077bfc))
* **debug:** rename to "rssCloud Debug" and use a colon in settings title ([8f1f66e](https://github.com/rsscloud/rsscloud-server/commit/8f1f66ea7acb84fb75cc7d2386e5a6a574682e96))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @rsscloud/core bumped to 1.0.0
    * @rsscloud/xml-rpc bumped to 1.0.0
