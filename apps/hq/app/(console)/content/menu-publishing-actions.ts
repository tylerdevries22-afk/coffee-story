'use server';

import { createHash, randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { imageExtensionFor } from '@/lib/content-model';
import {
  recordStorageAsset,
  safeOriginalFilename,
  sourceForContentUpload,
} from '@/lib/storage-library';

import {
  UUID,
  isFailure,
  managerContext,
  retryWrite,
  uploadVersionedImage,
  type Failure,
} from './actions-shared';

export async function setMenuPublished(
  menuId: string,
  published: boolean,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; updatedAt: string; publishedVersion: number | null; persisted: boolean }> {
  const context = await managerContext('content.menu.publish');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, updatedAt: new Date().toISOString(), publishedVersion: 1, persisted: false };
  if (!UUID.test(menuId) || !expectedUpdatedAt) return { ok: false, error: 'Reload the menu before publishing.' };
  if (!published) return { ok: false, error: 'Published catalog releases are replaced by a newer release instead of being removed.' };
  const catalog = await context.client.from('catalogs').select('draft_version')
    .eq('id', menuId).eq('brand_id', context.brandId).single<{ draft_version: number }>();
  if (catalog.error) return { ok: false, error: 'The catalog draft could not be loaded.' };
  const release = await retryWrite(() => context.client.rpc('publish_catalog_draft', {
    target_catalog: menuId, expected_draft_version: catalog.data.draft_version,
  }).single<{ version: number }>());
  if (release.error || !release.data) return { ok: false, error: 'The catalog could not be published. Resolve validation issues and try again.' };
  const result = await retryWrite(() => {
    let query = context.client.from('menus').update({ is_published: published })
      .eq('id', menuId).eq('brand_id', context.brandId);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
    return query.select('updated_at').maybeSingle<{ updated_at: string }>();
  });
  if (result.error || !result.data) {
    return { ok: false, error: result.error ? 'The menu could not be published.' : 'The menu changed in another session. Reload first.' };
  }
  revalidatePath('/catalog');
  revalidatePath('/content');
  return { ok: true, persisted: true, updatedAt: result.data.updated_at, publishedVersion: release.data.version };
}
export async function uploadContentImage(
  formData: FormData,
): Promise<Failure | { ok: true; url: string; persisted: boolean }> {
  const context = await managerContext('content.image.upload');
  if (isFailure(context)) return context;
  const file = formData.get('file');
  const family = formData.get('family') === 'training' ? 'training' : 'menu';
  const scope = typeof formData.get('scope') === 'string' ? String(formData.get('scope')) : family;
  const entityKey = typeof formData.get('entityKey') === 'string' ? String(formData.get('entityKey')) : 'unassigned';
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image to upload.' };
  if (file.size <= 0 || file.size > 6_000_000) return { ok: false, error: 'Images must be smaller than 6 MB.' };
  const body = Buffer.from(await file.arrayBuffer());
  const extension = imageExtensionFor(file.type, body);
  if (!extension) return { ok: false, error: 'The file contents must be a valid JPEG, PNG, or WebP image.' };
  // The client already owns a blob URL for preview; do not serialize megabytes
  // of image data back through a server-action response in demo mode.
  if (!context) return { ok: true, persisted: false, url: '' };
  const bucket = family === 'training' ? 'training-media' : 'menu-images';
  const safeScope = scope.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || family;
  const safeEntity = entityKey.replace(/[^a-z0-9/-]+/gi, '-').replace(/^\/+|\/+$/g, '').slice(0, 180) || 'unassigned';
  const path = `${context.brandId}/${safeScope}/${safeEntity}/${randomUUID()}.${extension}`;
  if (!await uploadVersionedImage(context, bucket, path, body, file.type)) {
    return { ok: false, error: 'The image could not be uploaded. Try a smaller file.' };
  }
  const source = sourceForContentUpload(scope, entityKey);
  const recorded = await recordStorageAsset(context.privileged, {
    assetKind: family === 'training' ? 'training_media' : 'menu_image',
    brandId: context.brandId,
    byteSize: body.byteLength,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    createdBy: context.brandUserId,
    metadata: { source: 'content_upload' },
    mimeType: file.type,
    objectPath: path,
    originalFilename: safeOriginalFilename(file.name, extension),
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
  });
  if (!recorded) {
    const remove = () => context.privileged.storage.from(bucket).remove([path]);
    const firstRemoval = await remove();
    if (firstRemoval.error) await remove();
    console.error('storage asset registration failed after content upload', {
      severity: 'error', bucket, family, sourceType: source.sourceType,
    });
    return { ok: false, error: 'The image could not be recorded. Please try the upload again.' };
  }
  const publicUrl = context.privileged.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  return { ok: true, persisted: true, url: publicUrl };
}
