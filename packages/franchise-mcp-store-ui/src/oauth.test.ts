import { describe, expect, it } from 'vitest';

import {
  createMcpOAuthMaterial,
  mcpCookieBindingMatches,
  verifyMcpOAuthState,
} from './oauth';

const SECRET = 'a-production-strength-state-secret-with-entropy';

describe('shared OAuth boundary', () => {
  it('round-trips signed, expiring, provider-bound state', () => {
    const material = createMcpOAuthMaterial('slack', SECRET, 1_000_000);
    expect(verifyMcpOAuthState(material.state, 'slack', SECRET, 1_001_000)).toMatchObject({
      provider: 'slack', nonce: material.nonce,
    });
    expect(verifyMcpOAuthState(material.state, 'google', SECRET, 1_001_000)).toBeNull();
    expect(verifyMcpOAuthState(material.state, 'slack', SECRET, 1_601_000)).toBeNull();
  });

  it('rejects tampering and binds callbacks to the initiating browser', () => {
    const material = createMcpOAuthMaterial('google-suite', SECRET, 1_000_000);
    expect(verifyMcpOAuthState(`${material.state}x`, 'google-suite', SECRET, 1_001_000)).toBeNull();
    expect(mcpCookieBindingMatches(material.cookieBinding, material.cookieBindingSha256)).toBe(true);
    expect(mcpCookieBindingMatches('different-browser', material.cookieBindingSha256)).toBe(false);
  });

  it('fails closed for weak configuration and invalid provider keys', () => {
    expect(() => createMcpOAuthMaterial('slack', 'weak')).toThrow(/not configured/);
    expect(() => createMcpOAuthMaterial('../slack', SECRET)).toThrow(/provider key/);
  });
});
