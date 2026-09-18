import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import { CrawlBudget } from '../public-fetch';
import { scriptedTransport, type FakeReply } from '../public-fetch/fakes.test-support';
import { memoryAssetSink, type BrandAssetSink } from './asset-sink';
import { MAX_PHOTOS, collectBrandAssets } from './collect-assets';

const SITE = 'https://www.maplerowbakehouse.com';

function png(width: number, height: number, r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

/** A site serving `files` by URL: a Buffer as a PNG, anything else as written, and a 404 otherwise. */
function served(files: Readonly<Record<string, Buffer | FakeReply>>) {
  return scriptedTransport((request) => {
    const file = files[request.url.href];
    if (file === undefined) return { status: 404, headers: { 'content-type': 'text/html' }, body: 'missing' };
    return Buffer.isBuffer(file) ? { status: 200, headers: { 'content-type': 'image/png' }, body: file } : file;
  });
}

test('the logo and each photograph are normalised, stored and described', async () => {
  const sink = memoryAssetSink();
  const manifest = await collectBrandAssets(
    { logoUrl: `${SITE}/logo.png`, imageUrls: [`${SITE}/bread.png`, `${SITE}/tart.png`] },
    {
      sink,
      transport: served({
        [`${SITE}/logo.png`]: await png(600, 200, 122, 62, 29),
        [`${SITE}/bread.png`]: await png(960, 960, 110, 50, 40),
        [`${SITE}/tart.png`]: await png(960, 1_280, 120, 60, 45),
      }),
    },
  );
  assert.deepEqual(sink.assets.map((asset) => asset.key.replace(/-[0-9a-f]{12}\.webp$/, '-HASH.webp')), [
    'logo.webp', 'photos/01-HASH.webp', 'photos/02-HASH.webp',
  ]);
  for (const asset of sink.assets) {
    assert.equal(asset.contentType, 'image/webp');
    assert.equal(asset.sha256, createHash('sha256').update(asset.bytes).digest('hex'));
    assert.equal((await sharp(asset.bytes).metadata()).format, 'webp');
  }
  const { logo } = manifest;
  assert.ok(logo !== null && 'key' in logo);
  assert.equal(logo.edge, 512);
  assert.equal(logo.sourceUrl, `${SITE}/logo.png`);
  const [bread] = manifest.photos;
  assert.ok(bread !== undefined && 'key' in bread);
  assert.equal(bread.key, sink.assets[1]?.key);
  assert.equal(bread.byteLength, sink.assets[1]?.bytes.length);
  assert.equal(bread.edge, 900);
  assert.deepEqual(bread.flags, []);
  assert.deepEqual(bread.grade.beyondGrade, []);
  assert.equal(manifest.photos.length, 2);
});

test('one bad image is recorded with its reason and never sinks the rest', async () => {
  // A PNG signature over nothing a decoder can read.
  const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const sink = memoryAssetSink();
  const manifest = await collectBrandAssets(
    { logoUrl: `${SITE}/logo.svg`, imageUrls: [`${SITE}/missing.png`, `${SITE}/broken.png`, `${SITE}/bread.png`] },
    {
      sink,
      transport: served({
        [`${SITE}/logo.svg`]: { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
        [`${SITE}/broken.png`]: broken,
        [`${SITE}/bread.png`]: await png(960, 960, 110, 50, 40),
      }),
    },
  );
  assert.deepEqual(manifest.logo, { sourceUrl: `${SITE}/logo.svg`, error: 'wrong_type' });
  assert.deepEqual(manifest.photos.map((photo) => ('error' in photo ? photo.error : photo.sourceUrl)), [
    'http_status', 'undecodable', `${SITE}/bread.png`,
  ]);
  assert.equal(sink.assets.length, 1);
});

test('the same picture at a second address is stored once', async () => {
  const bread = await png(960, 960, 110, 50, 40);
  const sink = memoryAssetSink();
  const transport = served({ [`${SITE}/bread.png`]: bread, [`${SITE}/bread-copy.png`]: Buffer.from(bread) });
  const manifest = await collectBrandAssets({ logoUrl: null, imageUrls: [`${SITE}/bread.png`, `${SITE}/bread-copy.png`] }, { sink, transport });
  assert.equal(transport.requests.length, 2, 'both addresses were read');
  assert.equal(sink.assets.length, 1);
  assert.deepEqual(manifest.photos.map((photo) => photo.sourceUrl), [`${SITE}/bread.png`]);
});

test('a spent budget stops the downloads, and no more than twelve photographs are tried', async () => {
  const urls = Array.from({ length: 5 }, (_, index) => `${SITE}/photo-${index}.png`);
  // Each a different size and a clearly different colour, so no two can
  // normalise to the same file and be merged; the budget counts requests only.
  const files = Object.fromEntries(await Promise.all(urls.map(async (url, index) => (
    [url, await png(920 + index * 40, 960, 60 + index * 35, 40 + index * 20, 30)] as const
  ))));
  const transport = served(files);
  const budget = new CrawlBudget({ maxRequests: 3, maxBytes: 1_024 * 1_048_576, deadlineMs: 600_000 });
  const manifest = await collectBrandAssets({ logoUrl: null, imageUrls: urls }, { sink: memoryAssetSink(), transport, budget });
  assert.equal(manifest.logo, null);
  assert.equal(transport.requests.length, 3, 'three requests were allowed, and nothing after the one refused');
  assert.equal(manifest.photos.filter((photo) => 'key' in photo).length, 3);
  assert.deepEqual(manifest.photos.map((photo) => photo.sourceUrl), urls.slice(0, 4));
  assert.deepEqual(manifest.photos.at(-1), { sourceUrl: urls[3], error: 'budget_exhausted' });

  const many = served({});
  const fourteen = Array.from({ length: 14 }, (_, index) => `${SITE}/gallery-${index}.png`);
  const capped = await collectBrandAssets({ logoUrl: null, imageUrls: fourteen }, { sink: memoryAssetSink(), transport: many });
  assert.equal(capped.photos.length, MAX_PHOTOS);
  assert.equal(many.requests.length, MAX_PHOTOS);
  const two = served({});
  await collectBrandAssets({ logoUrl: null, imageUrls: fourteen }, { sink: memoryAssetSink(), transport: two, maxPhotos: 2 });
  assert.equal(two.requests.length, 2);
});

test('storage failing is a reason to retry the step, not a fact about the image', async () => {
  const failing: BrandAssetSink = {
    put: async () => {
      throw new Error('storage unavailable');
    },
  };
  await assert.rejects(collectBrandAssets(
    { logoUrl: `${SITE}/logo.png`, imageUrls: [] },
    { sink: failing, transport: served({ [`${SITE}/logo.png`]: await png(600, 200, 122, 62, 29) }) },
  ), /storage unavailable/);
});
