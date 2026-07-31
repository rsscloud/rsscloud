import { describe, expect, it } from 'vitest';
import { createDefaultFeedParser } from './feed-parser.js';

const parser = createDefaultFeedParser();

describe('createDefaultFeedParser — RSS', () => {
    it('extracts metadata from a full RSS feed', async () => {
        const meta = await parser.parse(
            `<?xml version="1.0"?><rss version="2.0"><channel>
                <title>Example</title>
                <description>An example feed</description>
                <link>https://site.example/</link>
                <language>en-us</language>
            </channel></rss>`
        );

        expect(meta).toEqual({
            type: 'rss',
            title: 'Example',
            description: 'An example feed',
            htmlUrl: 'https://site.example/',
            language: 'en-us'
        });
    });

    it('omits fields that are absent', async () => {
        const meta = await parser.parse(
            `<rss><channel><title>Only Title</title></channel></rss>`
        );

        expect(meta).toEqual({ type: 'rss', title: 'Only Title' });
    });

    it('returns null for an <rss> without a channel', async () => {
        expect(await parser.parse(`<rss><foo/></rss>`)).toBeNull();
    });
});

describe('createDefaultFeedParser — RDF (RSS 1.0)', () => {
    it('extracts metadata, preferring <language>', async () => {
        const meta = await parser.parse(
            `<rdf:RDF><channel>
                <title>RDF Feed</title>
                <link>https://rdf.example/</link>
                <language>fr</language>
            </channel></rdf:RDF>`
        );

        expect(meta).toEqual({
            type: 'rss',
            title: 'RDF Feed',
            htmlUrl: 'https://rdf.example/',
            language: 'fr'
        });
    });

    it('falls back to <dc:language>', async () => {
        const meta = await parser.parse(
            `<rdf:RDF><channel>
                <title>RDF</title>
                <dc:language>de</dc:language>
            </channel></rdf:RDF>`
        );

        expect(meta).toMatchObject({ type: 'rss', language: 'de' });
    });

    it('returns null for an <rdf:RDF> without a channel', async () => {
        expect(await parser.parse(`<rdf:RDF><foo/></rdf:RDF>`)).toBeNull();
    });
});

describe('createDefaultFeedParser — Atom', () => {
    it('extracts metadata and the alternate HTML link', async () => {
        const meta = await parser.parse(
            `<feed xml:lang="en">
                <title type="text">Atom Example</title>
                <subtitle>Sub</subtitle>
                <link rel="self" type="application/atom+xml" href="https://atom.example/feed"/>
                <link rel="alternate" type="text/html" href="https://atom.example/"/>
            </feed>`
        );

        expect(meta).toEqual({
            type: 'atom',
            title: 'Atom Example',
            description: 'Sub',
            htmlUrl: 'https://atom.example/',
            language: 'en'
        });
    });

    it('handles a single link with no rel or type and no language', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title><link href="https://only.example/"/></feed>`
        );

        expect(meta).toEqual({
            type: 'atom',
            title: 'A',
            htmlUrl: 'https://only.example/'
        });
    });

    it('uses the lang attribute when xml:lang is absent and has no link', async () => {
        const meta = await parser.parse(
            `<feed lang="es"><title>A</title></feed>`
        );

        expect(meta).toEqual({ type: 'atom', title: 'A', language: 'es' });
    });

    it('falls back to <tagline> for older Atom feeds', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title><tagline>Old sub</tagline></feed>`
        );

        expect(meta).toMatchObject({ type: 'atom', description: 'Old sub' });
    });

    it('accepts an xhtml alternate link', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title><link rel="alternate" type="application/xhtml+xml" href="https://xhtml.example/"/></feed>`
        );

        expect(meta).toMatchObject({ htmlUrl: 'https://xhtml.example/' });
    });

    it('keeps the first alternate link as a fallback when none are html', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title>
                <link rel="alternate" type="application/json" href="https://json.example/"/>
                <link rel="alternate" type="application/xml" href="https://xml.example/"/>
            </feed>`
        );

        expect(meta).toMatchObject({ htmlUrl: 'https://json.example/' });
    });

    it('skips links with an empty or missing href', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title>
                <link rel="alternate" href=""/>
                <link rel="alternate" type="text/html" href="https://html.example/"/>
            </feed>`
        );

        expect(meta).toMatchObject({ htmlUrl: 'https://html.example/' });
    });

    it('reads a link given as element text', async () => {
        const meta = await parser.parse(
            `<feed><title>A</title><link>https://text.example/</link></feed>`
        );

        expect(meta).toMatchObject({ htmlUrl: 'https://text.example/' });
    });

    it('treats an empty attributed element as no value', async () => {
        const meta = await parser.parse(
            `<feed><title type="html"></title><subtitle>Sub</subtitle><link href="https://x.example/"/></feed>`
        );

        expect(meta).not.toHaveProperty('title');
        expect(meta).toMatchObject({ type: 'atom', description: 'Sub' });
    });
});

describe('createDefaultFeedParser — OPML subscription lists', () => {
    // Abridged from https://iheartrss.com/subscriptions.opml — a real
    // subscription list, the kind of resource a publisher pings when the list
    // itself changes rather than any one feed on it.
    it('reads the head title off an OPML subscription list', async () => {
        const meta = await parser.parse(
            `<?xml version="1.0" encoding="UTF-8"?>
            <opml version="2.0">
              <head>
                <title>I ♥ RSS</title>
                <ownerName>iheartrss.com</ownerName>
              </head>
              <body>
                <outline type="rss" text="A Node on the Web" xmlUrl="https://rmendes.net/feed.xml"/>
              </body>
            </opml>`
        );

        expect(meta).toEqual({ type: 'opml', title: 'I ♥ RSS' });
    });

    it('still identifies an OPML list that omits its <head>', async () => {
        const meta = await parser.parse(
            `<opml version="2.0"><body><outline text="x"/></body></opml>`
        );

        expect(meta).toEqual({ type: 'opml' });
    });

    it('still identifies an OPML list whose head has no title', async () => {
        const meta = await parser.parse(
            `<opml version="2.0"><head><ownerName>nobody</ownerName></head><body/></opml>`
        );

        expect(meta).toEqual({ type: 'opml' });
    });
});

describe('createDefaultFeedParser — rejection cases', () => {
    it('returns null for an empty body', async () => {
        expect(await parser.parse('')).toBeNull();
    });

    it('returns null for a body larger than the limit', async () => {
        const small = createDefaultFeedParser({ maxResourceSize: 10 });
        expect(
            await small.parse(`<rss><channel><title>Too big</title></channel></rss>`)
        ).toBeNull();
    });

    it('returns null for invalid XML', async () => {
        expect(await parser.parse('<not-valid')).toBeNull();
    });

    it('returns null for XML that is not a feed', async () => {
        expect(await parser.parse('<html><body/></html>')).toBeNull();
    });
});
