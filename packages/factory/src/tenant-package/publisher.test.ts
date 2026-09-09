import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { publishTenantPackageObjects, tenantPackageObjectPrefix } from './publisher';
import type { TenantPackageBuild } from './types';

const originalFetch = globalThis.fetch;
const roots: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function build(): TenantPackageBuild {
  const root = mkdtempSync(join(tmpdir(), 'tenant-publisher-'));
  roots.push(root);
  const source = Buffer.from('{"name":"Coffee"}');
  const archive = Buffer.from('archive');
  const sourcePath = join(root, 'brand.json');
  const archivePath = join(root, 'archive.zip');
  writeFileSync(sourcePath, source);
  writeFileSync(archivePath, archive);
  return {
    tenantSlug: 'coffee', releaseKey: 'release-2026.09.08', commitSha: 'a'.repeat(40),
    artifactDigest: `sha256:${'b'.repeat(64)}`, envelopeSha256: `sha256:${'c'.repeat(64)}`,
    archiveSha256: digest(archive), archivePath, fileCount: 1, totalBytes: source.length,
    files: [{
      sourcePath, relativePath: 'brand.json', pathKey: 'brand.json',
      contentSha256: digest(source), crc32: 1, mimeType: 'application/json',
      byteSize: source.length, previewKind: 'text',
    }],
  };
}

describe('tenantPackageObjectPrefix', () => {
  it('binds immutable storage paths to both artifact and release envelope', () => {
    const brand = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const artifact = `sha256:${'b'.repeat(64)}`;
    const envelope = `sha256:${'c'.repeat(64)}`;
    assert.equal(
      tenantPackageObjectPrefix(brand, artifact, envelope),
      `${brand}/${'b'.repeat(64)}/${'c'.repeat(64)}`,
    );
  });

  it('rejects malformed identity values before constructing an object path', () => {
    assert.throws(
      () => tenantPackageObjectPrefix('bad', `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`),
      /identity is invalid/,
    );
    assert.throws(
      () => tenantPackageObjectPrefix('-'.repeat(36), `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`),
      /identity is invalid/,
    );
  });

  it('begins and renews a bound session before object mutations, then stages it', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const uploadSession = '018f0f10-0000-7000-8000-000000000001';
    const release = '018f0f10-0000-7000-8000-000000000002';
    const fixture = build();
    const source = Buffer.from('{"name":"Coffee"}');
    const archive = Buffer.from('archive');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/rpc/begin_tenant_package_upload')) {
        return Response.json(uploadSession);
      }
      if (url.endsWith('/rpc/renew_tenant_package_upload')) {
        return Response.json('2026-09-08T00:15:00Z');
      }
      if (url.endsWith('/rpc/stage_tenant_package')) return Response.json(release);
      if (method === 'POST') return Response.json({}, { status: 200 });
      return new Response(url.endsWith('/archive.zip') ? archive : source);
    };
    const result = await publishTenantPackageObjects({
      endpoint: 'https://demo.supabase.co', serviceKey: 'secret',
      brandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', build: fixture,
    });
    assert.equal(result.releaseId, release);
    assert.match(calls[0]?.url ?? '', /begin_tenant_package_upload$/);
    const mutations = calls.flatMap((call, index) => call.method === 'POST'
      && call.url.includes('/storage/v1/object/') ? [index] : []);
    assert.equal(mutations.length, 2);
    for (const index of mutations) {
      assert.match(calls[index - 1]?.url ?? '', /renew_tenant_package_upload$/);
    }
    const stage = calls.find((call) => call.url.endsWith('/rpc/stage_tenant_package'));
    assert.equal(JSON.parse(stage?.body ?? '{}').p_upload_session_id, uploadSession);
  });

  it('does not upload when begin returns an invalid session identity', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json('invalid');
    };
    await assert.rejects(() => publishTenantPackageObjects({
      endpoint: 'https://demo.supabase.co', serviceKey: 'secret',
      brandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', build: build(),
    }), /invalid tenant upload session/);
    assert.equal(calls, 1);
  });
});
