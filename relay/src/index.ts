import { createD1Store } from './d1-store.js';
import { emailNotifier } from './email.js';
import { handle, type Notifier } from './handler.js';
import { telegramNotifier } from './notify.js';

export interface Env {
  readonly DB: D1Database;
  readonly ADMIN_TOKEN?: string;
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly TELEGRAM_CHAT_ID?: string;
  readonly EMAIL?: SendEmail;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_TO?: string;
}

const notifiersFor = (env: Env): Notifier[] => [
  ...(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? [telegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)] : []),
  ...(env.EMAIL && env.EMAIL_FROM && env.EMAIL_TO ? [emailNotifier(env.EMAIL, env.EMAIL_FROM, env.EMAIL_TO)] : []),
];

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

export default {
  fetch: (req, env, ctx) =>
    handle(req, {
      store: createD1Store(env.DB),
      notifiers: notifiersFor(env),
      adminToken: env.ADMIN_TOKEN,
      now: () => new Date(),
      newId: () => `R-${crypto.randomUUID().slice(0, 8)}`,
      hash: sha256Hex,
      defer: (work) => ctx.waitUntil(work),
      log: (msg, meta) => console.error(msg, meta),
    }),
} satisfies ExportedHandler<Env>;
