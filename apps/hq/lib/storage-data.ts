import 'server-only';

import { currentSession, hasRole } from './auth';
import { formatStorageBytes, type StorageAssetKind, type StorageBucketId, type StorageSource, type StorageVisibility } from './storage-library';
import { serverClient } from './supabase-server';
import { selectedOrganizationId } from './workspace-scope';

type StorageAssetRow = {
  id: string;
  bucket_id: StorageBucketId;
  original_filename: string;
  asset_kind: StorageAssetKind;
  visibility: StorageVisibility;
  source_type: StorageSource;
  source_key: string | null;
  mime_type: string;
  byte_size: number | string;
  created_at: string;
};

export type StorageAssetView = {
  readonly id: string;
  readonly bucketId: StorageBucketId;
  readonly byteLabel: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly kind: StorageAssetKind;
  readonly mimeType: string;
  readonly originalFilename: string;
  readonly sourceKey: string | null;
  readonly sourceType: StorageSource;
  readonly visibility: StorageVisibility;
};

export type StorageBucketView = {
  readonly assetCount: number;
  readonly bucketId: StorageBucketId;
  readonly byteLabel: string;
  readonly label: string;
  readonly visibility: StorageVisibility;
};

export type StorageWorkspaceData = {
  readonly assets: readonly StorageAssetView[];
  readonly buckets: readonly StorageBucketView[];
  readonly connection: 'ready' | 'unavailable' | 'unauthorized';
  readonly totalBytes: number;
};

const BUCKETS: ReadonlyArray<{ bucketId: StorageBucketId; label: string; visibility: StorageVisibility }> = [
  { bucketId: 'menu-images', label: 'Menu imagery', visibility: 'public' },
  { bucketId: 'training-media', label: 'Training media', visibility: 'public' },
  { bucketId: 'brand-assets', label: 'Brand assets', visibility: 'public' },
  { bucketId: 'content-files', label: 'Private files', visibility: 'private' },
];

export async function loadStorageWorkspace(): Promise<StorageWorkspaceData> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) return emptyWorkspace('unauthorized');
  const client = await serverClient();
  if (!client) return emptyWorkspace('unavailable');
  const brandId = await selectedOrganizationId(session);
  const result = await client.from('storage_assets')
    .select('id, bucket_id, original_filename, asset_kind, visibility, source_type, source_key, mime_type, byte_size, created_at')
    .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(500)
    .returns<StorageAssetRow[]>();
  if (result.error) return emptyWorkspace('unavailable');
  const assets = (result.data ?? []).map((row) => {
    const byteSize = Number(row.byte_size);
    return {
      id: row.id, bucketId: row.bucket_id, byteLabel: formatStorageBytes(byteSize), byteSize,
      createdAt: row.created_at, kind: row.asset_kind, mimeType: row.mime_type,
      originalFilename: row.original_filename, sourceKey: row.source_key,
      sourceType: row.source_type, visibility: row.visibility,
    } satisfies StorageAssetView;
  });
  const totalBytes = assets.reduce((total, asset) => total + asset.byteSize, 0);
  return {
    assets,
    buckets: BUCKETS.map((bucket) => {
      const bucketAssets = assets.filter((asset) => asset.bucketId === bucket.bucketId);
      return {
        ...bucket,
        assetCount: bucketAssets.length,
        byteLabel: formatStorageBytes(bucketAssets.reduce((total, asset) => total + asset.byteSize, 0)),
      };
    }),
    connection: 'ready',
    totalBytes,
  };
}

function emptyWorkspace(connection: StorageWorkspaceData['connection']): StorageWorkspaceData {
  return { assets: [], buckets: BUCKETS.map((bucket) => ({ ...bucket, assetCount: 0, byteLabel: '0 B' })), connection, totalBytes: 0 };
}
