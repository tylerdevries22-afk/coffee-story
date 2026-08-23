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
  servicesConfirmed: boolean;
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

export type PortalAppointment = {
  id: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  subtotalCents: number;
  depositCents: number;
  balanceCents: number;
  clientName?: string;
  fulfillmentMode?: 'office' | 'dispatch';
  locationLabel?: string;
  locationDetail?: string;
  /**
   * Client's post-visit review. Optional because the live portal only populates
   * it once a review exists; the demo reducer mirrors the same shape so preview
   * mode can show a saved review instead of silently discarding it.
   */
  review?: { rating: number; note: string; submittedAt: string };
  /**
   * Workspace provenance. Optional throughout because a server that predates
   * the staff-parity migration omits them and every surface hides the badge
   * rather than inventing a value.
   */
  bookingSource?: BookingSource;
  /** Room reset minutes reserved after the visit. */
  recoveryMinutes?: number;
  /** True when this is the client's first visit on record. */
  isNewClient?: boolean;
  /** Barista the order is assigned to. */
  staffName?: string;
};

export type BookingSource = 'website' | 'directory' | 'campaign' | 'staff';

export type PortalOrderLine = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  options: readonly string[];
};

/**
 * A real order from the live plane (orders + order_events under RLS),
 * carrying rule 2's status. The live bundle populates `PortalBundle.orders`
 * with these; the demo plane still speaks PortalAppointment until its
 * screens migrate.
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
  status: 'pending' | 'funded' | 'delivered' | 'claimed' | 'depleted' | 'void';
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
  appointments: PortalAppointment[];
  /** Live-plane orders. Absent in the demo bundle (appointments carry demo state). */
  orders?: PortalOrder[];
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

export type BookingService = {
  slug: string;
  name: string;
  category: 'signature' | 'therapeutic' | 'specialty';
  durationMin: number;
  priceCents: number;
  depositCents: number;
  description?: string;
};

export type BookingAddOn = {
  slug: string;
  name: string;
  priceCents: number;
  durationMin: number;
  description: string;
};

export type BookingCatalog = {
  services: BookingService[];
  addOns: BookingAddOn[];
};
