import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { delayForAttempt, isRetryableReadError } from './backoff.js';
import { ambiguousWrite, upstreamTimeout } from '../domain/errors.js';

describe('backoff', () => {
  it('marks write timeouts as non-retryable', () => {
    assert.equal(isRetryableReadError(upstreamTimeout('t', true)), false);
    assert.equal(isRetryableReadError(upstreamTimeout('t', false)), true);
    assert.equal(isRetryableReadError(ambiguousWrite('a')), false);
  });

  it('produces jittered delays within max', () => {
    const policy = { maxRetries: 3, baseMs: 100, maxMs: 400 };
    for (let i = 0; i < 20; i++) {
      const d = delayForAttempt(i, policy);
      assert.ok(d >= 0 && d <= 400);
    }
  });
});
