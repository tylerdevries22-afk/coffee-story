import { payloadDigest, scanTenantPackage } from './tenant-package/scanner';

export function tenantArtifactDigest(directory: string): string {
  return payloadDigest(scanTenantPackage(directory));
}
