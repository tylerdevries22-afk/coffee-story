import { MODULE_REGISTRY } from '@platform/module-kit';

import type { BlueprintKey, IndustryKey } from './org-input';

export type IndustryOption = {
  readonly key: IndustryKey;
  readonly blueprint: BlueprintKey;
  readonly label: string;
  readonly summary: string;
  readonly image: string;
  readonly suggestedModules: readonly string[];
};

export type ModuleTier = 'base' | 'plus' | 'premium';

export const MODULE_TIERS: readonly {
  readonly key: ModuleTier;
  readonly label: string;
  readonly summary: string;
}[] = [
  { key: 'base', label: 'Base model', summary: 'The essential operating foundation.' },
  { key: 'plus', label: 'Plus model', summary: 'Connected workflows for a growing team.' },
  { key: 'premium', label: 'Premium', summary: 'Advanced revenue and customer capabilities.' },
];

export const INDUSTRY_OPTIONS: readonly IndustryOption[] = [
  {
    key: 'construction', blueprint: 'construction', label: 'Construction & field service',
    summary: 'Projects, crews, jobsite operations, client requests, and field displays.',
    image: '/onboarding/construction-field-v4.webp',
    suggestedModules: [
      'construction-projects', 'workforce-operations', 'workforce-training',
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
      'local-printing', 'device-wall',
    ],
  },
  {
    key: 'coffee-shop', blueprint: 'coffee-shop', label: 'Coffee shop & hospitality',
    summary: 'Menus, ordering, payments, teams, training, kiosks, and guest displays.',
    image: '/onboarding/coffee-hospitality-v4.webp',
    suggestedModules: [
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
      'workforce-operations', 'workforce-training', 'device-wall',
    ],
  },
  {
    key: 'general', blueprint: 'blank', label: 'Retail, service, or something else',
    summary: 'Start with a flexible operating core and choose only what this business needs.',
    image: '/onboarding/general-business-v4.webp',
    suggestedModules: ['workforce-operations', 'workforce-training', 'device-wall'],
  },
];

type ModuleCopy = readonly [string, string, string, ModuleTier, readonly IndustryKey[]];
const ALL_INDUSTRIES: readonly IndustryKey[] = ['general', 'coffee-shop', 'construction'];
const COFFEE_ONLY: readonly IndustryKey[] = ['coffee-shop'];
const CONSTRUCTION_ONLY: readonly IndustryKey[] = ['construction'];

/** Explicit metadata is intentional: an unclassified registry module must fail closed. */
const MODULE_COPY: Readonly<Record<string, ModuleCopy>> = {
  'commerce-catalog': ['Catalog', 'Products, services, menus, pricing, and availability.', 'Commerce', 'base', ALL_INDUSTRIES],
  'commerce-ordering': ['Ordering', 'Shared orders across customer, kiosk, operator, and display.', 'Commerce', 'plus', ALL_INDUSTRIES],
  'commerce-payments': ['Payments', 'Payment collection, settlement, refunds, and reconciliation.', 'Commerce', 'premium', ALL_INDUSTRIES],
  'commerce-catering': ['Catering', 'Large-order intake and fulfillment workflows.', 'Commerce', 'plus', COFFEE_ONLY],
  'commerce-delivery': ['Delivery', 'Delivery zones, dispatch, and order tracking.', 'Commerce', 'premium', COFFEE_ONLY],
  'growth-loyalty': ['Loyalty', 'Points, tiers, offers, and member rewards.', 'Growth', 'premium', COFFEE_ONLY],
  'growth-stored-value': ['Stored value', 'Gift balances and tenant-safe ledgers.', 'Growth', 'premium', COFFEE_ONLY],
  'growth-referrals': ['Referrals', 'Track invitations and customer referral rewards.', 'Growth', 'premium', COFFEE_ONLY],
  'growth-drops': ['Drops', 'Scheduled releases and limited-availability products.', 'Growth', 'premium', COFFEE_ONLY],
  'workforce-operations': ['Operations', 'Live tasks, handoffs, schedules, and issue response.', 'Workforce', 'base', ALL_INDUSTRIES],
  'workforce-training': ['Knowledge & training', 'Role-based lessons, documents, and acknowledgements.', 'Workforce', 'base', ALL_INDUSTRIES],
  'local-printing': ['Local printing', 'Resilient jobsite, kitchen, label, and receipt printing.', 'Devices', 'plus', ALL_INDUSTRIES],
  'construction-projects': ['Projects', 'Construction stages, client requests, and project delivery.', 'Industry', 'base', CONSTRUCTION_ONLY],
  'device-wall': ['Device wall', 'Customer, operator, kiosk, and activity-board deployments.', 'Devices', 'plus', ALL_INDUSTRIES],
};

const registryKeys = new Set(MODULE_REGISTRY.map((module) => module.key));
if (Object.keys(MODULE_COPY).some((key) => !registryKeys.has(key))) {
  throw new Error('Organization module metadata references an unknown registry module.');
}

export const MODULE_OPTIONS = MODULE_REGISTRY.map((module) => {
  const copy = MODULE_COPY[module.key];
  if (!copy) throw new Error(`Organization module metadata is missing for ${module.key}.`);
  const [label, summary, category, tier] = copy;
  const dependencies = module.dependencies.map((dependency) => dependency.key);
  if (copy[4].some((industry) => dependencies
    .some((dependency) => MODULE_COPY[dependency]?.[4].includes(industry) !== true))) {
    throw new Error(`Organization module dependencies cross an industry boundary for ${module.key}.`);
  }
  return {
    key: module.key, label, summary, category, tier,
    surfaces: module.surfaces,
    dependencies,
  };
});

export function eligibleModuleKeys(industry: IndustryKey): readonly string[] {
  return MODULE_REGISTRY.map((module) => module.key)
    .filter((key) => MODULE_COPY[key]?.[4].includes(industry) === true);
}

export function moduleOptionsForIndustry(industry: IndustryKey) {
  const eligible = new Set(eligibleModuleKeys(industry));
  return MODULE_OPTIONS.filter((module) => eligible.has(module.key));
}

/** Keeps the visible selection identical to the dependency-expanded install set. */
export function resolvedModuleSelection(industry: IndustryKey, keys: readonly string[]): string[] {
  const options = moduleOptionsForIndustry(industry);
  const eligible = new Set(options.map((option) => option.key));
  const selected = new Set(keys.filter((key) => eligible.has(key)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const option of options) {
      if (!selected.has(option.key)) continue;
      for (const dependency of option.dependencies) {
        if (!selected.has(dependency)) { selected.add(dependency); changed = true; }
      }
    }
  }
  return options.filter((option) => selected.has(option.key)).map((option) => option.key);
}

export function requiredBySelection(industry: IndustryKey, selected: readonly string[], key: string) {
  return moduleOptionsForIndustry(industry)
    .filter((option) => selected.includes(option.key) && option.dependencies.includes(key))
    .map((option) => option.label);
}
