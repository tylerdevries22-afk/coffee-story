import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';

import { crc32Finish, crc32Start, crc32Update } from './crc32';
import { TenantPackageError, type TenantPackageFile } from './types';

type CentralEntry = { name: Buffer; file: TenantPackageFile; offset: number };
const UTF8_FLAG = 0x0800;
const DOS_DATE = 33;

function localHeader(name: Buffer, file: TenantPackageFile): Buffer {
  const output = Buffer.alloc(30);
  output.writeUInt32LE(0x04034b50, 0);
  output.writeUInt16LE(20, 4);
  output.writeUInt16LE(UTF8_FLAG, 6);
  output.writeUInt16LE(0, 8);
  output.writeUInt16LE(0, 10);
  output.writeUInt16LE(DOS_DATE, 12);
  output.writeUInt32LE(file.crc32, 14);
  output.writeUInt32LE(file.byteSize, 18);
  output.writeUInt32LE(file.byteSize, 22);
  output.writeUInt16LE(name.length, 26);
  return output;
}

function centralHeader(entry: CentralEntry): Buffer {
  const output = Buffer.alloc(46);
  output.writeUInt32LE(0x02014b50, 0);
  output.writeUInt16LE(0x0314, 4);
  output.writeUInt16LE(20, 6);
  output.writeUInt16LE(UTF8_FLAG, 8);
  output.writeUInt16LE(0, 10);
  output.writeUInt16LE(0, 12);
  output.writeUInt16LE(DOS_DATE, 14);
  output.writeUInt32LE(entry.file.crc32, 16);
  output.writeUInt32LE(entry.file.byteSize, 20);
  output.writeUInt32LE(entry.file.byteSize, 24);
  output.writeUInt16LE(entry.name.length, 28);
  output.writeUInt32LE(0o100644 << 16, 38);
  output.writeUInt32LE(entry.offset, 42);
  return output;
}

function endRecord(entries: number, size: number, offset: number): Buffer {
  const output = Buffer.alloc(22);
  output.writeUInt32LE(0x06054b50, 0);
  output.writeUInt16LE(entries, 8);
  output.writeUInt16LE(entries, 10);
  output.writeUInt32LE(size, 12);
  output.writeUInt32LE(offset, 16);
  return output;
}

async function writeAt(handle: Awaited<ReturnType<typeof open>>, data: Buffer, offset: number) {
  let written = 0;
  while (written < data.length) {
    const result = await handle.write(data, written, data.length - written, offset + written);
    if (result.bytesWritten === 0) {
      throw new TenantPackageError('archive_write_failed', 'Tenant ZIP could not be written safely.');
    }
    written += result.bytesWritten;
  }
  return offset + data.length;
}

async function copyVerified(
  handle: Awaited<ReturnType<typeof open>>, file: TenantPackageFile, offset: number,
): Promise<number> {
  const before = await stat(file.sourcePath);
  const hash = createHash('sha256');
  let checksum = crc32Start();
  let bytes = 0;
  for await (const chunk of createReadStream(file.sourcePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    checksum = crc32Update(checksum, buffer);
    offset = await writeAt(handle, buffer, offset);
    bytes += buffer.length;
  }
  checksum = crc32Finish(checksum);
  const after = await stat(file.sourcePath);
  const digest = `sha256:${hash.digest('hex')}`;
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs || bytes !== file.byteSize
    || digest !== file.contentSha256 || checksum !== file.crc32) {
    throw new TenantPackageError('file_changed', 'A tenant file changed while the ZIP was created.');
  }
  return offset;
}

export async function writeDeterministicZip(
  outputPath: string, tenantSlug: string, files: readonly TenantPackageFile[],
): Promise<void> {
  if (files.length > 0xfffe) throw new TenantPackageError('too_many_files', 'ZIP contains too many files.');
  const handle = await open(outputPath, 'wx', 0o600);
  let offset = 0;
  const entries: CentralEntry[] = [];
  try {
    for (const file of files) {
      const name = Buffer.from(`${tenantSlug}/${file.relativePath}`);
      if (name.length > 0xffff) throw new TenantPackageError('path_too_long', 'ZIP path is too long.');
      entries.push({ name, file, offset });
      offset = await writeAt(handle, localHeader(name, file), offset);
      offset = await writeAt(handle, name, offset);
      offset = await copyVerified(handle, file, offset);
    }
    const centralOffset = offset;
    for (const entry of entries) {
      offset = await writeAt(handle, centralHeader(entry), offset);
      offset = await writeAt(handle, entry.name, offset);
    }
    offset = await writeAt(handle, endRecord(entries.length, offset - centralOffset, centralOffset), offset);
    await handle.truncate(offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
