import pino from 'pino';
import { loadEnv } from './config/env.js';
import { buildApp } from './http/app.js';

const env = loadEnv();
const logger = pino({
  level: env.LOG_LEVEL,
  base: { channel: env.LOG_CHANNEL, service: 'api-efactura' },
});

const log = (
  level: 'info' | 'warn' | 'error' | 'debug',
  msg: string,
  meta?: Record<string, unknown>,
): void => {
  logger[level](meta ?? {}, msg);
};

const { app, services } = buildApp({ env, log });

const shutdown = async (signal: string) => {
  log('info', 'shutdown', { signal });
  try {
    await app.close();
  } finally {
    services.close();
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT });
log('info', 'listening', {
  host: env.HTTP_HOST,
  port: env.HTTP_PORT,
  public_url: env.PUBLIC_URL,
  base_path: env.BASE_PATH,
  mcp_enabled: env.MCP_ENABLED,
  queue_enabled: env.QUEUE_ENABLED,
});
