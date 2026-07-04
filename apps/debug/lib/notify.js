const { bool, buildMethodResponse } = require('@rsscloud/xml-rpc');

// The boolean-true methodResponse a subscriber returns to acknowledge an
// XML-RPC notification.
function buildNotifyResponse() {
    return buildMethodResponse(bool(true));
}

module.exports = { buildNotifyResponse };
