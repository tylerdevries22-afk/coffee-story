import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { registerStorageAsset } from './storage-registry.js';

/**
 * Upload a tenant's menu photograph and point the item at it.
 *
 * Split out of `onboard.ts` when the registry write landed: that file is far
 * past the 200-line rule already, and this is the one part of onboarding that
 * talks to storage, so it belongs beside the registry helper it now calls.
 *
 * The object path carries the file's sha256, which makes the write idempotent
 * in the only way that matters here -- re-running onboarding for an unchanged
 * image targets a key that already exists, and replacing an image writes a new
 * key rather than mutating a cached one.
 */
export async function syncMenuImage(
  db: SupabaseClient,
  brandId: string,
  itemId: string,
  itemSlug: string,
  tenantDirectory: string,
): Promise<boolean> {
  const imagePath = join(tenantDirectory, 'assets', 'menu', `${itemSlug}.webp`);
  if (!existsSync(imagePath)) return false;
  const bytes = readFileSync(imagePath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const directory = `${brandId}/menu-item/${itemId}`;
  const objectPath = `${directory}/${checksum}.webp`;
  const existing = await db.storage.from('menu-images').list(directory, {
    limit: 1, search: `${checksum}.webp`,
  });
  if (existing.error) throw existing.error;
  if (!(existing.data ?? []).some((object) => object.name === `${checksum}.webp`)) {
    const uploaded = await db.storage.from('menu-images').upload(objectPath, bytes, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: false,
    });
    if (uploaded.error) {
      // A lost success response is retried against the same immutable key and
      // surfaces as "already exists". Verify the object before calling the
      // tenant sync failed; the checksum path makes that recovery unambiguous.
      const verified = await db.storage.from('menu-images').list(directory, {
        limit: 1, search: `${checksum}.webp`,
      });
      if (verified.error || !(verified.data ?? []).some((object) => object.name === `${checksum}.webp`)) {
        throw uploaded.error;
      }
    }
  }
  // Register it, or onboarding breaks the release gate -- see storage-registry.
  await registerStorageAsset(db, {
    brandId, bucketId: 'menu-images', objectPath,
    originalFilename: `${itemSlug}.webp`, assetKind: 'menu_image',
    visibility: 'public', sourceType: 'menu_item', sourceKey: itemSlug,
    mimeType: 'image/webp', byteSize: bytes.length, checksumSha256: checksum,
  });

  // Register it, or onboarding breaks the release gate. See storage-registry:
  // an object with no `storage_assets` row makes the readiness head raise.
  await registerStorageAsset(db, {
    brandId, bucketId: 'menu-images', objectPath, sourceKey: itemSlug,
    originalFilename: `${itemSlug}.webp`, assetKind: 'menu_image',
    visibility: 'public', sourceType: 'menu_item', mimeType: 'image/webp',
    byteSize: bytes.length, checksumSha256: checksum,
  });

  const imageUrl = db.storage.from('menu-images').getPublicUrl(objectPath).data.publicUrl;
  const updated = await db.from('menu_items').update({ image_url: imageUrl })
    .eq('id', itemId).eq('brand_id', brandId);
  if (updated.error) throw updated.error;
  return true;
}
