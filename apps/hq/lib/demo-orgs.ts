import 'server-only';

/**
 * The demo's organizations, so the "create organization" wizard is functional
 * with no database: a created org joins the header switcher for the rest of the
 * session and starts with no locations (a blank slate the add-location wizard
 * then fills). Seeded from the tenant registry and held on globalThis so it
 * survives module reloads within one running server. Demo-only -- the live path
 * inserts a real brand row -- so it does not persist across restarts.
 */
import { TENANT_ORGS, type TenantOrg } from './tenants';

export type DemoOrg = Pick<TenantOrg, 'id' | 'slug' | 'name' | 'kind' | 'brandConfig' | 'moduleKeys'> & {
  readonly connectorIds: readonly string[];
};

type Store = Map<string, DemoOrg>;

function seed(): Store {
  const store: Store = new Map();
  for (const org of TENANT_ORGS) {
    store.set(org.id, {
      id: org.id, slug: org.slug, name: org.name, kind: org.kind,
      brandConfig: org.brandConfig, moduleKeys: org.moduleKeys, connectorIds: [],
    });
  }
  return store;
}

const globalStore = globalThis as unknown as { __hqDemoOrgs?: Store };
const store: Store = (globalStore.__hqDemoOrgs ??= seed());

export function allDemoOrgs(): DemoOrg[] {
  return [...store.values()];
}

export function demoOrgById(id: string): DemoOrg | null {
  return store.get(id) ?? null;
}

export function addDemoOrg(org: DemoOrg): void {
  store.set(org.id, org);
}
