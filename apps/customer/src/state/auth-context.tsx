import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { Platform } from 'react-native';

import { platformApi } from '@/lib/api';
import { recoveryCodeFromUrl, recoveryRedirectUrl } from '@/lib/auth-links';
import { loadLivePortal } from '@/lib/live-portal';
import { registerForPush } from '@/lib/push';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { TENANT } from '@/tenant';
import { useDemo } from '@/state/demo-context';
import { createRequestSequence } from '@/state/request-sequence';
import type { AppRole, PortalBundle } from '@/types/domain';

type AuthState = {
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

const AuthContext = createContext<AuthState | null>(null);

const EMPTY_PORTAL: PortalBundle = {
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

export function AuthProvider({ children }: PropsWithChildren) {
  const demo = useDemo();
  const isDemo = demo.mode === 'demo';
  const [session, setSession] = useState<Session | null>(null);
  const [livePortal, setLivePortal] = useState<PortalBundle>(EMPTY_PORTAL);
  const [isLoading, setIsLoading] = useState(demo.isHydrating || (!isDemo && hasSupabaseConfig));
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portalRequests = useRef(createRequestSequence());
  const sessionRef = useRef<Session | null>(null);

  const loadPortal = useCallback(async (expectedSession?: Session | null) => {
    const requestId = portalRequests.current.begin();
    const expectedUserId = expectedSession?.user.id ?? null;
    const isCurrent = () => portalRequests.current.isCurrent(requestId)
      && (sessionRef.current?.user.id ?? null) === expectedUserId;
    if (isDemo) {
      if (isCurrent()) setIsLoading(false);
      return;
    }
    if (!hasSupabaseConfig) {
      if (!isCurrent()) return;
      setError('Supabase is not configured. Switch to demo mode to continue.');
      setLivePortal(EMPTY_PORTAL);
      setIsLoading(false);
      return;
    }
    setError(null);
    try {
      if (!supabase || !expectedSession) {
        if (isCurrent()) setIsLoading(false);
        return;
      }
      const metadata = expectedSession.user.user_metadata as { full_name?: string } | null;
      const nextPortal = await loadLivePortal(supabase, {
        id: expectedSession.user.id,
        email: expectedSession.user.email ?? null,
        fullName: metadata?.full_name ?? '',
      });
      if (!isCurrent()) return;
      setLivePortal(nextPortal);
    } catch (loadError) {
      if (!isCurrent()) return;
      setLivePortal(EMPTY_PORTAL);
      setError(loadError instanceof Error ? loadError.message : 'Your account could not be loaded.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    if (demo.isHydrating) return undefined;
    if (isDemo) {
      return undefined;
    }
    let mounted = true;
    const requestSequence = portalRequests.current;
    if (!supabase) {
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const currentUserId = sessionRef.current?.user.id ?? null;
      const restoredUserId = data.session?.user.id ?? null;
      if (currentUserId !== null && currentUserId !== restoredUserId) return;
      sessionRef.current = data.session;
      setSession(data.session);
      if (data.session) void loadPortal(data.session);
      else setIsLoading(false);
    }).catch(() => {
      if (mounted) {
        setError('Your secure session could not be restored.');
        setIsLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (nextSession) void loadPortal(nextSession);
      else {
        portalRequests.current.invalidate();
        setLivePortal(EMPTY_PORTAL);
        setIsLoading(false);
      }
    });
    return () => {
      mounted = false;
      requestSequence.invalidate();
      listener.subscription.unsubscribe();
    };
  }, [demo.isHydrating, isDemo, loadPortal]);

  useEffect(() => {
    if (!supabase) return undefined;
    const authClient = supabase;
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const code = recoveryCodeFromUrl(url);
      if (!code) return;
      const { error: sessionError } = await authClient.auth.exchangeCodeForSession(code);
      if (sessionError) setError('This recovery link is invalid or has expired.');
      else setIsPasswordRecovery(true);
    };
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setIsLoading(false);
      throw new Error(signInError.message);
    }
  }, []);

  // Ask for push permission once a real session exists -- never in Demo,
  // never in Expo Go (lib/push guards both). The token registers with the
  // platform API so order-status pushes reach this device; a failed
  // registration is logged and retried on the next session change.
  useEffect(() => {
    if (isDemo || !session) return;
    let active = true;
    void registerForPush().then(async (token) => {
      if (!active || !token || !platformApi) return;
      try {
        await platformApi.registerPushToken({
          token,
          platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
            ? Platform.OS
            : 'unknown',
        });
      } catch (registerError) {
        console.warn('Push token registration failed', registerError instanceof Error ? registerError.message : registerError);
      }
    });
    return () => {
      active = false;
    };
  }, [isDemo, session]);

  // Every OTP path carries brand_slug: the claims hook bootstraps a brand-new
  // user's tenancy claim from it, validated against brands.slug server-side.
  const signInWithEmailOtp = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, data: { brand_slug: TENANT.identity.slug } },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    if (verifyError) throw new Error(verifyError.message);
  }, []);

  const signInWithPhone = useCallback(async (phone: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone,
      options: { data: { brand_slug: TENANT.identity.slug } },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, code: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (verifyError) throw new Error(verifyError.message);
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), brand_slug: TENANT.identity.slug } },
    });
    setIsLoading(false);
    if (signUpError) throw new Error(signUpError.message);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl(Linking.createURL),
    });
    if (resetError) throw new Error(resetError.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(signOutError.message);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw new Error(updateError.message);
    setIsPasswordRecovery(false);
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    role: (isDemo ? demo.portal.role : livePortal.role),
    portal: isDemo ? demo.portal : livePortal,
    isLoading: demo.isHydrating || (!isDemo && (
      isLoading || (Boolean(session) && !livePortal.profile.id && !error)
    )),
    isAuthenticated: isDemo || Boolean(session),
    isDemo,
    isPasswordRecovery,
    error: isDemo ? null : error,
    signIn,
    signInWithEmailOtp,
    verifyEmailCode,
    signInWithPhone,
    verifyPhoneCode,
    signUp,
    requestPasswordReset,
    updatePassword,
    signOut,
    refresh: () => loadPortal(session),
  }), [demo.isHydrating, demo.portal, error, isDemo, isLoading, isPasswordRecovery, livePortal, loadPortal, requestPasswordReset, session, signIn, signInWithEmailOtp, signInWithPhone, signOut, signUp, updatePassword, verifyEmailCode, verifyPhoneCode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
