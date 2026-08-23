import type { OrderStatus } from '@platform/schema';

export type AppRole = 'client' | 'staff' | 'admin';

export type SetupStatus = 'not_started' | 'in_progress' | 'completed';

export type ClientSetupAnswers = {
  goals: string[];
  pressure: 'light' | 'medium' | 'bold';
  preferredTimes: string[];
};

export type StaffSetupAnswers = {
  specialties: string[];
  workingDays: string[];
};

export type AdminSetupAnswers = {
  businessName: string;
  openDays: string[];
  menuConfirmed: boolean;
  teamConfirmed: boolean;
  onlineOrdering: boolean;
};

export type RoleSetup<Answers> = {
  status: SetupStatus;
  step: number;
  answers: Answers;
};

/** Per-persona onboarding progress; mirrors the web portal's setup flow. */
export type PortalSetupState = {
  client: RoleSetup<ClientSetupAnswers>;
  staff: RoleSetup<StaffSetupAnswers>;
  admin: RoleSetup<AdminSetupAnswers>;
};

export type PortalProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  birthday: string | null;
  avatarUrl: string | null;
};

export type OrderSource = 'website' | 'directory' | 'campaign' | 'staff';

export type PortalOrderLine = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  options: readonly string[];
};

/**
 * An order, carrying rule 2's status. Both planes speak this now -- the demo
 * reducer and the live plane (orders + order_events under RLS) produce the
 * same shape, so a screen cannot tell them apart.
 */
export type PortalOrder = {
  id: string;
  status: OrderStatus;
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

export type OrderableItem = {
  slug: string;
  name: string;
  category: 'signature' | 'specialty';
  /** Drink size. Absent for anything not poured -- food has one size. */
  ounces?: number;
  /** Prep estimate, in minutes. Feeds the pickup window, not the price. */
  durationMin: number;
  priceCents: number;
  depositCents: number;
  description?: string;
};

export type OrderableAddOn = {
  slug: string;
  name: string;
  priceCents: number;
  durationMin: number;
  description: string;
};

export type OrderableCatalog = {
  items: OrderableItem[];
  addOns: OrderableAddOn[];
};

export type StaffClient = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  completedOrders: number;
  /** Care segments used by the workspace filter chips. */
  tags?: string[];
  /** Lifetime completed spend, in cents. */
  lifetimeSpendCents?: number;
  /** ISO timestamp of the most recent completed order. */
  lastOrderAt?: string | null;
};

/**
 * A barista's note about a regular -- "prefers oat, no nuts", "always the 20oz".
 *
 * This replaces a SOAP record (subjective / objective / assessment / plan),
 * which the appointment business kept and which every label already pretended
 * was an order note. The portal that still spoke those four fields is gone
 * (mobile-api's methods are stubs), so nothing was holding the shape in place
 * except the comment saying it was.
 */
export type GuestNote = {
  id: string;
  customerId: string;
  note: string;
  authorName: string;
  createdAt: string;
};

export type StaffDashboard = {
  orders: PortalOrder[];
  clients: StaffClient[];
  projectedCents: number;
  openMinutes: number;
  promptForTip?: boolean;
  guestNotes?: GuestNote[];
  /**
   * Workspace headline figures. Optional so a server that predates the
   * staff-parity release simply renders fewer tiles instead of zeroes.
   */
  metrics?: StaffWorkspaceMetrics;
  recentPayments?: StaffPayment[];
  reputation?: StaffReputation;
};

export type StaffWorkspaceMetrics = {
  todayRevenueCents: number;
  orderCount: number;
  /** Clients whose first order landed inside the trailing week. */
  newClientCount: number;
  /** Share of clients with more than one completed order, 0-100. */
  rebookRatePct: number;
  /** Same four figures a week earlier, for the delta chips. */
  previous?: {
    todayRevenueCents: number;
    orderCount: number;
    newClientCount: number;
    rebookRatePct: number;
  };
  /** Trailing seven days of completed revenue, oldest first. */
  revenueTrend?: { label: string; cents: number }[];
  /** Order counts grouped by where the order came from. */
  orderSources?: { source: OrderSource; count: number }[];
};

export type StaffPayment = {
  id: string;
  guestName: string;
  itemName: string;
  method: 'card' | 'cash' | 'gift_card';
  amountCents: number;
  paidAt: string;
};

export type StaffReputation = {
  score: number;
  reviewCount: number;
};

export type StaffAvailabilityDay = {
  weekday: number;
  label: string;
  enabled: boolean;
  startMin: number;
  endMin: number;
};

export type StaffSettings = {
  availability: StaffAvailabilityDay[];
  onlineOrderingEnabled: boolean;
  requireAccountToBook: boolean;
  waitlistEnabled: boolean;
  leadTimeMinutes: number;
  cancellationHours: number;
  requireDeposit: boolean;
  promptForTip: boolean;
  storeCardOnFile: boolean;
  reviewRequestEnabled: boolean;
};


/**
 * A write the operator app sends on a staff member's behalf.
 *
 * Lives in the shared domain because the staff surfaces and the API client
 * both need its exact shape; the customer binary imports none of it, which
 * architecture rule 7 requires and its bundle demonstrates.
 *
 * The 'soap_note' action is gone. SOAP notes are a clinical record from the
 * appointment business this tree forked out of -- a coffee shop takes no
 * subjective/objective/assessment/plan on anyone, and an admin opening
 * Settings should never be offered the option.
 */
export type StaffActionPayload =
  | {
    action: 'order_status';
    orderId: string;
    status: 'paid' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled';
    idempotencyKey: string;
  }
  | {
    action: 'block_time';
    startsAt: string;
    endsAt: string;
    reason: string;
    idempotencyKey: string;
  }
  | {
    action: 'create_order';
    customerId: string;
    itemSlug: string;
    scheduledFor: string;
    fulfillment: OrderFulfillmentPayload;
    notes: string;
    idempotencyKey: string;
  };

/** The fulfillment half of a staff-created order, as it crosses the wire. */
export type OrderFulfillmentPayload =
  | {
    mode: 'pickup';
    location: { id: string; name: string; address: string; cityLine: string; note: string };
  }
  | {
    mode: 'delivery';
    address: {
      street: string; unit: string; city: string; state: string;
      postalCode: string; instructions: string;
    };
  };

