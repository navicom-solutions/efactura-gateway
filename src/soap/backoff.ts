import type { AppError } from '../domain/errors.js';
import { isLeft, type Either } from '../fp/result.js';

export type BackoffPolicy = {
  readonly maxRetries: number;
  readonly baseMs: number;
  readonly maxMs: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Full jitter: random in [0, min(max, base * 2^attempt)] */
export const delayForAttempt = (attempt: number, policy: BackoffPolicy): number => {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
};

export const isRetryableReadError = (err: AppError): boolean =>
  err.retrySafe &&
  (err.kind === 'upstream_timeout' ||
    err.kind === 'upstream_network' ||
    err.kind === 'upstream_http' ||
    err.kind === 'upstream_parse');

/**
 * Retry ONLY when the error is marked retrySafe.
 * Writes that time out must never enter this path.
 */
export const withReadRetries = async <A>(
  label: string,
  policy: BackoffPolicy,
  run: () => Promise<Either<AppError, A>>,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<Either<AppError, A>> => {
  let last: Either<AppError, A> | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    last = await run();
    if (!isLeft(last)) return last;

    const err = last.left;
    if (!isRetryableReadError(err) || attempt === policy.maxRetries) {
      return last;
    }

    const wait = delayForAttempt(attempt, policy);
    log?.('read_retry', {
      label,
      attempt: attempt + 1,
      wait_ms: wait,
      code: err.code,
      message: err.message,
    });
    await sleep(wait);
  }

  return last!;
};
