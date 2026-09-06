import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { inspectContent } from './content-safety';
import { collisionKey } from './path-safety';
import { payloadDigest, scanTenantPackage } from './scanner';
import { rejectUnsafeZip } from './zip-safety';

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'tenant-package-scan-'));
  roots.push(root);
  mkdirSync(join(root, '.tenant'));
  writeFileSync(join(root, 'brand.json'), '{"name":"Neutral Demo"}\n');
  writeFileSync(join(root, '.tenant', 'metadata.json'), '{"schema":2}\n');
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('tenant package scanner', () => {
  it('includes hidden metadata and produces a stable payload digest', () => {
    const root = fixture();
    const files = scanTenantPackage(root);
    assert.deepEqual(files.map((file) => file.relativePath), ['.tenant/metadata.json', 'brand.json']);
    assert.equal(payloadDigest(files), payloadDigest(scanTenantPackage(root)));
  });

  it('rejects symlinks, executable modes, credentials, and MIME spoofing', () => {
    const linked = fixture();
    symlinkSync(join(linked, 'brand.json'), join(linked, 'alias.json'));
    assert.throws(() => scanTenantPackage(linked), { code: 'unsupported_entry' });
    const executable = fixture();
    const path = join(executable, 'notes.txt');
    writeFileSync(path, 'safe text');
    chmodSync(path, 0o755);
    assert.throws(() => scanTenantPackage(executable), { code: 'executable_rejected' });
    assert.throws(() => inspectContent('config.txt', Buffer.from(`DOPPLER_TOKEN=dp.st.${'a'.repeat(20)}`), 0o644),
      { code: 'secret_detected' });
    assert.throws(() => inspectContent('logo.png', Buffer.from('not a png'), 0o644),
      { code: 'mime_spoofing' });
  });

  it('uses Unicode and case folding to reject portable path collisions', () => {
    assert.equal(collisionKey('Logos/Caf\u00e9.PNG'), collisionKey('logos/Cafe\u0301.png'));
  });

  it('rejects malformed and traversal ZIPs', () => {
    assert.throws(() => rejectUnsafeZip(Buffer.from('not a zip')), { code: 'archive_invalid' });
    const name = Buffer.from('../secret.txt');
    const zip = Buffer.alloc(46 + name.length + 22);
    zip.writeUInt32LE(0x02014b50, 0);
    zip.writeUInt16LE(name.length, 28);
    name.copy(zip, 46);
    const end = 46 + name.length;
    zip.writeUInt32LE(0x06054b50, end);
    zip.writeUInt16LE(1, end + 10);
    zip.writeUInt32LE(46 + name.length, end + 12);
    assert.throws(() => rejectUnsafeZip(zip), { code: 'archive_traversal' });
  });
});
