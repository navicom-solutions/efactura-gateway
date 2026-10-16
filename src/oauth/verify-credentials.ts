import { randomUUID } from 'node:crypto';
import type { AppError } from '../domain/errors.js';
import { isLeft } from '../fp/result.js';
import type { SoapClient } from '../soap/client.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import { escapeXml } from '../soap/envelope.js';
import { parseInvoiceListResponse } from '../soap/parse.js';

export type CredentialCheck = 'valid' | 'rejected' | 'unavailable';

export type CredentialVerifier = (creds: ProviderCredentials) => Promise<CredentialCheck>;

/** SFS answers invalid WS-Security credentials with its generic HTML 500 page, not a SOAP fault. */
const isCredentialRejection = (err: AppError): boolean =>
  err.kind === 'upstream_http' && /error page|<!DOCTYPE html|<html[\s>]/i.test(err.message);

/**
 * Checks credentials with a read-only SFS call. Pass a client without read retries so a
 * wrong password is reported in one round trip.
 */
export const createCredentialVerifier =
  (soap: SoapClient): CredentialVerifier =>
  async (creds) => {
    const requestId = randomUUID();
    const body = `<tns:GetAcceptedInvoices><tns:request><ax:RequestId>${escapeXml(requestId)}</ax:RequestId><ax:ActorRole>1</ax:ActorRole></tns:request></tns:GetAcceptedInvoices>`;
    const xmlE = await soap.call({ operation: 'getAcceptedInvoices', requestId, isWrite: false }, creds, body);
    if (isLeft(xmlE)) return isCredentialRejection(xmlE.left) ? 'rejected' : 'unavailable';

    const parsed = parseInvoiceListResponse(xmlE.right, 'GetAcceptedInvoicesResult');
    if (isLeft(parsed)) return parsed.left.kind === 'upstream_business' ? 'valid' : 'unavailable';
    return 'valid';
  };
