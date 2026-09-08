import { stat } from 'node:fs/promises';

import { requestWithRetry, safeEndpoint, serviceHeaders } from './http';
import { TenantPackageStorageClient } from './storage-client';
import type { TenantPackageBuild, TenantPackageManifestFile } from './types';

export type TenantPackagePublication = {
  readonly releaseId: string;
  readonly archiveObjectPath: string;
  readonly files: readonly TenantPackageManifestFile[];
};

export async function publishTenantPackageObjects(input: {
  endpoint: string;
  serviceKey: string;
  brandId: string;
  build: TenantPackageBuild;
}): Promise<TenantPackagePublication> {
  const digest = input.build.artifactDigest.slice('sha256:'.length);
  const prefix = `${input.brandId}/${digest}`;
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
  const storage = new TenantPackageStorageClient(input.endpoint, input.serviceKey);
  await uploadFiles(storage, input.build, files);
  const archiveSize = (await stat(input.build.archivePath)).size;
  await storage.upload({
    path: input.build.archivePath, objectPath: archiveObjectPath,
    byteSize: archiveSize, mimeType: 'application/zip',
  });
  await storage.verify(archiveObjectPath, archiveSize, input.build.archiveSha256);
  const response = await requestWithRetry(
    new URL('/rest/v1/rpc/stage_tenant_package', safeEndpoint(input.endpoint)),
    {
      method: 'POST', headers: { ...serviceHeaders(input.serviceKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        p_brand_id: input.brandId, p_release_key: input.build.releaseKey,
        p_artifact_digest: input.build.artifactDigest, p_commit_sha: input.build.commitSha,
        p_envelope_sha256: input.build.envelopeSha256,
        p_archive_sha256: input.build.archiveSha256, p_archive_object_path: archiveObjectPath,
        p_file_count: input.build.fileCount, p_total_bytes: input.build.totalBytes, p_files: files,
      }),
    },
  );
  const releaseId = await response.json() as unknown;
  if (typeof releaseId !== 'string') throw new Error('Supabase returned an invalid tenant release.');
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
