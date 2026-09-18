import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

import { PublicFetchError } from './errors';
import type { RequestFunction, Transport, TransportRequest, TransportResponse } from './https-transport';
import type { ResolvedAddress, Resolver } from './pinned-lookup';

/**
 * Stand-ins for the network, shared by the public-fetch tests.
 *
 * Nothing here opens a socket, asks a resolver or needs a certificate: the
 * transport, the resolver and `https.request` are each replaced at the seam
 * the production code exposes for exactly this.
 */
export type FakeReply = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer | Readable;
};

export function bodyStream(body: FakeReply['body']): Readable {
  if (body instanceof Readable) return body;
  if (body === undefined) return Readable.from([]);
  return Readable.from([typeof body === 'string' ? Buffer.from(body, 'utf8') : body]);
}

function toResponse(reply: FakeReply): TransportResponse {
  return { status: reply.status, headers: { ...reply.headers }, body: bodyStream(reply.body) };
}

/** A transport that answers from a script and records every request it saw. */
export function scriptedTransport(
  script: (request: TransportRequest, index: number) => FakeReply | Promise<FakeReply>,
): Transport & { readonly requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    return toResponse(await script(request, requests.length - 1));
  };
  return Object.assign(transport, { requests });
}

/** A reply that never comes, for timeout tests. */
export function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

export function page(body: string, headers: Readonly<Record<string, string>> = {}): FakeReply {
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body };
}

export function redirect(location: string, status = 302): FakeReply {
  return { status, headers: { location } };
}

/** A resolver answering from a table, whose answers may change per call. */
export function tableResolver(
  table: Readonly<Record<string, readonly (readonly string[])[]>>,
): Resolver & { readonly asked: string[] } {
  const asked: string[] = [];
  const resolve: Resolver = async (hostname) => {
    const round = asked.filter((name) => name === hostname).length;
    asked.push(hostname);
    const answers = table[hostname] ?? [];
    const answer = answers[Math.min(round, answers.length - 1)];
    if (answer === undefined) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    return answer.map((address): ResolvedAddress => ({ address, family: isIP(address) }));
  };
  return Object.assign(resolve, { asked });
}

class FakeSocket extends EventEmitter {
  remoteAddress: string | undefined;
}

class FakeClientRequest extends EventEmitter {
  destroyed = false;

  end(): this {
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (error !== undefined) this.emit('error', error);
    return this;
  }
}

export function fakeIncoming(reply: FakeReply): IncomingMessage {
  const message = Object.assign(bodyStream(reply.body), { statusCode: reply.status, headers: { ...reply.headers } });
  return message as unknown as IncomingMessage;
}

/**
 * Stands in for `https.request` the way Node drives it: runs the transport's
 * own `lookup` (skipping it for an address literal, as Node does), connects a
 * fake socket to the address that lookup chose, then answers from `sites`.
 * `connectedTo` records every address a request was actually written to.
 */
export function emulatedHttps(
  sites: Readonly<Record<string, (url: URL) => FakeReply>>,
): RequestFunction & { readonly connectedTo: string[] } {
  const connectedTo: string[] = [];
  const send: RequestFunction = (url, options, onResponse) => {
    const request = new FakeClientRequest();
    const connect = (address: string): void => {
      const socket = new FakeSocket();
      request.emit('socket', socket);
      socket.remoteAddress = address;
      socket.emit('connect');
      if (request.destroyed) return;
      connectedTo.push(address);
      const site = sites[url.hostname];
      if (site === undefined) request.destroy(new Error('connect ECONNREFUSED'));
      else onResponse(fakeIncoming(site(url)));
    };
    process.nextTick(() => {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const lookup = options.lookup;
      if (isIP(host) !== 0 || lookup === undefined) {
        connect(host);
        return;
      }
      lookup(host, { all: true }, (error, addresses) => {
        if (error) {
          request.destroy(error);
          return;
        }
        connect((Array.isArray(addresses) ? addresses[0]?.address : addresses) ?? '');
      });
    });
    return request as unknown as ClientRequest;
  };
  return Object.assign(send, { connectedTo });
}

/** The typed failure a promise settles with; fails the test if it resolves. */
export async function failure(promise: Promise<unknown>): Promise<PublicFetchError> {
  let outcome: unknown = 'resolved';
  try {
    await promise;
  } catch (error) {
    outcome = error;
  }
  assert.ok(outcome instanceof PublicFetchError, `expected a PublicFetchError, got ${String(outcome)}`);
  return outcome;
}

/** The typed failure a function throws synchronously. */
export function thrown(run: () => unknown): PublicFetchError {
  let outcome: unknown = 'returned';
  try {
    run();
  } catch (error) {
    outcome = error;
  }
  assert.ok(outcome instanceof PublicFetchError, `expected a PublicFetchError, got ${String(outcome)}`);
  return outcome;
}
