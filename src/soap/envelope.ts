import type { ProviderCredentials } from './credentials.js';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const SOAP_ACTIONS = {
  search: 'http://tempuri.org/IService/SearchInvoices',
  getBySeriaNumber: 'http://tempuri.org/IService/GetInvoicesBySeriaNumber',
  getSeriaAndNumbers: 'http://tempuri.org/IService/GetSeriaAndNumbers',
  postInvoices: 'http://tempuri.org/IService/PostInvoices',
  postInvoicesWithAttachment: 'http://tempuri.org/IService/PostInvoicesWithAttachment',
  getTaxpayersInfo: 'http://tempuri.org/IService/GetTaxpayersInfo',
  getAcceptedInvoices: 'http://tempuri.org/IService/GetAcceptedInvoices',
  getRejectedInvoices: 'http://tempuri.org/IService/GetRejectedInvoices',
} as const;

export type SoapOperation = keyof typeof SOAP_ACTIONS;

export const buildSoapEnvelope = (
  creds: ProviderCredentials,
  body: string,
  now = new Date(),
): string => {
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expires = new Date(now.getTime() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://tempuri.org/"
               xmlns:ax="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
               xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="TS">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken">
        <wsse:Username>${escapeXml(creds.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(creds.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;
};

export { escapeXml };
