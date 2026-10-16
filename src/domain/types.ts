import { z } from 'zod';
import { validationError, type AppError } from './errors.js';
import { left, right, type Either } from '../fp/result.js';

const sanitizeText = (input: string): string => input.replace(/[:*?\"<>|]/g, '');

const nonEmptySanitized = (label: string) =>
  z
    .string()
    .transform(sanitizeText)
    .refine((v) => v.length > 0, { message: `${label} cannot be empty after sanitization` });

const DateRangeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const SearchInvoicesSchema = z.object({
  actor_role: z.coerce.number().int().min(1).max(3),
  status: z.coerce.number().int(),
  number: z.string().default(''),
  serial: z.string().default(''),
  id: z.string().default(''),
  supplier_idno: z.string().default(''),
  buyer_idno: z.string().default(''),
  transporter_idno: z.string().default(''),
  issued_on: DateRangeSchema.optional(),
  delivered_on: DateRangeSchema.optional(),
  registered_on: DateRangeSchema.optional(),
  invoice_type: z.coerce.number().int().optional(),
});

export const GetInvoiceSchema = z.object({
  number: z.string().min(1),
  seria: z.string().min(1),
});

export const AssignSerialsSchema = z.object({
  count: z.coerce.number().int().positive(),
  invoiceType: z.coerce.number().int().default(0),
});

export const ActorRoleSchema = z.object({
  actor_role: z.coerce.number().int().min(1).max(3),
});

const BankAccountSchema = z.object({
  branch_title: nonEmptySanitized('Bank name'),
  branch_code: nonEmptySanitized('Branch code'),
  account: nonEmptySanitized('Account number'),
});

const PartySchema = z.object({
  idno: nonEmptySanitized('IDNO'),
  title: nonEmptySanitized('Name'),
  address: nonEmptySanitized('Address'),
  taxpayer_type: z.coerce.number().int().optional(),
  vat_number: z.string().optional(),
  bank_account: BankAccountSchema,
});

const MerchandiseSchema = z.object({
  code: z.string().transform(sanitizeText),
  name: z.string().transform(sanitizeText),
  unit_of_measure: z.string().transform(sanitizeText),
  quantity: z.coerce.number(),
  unit_price_without_tva: z.coerce.number(),
  total_price_without_tva: z.coerce.number(),
  tva: z.coerce.number(),
  total_tva: z.coerce.number(),
  total_price: z.coerce.number(),
});

const AttachmentSchema = z.object({
  name: z.string().min(1),
  base64encoded: z.string().min(1),
});

const DocumentSchema = z.object({
  delivery_date: z.string().min(1),
  notes: z.string().optional(),
  creation_motiv: z.coerce.number().int(),
  additional_information: z
    .object({
      id: z.string().optional(),
      attachments: z.array(AttachmentSchema).default([]),
    })
    .optional(),
  supplier: PartySchema,
  buyer: PartySchema,
  merchandises: z.array(MerchandiseSchema).min(1),
});

export const PostInvoiceSchema = z.object({
  actor_role: z.coerce.number().int().min(1).max(3),
  invoices_xml_status: z.coerce.number().int(),
  documents: z.array(DocumentSchema).min(1),
});

export type SearchInvoicesInput = z.infer<typeof SearchInvoicesSchema>;
export type GetInvoiceInput = z.infer<typeof GetInvoiceSchema>;
export type AssignSerialsInput = z.infer<typeof AssignSerialsSchema>;
export type ActorRoleInput = z.infer<typeof ActorRoleSchema>;
export type PostInvoiceInput = z.infer<typeof PostInvoiceSchema>;

export const parseBody = <S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): Either<AppError, z.output<S>> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    return left(validationError(message));
  }
  return right(result.data as z.output<S>);
};

export type ApiEnvelope<T = unknown> = {
  success: boolean;
  requestId: string;
  /** Snake_case aliases for clients of the original PHP gateway */
  request_id: string;
  timeStamp: string;
  timestamp: string;
  message: string;
  total: number;
  results?: T;
  data?: unknown;
  retry_safe?: boolean;
  code?: string;
  job_id?: string;
};

export const okEnvelope = <T>(
  requestId: string,
  results: T,
  total: number,
  message = '',
): ApiEnvelope<T> => {
  const ts = new Date().toISOString();
  return {
    success: true,
    requestId,
    request_id: requestId,
    timeStamp: ts,
    timestamp: ts,
    message,
    total,
    results,
  };
};

export const errEnvelope = (
  requestId: string,
  err: AppError,
  total = 0,
): ApiEnvelope => {
  const ts = new Date().toISOString();
  return {
    success: false,
    requestId,
    request_id: requestId,
    timeStamp: ts,
    timestamp: ts,
    message: err.message,
    total,
    results: [],
    retry_safe: err.retrySafe,
    code: err.code,
  };
};
