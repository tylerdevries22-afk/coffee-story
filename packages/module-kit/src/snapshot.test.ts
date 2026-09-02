import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  buildCapabilitySnapshot, canonicalJson, snapshotAuthorizes, snapshotGrants,
  verifyCapabilitySnapshot,
} from './snapshot';
import type { ResolvedModule } from './types';

const KEY = 'test-signing-key';
const sign = (payload: string) => createHmac('sha256', KEY).update(payload).digest('hex');
const verify = (payload: string, signature: string) =>
  createHmac('sha256', KEY).update(payload).digest('hex') === signature;
const wrongKey = (payload: string, signature: string) =>
  createHmac('sha256', 'other-key').update(payload).digest('hex') === signature;

const MODULES: readonly ResolvedModule[] = [
  { key: 'core-tenancy', version: '1.0.0', permissions: ['tenant:read'], configRevision: 1 },
  { key: 'commerce-ordering', version: '1.4.0', permissions: ['orders:write', 'orders:read'], configRevision: 3 },
];

function snapshot(issuedAt = new Date('2026-09-02T00:00:00Z'), ttlSeconds = 300) {
  return buildCapabilitySnapshot({
    tenant: 'brand-1', site: 'loc-1', modules: MODULES,
    configRevision: 7, issuedAt, ttlSeconds, sign,
  });
}

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    assert.equal(
      canonicalJson({ b: { d: 1, c: 2 }, a: [3] }),
      canonicalJson({ a: [3], b: { c: 2, d: 1 } }),
    );
  });

  it('keeps array order and drops undefined', () => {
    assert.equal(canonicalJson([2, 1]), '[2,1]');
    assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  });
});

describe('buildCapabilitySnapshot', () => {
  it('unions and sorts permissions across modules', () => {
    const built = snapshot();
    assert.deepEqual(built.permissions, ['orders:read', 'orders:write', 'tenant:read']);
  });

  it('signs deterministically: same input, same signature', () => {
    assert.equal(snapshot().signature, snapshot().signature);
  });

  it('computes expiry from issuance plus ttl', () => {
    assert.equal(snapshot().expiresAt, '2026-09-02T00:05:00.000Z');
  });
});

describe('verifyCapabilitySnapshot', () => {
  const now = new Date('2026-09-02T00:01:00Z');

  it('accepts a fresh, correctly signed snapshot', () => {
    assert.equal(verifyCapabilitySnapshot(snapshot(), verify, now).kind, 'valid');
  });

  it('rejects a wrong-key signature', () => {
    assert.equal(verifyCapabilitySnapshot(snapshot(), wrongKey, now).kind, 'bad-signature');
  });

  it('rejects a tampered payload even with the original signature', () => {
    const tampered = { ...snapshot(), tenant: 'brand-2' };
    assert.equal(verifyCapabilitySnapshot(tampered, verify, now).kind, 'bad-signature');
  });

  it('distinguishes expiry from forgery', () => {
    const later = new Date('2026-09-02T00:06:00Z');
    const result = verifyCapabilitySnapshot(snapshot(), verify, later);
    assert.equal(result.kind, 'expired');
    if (result.kind === 'expired') assert.equal(result.expiredAt, '2026-09-02T00:05:00.000Z');
  });
});

describe('authorization', () => {
  const now = new Date('2026-09-02T00:01:00Z');
  const later = new Date('2026-09-02T00:06:00Z');

  it('grants listed permissions only', () => {
    const built = snapshot();
    assert.equal(snapshotGrants(built, 'orders:write'), true);
    assert.equal(snapshotGrants(built, 'fees:write'), false);
  });

  it('fails closed on expiry and forgery, open on valid', () => {
    const built = snapshot();
    assert.equal(snapshotAuthorizes(built, verifyCapabilitySnapshot(built, verify, now), 'orders:write'), true);
    assert.equal(snapshotAuthorizes(built, verifyCapabilitySnapshot(built, verify, later), 'orders:write'), false);
    assert.equal(snapshotAuthorizes(built, verifyCapabilitySnapshot(built, wrongKey, now), 'orders:write'), false);
  });
});
