import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactInvoiceRow,
  countByStatus,
  pagedResult,
  RESPONSE_BUDGET_CHARS,
  toolError,
} from './shape.js';

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text);
const rows = (n: number, pad = 0) =>
  Array.from({ length: n }, (_, i) => ({ seria: 'EAA', number: String(i), note: 'x'.repeat(pad) }));

describe('pagedResult', () => {
  it('returns the requested page with paging metadata', () => {
    const p = payload(pagedResult(rows(60), { limit: 25, offset: 25 }));
    assert.equal(p.total, 60);
    assert.equal(p.returned, 25);
    assert.equal(p.results[0].number, '25');
    assert.equal(p.has_more, true);
    assert.equal(p.next_offset, 50);
  });

  it('reports the last page', () => {
    const p = payload(pagedResult(rows(60), { limit: 25, offset: 50 }));
    assert.equal(p.returned, 10);
    assert.equal(p.has_more, false);
    assert.equal(p.next_offset, null);
  });

  it('shrinks the page to stay within the response budget', () => {
    const result = pagedResult(rows(100, 1_000), { limit: 100, offset: 0 });
    const p = payload(result);
    assert.ok(result.content[0]!.text.length <= RESPONSE_BUDGET_CHARS);
    assert.ok(p.returned < 100);
    assert.equal(p.next_offset, p.returned);
    assert.match(p.note, /shortened/);
  });
});

describe('compactInvoiceRow', () => {
  it('labels the status and drops transport noise', () => {
    const row = compactInvoiceRow({
      seria: 'EAA',
      number: '1',
      status: 2,
      invoiceStatus: 8,
      message: '',
      timeStamp: '0001-01-01T00:00:00',
    });
    assert.deepEqual(row, { seria: 'EAA', number: '1', status: 8, status_label: 'signed by buyer' });
  });

  it('counts rows by status label', () => {
    const labelled = [8, 8, 2].map((s) => compactInvoiceRow({ seria: 'E', number: '1', invoiceStatus: s }));
    assert.deepEqual(countByStatus(labelled), { 'signed by buyer': 2, 'rejected by buyer': 1 });
  });
});

describe('toolError', () => {
  it('tells the model not to re-post after an ambiguous write', () => {
    const result = toolError({ code: 'WRITE_AMBIGUOUS', message: 'timeout', retrySafe: false });
    const p = payload(result);
    assert.equal(result.isError, true);
    assert.equal(p.retry_safe, false);
    assert.match(p.hint, /Do not post again/);
  });

  it('tells the model to reconnect OAuth on PROVIDER_UNAUTHORIZED', () => {
    const result = toolError({
      code: 'PROVIDER_UNAUTHORIZED',
      message: 'SFS rejected the API username/password',
      retrySafe: false,
    });
    const p = payload(result);
    assert.equal(p.retry_safe, false);
    assert.match(p.hint, /reconnect/i);
  });
});
