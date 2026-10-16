import { XMLParser } from 'fast-xml-parser';
import { parseError, upstreamBusiness, type AppError } from '../domain/errors.js';
import { left, right, type Either } from '../fp/result.js';
import { parseInvoiceXml } from '../xml/invoiceParser.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  // Keep tag text as strings. Default number parsing drops leading zeros on invoice
  // numbers (000787493 → 787493), and GetInvoicesBySeriaNumber then returns "not found".
  parseTagValue: false,
  isArray: (name) =>
    ['Invoice', 'SeriaAndNumber', 'Taxpayer', 'XmlInvoice', 'string'].includes(name),
});

const asArray = <T>(v: T | T[] | undefined | null): T[] => {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
};

/** Text content of a parsed node; nil elements (`i:nil="true"`) parse as attribute-only objects. */
const text = (v: unknown, fallback = ''): string => {
  if (v == null) return fallback;
  if (typeof v !== 'object') return String(v);
  const inner = (v as Record<string, unknown>)['#text'];
  return inner == null ? fallback : String(inner);
};

const dig = (obj: unknown, path: string[]): unknown => {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

const findResult = (parsed: unknown, resultKey: string): Record<string, unknown> | undefined => {
  const body = dig(parsed, ['Envelope', 'Body']);
  if (!body || typeof body !== 'object') return undefined;
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (value && typeof value === 'object' && resultKey in (value as object)) {
      return (value as Record<string, unknown>)[resultKey] as Record<string, unknown>;
    }
  }
  // deep-ish fallback
  const json = JSON.stringify(parsed);
  if (!json.includes(resultKey)) return undefined;
  const walk = (node: unknown): Record<string, unknown> | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    const rec = node as Record<string, unknown>;
    if (resultKey in rec && rec[resultKey] && typeof rec[resultKey] === 'object') {
      return rec[resultKey] as Record<string, unknown>;
    }
    for (const v of Object.values(rec)) {
      const found = walk(v);
      if (found) return found;
    }
    return undefined;
  };
  return walk(parsed);
};

export const parseSoapXml = (xml: string): Either<AppError, unknown> => {
  try {
    return right(parser.parse(xml));
  } catch (err) {
    return left(parseError(`Failed to parse XML: ${err instanceof Error ? err.message : String(err)}`));
  }
};

export type SearchResult = {
  success: boolean;
  requestId: string;
  timeStamp: string;
  message: string;
  total: number;
  results: Array<Record<string, unknown>>;
};

export const parseSearchResponse = (xml: string): Either<AppError, SearchResult> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const result = findResult(parsedE.right, 'SearchInvoicesResult');
  if (!result) return left(parseError('No SearchInvoicesResult found in response'));

  const status = Number(result.Status ?? 0);
  const invoices = asArray(dig(result, ['Results', 'Invoice']) as Record<string, unknown>);
  const results =
    status === 2
      ? invoices.map((inv) => {
          const row = inv as Record<string, unknown>;
          const seria = String(row.Seria ?? '');
          return {
            number: String(row.Number ?? ''),
            // `seria` kept for clients of the original PHP gateway
            serial: seria,
            seria,
            status: Number(row.Status ?? 0),
            invoiceStatus: Number(row.InvoiceStatus ?? 0),
            message: text(row.Message),
            timeStamp: String(row.TimeStamp ?? ''),
          };
        })
      : [];

  return right({
    success: status === 2,
    requestId: String(result.RequestId ?? ''),
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    message: text(result.Message),
    total: results.length,
    results,
  });
};

export const parseGetBySeriaResponse = (xml: string): Either<AppError, SearchResult> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const result = findResult(parsedE.right, 'GetInvoicesBySeriaNumberResult');
  if (!result) return left(parseError('No GetInvoicesBySeriaNumberResult found in response'));

  const status = Number(result.Status ?? 0);
  const nodes = asArray(dig(result, ['Results', 'XmlInvoice'])).map(
    (n) => n as Record<string, unknown>,
  );
  let success = status === 2;
  let message = text(result.Message);
  const results: Array<Record<string, unknown>> = [];

  if (nodes[0] && Number(nodes[0].Status ?? 2) !== 2) {
    success = false;
    message = String(nodes[0].Message ?? message);
  }

  if (success) {
    for (const node of nodes) {
      const invoice: Record<string, unknown> = {
        seria: String(node.Seria ?? ''),
        number: String(node.Number ?? ''),
        status: Number(node.Status ?? 0),
        invoiceStatus: Number(node.InvoiceStatus ?? 0),
        message: text(node.Message),
        timeStamp: String(node.TimeStamp ?? ''),
      };
      if (typeof node.Xml === 'string' && node.Xml.length > 0) {
        invoice.invoice = parseInvoiceXml(node.Xml);
      }
      results.push(invoice);
    }
  }

  return right({
    success,
    requestId: String(result.RequestId ?? ''),
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    message,
    total: results.length,
    results,
  });
};

export const parseAssignSerialsResponse = (
  xml: string,
): Either<AppError, SearchResult> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const result = findResult(parsedE.right, 'GetSeriaAndNumbersResult');
  if (!result) return left(parseError('Invalid response format: missing GetSeriaAndNumbersResult'));

  const status = String(result.Status ?? '');
  const items = asArray(dig(result, ['Results', 'SeriaAndNumber'])).map(
    (n) => n as Record<string, unknown>,
  );
  const results = items.map((item) => ({
    number: String(item.Number ?? ''),
    seria: String(item.Seria ?? ''),
    status: Number(item.Status ?? 0),
  }));

  return right({
    success: status === '2',
    requestId: String(result.RequestId ?? ''),
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    message: '',
    total: results.length,
    results,
  });
};

export type PostResult = {
  success: boolean;
  requestId: string;
  timeStamp: string;
  message: string;
  total: number;
  results: Array<{ total_invoices: number; total_invoices_posted: number }>;
};

export const parsePostInvoicesResponse = (
  xml: string,
  withAttachment: boolean,
): Either<AppError, PostResult> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const key = withAttachment ? 'PostInvoicesWithAttachmentResult' : 'PostInvoicesResult';
  const result = findResult(parsedE.right, key);
  if (!result) return left(parseError(`No ${key} found in response`));

  const posted = Number(result.TotalInvoicesPosted ?? 0);
  const total = Number(result.TotalInvoices ?? 0);
  const errorMessage = text(result.ErrorMessage).trim();
  const success = posted > 0;

  return right({
    success,
    requestId: String(result.RequestId ?? ''),
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    message: success
      ? 'Invoice(s) posted successfully.'
      : errorMessage
        ? `No invoices were posted. Efactura responded: ${errorMessage}`
        : 'No invoices were posted successfully.',
    total,
    results: [{ total_invoices: total, total_invoices_posted: posted }],
  });
};

export type TaxpayerData = {
  address: string;
  vat_number: string;
  exists_in_tax_registry: boolean;
  idno: string;
  is_efactura_actor: boolean;
  name: string;
  taxpayer_type: number;
};

export const parseTaxpayerResponse = (
  xml: string,
  _requestId: string,
): Either<AppError, { success: boolean; message: string; timeStamp: string; data: TaxpayerData | null }> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const result = findResult(parsedE.right, 'GetTaxpayersInfoResult');
  if (!result) return left(parseError('Could not find result node in SOAP response.'));

  const status = Number(result.Status ?? 0);
  const taxpayers = asArray(dig(result, ['Results', 'Taxpayer'])).map(
    (n) => n as Record<string, unknown>,
  );
  const node = taxpayers[0];
  if (!node) {
    return right({
      success: false,
      message: text(result.Message, 'Taxpayer does not exist in the registry.'),
      timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
      data: null,
    });
  }

  const data: TaxpayerData = {
    address: String(node.Address ?? ''),
    vat_number: String(node.CodTVA ?? '').trim(),
    exists_in_tax_registry: String(node.ExistInTaxRegistry ?? '').toLowerCase() === 'true',
    idno: String(node.IDNO ?? ''),
    is_efactura_actor: String(node.IsEFacturaActor ?? '').toLowerCase() === 'true',
    name: String(node.Name ?? ''),
    taxpayer_type: Number(node.TaxpayerType ?? 0),
  };

  const success = status === 1 && data.exists_in_tax_registry;
  let message = text(result.Message);
  if (!success && !message) {
    message = data.exists_in_tax_registry
      ? 'Failed to retrieve valid taxpayer information.'
      : 'Taxpayer does not exist in the registry.';
  }

  return right({
    success,
    message,
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    data: success ? data : data.exists_in_tax_registry ? data : null,
  });
};

export const parseInvoiceListResponse = (
  xml: string,
  resultKey: string,
): Either<AppError, SearchResult> => {
  const parsedE = parseSoapXml(xml);
  if (parsedE._tag === 'Left') return parsedE;
  const result = findResult(parsedE.right, resultKey);
  if (!result) return left(parseError(`No ${resultKey} found in response`));

  const status = Number(result.Status ?? 0);
  const invoices = asArray(dig(result, ['Results', 'Invoice'])).map(
    (n) => n as Record<string, unknown>,
  );
  const results = invoices.map((inv) => ({
    number: String(inv.Number ?? ''),
    seria: String(inv.Seria ?? ''),
    status: Number(inv.Status ?? 0),
    invoiceStatus: Number(inv.InvoiceStatus ?? 0),
    message: text(inv.Message),
    timeStamp: String(inv.TimeStamp ?? ''),
  }));

  if (status !== 2) {
    return left(upstreamBusiness(text(result.Message, 'Upstream rejected the request')));
  }

  return right({
    success: true,
    requestId: String(result.RequestId ?? ''),
    timeStamp: String(result.TimeStamp ?? new Date().toISOString()),
    message: text(result.Message),
    total: results.length,
    results,
  });
};
