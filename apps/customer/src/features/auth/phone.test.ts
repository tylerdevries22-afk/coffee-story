import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isValidOtpCode, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('formats a ten-digit US number to E.164', () => {
    assert.equal(normalizePhone('(720) 609-2971'), '+17206092971');
    assert.equal(normalizePhone('720.609.2971'), '+17206092971');
  });

  it('keeps an explicit country code', () => {
    assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
    assert.equal(normalizePhone('17206092971'), '+17206092971');
  });

  it('rejects lengths that cannot be a number', () => {
    assert.equal(normalizePhone('12345'), null);
    assert.equal(normalizePhone('+12'), null);
    assert.equal(normalizePhone(''), null);
  });
});

describe('isValidOtpCode', () => {
  it('accepts exactly six digits', () => {
    assert.equal(isValidOtpCode('123456'), true);
    assert.equal(isValidOtpCode(' 123456 '), true);
    assert.equal(isValidOtpCode('12345'), false);
    assert.equal(isValidOtpCode('12345a'), false);
  });
});
