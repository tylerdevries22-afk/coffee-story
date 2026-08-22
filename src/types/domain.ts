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
  serviceName: string;
  treatmentDate: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  createdAt: string;
};

export type StaffDashboard = {
  appointments: PortalAppointment[];
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
  appointmentCount: number;
  /** Clients whose first visit landed inside the trailing week. */
  newClientCount: number;
  /** Share of clients with more than one completed visit, 0-100. */
  rebookRatePct: number;
  /** Same four figures a week earlier, for the delta chips. */
  previous?: {
    todayRevenueCents: number;
    appointmentCount: number;
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

export type StaffActionPayload =
  | {
    action: 'appointment_status';
    appointmentId: string;
    status: 'confirmed' | 'cancelled' | 'no_show';
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
    action: 'create_appointment';
    customerId: string;
    serviceSlug: string;
    startsAt: string;
    fulfillment: {
      mode: 'office';
      office: {
        id: string;
        name: string;
        address: string;
        cityLine: string;
        note: string;
      };
    } | {
      mode: 'dispatch';
      address: {
        street: string;
        unit: string;
        city: string;
        state: string;
        postalCode: string;
        instructions: string;
      };
    };
    notes: string;
    idempotencyKey: string;
  }
  | {
    action: 'soap_note';
    customerId: string;
    appointmentId?: string;
    serviceName: string;
    treatmentDate: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    focusAreas: string[];
    idempotencyKey: string;
  };
