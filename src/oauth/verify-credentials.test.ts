import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { upstreamHttp, upstreamNetwork, upstreamTimeout } from '../domain/errors.js';
import { createSoapStub, FIXTURES, left, right } from '../test/helpers.js';
import { createCredentialVerifier } from './verify-credentials.js';

const creds = { username: 'api-user', password: 'secret' };
const sfsHtml500 = upstreamHttp(500, 'SFS returned HTTP 500 (temporary error page). Retry in a moment.', false);

describe('createCredentialVerifier', () => {
  it('valid when SFS returns a result for the read-only call', async () => {
    const soap = createSoapStub(FIXTURES.acceptedOk);
    assert.equal(await createCredentialVerifier(soap)(creds), 'valid');
    assert.equal(soap.calls[0]?.meta.isWrite, false);
    assert.deepEqual(soap.calls[0]?.creds, creds);
  });

  it('rejected when SFS answers with its HTML 500 page', async () => {
    const soap = createSoapStub('');
    soap.handler = async () => left(sfsHtml500);
    assert.equal(await createCredentialVerifier(soap)(creds), 'rejected');
  });

  it('unavailable on timeouts, network errors and non-HTML 5xx', async () => {
    for (const err of [
      upstreamTimeout('timeout', false),
      upstreamNetwork('reset', false),
      upstreamHttp(503, 'HTTP Error: 503 Response: Service Unavailable', false),
    ]) {
      const soap = createSoapStub('');
      soap.handler = async () => left(err);
      assert.equal(await createCredentialVerifier(soap)(creds), 'unavailable', err.code);
    }
  });

  it('unavailable when the response cannot be parsed', async () => {
    const soap = createSoapStub('');
    soap.handler = async () => right('<not-soap/>');
    assert.equal(await createCredentialVerifier(soap)(creds), 'unavailable');
  });

  it('valid when SFS authenticates but reports a business status', async () => {
    const soap = createSoapStub(FIXTURES.acceptedOk.replace('<a:Status>2</a:Status>', '<a:Status>1</a:Status>'));
    assert.equal(await createCredentialVerifier(soap)(creds), 'valid');
  });
});
