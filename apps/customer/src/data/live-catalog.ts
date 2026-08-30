import type { MenuTree } from '@platform/data';
import { parseOptionGroups, parseSizes, slugify } from '@platform/domain';

import type { MenuAddOn } from './catalog-data';
import type { MenuCategory, MenuImageSource, MenuItem } from './catalog';

export type CustomerCatalog = {
  categories: MenuCategory[];
  items: MenuItem[];
  addOns: MenuAddOn[];
};

function stableCategoryId(title: string, bundled: readonly MenuCategory[], used: Set<string>): string {
  const known = bundled.find((category) => category.title === title)?.id;
  const generated = slugify(title);
  const base = (known ?? generated) || 'category';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function liveImage(url: string | null, fallback: number | undefined): MenuImageSource | null {
  if (url?.startsWith('https://')) return { uri: url, ...(fallback === undefined ? {} : { fallback }) };
  return fallback ?? null;
}

export function customerCatalogFromTree(
  tree: MenuTree,
  bundledCategories: readonly MenuCategory[],
  bundledImages: Readonly<Record<string, number>>,
): CustomerCatalog {
  const usedCategoryIds = new Set<string>();
  const categoryIdByRow = new Map<string, string>();
  const categories = tree.categories.map((category) => {
    const id = stableCategoryId(category.title, bundledCategories, usedCategoryIds);
    categoryIdByRow.set(category.id, id);
    return { id, title: category.title, tagline: category.tagline };
  });
  const items = tree.categories.flatMap((category) => category.items.flatMap((row) => {
    const categoryId = categoryIdByRow.get(row.category_id);
    const optionGroups = parseOptionGroups(row.modifiers);
    if (!categoryId || optionGroups === null) return [];
    const sizes = parseSizes(row.sizes, row.base_price_cents).map((size) => ({
      ...size,
      slug: size.synthetic ? row.slug : `${row.slug}-${size.slug}`,
    }));
    if (sizes.length === 0) return [];
    return [{
      id: row.slug,
      name: row.name,
      description: row.description,
      category: categoryId,
      sizes,
      optionGroups,
      soldOutToday: row.is_86d,
      image: liveImage(row.image_url, bundledImages[row.slug]),
    } satisfies MenuItem];
  }));
  return { categories, items, addOns: catalogAddOns(items) };
}

export function catalogAddOns(items: readonly MenuItem[]): MenuAddOn[] {
  const seen = new Set<string>();
  return items.flatMap((item) => item.optionGroups.flatMap((group) => group.choices.flatMap((choice) => {
    if (choice.priceDeltaCents <= 0 || seen.has(choice.id)) return [];
    seen.add(choice.id);
    return [{
      slug: choice.id,
      name: choice.name,
      priceCents: choice.priceDeltaCents,
      durationMin: 0 as const,
      description: `Available on eligible ${item.name.toLowerCase()} orders.`,
    }];
  })));
}
