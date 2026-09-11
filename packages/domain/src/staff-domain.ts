import type { OrderSource, PortalOrder } from './portal-commerce';

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
