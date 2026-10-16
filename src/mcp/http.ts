import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import type { InvoiceServices } from '../services/invoices.js';
import type { InvoiceQueue } from '../queue/invoice-jobs.js';
import type { OAuthStore } from '../oauth/store.js';
import { resolveMcpBearer, sendMcpUnauthorized } from '../oauth/routes.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { callMcpTool, MCP_TOOLS } from './tools.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

const negotiateProtocolVersion = (requested: unknown): string =>
  SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Minimal Streamable-HTTP-compatible MCP endpoint:
 * JSON-RPC initialize / tools/list / tools/call over POST /mcp.
 * Clients that need full SSE can still use tools/list + tools/call.
 */
export const registerMcpRoutes = (
  app: FastifyInstance,
  env: Env,
  store: OAuthStore,
  services: InvoiceServices,
  queue: InvoiceQueue | null,
): void => {
  app.post('/mcp', async (req, reply) => {
    const auth = resolveMcpBearer(env, store, req.headers.authorization);
    if (!auth.ok) {
      return sendMcpUnauthorized(reply, env, auth.description);
    }

    const body = (req.body ?? {}) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    const id = body.id ?? null;
    const ok = (result: unknown) => reply.send({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: '2.0', id, error: { code, message } });

    if (body.method?.startsWith('notifications/')) return reply.status(202).send();

    switch (body.method) {
      case 'initialize':
        return ok({
          protocolVersion: negotiateProtocolVersion(body.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'efactura-gateway', title: 'e-Factura Moldova', version: '1.1.0' },
          instructions: SERVER_INSTRUCTIONS,
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: MCP_TOOLS });
      case 'tools/call': {
        const name = String(body.params?.name ?? '');
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await callMcpTool(name, args, services, auth.creds, queue);
        return ok(result);
      }
      default:
        return fail(-32601, `Method not found: ${body.method ?? ''}`);
    }
  });

  app.get('/mcp', async (_req, reply) => {
    sendMcpUnauthorized(reply, env, 'Use POST JSON-RPC (initialize / tools/list / tools/call)');
  });
};
