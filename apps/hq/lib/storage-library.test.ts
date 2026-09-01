import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  extensionOf, formatStorageBytes, isStorageAssetKind, recordStorageAsset, safeOriginalFilename,
  sourceForContentUpload, storageConfigFor, storagePathFor, validateStorageFile,
} from './storage-library';

describe('storage asset library', () => {
  it('keeps published and private assets in their purpose-specific buckets', () => {
    assert.deepEqual(storageConfigFor('brand_image'), {
      bucketId: 'brand-assets', label: 'Brand image', visibility: 'public',
    });
    assert.equal(storageConfigFor('document').bucketId, 'content-files');
  });

  it('creates an opaque object path without a user-created folder', () => {
    assert.equal(
      storagePathFor('brand-id', 'design', 'fig', 'asset-id'),
      'brand-id/design/asset-id.fig',
    );
  });

  it('preserves known content ownership and rejects unknown source labels', () => {
    assert.deepEqual(sourceForContentUpload('training-lesson', 'lesson-id'), {
      sourceType: 'training_lesson', sourceKey: 'lesson-id',
    });
    assert.deepEqual(sourceForContentUpload('unknown', 'foreign-id'), {
      sourceType: 'unassigned', sourceKey: null,
    });
  });

  it('uses compact, stable byte labels in the inventory', () => {
    assert.equal(formatStorageBytes(950), '950 B');
    assert.equal(formatStorageBytes(1_500), '1.5 KB');
    assert.equal(formatStorageBytes(2_500_000), '2.5 MB');
  });

  it('removes unsafe filename characters before persistence', () => {
    assert.equal(safeOriginalFilename('  plan<final>.pdf ', 'pdf'), 'plan-final-.pdf');
  });

  it('accepts only a verified supported file type at the upload boundary', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    const image = new File([jpeg], 'hero.jpg', { type: 'image/jpeg' });
    assert.equal(validateStorageFile('brand_image', image, jpeg)?.contentType, 'image/jpeg');
    assert.equal(validateStorageFile('brand_image', image, Uint8Array.from([0x00])), null);
    assert.equal(extensionOf('design.FIG'), 'fig');
    assert.equal(isStorageAssetKind('document'), true);
    assert.equal(isStorageAssetKind('unknown'), false);
  });

  it('records a complete asset row and reports a database rejection', async () => {
    let inserted: unknown = null;
    const client = {
      from: () => ({ insert: async (value: unknown) => { inserted = value; return { error: null }; } }),
    } as unknown as SupabaseClient;
    const asset = {
      assetKind: 'document' as const, brandId: 'brand-id', byteSize: 9, checksumSha256: null,
      createdBy: 'member-id', metadata: { source: 'test' }, mimeType: 'application/pdf',
      objectPath: 'brand-id/document/asset.pdf', originalFilename: 'asset.pdf', sourceKey: null,
      sourceType: 'unassigned' as const,
    };
    assert.equal(await recordStorageAsset(client, asset), true);
    assert.equal((inserted as { bucket_id: string }).bucket_id, 'content-files');
    const rejectedClient = { from: () => ({ insert: async () => ({ error: new Error('rejected') }) }) } as unknown as SupabaseClient;
    assert.equal(await recordStorageAsset(rejectedClient, asset), false);
  });
});
