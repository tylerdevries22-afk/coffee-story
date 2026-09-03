/**
 * What a storefront may ask about itself, and the module that answers.
 *
 * The five booleans the guest apps have always branched on -- drops, catering,
 * delivery, stored value, referrals -- were read out of a tenant's bundled
 * `brand.json` `features` block, which nothing on the server ever agreed with.
 * `public.brand_storefront_capabilities` (20260903170000) is now the server's
 * answer to the same question, and it speaks in module keys. This is the one
 * place the two vocabularies meet.
 *
 * Restricted to the customer-facing half of LEGACY_FLAG_MODULE_MAP on purpose:
 * `operations` maps to workforce-operations, which the anonymous projection
 * withholds because staff scheduling is not a storefront fact. A storefront
 * that cannot be told about a module has no business branching on it, so the
 * key is absent here rather than present and always false.
 */
import { LEGACY_FLAG_MODULE_MAP, MODULE_REGISTRY } from './registry';

/** The flags a storefront resolves, and the module each one now means. */
export const STOREFRONT_CAPABILITY_MODULE = {
  drops: LEGACY_FLAG_MODULE_MAP.drops,
  catering: LEGACY_FLAG_MODULE_MAP.catering,
  delivery: LEGACY_FLAG_MODULE_MAP.delivery,
  stored_value: LEGACY_FLAG_MODULE_MAP.stored_value,
  referrals: LEGACY_FLAG_MODULE_MAP.referrals,
} as const;

export type StorefrontCapability = keyof typeof STOREFRONT_CAPABILITY_MODULE;

export type StorefrontCapabilities = Readonly<Record<StorefrontCapability, boolean>>;

export const STOREFRONT_CAPABILITIES = Object.keys(
  STOREFRONT_CAPABILITY_MODULE,
) as readonly StorefrontCapability[];

/** Every module key a customer surface may legitimately be told about. */
export const CUSTOMER_FACING_MODULE_KEYS: readonly string[] = MODULE_REGISTRY
  .filter((definition) => definition.surfaces.includes('customer'))
  .map((definition) => definition.key);

/**
 * The capability answer for a set of installed module keys.
 *
 * Total by construction: every flag is present, and a module that is not in
 * the set reads false. Unknown keys are ignored rather than rejected -- a
 * newer server can name a module this binary predates, and the honest reading
 * of that is "nothing I branch on", not "the whole answer is unusable".
 */
export function storefrontCapabilitiesOf(moduleKeys: Iterable<string>): StorefrontCapabilities {
  const installed = new Set(moduleKeys);
  const resolved = {} as Record<StorefrontCapability, boolean>;
  for (const capability of STOREFRONT_CAPABILITIES) {
    resolved[capability] = installed.has(STOREFRONT_CAPABILITY_MODULE[capability]);
  }
  return resolved;
}
