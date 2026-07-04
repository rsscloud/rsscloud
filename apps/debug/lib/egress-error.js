// Turns a caught outbound-action error into a user-facing message. The one case
// worth special-casing is the SSRF egress guard (`@rsscloud/core`'s
// SsrfBlockedError) refusing a loopback/private target: on a fresh checkout with
// no `apps/debug/.env`, every call at a local hub is refused, and the raw
// "Refusing to connect …" message doesn't tell the operator how to fix it.

const ALLOWLIST_HINT =
    'The harness\'s egress guard refused a loopback/private target. ' +
    'Set DEBUG_FETCH_ALLOW_CIDRS (see apps/debug/.env.example).';

// Recognise the guard by name first (robust — set by SsrfBlockedError), falling
// back to the message shape so a re-thrown/wrapped error is still caught.
function isEgressBlock(error) {
    if (error.name === 'SsrfBlockedError') {
        return true;
    }
    return /Refusing to connect to .*(loopback|private|linkLocal|uniqueLocal) address/.test(
        error.message || ''
    );
}

// Walk the `cause` chain: undici surfaces a connector rejection as a generic
// `TypeError: fetch failed` with the real SsrfBlockedError on `.cause`, so the
// block is one hop down, not on the top-level error. The depth cap guards
// against a pathological self-referential cause.
function findEgressBlock(error) {
    let current = error;
    for (let depth = 0; current && depth < 10; depth += 1) {
        if (isEgressBlock(current)) {
            return current;
        }
        current = current.cause;
    }
    return null;
}

function describeActionError(error) {
    const block = findEgressBlock(error);
    if (block) {
        // Prefer the guard's own descriptive message ("Refusing to connect …")
        // over an outer wrapper's useless "fetch failed".
        return `${block.message} — ${ALLOWLIST_HINT}`;
    }
    return (error && error.message) || String(error);
}

module.exports = { describeActionError, ALLOWLIST_HINT };
