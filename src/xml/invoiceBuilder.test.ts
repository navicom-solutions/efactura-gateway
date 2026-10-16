import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoicesXml,
  extractExternalIds,
  hasAttachments,
} from './invoiceBuilder.js';
import { parseBody, PostInvoiceSchema } from '../domain/types.js';
import { isRight } from '../fp/result.js';
import { samplePostBody } from '../test/helpers.js';

const parsedDocs = () => {
  const r = parseBody(PostInvoiceSchema, samplePostBody);
  assert.ok(isRight(r));
  return r.right.documents;
};

describe('invoiceBuilder', () => {
  it('builds Documents XML with supplier, buyer, merchandises', () => {
    const xml = buildInvoicesXml(parsedDocs());
    assert.match(xml, /^<\?xml version="1\.0"\?><Documents>/);
    assert.match(xml, /IDNO="1014600016306"/);
    assert.match(xml, /IDNO="1002600003354"/);
    assert.match(xml, /<Row Code="1"/);
    assert.match(xml, /<CreationMotiv>1<\/CreationMotiv>/);
    assert.match(xml, /<id>crm-inv-1<\/id>/);
  });

  it('extracts external ids for idempotency', () => {
    assert.deepEqual(extractExternalIds(parsedDocs()), ['crm-inv-1']);
  });

  it('detects attachments', () => {
    const docs = parsedDocs();
    assert.equal(hasAttachments(docs), false);
    const withAtt = structuredClone(docs);
    withAtt[0]!.additional_information = {
      id: 'crm-inv-1',
      attachments: [{ name: 'a.pdf', base64encoded: 'QQ==' }],
    };
    assert.equal(hasAttachments(withAtt), true);
  });

  it('adds Non-Livrare redirections for creation_motiv 5', () => {
    const docs = structuredClone(parsedDocs());
    docs[0]!.creation_motiv = 5;
    const xml = buildInvoicesXml(docs);
    assert.match(xml, /<Redirections>Non-Livrare<\/Redirections>/);
  });
});
