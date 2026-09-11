import { readFileSync } from 'node:fs';

import { releaseBinding } from '../release';
import { TenantPackageError, type TenantPackageFile } from './types';

type Envelope = { schemaVersion?: unknown; tenantSlug?: unknown; release?: unknown };

export function validateReleaseEnvelope(
  tenantSlug: string,
  artifactDigest: string,
  files: readonly TenantPackageFile[],
): { releaseKey: string; sourceCommit: string; envelopeSha256: `sha256:${string}` } {
  const releaseFile = files.find((file) => file.relativePath === 'release.json');
  if (!releaseFile) throw new TenantPackageError('release_envelope_missing', 'release.json is required.');
  let envelope: Envelope;
  try {
    envelope = JSON.parse(readFileSync(releaseFile.sourcePath, 'utf8')) as Envelope;
  } catch {
    throw new TenantPackageError('release_envelope_invalid', 'release.json must contain valid JSON.');
  }
  const binding = releaseBinding(envelope);
  if (envelope.schemaVersion !== 2 || envelope.tenantSlug !== tenantSlug || !binding
    || binding.artifactDigest !== artifactDigest) {
    throw new TenantPackageError(
      'release_binding_mismatch',
      'release.json must bind this tenant and payload digest.',
    );
  }
  return {
    releaseKey: binding.releaseId,
    sourceCommit: binding.commitSha,
    envelopeSha256: releaseFile.contentSha256,
  };
}
