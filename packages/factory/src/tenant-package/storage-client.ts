import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { TENANT_PACKAGE_BUCKET, TENANT_PACKAGE_LIMITS } from './constants';
import { encodeObjectPath, requestWithRetry, safeEndpoint, serviceHeaders } from './http';
import { TenantPackageError } from './types';

type Upload = { path: string; objectPath: string; byteSize: number; mimeType: string };

function metadata(upload: Upload): string {
  return [
    ['bucketName', TENANT_PACKAGE_BUCKET], ['objectName', upload.objectPath],
    ['contentType', upload.mimeType], ['cacheControl', '31536000'],
  ].map(([key, value]) => `${key} ${Buffer.from(value ?? '').toString('base64')}`).join(',');
}

export class TenantPackageStorageClient {
  private readonly endpoint: URL;
  private readonly headers: Record<string, string>;

  constructor(endpoint: string, serviceKey: string) {
    this.endpoint = safeEndpoint(endpoint);
    this.headers = serviceHeaders(serviceKey);
  }

  async upload(input: Upload): Promise<void> {
    if (input.byteSize > TENANT_PACKAGE_LIMITS.resumableUploadThresholdBytes) {
      await this.uploadResumable(input);
    } else {
      await this.uploadStandard(input);
    }
  }

  async verify(objectPath: string, size: number, digest: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hash = createHash('sha256');
      let received = 0;
      try {
        const response = await requestWithRetry(this.objectUrl(objectPath), { headers: this.headers });
        if (!response.body) throw new Error('missing_body');
        for await (const chunk of Readable.fromWeb(response.body)) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += bytes.length;
          hash.update(bytes);
        }
        if (received === size && `sha256:${hash.digest('hex')}` === digest) return;
      } catch {
        // A fresh download and hash receives the next bounded attempt.
      }
    }
    throw new TenantPackageError('object_verification_failed', 'Uploaded tenant object failed verification.');
  }

  private objectUrl(objectPath: string): URL {
    return new URL(`/storage/v1/object/${TENANT_PACKAGE_BUCKET}/${encodeObjectPath(objectPath)}`, this.endpoint);
  }

  private async uploadStandard(input: Upload): Promise<void> {
    const handle = await open(input.path, 'r');
    try {
      const body = Buffer.alloc(input.byteSize);
      const read = await handle.read(body, 0, body.length, 0);
      if (read.bytesRead !== input.byteSize) throw new TenantPackageError('file_changed', 'Upload source changed.');
      await requestWithRetry(this.objectUrl(input.objectPath), {
        method: 'POST', body,
        headers: { ...this.headers, 'content-type': input.mimeType, 'x-upsert': 'false' },
      }, [200, 201, 409]);
    } finally {
      await handle.close();
    }
  }

  private resumableEndpoint(): URL {
    const direct = new URL(this.endpoint);
    if (direct.hostname.endsWith('.supabase.co')) {
      direct.hostname = direct.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
    }
    direct.pathname = '/storage/v1/upload/resumable';
    return direct;
  }

  private async uploadResumable(input: Upload): Promise<void> {
    const endpoint = this.resumableEndpoint();
    const created = await requestWithRetry(endpoint, {
      method: 'POST', headers: {
        ...this.headers, 'tus-resumable': '1.0.0', 'upload-length': String(input.byteSize),
        'upload-metadata': metadata(input), 'x-upsert': 'false',
      },
    }, [201, 409]);
    const location = created.headers.get('location');
    if (!location) {
      if (created.status === 409) return;
      throw new TenantPackageError('resumable_create_failed', 'Resumable upload was not created.');
    }
    const uploadUrl = new URL(location, endpoint);
    if (uploadUrl.origin !== endpoint.origin) {
      throw new TenantPackageError('resumable_origin_invalid', 'Resumable upload returned an unsafe location.');
    }
    await this.writeChunks(uploadUrl, input);
  }

  private async writeChunks(uploadUrl: URL, input: Upload): Promise<void> {
    const handle = await open(input.path, 'r');
    let offset = 0;
    try {
      while (offset < input.byteSize) {
        const length = Math.min(TENANT_PACKAGE_LIMITS.resumableChunkBytes, input.byteSize - offset);
        const chunk = Buffer.allocUnsafe(length);
        const read = await handle.read(chunk, 0, length, offset);
        if (read.bytesRead !== length) throw new TenantPackageError('file_changed', 'Upload source changed.');
        const response = await requestWithRetry(uploadUrl, {
          method: 'PATCH', body: chunk, headers: {
            ...this.headers, 'content-type': 'application/offset+octet-stream',
            'tus-resumable': '1.0.0', 'upload-offset': String(offset),
          },
        }, [204, 409]);
        const offsetHeader = response.headers.get('upload-offset');
        const next = response.status === 204 && offsetHeader !== null
          ? Number(offsetHeader)
          : await this.remoteOffset(uploadUrl);
        if (!Number.isSafeInteger(next) || next !== offset + length) {
          throw new TenantPackageError('resumable_offset_invalid', 'Resumable upload offset is invalid.');
        }
        offset = next;
      }
    } finally {
      await handle.close();
    }
  }

  private async remoteOffset(uploadUrl: URL): Promise<number> {
    const response = await requestWithRetry(uploadUrl, {
      method: 'HEAD', headers: { ...this.headers, 'tus-resumable': '1.0.0' },
    }, [200, 204]);
    return Number(response.headers.get('upload-offset'));
  }
}
