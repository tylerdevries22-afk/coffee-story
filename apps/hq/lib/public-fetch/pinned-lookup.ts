import type { LookupAddress } from 'node:dns';
import { lookup as systemLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

import { isPublicIpAddress } from './address-policy';
import { PublicFetchError } from './errors';
import { bareHostname } from './url-policy';

/**
 * Name resolution that cannot be rebound between the check and the connect.
 *
 * Resolving a name, checking the answer, then handing the *name* to a socket
 * resolves it twice, and a hostile DNS server can answer the second time
 * with 127.0.0.1. This is the socket's own `lookup`: it resolves once, refuses
 * the name if any answer is not public, and gives the socket the validated
 * addresses themselves, so the address connected to is always one that was
 * checked. Every redirect hop opens a new connection and so resolves anew.
 */
export type ResolvedAddress = { readonly address: string; readonly family: number };

/** Every address a name resolves to. Injected in tests so nothing touches DNS. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export const systemResolver: Resolver = (hostname) => systemLookup(hostname, { all: true });

/**
 * The addresses for `hostname`, or a typed refusal.
 *
 * All of them are checked, not the first: a resolver may rotate its answers
 * and a socket may fall back to the next address, so a single private answer
 * taints the whole name.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolve: Resolver,
): Promise<readonly ResolvedAddress[]> {
  const host = bareHostname(hostname);
  const literal = isIP(host);
  if (literal !== 0) {
    if (!isPublicIpAddress(host)) throw new PublicFetchError('not_public');
    return [{ address: host, family: literal }];
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolve(host);
  } catch (error) {
    throw new PublicFetchError('network', { cause: error });
  }
  if (addresses.length === 0) throw new PublicFetchError('network');
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new PublicFetchError('not_public');
  }
  return addresses;
}

function requestedFamily(family: number | 'IPv4' | 'IPv6' | undefined): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

/**
 * A `lookup` for `net`/`tls`/`https` that only ever yields checked addresses.
 *
 * Node calls it in two shapes: `all: true` when it races address families
 * (the default since Node 20) and expects an array, otherwise a single
 * address and its family. Both are honoured, and a family filter is applied
 * after the whole answer has passed the check, never instead of it.
 */
export function createPinnedLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const family = requestedFamily(options.family);
    resolvePublicAddresses(hostname, resolve).then(
      (addresses) => {
        const usable: LookupAddress[] = addresses
          .filter((entry) => family === 0 || entry.family === family)
          .map(({ address, family: entryFamily }) => ({ address, family: entryFamily }));
        const first = usable[0];
        if (first === undefined) {
          callback(new PublicFetchError('network'), '');
        } else if (options.all === true) {
          callback(null, usable);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: unknown) => {
        callback(error instanceof PublicFetchError ? error : new PublicFetchError('network', { cause: error }), '');
      },
    );
  };
}
