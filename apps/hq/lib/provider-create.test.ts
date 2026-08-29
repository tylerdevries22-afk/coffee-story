import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createOrAdopt } from './provider-create';

type Event = { event: string; metadata: Record<string, unknown> };

function recorder() {
  const events: Event[] = [];
  return {
    events,
    onEvent: (event: string, metadata: Record<string, unknown>) => { events.push({ event, metadata }); },
    delay: async () => {},
  };
}

describe('createOrAdopt', () => {
  it('creates once and never asks the lookup when the provider answers', async () => {
    let creates = 0;
    let lookups = 0;
    const result = await createOrAdopt(
      'GitHub repository',
      async () => { creates += 1; return 'created'; },
      async () => { lookups += 1; return null; },
      recorder(),
    );
    assert.equal(result, 'created');
    assert.equal(creates, 1);
    // The whole point of the reconciliation is that it costs nothing when the
    // provider is healthy, which is nearly always.
    assert.equal(lookups, 0);
  });

  it('adopts the resource a lost response left behind instead of making a second one', async () => {
    let creates = 0;
    const log = recorder();
    const result = await createOrAdopt(
      'Supabase project',
      async () => {
        creates += 1;
        throw new Error('Provider returned 502.');
      },
      async () => 'adopted',
      log,
    );
    assert.equal(result, 'adopted');
    // One create, not two: this is the duplicate-billing case the retry exists for.
    assert.equal(creates, 1);
    assert.deepEqual(log.events.map((entry) => entry.event), ['provider.create_retry', 'provider.create_adopted']);
    assert.equal(log.events[1]?.metadata.label, 'Supabase project');
  });

  it('creates again when the lookup proves the failed attempt landed nothing', async () => {
    const attempts: string[] = [];
    let creates = 0;
    const result = await createOrAdopt(
      'Doppler project',
      async () => {
        attempts.push('create');
        creates += 1;
        if (creates === 1) throw new Error('Provider returned 429.');
        return 'created';
      },
      async () => { attempts.push('lookup'); return null; },
      recorder(),
    );
    assert.equal(result, 'created');
    assert.deepEqual(attempts, ['create', 'lookup', 'create']);
  });

  it('gives up after a bounded number of attempts and reports the provider failure', async () => {
    let creates = 0;
    await assert.rejects(
      createOrAdopt(
        'Vercel project coffee-story-hq',
        async () => { creates += 1; throw new Error('Provider returned 500.'); },
        async () => null,
        recorder(),
      ),
      /Provider returned 500\./,
    );
    // Bounded: a provider that is refusing must fail the run, not loop on it.
    assert.equal(creates, 3);
  });

  it('stops rather than creating again when the lookup cannot answer', async () => {
    let creates = 0;
    await assert.rejects(
      createOrAdopt(
        'GitHub repository',
        async () => { creates += 1; throw new Error('Provider returned 503.'); },
        async () => { throw new Error('Provider lookup failed.'); },
        recorder(),
      ),
      /Provider lookup failed\./,
    );
    // "We could not tell" is not "it is not there". Creating here is how a
    // second repository gets made.
    assert.equal(creates, 1);
  });

  it('wraps a non-Error rejection so the run still reports something legible', async () => {
    await assert.rejects(
      createOrAdopt(
        'Doppler project',
        async () => { throw 'socket hang up'; },
        async () => null,
        recorder(),
      ),
      /Doppler project could not be created\./,
    );
  });

  it('backs off between attempts', async () => {
    const waits: number[] = [];
    await assert.rejects(createOrAdopt(
      'Supabase project',
      async () => { throw new Error('Provider returned 500.'); },
      async () => null,
      { delay: async (milliseconds) => { waits.push(milliseconds); } },
    ));
    // Two waits for three attempts, and none after the last failure.
    assert.deepEqual(waits, [1_000, 2_000]);
  });
});
