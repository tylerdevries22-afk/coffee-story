import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { assertImmutableCheckout } from './checkout';
import type { MalwareScanner } from './malware';
import { validateReleaseEnvelope } from './release-envelope';
import { payloadDigest, scanTenantPackage } from './scanner';
import { generateRasterPreviews } from './preview-generator';
import { TenantPackageError, type TenantPackageBuild } from './types';
import { writeDeterministicZip } from './zip-writer';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function hashFile(path: string): Promise<`sha256:${string}`> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export async function buildTenantPackage(input: {
  repositoryRoot: string;
  tenantRoot: string;
  tenantSlug: string;
  archivePath: string;
  malwareScanner?: MalwareScanner;
  requireCi?: boolean;
}): Promise<TenantPackageBuild> {
  if (!SLUG.test(input.tenantSlug)) {
    throw new TenantPackageError('tenant_slug_invalid', 'Tenant slug is invalid.');
  }
  if (!input.malwareScanner) {
    throw new TenantPackageError('malware_scanner_required', 'A malware scanner is required.');
  }
  input.malwareScanner(input.tenantRoot);
  const scannedFiles = scanTenantPackage(input.tenantRoot);
  const files = await generateRasterPreviews(
    scannedFiles,
    resolve(dirname(input.archivePath), 'previews'),
  );
  const artifactDigest = payloadDigest(files);
  const envelope = validateReleaseEnvelope(input.tenantSlug, artifactDigest, files);
  assertImmutableCheckout({
    repositoryRoot: input.repositoryRoot,
    tenantRoot: input.tenantRoot,
    sourceCommit: envelope.sourceCommit,
    requireCi: input.requireCi,
  });
  await writeDeterministicZip(input.archivePath, input.tenantSlug, files);
  assertImmutableCheckout({
    repositoryRoot: input.repositoryRoot,
    tenantRoot: input.tenantRoot,
    sourceCommit: envelope.sourceCommit,
    requireCi: input.requireCi,
  });
  if (statSync(input.archivePath).size > 1200 * 1024 * 1024) {
    throw new TenantPackageError('archive_too_large', 'Tenant ZIP exceeds the storage limit.');
  }
  return {
    tenantSlug: input.tenantSlug,
    releaseKey: envelope.releaseKey,
    commitSha: envelope.sourceCommit,
    artifactDigest,
    envelopeSha256: envelope.envelopeSha256,
    archiveSha256: await hashFile(input.archivePath),
    archivePath: input.archivePath,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.byteSize, 0),
  };
}
