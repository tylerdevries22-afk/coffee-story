import type { MenuCsvRow } from './menu-csv';

export type TenantMenuCategory = { id: string; title: string; tagline: string };

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

/** Compiles author-friendly tenant files into the JSON a native binary ships. */
export function buildTenantMenu(
  rows: readonly MenuCsvRow[],
  configuredCategories: readonly TenantMenuCategory[],
  modifiersBySlug: Readonly<Record<string, unknown[]>>,
): { menu: BundledTenantMenu; errors: string[] } {
  const categories = resolvedCategories(rows, configuredCategories);
  const errors: string[] = [];
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
    return [{
      id: row.slug,
      name: row.name,
      description: row.description,
      category: category.id,
      sizes,
      optionGroups: modifiersBySlug[row.slug] ?? [],
    }];
  });
  return { menu: { version: 1, categories, items }, errors };
}
