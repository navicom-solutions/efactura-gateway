import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Env } from '../config/env.js';
import { left, right, type Either } from '../fp/result.js';
import type { AppError } from '../domain/errors.js';
import type { FeedbackSender } from '../feedback/client.js';
import type { SoapClient, SoapRequestMeta } from '../soap/client.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import { createIdempotencyStore } from '../services/idempotency.js';
import { createOAuthStore } from '../oauth/store.js';
import {
  jobIdFor,
  type InvoiceJobView,
  type InvoiceQueue,
  type PostInvoiceJobInput,
} from '../queue/invoice-jobs.js';
import { buildApp, type AppLog } from '../http/app.js';

export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  PUBLIC_URL: 'https://efactura.example.com',
  BASE_PATH: '/v1',
  HTTP_HOST: '127.0.0.1',
  HTTP_PORT: 3000,
  HOST_PORT: 3000,
  API_KEY: 'test-api-key',
  EFACTURA_ENDPOINT: 'https://efactura-api.sfs.md/Service.svc',
  EFACTURA_USERNAME: 'test-user',
  EFACTURA_PASSWORD: 'test-pass',
  SOAP_TIMEOUT_MS: 5_000,
  SOAP_CONNECT_TIMEOUT_MS: 2_000,
  READ_MAX_RETRIES: 0,
  READ_BACKOFF_BASE_MS: 1,
  READ_BACKOFF_MAX_MS: 1,
  WRITE_TIMEOUT_MS: 5_000,
  DATABASE_PATH: path.join(os.tmpdir(), `efactura-idem-${Date.now()}-${Math.random()}.db`),
  OAUTH_DATABASE_PATH: path.join(os.tmpdir(), `efactura-oauth-${Date.now()}-${Math.random()}.db`),
  REDIS_URL: 'redis://127.0.0.1:6379',
  QUEUE_ENABLED: false,
  MCP_ENABLED: true,
  FEEDBACK_ENABLED: false,
  FEEDBACK_URL: '',
  ENCRYPTION_KEY: 'a'.repeat(64),
  TOKEN_SIGNING_KEY: 'b'.repeat(64),
  ACCESS_TOKEN_TTL_SECONDS: 3600,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  LOG_LEVEL: 'silent',
  LOG_CHANNEL: 'test',
  ...overrides,
});

export const silentLog: AppLog = () => undefined;

export const authHeader = (key = 'test-api-key') => ({
  authorization: `Bearer ${key}`,
});

export type SoapStub = SoapClient & {
  readonly calls: Array<{ meta: SoapRequestMeta; creds: ProviderCredentials; bodyXml: string }>;
  handler: (
    meta: SoapRequestMeta,
    creds: ProviderCredentials,
    bodyXml: string,
  ) => Promise<Either<AppError, string>>;
};

export const createSoapStub = (
  defaultXml: string | ((meta: SoapRequestMeta) => string),
): SoapStub => {
  const calls: SoapStub['calls'] = [];
  const stub: SoapStub = {
    calls,
    handler: async (meta) => {
      const xml = typeof defaultXml === 'function' ? defaultXml(meta) : defaultXml;
      return right(xml);
    },
    call: async (meta, creds, bodyXml) => {
      calls.push({ meta, creds, bodyXml });
      return stub.handler(meta, creds, bodyXml);
    },
  };
  return stub;
};

const closeQuietly = (close: () => void) => {
  try {
    close();
  } catch {
    /* already closed */
  }
};

const removeSqliteFiles = (dbPath: string) => {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
};

export const tmpIdemStore = (env: Env = testEnv()) => {
  const store = createIdempotencyStore(env.DATABASE_PATH);
  return {
    store,
    env,
    cleanup: () => {
      closeQuietly(store.close);
      removeSqliteFiles(env.DATABASE_PATH);
    },
  };
};

export const buildTestApp = (opts?: {
  env?: Env;
  soap?: SoapStub;
  queue?: InvoiceQueue | null;
  feedback?: FeedbackSender | null;
}) => {
  const env = opts?.env ?? testEnv();
  const idem = tmpIdemStore(env);
  const oauthStore = createOAuthStore(env.OAUTH_DATABASE_PATH);
  const soap: SoapStub = opts?.soap ?? createSoapStub('<ok/>');
  const { app, services } = buildApp({
    env,
    log: silentLog,
    soap,
    idempotencyStore: idem.store,
    oauthStore,
    queue: opts?.queue ?? null,
    feedback: opts?.feedback ?? null,
  });
  return {
    app,
    services,
    env,
    soap,
    store: idem.store,
    oauthStore,
    cleanup: () => {
      idem.cleanup();
      closeQuietly(oauthStore.close);
      removeSqliteFiles(env.OAUTH_DATABASE_PATH);
    },
  };
};

/** In-memory queue double; records enqueued jobs without Redis. */
export const createFakeQueue = () => {
  const jobs = new Map<string, InvoiceJobView>();
  const enqueued: PostInvoiceJobInput[] = [];
  const queue: InvoiceQueue = {
    enqueue: async (input) => {
      const jobId = jobIdFor(input.idempotencyKey);
      const reused = jobs.has(jobId);
      if (!reused) {
        enqueued.push(input);
        jobs.set(jobId, { id: jobId, state: 'waiting' });
      }
      return { jobId, reused };
    },
    get: async (jobId) => jobs.get(jobId) ?? null,
    close: async () => undefined,
  };
  return { queue, jobs, enqueued };
};

/** Minimal successful SOAP envelopes used by parsers */
export const FIXTURES = {
  searchOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <SearchInvoicesResponse xmlns="http://tempuri.org/">
      <SearchInvoicesResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <a:RequestId>req-search</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Message></a:Message>
        <a:Results>
          <a:Invoice>
            <a:Number>001</a:Number>
            <a:Seria>EAA</a:Seria>
            <a:Status>2</a:Status>
            <a:InvoiceStatus>8</a:InvoiceStatus>
            <a:Message></a:Message>
            <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
          </a:Invoice>
        </a:Results>
      </SearchInvoicesResult>
    </SearchInvoicesResponse>
  </s:Body>
</s:Envelope>`,

  getOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetInvoicesBySeriaNumberResponse xmlns="http://tempuri.org/">
      <GetInvoicesBySeriaNumberResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-get</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Message></a:Message>
        <a:Results>
          <a:XmlInvoice>
            <a:Seria>EAA</a:Seria>
            <a:Number>001</a:Number>
            <a:Status>2</a:Status>
            <a:InvoiceStatus>8</a:InvoiceStatus>
            <a:Message></a:Message>
            <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
            <a:Xml><![CDATA[<Document><SupplierInfo><DeliveryDate>2025-01-01</DeliveryDate><Supplier IDNO="1" Title="S" Address="A"><BankAccount BranchTitle="B" BranchCode="C" Account="MD00"/></Supplier><Buyer IDNO="2" Title="Bu" Address="BA"><BankAccount BranchTitle="BB" BranchCode="BC" Account="MD01"/></Buyer><Merchandises><Row Code="1" Name="Item" UnitOfMeasure="buc" Quantity="1" UnitPriceWithoutTVA="100" TotalPriceWithoutTVA="100" TVA="20" TotalTVA="20" TotalPrice="120"/></Merchandises><CreationMotiv>1</CreationMotiv></SupplierInfo></Document>]]></a:Xml>
          </a:XmlInvoice>
        </a:Results>
      </GetInvoicesBySeriaNumberResult>
    </GetInvoicesBySeriaNumberResponse>
  </s:Body>
</s:Envelope>`,

  assignOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetSeriaAndNumbersResponse xmlns="http://tempuri.org/">
      <GetSeriaAndNumbersResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-assign</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Results>
          <a:SeriaAndNumber>
            <a:Number>SN002</a:Number>
            <a:Seria>EAA</a:Seria>
            <a:Status>2</a:Status>
          </a:SeriaAndNumber>
        </a:Results>
      </GetSeriaAndNumbersResult>
    </GetSeriaAndNumbersResponse>
  </s:Body>
</s:Envelope>`,

  postOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <PostInvoicesResponse xmlns="http://tempuri.org/">
      <PostInvoicesResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-post</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:ErrorMessage></a:ErrorMessage>
        <a:TotalInvoices>1</a:TotalInvoices>
        <a:TotalInvoicesPosted>1</a:TotalInvoicesPosted>
      </PostInvoicesResult>
    </PostInvoicesResponse>
  </s:Body>
</s:Envelope>`,

  taxpayerOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetTaxpayersInfoResponse xmlns="http://tempuri.org/">
      <GetTaxpayersInfoResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-tp</a:RequestId>
        <a:Status>1</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Message></a:Message>
        <a:Results>
          <a:Taxpayer>
            <a:Address>Chisinau</a:Address>
            <a:CodTVA></a:CodTVA>
            <a:ExistInTaxRegistry>true</a:ExistInTaxRegistry>
            <a:IDNO>1015600027437</a:IDNO>
            <a:IsEFacturaActor>true</a:IsEFacturaActor>
            <a:Name>NAVICOM</a:Name>
            <a:TaxpayerType>1</a:TaxpayerType>
          </a:Taxpayer>
        </a:Results>
      </GetTaxpayersInfoResult>
    </GetTaxpayersInfoResponse>
  </s:Body>
</s:Envelope>`,

  acceptedOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetAcceptedInvoicesResponse xmlns="http://tempuri.org/">
      <GetAcceptedInvoicesResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-acc</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Message></a:Message>
        <a:Results/>
      </GetAcceptedInvoicesResult>
    </GetAcceptedInvoicesResponse>
  </s:Body>
</s:Envelope>`,

  rejectedOk: `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetRejectedInvoicesResponse xmlns="http://tempuri.org/">
      <GetRejectedInvoicesResult xmlns:a="http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel">
        <a:RequestId>req-rej</a:RequestId>
        <a:Status>2</a:Status>
        <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
        <a:Message></a:Message>
        <a:Results>
          <a:Invoice>
            <a:Number>9</a:Number>
            <a:Seria>EAY</a:Seria>
            <a:Status>2</a:Status>
            <a:InvoiceStatus>2</a:InvoiceStatus>
            <a:Message></a:Message>
            <a:TimeStamp>2025-01-01T00:00:00Z</a:TimeStamp>
          </a:Invoice>
        </a:Results>
      </GetRejectedInvoicesResult>
    </GetRejectedInvoicesResponse>
  </s:Body>
</s:Envelope>`,
};

export const samplePostBody = {
  actor_role: 1,
  invoices_xml_status: 0,
  documents: [
    {
      delivery_date: '2024-06-17T10:00:00Z',
      creation_motiv: 1,
      notes: 'test',
      additional_information: { id: 'crm-inv-1', attachments: [] },
      supplier: {
        idno: '1014600016306',
        title: 'Supplier SRL',
        address: 'Chisinau',
        taxpayer_type: 1,
        vat_number: '0404894',
        bank_account: {
          branch_title: 'Bank',
          branch_code: 'AGRNMD2X',
          account: 'MD92AG000000022512298246',
        },
      },
      buyer: {
        idno: '1002600003354',
        title: 'Buyer SRL',
        address: 'Chisinau',
        taxpayer_type: 1,
        vat_number: '20023345',
        bank_account: {
          branch_title: 'Bank2',
          branch_code: 'MOLDMD2X',
          account: 'MD23ML000000000225103643',
        },
      },
      merchandises: [
        {
          code: '1',
          name: 'Servicii',
          unit_of_measure: 'serv.',
          quantity: 1,
          unit_price_without_tva: 100,
          total_price_without_tva: 100,
          tva: 20,
          total_tva: 20,
          total_price: 120,
        },
      ],
    },
  ],
};

export { left, right };
