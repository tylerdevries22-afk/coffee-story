import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import sharp from 'sharp';

import { generateRasterPreviews } from './preview-generator';
import type { TenantPackageFile } from './types';

const roots: string[] = [];

async function raster(): Promise<{ file: TenantPackageFile; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'tenant-preview-'));
  roots.push(root);
  const sourcePath = join(root, 'source.png');
  const input = await sharp({
    create: { width: 8, height: 8, channels: 4, background: '#c69b7b' },
  }).withMetadata({ exif: { IFD0: { Artist: 'private tenant metadata' } } }).png().toBuffer();
  await writeFile(sourcePath, input);
  return {
    output: join(root, 'generated'),
    file: {
      sourcePath, relativePath: 'assets/source.png', pathKey: 'assets/source.png',
      contentSha256: `sha256:${createHash('sha256').update(input).digest('hex')}`,
      crc32: 1, mimeType: 'image/png', byteSize: input.length, previewKind: 'raster',
    },
  };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true, force: true,
}))));

describe('generateRasterPreviews', () => {
  it('creates a bounded PNG with source metadata removed', async () => {
    const { file, output } = await raster();
    const [result] = await generateRasterPreviews([file], output);
    assert.ok(result?.preview);
    const bytes = await readFile(result.preview.sourcePath);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.exif, undefined);
    assert.equal(result.preview.byteSize, bytes.length);
    assert.match(result.preview.contentSha256, /^sha256:[0-9a-f]{64}$/);
  });

  it('rejects content that no longer matches the scanned digest', async () => {
    const { file, output } = await raster();
    await writeFile(file.sourcePath, 'changed');
    await assert.rejects(generateRasterPreviews([file], output), { code: 'file_changed' });
  });
});
