import { Parser } from 'xml2js';
import { DEFAULT_CONFIG } from '../config.js';
import type { FeedMetadata, FeedParser } from './feed.js';

/** Construction-time options for the built-in feed parser. */
export interface DefaultFeedParserOptions {
    /** Largest body (bytes) to attempt to parse; larger bodies resolve to null. */
    maxResourceSize?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object'
        ? (value as Record<string, unknown> | null)
        : null;
}

/** Trimmed text content of an element node (xml2js: a string, or `{ _, $ }`). */
function textContent(node: unknown): string {
    if (typeof node === 'string') {
        return node.trim();
    }
    const rec = asRecord(node);
    if (rec !== null && typeof rec['_'] === 'string') {
        return rec['_'].trim();
    }
    return '';
}

/** A non-empty string attribute value, or null. */
function attr(attrs: Record<string, unknown> | null, key: string): string | null {
    if (attrs === null) {
        return null;
    }
    const value = attrs[key];
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Pick the HTML alternate link from an Atom `link` node (string, object, or array). */
function atomHtmlLink(linkNode: unknown): string {
    if (typeof linkNode === 'string') {
        return linkNode.trim();
    }

    const candidates = Array.isArray(linkNode) ? linkNode : [linkNode];
    let fallback = '';

    for (const candidate of candidates) {
        const attrs = asRecord(asRecord(candidate)?.['$']);
        const href = attr(attrs, 'href');
        if (href === null) {
            continue;
        }

        const rel = attr(attrs, 'rel');
        const type = attr(attrs, 'type');
        const isAlternate = rel === null || rel === 'alternate';
        const isHtml =
            type === null ||
            type.startsWith('text/html') ||
            type === 'application/xhtml+xml';

        if (isAlternate && isHtml) {
            return href;
        }
        if (isAlternate && fallback === '') {
            fallback = href;
        }
    }

    return fallback;
}

function compact(
    type: string,
    fields: {
        title: string;
        description: string;
        htmlUrl: string;
        language: string;
    }
): FeedMetadata {
    const meta: FeedMetadata = { type };
    if (fields.title) {
        meta.title = fields.title;
    }
    if (fields.description) {
        meta.description = fields.description;
    }
    if (fields.htmlUrl) {
        meta.htmlUrl = fields.htmlUrl;
    }
    if (fields.language) {
        meta.language = fields.language;
    }
    return meta;
}

function fromRss(channel: Record<string, unknown>): FeedMetadata {
    return compact('rss', {
        title: textContent(channel['title']),
        description: textContent(channel['description']),
        htmlUrl: textContent(channel['link']),
        language: textContent(channel['language'])
    });
}

function fromRdf(channel: Record<string, unknown>): FeedMetadata {
    return compact('rss', {
        title: textContent(channel['title']),
        description: textContent(channel['description']),
        htmlUrl: textContent(channel['link']),
        language:
            textContent(channel['language']) ||
            textContent(channel['dc:language'])
    });
}

function fromAtom(feed: Record<string, unknown>): FeedMetadata {
    const attrs = asRecord(feed['$']);
    return compact('atom', {
        title: textContent(feed['title']),
        description:
            textContent(feed['subtitle']) || textContent(feed['tagline']),
        htmlUrl: atomHtmlLink(feed['link']),
        language: attr(attrs, 'xml:lang') ?? attr(attrs, 'lang') ?? ''
    });
}

// An OPML subscription list is a resource a publisher pings when the list
// itself changes. Only <head><title> is meaningful here — the rest of the head
// is authorship/window state, and the outlines are the list's contents, not
// metadata about the list.
function fromOpml(opml: Record<string, unknown>): FeedMetadata {
    const head = asRecord(opml['head']);
    return compact('opml', {
        title: head === null ? '' : textContent(head['title']),
        description: '',
        htmlUrl: '',
        language: ''
    });
}

/**
 * The built-in {@link FeedParser}, an xml2js port of the server's parser.
 * Recognises RSS 2.0, RSS 1.0 (RDF), and Atom; resolves to null for anything
 * unrecognised, malformed, or larger than the configured limit.
 */
export function createDefaultFeedParser(
    options: DefaultFeedParserOptions = {}
): FeedParser {
    const maxResourceSize =
        options.maxResourceSize ?? DEFAULT_CONFIG.maxResourceSize;
    const parser = new Parser({
        explicitArray: false,
        mergeAttrs: false,
        trim: true
    });

    return {
        async parse(body: string): Promise<FeedMetadata | null> {
            if (body.length === 0 || body.length > maxResourceSize) {
                return null;
            }

            try {
                const parsed = (await parser.parseStringPromise(
                    body
                )) as Record<string, unknown>;

                const rss = asRecord(parsed['rss']);
                if (rss !== null) {
                    const channel = asRecord(rss['channel']);
                    if (channel !== null) {
                        return fromRss(channel);
                    }
                }

                const rdf = asRecord(parsed['rdf:RDF']);
                if (rdf !== null) {
                    const channel = asRecord(rdf['channel']);
                    if (channel !== null) {
                        return fromRdf(channel);
                    }
                }

                const feed = asRecord(parsed['feed']);
                if (feed !== null) {
                    return fromAtom(feed);
                }

                const opml = asRecord(parsed['opml']);
                if (opml !== null) {
                    return fromOpml(opml);
                }

                return null;
            } catch {
                return null;
            }
        }
    };
}
