import { extname } from 'node:path';

import { DOWNLOAD_ONLY_EXTENSIONS, EXECUTABLE_EXTENSIONS } from './constants';
import { TenantPackageError, type TenantPreviewKind } from './types';

const TEXT_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.json', '.md', '.toml', '.txt', '.xml', '.yaml', '.yml',
]);
const IMAGE_MIME: Record<string, string> = {
  '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
};
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private_key'],
  [/\b(?:sk_live|rk_live)_[A-Za-z0-9]{16,}\b/, 'payment_secret'],
  [/\bsb_secret_[A-Za-z0-9_-]{16,}\b/, 'supabase_secret'],
  [/\bdp\.st\.[A-Za-z0-9_-]{16,}\b/, 'doppler_token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'cloud_access_key'],
  [/(?:SUPABASE_SERVICE_ROLE_KEY|DOPPLER_TOKEN|DATABASE_URL)\s*[:=]\s*["']?(?!example|replace|placeholder|\$\{)[^\s"']{12,}/i, 'assigned_secret'],
];

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

function binaryMime(buffer: Buffer): string | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  return null;
}

function rejectExecutable(path: string, buffer: Buffer, mode: number): void {
  const extension = extname(path).toLowerCase();
  const magic = buffer.subarray(0, 4).toString('hex');
  const executableMagic = buffer.subarray(0, 2).toString('ascii') === 'MZ'
    || magic === '7f454c46' || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(magic);
  if (EXECUTABLE_EXTENSIONS.has(extension) || (mode & 0o111) !== 0
    || buffer.subarray(0, 2).toString('ascii') === '#!' || executableMagic) {
    throw new TenantPackageError('executable_rejected', 'Tenant packages cannot contain executable files.');
  }
}

function rejectSecrets(buffer: Buffer): void {
  // latin1, and no binary short-circuit. This used to `return` on any buffer
  // containing a NUL byte, on the reasoning that binary files hold no secrets
  // worth regexing. One 0 byte anywhere therefore skipped the scan for the
  // whole file -- and download-only extensions get no magic-byte check either,
  // so such a file could carry a private key straight through the gate. The
  // text-extension NUL check below only ever covered .txt/.json and friends.
  // Every pattern here is ASCII, and latin1 maps each byte to one character
  // without throwing, so scanning decodes cleanly whatever the bytes are.
  const text = buffer.toString('latin1');
  const finding = SECRET_PATTERNS.find(([pattern]) => pattern.test(text));
  if (finding) {
    throw new TenantPackageError('secret_detected', `Tenant package contains a ${finding[1]} credential pattern.`);
  }
}

export function inspectContent(path: string, buffer: Buffer, mode: number): {
  mimeType: string;
  previewKind: TenantPreviewKind;
} {
  rejectExecutable(path, buffer, mode);
  rejectSecrets(buffer);
  const extension = extname(path).toLowerCase();
  const detected = binaryMime(buffer);
  const imageMime = IMAGE_MIME[extension];
  if (imageMime && detected !== imageMime) {
    throw new TenantPackageError('mime_spoofing', 'A tenant package file does not match its extension.');
  }
  if (imageMime) return { mimeType: imageMime, previewKind: 'raster' };
  if (extension === '.pdf' && detected !== 'application/pdf') {
    throw new TenantPackageError('mime_spoofing', 'A tenant package file does not match its extension.');
  }
  if (extension === '.zip' && detected !== 'application/zip') {
    throw new TenantPackageError('mime_spoofing', 'A tenant package file does not match its extension.');
  }
  if (TEXT_EXTENSIONS.has(extension) && buffer.includes(0)) {
    throw new TenantPackageError('mime_spoofing', 'A text file contains binary content.');
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return { mimeType: extension === '.json' ? 'application/json' : 'text/plain', previewKind: 'text' };
  }
  if (DOWNLOAD_ONLY_EXTENSIONS.has(extension)) {
    return { mimeType: detected ?? 'application/octet-stream', previewKind: 'download' };
  }
  return { mimeType: detected ?? 'application/octet-stream', previewKind: 'download' };
}
