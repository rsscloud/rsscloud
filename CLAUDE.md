# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [rssCloud](http://rsscloud.org/) notification protocol server. Subscribers register a callback URL via `/pleaseNotify`; publishers `/ping` when feeds update; the server fans notifications out to subscribers. Implementation lives in `apps/server/`.

## Development workflow

Build features and fix bugs with the **`tdd` skill** — strict red-green-refactor, one vertical slice at a time. Write a failing test, make it pass, refactor; don't batch all the tests and all the code together.

Packages under `packages/` (e.g. `@rsscloud/core`) are held to **100% code coverage**. Keep them there — every branch and line exercised by a test. If something genuinely can't or shouldn't be covered, justify it with an explicit ignore rather than letting coverage slip.

## Data storage

State (resources and subscriptions) is held in memory and persisted atomically to a JSON file (default `./data/subscriptions.json`, configurable via `DATA_FILE_PATH`). The flush happens on an interval, at shutdown, and on unexpected exit. There is no external database.

## End-to-end tests

`apps/e2e/` is a private workspace package holding a full mocha suite. Tests talk to the server over HTTP via `APP_URL` and spin up their own mock servers on ports 8002/8003.

A handful of server-internal helpers (RPC builders, dayjs wrapper, `init-subscription`, three config keys) are **intentionally duplicated** in `apps/e2e/test/helpers/` rather than imported across the workspace boundary. This preserves the e2e package as an independent consumer of the server's HTTP+RPC protocol, at the cost of some maintenance overhead if those helpers' wire-shape ever changes. If you find yourself adding a new `require('../...')` in a test file, prefer copying the dependency into `helpers/` instead.

## Releases

Conventional Commits are enforced by commitlint (via husky). Pushes to `main` trigger [release-please](https://github.com/googleapis/release-please) which opens or updates a Release PR per tracked package (`apps/server`, `apps/client`, `packages/xml-rpc`, `packages/core`, `packages/express`). The `node-workspace` plugin keeps internal `workspace:*` deps in lockstep, cascading a release to dependents when a dependency bumps (`core` → `express` → `server`; `core` → `client`). `apps/e2e` is private and not tracked. Merging the Release PR cuts the release and git tag.

`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major. Other types (`chore:`, `docs:`, `style:`, `refactor:`, `test:`, `ci:`, `build:`) don't trigger releases.
