import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hashRequestBody } from './idempotency.js';
import { tmpIdemStore } from '../test/helpers.js';

describe('idempotency store', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  const fresh = () => {
    const t = tmpIdemStore();
    cleanups.push(t.cleanup);
    return t.store;
  };

  it('hashes request bodies stably', () => {
    assert.equal(hashRequestBody({ a: 1 }), hashRequestBody({ a: 1 }));
    assert.notEqual(hashRequestBody({ a: 1 }), hashRequestBody({ a: 2 }));
  });

  it('acquires a new key then returns existing in_flight', () => {
    const store = fresh();
    const a = store.begin('k1', 'h1');
    assert.equal(a.tag, 'acquired');
    const b = store.begin('k1', 'h1');
    assert.equal(b.tag, 'existing');
    if (b.tag === 'existing') assert.equal(b.record.status, 'in_flight');
  });

  it('conflicts when the same key is reused with a different hash', () => {
    const store = fresh();
    store.begin('k2', 'h1');
    assert.equal(store.begin('k2', 'h2').tag, 'conflict');
  });

  it('replays succeeded responses', () => {
    const store = fresh();
    store.begin('k3', 'h1');
    store.complete('k3', 'succeeded', 200, '{"success":true}');
    const again = store.begin('k3', 'h1');
    assert.equal(again.tag, 'existing');
    if (again.tag === 'existing') {
      assert.equal(again.record.status, 'succeeded');
      assert.equal(again.record.responseJson, '{"success":true}');
    }
  });

  it('reopens failed keys for retry', () => {
    const store = fresh();
    store.begin('k4', 'h1');
    store.complete('k4', 'failed', 400, '{}');
    assert.equal(store.reopenFailed('k4', 'h1'), true);
    const rec = store.get('k4');
    assert.equal(rec?.status, 'in_flight');
  });

  it('reopens ambiguous only via explicit confirm', () => {
    const store = fresh();
    store.begin('k5', 'h1');
    store.complete('k5', 'ambiguous', 504, '{}');
    assert.equal(store.reopenFailed('k5', 'h1'), false);
    assert.equal(store.reopenAmbiguous('k5', 'h1'), true);
    assert.equal(store.get('k5')?.status, 'in_flight');
  });
});
