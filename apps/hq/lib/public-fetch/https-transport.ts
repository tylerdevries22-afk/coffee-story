import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';

import { isPublicIpAddress } from './address-policy';
import { PublicFetchError } from './errors';
import { createPinnedLookup, systemResolver, type Resolver } from './pinned-lookup';

/**
 * One HTTPS exchange, with nothing between the checked address and the socket.
 *
 * `fetch` cannot be used here: it resolves the name itself and offers no hook
 * between resolution and connect, which is exactly the gap DNS rebinding
 * uses. `node:https` accepts a `lookup`, so the pinned one from
 * pinned-lookup.ts decides where every socket goes.
 *
 * The transport is an interface so tests can exercise the whole fetch
 * without a network, a resolver or a TLS certificate.
 */
export type TransportRequest = {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
};

export type TransportResponse = {
  readonly status: number;
  /** Lowercase names, one value each. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readable;
};

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export type RequestFunction = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export type HttpsTransportDependencies = {
  readonly resolve?: Resolver;
  readonly request?: RequestFunction;
};

/** Repeated headers joined; cookies dropped, because nothing here keeps a session. */
export function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === 'set-cookie') continue;
    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

/**
 * Refuses a socket whose far end is not public, before any request is written.
 *
 * The pinned lookup already guarantees this for names. An address literal
 * skips `lookup` entirely, and url-policy.ts checks those; this is the same
 * rule applied to the address the kernel actually connected to, so a future
 * path that bypasses both still cannot talk to a private host.
 */
export function guardRemoteAddress(socket: Socket, request: ClientRequest): void {
  const check = (): void => {
    const remote = socket.remoteAddress;
    if (remote === undefined || !isPublicIpAddress(remote)) {
      request.destroy(new PublicFetchError('not_public'));
    }
  };
  if (socket.remoteAddress !== undefined) check();
  else socket.once('connect', check);
}

export function createHttpsTransport(dependencies: HttpsTransportDependencies = {}): Transport {
  const lookup = createPinnedLookup(dependencies.resolve ?? systemResolver);
  const send: RequestFunction = dependencies.request ?? httpsRequest;
  return ({ url, headers, signal }) => new Promise<TransportResponse>((resolve, reject) => {
    const request = send(url, {
      method: 'GET',
      headers,
      lookup,
      // A pooled socket may have been opened by code that never ran this
      // lookup, and a shared agent may carry a proxy. A fresh connection per
      // request is what makes the address check mean something.
      agent: false,
      signal,
    }, (response) => {
      resolve({
        status: response.statusCode ?? 0,
        headers: flattenHeaders(response.headers),
        body: response,
      });
    });
    request.once('socket', (socket: Socket) => guardRemoteAddress(socket, request));
    // Persistent, not `once`: an abort after the response can emit a second
    // error, and an unheard one would crash the process.
    request.on('error', reject);
    request.end();
  });
}
