/**
 * The platform API client, bound to this device's token.
 *
 * `EXPO_PUBLIC_API_URL` must be written literally for Metro to inline it, which
 * is why the env read lives here in the app rather than in a package.
 */
import { createApiClient, type ApiClient } from '@platform/api-client';

export function apiBaseUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_API_URL;
  return typeof url === 'string' && url.length > 0 ? url.replace(/\/$/, '') : null;
}

/**
 * A client that presents the DEVICE token.
 *
 * The token is passed rather than read from storage here so the caller decides
 * what "current" means -- the provider already refreshes it, and a client that
 * re-read storage on every request could use one the provider has retired.
 */
export function deviceApiClient(accessToken: string): ApiClient | null {
  const base = apiBaseUrl();
  if (!base) return null;
  return createApiClient({
    baseUrl: base,
    getAccessToken: async () => accessToken,
  });
}
