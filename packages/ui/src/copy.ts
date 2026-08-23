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

  // The pickup display. Its own block because a wall screen is read across a
  // room in under two seconds: these are the shortest words that still say the
  // thing, and a tenant lengthening one has to see the rest to know what fits.
  // The board's own name, above the location. A tenant that calls it
  // something else ("Order Up", "Collection") overrides this like any other
  // brand string rather than editing a component.
  boardTitle: 'Pickup Queue',
  boardMakingNow: 'Making now',
  boardReady: 'Ready',
  boardEmptyProgress: 'Nothing in the queue',
  boardEmptyReady: 'Nothing waiting',
  boardArrived: 'Here',
  boardOverflow: '+{count} more waiting',
  boardLive: 'Live',
  boardStale: 'Reconnecting',
  boardOffline: 'Sample board',
  boardQrTitle: 'Perks, status and rewards',
  boardQrBody: 'Scan to get {appName} and start earning {pointsName}.',
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
