'use server';

import { createHash, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { currentSession, hasRole } from '@/lib/auth';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import {
  isStorageAssetKind, recordStorageAsset, storageConfigFor, storagePathFor,
  validateStorageFile, type StorageAssetKind,
} from '@/lib/storage-library';
import { serverClient } from '@/lib/supabase-server';
import { ensurePlatformBrandMembership } from '@/lib/platform-membership';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

type Failure = { ok: false; error: string };
type ManagedStorageContext = {
  readonly brandId: string;
  readonly brandUserId: string;
  readonly client: SupabaseClient;
  readonly privileged: SupabaseClient;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_KINDS = new Set<StorageAssetKind>(['brand_image', 'document', 'design', 'attachment']);

export async function uploadStorageAsset(formData: FormData): Promise<Failure | { ok: true }> {
  const context = await managedStorageContext('storage.asset.upload');
  if (isFailure(context)) return context;
  const requestedKind = formData.get('kind');
  const kind = typeof requestedKind === 'string' && isStorageAssetKind(requestedKind) ? requestedKind : null;
  const file = formData.get('file');
  if (!kind || !UPLOAD_KINDS.has(kind)) return { ok: false, error: 'Choose a valid asset purpose.' };
  if (!(file instanceof File)) return { ok: false, error: 'Choose a file to upload.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateStorageFile(kind, file, bytes);
  if (!validated) return { ok: false, error: 'That file is not supported, is empty, or exceeds the 6 MB limit.' };
  const path = storagePathFor(context.brandId, kind, validated.extension, randomUUID());
  const config = storageConfigFor(kind);
  if (!await uploadObject(context.privileged, config.bucketId, path, bytes, validated.contentType)) {
    return { ok: false, error: 'The file could not be uploaded. Please try again.' };
  }
  const recorded = await recordStorageAsset(context.privileged, {
    assetKind: kind, brandId: context.brandId, byteSize: bytes.byteLength,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'), createdBy: context.brandUserId,
    metadata: { source: 'storage_library' }, mimeType: validated.contentType, objectPath: path,
    originalFilename: validated.originalFilename, sourceKey: null, sourceType: 'unassigned',
  });
  if (!recorded) {
    const removed = await removeObject(context.privileged, config.bucketId, path);
    console.error('storage asset registration failed after upload', {
      severity: 'error', bucket: config.bucketId, cleanupSucceeded: removed, kind,
    });
    return { ok: false, error: 'The file could not be recorded. No library entry was created.' };
  }
  revalidatePath('/storage');
  return { ok: true };
}

export async function storageAssetDownload(assetId: string): Promise<Failure | { ok: true; url: string }> {
  if (!UUID.test(assetId)) return { ok: false, error: 'This asset reference is invalid.' };
  const context = await managedStorageContext('storage.asset.download');
  if (isFailure(context)) return context;
  const asset = await context.client.from('storage_assets')
    .select('bucket_id, object_path, original_filename, visibility')
    .eq('id', assetId).eq('brand_id', context.brandId)
    .maybeSingle<{ bucket_id: string; object_path: string; original_filename: string; visibility: string }>();
  if (asset.error || !asset.data) return { ok: false, error: 'This asset is unavailable in the selected organization.' };
  if (asset.data.visibility === 'public') {
    return { ok: true, url: context.privileged.storage.from(asset.data.bucket_id).getPublicUrl(asset.data.object_path).data.publicUrl };
  }
  const signed = await context.privileged.storage.from(asset.data.bucket_id)
    .createSignedUrl(asset.data.object_path, 60, { download: asset.data.original_filename });
  if (signed.error || !signed.data?.signedUrl) return { ok: false, error: 'A secure download link could not be created. Try again.' };
  return { ok: true, url: signed.data.signedUrl };
}

async function managedStorageContext(action: string): Promise<ManagedStorageContext | Failure> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner') || !session.userId) {
    return { ok: false, error: 'Only a brand owner can manage storage.' };
  }
  const mutation = await authorizeWorkspaceMutation(session, { action });
  if (!mutation) return { ok: false, error: 'This organization storage change was not authorized.' };
  const client = await serverClient();
  const env = serverEnv();
  if (!client || !env) return { ok: false, error: 'Supabase is not configured for this deployment.' };
  const privileged = serviceDb(env);
  let brandUserId: string | null = null;
  if (mutation.serviceRole) {
    brandUserId = await ensurePlatformBrandMembership(privileged, session.userId, mutation.brandId);
  } else {
    const membership = await client.from('brand_users').select('id, role')
      .eq('brand_id', mutation.brandId).eq('user_id', session.userId)
      .single<{ id: string; role: string }>();
    if (!membership.error && ['brand_owner', 'platform_admin'].includes(membership.data.role)) brandUserId = membership.data.id;
  }
  if (!brandUserId) return { ok: false, error: 'Your organization owner access is no longer active.' };
  return { brandId: mutation.brandId, brandUserId, client, privileged };
}

function isFailure(value: ManagedStorageContext | Failure): value is Failure {
  return 'ok' in value;
}

async function uploadObject(client: SupabaseClient, bucket: string, path: string, body: Buffer, contentType: string): Promise<boolean> {
  const separator = path.lastIndexOf('/');
  const directory = path.slice(0, separator);
  const filename = path.slice(separator + 1);
  const exists = async () => {
    const listed = await client.storage.from(bucket).list(directory, { limit: 1, search: filename });
    return !listed.error && (listed.data ?? []).some((object) => object.name === filename);
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await client.storage.from(bucket).upload(path, body, { contentType, cacheControl: '31536000', upsert: false });
    if (!result.error || await exists()) return true;
  }
  return false;
}

async function removeObject(client: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await client.storage.from(bucket).remove([path]);
    if (!result.error) return true;
  }
  return false;
}
