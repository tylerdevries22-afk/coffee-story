import { slugify } from '@platform/domain';
import { listConnectorCatalog } from '@platform/integrations';
import { MODULE_REGISTRY, resolveModules } from '@platform/module-kit';

import { parseLocationDraft, type LocationDraft, type LocationInput } from './location-input';
import { eligibleModuleKeys } from './organization-onboarding';

export const ORGANIZATION_KINDS = [
  'independent', 'franchisor', 'franchisee', 'operator',
] as const;
export const INDUSTRIES = ['general', 'coffee-shop', 'construction'] as const;
export const BLUEPRINTS = ['blank', 'coffee-shop', 'construction'] as const;

export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
export type IndustryKey = (typeof INDUSTRIES)[number];
export type BlueprintKey = (typeof BLUEPRINTS)[number];

type ModuleSpec = {
  readonly key: string;
  readonly version: string;
  readonly enabled: true;
  readonly config: Record<string, never>;
};

export type OrgDraft = {
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly organizationKind: OrganizationKind;
  readonly industryKey: IndustryKey;
  readonly blueprintKey: BlueprintKey;
  readonly networkSlug: string | null;
  readonly location: LocationDraft | null;
  readonly modules: readonly ModuleSpec[];
  readonly connectors: readonly string[];
  readonly territory: { description?: string };
  readonly inheritancePolicy: { mode: 'tenant-owned' | 'network-defaults'; revision: 1 };
  readonly brandConfig: { identity: { slug: string; name: string } };
};

export type OrgInput = {
  name?: string;
  ownerEmail?: string;
  organizationKind?: string;
  industryKey?: string;
  blueprintKey?: string;
  networkSlug?: string;
  territory?: string;
  moduleKeys?: readonly string[];
  connectorIds?: readonly string[];
  location?: LocationInput;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODULES: Record<BlueprintKey, readonly string[]> = {
  blank: [],
  'coffee-shop': [
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    'workforce-operations', 'workforce-training', 'device-wall',
  ],
  construction: [
    'construction-projects', 'workforce-operations', 'workforce-training',
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    'local-printing', 'device-wall',
  ],
};
const INDUSTRY_BLUEPRINT: Record<IndustryKey, BlueprintKey> = {
  general: 'blank',
  'coffee-shop': 'coffee-shop',
  construction: 'construction',
};

function member<T extends string>(value: string | undefined, values: readonly T[]): T | null {
  return values.includes(value as T) ? value as T : null;
}

function selectedModules(keys: readonly string[]): readonly ModuleSpec[] | null {
  const resolution = resolveModules(MODULE_REGISTRY, keys);
  if (resolution.kind === 'failed') return null;
  const byKey = new Map(resolution.modules.map((module) => [module.key, module]));
  const ordered: typeof resolution.modules[number][] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    const module = byKey.get(key);
    if (!module) return;
    module.dependencies.forEach((dependency) => visit(dependency.key));
    seen.add(key);
    ordered.push(module);
  };
  keys.forEach(visit);
  resolution.modules.forEach((module) => visit(module.key));
  return ordered.map((module) => ({
    key: module.key, version: module.version, enabled: true, config: {},
  }));
}

function selectedConnectors(keys: readonly string[]): readonly string[] | null {
  if (keys.length > 32) return null;
  const unique = [...new Set(keys)];
  const available = new Set(listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => entry.descriptor.id));
  return unique.every((key) => available.has(key)) ? unique.sort() : null;
}

export function parseOrgDraft(input: OrgInput):
  { ok: true; draft: OrgDraft } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter an organization name.' };
  if (name.length > 120) return { ok: false, error: 'That organization name is too long.' };
  const slug = slugify(name, 63);
  if (slug.length < 2) {
    return { ok: false, error: 'Enter at least two letters or numbers for the organization handle.' };
  }
  const ownerEmail = (input.ownerEmail ?? '').trim().toLowerCase();
  if (ownerEmail.length > 254 || !EMAIL.test(ownerEmail)) {
    return { ok: false, error: 'Enter a valid owner email address.' };
  }
  const organizationKind = member(input.organizationKind, ORGANIZATION_KINDS);
  const industryKey = member(input.industryKey, INDUSTRIES);
  const blueprintKey = member(input.blueprintKey, BLUEPRINTS);
  if (!organizationKind || !industryKey || !blueprintKey) {
    return { ok: false, error: 'Choose a valid organization model, industry, and blueprint.' };
  }
  if (blueprintKey !== INDUSTRY_BLUEPRINT[industryKey]) {
    return { ok: false, error: 'Choose the blueprint assigned to that industry.' };
  }
  const moduleKeys = input.moduleKeys ?? MODULES[blueprintKey];
  const modules = selectedModules(moduleKeys);
  if (!modules) return { ok: false, error: 'Choose only registered, compatible modules.' };
  const eligible = new Set(eligibleModuleKeys(industryKey));
  if (!modules.every((module) => eligible.has(module.key))) {
    return { ok: false, error: 'Choose only modules available for that industry.' };
  }
  const connectors = selectedConnectors(input.connectorIds ?? []);
  if (!connectors) return { ok: false, error: 'Choose only available MCP Store providers.' };
  const networkSlug = (input.networkSlug ?? '').trim().toLowerCase() || null;
  if (organizationKind === 'franchisee' && (!networkSlug || !SLUG.test(networkSlug))) {
    return { ok: false, error: 'Enter the franchise network handle.' };
  }
  let location: LocationDraft | null = null;
  if (organizationKind === 'independent' || organizationKind === 'franchisee') {
    const parsed = parseLocationDraft(input.location ?? {});
    if (!parsed.ok) return parsed;
    location = parsed.draft;
  }
  const territory = (input.territory ?? '').trim();
  return {
    ok: true,
    draft: {
      slug, name, ownerEmail, organizationKind, industryKey, blueprintKey,
      networkSlug, location,
      modules, connectors,
      territory: territory ? { description: territory } : {},
      inheritancePolicy: {
        mode: organizationKind === 'franchisee' ? 'network-defaults' : 'tenant-owned',
        revision: 1,
      },
      brandConfig: { identity: { slug, name } },
    },
  };
}
