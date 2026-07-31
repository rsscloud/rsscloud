const builder = require('xmlbuilder');
const config = require('../config');
const getDayjs = require('./dayjs-wrapper');

// Builds the `/feeds.opml` document: every tracked feed as an <outline>,
// sorted case-insensitively by display text. The controller owns the HTTP
// response (Content-Type + error forwarding); this returns the XML string.
// Reads the injected core's feed snapshot, whose `resource.feed` metadata is
// null/absent for a feed never pinged (so text falls back to the feed URL).
function createFeedsOpml({ core }) {
    async function generateOpml() {
        const dayjs = await getDayjs();
        const nowIso = dayjs().utc().format();

        const entries = await core.listFeeds();
        const outlines = [];

        for (const { feedUrl, resource } of entries) {
            const feed = (resource && resource.feed) || {};
            const text = feed.title || feedUrl;
            // A tracked resource that is itself an OPML subscription list is an
            // *inclusion*, not a feed: OPML 2.0 spells that type="include" with
            // a `url`. Emitting it as type="rss"/xmlUrl would tell an importing
            // aggregator to subscribe to the list as though it were a feed.
            const outline = feed.type === 'opml'
                ? { type: 'include', text, url: feedUrl }
                : { type: feed.type || 'rss', text, xmlUrl: feedUrl };
            if (feed.title) outline.title = feed.title;
            if (feed.description) outline.description = feed.description;
            if (feed.htmlUrl) outline.htmlUrl = feed.htmlUrl;
            if (feed.language) outline.language = feed.language;
            outlines.push(outline);
        }

        outlines.sort((a, b) =>
            a.text.toLowerCase().localeCompare(b.text.toLowerCase())
        );

        const opml = builder.create('opml', {
            version: '1.0',
            encoding: 'UTF-8'
        });
        opml.att('version', '2.0');
        const head = opml.ele('head');
        head.ele('title', {}, `rssCloud Server feeds (${config.domain})`);
        head.ele('dateCreated', {}, nowIso);
        const body = opml.ele('body');
        for (const o of outlines) {
            body.ele('outline', o);
        }

        return opml.end({ pretty: true });
    }

    return { generateOpml };
}

module.exports = { createFeedsOpml };
