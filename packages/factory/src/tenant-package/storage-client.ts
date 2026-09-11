import { open } from 'node:fs/promises';

import { TENANT_PACKAGE_BUCKET, TENANT_PACKAGE_LIMITS } from './constants';
import {
  discardResponse, encodeObjectPath, requestWithRetry, safeEndpoint, serviceHeaders,
} from './http';
import {
  verifyStoredObject, type VerificationOptions,
} from './storage-verification';
import { TenantPackageError } from './types';

type Upload = { path: string; objectPath: string; byteSize: number; mimeType: string };
type BeforeMutation = () => Promise<void>;

export { verificationDeadlineMs } from './storage-verification';
export type { VerificationOptions } from './storage-verification';
function metadata(upload: Upload): string {
  return [
    ['bucketName', TENANT_PACKAGE_BUCKET], ['objectName', upload.objectPath],
    ['contentType', upload.mimeType], ['cacheControl', '31536000'],
  ].map(([key, value]) => `${key} ${Buffer.from(value ?? '').toString('base64')}`).join(',');
}

function resumableUploadUrl(location: string, endpoint: URL): URL {
  let uploadUrl: URL;
  try {
    uploadUrl = new URL(location, endpoint);
  } catch {
    throw new TenantPackageError(
      'resumable_origin_invalid',
      'Resumable upload returned an unsafe location.',
    );
  }
  if (uploadUrl.origin !== endpoint.origin) {
    throw new TenantPackageError(
      'resumable_origin_invalid',
      'Resumable upload returned an unsafe location.',
    );
  }
  return uploadUrl;
}

export class TenantPackageStorageClient {
  private readonly endpoint: URL;
  private readonly headers: Record<string, string>;

  constructor(
    endpoint: string,
    serviceKey: string,
    private readonly beforeMutation: BeforeMutation = async () => undefined,
    private readonly verification: VerificationOptions = {},
  ) {
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
    await verifyStoredObject({
      url: this.objectUrl(objectPath), headers: this.headers,
      beforeMutation: this.beforeMutation, objectSize: size, digest,
      options: this.verification,
    });
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
      await this.beforeMutation();
      const response = await requestWithRetry(this.objectUrl(input.objectPath), {
        method: 'POST', body,
        headers: { ...this.headers, 'content-type': input.mimeType, 'x-upsert': 'false' },
      }, [200, 201, 409]);
      await discardResponse(response);
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
    await this.beforeMutation();
    const created = await requestWithRetry(endpoint, {
      method: 'POST', headers: {
        ...this.headers, 'tus-resumable': '1.0.0', 'upload-length': String(input.byteSize),
        'upload-metadata': metadata(input), 'x-upsert': 'false',
      },
    }, [201, 409]);
    const location = created.headers.get('location');
    await discardResponse(created);
    if (!location) {
      if (created.status === 409) return;
      throw new TenantPackageError('resumable_create_failed', 'Resumable upload was not created.');
    }
    await this.writeChunks(resumableUploadUrl(location, endpoint), input);
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
        await this.beforeMutation();
        const response = await requestWithRetry(uploadUrl, {
          method: 'PATCH', body: chunk, headers: {
            ...this.headers, 'content-type': 'application/offset+octet-stream',
            'tus-resumable': '1.0.0', 'upload-offset': String(offset),
          },
        }, [204, 409]);
        const offsetHeader = response.headers.get('upload-offset');
        await discardResponse(response);
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
    const offset = Number(response.headers.get('upload-offset'));
    await discardResponse(response);
    return offset;
  }
}
