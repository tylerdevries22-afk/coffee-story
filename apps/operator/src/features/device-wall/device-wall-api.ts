import { fetchWithRetry, newIdempotencyKey, resolveApiUrl, throwForResponse } from '@platform/api-client';
import type { DeviceRegistrationInput } from '@platform/device-wall';

import { liveConfigFromEnv } from '@/lib/runtime-config';

type RequestBody = DeviceRegistrationInput | {
  readonly installationId: string;
  readonly locationId: string;
};

function endpoint(path: string): string {
  const config = liveConfigFromEnv();
  if (typeof config.apiUrl !== 'string') throw new Error('The platform API is not configured.');
  return resolveApiUrl(path, {
    baseUrl: config.apiUrl,
    allowedHost: typeof config.allowedApiHost === 'string' ? config.allowedApiHost : undefined,
    developmentMode: true,
  });
}

async function post<T>(path: string, token: string, body: RequestBody): Promise<T> {
  const response = await fetchWithRetry(endpoint(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': newIdempotencyKey(),
    },
    body: JSON.stringify(body),
  }, 10_000, 2);
  if (!response.ok) await throwForResponse(response);
  return await response.json() as T;
}

export function registerOperatorInstallation(token: string, body: DeviceRegistrationInput) {
  return post<{ installationId: string }>('/api/device-wall/installations', token, body);
}

export function sendOperatorHeartbeat(
  token: string,
  installationId: string,
  locationId: string,
) {
  return post<{ seenAt: string }>('/api/device-wall/heartbeat', token, {
    installationId, locationId,
  });
}
