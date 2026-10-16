import { FeedbackReportSchema, type FeedbackReceipt, type FeedbackReport } from '../../src/feedback/report.js';
import { redact } from '../../src/feedback/redact.js';

export type StoredReport = FeedbackReport & {
  readonly id: string;
  readonly received_at: string;
  readonly ip_hash: string;
};

export interface ReportStore {
  countSince(field: 'instance' | 'ip_hash', value: string, sinceIso: string): Promise<number>;
  findDuplicate(instance: string, summary: string, sinceIso: string): Promise<string | null>;
  insert(report: StoredReport): Promise<void>;
  recent(limit: number): Promise<StoredReport[]>;
}

export type Notifier = (report: StoredReport) => Promise<void>;

export type RelayDeps = {
  readonly store: ReportStore;
  readonly notifiers: readonly Notifier[];
  readonly adminToken: string | undefined;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly hash: (value: string) => Promise<string>;
  /** Runs work after the response is sent (ctx.waitUntil on Workers). */
  readonly defer: (work: Promise<unknown>) => void;
  readonly log: (msg: string, meta: Record<string, unknown>) => void;
};

export const LIMITS = {
  bodyBytes: 8 * 1024,
  perInstancePerDay: 10,
  perIpPerDay: 30,
  windowMs: 24 * 60 * 60 * 1000,
  adminListMax: 100,
} as const;

const json = (status: number, body: unknown) => Response.json(body, { status });

const bearer = (req: Request): string => (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const readJson = async (req: Request): Promise<unknown> => {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const notifyAll = async (deps: RelayDeps, report: StoredReport): Promise<void> => {
  const results = await Promise.allSettled(deps.notifiers.map((notify) => notify(report)));
  for (const r of results) {
    if (r.status === 'rejected') deps.log('notify failed', { id: report.id, error: String(r.reason) });
  }
};

const submit = async (req: Request, deps: RelayDeps): Promise<Response> => {
  const parsed = FeedbackReportSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(400, { error: 'invalid_report' });

  const report = { ...parsed.data, summary: redact(parsed.data.summary), details: redact(parsed.data.details) };
  const now = deps.now();
  const since = new Date(now.getTime() - LIMITS.windowMs).toISOString();
  const ipHash = await deps.hash(req.headers.get('cf-connecting-ip') ?? 'unknown');

  const duplicate = await deps.store.findDuplicate(report.instance, report.summary, since);
  if (duplicate) return json(200, { id: duplicate, duplicate: true } satisfies FeedbackReceipt);

  const [byInstance, byIp] = await Promise.all([
    deps.store.countSince('instance', report.instance, since),
    deps.store.countSince('ip_hash', ipHash, since),
  ]);
  if (byInstance >= LIMITS.perInstancePerDay || byIp >= LIMITS.perIpPerDay) {
    return json(429, { error: 'rate_limited' });
  }

  const stored: StoredReport = { ...report, id: deps.newId(), received_at: now.toISOString(), ip_hash: ipHash };
  await deps.store.insert(stored);
  deps.defer(notifyAll(deps, stored));
  return json(201, { id: stored.id, duplicate: false } satisfies FeedbackReceipt);
};

const list = async (req: Request, deps: RelayDeps): Promise<Response> => {
  if (!deps.adminToken || !constantTimeEqual(bearer(req), deps.adminToken)) return json(401, { error: 'unauthorized' });
  const requested = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), LIMITS.adminListMax);
  return json(200, { reports: await deps.store.recent(limit) });
};

export const handle = async (req: Request, deps: RelayDeps): Promise<Response> => {
  const { pathname } = new URL(req.url);
  if (pathname === '/health') return json(200, { ok: true });
  if (pathname !== '/v1/reports') return json(404, { error: 'not_found' });
  if (req.method === 'POST') return submit(req, deps);
  if (req.method === 'GET') return list(req, deps);
  return json(405, { error: 'method_not_allowed' });
};
