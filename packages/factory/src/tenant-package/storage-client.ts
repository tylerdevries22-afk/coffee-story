import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import { TENANT_PACKAGE_BUCKET, TENANT_PACKAGE_LIMITS } from './constants';
import { encodeObjectPath, requestWithRetry, safeEndpoint, serviceHeaders } from './http';
import { TenantPackageError } from './types';

type Upload = { path: string; objectPath: string; byteSize: number; mimeType: string };
type BeforeMutation = () => Promise<void>;
type VerificationOptions = {
  heartbeatMs?: number;
  inactivityMs?: number;
  totalMs?: (size: number) => number;
};
const MIB = 1024 * 1024;
const VERIFY_INACTIVITY_MS = 30_000, VERIFY_HEARTBEAT_MS = 5 * 60_000;
export function verificationDeadlineMs(size: number): number {
  return Math.min(30 * 60_000, 60_000 + Math.ceil(size / MIB) * 2_000);
}
async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  inactivityMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('verification_inactive')), inactivityMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function metadata(upload: Upload): string {
  return [
    ['bucketName', TENANT_PACKAGE_BUCKET], ['objectName', upload.objectPath],
    ['contentType', upload.mimeType], ['cacheControl', '31536000'],
  ].map(([key, value]) => `${key} ${Buffer.from(value ?? '').toString('base64')}`).join(',');
}

export class TenantPackageStorageClient {
  private readonly endpoint: URL;
  private readonly headers: Record<string, string>;
  private readonly verificationInactivityMs: number;
  private readonly verificationHeartbeatMs: number;
  private readonly totalVerificationMs: (size: number) => number;

  constructor(
    endpoint: string,
    serviceKey: string,
    private readonly beforeMutation: BeforeMutation = async () => undefined,
    verification: VerificationOptions = {},
  ) {
    this.endpoint = safeEndpoint(endpoint);
    this.headers = serviceHeaders(serviceKey);
    this.verificationHeartbeatMs = verification.heartbeatMs ?? VERIFY_HEARTBEAT_MS;
    this.verificationInactivityMs = verification.inactivityMs ?? VERIFY_INACTIVITY_MS;
    this.totalVerificationMs = verification.totalMs ?? verificationDeadlineMs;
  }
  async upload(input: Upload): Promise<void> {
    if (input.byteSize > TENANT_PACKAGE_LIMITS.resumableUploadThresholdBytes) {
      await this.uploadResumable(input);
    } else {
      await this.uploadStandard(input);
    }
  }
  async verify(objectPath: string, size: number, digest: string): Promise<void> {
    const deadline = Date.now() + this.totalVerificationMs(size);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hash = createHash('sha256');
      let received = 0;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const controller = new AbortController();
      const deadlineTimer = setTimeout(() => controller.abort(), remaining);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let response: Response | undefined;
      let heartbeatError: unknown;
      const heartbeatTimer = setInterval(() => {
        this.beforeMutation().catch((error: unknown) => {
          heartbeatError = error;
          controller.abort();
        });
      }, this.verificationHeartbeatMs);
      try {
        await this.beforeMutation();
        response = await requestWithRetry(
          this.objectUrl(objectPath),
          { headers: this.headers, signal: controller.signal },
          [200],
          remaining,
        );
        if (heartbeatError) throw heartbeatError;
        if (!response.body) throw new Error('missing_body');
        reader = response.body.getReader();
        while (true) {
          const chunk = await nextChunk(reader, this.verificationInactivityMs);
          if (chunk.done) break;
          const bytes = Buffer.from(chunk.value);
          received += bytes.length;
          if (received > size) throw new Error('body_too_large');
          hash.update(bytes);
          if (heartbeatError) throw heartbeatError;
        }
        if (received === size && `sha256:${hash.digest('hex')}` === digest) return;
      } catch {
        // A fresh download and hash receives the next bounded attempt.
      } finally {
        clearInterval(heartbeatTimer);
        clearTimeout(deadlineTimer);
        controller.abort();
        if (reader) await reader.cancel().catch(() => undefined);
        else await response?.body?.cancel().catch(() => undefined);
        try { reader?.releaseLock(); } catch { /* Cleanup never masks verification. */ }
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
      await this.beforeMutation();
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
    await this.beforeMutation();
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
        await this.beforeMutation();
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
