/**
 * The tenant's capability, revalidated against the server.
 *
 * Not the boot source and not a gate. `@/tenant` resolves what this binary may
 * show from the module manifest compiled into it, because an offline-first app
 * has to resolve capability with no network and "fail closed" there means a
 * feature-less app. This asks `public.brand_storefront_capabilities` -- the
 * anonymous (slug, module_key) projection, which needs no session -- writes the
 * answer into the offline cache, and reports drift. What it never does is
 * decide what renders on this boot.
 */
import { Platform } from 'react-native';

import {
  revalidateStorefrontCapabilities,
  type CapabilityRevalidation,
} from '@platform/module-kit';

import { supabase } from '@/lib/supabase';
import { TENANT, TENANT_MODULE_KEYS } from '@/tenant';

const CACHE_KEY = 'capability-snapshot';
const CACHE_FILE = 'capability-snapshot.json';
/** The read is a background check; it must never hold a screen. */
const DEADLINE_MS = 8_000;

/**
 * One file on native, one localStorage key on web, both guarded.
 *
 * A single module with a Platform branch rather than the `.web.ts` twin
 * lib/brand-cache uses: the native module is already behind a dynamic import
 * (so `node:test` never touches it), and that is the only thing the twin was
 * buying here. A cache miss costs one extra revalidation, nothing more.
 */
async function writeSnapshot(snapshot: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(CACHE_KEY, snapshot);
      return;
    }
    const { File, Paths } = await import('expo-file-system');
    new File(Paths.document, CACHE_FILE).write(snapshot);
  } catch {
    // The next launch revalidates again; there is nothing to recover here.
  }
}

type CapabilityRow = { readonly module_key: string };

/**
 * Read the projection, or null if it cannot answer.
 *
 * Null covers offline, unconfigured, an RPC error, and a slow network alike:
 * from the caller's side they are one case, "the server did not say", and the
 * bundle stands in every one of them.
 */
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

/**
 * Fire-and-forget from the root layout. Resolves to the drift report so a test
 * can assert on it; callers in the app ignore it by design.
 */
export async function revalidateTenantCapabilities(): Promise<CapabilityRevalidation> {
  const slug = TENANT.identity.slug;
  const result = await revalidateStorefrontCapabilities({
    slug,
    bundled: TENANT_MODULE_KEYS,
    read: () => readLiveCapabilities(slug),
    cache: { write: writeSnapshot },
    now: () => new Date(),
  });
  if (result.kind === 'drift') {
    // A warning and not an error: the binary is behind or ahead of its tenant's
    // installation, which is a release problem for whoever ships the next
    // build, not a fault the guest can see or this launch can fix.
    console.warn('Tenant capability drift against the server.', {
      slug,
      grantedOnServer: result.granted.join(',') || 'none',
      revokedOnServer: result.revoked.join(',') || 'none',
    });
  }
  return result;
}
