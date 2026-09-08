import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

import { TENANT_PACKAGE_LIMITS } from './constants';
import { TenantPackageError, type TenantPackageFile } from './types';

export async function generateRasterPreviews(
  files: readonly TenantPackageFile[],
  previewRoot: string,
): Promise<TenantPackageFile[]> {
  const output: TenantPackageFile[] = [];
  for (const file of files) {
    if (file.previewKind !== 'raster') {
      output.push(file);
      continue;
    }
    const source = await readFile(file.sourcePath);
    const sourceDigest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    if (source.length !== file.byteSize || sourceDigest !== file.contentSha256) {
      throw new TenantPackageError('file_changed', 'A raster changed before preview generation.');
    }
    const sourcePath = join(previewRoot, `${file.pathKey}.png`);
    await mkdir(dirname(sourcePath), { recursive: true, mode: 0o700 });
    try {
      await sharp(source, {
        failOn: 'warning', limitInputPixels: 40_000_000, pages: 1, sequentialRead: true,
      }).rotate().resize(1600, 1600, {
        fit: 'inside', withoutEnlargement: true,
      }).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(sourcePath);
    } catch {
      throw new TenantPackageError('raster_preview_rejected', 'A raster preview could not be sanitized.');
    }
    const preview = await readFile(sourcePath);
    const metadata = await sharp(preview, { limitInputPixels: 40_000_000 }).metadata();
    if (metadata.format !== 'png' || preview.length > TENANT_PACKAGE_LIMITS.maximumPreviewBytes) {
      throw new TenantPackageError('raster_preview_rejected', 'A raster preview is unsafe or too large.');
    }
    const previewStat = await stat(sourcePath);
    if (!previewStat.isFile() || previewStat.size !== preview.length) {
      throw new TenantPackageError('raster_preview_rejected', 'A raster preview changed during creation.');
    }
    output.push({
      ...file,
      preview: {
        sourcePath, mimeType: 'image/png' as const, byteSize: preview.length,
        contentSha256: `sha256:${createHash('sha256').update(preview).digest('hex')}` as const,
      },
    });
  }
  return output;
}
