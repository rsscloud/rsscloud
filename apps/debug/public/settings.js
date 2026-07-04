// Client-side wiring for the settings form: protocol/checkbox-driven field
// visibility, and Feed-URL-blur-triggered discovery to prefill the rest of
// the form from an external feed's advertised rssCloud/WebSub config. Save
// itself needs no JS — it's a plain <form> submit that navigates the browser
// back to the main page on success.

const form = document.querySelector('form');
const context = JSON.parse(form.dataset.context);
const sessionId = location.pathname.split('/')[2];

const feedUrlInput = document.getElementById('feedUrl');
const feedUrlResetButton = document.getElementById('feedUrlResetButton');
const rssCloudDisabledCheckbox = document.getElementById('rssCloudDisabled');
const rssCloudFieldsBody = document.querySelector('.rsscloud-fields-body');
const protocolSelect = document.getElementById('rssCloudProtocol');
const acceptsSelect = document.getElementById('rssCloudAccepts');
const pingUrlInput = document.getElementById('rssCloudPingUrl');
const subscribeUrlInput = document.getElementById('rssCloudSubscribeUrl');
const rpcUrlInput = document.getElementById('rssCloudRpcUrl');
const webSubDisabledCheckbox = document.getElementById('webSubDisabled');
const webSubFieldsBody = document.querySelector('.websub-fields-body');
const hubUrlInput = document.getElementById('webSubHubUrl');
const leaseSecondsInput = document.getElementById('webSubLeaseSeconds');
const secretInput = document.getElementById('webSubSecret');
const actionError = document.getElementById('actionError');

function showActionError(message) {
    if (message) {
        actionError.textContent = message;
        actionError.hidden = false;
    } else {
        actionError.textContent = '';
        actionError.hidden = true;
    }
}

function updateProtocolVisibility() {
    const protocol = protocolSelect.value;
    const isRest = protocol === 'http-post' || protocol === 'https-post';
    document.querySelectorAll('.rsscloud-rest-only').forEach(el => {
        el.hidden = !isRest;
    });
    document.querySelectorAll('.rsscloud-xmlrpc-only').forEach(el => {
        el.hidden = protocol !== 'xml-rpc';
    });
}

// Switching between http-post/https-post implies a scheme — keep the ping
// and subscribe URLs in sync with it (rewriting only the scheme, so a
// custom host/port/path you've typed keeps its shape). No-op for xml-rpc,
// where the RPC2 URL's scheme is independent of the protocol dropdown.
function syncRestUrlSchemes() {
    const protocol = protocolSelect.value;
    if (protocol !== 'http-post' && protocol !== 'https-post') {
        return;
    }
    const scheme = protocol === 'https-post' ? 'https:' : 'http:';
    for (const input of [pingUrlInput, subscribeUrlInput]) {
        const value = input.value.trim();
        if (!value) {
            continue;
        }
        try {
            const url = new URL(value);
            url.protocol = scheme;
            input.value = url.toString();
        } catch {
            // Not a valid absolute URL yet — leave it for the user to fix.
        }
    }
}

function updateRssCloudVisibility() {
    rssCloudFieldsBody.hidden = rssCloudDisabledCheckbox.checked;
}

function updateWebSubVisibility() {
    webSubFieldsBody.hidden = webSubDisabledCheckbox.checked;
}

protocolSelect.addEventListener('change', () => {
    syncRestUrlSchemes();
    updateProtocolVisibility();
});
rssCloudDisabledCheckbox.addEventListener('change', updateRssCloudVisibility);
webSubDisabledCheckbox.addEventListener('change', updateWebSubVisibility);

// this session's own feed (any path under it) vs. an external one worth
// discovering.
function isSelfHosted(url) {
    return context.selfHostedPrefixes.some(prefix => url.startsWith(prefix));
}

// Reset only makes sense once you've pointed Feed URL at something other
// than this session's own feed — disabled the rest of the time.
function updateFeedUrlResetButton() {
    feedUrlResetButton.disabled = isSelfHosted(feedUrlInput.value.trim());
}

feedUrlInput.addEventListener('input', updateFeedUrlResetButton);
feedUrlResetButton.addEventListener('click', () => {
    showActionError(null);
    writeFormSettings(context.defaultSettings);
});

function readFormSettings() {
    return {
        feedUrl: feedUrlInput.value.trim(),
        rssCloud: {
            disabled: rssCloudDisabledCheckbox.checked,
            protocol: protocolSelect.value,
            accepts: acceptsSelect.value,
            pingUrl: pingUrlInput.value.trim(),
            subscribeUrl: subscribeUrlInput.value.trim(),
            rpcUrl: rpcUrlInput.value.trim()
        },
        webSub: {
            disabled: webSubDisabledCheckbox.checked,
            hubUrl: hubUrlInput.value.trim(),
            leaseSeconds: leaseSecondsInput.value.trim(),
            secret: secretInput.value.trim()
        }
    };
}

function writeFormSettings(settings) {
    feedUrlInput.value = settings.feedUrl;
    rssCloudDisabledCheckbox.checked = settings.rssCloud.disabled;
    protocolSelect.value = settings.rssCloud.protocol;
    acceptsSelect.value = settings.rssCloud.accepts;
    pingUrlInput.value = settings.rssCloud.pingUrl;
    subscribeUrlInput.value = settings.rssCloud.subscribeUrl;
    rpcUrlInput.value = settings.rssCloud.rpcUrl;
    webSubDisabledCheckbox.checked = settings.webSub.disabled;
    hubUrlInput.value = settings.webSub.hubUrl;
    leaseSecondsInput.value = settings.webSub.leaseSeconds;
    secretInput.value = settings.webSub.secret;
    updateFeedUrlResetButton();
    updateRssCloudVisibility();
    updateProtocolVisibility();
    updateWebSubVisibility();
}

// Guards against a stale response landing after a newer blur's — e.g. if
// the user edits and blurs again before the first request comes back,
// only the result matching the latest request may write the form.
let latestDiscoveryRequestId = 0;

feedUrlInput.addEventListener('blur', async() => {
    const feedUrl = feedUrlInput.value.trim();
    if (!feedUrl || isSelfHosted(feedUrl)) {
        return;
    }
    const requestId = ++latestDiscoveryRequestId;
    showActionError(null);
    try {
        const res = await fetch(`/s/${sessionId}/actions/discover-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedUrl, currentSettings: readFormSettings() })
        });
        const result = await res.json();
        if (requestId !== latestDiscoveryRequestId) {
            return;
        }
        if (result.error) {
            showActionError(`discover failed: ${result.error}`);
            return;
        }
        writeFormSettings(result.settings);
    } catch (error) {
        if (requestId !== latestDiscoveryRequestId) {
            return;
        }
        showActionError(`discover failed: ${error.message}`);
    }
});

updateFeedUrlResetButton();
updateRssCloudVisibility();
updateProtocolVisibility();
updateWebSubVisibility();
