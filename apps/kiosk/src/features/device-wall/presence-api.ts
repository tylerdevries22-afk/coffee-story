import { fetchWithRetry, newIdempotencyKey, throwForResponse } from '@platform/api-client';
import type { DeviceRegistrationInput } from '@platform/device-wall';

import { apiBaseUrl } from '@/lib/api';

type Body = DeviceRegistrationInput | { installationId: string; locationId: string };

async function post<T>(path: string, token: string, body: Body): Promise<T> {
  const base = apiBaseUrl();
  if (!base) throw new Error('The platform API is not configured.');
  const response = await fetchWithRetry(`${base}${path}`, {
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

export function registerKiosk(token: string, body: DeviceRegistrationInput) {
  return post<{ installationId: string }>('/api/device-wall/installations', token, body);
}

export function heartbeatKiosk(token: string, installationId: string, locationId: string) {
  return post<{ seenAt: string }>('/api/device-wall/heartbeat', token, {
    installationId, locationId,
  });
}
