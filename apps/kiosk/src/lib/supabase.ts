import 'react-native-url-polyfill/auto';

import { createSupabaseClient } from '@platform/data';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The kiosk's Supabase client, for reading the menu and nothing else.
 *
 * A lobby tablet holds no guest session, so unlike the customer app there is
 * no storage adapter and no session to refresh: this client carries the
 * publishable key and reads what a published menu already grants anyone.
 * `menu_items_select` admits any caller once `menus.is_published` is true, so
 * this obtains nothing a passer-by could not already get from the anon key
 * that ships in the customer bundle.
 *
 * What the kiosk may read through it is enforced in
 * `packages/schema/src/surfaces.test.ts` as an allowlist over `.from(...)`
 * calls in this app: the storefront and its own device row, never a guest's
 * orders, identity, loyalty or money. Adding a relation there is meant to be
 * a deliberate act.
 *
 * Null when the app is not configured, exactly as the other surfaces return
 * null — callers branch on it as they branch on demo mode.
 */
export const supabase: SupabaseClient | null = createSupabaseClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  detectSessionInUrl: false,
});

export const hasSupabaseConfig = supabase !== null;
