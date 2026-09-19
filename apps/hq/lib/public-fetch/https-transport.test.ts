import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { Socket } from 'node:net';
import test from 'node:test';

import { PublicFetchError } from './errors';
import { emulatedHttps, failure, fakeIncoming, tableResolver } from './fakes.test-support';
import { createHttpsTransport, flattenHeaders, guardRemoteAddress, type RequestFunction } from './https-transport';

const HEADERS = { 'user-agent': 'test', accept: 'text/html' } as const;

test('each request is a GET on a fresh connection, through the pinned lookup', async () => {
  const seen: { url: URL; options: RequestOptions }[] = [];
  const send: RequestFunction = (url, options, onResponse) => {
    seen.push({ url, options });
    const request = new EventEmitter() as unknown as ClientRequest;
    Object.assign(request, { end: () => request });
    process.nextTick(() => onResponse(fakeIncoming({
      status: 200,
      headers: { 'content-type': 'text/html', 'set-cookie': 'session=abc' },
      body: '<p>hi</p>',
    })));
    return request;
  };
  const controller = new AbortController();
  const transport = createHttpsTransport({ request: send, resolve: tableResolver({}) });
  const response = await transport({ url: new URL('https://shop.example.com/'), headers: HEADERS, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers, { 'content-type': 'text/html' });
  const [first] = seen;
  assert.ok(first);
  assert.equal(first.url.href, 'https://shop.example.com/');
  assert.equal(first.options.method, 'GET');
  assert.equal(first.options.agent, false);
  assert.equal(typeof first.options.lookup, 'function');
  assert.equal(first.options.signal, controller.signal);
  assert.deepEqual(first.options.headers, HEADERS);
});

test('a name that resolves privately never reaches a socket', async () => {
  const send = emulatedHttps({ 'internal.example.com': () => ({ status: 200, body: 'secret' }) });
  const transport = createHttpsTransport({
    request: send,
    resolve: tableResolver({ 'internal.example.com': [['10.0.0.8']] }),
  });
  const error = await failure(transport({
    url: new URL('https://internal.example.com/'), headers: HEADERS, signal: new AbortController().signal,
  }));
  assert.equal(error.code, 'not_public');
  assert.deepEqual(send.connectedTo, []);
});

test('a public name connects to the address the lookup checked', async () => {
  const send = emulatedHttps({ 'shop.example.com': () => ({ status: 204 }) });
  const transport = createHttpsTransport({
    request: send,
    resolve: tableResolver({ 'shop.example.com': [['93.184.216.34']] }),
  });
  const response = await transport({
    url: new URL('https://shop.example.com/'), headers: HEADERS, signal: new AbortController().signal,
  });
  assert.equal(response.status, 204);
  assert.deepEqual(send.connectedTo, ['93.184.216.34']);
});

function fakeSocket(remoteAddress: string | undefined): Socket {
  return Object.assign(new EventEmitter(), { remoteAddress }) as unknown as Socket;
}

function fakeRequest(): { request: ClientRequest; destroyedWith: () => unknown } {
  let destroyedWith: unknown;
  const request = { destroy: (error?: unknown) => { destroyedWith = error; } } as unknown as ClientRequest;
  return { request, destroyedWith: () => destroyedWith };
}

test('a socket whose far end is private is destroyed on connect', () => {
  const socket = fakeSocket(undefined);
  const { request, destroyedWith } = fakeRequest();
  guardRemoteAddress(socket, request);
  assert.equal(destroyedWith(), undefined);
  Object.assign(socket, { remoteAddress: '192.168.0.10' });
  socket.emit('connect');
  const error = destroyedWith();
  assert.ok(error instanceof PublicFetchError);
  assert.equal(error.code, 'not_public');
});

test('an already-connected socket is judged at once, and a public one is left alone', () => {
  const privateSide = fakeRequest();
  guardRemoteAddress(fakeSocket('::1'), privateSide.request);
  assert.ok(privateSide.destroyedWith() instanceof PublicFetchError);
  const publicSide = fakeRequest();
  guardRemoteAddress(fakeSocket('93.184.216.34'), publicSide.request);
  assert.equal(publicSide.destroyedWith(), undefined);
});

test('response headers are flattened and cookies dropped', () => {
  assert.deepEqual(flattenHeaders({
    'content-type': 'text/css',
    'set-cookie': ['a=1', 'b=2'],
    vary: undefined,
    link: ['<a.css>; rel=preload', '<b.css>; rel=preload'],
  }), { 'content-type': 'text/css', link: '<a.css>; rel=preload, <b.css>; rel=preload' });
});
