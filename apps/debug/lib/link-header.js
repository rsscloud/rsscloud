// RFC 8288-lite: only needs rel="hub"/rel="self", but handles multiple
// comma-separated link-values per a real Link header. Splits only at a comma
// immediately followed by '<' — the start of the next link-value — so a
// comma inside a URL's own query string doesn't fracture it.
function parseLinkHeader(value) {
    if (!value) {
        return [];
    }
    return value
        .split(/,\s*(?=<)/)
        .map(segment => {
            const urlMatch = /<([^>]+)>/.exec(segment);
            const relMatch = /rel=(?:"([^"]+)"|([^;,\s]+))/.exec(segment);
            if (!urlMatch) {
                return null;
            }
            return {
                url: urlMatch[1].trim(),
                rel: relMatch ? relMatch[1] ?? relMatch[2] : undefined
            };
        })
        .filter(Boolean);
}

function findLinkByRel(links, rel) {
    return links.find(link => link.rel === rel)?.url;
}

module.exports = { parseLinkHeader, findLinkByRel };
