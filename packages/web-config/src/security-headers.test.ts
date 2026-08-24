import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('denies framing and enables transport and content protections in production', () => {
    const headers = new Map(securityHeaders({ developmentFrames: false, noIndex: true }).map((row) => [row.key, row.value]));
    assert.equal(headers.get('X-Frame-Options'), 'DENY');
    assert.equal(headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
    assert.match(headers.get('Strict-Transport-Security') ?? '', /31536000/);
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('X-Robots-Tag'), 'noindex, nofollow');
  });

  it('permits only the local preview wall during development', () => {
    const headers = securityHeaders({ developmentFrames: true });
    assert.equal(headers.some((row) => row.key === 'X-Frame-Options'), false);
    assert.match(headers.find((row) => row.key === 'Content-Security-Policy')?.value ?? '', /localhost/);
  });
});
