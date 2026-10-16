import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from './redact.js';

describe('redact', () => {
  const cases: Array<[string, string, string]> = [
    ['email', 'contact ion.popescu@firma.md today', 'contact [email] today'],
    ['IDNO', 'buyer 1003600012345 missing', 'buyer [idno] missing'],
    ['IBAN', 'pay to MD24AG000225100013104168', 'pay to [iban]'],
    ['international phone', 'call +373 69 123 456', 'call [phone]'],
    ['local phone', 'call 069 123 456', 'call [phone]'],
    ['invoice seria and number', 'invoice EAA1234567 and EBC 432735', 'invoice [invoice] and [invoice]'],
    ['password value', 'password: hunter2 failed', 'password: [redacted] failed'],
    ['password before punctuation', 'parola=T0p!s3cret. Then', 'parola=[redacted]. Then'],
    ['bearer token', 'Authorization Bearer abc.def', 'Authorization Bearer [redacted]'],
    ['long digit run', 'order 12345678', 'order [number]'],
    ['opaque token', `key ${'a1'.repeat(20)}`, 'key [token]'],
  ];

  for (const [name, input, expected] of cases) {
    it(`masks ${name}`, () => assert.equal(redact(input), expected));
  }

  it('keeps ordinary text, codes and small numbers', () => {
    const text = 'efactura_search_invoices with status 8 returned UPSTREAM_TIMEOUT after 20 s on page 2';
    assert.equal(redact(text), text);
  });
});
