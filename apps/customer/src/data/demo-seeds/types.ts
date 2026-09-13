import type { OrderStatus } from '@platform/schema';
import type {
  GiftCard,
  PortalMessage,
  RewardCatalogItem,
  RewardEntry,
} from '@platform/domain';

/**
 * Shared shape for a vertical's demo fixtures.
 *
 * This mirrors `HomeIndustryPack` in `screens/client/home-industry-copy.ts`:
 * one pack per known industry key, resolved through the same kind of
 * registry, plus a neutral fallback for a tenant that names no vertical (or
 * names one the platform has not written a pack for yet). `demo.ts` turns the
 * result into the portal bundle the same way it always has -- this just
 * decides which vertical's raw fixtures it starts from.
 */

export type IsoAt = (daysFromNow: number, hour: number, minute?: number) => string;

/** One demo order before tax and labels are computed against the tenant's own jurisdiction. */
export type DemoOrderSeed = {
  id: string;
  /** One line's name; the demo carries single-line orders. */
  item: string;
  days: number;
  hour: number;
  minute?: number;
  priceCents: number;
  status: OrderStatus;
  /** Display-safe guest name; becomes the order's guestLabel. */
  client?: string;
  mobile?: boolean;
};

export type DemoSeedSet = {
  readonly orderSeeds: readonly DemoOrderSeed[];
  readonly rewardLedger: (isoAt: IsoAt) => RewardEntry[];
  readonly rewardActivities: readonly string[];
  readonly rewardCatalog: readonly RewardCatalogItem[];
  readonly giftCards: (isoAt: IsoAt) => GiftCard[];
  readonly messages: (isoAt: IsoAt) => PortalMessage[];
  readonly preferenceNotes: string;
  readonly membershipName: string;
};
