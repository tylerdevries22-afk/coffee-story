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
    assert.match(headers.find((row) => row.key === 'Content-Security-Policy')?.value ?? '', /localhost:3300/);
    assert.match(headers.find((row) => row.key === 'Content-Security-Policy')?.value ?? '', /127\.0\.0\.1:3400/);
  });

  it('allows only explicitly trusted parents for an embeddable surface', () => {
    const headers = new Map(securityHeaders({
      developmentFrames: false,
      frameAncestors: ['https://coffee-story-hq.vercel.app', 'not-a-url'],
    }).map((row) => [row.key, row.value]));
    assert.equal(headers.get('X-Frame-Options'), undefined);
    assert.equal(headers.get('Content-Security-Policy'), 'frame-ancestors https://coffee-story-hq.vercel.app');
  });

  it('supports a same-origin embedded route without adding a frame escape', () => {
    const headers = new Map(securityHeaders({
      developmentFrames: false,
      frameAncestors: ["'self'"],
    }).map((row) => [row.key, row.value]));
    assert.equal(headers.get('Content-Security-Policy'), "frame-ancestors 'self'");
    assert.equal(headers.get('X-Frame-Options'), undefined);
  });
});
