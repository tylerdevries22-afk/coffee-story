/**
 * Industry copy packs: the layer between the platform's universal wording and
 * a tenant's own dictionary.
 *
 * Every key a tenant did not override used to fall back to one set of words,
 * and those words were a coffee shop's -- a construction company's app said
 * "Add to Bag" and promised to call your name at a counter, because nothing in
 * the stack separated wording the platform owns from wording the vertical
 * owns. This module owns the second kind, and a brand that names no industry
 * resolves to the neutral pack rather than to whichever vertical shipped
 * first.
 */

/**
 * The keys whose wording is the vertical's to say.
 *
 * Every pack supplies all of them. A pack with a hole would fall through to
 * whatever the universal layer happened to hold, which is the silent
 * inheritance this layer exists to stop, so the consistency gate checks the
 * whole list rather than trusting the type.
 */
export const VERTICAL_COPY_KEYS = [
  'appName', 'orderCta', 'addToBag', 'viewBag', 'bagTitle', 'orderPlaced',
  'earnBanner', 'memberFallback', 'dropLive', 'dropStartsIn', 'handoffPromise',
  'boardTitle', 'boardQueued', 'boardMaking', 'boardPosition', 'boardEmpty',
  'boardArrived', 'boardOverflow',
  // Stored value and the order-ready notification. All three name a place or a
  // moment -- a counter, a checkout, a pickup -- and a vertical that has none
  // of those needs its own words rather than a shop's.
  'cashName', 'cashHint', 'orderReadyMessage',
] as const;

export type VerticalCopyKey = (typeof VERTICAL_COPY_KEYS)[number];
export type IndustryCopy = Readonly<Record<VerticalCopyKey, string>>;

/** The pack a brand config falls back to, named so callers can say it out loud. */
export const GENERIC_INDUSTRY_KEY = 'generic';

/**
 * The fail-safe: wording that commits to no vertical.
 *
 * Brand configs reach the apps from two places -- the bundled brand.json and
 * the `brand_storefront` row -- and a row written before `business.industryKey`
 * existed carries no key at all. Those land here. It says "order" because the
 * platform's own domain noun is an order; it does not say bag, counter, or
 * anything else that assumes a shop.
 */
export const GENERIC_COPY: IndustryCopy = {
  appName: 'Our Business',
  orderCta: 'Start an order',
  addToBag: 'Add to order',
  viewBag: 'View order',
  bagTitle: 'Your order',
  orderPlaced: 'Order placed',
  earnBanner: 'Earn {points} {pointsName} for this order',
  memberFallback: 'Member',
  dropLive: 'Available now',
  dropStartsIn: 'Opens in {time}',
  handoffPromise: "We'll let you know when it's ready.",
  boardTitle: 'Order Status',
  boardQueued: 'Received',
  boardMaking: 'In progress',
  boardPosition: 'Number {position} in the queue',
  boardEmpty: 'Nothing in the queue',
  boardArrived: 'Arrived',
  boardOverflow: '+{count} more waiting',
  cashName: 'Store Credit',
  cashHint: 'Use this at checkout',
  orderReadyMessage: 'Order {shortCode} is ready.',
};

/**
 * The wording the platform shipped with, unchanged.
 *
 * These are the strings that were the platform-wide defaults before industries
 * existed, kept byte-for-byte so the coffee tenants render exactly as they did.
 * Change one here and a coffee shop's app changes; that is the point of it
 * being a pack rather than a default.
 */
const COFFEE_SHOP_COPY: IndustryCopy = {
  appName: 'Our Shop',
  orderCta: 'Start an order',
  addToBag: 'Add to Bag',
  viewBag: 'View Bag',
  bagTitle: 'My Bag',
  orderPlaced: 'Order placed',
  earnBanner: 'Earn {points} {pointsName} for this order',
  memberFallback: 'Member',
  dropLive: 'Dropping now',
  dropStartsIn: 'Drops in {time}',
  handoffPromise: "We'll call your name when it's ready.",
  boardTitle: 'Order Queue',
  boardQueued: 'In line',
  boardMaking: 'Making',
  boardPosition: 'Number {position} in line',
  boardEmpty: 'Nothing in the queue',
  boardArrived: 'Here',
  boardOverflow: '+{count} more waiting',
  cashName: 'Store Credit',
  cashHint: 'Present at the counter',
  orderReadyMessage: 'Order {shortCode} is ready for pickup.',
};

/**
 * A contractor's vocabulary: scope before payment, a client rather than a
 * member, and a board that is read in an office lobby rather than across a
 * service counter. Drop wording is supplied even though the vertical rarely
 * enables drops -- a pack with a hole is worse than a pack with a spare key.
 */
const CONSTRUCTION_COPY: IndustryCopy = {
  appName: 'Our Company',
  orderCta: 'Start a project',
  addToBag: 'Add to request',
  viewBag: 'View request',
  bagTitle: 'Your request',
  orderPlaced: 'Request sent',
  earnBanner: 'Earn {points} {pointsName} for this request',
  memberFallback: 'Client',
  dropLive: 'Booking now',
  dropStartsIn: 'Opens in {time}',
  handoffPromise: "We'll call your name when your project team is ready.",
  boardTitle: 'Project Board',
  boardQueued: 'Scheduled',
  boardMaking: 'In progress',
  boardPosition: 'Number {position} in the queue',
  boardEmpty: 'Nothing scheduled',
  boardArrived: 'On site',
  boardOverflow: '+{count} more scheduled',
  cashName: 'Account Credit',
  cashHint: 'Applied to your next invoice',
  orderReadyMessage: 'Request {shortCode} is ready.',
};

/**
 * Packs by industry key. The keys match `industries/<key>/` folder names, and
 * the consistency gate fails when a blueprint on disk has no pack here.
 *
 * `generic` deliberately has no blueprint: it is not an industry a tenant is
 * onboarded into, it is where a tenant with no industry lands.
 */
export const INDUSTRY_COPY: Readonly<Record<string, IndustryCopy>> = {
  'coffee-shop': COFFEE_SHOP_COPY,
  construction: CONSTRUCTION_COPY,
  [GENERIC_INDUSTRY_KEY]: GENERIC_COPY,
};

/**
 * The pack for an industry key, falling back to neutral wording.
 *
 * An unrecognised key is not an error: the platform's own neutral industry is
 * spelled `general` in the database, brand rows predate the field entirely,
 * and a vertical can be onboarded before its pack is written. All of those
 * must read as nobody's industry rather than as a coffee shop's.
 */
export function industryCopy(key: unknown): IndustryCopy {
  return (typeof key === 'string' ? INDUSTRY_COPY[key] : undefined) ?? GENERIC_COPY;
}

/** The industry a brand config names, from the bundle or from the brand row. */
export function brandIndustryKey(config: unknown): string | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const business = (config as { business?: unknown }).business;
  if (typeof business !== 'object' || business === null) return undefined;
  const key = (business as { industryKey?: unknown }).industryKey;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}
