import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPublishedTrainingRelease, subscribeToTrainingReleases } from './training';

function releaseClient(manifest: unknown) {
  const calls: string[] = [];
  const removed: unknown[] = [];
  const signCalls: { bucket: string; path: string; ttl: number }[] = [];
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
    // Every training-media URL in the manifest is signed through this same
    // client (see signed-training-media.ts), so a release read that carries
    // no such URL never has to touch it.
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl: async (path: string, ttl: number) => {
            signCalls.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
          },
        };
      },
    },
    channel() { return channel; },
    removeChannel(value: unknown) { removed.push(value); return Promise.resolve('ok'); },
  } as unknown as SupabaseClient;
  return { client, calls, removed, signCalls };
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
  it('reads the published relation and lifts a legacy release to schema 3', async () => {
    const { client, calls } = releaseClient(legacyManifest);
    const release = await fetchPublishedTrainingRelease(client, 'brand-1');
    assert.equal(calls[0], 'training_releases');
    assert.equal(release?.id, 'release-1');
    assert.equal(release?.manifest.schemaVersion, 3);
    assert.equal(release?.manifest.tracks.find((track) => track.slug === 'skills')?.title, 'Skills');
  });

  it('returns null when no published release exists', async () => {
    const { client } = releaseClient(null);
    assert.equal(await fetchPublishedTrainingRelease(client, 'brand-1'), null);
  });

  it('exchanges training-media URLs in the manifest for signed ones', async () => {
    const trainingMediaManifest = {
      schemaVersion: 3,
      generatedAt: '2026-09-01T00:00:00.000Z',
      tenant: { businessName: 'Coffee Story', industry: 'Cafe', locale: 'en-US' },
      sources: [],
      tracks: [{
        slug: 'skills', title: 'Skills', summary: 'Skills',
        icon: {
          symbol: 'wrench', prompt: 'line icon',
          url: 'https://proj.supabase.co/storage/v1/object/public/training-media/brand-1/published/icon.png',
        },
        lessons: [{
          slug: 'lesson-1', title: 'Lesson', objective: '', content: '', estimatedMinutes: 5,
          sourceUrls: [],
          media: [
            { kind: 'image', url: 'https://proj.supabase.co/storage/v1/object/public/training-media/brand-1/published/media.png', title: 't', rightsNote: '' },
            { kind: 'video', url: 'https://youtube.example/watch', title: 'external', rightsNote: '' },
          ],
          quiz: [],
        }],
      }],
    };
    const { client, signCalls } = releaseClient(trainingMediaManifest);
    const release = await fetchPublishedTrainingRelease(client, 'brand-1');
    const track = release?.manifest.tracks.find((item) => item.slug === 'skills');
    assert.equal(track?.icon.url, 'https://signed.example/brand-1/published/icon.png');
    assert.equal(track?.lessons[0]?.media[0]?.url, 'https://signed.example/brand-1/published/media.png');
    // The external video link is not a training-media object and is left alone.
    assert.equal(track?.lessons[0]?.media[1]?.url, 'https://youtube.example/watch');
    assert.equal(signCalls.length, 2);
    assert.equal(signCalls[0]?.bucket, 'training-media');
    assert.equal(signCalls[0]?.path, 'brand-1/published/icon.png');
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
