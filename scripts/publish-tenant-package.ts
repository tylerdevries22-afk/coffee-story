import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  buildTenantPackage, clamAvScanner, publishTenantPackageObjects, TenantPackageError,
} from '@platform/factory';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TenantPackageError('configuration_missing', `${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const tenantSlug = required('TENANT_SLUG');
  const brandId = required('TENANT_PACKAGE_BRAND_ID');
  const endpoint = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const tenantRoot = resolve(repositoryRoot, 'tenants', tenantSlug);
  const expectedRoot = resolve(repositoryRoot, 'tenants') + '/';
  if (!tenantRoot.startsWith(expectedRoot)) {
    throw new TenantPackageError('tenant_slug_invalid', 'Tenant slug escapes the tenant root.');
  }
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'tenant-package-'));
  try {
    const build = await buildTenantPackage({
      repositoryRoot, tenantRoot, tenantSlug,
      archivePath: resolve(temporaryRoot, `${tenantSlug}.zip`),
      malwareScanner: clamAvScanner, requireCi: true,
    });
    const publication = await publishTenantPackageObjects({ endpoint, serviceKey, brandId, build });
    process.stdout.write(`${JSON.stringify({
      releaseId: publication.releaseId, releaseKey: build.releaseKey,
      artifactDigest: build.artifactDigest, commitSha: build.commitSha,
      fileCount: build.fileCount, totalBytes: build.totalBytes,
    })}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const code = error instanceof TenantPackageError ? error.code : 'tenant_package_publish_failed';
  process.stderr.write(`${JSON.stringify({ code, message: 'Tenant package publication failed.' })}\n`);
  process.exitCode = 1;
});
