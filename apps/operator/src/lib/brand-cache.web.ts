/** Web variant: localStorage, guarded -- private windows may throw. */
import type { TokenStorage } from '@platform/ui';

export const brandCache: TokenStorage = {
  getItem(key: string) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Same story as native: worst case is defaults until hydration.
    }
  },
};
