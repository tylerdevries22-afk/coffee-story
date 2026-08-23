import type { OrderStatus } from '@platform/schema';

export type AppRole = 'client' | 'staff' | 'admin';

export type SetupStatus = 'not_started' | 'in_progress' | 'completed';

export type ClientSetupAnswers = {
  goals: string[];
  pressure: 'light' | 'medium' | 'firm';
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
  onlineBooking: boolean;
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

export type BookingSource = 'website' | 'directory' | 'campaign' | 'staff';

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

export type IntakeProfile = {
  completed: boolean;
  concerns: string;
  pressurePreference: 'light' | 'medium' | 'firm';
  consentAccepted: boolean;
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
  intake?: IntakeProfile;
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
  services: OrderableItem[];
  addOns: OrderableAddOn[];
};

export type StaffClient = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  completedVisits: number;
  /** Care segments used by the workspace filter chips. */
  tags?: string[];
  /** Lifetime completed spend, in cents. */
  lifetimeSpendCents?: number;
  /** ISO timestamp of the most recent completed visit. */
  lastVisitAt?: string | null;
};

/**
 * A note the bar keeps against a regular's order.
 *
 * The name and the four field names are the portal API's, inherited from the
 * clinical SOAP record this app was rebranded from. The server still speaks
 * them, so they stay; every label a person reads says "order note" instead --
 * see `screens/staff/clients-screen.tsx`.
 */
export type StaffSoapNote = {
  id: string;
  customerId: string;
  summary: string;
  treatmentDate: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  createdAt: string;
};

export type StaffDashboard = {
  orders: PortalOrder[];
  clients: StaffClient[];
  projectedCents: number;
  openMinutes: number;
  promptForTip?: boolean;
  soapNotes?: StaffSoapNote[];
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
  /** Clients whose first visit landed inside the trailing week. */
  newClientCount: number;
  /** Share of clients with more than one completed visit, 0-100. */
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
  /** Booking counts grouped by where the visit came from. */
  bookingSources?: { source: BookingSource; count: number }[];
};

export type StaffPayment = {
  id: string;
  clientName: string;
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
  onlineBookingEnabled: boolean;
  requireAccountToBook: boolean;
  waitlistEnabled: boolean;
  leadTimeMinutes: number;
  cancellationHours: number;
  requireDeposit: boolean;
  promptForTip: boolean;
  storeCardOnFile: boolean;
  reviewRequestEnabled: boolean;
};

