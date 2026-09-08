import { TenantPackageError } from './types';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_RATIO = 100;

function endOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  return -1;
}

function unsafeArchivePath(name: string): boolean {
  return !name || name.startsWith('/') || name.includes('\\')
    || name.split('/').some((part) => part === '.' || part === '..')
    || /[\u0000-\u001f\u007f]/.test(name);
}

export function rejectUnsafeZip(buffer: Buffer): void {
  const eocd = endOfCentralDirectory(buffer);
  if (eocd < 0) throw new TenantPackageError('archive_invalid', 'ZIP archive is malformed.');
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff
    || offset + centralSize > eocd) {
    throw new TenantPackageError('archive_unsupported', 'ZIP64 or malformed archives are not accepted.');
  }
  let expanded = 0;
  let compressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new TenantPackageError('archive_invalid', 'ZIP directory is malformed.');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    if ((flags & 1) !== 0) {
      throw new TenantPackageError('archive_encrypted', 'Encrypted ZIP archives are not accepted.');
    }
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const expandedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > buffer.length) throw new TenantPackageError('archive_invalid', 'ZIP entry is malformed.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (unsafeArchivePath(name)) {
      throw new TenantPackageError('archive_traversal', 'ZIP archive contains an unsafe path.');
    }
    expanded += expandedSize;
    compressed += compressedSize;
    offset = next;
  }
  const suspiciousRatio = compressed === 0 ? expanded > 0 : expanded / compressed > MAX_RATIO;
  if (expanded > MAX_EXPANDED_BYTES || (expanded > 10 * 1024 * 1024 && suspiciousRatio)) {
    throw new TenantPackageError('archive_bomb', 'ZIP archive expands beyond the safe limit.');
  }
}
