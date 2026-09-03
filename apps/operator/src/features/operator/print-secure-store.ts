import type { PrintSecureStorage } from './print-outbox-storage';

/**
 * The keychain behind a dynamic import.
 *
 * expo-secure-store has no web implementation, and `node:test` must never
 * evaluate a native module to reach the queue model beside it -- the same
 * reason `portal-store.ts` keeps its imports dynamic.
 *
 * A platform without a keychain therefore fails the read or the write, which
 * the storage layer turns into an empty queue or a `false` save. There is
 * deliberately no plaintext fallback: a ticket carries the guest's name and
 * their whole order, so not storing it is the correct degradation.
 */
export const printSecureStorage: PrintSecureStorage = Object.freeze({
  getItemAsync: async (key: string) => {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  setItemAsync: async (key: string, value: string) => {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
  deleteItemAsync: async (key: string) => {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
});
