export const TENANT_PACKAGE_LIMITS = Object.freeze({
  maximumFileBytes: 100 * 1024 * 1024,
  maximumReleaseBytes: 1024 * 1024 * 1024,
  maximumTextPreviewBytes: 1024 * 1024,
  maximumPreviewBytes: 10 * 1024 * 1024,
  resumableUploadThresholdBytes: 6 * 1024 * 1024,
  resumableChunkBytes: 6 * 1024 * 1024,
  signedUrlSeconds: 30,
});

export const TENANT_PACKAGE_BUCKET = 'tenant-packages';
export const TENANT_PACKAGE_EXCLUDED = new Set(['.DS_Store']);

export const DOWNLOAD_ONLY_EXTENSIONS = new Set([
  '.7z', '.avi', '.doc', '.docx', '.gz', '.mov', '.mp4', '.pdf', '.ppt',
  '.pptx', '.rar', '.svg', '.tar', '.xls', '.xlsx', '.zip',
]);

export const EXECUTABLE_EXTENSIONS = new Set([
  '.app', '.bat', '.bin', '.cmd', '.com', '.dll', '.dmg', '.exe', '.msi',
  '.pkg', '.ps1', '.sh',
]);
