import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerAuthError, upstreamHttp } from './errors.js';

describe('upstreamHttp', () => {
  it('maps SFS HTML 5xx to PROVIDER_UNAUTHORIZED (not 503/504)', () => {
    const read = upstreamHttp(500, 'HTML error page', false, { html: true });
    assert.equal(read.code, 'PROVIDER_UNAUTHORIZED');
    assert.equal(read.statusCode, 401);
    assert.equal(read.retrySafe, false);
    assert.equal(read.kind, 'auth');

    const write = upstreamHttp(500, 'HTML error page', true, { html: true });
    assert.equal(write.code, 'PROVIDER_UNAUTHORIZED');
    assert.equal(write.statusCode, 401);
    assert.equal(write.retrySafe, false);
  });

  it('keeps non-HTML 5xx as upstream for reads and ambiguous for writes', () => {
    const read = upstreamHttp(500, 'plain failure', false);
    assert.equal(read.code, 'UPSTREAM_HTTP');
    assert.equal(read.statusCode, 503);

    const write = upstreamHttp(500, 'plain failure', true);
    assert.equal(write.code, 'UPSTREAM_5XX_AMBIGUOUS');
    assert.equal(write.statusCode, 504);
  });

  it('providerAuthError is stable for OAuth reconnect messaging', () => {
    const err = providerAuthError();
    assert.equal(err.code, 'PROVIDER_UNAUTHORIZED');
    assert.match(err.message, /password/i);
  });
});
