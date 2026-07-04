// Client-side wiring for the unified control box. No <form> submission
// anywhere — every action is a button click that fetch()es a JSON action
// endpoint; the outcome shows up as log entries in the live socklog viewer
// instead of navigating to a result page.

const sessionId = document.body.dataset.sessionId;

const protocolSelect = document.getElementById('protocol');
const feedUrlInput = document.getElementById('feedUrl');
const feedNameInput = document.getElementById('feedName');
const serverOverrideInput = document.getElementById('serverOverride');
const leaseSecondsInput = document.getElementById('leaseSeconds');
const secretInput = document.getElementById('secret');
const pingButton = document.getElementById('pingButton');
const publishButton = document.getElementById('publishButton');
const actionError = document.getElementById('actionError');

// Surface (or clear) a failed action prominently. A blocked/failed call is
// otherwise only a line in the socklog stream, easily mistaken for success.
function showActionError(message) {
    if (message) {
        actionError.textContent = message;
        actionError.hidden = false;
    } else {
        actionError.textContent = '';
        actionError.hidden = true;
    }
}

// The most recent successful discovery, so switching the protocol dropdown
// can re-populate the override field without a second round trip.
let lastDiscovery = null;

// Never rejects — a network failure (can't reach the server at all) or a
// non-JSON response (e.g. a proxy's error page) never reaches the server-side
// broadcast that would otherwise show it in the traffic log, so this is the
// one place that needs its own user-visible failure path. A returned `{ error }`
// (e.g. the egress guard refusing the outbound call) is surfaced too, so a
// blocked request never masquerades as success.
async function postAction(action, fields) {
    showActionError(null);
    try {
        const res = await fetch(`/s/${sessionId}/actions/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
        });
        const result = await res.json();
        if (result && result.error) {
            showActionError(`${action} failed: ${result.error}`);
        }
        return result;
    } catch (error) {
        console.error(`${action} failed:`, error);
        showActionError(`${action} failed: ${error.message}`);
        return { error: error.message };
    }
}

// Show only the controls relevant to the selected protocol. Never
// hard-disables the others — forcing an undetected/unselected protocol is a
// deliberate testing feature, not a bug.
function updateProtocolVisibility() {
    const isWebSub = protocolSelect.value === 'websub';
    document.querySelectorAll('.websub-only').forEach(el => {
        el.hidden = !isWebSub;
    });
    document.querySelectorAll('.rsscloud-only').forEach(el => {
        el.hidden = isWebSub;
    });
    applyDiscoveryToOverride();
}

// Populate the override field from the last discovery, interpreted for
// whichever protocol is currently selected.
function applyDiscoveryToOverride() {
    if (!lastDiscovery) {
        return;
    }
    if (protocolSelect.value === 'websub' && lastDiscovery.webSub) {
        serverOverrideInput.value = lastDiscovery.webSub.hubUrl;
    } else if (protocolSelect.value !== 'websub' && lastDiscovery.rssCloud) {
        const { domain, port } = lastDiscovery.rssCloud;
        serverOverrideInput.value = `http://${domain}:${port}`;
    }
}

// Subscriber mode: an external feed URL means we're testing someone else's
// feed, so we must never fake-publish or ping it. This mirrors the
// server-side enforcement (the ping/publish actions only ever accept a
// feedName, never a feedUrl) at the UI layer.
function updateSubscriberMode() {
    const isExternal = feedUrlInput.value.trim() !== '';
    pingButton.disabled = isExternal;
    publishButton.disabled = isExternal;
}

function currentFeedTarget() {
    const feedUrl = feedUrlInput.value.trim();
    return feedUrl ? { feedUrl } : { feedName: feedNameInput.value.trim() };
}

function currentServerOverride() {
    const value = serverOverrideInput.value.trim();
    return value ? { server: value } : {};
}

protocolSelect.addEventListener('change', updateProtocolVisibility);
feedUrlInput.addEventListener('input', updateSubscriberMode);

document.getElementById('discoverButton').addEventListener('click', async() => {
    const feedUrl = feedUrlInput.value.trim();
    if (!feedUrl) {
        return;
    }
    const result = await postAction('discover', { feedUrl });
    lastDiscovery = result;
    if (result.rssCloud && result.rssCloud.protocol === 'xml-rpc') {
        protocolSelect.value = 'rsscloud-xml-rpc';
    } else if (result.rssCloud) {
        protocolSelect.value = 'rsscloud-rest';
    } else if (result.webSub) {
        protocolSelect.value = 'websub';
    }
    updateProtocolVisibility();
});

document.getElementById('subscribeButton').addEventListener('click', () => {
    postAction('subscribe', {
        protocol: protocolSelect.value,
        leaseSeconds: leaseSecondsInput.value
            ? parseInt(leaseSecondsInput.value, 10)
            : undefined,
        secret: secretInput.value || undefined,
        ...currentFeedTarget(),
        ...currentServerOverride()
    });
});

document.getElementById('unsubscribeButton').addEventListener('click', () => {
    postAction('unsubscribe', {
        ...currentFeedTarget(),
        ...currentServerOverride()
    });
});

pingButton.addEventListener('click', () => {
    postAction('ping', {
        protocol: protocolSelect.value,
        feedName: feedNameInput.value.trim(),
        ...currentServerOverride()
    });
});

publishButton.addEventListener('click', () => {
    postAction('publish', {
        feedName: feedNameInput.value.trim(),
        ...currentServerOverride()
    });
});

updateProtocolVisibility();
updateSubscriberMode();
