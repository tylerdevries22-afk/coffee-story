import { isAbsolute, relative, sep } from 'node:path';

import { TenantPackageError } from './types';

const CONTROL = /[\u0000-\u001f\u007f]/;

export function portablePath(root: string, path: string): string {
  const name = relative(root, path).split(sep).join('/').normalize('NFC');
  const parts = name.split('/');
  if (!name || isAbsolute(name) || name.startsWith('/') || name.includes('\\')
    || CONTROL.test(name) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TenantPackageError('unsafe_path', 'Tenant package contains an unsafe path.');
  }
  if (Buffer.byteLength(name) > 1024) {
    throw new TenantPackageError('path_too_long', 'Tenant package path exceeds 1,024 bytes.');
  }
  return name;
}

export function collisionKey(relativePath: string): string {
  return relativePath.normalize('NFKC').toLocaleLowerCase('en-US');
}
