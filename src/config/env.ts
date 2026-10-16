import { z } from 'zod';
import { randomBytes } from 'node:crypto';

const EnvSchema = z.object({
  PUBLIC_URL: z.string().default('http://127.0.0.1:3000'),
  BASE_PATH: z.string().default('/v1'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  HOST_PORT: z.coerce.number().int().positive().default(3000),

  API_KEY: z.string().min(1),

  EFACTURA_ENDPOINT: z.string().url(),
  EFACTURA_USERNAME: z.string().default(''),
  EFACTURA_PASSWORD: z.string().default(''),

  SOAP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SOAP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  READ_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(4),
  READ_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(500),
  READ_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(8_000),
  WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

  DATABASE_PATH: z.string().default('./data/idempotency.db'),
  OAUTH_DATABASE_PATH: z.string().default('./data/oauth.db'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MCP_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),

  ENCRYPTION_KEY: z.string().min(32).optional(),
  TOKEN_SIGNING_KEY: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_CHANNEL: z.string().default('efactura'),
});

export type Env = z.infer<typeof EnvSchema> & {
  ENCRYPTION_KEY: string;
  TOKEN_SIGNING_KEY: string;
};

export const loadEnv = (raw: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${detail}`);
  }
  const base = parsed.data.BASE_PATH;
  const encryption =
    parsed.data.ENCRYPTION_KEY ??
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('ENCRYPTION_KEY is required in production');
        })()
      : randomBytes(32).toString('hex'));
  const signing =
    parsed.data.TOKEN_SIGNING_KEY ??
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('TOKEN_SIGNING_KEY is required in production');
        })()
      : randomBytes(32).toString('hex'));

  return {
    ...parsed.data,
    BASE_PATH: base === '/' ? '' : base.replace(/\/$/, ''),
    ENCRYPTION_KEY: encryption,
    TOKEN_SIGNING_KEY: signing,
  };
};
