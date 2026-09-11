import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { publishTenantPackageObjects } from './publisher';
import type { TenantPackageBuild } from './types';

const originalFetch = globalThis.fetch;
const roots: string[] = [];
const SESSION = '00000000-0000-0000-0000-000000000001';

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function build(): TenantPackageBuild {
  const root = mkdtempSync(join(tmpdir(), 'tenant-publisher-failure-'));
  roots.push(root);
  const source = Buffer.from('{}');
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

function publish() {
  return publishTenantPackageObjects({
    endpoint: 'https://demo.supabase.co', serviceKey: 'secret',
    brandId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', build: build(),
  });
}

describe('tenant package publication failure boundaries', () => {
  it('maps malformed and oversized RPC JSON to a typed bounded error', async () => {
    globalThis.fetch = async () => new Response('{');
    await assert.rejects(publish(), { code: 'remote_response_invalid' });

    let cancellations = 0;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
      cancel() { cancellations += 1; },
    }));
    await assert.rejects(publish(), { code: 'remote_response_invalid' });
    assert.equal(cancellations, 1);
  });

  it('does not stage after an upload lease renewal becomes invalid', async () => {
    let renewals = 0;
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/rpc/begin_tenant_package_upload')) return Response.json(SESSION);
      if (url.endsWith('/rpc/renew_tenant_package_upload')) {
        renewals += 1;
        return Response.json(renewals === 1 ? '2099-01-01T00:00:00Z' : { invalid: true });
      }
      if (init?.method === 'POST') return Response.json({});
      throw new Error('verification must not start after renewal failure');
    };
    await assert.rejects(publish(), { code: 'upload_renewal_invalid' });
    assert.equal(calls.some((url) => url.endsWith('/rpc/stage_tenant_package')), false);
  });

  it('rejects an unsafe generated object path before any remote request', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json(SESSION); };
    const fixture = build();
    const invalid = {
      ...fixture,
      files: fixture.files.map((file) => ({ ...file, pathKey: 'brand//json' })),
    };
    await assert.rejects(publishTenantPackageObjects({
      endpoint: 'https://demo.supabase.co', serviceKey: 'secret',
      brandId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', build: invalid,
    }), { code: 'object_path_invalid' });
    assert.equal(calls, 0);
  });

  it('maps an invalid stage identity to a typed release error', async () => {
    const source = Buffer.from('{}');
    const archive = Buffer.from('archive');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/rpc/begin_tenant_package_upload')) return Response.json(SESSION);
      if (url.endsWith('/rpc/renew_tenant_package_upload')) {
        return Response.json('2099-01-01T00:00:00Z');
      }
      if (url.endsWith('/rpc/stage_tenant_package')) return Response.json('invalid');
      if (init?.method === 'POST') return Response.json({});
      return new Response(url.endsWith('/archive.zip') ? archive : source);
    };
    await assert.rejects(publish(), { code: 'release_invalid' });
  });
});
