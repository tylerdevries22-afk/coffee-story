/**
 * Checking a bundled capability manifest against the server, without ever
 * making the server the thing a guest app boots on.
 *
 * The customer and kiosk binaries compile their tenant's module manifest in
 * (Metro cannot require a runtime-chosen path, so `pnpm onboard --apply`
 * materialises the choice). That is deliberately kept as the BOOT source: an
 * offline-first app that resolved capability from the network would, on a cold
 * offline boot, resolve nothing -- and "fail closed" there renders an app with
 * no drops, no catering, no gift balance, which is a worse outcome than a
 * slightly stale one. A stale capability grant on a guest surface authorizes
 * nothing on its own; every write behind these flags is re-authorized server
 * side.
 *
 * So the live read is a REVALIDATION, not a gate. It answers "has this tenant's
 * installation moved since the binary shipped", writes the server's answer into
 * the offline cache so the next boot can see it, and reports drift. It never
 * decides what renders on this boot.
 */
import { CUSTOMER_FACING_MODULE_KEYS } from './storefront-capabilities';

/** Where a revalidated snapshot is kept between launches. */
export type CapabilityCache = {
  readonly write: (snapshot: string) => Promise<void>;
};

export type CapabilitySnapshot = {
  readonly slug: string;
  readonly checkedAt: string;
  readonly moduleKeys: readonly string[];
};

export type CapabilityRevalidation =
  /** No answer: offline, unconfigured, or the read failed. The bundle stands. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'match'; readonly snapshot: CapabilitySnapshot }
  /**
   * `granted` is installed on the server and missing from this binary;
   * `revoked` is the reverse. Both are reported rather than acted on: acting
   * would make the network a boot dependency, which is the thing this design
   * refuses.
   */
  | {
    readonly kind: 'drift';
    readonly snapshot: CapabilitySnapshot;
    readonly granted: readonly string[];
    readonly revoked: readonly string[];
  };

export type RevalidationInput = {
  readonly slug: string;
  /** The module keys this binary bundles. */
  readonly bundled: readonly string[];
  /**
   * The live read, already bound to `public.brand_storefront_capabilities`.
   * Null means "could not answer" -- offline, unconfigured, or an error. It
   * must never throw; a revalidation failure is not an application failure.
   */
  readonly read: () => Promise<readonly string[] | null>;
  readonly cache: CapabilityCache;
  readonly now: () => Date;
};

/**
 * Only customer-facing keys are comparable.
 *
 * The projection publishes the customer-facing subset by design, so a kiosk
 * binary that bundles `local-printing` would otherwise read as permanent drift
 * against a server that is behaving exactly as specified.
 */
function comparable(keys: Iterable<string>): Set<string> {
  const customerFacing = new Set(CUSTOMER_FACING_MODULE_KEYS);
  return new Set([...keys].filter((key) => customerFacing.has(key)));
}

function difference(from: Set<string>, without: Set<string>): string[] {
  return [...from].filter((key) => !without.has(key)).sort();
}

/** Reads the server's capability answer, caches it, and reports the delta. */
export async function revalidateStorefrontCapabilities(
  input: RevalidationInput,
): Promise<CapabilityRevalidation> {
  const live = await input.read();
  if (live === null) return { kind: 'unavailable' };

  const snapshot: CapabilitySnapshot = {
    slug: input.slug,
    checkedAt: input.now().toISOString(),
    moduleKeys: [...new Set(live)].sort(),
  };
  // Written before the comparison so a cache that fails still leaves the
  // caller a truthful drift report to act on.
  await input.cache.write(JSON.stringify(snapshot));

  const server = comparable(live);
  const binary = comparable(input.bundled);
  const granted = difference(server, binary);
  const revoked = difference(binary, server);
  if (granted.length === 0 && revoked.length === 0) return { kind: 'match', snapshot };
  return { kind: 'drift', snapshot, granted, revoked };
}
