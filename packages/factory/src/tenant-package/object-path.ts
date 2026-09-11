const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CONTROL = /\p{Cc}/u;
const MAX_OBJECT_PATH_BYTES = 1_500;

export type TenantPackageObjectPath = {
  readonly format: 'legacy' | 'modern';
  readonly namespace: string;
};

export function isCanonicalPostgresUuid(value: string): boolean {
  return POSTGRES_UUID.test(value);
}

export function isSafeTenantPackageRelativePath(path: string): boolean {
  if (!path || Buffer.byteLength(path, 'utf8') > 1_024
    || path.includes('\\') || CONTROL.test(path)) return false;
  return path.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..');
}

export function parseTenantPackageObjectPath(
  path: string,
): TenantPackageObjectPath | undefined {
  if (!path || Buffer.byteLength(path, 'utf8') > MAX_OBJECT_PATH_BYTES
    || path.includes('\\') || CONTROL.test(path)) return undefined;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  const [brandId, artifactDigest, third] = parts;
  if (!brandId || !isCanonicalPostgresUuid(brandId)
    || !artifactDigest || !SHA256_HEX.test(artifactDigest) || !third) return undefined;

  const modern = SHA256_HEX.test(third);
  const kindIndex = modern ? 3 : 2;
  const kind = parts[kindIndex];
  const tail = parts.slice(kindIndex + 1);
  if (kind === 'archive.zip' ? tail.length !== 0
    : (kind !== 'files' && kind !== 'previews') || tail.length === 0) return undefined;
  return {
    format: modern ? 'modern' : 'legacy',
    namespace: parts.slice(0, kindIndex).join('/'),
  };
}

export function isCanonicalTenantPackageObjectPath(path: string): boolean {
  return parseTenantPackageObjectPath(path) !== undefined;
}
