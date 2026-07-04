const { Parser } = require('xml2js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotifyResponse } = require('./notify');

test('builds a boolean-true methodResponse', async() => {
    const parsed = await new Parser({ explicitArray: false }).parseStringPromise(
        buildNotifyResponse()
    );

    assert.equal(parsed.methodResponse.params.param.value.boolean, '1');
});
