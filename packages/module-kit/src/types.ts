/**
 * The contracts every capability module declares and the resolver honors.
 *
 * The modular plan replaces scattered feature flags with versioned modules:
 * a tenant no longer is its `brand.json` booleans, it is the set of modules
 * installed for it. These types are the shared vocabulary for that -- the
 * manifest every module publishes, the immutable snapshot every app caches,
 * and the activation lifecycle that stands between the two.
 *
 * Framework-free on purpose: HQ (Next.js), the Expo apps, and server jobs all
 * enforce the same resolved capabilities, so this vocabulary can import
 * nothing that any one of those runtimes lacks.
 */

export const APP_SURFACES = ['customer', 'kiosk', 'operator', 'display', 'hq'] as const;
export type AppSurface = (typeof APP_SURFACES)[number];

/**
 * How much a module participates in the shared offline core. `writes` means
 * the module queues durable local mutations and must declare a conflict
 * policy; anything less never blocks a tenant switch.
 */
export const OFFLINE_CONTRIBUTIONS = ['none', 'reads', 'writes'] as const;
export type OfflineContribution = (typeof OFFLINE_CONTRIBUTIONS)[number];

/** A dependency edge. `version` is an exact `x.y.z` or a `^x.y.z` range. */
export type ModuleDependency = {
  readonly key: string;
  readonly version: string;
};

/**
 * What a module publishes about itself. The registry rejects any definition
 * that fails `parseModuleDefinition`, so every field here is already known
 * well-formed by the time resolution or activation reads it.
 */
export type ModuleDefinition = {
  /** Stable across versions; slug-shaped, e.g. `commerce-ordering`. */
  readonly key: string;
  readonly version: string;
  readonly dependencies: readonly ModuleDependency[];
  readonly surfaces: readonly AppSurface[];
  /** Bumped when the module's configuration shape changes; drives migrations. */
  readonly configSchemaVersion: number;
  /** Permission identifiers the module grants, `area:action` shaped. */
  readonly permissions: readonly string[];
  /** Route prefixes, job names, and event topics this module alone owns. */
  readonly routes: readonly string[];
  readonly jobs: readonly string[];
  readonly events: readonly string[];
  readonly offline: OfflineContribution;
  /** External gates (provider enrollment, hardware) named for release review. */
  readonly releasePrerequisites: readonly string[];
  readonly incompatibleWith: readonly string[];
};

/** One row of a resolved snapshot: what is on, at which version. */
export type ResolvedModule = {
  readonly key: string;
  readonly version: string;
  readonly permissions: readonly string[];
  readonly configRevision: number;
};

/**
 * The immutable answer to "what may this tenant do here, right now".
 *
 * Apps cache the last valid snapshot and fail closed for sensitive actions
 * once `expiresAt` passes -- a device that cannot reach the platform keeps
 * its last known entitlements for reads but may not, say, take a payment on
 * stale authority. The signature binds the payload to the platform's key;
 * `module-kit` stays algorithm-agnostic by taking signer/verifier functions.
 */
export type ResolvedCapabilitySnapshot = {
  readonly tenant: string;
  readonly site: string | null;
  readonly modules: readonly ResolvedModule[];
  /** Sorted union of every resolved module's permissions. */
  readonly permissions: readonly string[];
  readonly configRevision: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
};

/**
 * `disabled` is reachable from anywhere: an operator must always be able to
 * kill a module without passing through another state first.
 */
export const ACTIVATION_STATES = [
  'draft', 'validating', 'active', 'suspended', 'disabled', 'error',
] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];
