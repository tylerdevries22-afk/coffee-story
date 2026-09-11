import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
} from 'node:fs';
import { extname, join } from 'node:path';

import { TENANT_PACKAGE_EXCLUDED, TENANT_PACKAGE_LIMITS } from './constants';
import { inspectContent } from './content-safety';
import { crc32 } from './crc32';
import { collisionKey, portablePath } from './path-safety';
import { TenantPackageError, type TenantPackageFile } from './types';
import { rejectUnsafeZip } from './zip-safety';

function paths(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    const relativePath = portablePath(root, absolute);
    if (TENANT_PACKAGE_EXCLUDED.has(entry.name)) return [];
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO()
      || stat.isCharacterDevice() || stat.isBlockDevice()) {
      throw new TenantPackageError('unsupported_entry', `Unsupported tenant entry: ${relativePath}`);
    }
    if (stat.isDirectory()) return paths(root, absolute);
    if (!stat.isFile()) throw new TenantPackageError('unsupported_entry', 'Tenant package entry is not a file.');
    return [absolute];
  });
}

function sameFile(before: ReturnType<typeof fstatSync>, after: ReturnType<typeof fstatSync>): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function readStableFile(path: string): { buffer: Buffer; mode: number } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size <= 0) {
      throw new TenantPackageError('empty_or_unsupported_file', 'Tenant files must be non-empty regular files.');
    }
    if (before.size > TENANT_PACKAGE_LIMITS.maximumFileBytes) {
      throw new TenantPackageError('file_too_large', 'A tenant file exceeds the 100 MiB limit.');
    }
    const buffer = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameFile(before, after) || buffer.length !== after.size) {
      throw new TenantPackageError('file_changed', 'A tenant file changed while it was being packaged.');
    }
    return { buffer, mode: after.mode };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function scanTenantPackage(root: string): TenantPackageFile[] {
  const seen = new Set<string>();
  let totalBytes = 0;
  const files = paths(root).sort((left, right) => Buffer.from(portablePath(root, left))
    .compare(Buffer.from(portablePath(root, right)))).map((sourcePath) => {
    const relativePath = portablePath(root, sourcePath);
    const collision = collisionKey(relativePath);
    if (seen.has(collision)) {
      throw new TenantPackageError('path_collision', 'Tenant package contains colliding paths.');
    }
    seen.add(collision);
    const { buffer, mode } = readStableFile(sourcePath);
    if (extname(relativePath).toLowerCase() === '.zip') rejectUnsafeZip(buffer);
    const content = inspectContent(relativePath, buffer, mode);
    totalBytes += buffer.length;
    if (totalBytes > TENANT_PACKAGE_LIMITS.maximumReleaseBytes) {
      throw new TenantPackageError('release_too_large', 'Tenant package exceeds the 1 GiB limit.');
    }
    return {
      sourcePath, relativePath, pathKey: collision,
      contentSha256: `sha256:${createHash('sha256').update(buffer).digest('hex')}` as const,
      crc32: crc32(buffer), byteSize: buffer.length, ...content,
    };
  });
  if (files.length === 0) throw new TenantPackageError('package_empty', 'Tenant package contains no files.');
  return files;
}

export function payloadDigest(files: readonly TenantPackageFile[]): `sha256:${string}` {
  const hash = createHash('sha256');
  const payload = files.filter((file) => file.relativePath !== 'release.json');
  if (payload.length === 0) throw new TenantPackageError('payload_empty', 'Tenant package payload is empty.');
  for (const file of payload) {
    const name = Buffer.from(file.relativePath);
    const content = readStableFile(file.sourcePath).buffer;
    hash.update(`${name.length}:`);
    hash.update(name);
    hash.update(`:${content.length}:`);
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}
