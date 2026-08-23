import type { MenuItem } from '@/data/catalog';
import type { OrderableItem } from '@/types/domain';

/** Default prep estimate for a made-to-order drink. */
const PREP_MINUTES = 5;

export type MenuItemGroup = {
  name: string;
  description: string;
  image: number;
  variants: OrderableItem[];
};

export function projectItem(
  item: MenuItem,
  size = item.sizes[0],
  depositCents = 0,
): OrderableItem {
  return {
    // The size carries its own slug. Deriving one from the id produced
    // 'signature-120', which the catalog has never contained, so the line
    // could not be priced.
    slug: size?.slug ?? item.id,
    name: item.name,
    category: item.category === 'signature' ? 'signature' : 'specialty',
    ounces: size?.ounces,
    // A drink is made to order in a couple of minutes; the pickup window is
    // computed from this, so it is a prep estimate rather than a duration the
    // guest books.
    durationMin: PREP_MINUTES,
    priceCents: size?.priceCents ?? 0,
    depositCents,
    description: item.description,
  };
}

export function projectItems(
  items: readonly MenuItem[],
  depositCents = 0,
): OrderableItem[] {
  return items.flatMap((item) => (
    item.sizes.length
      ? item.sizes.map((duration) => projectItem(item, duration, depositCents))
      : [projectItem(item, undefined, depositCents)]
  ));
}

export function projectFirstVariants(
  items: readonly MenuItem[],
  depositCents = 0,
): OrderableItem[] {
  return items.map((item) => ({
    ...projectItem(item, item.sizes[0], depositCents),
    slug: item.id,
  }));
}

export function groupOrderableItems(
  items: readonly OrderableItem[],
  imageForItem: (slug: string) => number,
): MenuItemGroup[] {
  const grouped = new Map<string, MenuItemGroup>();
  for (const item of items) {
    const current = grouped.get(item.name);
    if (current) {
      current.variants.push(item);
      continue;
    }
    grouped.set(item.name, {
      name: item.name,
      description: item.description ?? 'Made fresh, just for you.',
      image: imageForItem(item.slug),
      variants: [item],
    });
  }
  return [...grouped.values()];
}
