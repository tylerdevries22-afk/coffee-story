/**
 * The concrete platform module catalog and the legacy-flag bridge into it.
 *
 * The blueprint and tenant-template work shipped module *keys* without
 * definitions; this is the registry those keys resolve against. It also maps
 * each legacy `brands` flag column onto the module that replaces it, so the
 * backfill migration and the dual-read window speak the same vocabulary as
 * the resolver. Definitions are plain data: parseModuleDefinition stays the
 * only gate between authored data and resolution.
 */
import type { ModuleDefinition } from './types';

/**
 * Every capability the platform ships, keyed for the blueprints, the tenant
 * template, and the legacy-flag backfill. Growth modules hang off
 * commerce-ordering (or commerce-catalog for drops, which schedule catalog
 * availability rather than take orders); workforce, printing, construction,
 * and device-wall stand alone.
 */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    key: 'commerce-catalog', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['customer', 'kiosk', 'operator', 'hq'],
    permissions: ['catalog:read', 'catalog:write'],
    routes: ['/catalog'], jobs: ['catalog.sync'], events: ['catalog.changed'],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'commerce-ordering', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-catalog', version: '^1.0.0' }],
    surfaces: ['customer', 'kiosk', 'operator', 'display', 'hq'],
    permissions: ['orders:read', 'orders:write'],
    routes: ['/orders'], jobs: ['orders.sync'], events: ['orders.changed'],
    offline: 'writes', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'commerce-payments', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'kiosk', 'operator', 'hq'],
    permissions: ['payments:read', 'payments:write'],
    routes: ['/payments'], jobs: ['payments.reconcile'], events: ['payments.settled'],
    offline: 'writes',
    releasePrerequisites: ['Square offline enrollment', 'Stripe Terminal offline enablement'],
    incompatibleWith: [],
  },
  {
    key: 'commerce-catering', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'operator', 'hq'],
    permissions: ['catering:read', 'catering:write'],
    routes: ['/catering'], jobs: [], events: [],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'commerce-delivery', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'operator', 'hq'],
    permissions: ['delivery:read', 'delivery:write'],
    routes: ['/delivery'], jobs: ['delivery.dispatch'], events: [],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'growth-loyalty', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'kiosk', 'operator', 'hq'],
    permissions: ['loyalty:read', 'loyalty:write'],
    routes: ['/loyalty'], jobs: ['loyalty.accrual'], events: ['loyalty.changed'],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'growth-stored-value', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'kiosk', 'operator', 'hq'],
    permissions: ['stored-value:read', 'stored-value:write'],
    routes: ['/stored-value'], jobs: ['stored-value.reconcile'], events: [],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'growth-referrals', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    surfaces: ['customer', 'hq'],
    permissions: ['referrals:read', 'referrals:write'],
    routes: ['/referrals'], jobs: [], events: [],
    offline: 'none', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'growth-drops', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [{ key: 'commerce-catalog', version: '^1.0.0' }],
    surfaces: ['customer', 'kiosk', 'operator', 'hq'],
    permissions: ['drops:read', 'drops:write'],
    routes: ['/drops'], jobs: [], events: ['drops.changed'],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'workforce-operations', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['operator', 'hq'],
    permissions: ['operations:read', 'operations:write'],
    routes: ['/operations'], jobs: [], events: ['operations.changed'],
    offline: 'writes', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'workforce-training', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['operator', 'hq'],
    permissions: ['training:read', 'training:write'],
    routes: ['/training'], jobs: [], events: [],
    offline: 'reads', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'local-printing', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['kiosk', 'operator', 'hq'],
    permissions: ['printing:read', 'printing:write'],
    routes: ['/printing'], jobs: ['printing.spool'], events: [],
    offline: 'writes',
    releasePrerequisites: ['LAN printer certification', 'Bluetooth printer certification'],
    incompatibleWith: [],
  },
  {
    key: 'construction-projects', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['operator', 'hq'],
    permissions: ['projects:read', 'projects:write'],
    routes: ['/projects'], jobs: ['projects.sync'], events: [],
    offline: 'writes', releasePrerequisites: [], incompatibleWith: [],
  },
  {
    key: 'device-wall', version: '1.0.0', configSchemaVersion: 1,
    dependencies: [],
    surfaces: ['operator', 'kiosk', 'display'],
    permissions: ['devices:read'],
    routes: ['/device-wall'], jobs: [], events: [],
    offline: 'none', releasePrerequisites: [], incompatibleWith: [],
  },
];

/**
 * Each legacy `brands` flag column and the module that replaces it. Insertion
 * order is the order legacyFlagInstallations reports, so the backfill and any
 * dual-read comparison see one stable sequence.
 *
 * multi_location and sms deliberately have NO mapping: they are capacity and
 * integration settings (how many sites a tenant runs, whether an SMS provider
 * is wired), not capability modules, so they stay on the brands row.
 */
export const LEGACY_FLAG_MODULE_MAP = {
  stored_value: 'growth-stored-value',
  referrals: 'growth-referrals',
  drops: 'growth-drops',
  catering: 'commerce-catering',
  delivery: 'commerce-delivery',
  operations: 'workforce-operations',
} as const;

/** Module keys to install for the flags currently set on a brand row. */
export function legacyFlagInstallations(flags: Record<string, boolean>): string[] {
  return Object.entries(LEGACY_FLAG_MODULE_MAP)
    .filter(([flag]) => flags[flag] === true)
    .map(([, moduleKey]) => moduleKey);
}
