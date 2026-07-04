# Quick Start

For someone **publishing** an RSS feed: two steps get your subscribers notified the
moment you publish, instead of waiting on their next poll.

1. **Advertise this server** from your feed, so subscribers (and their tools) know
   where to register.
2. **Tell this server** each time your feed changes, so it can notify subscribers.

## 1. Advertise this server in your feed

Add all three of these to your feed's `<channel>` — included together, they give you
the widest feed reader support:

```xml
<rss version="2.0"
     xmlns:source="https://source.scripting.com/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>My Feed</title>
    <link>https://feed.example/rss</link>
    <description>…</description>

    <cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post"/>
    <source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>
    <atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>
    <atom:link rel="self" href="https://feed.example/rss"/>

    <item>…</item>
  </channel>
</rss>
```

- **`<cloud>`** — the original cloud element, and the one most feed readers support.
- **`<source:cloud>`** — the new way, supported by the latest feed readers.
- **`<atom:link rel="hub">`** (with `rel="self"` alongside it) — an alternative method,
  WebSub, that some feed readers support.

## 2. Tell this server when your feed changes

Advertising this server only tells subscribers where to register — it still needs to
hear from **you** that something changed before it notifies anyone.

- **Manually**, for a one-off test: submit your feed via our [Ping Form](/pingForm).
- **Automatically (preferred)**: have your publishing pipeline `POST /ping` right after
  every update, so it happens without you in the loop:

    ```bash
    curl -X POST https://rpc.rsscloud.io/ping -d url=https://feed.example/rss
    ```

See [rssCloud over REST](rsscloud-rest.md#post-ping) for the full request/response
shape, or [WebSub → Publishing](websub.md#publishing) for the WebSub-native
equivalent. Either one reaches **every** subscriber regardless of which protocol they
registered with — see [How it fits together](cross-protocol.md).

---

← [Back to the documentation index](../README.md)
