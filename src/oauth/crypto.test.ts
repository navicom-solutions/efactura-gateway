import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decrypt, encrypt, hashToken, safeEqual, verifyPkceS256 } from './crypto.js';
import { jobIdFor } from '../queue/invoice-jobs.js';

describe('crypto helpers', () => {
  const key = 'a'.repeat(64);

  it('round-trips AES-GCM encryption with a random IV', () => {
    const a = encrypt('secret', key);
    const b = encrypt('secret', key);
    assert.notEqual(a, b);
    assert.equal(decrypt(a, key), 'secret');
  });

  it('rejects tampered ciphertext', () => {
    const payload = Buffer.from(encrypt('secret', key), 'base64url');
    payload[payload.length - 1] ^= 0xff;
    assert.throws(() => decrypt(payload.toString('base64url'), key));
  });

  it('verifies PKCE S256', () => {
    const verifier = 'v'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    assert.equal(verifyPkceS256(verifier, challenge), true);
    assert.equal(verifyPkceS256('other', challenge), false);
  });

  it('hashes tokens with the signing key', () => {
    assert.notEqual(hashToken('t', 'k1'), hashToken('t', 'k2'));
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('queue job ids', () => {
  it('are BullMQ-safe (no colon) and stable per idempotency key', () => {
    const id = jobIdFor('crm:invoice:42');
    assert.doesNotMatch(id, /:/);
    assert.equal(id, jobIdFor('crm:invoice:42'));
    assert.notEqual(id, jobIdFor('crm:invoice:43'));
  });
});
