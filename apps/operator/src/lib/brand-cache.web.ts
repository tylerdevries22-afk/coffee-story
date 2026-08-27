/** Web variant: localStorage, guarded because private windows may throw. */
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
      // A cache miss only delays brand hydration; defaults remain safe.
    }
  },
};
