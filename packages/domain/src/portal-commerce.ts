import type { OrderStatus } from '@platform/schema';

import type { AppRole, PortalProfile, PortalSetupState } from './portal-profile';

export type OrderSource = 'website' | 'directory' | 'campaign' | 'staff';

export type PortalOrderLine = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  options: readonly string[];
  packContents?: readonly { name: string; quantity: number }[];
};

/**
 * An order, carrying rule 2's status. Both planes speak this now -- the demo
 * reducer and the live plane (orders + order_events under RLS) produce the
 * same shape, so a screen cannot tell them apart.
 */
export type PortalOrder = {
  id: string;
  status: OrderStatus;
  /** True only for a local wall order whose status is reconciled from HQ. */
  demoSynced?: boolean;
  /** Local broker process that owns a synchronized preview order. */
  demoSyncSessionId?: string;
  /** "2× Latte, Cookie" — what a list row shows. */
  summary: string;
  lines: PortalOrderLine[];
  fulfillmentType: 'pickup' | 'curbside' | 'catering' | 'delivery';
  /** ISO pickup window start; null = as soon as possible. */
  scheduledFor: string | null;
  placedAt: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  note: string;
  /**
   * Display-safe guest name ("Sara D."), never the full record. This is the
   * shape `orders.guest_label` carries server-side, and it is what a pickup
   * board is allowed to show.
   */
  guestLabel?: string;
  /** "Coffee Story — Havana St" or "Delivery". What a history row shows. */
  locationLabel?: string;
  /** Street line under the label; absent for pickup, where the label suffices. */
  locationDetail?: string;
  /**
   * The guest's review of a collected order. Optional because it only exists
   * once written; every surface hides the affordance rather than inventing one.
   */
  review?: { rating: number; note: string; submittedAt: string };
};

export type RewardAccount = {
  availablePoints: number;
  annualPoints: number;
  cashCents: number;
  annualPeriodStart: string;
};

export type RewardEntry = {
  id: string;
  entryType: 'purchase' | 'activity' | 'redemption' | 'adjustment' | 'expiration';
  points: number;
  description: string;
  earnedAt: string;
  expiresAt: string | null;
};

export type RewardCatalogItem = {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  active: boolean;
};

export type RewardReferral = {
  id: string;
  referralCode: string;
  status: 'pending' | 'completed' | 'expired';
  createdAt: string;
  completedAt: string | null;
};

export type GiftCard = {
  id: string;
  code: string;
  initialCents: number;
  balanceCents: number;
  recipientEmail: string | null;
  recipientName: string | null;
  designKey: string;
  deliveryAt: string | null;
  status: 'created' | 'funded' | 'delivered' | 'claimed' | 'depleted' | 'void';
  createdAt: string;
  claimedByCurrentUser: boolean;
  purchasedByCurrentUser: boolean;
};

export type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  isDefault: boolean;
};

export type PortalMessage = {
  id: string;
  sender: 'client' | 'studio';
  body: string;
  sentAt: string;
  read: boolean;
};

/**
 * How a guest takes their coffee, saved for next time.
 *
 * This was an order intake form with a consent gate and a draft/submit
 * workflow. A coffee preference needs neither: there is nothing to consent to
 * and nothing to submit, so it saves in one action.
 */
export type GuestPreferences = {
  completed: boolean;
  /** Free text for the bar -- milk, sweetness, anything worth remembering. */
  notes: string;
  strength: 'light' | 'medium' | 'bold';
  updatedAt: string | null;
};

export type Membership = {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'cancelled';
  priceCents: number;
  renewsAt: string;
  creditsAvailable: number;
};

export type PortalBundle = {
  /** Version for safe, additive migration of the locally persisted demo bundle. */
  demoStateVersion?: number;
  /** Global opt-out for the delayed automatic setup prompt across every role. */
  autoPromptDismissed?: boolean;
  profile: PortalProfile;
  role: AppRole;
  orders: PortalOrder[];
  rewardAccount: RewardAccount;
  rewardLedger: RewardEntry[];
  rewardActivities: string[];
  rewardCatalog: RewardCatalogItem[];
  giftCards: GiftCard[];
  paymentMethods?: PaymentMethod[];
  messages?: PortalMessage[];
  preferences?: GuestPreferences;
  membership?: Membership | null;
  setup?: PortalSetupState;
};
