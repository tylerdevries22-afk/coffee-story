/**
 * Where a kiosk keeps its device token.
 *
 * `expo-secure-store` has no web implementation in SDK 54 -- its methods
 * REJECT rather than no-op -- and the kiosk is exported to static web for
 * `docs/captures` and `scripts/capture-surfaces.mjs`. This app already has one
 * scar from exactly that class of bug: the orientation lock's own comment
 * records an unhandled rejection on every web boot, "noise that hides a real
 * one". So the platform branch is here, once, rather than at each call site.
 *
 * On web the token is simply absent, which resolves the device as unpaired and
 * runs the compiled catalog -- which is what the capture surface needs anyway.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'platform.device-token.v1';

export type StoredDeviceToken = {
  token: string;
  expiresAt: string;
  deviceId: string;
  role: string;
  brandId: string;
  locationId: string;
  label: string;
};

const supported = Platform.OS !== 'web';

export async function readDeviceToken(): Promise<StoredDeviceToken | null> {
  if (!supported) return null;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredDeviceToken) : null;
  } catch {
    // A corrupt entry is the same as no entry: the tablet re-pairs rather than
    // refusing to start, because a kiosk that will not boot is out of service.
    return null;
  }
}

export async function writeDeviceToken(value: StoredDeviceToken): Promise<void> {
  if (!supported) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(value));
  } catch {
    // Nothing to do: the token still works for this session, and the tablet
    // re-pairs next boot. Failing the pairing here would be worse.
  }
}

export async function clearDeviceToken(): Promise<void> {
  if (!supported) return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Same reasoning.
  }
}

/** Refresh well before expiry: a shop's wifi is not a data centre's. */
export function needsRefresh(value: StoredDeviceToken, nowMs: number): boolean {
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires - nowMs < 60 * 60 * 1000;
}
