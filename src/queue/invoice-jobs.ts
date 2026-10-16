import { createHash } from 'node:crypto';
import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import type { Env } from '../config/env.js';
import type { PostInvoiceInput, ApiEnvelope } from '../domain/types.js';
import { decrypt, encrypt } from '../oauth/crypto.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import type { InvoiceServices } from '../services/invoices.js';

export const POST_INVOICE_QUEUE = 'efactura-post-invoice';

export type PostInvoiceJobInput = {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly confirmAbsent: boolean;
  readonly creds: ProviderCredentials;
  readonly body: PostInvoiceInput;
};

/** SFS credentials are AES-GCM encrypted at rest in Redis. */
type PostInvoiceJobData = Omit<PostInvoiceJobInput, 'creds'> & {
  readonly credsEncrypted: string;
};

export type PostInvoiceJobResult = {
  readonly statusCode: number;
  readonly body: ApiEnvelope;
};

export type InvoiceJobView = {
  id: string;
  state: string;
  result?: PostInvoiceJobResult;
  failedReason?: string;
};

export type InvoiceQueue = {
  readonly enqueue: (input: PostInvoiceJobInput) => Promise<{ jobId: string; reused: boolean }>;
  readonly get: (jobId: string) => Promise<InvoiceJobView | null>;
  readonly close: () => Promise<void>;
};

type AppLog = (
  level: 'info' | 'warn' | 'error' | 'debug',
  msg: string,
  meta?: Record<string, unknown>,
) => void;

const connectionFromUrl = (url: string): ConnectionOptions => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
};

/** BullMQ forbids ':' in custom ids; idempotency keys are caller-controlled. */
export const jobIdFor = (idempotencyKey: string): string =>
  `post-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}`;

const REUSABLE_STATES = new Set(['completed', 'active', 'waiting', 'delayed', 'prioritized']);

/**
 * Durable async posts. BullMQ keeps the *intent* across process crashes.
 * Worker still respects write idempotency: attempts=1 — never blind-retry
 * ambiguous upstream timeouts (ledger + X-Confirm-Absent handle that).
 */
export const createInvoiceQueue = (
  env: Env,
  services: InvoiceServices,
  log: AppLog,
): InvoiceQueue => {
  const connection = connectionFromUrl(env.REDIS_URL);

  const queue = new Queue<PostInvoiceJobData, PostInvoiceJobResult>(POST_INVOICE_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
      removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
    },
  });

  const worker = new Worker<PostInvoiceJobData, PostInvoiceJobResult>(
    POST_INVOICE_QUEUE,
    async (job: Job<PostInvoiceJobData, PostInvoiceJobResult>) => {
      log('info', 'job_start', {
        job_id: job.id,
        request_id: job.data.requestId,
        idempotency_key: job.data.idempotencyKey,
      });
      const creds = JSON.parse(
        decrypt(job.data.credsEncrypted, env.ENCRYPTION_KEY),
      ) as ProviderCredentials;
      const result = await services.postInvoice(
        job.data.body,
        creds,
        job.data.requestId,
        job.data.idempotencyKey,
        job.data.confirmAbsent,
      );
      log('info', 'job_done', {
        job_id: job.id,
        request_id: job.data.requestId,
        status_code: result.statusCode,
        success: result.body.success,
        code: result.body.code,
      });
      return result;
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log('error', 'job_failed', {
      job_id: job?.id,
      error: err.message,
    });
  });

  return {
    enqueue: async ({ creds, ...rest }) => {
      const jobId = jobIdFor(rest.idempotencyKey);
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (REUSABLE_STATES.has(state)) return { jobId, reused: true };
        await existing.remove();
      }
      const data: PostInvoiceJobData = {
        ...rest,
        credsEncrypted: encrypt(JSON.stringify(creds), env.ENCRYPTION_KEY),
      };
      await queue.add('post', data, { jobId });
      return { jobId, reused: false };
    },

    get: async (jobId) => {
      const job = await queue.getJob(jobId);
      if (!job) return null;
      const state = await job.getState();
      return {
        id: job.id ?? jobId,
        state,
        result: job.returnvalue ?? undefined,
        failedReason: job.failedReason || undefined,
      };
    },

    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
};
