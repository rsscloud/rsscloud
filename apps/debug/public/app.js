// Client-side wiring for the simplified control box. No <form> submission
// for actions — every button click fetch()es a JSON action endpoint (which
// reads its target entirely from the session's saved settings, not from
// this request's body); the outcome shows up as log entries in the live
// socklog viewer instead of navigating to a result page. Row/button
// visibility is baked into the server-rendered markup (see debug.js's
// renderPage), not toggled here.

const sessionId = document.body.dataset.sessionId;
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

// Never rejects — a network failure (can't reach the server at all) or a
// non-JSON response (e.g. a proxy's error page) never reaches the server-side
// broadcast that would otherwise show it in the traffic log, so this is the
// one place that needs its own user-visible failure path. A returned `{ error }`
// (e.g. the egress guard refusing the outbound call) is surfaced too, so a
// blocked request never masquerades as success.
async function postAction(action) {
    showActionError(null);
    try {
        const res = await fetch(`/s/${sessionId}/actions/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
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

// A row's button is only rendered when its action is available (see
// renderPage) — bindAction is a no-op for any button absent from this page.
function bindAction(buttonId, action, onSuccess) {
    const button = document.getElementById(buttonId);
    if (!button) {
        return;
    }
    button.addEventListener('click', async() => {
        // Disabled for the duration of the request — a rapid double-click
        // would otherwise fire two overlapping calls against a real hub.
        button.disabled = true;
        try {
            const result = await postAction(action);
            if (!result.error) {
                onSuccess?.(result);
            }
        } finally {
            button.disabled = false;
        }
    });
}

bindAction('rsscloudSubscribeButton', 'rsscloud-subscribe');
bindAction('rsscloudPingButton', 'rsscloud-ping');
bindAction('websubSubscribeButton', 'websub-subscribe');
bindAction('websubUnsubscribeButton', 'websub-unsubscribe');
bindAction('websubPublishButton', 'websub-publish');
bindAction('updateFeedButton', 'update-feed', result => {
    const label = document.getElementById('feedLastUpdated');
    if (label && result.lastUpdatedAt) {
        label.textContent = result.lastUpdatedAt;
    }
});
