import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Register an object in the storage asset library.
 *
 * `app.platform_release_readiness_20260901060005()` raises `one or more storage
 * objects are missing a registry record` when anything in `menu-images`,
 * `training-media`, `brand-assets` or `content-files` has no matching
 * `public.storage_assets` row. It is a release-gate assertion, not an upload
 * check, so an unregistered object does not fail the write -- it fails the
 * *release*, later, pointing at storage rather than at whatever put the object
 * there.
 *
 * Every script that uploads into one of those buckets therefore has to write
 * this row in the same step. Until this helper existed, none of them did: the
 * HQ console was the only writer anyone had added, so `pnpm onboard` and the
 * training seed both left unregistered objects behind. For a franchise platform
 * that is the worst shape available -- onboarding a new location is what breaks
 * the release, and it breaks it after the upload has already succeeded.
 *
 * Idempotent on the table's own `unique (bucket_id, object_path)`. Callers key
 * their object paths by content checksum, so a re-run targets the same key and
 * the conflict is the expected outcome rather than an error.
 */
export interface StorageAssetRecord {
  readonly brandId: string;
  readonly bucketId: 'menu-images' | 'training-media' | 'brand-assets' | 'content-files';
  readonly objectPath: string;
  readonly originalFilename: string;
  /** Constrained with bucketId by a CHECK: menu-images pairs with menu_image, and so on. */
  readonly assetKind: 'menu_image' | 'brand_image' | 'training_media' | 'document' | 'design' | 'attachment';
  readonly visibility: 'public' | 'private';
  readonly sourceType: 'menu_item' | 'catalog_folder' | 'catalog_resource'
    | 'training_module' | 'training_lesson' | 'unassigned';
  readonly sourceKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
}

/**
 * `created_by` is deliberately left null: these callers run as scripts holding
 * the service key, not as a `brand_users` member, and the column's composite FK
 * would reject an id that is not one.
 */
export async function registerStorageAsset(
  db: SupabaseClient,
  record: StorageAssetRecord,
): Promise<void> {
  const registered = await db.from('storage_assets').upsert({
    brand_id: record.brandId,
    bucket_id: record.bucketId,
    object_path: record.objectPath,
    original_filename: record.originalFilename,
    asset_kind: record.assetKind,
    visibility: record.visibility,
    source_type: record.sourceType,
    // The column caps at 180 characters; a slug that long is already a problem
    // elsewhere, but truncating here keeps a long one from failing the release.
    source_key: record.sourceKey.slice(0, 180),
    mime_type: record.mimeType,
    byte_size: record.byteSize,
    checksum_sha256: record.checksumSha256,
  }, { onConflict: 'bucket_id,object_path', ignoreDuplicates: true });
  if (registered.error) {
    throw new Error(
      `Could not register ${record.bucketId}/${record.objectPath}: ${registered.error.message}`,
    );
  }
}
