import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_SCREEN_EVENT, createDemoScreenReporter, sendDemoScreenView } from './demo-capture';

describe('DEMO_SCREEN_EVENT', () => {
  it('is the shared screen.viewed vocabulary, not a re-typed literal', () => {
    assert.equal(DEMO_SCREEN_EVENT, 'screen.viewed');
  });
});

describe('createDemoScreenReporter', () => {
  it('reports the first screen it sees', () => {
    const sent: string[] = [];
    createDemoScreenReporter((screen) => sent.push(screen)).report('home');
    assert.deepEqual(sent, ['home']);
  });

  it('skips a consecutive repeat of the same screen', () => {
    const sent: string[] = [];
    const reporter = createDemoScreenReporter((screen) => sent.push(screen));
    reporter.report('home');
    reporter.report('home');
    assert.deepEqual(sent, ['home']);
  });

  it('reports again once the screen actually changes, and again if it comes back', () => {
    const sent: string[] = [];
    const reporter = createDemoScreenReporter((screen) => sent.push(screen));
    reporter.report('home');
    reporter.report('order');
    reporter.report('home');
    assert.deepEqual(sent, ['home', 'order', 'home']);
  });
});

describe('sendDemoScreenView', () => {
  it('posts one same-origin, keepalive request naming the event and the screen', () => {
    const calls: { input: string; init: RequestInit }[] = [];
    sendDemoScreenView('home', {
      endpoint: '/d/events',
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 204 });
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, '/d/events');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal(calls[0]?.init.credentials, 'same-origin');
    assert.equal(calls[0]?.init.keepalive, true);
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { event: 'screen.viewed', screen: 'home' });
  });

  it('never retries when the request rejects', async () => {
    let attempts = 0;
    assert.doesNotThrow(() => sendDemoScreenView('home', {
      fetcher: async () => {
        attempts += 1;
        throw new Error('offline');
      },
    }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    assert.equal(attempts, 1);
  });

  it('never throws when the fetcher itself throws synchronously', () => {
    assert.doesNotThrow(() => sendDemoScreenView('home', {
      fetcher: () => {
        throw new Error('no fetch in this runtime');
      },
    }));
  });

  it('defaults to /d/events against the global fetch', () => {
    const original = globalThis.fetch;
    let calledWith: string | undefined;
    globalThis.fetch = (async (input: string) => {
      calledWith = input;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      sendDemoScreenView('home');
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calledWith, '/d/events');
  });
});
