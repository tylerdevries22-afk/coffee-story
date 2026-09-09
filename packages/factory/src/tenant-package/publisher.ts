import { stat } from 'node:fs/promises';

import { requestWithRetry, safeEndpoint, serviceHeaders } from './http';
import { TenantPackageStorageClient } from './storage-client';
import type { TenantPackageBuild, TenantPackageManifestFile } from './types';

export type TenantPackagePublication = {
  readonly releaseId: string;
  readonly archiveObjectPath: string;
  readonly files: readonly TenantPackageManifestFile[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function rpc(
  endpoint: URL,
  serviceKey: string,
  name: string,
  body: unknown,
): Promise<unknown> {
  const response = await requestWithRetry(new URL(`/rest/v1/rpc/${name}`, endpoint), {
    method: 'POST',
    headers: { ...serviceHeaders(serviceKey), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<unknown>;
}

export function tenantPackageObjectPrefix(
  brandId: string,
  artifactDigest: string,
  envelopeSha256: string,
): string {
  if (!UUID.test(brandId)
    || !/^sha256:[0-9a-f]{64}$/.test(artifactDigest)
    || !/^sha256:[0-9a-f]{64}$/.test(envelopeSha256)) {
    throw new Error('Tenant package object identity is invalid.');
  }
  return `${brandId}/${artifactDigest.slice(7)}/${envelopeSha256.slice(7)}`;
}

export async function publishTenantPackageObjects(input: {
  endpoint: string;
  serviceKey: string;
  brandId: string;
  build: TenantPackageBuild;
}): Promise<TenantPackagePublication> {
  const prefix = tenantPackageObjectPrefix(
    input.brandId,
    input.build.artifactDigest,
    input.build.envelopeSha256,
  );
  const archiveObjectPath = `${prefix}/archive.zip`;
  const files = input.build.files.map((file) => ({
    relativePath: file.relativePath,
    pathKey: file.pathKey,
    contentSha256: file.contentSha256,
    mimeType: file.mimeType,
    byteSize: file.byteSize,
    previewKind: file.previewKind,
    objectPath: `${prefix}/files/${file.pathKey}`,
    ...(file.preview ? {
      previewObjectPath: `${prefix}/previews/${file.pathKey}.png`,
      previewContentSha256: file.preview.contentSha256,
      previewMimeType: file.preview.mimeType,
      previewByteSize: file.preview.byteSize,
    } : {}),
  }));
  const endpoint = safeEndpoint(input.endpoint);
  const sessionId = await rpc(endpoint, input.serviceKey, 'begin_tenant_package_upload', {
    p_brand_id: input.brandId,
    p_release_key: input.build.releaseKey,
    p_artifact_digest: input.build.artifactDigest,
    p_commit_sha: input.build.commitSha,
    p_envelope_sha256: input.build.envelopeSha256,
    p_archive_sha256: input.build.archiveSha256,
    p_object_prefix: prefix,
    p_file_count: input.build.fileCount,
    p_total_bytes: input.build.totalBytes,
  });
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    throw new Error('Supabase returned an invalid tenant upload session.');
  }
  const storage = new TenantPackageStorageClient(input.endpoint, input.serviceKey, async () => {
    await rpc(endpoint, input.serviceKey, 'renew_tenant_package_upload', {
      p_session_id: sessionId,
    });
  });
  await uploadFiles(storage, input.build, files);
  const archiveSize = (await stat(input.build.archivePath)).size;
  await storage.upload({
    path: input.build.archivePath, objectPath: archiveObjectPath,
    byteSize: archiveSize, mimeType: 'application/zip',
  });
  await storage.verify(archiveObjectPath, archiveSize, input.build.archiveSha256);
  const releaseId = await rpc(endpoint, input.serviceKey, 'stage_tenant_package', {
    p_brand_id: input.brandId, p_release_key: input.build.releaseKey,
    p_artifact_digest: input.build.artifactDigest, p_commit_sha: input.build.commitSha,
    p_envelope_sha256: input.build.envelopeSha256,
    p_archive_sha256: input.build.archiveSha256, p_archive_object_path: archiveObjectPath,
    p_file_count: input.build.fileCount, p_total_bytes: input.build.totalBytes,
    p_files: files, p_upload_session_id: sessionId,
  });
  if (typeof releaseId !== 'string' || !UUID.test(releaseId)) {
    throw new Error('Supabase returned an invalid tenant release.');
  }
  return { releaseId, archiveObjectPath, files };
}

async function uploadFiles(
  storage: TenantPackageStorageClient,
  build: TenantPackageBuild,
  manifest: readonly TenantPackageManifestFile[],
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(4, build.files.length) }, async () => {
    while (next < build.files.length) {
      const index = next;
      next += 1;
      const file = build.files[index];
      const item = manifest[index];
      if (!file || !item) throw new Error('Tenant package manifest is inconsistent.');
      await storage.upload({
        path: file.sourcePath, objectPath: item.objectPath,
        byteSize: file.byteSize, mimeType: file.mimeType,
      });
      await storage.verify(item.objectPath, file.byteSize, file.contentSha256);
      if (file.preview && item.previewObjectPath) {
        await storage.upload({
          path: file.preview.sourcePath, objectPath: item.previewObjectPath,
          byteSize: file.preview.byteSize, mimeType: file.preview.mimeType,
        });
        await storage.verify(
          item.previewObjectPath,
          file.preview.byteSize,
          file.preview.contentSha256,
        );
      }
    }
  });
  await Promise.all(workers);
}
