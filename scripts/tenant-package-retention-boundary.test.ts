import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readBoundedJson } from '@platform/factory';

import {
  runTenantPackageRetention, TENANT_PACKAGE_CLAIM_RESPONSE_BYTES,
  type RetentionOperations,
} from './tenant-package-retention';

const TARGET = '00000000-0000-0000-0000-000000000000';
const CLAIM = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const LEGACY = `${TARGET}/${'a'.repeat(64)}`;
const MODERN = `${LEGACY}/${'b'.repeat(64)}`;

function row(objectPath: string | null) {
  return {
    object_path: objectPath,
    target_id: TARGET,
    claim_id: CLAIM,
    reason: 'retention_expired' as const,
  };
}

function operations(claim: unknown): RetentionOperations & { confirmed: boolean } {
  let unclaimed = true;
  return {
    confirmed: false,
    async claim() {
      if (!unclaimed) return [];
      unclaimed = false;
      return claim;
    },
    async confirm() { this.confirmed = true; return true; },
    async renew() { return new Date(Date.now() + 10 * 60_000).toISOString(); },
    async remove() {},
  };
}

describe('tenant package retention boundaries', () => {
  it('rejects mixed legacy and modern namespaces before storage deletion', async () => {
    let removals = 0;
    const fixture = operations([
      row(`${LEGACY}/archive.zip`), row(`${MODERN}/archive.zip`),
    ]);
    fixture.remove = async () => { removals += 1; };
    await assert.rejects(runTenantPackageRetention(fixture), { code: 'cleanup_invalid' });
    assert.equal(removals, 0);
  });

  it('rejects mixed null and object rows and oversized claim batches', async () => {
    await assert.rejects(
      runTenantPackageRetention(operations([row(null), row(`${LEGACY}/archive.zip`)])),
      { code: 'cleanup_invalid' },
    );
    await assert.rejects(
      runTenantPackageRetention(operations(Array.from({ length: 501 }, () => row(null)))),
      { code: 'cleanup_invalid' },
    );
  });

  it('aborts deletion and never confirms after heartbeat ownership loss', async () => {
    let renewals = 0;
    let aborted = false;
    const fixture = operations([row(`${MODERN}/files/brand.json`)]);
    fixture.renew = async () => {
      renewals += 1;
      if (renewals > 1) throw new Error('raw database detail');
      return new Date(Date.now() + 10 * 60_000).toISOString();
    };
    fixture.remove = async (_paths, signal) => new Promise<void>((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, { once: true });
      setTimeout(resolve, 50);
    });
    await assert.rejects(
      runTenantPackageRetention(fixture, { heartbeatMs: 2 }),
      { code: 'cleanup_renewal_failed' },
    );
    assert.equal(aborted, true);
    assert.equal(fixture.confirmed, false);
  });

  it('rejects expired renewal timestamps before deleting', async () => {
    let removals = 0;
    const fixture = operations([row(`${MODERN}/archive.zip`)]);
    fixture.renew = async () => '2000-01-01T00:00:00.000Z';
    fixture.remove = async () => { removals += 1; };
    await assert.rejects(runTenantPackageRetention(fixture), {
      code: 'cleanup_renewal_invalid',
    });
    assert.equal(removals, 0);
    assert.equal(fixture.confirmed, false);
  });

  it('accepts a bounded 500-row response with max-byte quote-heavy paths', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => row(
      `${MODERN}/files/${String(index).padStart(3, '0')}${'"'.repeat(1324)}`,
    ));
    const encoded = JSON.stringify(rows);
    assert.ok(Buffer.byteLength(encoded) > 1024 * 1024);
    assert.ok(Buffer.byteLength(encoded) < TENANT_PACKAGE_CLAIM_RESPONSE_BYTES);
    const decoded = await readBoundedJson(
      new Response(encoded),
      TENANT_PACKAGE_CLAIM_RESPONSE_BYTES,
    );
    let removed = 0;
    const fixture = operations(decoded);
    fixture.remove = async (paths) => { removed = paths.length; };
    assert.equal((await runTenantPackageRetention(fixture)).confirmedClaims, 1);
    assert.equal(removed, 500);
  });
});
