/**
 * Storage adapter for @platform/ui's ThemeProvider on native: a JSON file in
 * the app's document directory. SecureStore is wrong for this (2KB ceiling,
 * and a brand config is not a secret); the portal store set the pattern,
 * including keeping the native module behind a dynamic import so `node:test`
 * never touches it.
 */
import type { TokenStorage } from '@platform/ui';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, 'brand-config-cache.json');
}

export const brandCache: TokenStorage = {
  async getItem() {
    try {
      const target = await file();
      if (!target.exists) return null;
      return target.textSync();
    } catch {
      return null;
    }
  },
  async setItem(_key: string, value: string) {
    try {
      const target = await file();
      target.write(value);
    } catch {
      // Cache misses cost a moment of default styling, nothing more.
    }
  },
};
