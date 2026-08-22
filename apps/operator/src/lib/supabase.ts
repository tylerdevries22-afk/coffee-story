import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createSupabaseClient } from '@platform/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

/**
 * The app's one Supabase client, built by @platform/data's shared factory
 * (which validates the URL and refuses any key with database authority).
 * This file only supplies what is runtime-specific: the env values and the
 * session storage — SecureStore on native, localStorage on web.
 */

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const webStorage = {
  getItem: (key: string) => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
  setItem: (key: string, value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

export const supabase: SupabaseClient | null = createSupabaseClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  storage: Platform.OS === 'web' ? webStorage : secureStorage,
  detectSessionInUrl: false,
});

export const hasSupabaseConfig = supabase !== null;

if (supabase) {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}
