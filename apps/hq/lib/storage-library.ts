import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_STORAGE_FILE_BYTES = 6_000_000;

const STORAGE_KINDS = ['menu_image', 'brand_image', 'training_media', 'document', 'design', 'attachment'] as const;
export type StorageAssetKind = typeof STORAGE_KINDS[number];
export type StorageBucketId = 'menu-images' | 'brand-assets' | 'training-media' | 'content-files';
export type StorageVisibility = 'public' | 'private';
export type StorageSource = 'menu_item' | 'catalog_folder' | 'catalog_resource' | 'training_module' | 'training_lesson' | 'unassigned';

export type StorageAssetConfig = {
  readonly bucketId: StorageBucketId;
  readonly label: string;
  readonly visibility: StorageVisibility;
};

const CONFIG: Record<StorageAssetKind, StorageAssetConfig> = {
  menu_image: { bucketId: 'menu-images', label: 'Menu image', visibility: 'public' },
  brand_image: { bucketId: 'brand-assets', label: 'Brand image', visibility: 'public' },
  training_media: { bucketId: 'training-media', label: 'Training media', visibility: 'public' },
  document: { bucketId: 'content-files', label: 'Document', visibility: 'private' },
  design: { bucketId: 'content-files', label: 'Design source', visibility: 'private' },
  attachment: { bucketId: 'content-files', label: 'Attachment', visibility: 'private' },
};

const FILE_TYPES: Record<string, string> = {
  ai: 'application/postscript', csv: 'text/csv', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  eps: 'application/postscript', fig: 'application/octet-stream', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', pdf: 'application/pdf', png: 'image/png', psd: 'image/vnd.adobe.photoshop',
  sketch: 'application/octet-stream', svg: 'image/svg+xml', txt: 'text/plain',
  webp: 'image/webp', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const PRIVATE_EXTENSIONS = new Set(['ai', 'csv', 'doc', 'docx', 'eps', 'fig', 'jpg', 'jpeg', 'pdf', 'png', 'psd', 'ppt', 'pptx', 'sketch', 'svg', 'txt', 'webp', 'xls', 'xlsx', 'zip']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export type ValidatedStorageFile = { readonly contentType: string; readonly extension: string; readonly originalFilename: string };

export type StorageAssetRecord = {
  readonly assetKind: StorageAssetKind;
  readonly brandId: string;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
  readonly createdBy: string | null;
  readonly metadata: Record<string, string>;
  readonly mimeType: string;
  readonly objectPath: string;
  readonly originalFilename: string;
  readonly sourceKey: string | null;
  readonly sourceType: StorageSource;
};

export function storageConfigFor(kind: StorageAssetKind): StorageAssetConfig {
  return CONFIG[kind];
}

export function isStorageAssetKind(value: string): value is StorageAssetKind {
  return STORAGE_KINDS.includes(value as StorageAssetKind);
}

export function extensionOf(filename: string): string | null {
  const extension = filename.trim().toLowerCase().split('.').pop() ?? '';
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : null;
}

export function validateStorageFile(kind: StorageAssetKind, file: File, bytes: Uint8Array): ValidatedStorageFile | null {
  if (file.size <= 0 || file.size > MAX_STORAGE_FILE_BYTES) return null;
  const extension = extensionOf(file.name);
  if (!extension) return null;
  const isImage = IMAGE_EXTENSIONS.has(extension);
  if (kind === 'brand_image' && (!isImage || !hasImageSignature(extension, bytes))) return null;
  if (kind !== 'brand_image' && kind !== 'menu_image' && kind !== 'training_media' && !PRIVATE_EXTENSIONS.has(extension)) return null;
  if (kind !== 'brand_image' && isImage && !hasImageSignature(extension, bytes)) return null;
  if (extension === 'pdf' && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return null;
  const contentType = FILE_TYPES[extension];
  if (!contentType) return null;
  return { contentType, extension, originalFilename: safeOriginalFilename(file.name, extension) };
}

export function storagePathFor(brandId: string, kind: StorageAssetKind, extension: string, assetId: string): string {
  const bucket = storageConfigFor(kind).bucketId;
  const lane = bucket === 'content-files' ? kind : 'published';
  return `${brandId}/${lane}/${assetId}.${extension}`;
}

export function sourceForContentUpload(scope: string, entityKey: string): { sourceKey: string | null; sourceType: StorageSource } {
  const sourceType = ({
    'catalog-folder': 'catalog_folder', 'catalog-resource': 'catalog_resource',
    'menu-item': 'menu_item', 'training-module': 'training_module', 'training-lesson': 'training_lesson',
  } as Record<string, StorageSource>)[scope] ?? 'unassigned';
  const sourceKey = entityKey.trim();
  return { sourceType, sourceKey: sourceType === 'unassigned' || !sourceKey ? null : sourceKey.slice(0, 180) };
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 100_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export async function recordStorageAsset(client: SupabaseClient, asset: StorageAssetRecord): Promise<boolean> {
  const config = storageConfigFor(asset.assetKind);
  const result = await client.from('storage_assets').insert({
    asset_kind: asset.assetKind, brand_id: asset.brandId, bucket_id: config.bucketId,
    byte_size: asset.byteSize, checksum_sha256: asset.checksumSha256, created_by: asset.createdBy,
    metadata: asset.metadata, mime_type: asset.mimeType, object_path: asset.objectPath,
    original_filename: asset.originalFilename, source_key: asset.sourceKey, source_type: asset.sourceType,
    visibility: config.visibility,
  });
  return !result.error;
}

export function safeOriginalFilename(value: string, extension: string): string {
  const printable = Array.from(value.normalize('NFKC')).filter((character) => character.charCodeAt(0) >= 32).join('');
  const base = printable.replace(/[<>:"/\\|?*]+/g, '-').trim().slice(0, 240);
  return base || `upload.${extension}`;
}

function hasImageSignature(extension: string, bytes: Uint8Array): boolean {
  if (extension === 'jpg' || extension === 'jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (extension === 'png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
