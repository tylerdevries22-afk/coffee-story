import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { Platform } from 'react-native';

import { platformApi } from '@/lib/api';
import { createRequestSequence, recoveryCodeFromUrl } from '@platform/domain';
import { loadLivePortal } from '@/lib/live-portal';
import { registerForPush } from '@/lib/push';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useDemo } from '@/state/demo-context';
import type { PortalBundle } from '@platform/domain';

import { EMPTY_PORTAL, type AuthState } from './customer-auth-state';
import { useAuthActions } from './use-auth-actions';

const AuthContext = createContext<AuthState | null>(null);

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

  // Ask for push permission once a real session exists -- never in Demo,
  // never in Expo Go (lib/push guards both). A failed registration retries on
  // the next session change.
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
    return () => { active = false; };
  }, [isDemo, session]);

  const {
    requestPasswordReset, signIn, signInWithEmailOtp, signInWithPhone, signOut, signUp,
    updatePassword, verifyEmailCode, verifyPhoneCode,
  } = useAuthActions({ setError, setIsLoading, setIsPasswordRecovery });

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
