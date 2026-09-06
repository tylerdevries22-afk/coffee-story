export type TenantPreviewKind = 'text' | 'raster' | 'download';

export type TenantPackageFile = {
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly pathKey: string;
  readonly contentSha256: `sha256:${string}`;
  readonly crc32: number;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly previewKind: TenantPreviewKind;
  readonly preview?: TenantPackagePreview;
};

export type TenantPackagePreview = {
  readonly sourcePath: string;
  readonly contentSha256: `sha256:${string}`;
  readonly mimeType: 'image/png';
  readonly byteSize: number;
};

export type TenantPackageManifestFile = Omit<TenantPackageFile, 'sourcePath' | 'crc32' | 'preview'> & {
  readonly objectPath: string;
  readonly previewObjectPath?: string;
  readonly previewContentSha256?: `sha256:${string}`;
  readonly previewMimeType?: 'image/png';
  readonly previewByteSize?: number;
};

export type TenantPackageBuild = {
  readonly tenantSlug: string;
  readonly releaseKey: string;
  readonly commitSha: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly envelopeSha256: `sha256:${string}`;
  readonly archiveSha256: `sha256:${string}`;
  readonly archivePath: string;
  readonly files: readonly TenantPackageFile[];
  readonly fileCount: number;
  readonly totalBytes: number;
};

export class TenantPackageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TenantPackageError';
  }
}
