/**
 * The brand copy dictionary: every user-facing string a component or screen
 * needs, keyed, with {placeholders}. Rule 4 covers words too -- no component
 * hard-codes a brand string.
 */
export type BrandCopy = Record<string, string>;

/** Neutral fallbacks so a missing dictionary entry degrades to plain words. */
export const DEFAULT_COPY: BrandCopy = {
  appName: 'Our Shop',
  pointsName: 'Points',
  orderCta: 'Start an order',
  addToBag: 'Add to Bag',
  viewBag: 'View Bag',
  bagTitle: 'My Bag',
  checkoutTitle: 'Checkout',
  orderPlaced: 'Order placed',
  earnBanner: 'Earn {points} {pointsName} for this order',
  dropLive: 'Dropping now',
  dropEndsIn: 'Ends in {time}',
  dropStartsIn: 'Drops in {time}',
  memberFallback: 'Member',
  closedLabel: 'Closed',
  opensLabel: 'Opens {time}',
};

export function resolveCopy(config: unknown): BrandCopy {
  const copy = { ...DEFAULT_COPY };
  if (typeof config !== 'object' || config === null) return copy;
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length <= 500) copy[key] = value;
  }
  return copy;
}

/** `formatCopy(copy, 'earnBanner', { points: 96, pointsName: 'Beans' })` */
export function formatCopy(
  copy: BrandCopy,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = copy[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
