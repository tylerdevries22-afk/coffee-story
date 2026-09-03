import { slugify } from '@platform/domain';

/** The portable-key shape every slug in the content workspace has to hold. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects anything a server-side fetch could use to reach the deployment's own
 * network: loopback, link-local, and the three private IPv4 ranges. Draft
 * content is authored by a tenant and rendered by HQ, so a URL in it is a
 * request this server may eventually make on the author's behalf.
 */
export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0'
        || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(?:0|10|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|127|169\.254|192\.168)\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
  } catch {
    return false;
  }
}

/**
 * Trusts the sniffed bytes rather than the declared type. A browser will send
 * whatever Content-Type it likes, and the extension picked here becomes part of
 * an immutable Storage key.
 */
export function imageExtensionFor(type: string, bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  const jpeg = type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = type === 'image/png'
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const webp = type === 'image/webp'
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  return jpeg ? 'jpg' : png ? 'png' : webp ? 'webp' : null;
}

export function slugFromLabel(label: string): string {
  return slugify(label, 80);
}
