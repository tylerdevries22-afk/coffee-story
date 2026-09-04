/**
 * The tenant's capability, revalidated against the server.
 *
 * The kiosk's counterpart to apps/customer/src/lib/capability-check, and the
 * same contract: `@/tenant/capabilities` decides what this boot shows, from
 * the manifest compiled into the binary; this asks
 * `public.brand_storefront_capabilities`, caches the answer for the next cold
 * boot, and reports drift.
 *
 * The projection is deliberately customer-facing only, so it will never
 * mention local-printing or device-wall even though this binary bundles them.
 * That is not drift and the comparison ignores it -- a paired device learns
 * hardware facts through its own device claim, not through an anonymous read.
 */
import { Platform } from 'react-native';

import {
  revalidateStorefrontCapabilities,
  type CapabilityRevalidation,
} from '@platform/module-kit';

import { supabase } from '@/lib/supabase';
import { TENANT_MODULE_KEYS } from '@/tenant/capabilities';
import { TENANT_BRAND_CONFIG } from '@/tenant';

const CACHE_KEY = 'capability-snapshot';
const CACHE_FILE = 'capability-snapshot.json';
/** A background check on a screen a guest is standing at; it never blocks. */
const DEADLINE_MS = 8_000;

async function writeSnapshot(snapshot: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(CACHE_KEY, snapshot);
      return;
    }
    const { File, Paths } = await import('expo-file-system');
    new File(Paths.document, CACHE_FILE).write(snapshot);
  } catch {
    // The next launch revalidates again.
  }
}

type CapabilityRow = { readonly module_key: string };

/** Null covers offline, unconfigured, an RPC error, and a slow network alike. */
async function readLiveCapabilities(slug: string): Promise<readonly string[] | null> {
  if (!supabase) return null;
  const client = supabase;
  const deadline = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), DEADLINE_MS);
  });
  try {
    const answered = await Promise.race([
      // No `.returns<>()` cast: packages/schema declares this RPC, so the row
      // shape is the generated one and a hand-written cast could only disagree
      // with it.
      client.rpc('brand_storefront_capabilities', { p_slug: slug }),
      deadline,
    ]);
    if (answered === null || answered.error || !answered.data) return null;
    // The shared client is not generic over Database (packages/data builds it
    // untyped), so the projection's row shape is named here rather than
    // inferred. It is two columns by contract: the migration's readiness
    // assertion refuses the function any result but (slug, module_key).
    const rows: readonly CapabilityRow[] = answered.data;
    return rows.map((row) => row.module_key);
  } catch {
    return null;
  }
}

/** Fire-and-forget from the root layout. */
export async function revalidateTenantCapabilities(): Promise<CapabilityRevalidation> {
  const slug = TENANT_BRAND_CONFIG.identity.slug;
  const result = await revalidateStorefrontCapabilities({
    slug,
    bundled: TENANT_MODULE_KEYS,
    read: () => readLiveCapabilities(slug),
    cache: { write: writeSnapshot },
    now: () => new Date(),
  });
  if (result.kind === 'drift') {
    console.warn('Tenant capability drift against the server.', {
      slug,
      grantedOnServer: result.granted.join(',') || 'none',
      revokedOnServer: result.revoked.join(',') || 'none',
    });
  }
  return result;
}
