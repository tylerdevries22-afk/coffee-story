import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPublicIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    const [first, second] = parts;
    if (first === undefined || second === undefined) return false;
    return !(
      first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && (second === 0 || second === 168))
      || (first === 198 && (second === 18 || second === 19))
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized !== '::' && normalized !== '::1'
      && !normalized.startsWith('fc') && !normalized.startsWith('fd')
      && !/^fe[89ab]/.test(normalized) && !normalized.startsWith('::ffff:');
  }
  return false;
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('resource URL must use standard public HTTPS');
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('resource hostname resolves outside the public internet');
  }
  return url;
}

async function checkedFetch(url: URL): Promise<Response> {
  let finalError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/html,video/*,image/*;q=0.8', Range: 'bytes=0-0' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status < 500 && response.status !== 429) return response;
      finalError = new Error(`resource returned ${response.status}`);
    } catch (error) {
      finalError = error instanceof Error ? error : new Error('resource request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw finalError ?? new Error('resource request failed');
}

export async function verifyPublicResource(value: string): Promise<void> {
  let url = await assertPublicUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await checkedFetch(url);
    if (response.ok) return;
    if (response.status < 300 || response.status >= 400) {
      throw new Error(`resource returned ${response.status}`);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('resource redirect has no location');
    url = await assertPublicUrl(new URL(location, url).toString());
  }
  throw new Error('resource has too many redirects');
}
