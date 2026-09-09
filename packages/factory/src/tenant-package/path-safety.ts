import { isAbsolute, relative, sep } from 'node:path';

import { isSafeTenantPackageRelativePath } from './object-path';
import { TenantPackageError } from './types';

export function portablePath(root: string, path: string): string {
  const name = relative(root, path).split(sep).join('/').normalize('NFC');
  if (Buffer.byteLength(name, 'utf8') > 1024) {
    throw new TenantPackageError('path_too_long', 'Tenant package path exceeds 1,024 bytes.');
  }
  if (isAbsolute(name) || !isSafeTenantPackageRelativePath(name)) {
    throw new TenantPackageError('unsafe_path', 'Tenant package contains an unsafe path.');
  }
  return name;
}

export function collisionKey(relativePath: string): string {
  return relativePath.normalize('NFKC').toLocaleLowerCase('en-US');
}
