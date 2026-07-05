# Changelog

## 1.0.0 (2026-07-05)


### Features

* accept WebSub-native publish to trigger fan-out ([8a81963](https://github.com/rsscloud/rsscloud-server/commit/8a819633fe46435539894875655c8c939c80ca3c))
* add realtime log page and improved test infrastructure ([0e5ac48](https://github.com/rsscloud/rsscloud-server/commit/0e5ac485b9004fc20eab6ae1f56430c43b1b50a6))
* **express:** add Express middleware for the rssCloud front doors ([fb58c5a](https://github.com/rsscloud/rsscloud-server/commit/fb58c5a32fcce18eb066f7a8b0b88fd02c6757cb))
* intent-verify WebSub unsubscribe before removal ([70b7d65](https://github.com/rsscloud/rsscloud-server/commit/70b7d65871d947e2653ef9aa98bf2b28b716f2fe))
* wire the WebSub subscribe front door (core dispatcher + express) ([c15c0ea](https://github.com/rsscloud/rsscloud-server/commit/c15c0ead8429315a705e77caa460a35c79e7bb9b))


### Bug Fixes

* **core:** preserve caller abort signal in safeFetch timeout path ([2ae15ef](https://github.com/rsscloud/rsscloud-server/commit/2ae15efeee996a4c6c2094ba65bf7ba09141ad4b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @rsscloud/core bumped to 1.0.0
