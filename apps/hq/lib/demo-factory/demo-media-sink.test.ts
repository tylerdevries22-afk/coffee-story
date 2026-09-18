import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DemoDb } from '../demo-site';
import { demoMediaSink } from './demo-media-sink';

type Upload = { bucket: string; path: string; options: unknown };

function storage(error: unknown = null) {
  const uploads: Upload[] = [];
  const db = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _bytes: Buffer, options: unknown) => {
          uploads.push({ bucket, path, options });
          return { data: error ? null : { path }, error };
        },
      }),
    },
  };
  return { db: db as unknown as Pick<DemoDb, 'storage'>, uploads };
}

const LOGO = { key: 'logo.webp', bytes: Buffer.from('webp'), contentType: 'image/webp' as const, sha256: 'a'.repeat(64) };

describe('demoMediaSink', () => {
  it('stores an image under the demo’s own id in the private demo bucket', async () => {
    const { db, uploads } = storage();
    const sink = demoMediaSink(db, 'site-1');
    await sink.put(LOGO);
    assert.deepEqual(uploads, [{ bucket: 'demo-media', path: 'site-1/logo.webp', options: { contentType: 'image/webp', upsert: true } }]);
    assert.deepEqual(sink.stored, ['logo.webp']);
  });

  it('refuses a name the media route would never serve, before storing anything', async () => {
    const { db, uploads } = storage();
    const sink = demoMediaSink(db, 'site-1');
    for (const key of ['photos/01-abc.webp', '../logo.webp', 'logo.svg', 'Logo.webp']) {
      await assert.rejects(sink.put({ ...LOGO, key }), key);
    }
    assert.equal(uploads.length, 0);
    assert.deepEqual(sink.stored, []);
  });

  it('lets a storage failure through, so the demo is not built on a missing image', async () => {
    const failure = new Error('storage unavailable');
    const { db } = storage(failure);
    const sink = demoMediaSink(db, 'site-1');
    await assert.rejects(sink.put(LOGO), (error) => error === failure);
    assert.deepEqual(sink.stored, []);
  });
});
