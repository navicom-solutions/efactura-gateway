import { z } from 'zod';

/** Wire contract between the gateway and the feedback relay (relay/). Dependency-free besides zod. */
export const REPORT_KINDS = ['bug', 'feature_request', 'question'] as const;

export const FeedbackReportSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  summary: z.string().trim().min(5).max(120),
  details: z.string().trim().max(2000).default(''),
  tool: z.string().trim().max(64).optional(),
  error_code: z.string().trim().max(64).optional(),
  gateway_version: z.string().max(32),
  /** Anonymous, stable id of the gateway deployment (hash of its public URL). */
  instance: z.string().regex(/^[a-f0-9]{16}$/),
});

export type FeedbackReport = z.output<typeof FeedbackReportSchema>;

export type FeedbackReceipt = { readonly id: string; readonly duplicate: boolean };
