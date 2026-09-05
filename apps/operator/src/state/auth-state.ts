import type { Session, User } from '@supabase/supabase-js';

import type { AppRole, PortalBundle } from '@platform/domain';
import type { TenantClaims } from '@platform/schema';

import type { StaffLocation } from '@/lib/live-portal';

export type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole;
  portal: PortalBundle;
  /** Hook-minted tenancy (live mode only): brand, role, claimed locations. */
  tenant: TenantClaims | null;
  /** The locations this account may work (live mode; demo uses its roster). */
  liveLocations: StaffLocation[];
  brandName: string | null;
  operationsEnabled: boolean;
  brandUserId: string | null;
  /** brand_config from the signed-in brand row: tokens, copy, business. */
  brandConfig: unknown;
  isLoading: boolean;
  isAuthenticated: boolean;
  isDemo: boolean;
  isPasswordRecovery: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const EMPTY_PORTAL: PortalBundle = {
  profile: { id: '', fullName: '', email: '', phone: null, birthday: null, avatarUrl: null },
  role: 'staff',
  orders: [],
  rewardAccount: {
    availablePoints: 0,
    annualPoints: 0,
    cashCents: 0,
    annualPeriodStart: `${new Date().getFullYear()}-01-01`,
  },
  rewardLedger: [],
  rewardActivities: [],
  rewardCatalog: [],
  giftCards: [],
  paymentMethods: [],
  messages: [],
  preferences: { completed: false, notes: '', strength: 'medium', updatedAt: null },
  membership: null,
};
