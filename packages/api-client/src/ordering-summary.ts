/**
 * One brand's ordering summary, as a platform operator sees it from outside
 * the console -- the Elevate portal's Ordering tab is the first caller.
 *
 * Money is integer cents, like everywhere else on this contract. `feeCents`
 * figures are platform fees already COLLECTED; the brand's fee rates are a
 * different fact and deliberately absent, because rate terms are staff-only
 * (tests/integration/src/tenancy-leaks.test.ts pins that).
 */
export type OrderingSummaryLocation = {
  id: string;
  name: string;
  timezone: string;
  orderingPaused: boolean;
  /**
   * The local business date these counts cover, NOT a UTC date. A brand whose
   * locations span timezones has more than one "today", which is why this
   * travels per location rather than once per response.
   */
  day: string;
  ordersToday: number;
  revenueCentsToday: number;
  feeCentsToday: number;
  feeCentsMonthToDate: number;
  square: { connected: boolean; needsReconsent: boolean };
};

export type OrderingSummaryResponse = {
  brand: { id: string; slug: string; name: string };
  /** When the platform produced these numbers, so a stale cache is visible. */
  generatedAt: string;
  locations: OrderingSummaryLocation[];
  totals: {
    ordersToday: number;
    revenueCentsToday: number;
    feeCentsToday: number;
    feeCentsMonthToDate: number;
  };
  menu: { published: boolean; publishedMenuId: string | null; updatedAt: string | null };
};
