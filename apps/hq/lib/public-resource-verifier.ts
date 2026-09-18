import {
  PublicFetchError, createHttpsTransport, isPublicIpAddress, parsePublicUrl, type Transport, type TransportResponse,
} from './public-fetch';

/**
 * The address rule lives in public-fetch/address-policy.ts so this verifier
 * and the body-reading crawler cannot disagree about what "public" means.
 * Re-exported because callers and tests already import it from here.
 */
export { isPublicIpAddress };

/**
 * Whether a link cited in a training release resolves, without reading it.
 *
 * It asks for one byte and never reads the body. The request goes through the
 * crawler's transport rather than `fetch`: checking a name's addresses and then
 * handing the name to `fetch` resolves it twice, and a hostile DNS server can
 * answer the second time with a private address. The transport connects only
 * to an address it checked. Failures are fixed sentences, because the reason
 * lands in a release review and nothing the far side sent belongs there.
 */
const ATTEMPTS = 2;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const NOT_HTTPS = 'resource URL must use standard public HTTPS';
const NOT_PUBLIC = 'resource hostname resolves outside the public internet';
const HEADERS: Readonly<Record<string, string>> = {
  accept: 'text/html,video/*,image/*;q=0.8',
  range: 'bytes=0-0',
  'user-agent': 'Mozilla/5.0 (compatible; OrderingLinkCheck/1.0; confirms that a link cited in staff training exists)',
};

function notPublic(error: unknown): boolean {
  return error instanceof PublicFetchError && error.code === 'not_public';
}

function publicUrl(value: string, base?: URL): URL {
  try {
    return parsePublicUrl(value, base);
  } catch (error) {
    throw new Error(notPublic(error) ? NOT_PUBLIC : NOT_HTTPS);
  }
}

async function exchange(url: URL, transport: Transport): Promise<TransportResponse> {
  let failure = new Error('resource request failed');
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let response: TransportResponse;
    try {
      response = await transport({ url, headers: HEADERS, signal });
    } catch (error) {
      // The address answer will not change on a second ask.
      if (notPublic(error)) throw new Error(NOT_PUBLIC);
      failure = new Error(signal.aborted ? 'resource request timed out' : 'resource request failed');
      continue;
    }
    // A server that ignored the range must not get to stream a whole video.
    response.body.destroy();
    if (response.status < 500 && response.status !== 429) return response;
    failure = new Error(`resource returned ${response.status}`);
  }
  throw failure;
}

export async function verifyPublicResource(value: string, transport: Transport = createHttpsTransport()): Promise<void> {
  let url = publicUrl(value);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await exchange(url, transport);
    if (response.status >= 200 && response.status < 300) return;
    if (response.status < 300 || response.status >= 400) {
      throw new Error(`resource returned ${response.status}`);
    }
    const location = response.headers.location;
    if (!location) throw new Error('resource redirect has no location');
    url = publicUrl(location, url);
  }
  throw new Error('resource has too many redirects');
}
