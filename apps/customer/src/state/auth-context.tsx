import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { recoveryCodeFromUrl, recoveryRedirectUrl } from '@/lib/auth-links';
import { mobileApi } from '@/lib/mobile-api';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
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
  appointments: [],
  rewardAccount: { availablePoints: 0, annualPoints: 0, cashCents: 0, annualPeriodStart: `${new Date().getFullYear()}-01-01` },
  rewardLedger: [],
  rewardActivities: [],
  rewardCatalog: [],
  giftCards: [],
  paymentMethods: [],
  messages: [],
  intake: { completed: false, concerns: '', pressurePreference: 'medium', consentAccepted: false, updatedAt: null },
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
      const nextPortal = await mobileApi.bootstrap();
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

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
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
    signUp,
    requestPasswordReset,
    updatePassword,
    signOut,
    refresh: () => loadPortal(session),
  }), [demo.isHydrating, demo.portal, error, isDemo, isLoading, isPasswordRecovery, livePortal, loadPortal, requestPasswordReset, session, signIn, signOut, signUp, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
