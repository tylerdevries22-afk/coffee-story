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
  /**
   * The status mark. One glyph, shown beside a tier name wherever a tier name
   * appears -- the customer app's rewards chip and the in-store board read the
   * same key, so a brand that changes its mark changes both.
   */
  rewardMark: '✦',
  closedLabel: 'Closed',
  opensLabel: 'Opens {time}',

  // The pickup display. Its own block because a wall screen is read across a
  // room in under two seconds: these are the shortest words that still say the
  // thing, and a tenant lengthening one has to see the rest to know what fits.
  // The board's own name, above the location. A tenant that calls it
  // something else ("Order Up", "Collection") overrides this like any other
  // brand string rather than editing a component.
  /**
   * The kiosk's handoff line. Here rather than in the component because it
   * describes how a particular shop actually hands orders over -- some call
   * names, some only light the board -- and that is the brand's to say.
   */
  handoffPromise: "We'll call your name when it's ready.",
  boardTitle: 'Order Queue',
  /**
   * Shown when a production screen has no device token. Addressed to staff,
   * not guests -- a guest can do nothing about it, and the one person who can
   * needs to know what to do rather than that something is wrong.
   */
  boardUnpairedTitle: 'This screen is not paired',
  boardUnpairedBody: 'Pair it from the console under Locations → Devices.',
  boardReady: 'Ready',
  /**
   * The two states before ready, shown as a small live pill on each row so a
   * guest can tell "we have your order" from "we are making it" without
   * asking. Short because they sit beside the name on one line.
   */
  boardQueued: 'In line',
  boardMaking: 'Making',
  /** Read out by assistive tech in place of the bare digit. */
  boardPosition: 'Number {position} in line',
  boardEmpty: 'Nothing in the queue',
  boardArrived: 'Here',
  boardOverflow: '+{count} more waiting',
  boardLive: 'Live',
  boardStale: 'Reconnecting',
  boardOffline: 'Sample board',
  /**
   * The rewards pitch. `\n` is a hard line break, honoured by the board.
   *
   * Set as three stops rather than a sentence because it is read at a glance
   * from across a room: three short words each landing on their own beat are
   * legible in the time somebody spends looking up, where a clause is not.
   * The break is in the copy rather than left to the container so a tenant
   * controls where their own headline turns.
   */
  boardQrTitle: 'Perks. Status.\nRewards',
  boardQrBody: 'Scan to get {appName} and start earning {pointsName}.',
  /**
   * How a tier reads on a badge. `{tier}` is the rung's own label.
   *
   * A template because the wording is brand voice: a ladder of single words
   * ("Silver") wants "Silver Status", while one of phrases ("House Regular")
   * does not. Neither is the platform's call.
   */
  boardTierBadge: '{tier}',
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
