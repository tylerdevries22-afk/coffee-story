import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mintActzHandoffToken,
  sanitizePartnerUrl,
  verifyActzHandoffToken,
} from './actz-handoff';

describe('sanitizePartnerUrl', () => {
  it('allows http(s) without credentials', () => {
    assert.equal(sanitizePartnerUrl('https://actz.example/app-factory'), 'https://actz.example/app-factory');
    assert.equal(sanitizePartnerUrl('http://localhost:3000/x'), 'http://localhost:3000/x');
  });
  it('rejects javascript and credentialed URLs', () => {
    assert.equal(sanitizePartnerUrl('javascript:alert(1)'), null);
    assert.equal(sanitizePartnerUrl('https://user:pass@evil.test/'), null);
    assert.equal(sanitizePartnerUrl('ftp://files.test/a'), null);
  });
});

describe('actz handoff JWT', () => {
  const secret = 'test-handoff-secret-value';
  const now = Date.parse('2026-09-19T03:00:00.000Z');

  it('round-trips claims', () => {
    const token = mintActzHandoffToken(
      secret,
      {
        actzProviderOrgId: 'org_abc',
        brandId: '11111111-1111-4111-8111-111111111111',
        intent: 'open_dashboard',
      },
      now,
    );
    const verified = verifyActzHandoffToken(secret, token, now + 1_000);
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.claims.actzProviderOrgId, 'org_abc');
      assert.equal(verified.claims.brandId, '11111111-1111-4111-8111-111111111111');
      assert.equal(verified.claims.intent, 'open_dashboard');
    }
  });

  it('rejects expired and forged tokens', () => {
    const token = mintActzHandoffToken(secret, { actzProviderOrgId: 'org_abc' }, now, 60);
    assert.equal(verifyActzHandoffToken(secret, token, now + 120_000).ok, false);
    assert.equal(verifyActzHandoffToken('other-secret', token, now + 1_000).ok, false);
  });

  it('rejects audience tampering', () => {
    const token = mintActzHandoffToken(secret, { actzProviderOrgId: 'org_abc' }, now);
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.aud = 'elevate';
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
    assert.equal(verifyActzHandoffToken(secret, tampered, now + 1_000).ok, false);
  });
});
