import type { MenuCsvRow } from './menu-csv';

export type TenantMenuCategory = { id: string; title: string; tagline: string };

export type TenantPackDefinition = {
  packSize: number;
  choiceSource: 'lineup' | 'static';
  /** Stable menu slug; onboarding resolves it to the environment's row UUID. */
  singleItemSlug: string;
  /** Explicit menu slugs that may be selected for this pack. */
  eligibleItemSlugs: readonly string[];
};

export type BundledTenantMenu = {
  version: 1;
  categories: TenantMenuCategory[];
  items: {
    id: string;
    name: string;
    description: string;
    category: string;
    sizes: { slug: string; ounces?: number; priceCents: number }[];
    optionGroups: unknown[];
    packSize?: number;
    choiceSource?: TenantPackDefinition['choiceSource'];
    /** The bundled clients also use stable slugs, never database UUIDs. */
    singleItemId?: string;
    /** Authored pack eligibility, scoped before lineup/drop availability. */
    eligibleItemIds?: string[];
  }[];
};

function categorySlug(title: string): string {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'menu';
}

function resolvedCategories(rows: readonly MenuCsvRow[], configured: readonly TenantMenuCategory[]): TenantMenuCategory[] {
  if (configured.length > 0) return configured.map((category) => ({ ...category }));
  return [...new Set(rows.map((row) => row.category))].map((title) => ({
    id: categorySlug(title), title, tagline: '',
  }));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPackDefinition(
  packSlug: string,
  value: unknown,
  errors: string[],
): TenantPackDefinition | null {
  const source = record(value);
  const packSize = source?.packSize;
  const choiceSource = source?.choiceSource;
  const singleItemSlug = source?.singleItemSlug;
  const eligibleItemSlugs = source?.eligibleItemSlugs;
  const knownKeys = new Set(['packSize', 'choiceSource', 'singleItemSlug', 'eligibleItemSlugs']);
  if (!source || !Number.isInteger(packSize) || Number(packSize) < 1 || Number(packSize) > 100
    || (choiceSource !== 'lineup' && choiceSource !== 'static')
    || typeof singleItemSlug !== 'string' || singleItemSlug.trim() === ''
    || !Array.isArray(eligibleItemSlugs) || eligibleItemSlugs.length === 0 || eligibleItemSlugs.length > 100
    || eligibleItemSlugs.some((slug) => typeof slug !== 'string' || slug.trim() === '')) {
    errors.push(`packs.json: "${packSlug}" needs packSize 1-100, choiceSource lineup/static, singleItemSlug, and a non-empty eligibleItemSlugs array.`);
    return null;
  }
  const extra = Object.keys(source).find((key) => !knownKeys.has(key));
  if (extra) {
    errors.push(`packs.json: "${packSlug}" has unsupported field "${extra}".`);
    return null;
  }
  const normalizedEligible = eligibleItemSlugs.map((slug) => String(slug).trim());
  if (new Set(normalizedEligible).size !== normalizedEligible.length) {
    errors.push(`packs.json: "${packSlug}" eligibleItemSlugs must not contain duplicates.`);
    return null;
  }
  return {
    packSize: Number(packSize),
    choiceSource,
    singleItemSlug: singleItemSlug.trim(),
    eligibleItemSlugs: normalizedEligible,
  };
}

function resolvedPacks(
  rows: readonly MenuCsvRow[],
  modifiersBySlug: Readonly<Record<string, unknown[]>>,
  raw: Readonly<Record<string, unknown>>,
  errors: string[],
): ReadonlyMap<string, TenantPackDefinition> {
  const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
  const packs = new Map<string, TenantPackDefinition>();
  for (const [packSlug, value] of Object.entries(raw)) {
    const row = rowBySlug.get(packSlug);
    if (!row) {
      errors.push(`packs.json: "${packSlug}" is not in menu.csv.`);
      continue;
    }
    const definition = readPackDefinition(packSlug, value, errors);
    if (!definition) continue;
    if (definition.singleItemSlug === packSlug) {
      errors.push(`packs.json: "${packSlug}" cannot use itself as singleItemSlug.`);
    } else if (!rowBySlug.has(definition.singleItemSlug)) {
      errors.push(`packs.json: "${packSlug}" references missing single "${definition.singleItemSlug}".`);
    } else if (definition.eligibleItemSlugs.includes(packSlug)) {
      errors.push(`packs.json: "${packSlug}" cannot include itself in eligibleItemSlugs.`);
    } else if (definition.eligibleItemSlugs.some((slug) => !rowBySlug.has(slug))) {
      const missing = definition.eligibleItemSlugs.find((slug) => !rowBySlug.has(slug));
      errors.push(`packs.json: "${packSlug}" references missing eligible item "${missing}".`);
    } else if (!definition.eligibleItemSlugs.includes(definition.singleItemSlug)) {
      errors.push(`packs.json: "${packSlug}" must include singleItemSlug in eligibleItemSlugs.`);
    } else if (row.sizes.length > 1) {
      errors.push(`packs.json: "${packSlug}" must have at most one size because pack selection uses one price.`);
    } else if ((modifiersBySlug[packSlug]?.length ?? 0) > 0) {
      errors.push(`packs.json: "${packSlug}" cannot have modifiers because the pack flow collects slot choices instead.`);
    } else {
      packs.set(packSlug, definition);
    }
  }
  for (const [packSlug, definition] of packs) {
    if (packs.has(definition.singleItemSlug)) {
      errors.push(`packs.json: "${packSlug}" cannot use pack "${definition.singleItemSlug}" as its single.`);
      packs.delete(packSlug);
    } else {
      const nestedChoice = definition.eligibleItemSlugs.find((slug) => packs.has(slug));
      if (nestedChoice) {
        errors.push(`packs.json: "${packSlug}" cannot include pack "${nestedChoice}" in eligibleItemSlugs.`);
        packs.delete(packSlug);
      }
    }
  }
  return packs;
}

/** Compiles author-friendly tenant files into the JSON a native binary ships. */
export function buildTenantMenu(
  rows: readonly MenuCsvRow[],
  configuredCategories: readonly TenantMenuCategory[],
  modifiersBySlug: Readonly<Record<string, unknown[]>>,
  packsBySlug: Readonly<Record<string, unknown>> = {},
): { menu: BundledTenantMenu; errors: string[] } {
  const categories = resolvedCategories(rows, configuredCategories);
  const errors: string[] = [];
  const packs = resolvedPacks(rows, modifiersBySlug, packsBySlug, errors);
  const seenIds = new Set<string>();
  const byTitle = new Map<string, TenantMenuCategory>();
  for (const category of categories) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(category.id)) errors.push(`menu-categories.json: invalid id "${category.id}".`);
    if (seenIds.has(category.id)) errors.push(`menu-categories.json: duplicate id "${category.id}".`);
    if (byTitle.has(category.title)) errors.push(`menu-categories.json: duplicate title "${category.title}".`);
    seenIds.add(category.id);
    byTitle.set(category.title, category);
  }
  const items = rows.flatMap((row) => {
    const category = byTitle.get(row.category);
    if (!category) {
      errors.push(`menu.csv: category "${row.category}" is missing from menu-categories.json.`);
      return [];
    }
    const sizes = row.sizes.length > 0
      ? row.sizes.map((size) => ({
          slug: `${row.slug}-${size.slug}`,
          ...(/^\d+$/.test(size.slug) ? { ounces: Number(size.slug) } : {}),
          priceCents: size.price_cents,
        }))
      : [{ slug: row.slug, priceCents: row.basePriceCents }];
    const pack = packs.get(row.slug);
    return [{
      id: row.slug,
      name: row.name,
      description: row.description,
      category: category.id,
      sizes,
      optionGroups: modifiersBySlug[row.slug] ?? [],
      ...(pack
        ? {
            packSize: pack.packSize,
            choiceSource: pack.choiceSource,
            singleItemId: pack.singleItemSlug,
            eligibleItemIds: [...pack.eligibleItemSlugs],
          }
        : {}),
    }];
  });
  return { menu: { version: 1, categories, items }, errors };
}
