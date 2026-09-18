import { isIP } from 'node:net';

import { isPublicIpAddress } from './address-policy';
import { PublicFetchError } from './errors';

/**
 * The shape of URL the crawler is willing to request at all.
 *
 * A business's public website needs HTTPS on the default port and no
 * credentials. Anything else -- another scheme, an explicit port, a
 * `user:pass@` prefix -- is how an allowed host gets turned against a service
 * running beside it, so it is refused before any name is resolved.
 *
 * This runs on the first URL and again on every redirect `Location`, because
 * a redirect is just a second URL chosen by the far side.
 */

/**
 * Names that resolve on the machine or the local network whatever public
 * DNS says: RFC 6761 `localhost`, mDNS `.local`, RFC 8375 `home.arpa`, and
 * ICANN's reserved `.internal`. Resolution would refuse most of them anyway;
 * refusing them by name means `/etc/hosts` and a LAN resolver never get the
 * chance to answer.
 */
const LOCAL_NAMES = ['localhost', 'local', 'internal', 'home.arpa'] as const;

/** The hostname as a resolver sees it: no IPv6 brackets, no root dot, lowercase. */
export function bareHostname(hostname: string): string {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unbracketed.replace(/\.$/, '').toLowerCase();
}

function isLocalName(host: string): boolean {
  // A single label is resolved against search domains, which is to say the
  // resolver's own network. A public site always has a dot in its name.
  if (!host.includes('.')) return true;
  return LOCAL_NAMES.some((name) => host === name || host.endsWith(`.${name}`));
}

/**
 * Parses `value` (against `base` when it is relative) and returns it only
 * when it is a URL this crawler may request. Throws `invalid_url` for the
 * wrong shape and `not_public` for an address literal or name that is not on
 * the public internet. A hostname is not resolved here -- that happens at
 * connect time, so the address checked is the address used.
 */
export function parsePublicUrl(value: string | URL, base?: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value instanceof URL ? value.href : value, base);
  } catch (error) {
    throw new PublicFetchError('invalid_url', { cause: error });
  }
  // `new URL` already drops an explicit `:443`, so an empty port is exactly
  // "the default one".
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    throw new PublicFetchError('invalid_url');
  }
  const host = bareHostname(url.hostname);
  if (host === '') throw new PublicFetchError('invalid_url');
  if (isIP(host) !== 0) {
    if (!isPublicIpAddress(host)) throw new PublicFetchError('not_public');
  } else if (isLocalName(host)) {
    throw new PublicFetchError('not_public');
  }
  // A fragment is never sent, and dropping it lets callers compare URLs.
  url.hash = '';
  return url;
}
