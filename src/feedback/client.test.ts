import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY_VERSION } from '../config/version.js';
import { isLeft, isRight } from '../fp/result.js';
import { createFeedbackSender, instanceId, type FeedbackDraft } from './client.js';

const draft: FeedbackDraft = {
  kind: 'bug',
  summary: 'lookup of 1003600012345 fails',
  details: 'Contact me at a@b.md',
};

const fakeFetch = (respond: () => Response | Promise<Response>) => {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return respond();
  }) as typeof fetch;
  return { sent, impl };
};

const senderWith = (impl: typeof fetch) =>
  createFeedbackSender({ url: 'https://relay.test/v1/reports', publicUrl: 'https://gw.example.com', fetch: impl });

describe('feedback sender', () => {
  it('masks text and adds version and anonymous instance id', async () => {
    const { sent, impl } = fakeFetch(() => Response.json({ id: 'R-9', duplicate: false }, { status: 201 }));
    const r = await senderWith(impl)(draft);
    assert.ok(isRight(r));
    assert.equal(r.right.id, 'R-9');
    assert.deepEqual(sent[0]?.body, {
      kind: 'bug',
      summary: 'lookup of [idno] fails',
      details: 'Contact me at [email]',
      gateway_version: GATEWAY_VERSION,
      instance: instanceId('https://gw.example.com'),
    });
    assert.match(instanceId('https://gw.example.com'), /^[a-f0-9]{16}$/);
  });

  it('maps 429 to a non-retryable rate limit', async () => {
    const r = await senderWith(fakeFetch(() => new Response('', { status: 429 })).impl)(draft);
    assert.ok(isLeft(r));
    assert.deepEqual([r.left.code, r.left.retrySafe], ['FEEDBACK_RATE_LIMITED', false]);
  });

  it('maps network failures and 5xx to retryable unavailability', async () => {
    const down = await senderWith(fakeFetch(() => Promise.reject(new Error('ECONNREFUSED'))).impl)(draft);
    const failing = await senderWith(fakeFetch(() => new Response('', { status: 503 })).impl)(draft);
    for (const r of [down, failing]) {
      assert.ok(isLeft(r));
      assert.deepEqual([r.left.code, r.left.retrySafe], ['FEEDBACK_UNAVAILABLE', true]);
    }
  });
});
