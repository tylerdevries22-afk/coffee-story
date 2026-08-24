/**
 * The platform API client, bound to this device's token.
 *
 * `EXPO_PUBLIC_API_URL` must be written literally for Metro to inline it, which
 * is why the env read lives here in the app rather than in a package.
 */
import { createApiClient, type ApiClient } from '@platform/api-client';

export type KioskApiConfig = { baseUrl: string; allowedHost?: string };

/** Validate the public API pair before a bearer token can reach it. */
export function kioskApiConfig(
  apiUrl: unknown,
  allowedApiHost: unknown,
): KioskApiConfig | null {
  if (typeof apiUrl !== 'string' || apiUrl.length === 0) return null;
  try {
    const url = new URL(apiUrl);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (!local && (typeof allowedApiHost !== 'string'
      || url.hostname !== allowedApiHost.toLowerCase())) return null;
    return {
      baseUrl: apiUrl.replace(/\/$/, ''),
      ...(local ? {} : { allowedHost: allowedApiHost as string }),
    };
  } catch {
    return null;
  }
}

export function apiBaseUrl(): string | null {
  return kioskApiConfig(
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_ALLOWED_API_HOST,
  )?.baseUrl ?? null;
}

/**
 * A client that presents the DEVICE token.
 *
 * The token is passed rather than read from storage here so the caller decides
 * what "current" means -- the provider already refreshes it, and a client that
 * re-read storage on every request could use one the provider has retired.
 */
export function deviceApiClient(accessToken: string): ApiClient | null {
  const config = kioskApiConfig(
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_ALLOWED_API_HOST,
  );
  if (!config) return null;
  return createApiClient({
    ...config,
    // The shared guard permits plain HTTP only for loopback development.
    developmentMode: true,
    getAccessToken: async () => accessToken,
  });
}
