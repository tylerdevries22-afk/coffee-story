import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { safeEndpoint } from './http';
import { TenantPackageStorageClient, verificationDeadlineMs } from './storage-client';
import { TenantPackageError } from './types';

const originalFetch = globalThis.fetch;
const roots: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function file(bytes: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'tenant-storage-'));
  roots.push(root);
  const path = join(root, 'object.bin');
  writeFileSync(path, bytes);
  return path;
}

describe('TenantPackageStorageClient', () => {
  it('rejects insecure non-loopback endpoints', () => {
    assert.throws(() => safeEndpoint('http://project.example.test'), { code: 'endpoint_invalid' });
    assert.throws(() => safeEndpoint('not a URL'), { code: 'endpoint_invalid' });
    assert.equal(safeEndpoint('http://127.0.0.1:54321').port, '54321');
  });

  it('uploads small objects without upsert and verifies their complete digest', async () => {
    const bytes = Buffer.from('verified tenant object');
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return init?.method === 'POST'
        ? new Response('{}', { status: 200 })
        : new Response(bytes, { status: 200 });
    };
    const client = new TenantPackageStorageClient('https://demo.supabase.co', 'service-secret');
    await client.upload({
      path: file(bytes), objectPath: 'brand/digest/files/brand.json',
      byteSize: bytes.length, mimeType: 'application/json',
    });
    await client.verify(
      'brand/digest/files/brand.json', bytes.length,
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    );
    const upload = calls.find((call) => call.init?.method === 'POST');
    assert.equal(new Headers(upload?.init?.headers).get('x-upsert'), 'false');
    assert.match(upload?.url ?? '', /storage\/v1\/object\/tenant-packages/);
  });

  it('uses the direct storage host and 6 MiB TUS chunks for large objects', async () => {
    const bytes = Buffer.alloc(6 * 1024 * 1024 + 2, 7);
    const chunkSizes: number[] = [];
    let offset = 0;
    let mutations = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        assert.match(url, /^https:\/\/demo\.storage\.supabase\.co/);
        return new Response(null, {
          status: 201, headers: { location: 'https://demo.storage.supabase.co/upload/id' },
        });
      }
      if (init?.method === 'PATCH') {
        const body = init.body as Buffer;
        chunkSizes.push(body.length);
        offset += body.length;
        return new Response(null, { status: 204, headers: { 'upload-offset': String(offset) } });
      }
      throw new Error('unexpected request');
    };
    const client = new TenantPackageStorageClient(
      'https://demo.supabase.co',
      'service-secret',
      async () => { mutations += 1; },
    );
    await client.upload({
      path: file(bytes), objectPath: 'brand/digest/archive.zip',
      byteSize: bytes.length, mimeType: 'application/zip',
    });
    assert.deepEqual(chunkSizes, [6 * 1024 * 1024, 2]);
    assert.equal(mutations, 3);
  });

  it('cancels an accepted standard-upload response body', async () => {
    let cancellations = 0;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1)); },
      cancel() { cancellations += 1; },
    }), { status: 200 });
    const bytes = Buffer.from('object');
    const client = new TenantPackageStorageClient('https://demo.supabase.co', 'service-secret');
    await client.upload({
      path: file(bytes), objectPath: 'brand/digest/files/brand.json',
      byteSize: bytes.length, mimeType: 'application/json',
    });
    assert.equal(cancellations, 1);
  });

  it('fails closed when a downloaded object does not match', async () => {
    globalThis.fetch = async () => new Response('wrong', { status: 200 });
    const client = new TenantPackageStorageClient('https://demo.supabase.co', 'service-secret');
    await assert.rejects(client.verify('brand/digest/file', 4, `sha256:${'a'.repeat(64)}`),
      { code: 'object_verification_failed' });
  });

  it('uses a bounded size-aware deadline while allowing an active slow stream', async () => {
    const bytes = Buffer.from('slow-response');
    let heartbeats = 0;
    globalThis.fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return new Response(new ReadableStream({
      async start(controller) {
        for (const byte of bytes) {
          await new Promise((resolve) => setTimeout(resolve, 3));
          controller.enqueue(Uint8Array.of(byte));
        }
        controller.close();
      },
    }));
    };
    const client = new TenantPackageStorageClient(
      'https://demo.supabase.co', 'service-secret', async () => { heartbeats += 1; },
      { heartbeatMs: 5, inactivityMs: 50, totalMs: () => 500 },
    );
    await client.verify('brand/digest/slow', bytes.length,
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.ok(verificationDeadlineMs(1024 ** 3) > verificationDeadlineMs(1024));
    assert.ok(verificationDeadlineMs(Number.MAX_SAFE_INTEGER) <= 30 * 60_000);
    assert.ok(heartbeats > 1);
  });

  it('retries and fails closed when a response becomes inactive', async () => {
    let attempts = 0;
    let cancellations = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(Uint8Array.of(1)); },
        cancel() { cancellations += 1; },
      }));
    };
    const client = new TenantPackageStorageClient(
      'https://demo.supabase.co', 'service-secret', async () => undefined,
      { inactivityMs: 5, totalMs: () => 100 },
    );
    await assert.rejects(client.verify('brand/digest/stalled', 2, `sha256:${'a'.repeat(64)}`),
      { code: 'object_verification_failed' });
    assert.equal(attempts, 3);
    assert.equal(cancellations, 3);
  });

  it('aborts verification immediately when the upload lease heartbeat fails', async () => {
    let renewals = 0;
    let cancellations = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1)); },
      cancel() { cancellations += 1; },
    }));
    const client = new TenantPackageStorageClient(
      'https://demo.supabase.co',
      'service-secret',
      async () => {
        renewals += 1;
        if (renewals > 1) {
          throw new TenantPackageError('upload_lease_lost', 'Tenant upload lease was lost.');
        }
      },
      { heartbeatMs: 2, inactivityMs: 100, totalMs: () => 200 },
    );
    await assert.rejects(
      client.verify('brand/digest/stalled', 2, `sha256:${'a'.repeat(64)}`),
      { code: 'upload_lease_lost' },
    );
    assert.equal(renewals, 2);
    assert.equal(cancellations, 1);
  });
});
