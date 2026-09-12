import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { log, requestContext } from './log';

const mutableEnv = process.env as Record<string, string | undefined>;

type ConsoleMethod = 'error' | 'warn' | 'info';

/** Spies on one console method for the duration of `run`, the same pattern
 *  used elsewhere in this app (see webhook-diagnostics.test.ts). */
function withConsole(method: ConsoleMethod, run: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => { calls.push(args); };
  try { run(); } finally { console[method] = original; }
  return calls;
}

function loggedLine(calls: unknown[][]): Record<string, unknown> {
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.length, 1, 'log.* must emit exactly one argument: the JSON line');
  return JSON.parse(String(calls[0]?.[0])) as Record<string, unknown>;
}

describe('log', () => {
  it('emits one JSON line with level, event, ts and the given context', () => {
    const line = loggedLine(withConsole('info', () => log.info('brand.settings_loaded', { brandId: 'brand-1' })));
    assert.equal(line.level, 'info');
    assert.equal(line.event, 'brand.settings_loaded');
    assert.equal(line.brandId, 'brand-1');
    assert.equal(typeof line.ts, 'string');
    assert.ok(!Number.isNaN(Date.parse(line.ts as string)), 'ts must be a parseable timestamp');
  });

  it('routes error and warn to their matching console method', () => {
    assert.equal(loggedLine(withConsole('error', () => log.error('square.x_failed', {}))).level, 'error');
    assert.equal(loggedLine(withConsole('warn', () => log.warn('square.x_stale', {}))).level, 'warn');
  });

  it('redacts a context key naming a credential, case-insensitively, but keeps unrelated keys', () => {
    const line = loggedLine(withConsole('error', () => log.error('connector.oauth_callback_failed', {
      apiKey: 'sk_live_x', REFRESH_TOKEN: 'abc', clientSecret: 's', password: 'p',
      Authorization: 'Bearer x', sentryDsn: 'https://x', reason: 'declined_scope',
    })));
    assert.equal(line.apiKey, '[redacted]');
    assert.equal(line.REFRESH_TOKEN, '[redacted]');
    assert.equal(line.clientSecret, '[redacted]');
    assert.equal(line.password, '[redacted]');
    assert.equal(line.Authorization, '[redacted]');
    assert.equal(line.sentryDsn, '[redacted]');
    assert.equal(line.reason, 'declined_scope');
  });

  it('serializes an Error to name and message, never the raw object', () => {
    const line = loggedLine(withConsole('error', () => log.error('square.x_failed', {}, new TypeError('bad input'))));
    assert.deepEqual(line.error, { name: 'TypeError', message: 'bad input', stack: (line.error as { stack: string }).stack });
    assert.equal(typeof (line.error as { stack: string }).stack, 'string');
  });

  it('serializes an error-like object (e.g. a Supabase error) by its message', () => {
    const line = loggedLine(withConsole('error',
      () => log.error('square.x_failed', {}, { code: '42501', message: 'denied' })));
    assert.deepEqual(line.error, { name: 'UnknownError', message: 'denied' });
  });

  it('falls back to a fixed message for a thrown non-object', () => {
    const line = loggedLine(withConsole('error', () => log.error('square.x_failed', {}, 'boom')));
    assert.deepEqual(line.error, { name: 'UnknownError', message: 'boom' });
    const other = loggedLine(withConsole('error', () => log.error('square.x_failed', {}, 42)));
    assert.deepEqual(other.error, { name: 'UnknownError', message: 'A non-Error value was thrown.' });
  });

  it('omits the error field entirely when no error is passed', () => {
    const line = loggedLine(withConsole('warn', () => log.warn('square.x_stale', { brandId: 'b' })));
    assert.equal('error' in line, false);
  });

  it('includes a stack outside production regardless of level', () => {
    const previous = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = 'development';
    try {
      const line = loggedLine(withConsole('warn', () => log.warn('square.x_stale', {}, new Error('dev boom'))));
      assert.equal(typeof (line.error as { stack?: unknown }).stack, 'string');
    } finally {
      if (previous === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = previous;
    }
  });

  it('keeps a stack in production only at error level', () => {
    const previous = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = 'production';
    try {
      const errorLine = loggedLine(withConsole('error', () => log.error('square.x_failed', {}, new Error('prod boom'))));
      assert.equal(typeof (errorLine.error as { stack?: unknown }).stack, 'string');
      const warnLine = loggedLine(withConsole('warn', () => log.warn('square.x_stale', {}, new Error('prod warn'))));
      assert.equal('stack' in (warnLine.error as Record<string, unknown>), false);
    } finally {
      if (previous === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = previous;
    }
  });
});

describe('requestContext', () => {
  it('prefers x-request-id over x-vercel-id', () => {
    const request = new Request('https://hq.example.test/api/x', {
      headers: { 'x-request-id': 'req-explicit', 'x-vercel-id': 'vercel-id' },
    });
    assert.deepEqual(requestContext(request), { requestId: 'req-explicit' });
  });

  it('falls back to x-vercel-id when x-request-id is absent', () => {
    const request = new Request('https://hq.example.test/api/x', { headers: { 'x-vercel-id': 'vercel-id' } });
    assert.deepEqual(requestContext(request), { requestId: 'vercel-id' });
  });

  it('generates a request id when neither header is present', () => {
    const context = requestContext(new Request('https://hq.example.test/api/x'));
    assert.match(String(context.requestId), /^req_[0-9a-f-]{36}$/u);
  });

  it('includes brandId from claims when present, omits it otherwise', () => {
    const request = new Request('https://hq.example.test/api/x', { headers: { 'x-request-id': 'r1' } });
    assert.deepEqual(requestContext(request, { brand_id: 'brand-1' }), { requestId: 'r1', brandId: 'brand-1' });
    assert.deepEqual(requestContext(request, { brand_id: null }), { requestId: 'r1' });
    assert.deepEqual(requestContext(request), { requestId: 'r1' });
  });
});
