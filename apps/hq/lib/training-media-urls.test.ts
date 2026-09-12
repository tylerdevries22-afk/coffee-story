import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signTrainingMediaUrl, trainingMediaObjectPath } from './training-media-urls';

const storedUrl = 'https://storage.example/storage/v1/object/public/training-media/brand/image.webp';

describe('HQ training media signing', () => {
  it('extracts a stored training identity and refuses unrelated URLs', () => {
    assert.equal(trainingMediaObjectPath(storedUrl), 'brand/image.webp');
    assert.equal(trainingMediaObjectPath('https://assets.example/image.webp'), null);
    assert.equal(trainingMediaObjectPath(null), null);
  });

  it('never reflects external input through the signing server action', async () => {
    const client = {} as SupabaseClient;
    assert.equal(await signTrainingMediaUrl(client, 'https://assets.example/image.webp'), null);
    assert.equal(await signTrainingMediaUrl(client, undefined), null);
  });

  it('returns the storage response after one retry', async () => {
    let attempts = 0;
    const client = { storage: { from: (bucket: string) => {
      assert.equal(bucket, 'training-media');
      return { createSignedUrl: async (path: string, ttl: number) => {
        assert.equal(path, 'brand/image.webp');
        assert.equal(ttl, 300);
        attempts += 1;
        return attempts === 1 ? { error: new Error('Temporary failure') }
          : { data: { signedUrl: 'https://storage.example/signed-image' }, error: null };
      } };
    } } } as unknown as SupabaseClient;
    assert.equal(await signTrainingMediaUrl(client, storedUrl), 'https://storage.example/signed-image');
    assert.equal(attempts, 2);
  });

  it('returns unavailable when both signing requests fail', async () => {
    let attempts = 0;
    const client = { storage: { from: () => ({ createSignedUrl: async () => {
      attempts += 1;
      throw new Error('Unavailable');
    } }) } } as unknown as SupabaseClient;
    assert.equal(await signTrainingMediaUrl(client, storedUrl), null);
    assert.equal(attempts, 2);
  });
});
