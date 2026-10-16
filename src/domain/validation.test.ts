import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLeft, isRight } from '../fp/result.js';
import {
  AssignSerialsSchema,
  GetInvoiceSchema,
  parseBody,
  PostInvoiceSchema,
  SearchInvoicesSchema,
} from './types.js';
import { samplePostBody } from '../test/helpers.js';

describe('request validation', () => {
  it('accepts a valid search body', () => {
    const r = parseBody(SearchInvoicesSchema, {
      actor_role: 1,
      status: 8,
      serial: 'EAA',
      number: '001',
    });
    assert.ok(isRight(r));
    assert.equal(r.right.serial, 'EAA');
  });

  it('rejects search without actor_role', () => {
    const r = parseBody(SearchInvoicesSchema, { status: 8 });
    assert.ok(isLeft(r));
    assert.equal(r.left.code, 'VALIDATION_ERROR');
  });

  it('requires number + seria for get', () => {
    assert.ok(isLeft(parseBody(GetInvoiceSchema, { number: '1' })));
    assert.ok(isRight(parseBody(GetInvoiceSchema, { number: '1', seria: 'EAA' })));
  });

  it('requires positive count for assign-serials', () => {
    assert.ok(isLeft(parseBody(AssignSerialsSchema, { count: 0 })));
    assert.ok(isRight(parseBody(AssignSerialsSchema, { count: 2 })));
  });

  it('accepts a valid post body and sanitizes party fields', () => {
    const dirty = structuredClone(samplePostBody);
    dirty.documents[0]!.supplier.title = 'Supplier:SRL*?';
    const r = parseBody(PostInvoiceSchema, dirty);
    assert.ok(isRight(r));
    assert.equal(r.right.documents[0]!.supplier.title, 'SupplierSRL');
  });

  it('rejects post with empty documents', () => {
    const r = parseBody(PostInvoiceSchema, {
      actor_role: 1,
      invoices_xml_status: 0,
      documents: [],
    });
    assert.ok(isLeft(r));
  });
});
