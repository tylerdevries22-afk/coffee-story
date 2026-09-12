import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signTrainingMediaUrl, trainingMediaObjectPath } from './signed-training-media';

const TRAINING_URL = 'https://proj.supabase.co/storage/v1/object/public/training-media/brand-1/published/icon.png';

type Outcome = { signedUrl?: string; error?: boolean; hang?: boolean };

function storageClient(behavior: (attempt: number) => Outcome) {
  const calls: { bucket: string; path: string; ttl: number }[] = [];
  let attempt = 0;
  const client = {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl: async (path: string, ttl: number) => {
            attempt += 1;
            calls.push({ bucket, path, ttl });
            const outcome = behavior(attempt);
            if (outcome.hang) return new Promise(() => {});
            if (outcome.error) return { data: null, error: { message: 'boom' } };
            return { data: { signedUrl: outcome.signedUrl ?? 'https://signed.example/x' }, error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('trainingMediaObjectPath', () => {
  it('extracts the object path from a training-media public URL', () => {
    assert.equal(trainingMediaObjectPath(TRAINING_URL), 'brand-1/published/icon.png');
  });

  it('returns null for anything that is not one of our training-media objects', () => {
    assert.equal(trainingMediaObjectPath('https://example.com/a.png'), null);
    assert.equal(trainingMediaObjectPath(undefined), null);
    assert.equal(trainingMediaObjectPath(null), null);
    assert.equal(trainingMediaObjectPath('blob:local-preview'), null);
  });
});

describe('signTrainingMediaUrl', () => {
  it('passes through a URL that is not a training-media object without calling Storage', async () => {
    const { client, calls } = storageClient(() => ({ error: true }));
    const result = await signTrainingMediaUrl(client, 'https://example.com/a.png');
    assert.equal(result, 'https://example.com/a.png');
    assert.equal(calls.length, 0);
  });

  it('requests a signed URL for the object path with the given TTL', async () => {
    const { client, calls } = storageClient(() => ({ signedUrl: 'https://signed.example/one' }));
    const result = await signTrainingMediaUrl(client, TRAINING_URL, 120);
    assert.equal(result, 'https://signed.example/one');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { bucket: 'training-media', path: 'brand-1/published/icon.png', ttl: 120 });
  });

  it('retries once after a failed attempt', async () => {
    const { client, calls } = storageClient((attempt) => (attempt === 1 ? { error: true } : { signedUrl: 'https://signed.example/retry' }));
    const result = await signTrainingMediaUrl(client, TRAINING_URL);
    assert.equal(result, 'https://signed.example/retry');
    assert.equal(calls.length, 2);
  });

  it('retries a hung request past its timeout and succeeds on the second attempt', async () => {
    const { client, calls } = storageClient((attempt) => (attempt === 1 ? { hang: true } : { signedUrl: 'https://signed.example/after-timeout' }));
    const result = await signTrainingMediaUrl(client, TRAINING_URL, 60, 25);
    assert.equal(result, 'https://signed.example/after-timeout');
    assert.equal(calls.length, 2);
  });

  it('gives up after exhausting every retry, so callers fall back to their empty state', async () => {
    const { client, calls } = storageClient(() => ({ error: true }));
    const result = await signTrainingMediaUrl(client, TRAINING_URL);
    assert.equal(result, undefined);
    assert.equal(calls.length, 2);
  });
});
