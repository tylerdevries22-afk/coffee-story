import type { Session, User } from '@supabase/supabase-js';
import type { AppRole, PortalBundle } from '@platform/domain';

export type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole;
  portal: PortalBundle;
  isLoading: boolean;
  isAuthenticated: boolean;
  isDemo: boolean;
  isPasswordRecovery: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Sends the six-digit email code; creates the account on first use. */
  signInWithEmailOtp: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  /** Sends the six-digit SMS code. The phone must already be E.164. */
  signInWithPhone: (phone: string) => Promise<void>;
  verifyPhoneCode: (phone: string, code: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};
export const EMPTY_PORTAL: PortalBundle = {
  profile: { id: '', fullName: '', email: '', phone: null, birthday: null, avatarUrl: null },
  role: 'client',
  orders: [],
  rewardAccount: { availablePoints: 0, annualPoints: 0, cashCents: 0, annualPeriodStart: `${new Date().getFullYear()}-01-01` },
  rewardLedger: [],
  rewardActivities: [],
  rewardCatalog: [],
  giftCards: [],
  paymentMethods: [],
  messages: [],
  preferences: { completed: false, notes: '', strength: 'medium', updatedAt: null },
  membership: null,
};
