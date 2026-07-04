const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLinkHeader, findLinkByRel } = require('./link-header');

test('parseLinkHeader parses a single link-value with a quoted rel', () => {
    const links = parseLinkHeader('<https://hub.example/websub>; rel="hub"');

    assert.deepEqual(links, [{ url: 'https://hub.example/websub', rel: 'hub' }]);
});

test('parseLinkHeader parses multiple comma-separated link-values', () => {
    const links = parseLinkHeader(
        '<https://hub.example/websub>; rel="hub", <https://feed.example/rss>; rel="self"'
    );

    assert.deepEqual(links, [
        { url: 'https://hub.example/websub', rel: 'hub' },
        { url: 'https://feed.example/rss', rel: 'self' }
    ]);
});

test('parseLinkHeader accepts an unquoted (bare) rel value', () => {
    const links = parseLinkHeader('<https://hub.example/websub>; rel=hub');

    assert.deepEqual(links, [{ url: 'https://hub.example/websub', rel: 'hub' }]);
});

test('parseLinkHeader keeps a URL\'s own query-string comma intact', () => {
    const links = parseLinkHeader(
        '<https://hub.example/websub?a=1,2>; rel="hub"'
    );

    assert.deepEqual(links, [
        { url: 'https://hub.example/websub?a=1,2', rel: 'hub' }
    ]);
});

test('findLinkByRel returns undefined when no link matches the requested rel', () => {
    const links = parseLinkHeader('<https://hub.example/websub>; rel="hub"');

    assert.equal(findLinkByRel(links, 'self'), undefined);
});

// RFC 8288 §3.3: relation types SHOULD be treated case-insensitively.
test('findLinkByRel matches rel case-insensitively (e.g. rel="Hub")', () => {
    const links = parseLinkHeader('<https://hub.example/websub>; rel="Hub"');

    assert.equal(findLinkByRel(links, 'hub'), 'https://hub.example/websub');
});

test('parseLinkHeader returns an empty array for an empty or missing header', () => {
    assert.deepEqual(parseLinkHeader(undefined), []);
    assert.deepEqual(parseLinkHeader(''), []);
});
