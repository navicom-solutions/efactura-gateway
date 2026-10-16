export type ErrorKind =
  | 'validation'
  | 'auth'
  | 'not_found'
  | 'upstream_http'
  | 'upstream_timeout'
  | 'upstream_network'
  | 'upstream_parse'
  | 'upstream_business'
  | 'ambiguous'
  | 'conflict'
  | 'internal';

/**
 * Domains errors as values (Red Book). `retrySafe` is the contract for callers:
 * - true  → read-side / definitive failure; safe to retry the same call
 * - false → write may have succeeded upstream; DO NOT re-post without reconcile
 */
export type AppError = {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly statusCode: number;
  readonly retrySafe: boolean;
  readonly code: string;
  readonly cause?: unknown;
};

export const validationError = (message: string): AppError => ({
  kind: 'validation',
  message,
  statusCode: 400,
  retrySafe: true,
  code: 'VALIDATION_ERROR',
});

export const authError = (message = 'Invalid or missing API key'): AppError => ({
  kind: 'auth',
  message,
  statusCode: 401,
  retrySafe: true,
  code: 'UNAUTHORIZED',
});

export const notFoundError = (message: string): AppError => ({
  kind: 'not_found',
  message,
  statusCode: 404,
  retrySafe: true,
  code: 'NOT_FOUND',
});

export const conflictError = (message: string): AppError => ({
  kind: 'conflict',
  message,
  statusCode: 409,
  retrySafe: false,
  code: 'IDEMPOTENCY_CONFLICT',
});

/**
 * Upstream failures use HTTP 503 (not 502/504). Cloudflare Tunnel replaces origin 502/504
 * with its own error page, which hides our JSON body from MCP clients.
 */
export const upstreamTimeout = (message: string, forWrite: boolean): AppError => ({
  kind: 'upstream_timeout',
  message,
  // Ambiguous writes keep 504; reads use 503 so Cloudflare Tunnel does not replace the body.
  statusCode: forWrite ? 504 : 503,
  retrySafe: !forWrite,
  code: forWrite ? 'UPSTREAM_TIMEOUT_AMBIGUOUS' : 'UPSTREAM_TIMEOUT',
});

export const upstreamNetwork = (message: string, forWrite: boolean): AppError => ({
  kind: 'upstream_network',
  message,
  statusCode: forWrite ? 504 : 503,
  retrySafe: !forWrite,
  code: forWrite ? 'UPSTREAM_NETWORK_AMBIGUOUS' : 'UPSTREAM_NETWORK',
});

export const upstreamHttp = (
  status: number,
  message: string,
  forWrite: boolean,
  opts: { readonly html?: boolean } = {},
): AppError => {
  const ambiguous = forWrite && status >= 500;
  // SFS HTML 500 pages are usually bad credentials or a hard failure — do not retry-storm.
  const html = opts.html === true;
  return {
    kind: 'upstream_http',
    message,
    statusCode: status >= 500 ? (forWrite ? 504 : 503) : 400,
    retrySafe: !ambiguous && !html,
    code: ambiguous ? 'UPSTREAM_5XX_AMBIGUOUS' : 'UPSTREAM_HTTP',
  };
};

export const upstreamBusiness = (message: string, statusCode = 400): AppError => ({
  kind: 'upstream_business',
  message,
  statusCode,
  retrySafe: true,
  code: 'UPSTREAM_BUSINESS',
});

export const ambiguousWrite = (message: string): AppError => ({
  kind: 'ambiguous',
  message,
  statusCode: 504,
  retrySafe: false,
  code: 'WRITE_AMBIGUOUS',
});

export const internalError = (message: string, cause?: unknown): AppError => ({
  kind: 'internal',
  message,
  statusCode: 500,
  retrySafe: false,
  code: 'INTERNAL',
  cause,
});

export const parseError = (message: string): AppError => ({
  kind: 'upstream_parse',
  message,
  statusCode: 503,
  retrySafe: true,
  code: 'UPSTREAM_PARSE',
});
