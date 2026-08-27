import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPublishedTrainingRelease, subscribeToTrainingReleases } from './training';

function releaseClient(manifest: unknown) {
  const calls: string[] = [];
  const removed: unknown[] = [];
  const channel = {
    on() { return channel; },
    subscribe() { return channel; },
  };
  const client = {
    from(table: string) {
      calls.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        abortSignal() { return builder; },
        maybeSingle: async () => ({ data: manifest ? { id: 'release-1', manifest } : null, error: null }),
      };
      return builder;
    },
    channel() { return channel; },
    removeChannel(value: unknown) { removed.push(value); return Promise.resolve('ok'); },
  } as unknown as SupabaseClient;
  return { client, calls, removed };
}

const legacyManifest = {
  schemaVersion: 1,
  generatedAt: '2026-08-26T00:00:00.000Z',
  tenant: { businessName: 'Coffee Story', industry: 'Cafe', locale: 'en-US' },
  sources: [{ title: 'Source', url: 'https://example.com/source', publisher: 'Example', accessedAt: '2026-08-26' }],
  modules: [{
    slug: 'skills', title: 'Skills', summary: 'Skills', icon: { symbol: 'wrench', prompt: 'line icon' }, lessons: [],
  }],
};

describe('published training release data', () => {
  it('reads the published relation and normalizes legacy modules', async () => {
    const { client, calls } = releaseClient(legacyManifest);
    const release = await fetchPublishedTrainingRelease(client, 'brand-1');
    assert.equal(calls[0], 'training_releases');
    assert.equal(release?.id, 'release-1');
    assert.equal(release?.manifest.schemaVersion, 2);
    assert.equal(release?.manifest.modules.find((module) => module.slug === 'skills')?.trackKey, 'skills');
  });

  it('returns null when no published release exists', async () => {
    const { client } = releaseClient(null);
    assert.equal(await fetchPublishedTrainingRelease(client, 'brand-1'), null);
  });

  it('debounces realtime changes and removes the channel on cleanup', async () => {
    const { client, removed } = releaseClient(legacyManifest);
    let changes = 0;
    const stop = subscribeToTrainingReleases(client, 'brand-1', () => { changes += 1; }, 5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(changes, 0);
    stop();
    assert.equal(removed.length, 1);
  });

  it('refetches after a realtime reconnect boundary', async () => {
    let status: ((value: string) => void) | undefined;
    const channel = {
      on() { return channel; },
      subscribe(callback?: (value: string) => void) { status = callback; return channel; },
    };
    const client = {
      channel() { return channel; },
      removeChannel() { return Promise.resolve('ok'); },
    } as unknown as SupabaseClient;
    let changes = 0;
    const stop = subscribeToTrainingReleases(client, 'brand-1', () => { changes += 1; }, 5);
    status?.('SUBSCRIBED');
    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();
    assert.equal(changes, 1);
  });
});
