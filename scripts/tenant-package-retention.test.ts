import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runTenantPackageRetention, serializeRetentionFailure, serializeRetentionResult,
  type RetentionOperations,
} from './tenant-package-retention';

const RELEASE = '018f0f10-0000-7000-8000-000000000001';
const CLAIM = '018f0f10-0000-7000-8000-000000000002';
const PREFIX = `${RELEASE}/${'a'.repeat(64)}/${'b'.repeat(64)}`;

function row(
  path: string | null,
  claimId = CLAIM,
  reason: 'cleanup_blocked' | 'retention_expired' | 'stale_verified' | 'upload_expired'
    = 'retention_expired',
) {
  return {
    object_path: path, target_id: RELEASE, claim_id: claimId, reason,
  };
}

function operations(claims: unknown[]): {
  calls: { claims: number[]; confirmations: string[]; removals: readonly string[][] };
  value: RetentionOperations;
} {
  const calls = { claims: [] as number[], confirmations: [] as string[], removals: [] as string[][] };
  return {
    calls,
    value: {
      async claim(limit) {
        calls.claims.push(limit);
        return claims.shift() ?? [];
      },
      async confirm(claimId) {
        calls.confirmations.push(claimId);
        return true;
      },
      async remove(paths) {
        calls.removals.push([...paths]);
      },
    },
  };
}

describe('runTenantPackageRetention', () => {
  it('deletes one claimed batch, confirms it, and reports stable totals', async () => {
    const first = `${PREFIX}/archive.zip`;
    const second = `${PREFIX}/files/menu/photo.webp`;
    const fixture = operations([[row(first), row(second)], []]);
    const result = await runTenantPackageRetention(fixture.value);
    assert.deepEqual(result, {
      batches: 1, blockedClaims: 0, capped: false,
      confirmedClaims: 1, removedObjects: 2, requeuedClaims: 0,
    });
    assert.deepEqual(fixture.calls, {
      claims: [500, 500], confirmations: [CLAIM], removals: [[first, second]],
    });
  });

  it('confirms an empty release claim without calling storage', async () => {
    const fixture = operations([[row(null)], []]);
    const result = await runTenantPackageRetention(fixture.value);
    assert.equal(result.confirmedClaims, 1);
    assert.equal(result.removedObjects, 0);
    assert.deepEqual(fixture.calls.removals, []);
  });

  it('stops at the configured bound and marks the output capped', async () => {
    const fixture = operations([[row(null)], [row(null)], [row(null)]]);
    const result = await runTenantPackageRetention(fixture.value, { maxBatches: 2 });
    assert.deepEqual(result, {
      batches: 2, blockedClaims: 0, capped: true,
      confirmedClaims: 2, removedObjects: 0, requeuedClaims: 0,
    });
    assert.deepEqual(fixture.calls.claims, [500, 500]);
  });

  it('counts a partially purged claim as requeued', async () => {
    const fixture = operations([[row(`${PREFIX}/archive.zip`)], []]);
    fixture.value.confirm = async () => false;
    const result = await runTenantPackageRetention(fixture.value);
    assert.equal(result.confirmedClaims, 0);
    assert.equal(result.requeuedClaims, 1);
  });

  it('drains a namespace larger than one 500-object database batch', async () => {
    const batches = [500, 500, 201].map((size, batch) => Array.from(
      { length: size },
      (_, index) => row(`${PREFIX}/files/${batch}-${index}`),
    ));
    const fixture = operations([...batches, []]);
    let confirmations = 0;
    fixture.value.confirm = async (claimId) => {
      fixture.calls.confirmations.push(claimId);
      confirmations += 1;
      return confirmations === 3;
    };
    const result = await runTenantPackageRetention(fixture.value);
    assert.deepEqual(result, {
      batches: 3, blockedClaims: 0, capped: false, confirmedClaims: 1,
      removedObjects: 1201, requeuedClaims: 2,
    });
  });

  it('accepts expired upload and stale verified cleanup reasons', async () => {
    for (const reason of ['upload_expired', 'stale_verified'] as const) {
      const fixture = operations([[row(null, CLAIM, reason)], []]);
      assert.equal((await runTenantPackageRetention(fixture.value)).confirmedClaims, 1);
    }
  });

  it('accepts canonical legacy release object paths', async () => {
    const prefix = `00000000-0000-0000-0000-000000000000/${'a'.repeat(64)}`;
    const legacy = [`${prefix}/archive.zip`, `${prefix}/files/brand.json`,
      `${prefix}/previews/brand.json.png`];
    const fixture = operations([[...legacy.map((path) => row(path))], []]);
    assert.equal((await runTenantPackageRetention(fixture.value)).removedObjects, 3);
    assert.deepEqual(fixture.calls.removals, [legacy]);
  });

  it('records a blocked namespace and continues to a later claim', async () => {
    const fixture = operations([[
      row(null, CLAIM, 'cleanup_blocked'),
    ], [row(null, '018f0f10-0000-7000-8000-000000000004')], []]);
    let confirmations = 0;
    fixture.value.confirm = async () => {
      confirmations += 1;
      return confirmations > 1;
    };
    const result = await runTenantPackageRetention(fixture.value);
    assert.equal(result.blockedClaims, 1);
    assert.equal(result.confirmedClaims, 1);
    assert.equal(result.requeuedClaims, 0);
  });

  it('does not confirm after storage deletion fails', async () => {
    const fixture = operations([[row(`${PREFIX}/archive.zip`)]]);
    fixture.value.remove = async () => { throw new Error('storage unavailable'); };
    await assert.rejects(() => runTenantPackageRetention(fixture.value), /storage unavailable/);
    assert.deepEqual(fixture.calls.confirmations, []);
  });

  it('rejects malformed or mixed claims before deleting objects', async () => {
    const mixed = '018f0f10-0000-7000-8000-000000000003';
    const fixture = operations([[
      row(`${PREFIX}/archive.zip`), row(`${PREFIX}/files/a`, mixed),
    ]]);
    await assert.rejects(() => runTenantPackageRetention(fixture.value), {
      code: 'cleanup_invalid',
    });
    assert.deepEqual(fixture.calls.removals, []);
  });

  it('rejects unsafe paths, duplicate objects, and invalid bounds', async () => {
    const unsafe = operations([[row(`${PREFIX}/files/../archive.zip`)]]);
    await assert.rejects(() => runTenantPackageRetention(unsafe.value), { code: 'cleanup_invalid' });
    const multibyte = operations([[row(`${PREFIX}/files/${'é'.repeat(700)}`)]]);
    await assert.rejects(() => runTenantPackageRetention(multibyte.value), { code: 'cleanup_invalid' });
    const empty = operations([[row(`${PREFIX}/files/a//b`)]]);
    await assert.rejects(() => runTenantPackageRetention(empty.value), { code: 'cleanup_invalid' });
    const duplicate = `${PREFIX}/archive.zip`;
    await assert.rejects(
      () => runTenantPackageRetention(operations([[row(duplicate), row(duplicate)]]).value),
      { code: 'cleanup_invalid' },
    );
    await assert.rejects(
      () => runTenantPackageRetention(operations([]).value, { maxBatches: 0 }),
      { code: 'cleanup_configuration_invalid' },
    );
  });

  it('serializes machine-readable output and redacts unexpected failures', () => {
    const result = {
      batches: 1, blockedClaims: 0, capped: false,
      confirmedClaims: 1, removedObjects: 2, requeuedClaims: 0,
    };
    assert.equal(serializeRetentionResult(result), `${JSON.stringify(result)}\n`);
    assert.equal(
      serializeRetentionFailure(new Error('database password was exposed')),
      '{"code":"tenant_package_cleanup_failed","message":"Tenant package cleanup failed."}\n',
    );
  });
});
