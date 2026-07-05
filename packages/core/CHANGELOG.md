# Changelog

## 1.0.0 (2026-07-05)


### Features

* accept WebSub-native publish to trigger fan-out ([8a81963](https://github.com/rsscloud/rsscloud-server/commit/8a819633fe46435539894875655c8c939c80ca3c))
* add realtime log page and improved test infrastructure ([0e5ac48](https://github.com/rsscloud/rsscloud-server/commit/0e5ac485b9004fc20eab6ae1f56430c43b1b50a6))
* **core:** add @rsscloud/core interface contracts ([3d46f8f](https://github.com/rsscloud/rsscloud-server/commit/3d46f8ff618c25271fb98a3cbf1a15fafc5d99ed))
* **core:** add async-202 accept seam for WebSub subscriptions ([169b2d6](https://github.com/rsscloud/rsscloud-server/commit/169b2d6267284330635b4e472990f409f2d0825a))
* **core:** add file-backed Store adapter ([2acf6b0](https://github.com/rsscloud/rsscloud-server/commit/2acf6b0eab24efd2834923f7354b09cee5f21ce3))
* **core:** add REST front door dispatcher ([d20905a](https://github.com/rsscloud/rsscloud-server/commit/d20905aa227ac5343821db5fd29c4233bf8fcdf9))
* **core:** add SSRF egress guard for outbound fetches ([0e57cf8](https://github.com/rsscloud/rsscloud-server/commit/0e57cf8ac113d61b45bf3b424fab9f109b2f2d33))
* **core:** add xml-rpc rssCloud plugin and dispatcher ([7364a71](https://github.com/rsscloud/rsscloud-server/commit/7364a71ab79e5a696cfc1d7f5d8a10c4bc5aac23))
* **core:** expose the change-window size on Stats ([2501d74](https://github.com/rsscloud/rsscloud-server/commit/2501d741bef5f76a31d8afeb705dfc41bcbada6a))
* **core:** implement REST-capable rssCloud engine ([51273d2](https://github.com/rsscloud/rsscloud-server/commit/51273d2bfc8371b0b5828bc8b97273ef4d33d8fe))
* **core:** parse and validate WebSub hub.* subscribe requests ([9435356](https://github.com/rsscloud/rsscloud-server/commit/9435356f3068abfea0e398ecf47239c5483171ef))
* **core:** persist the domain model as a versioned v2 file format ([f678d2b](https://github.com/rsscloud/rsscloud-server/commit/f678d2ba7b19ca8ac8221e38b8c4c9fda94dd2fd))
* **core:** verify WebSub subscriber intent with a challenge GET ([8789847](https://github.com/rsscloud/rsscloud-server/commit/878984793871923ca8436bd2b3b4e5703f0cf739))
* distribute feed content to WebSub subscribers on fan-out ([9615369](https://github.com/rsscloud/rsscloud-server/commit/9615369ce4bd61cc5f6b168cb634a8517d8d0409))
* honor WebSub lease requests, clamped to configured bounds ([7328aef](https://github.com/rsscloud/rsscloud-server/commit/7328aefdffc224eb0c117de55c2a980872bad04b))
* intent-verify WebSub unsubscribe before removal ([70b7d65](https://github.com/rsscloud/rsscloud-server/commit/70b7d65871d947e2653ef9aa98bf2b28b716f2fe))
* sign WebSub deliveries with X-Hub-Signature ([7f3349e](https://github.com/rsscloud/rsscloud-server/commit/7f3349e4dc26a0df882c358061e1364e74b7529b))
* wire the WebSub subscribe front door (core dispatcher + express) ([c15c0ea](https://github.com/rsscloud/rsscloud-server/commit/c15c0ead8429315a705e77caa460a35c79e7bb9b))


### Bug Fixes

* **core:** absorb synchronous throws in the verification scheduler ([aa46dcb](https://github.com/rsscloud/rsscloud-server/commit/aa46dcbb7b123890d11d78daa717a9097c21f002))
* **core:** bound rssCloud REST notify redirects to prevent loops ([c08b174](https://github.com/rsscloud/rsscloud-server/commit/c08b1742eeaa8a2c493a11a283d9492826926c59))
* **core:** bound WebSub delivery redirects to prevent loops ([703b2fd](https://github.com/rsscloud/rsscloud-server/commit/703b2fdd95a06c755c7faf54d8a7c4b20b9a7222))
* **core:** fail WebSub delivery when the hub URL is unconfigured ([ce1c4c7](https://github.com/rsscloud/rsscloud-server/commit/ce1c4c725984b23de0a42c0055a7e2e94fd68453))
* **core:** match dispatcher wire messages to the rssCloud contract ([bc87b3c](https://github.com/rsscloud/rsscloud-server/commit/bc87b3cade949be91035330da54e28b9d102af50))
* **core:** preserve caller abort signal in safeFetch timeout path ([2ae15ef](https://github.com/rsscloud/rsscloud-server/commit/2ae15efeee996a4c6c2094ba65bf7ba09141ad4b))
* **core:** reject non-URL hub.topic/hub.url with a synchronous 400 ([e43a7a4](https://github.com/rsscloud/rsscloud-server/commit/e43a7a4daf0292b2bb006f37e1b546b4044ba7b3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @rsscloud/xml-rpc bumped to 1.0.0
