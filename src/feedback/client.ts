import { createHash } from 'node:crypto';
import { GATEWAY_VERSION } from '../config/version.js';
import { left, right, type Either } from '../fp/result.js';
import { redact } from './redact.js';
import type { FeedbackReceipt, FeedbackReport } from './report.js';

export type FeedbackDraft = Omit<FeedbackReport, 'gateway_version' | 'instance'>;

export type FeedbackError = {
  readonly code: 'FEEDBACK_UNAVAILABLE' | 'FEEDBACK_RATE_LIMITED' | 'FEEDBACK_REJECTED';
  readonly message: string;
  readonly retrySafe: boolean;
};

export type FeedbackSent = FeedbackReceipt & { readonly report: FeedbackReport };

export type FeedbackSender = (draft: FeedbackDraft) => Promise<Either<FeedbackError, FeedbackSent>>;

type SenderConfig = {
  readonly url: string;
  readonly publicUrl: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
};

export const instanceId = (publicUrl: string): string =>
  createHash('sha256').update(publicUrl).digest('hex').slice(0, 16);

const failure = (code: FeedbackError['code'], message: string, retrySafe: boolean) =>
  left<FeedbackError, FeedbackSent>({ code, message, retrySafe });

export const createFeedbackSender = ({
  url,
  publicUrl,
  timeoutMs = 5_000,
  fetch: fetchImpl = fetch,
}: SenderConfig): FeedbackSender => {
  const instance = instanceId(publicUrl);
  return async (draft) => {
    const report: FeedbackReport = {
      ...draft,
      summary: redact(draft.summary),
      details: redact(draft.details),
      gateway_version: GATEWAY_VERSION,
      instance,
    };
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) return failure('FEEDBACK_RATE_LIMITED', 'Daily report limit reached.', false);
      if (res.status === 400) return failure('FEEDBACK_REJECTED', 'The relay rejected the report format.', false);
      if (!res.ok) return failure('FEEDBACK_UNAVAILABLE', `Feedback relay returned HTTP ${res.status}.`, true);
      const receipt = (await res.json()) as FeedbackReceipt;
      return right({ id: receipt.id, duplicate: receipt.duplicate, report });
    } catch (err) {
      return failure('FEEDBACK_UNAVAILABLE', `Feedback relay unreachable: ${(err as Error).message}`, true);
    }
  };
};
