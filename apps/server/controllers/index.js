const express = require('express'),
    config = require('../config'),
    { createFeedsOpml } = require('../services/feeds-opml'),
    { createStats } = require('../services/stats'),
    { toFeedsJson } = require('../services/feeds-json'),
    { renderMarkdownDoc } = require('../services/markdown-doc'),
    { ping, pleaseNotify, rpc2, websub } = require('@rsscloud/express'),
    { createTestController } = require('./test');

// Render-only pages — identical Accept→render/406 shells, mounted from a table
// instead of one near-duplicate router file each.
const NEGOTIATED_VIEWS = [
    { path: '/', view: 'home' },
    { path: '/pingForm', view: 'ping-form' },
    { path: '/pleaseNotifyForm', view: 'please-notify-form' }
];

// Per-protocol documentation pages, rendered from docs/<slug>.md into the shared
// `docs` view at /docs/<slug>. README.md is the index at /docs.
const DOC_PAGES = [
    { slug: 'quick-start', label: 'Quick Start' },
    { slug: 'rsscloud-rest', label: 'rssCloud over REST' },
    { slug: 'rsscloud-xml-rpc', label: 'rssCloud over XML-RPC' },
    { slug: 'websub', label: 'WebSub' },
    { slug: 'cross-protocol', label: 'How It Fits Together' }
];

// Maps the relative `.md` basenames the Markdown links to (GitHub-relative) onto
// their in-app routes, so renderMarkdownDoc can rewrite them: README → /docs,
// each page → /docs/<slug>. Unmapped targets (LICENSE.md) are left untouched.
const DOC_LINKS = DOC_PAGES.reduce(
    (links, { slug }) => ({ ...links, [slug]: `/docs/${slug}` }),
    { README: '/docs' }
);

// Render a Markdown file into the shared `docs` view, mapping a read failure to
// a 500. Routes differ only in source file, heading, and whether the redundant
// leading H1 is dropped; all share the DOC_LINKS rewrite map.
function sendMarkdownDoc(res, { file, label, stripH1 }) {
    try {
        res.render('docs', {
            title: `rssCloud Server: ${label}`,
            heading: `rssCloud Server: ${label}`,
            htmltext: renderMarkdownDoc(file, { stripH1, docLinks: DOC_LINKS })
        });
    } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
        res.status(500).send('Internal Server Error');
    }
}

// Build the server's router over an injected core (prod file-backed core, or an
// in-memory core in tests) — importing this module no longer boots a store.
function createControllers({ core }) {
    const router = new express.Router(),
        { generateOpml } = createFeedsOpml({ core }),
        { getStats } = createStats({ core });

    // Core-backed protocol front doors (@rsscloud/express driving @rsscloud/core).
    // POST-bound (the package delegates method-binding to the consumer) so a GET
    // to any of these paths still falls through to a 404, matching the legacy
    // routers. /RPC2 handles rssCloud.hello/pleaseNotify/ping; the dispatcher
    // never throws, faulting in-response on malformed or unknown calls.
    router.post('/ping', ping({ core }));
    router.post('/pleaseNotify', pleaseNotify({ core }));
    router.post('/RPC2', rpc2({ core }));

    // WebSub hub front door: validates hub.* synchronously and answers 202,
    // then verifies subscriber intent out of band (ADR-0002).
    router.post(config.webSubPath, websub({ core }));

    for (const { path, view } of NEGOTIATED_VIEWS) {
        router.get(path, (req, res) => {
            if (req.accepts('html') === 'html') {
                res.render(view);
            } else {
                res.status(406).send('Not Acceptable');
            }
        });
    }

    router.get('/docs', (req, res) => {
        if (req.accepts('html') !== 'html') {
            res.status(406).send('Not Acceptable');
            return;
        }
        sendMarkdownDoc(res, {
            file: 'README.md',
            label: 'Documentation',
            stripH1: true
        });
    });

    router.get('/docs/:page', (req, res) => {
        if (req.accepts('html') !== 'html') {
            res.status(406).send('Not Acceptable');
            return;
        }
        // Only known slugs map to a file, so an unknown (or traversal) page is a
        // plain 404 rather than a file read off disk.
        const page = DOC_PAGES.find(p => p.slug === req.params.page);
        if (page === undefined) {
            res.status(404).send('Not Found');
            return;
        }
        sendMarkdownDoc(res, {
            file: `docs/${page.slug}.md`,
            label: page.label,
            stripH1: true
        });
    });

    router.get('/LICENSE.md', (req, res) => {
        sendMarkdownDoc(res, {
            file: 'LICENSE.md',
            label: 'License',
            stripH1: false
        });
    });

    router.use('/viewLog', require('./view-log'));

    router.get('/stats', (req, res) => {
        res.render('stats', getStats());
    });

    router.get('/stats.json', (req, res) => {
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify(getStats(), null, 2));
    });

    router.get('/subscriptions.json', async(req, res, next) => {
        try {
            const feeds = toFeedsJson(await core.listFeeds());
            res.set('Content-Type', 'application/json');
            res.send(JSON.stringify({ version: 2, feeds }, null, 2));
        } catch (err) {
            next(err);
        }
    });

    router.get('/feeds.opml', async(req, res, next) => {
        try {
            res.set('Content-Type', 'text/x-opml; charset=utf-8');
            res.send(await generateOpml());
        } catch (err) {
            next(err);
        }
    });

    if (process.env.ENABLE_TEST_API === 'true') {
        router.use('/test', createTestController({ core }));
    }

    return router;
}

module.exports = { createControllers };
