import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRight } from '../fp/result.js';
import {
  parseAssignSerialsResponse,
  parseInvoiceListResponse,
  parsePostInvoicesResponse,
  parseSearchResponse,
  parseTaxpayerResponse,
} from './parse.js';
import { FIXTURES } from '../test/helpers.js';

describe('SOAP response parsers', () => {
  it('parses search with serial + seria aliases', () => {
    const r = parseSearchResponse(FIXTURES.searchOk);
    assert.ok(isRight(r));
    assert.equal(r.right.total, 1);
    assert.equal(r.right.results[0]!.serial, 'EAA');
    assert.equal(r.right.results[0]!.seria, 'EAA');
  });

  it('reads nil elements as empty text', () => {
    const xml = FIXTURES.searchOk.replace(
      '<a:Message></a:Message>\n            <a:TimeStamp>',
      '<a:Message i:nil="true"/>\n            <a:TimeStamp>',
    );
    assert.notEqual(xml, FIXTURES.searchOk);
    const r = parseSearchResponse(xml);
    assert.ok(isRight(r));
    assert.equal(r.right.results[0]!.message, '');
  });

  it('parses assign serials', () => {
    const r = parseAssignSerialsResponse(FIXTURES.assignOk);
    assert.ok(isRight(r));
    assert.equal(r.right.results[0]!.number, 'SN002');
  });

  it('parses post success', () => {
    const r = parsePostInvoicesResponse(FIXTURES.postOk, false);
    assert.ok(isRight(r));
    assert.equal(r.right.success, true);
    assert.equal(r.right.results[0]!.total_invoices_posted, 1);
  });

  it('parses taxpayer present in registry', () => {
    const r = parseTaxpayerResponse(FIXTURES.taxpayerOk, 'req');
    assert.ok(isRight(r));
    assert.equal(r.right.success, true);
    assert.equal(r.right.data?.idno, '1015600027437');
  });

  it('parses accepted / rejected lists', () => {
    const a = parseInvoiceListResponse(FIXTURES.acceptedOk, 'GetAcceptedInvoicesResult');
    assert.ok(isRight(a));
    assert.equal(a.right.total, 0);

    const rej = parseInvoiceListResponse(FIXTURES.rejectedOk, 'GetRejectedInvoicesResult');
    assert.ok(isRight(rej));
    assert.equal(rej.right.results[0]!.seria, 'EAY');
  });
});
