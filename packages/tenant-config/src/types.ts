export const TENANT_SCHEMA_VERSION = 1 as const;

export const ORGANIZATION_KINDS = [
  'independent', 'franchisor', 'franchisee', 'operator',
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/**
 * Surfaces a tenant may DECLARE. Wider than the set this repo BUILDS
 * (`FACTORY_SURFACES`): `admin` is the Elevate portal. Elevate owns the pack
 * schema and emits it, so a pack is not malformed here merely because one of
 * its surfaces is hosted elsewhere -- consumers that turn a declaration into a
 * build filter to what they ship instead of rejecting the manifest.
 *
 * `lobby` is the unattended venue screen: it renders a provider's published
 * page rather than a catalog, so a tenant may declare it without declaring
 * `kiosk`. It is declarable before it is buildable, for the same reason
 * `admin` is -- a partner emits the pack, and this repo decides what to ship.
 */
export const TENANT_SURFACES = [
  'customer', 'kiosk', 'operator', 'display', 'hq', 'admin', 'lobby',
] as const;
export type TenantSurface = (typeof TENANT_SURFACES)[number];

export type TenantNetwork = {
  readonly slug: string;
  readonly relationship: 'owner' | 'member';
};

export type TenantInheritance = {
  readonly mode: 'standalone' | 'network';
  readonly sourceTenantSlug: string | null;
  readonly revision: number;
  readonly overrides: readonly string[];
};

export type TenantProvider = {
  readonly capability: string;
  readonly provider: string;
  readonly ownership: 'platform' | 'organization' | 'franchisor';
  readonly required: boolean;
};

export type TenantLocation = {
  readonly name: string;
  readonly address: Readonly<Record<string, string>>;
  readonly note?: string;
  /**
   * The Google Place this location IS, when a partner resolved one.
   *
   * An address is descriptive and a name is ambiguous -- two hotels a block
   * apart can share both. A Place id is the identity: it makes a location
   * de-duplicable and re-syncable against the source that produced it, which
   * is what lets a pack describe any venue rather than a hand-listed few.
   * Optional, because a tenant that never went through a Places lookup has
   * nothing truthful to put here.
   */
  readonly googlePlaceId?: string;
  readonly timezone: string;
  readonly hours: Readonly<Record<string, readonly {
    readonly open: string;
    readonly close: string;
  }[]>>;
};

export type TenantManifest = {
  readonly schemaVersion: typeof TENANT_SCHEMA_VERSION;
  readonly organization: { readonly kind: OrganizationKind };
  readonly network: TenantNetwork | null;
  readonly inheritance: TenantInheritance;
  readonly surfaces: readonly TenantSurface[];
  readonly providers: readonly TenantProvider[];
  readonly identity: {
    readonly slug: string;
    readonly name: string;
    readonly bundleId: string;
    readonly scheme: string;
    readonly kioskBundleId: string;
    readonly kioskScheme: string;
    readonly easProjectId: string;
    readonly kioskEasProjectId: string;
  };
  readonly tokens: Record<string, unknown> & {
    readonly primary?: string;
    readonly surface?: string;
    readonly ramp?: Record<string, string>;
  };
  readonly copy: Record<string, string>;
  readonly features: Record<string, boolean>;
  readonly locations: readonly TenantLocation[];
  readonly legacyLocation: boolean;
  readonly fees?: { readonly feeBps: number; readonly feeBpsTier2: number; readonly tierThresholdCents: number };
  readonly business?: Record<string, string>;
  readonly tax?: { readonly jurisdictions: readonly { id: string; label: string; rate: number }[] };
  readonly loyalty?: { readonly rewards?: readonly { slug: string; name: string; points_cost: number }[] };
  readonly board?: Record<string, unknown>;
  readonly kiosk?: Record<string, unknown>;
  readonly raw: Readonly<Record<string, unknown>>;
};

export type TenantManifestResult =
  | { readonly kind: 'ok'; readonly manifest: TenantManifest }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };
