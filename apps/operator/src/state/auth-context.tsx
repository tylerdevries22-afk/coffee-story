import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import type { TenantClaims } from '@platform/schema';

import {
  createRequestSequence,
  recoveryCodeFromUrl,
  recoveryRedirectUrl,
  type PortalBundle,
} from '@platform/domain';
import { resolveBusiness, setCurrentBusiness } from '@/data/business';
import { SELECTED_DEMO_TENANT } from '@/data/demo-tenant';
import { wipePrintOutboxes } from '@/features/operator/print-outbox-storage';
import { printSecureStorage } from '@/features/operator/print-secure-store';
import { DEMO_OPERATIONS_ENABLED } from '@/features/operations/demo';
import { loadStaffContext, type StaffLocation } from '@/lib/live-portal';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { EMPTY_PORTAL, type AuthState } from '@/state/auth-state';
import { useDemo } from '@/state/demo-context';

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const demo = useDemo();
  const isDemo = demo.mode === 'demo';
  const demoTenant = SELECTED_DEMO_TENANT;
  const [session, setSession] = useState<Session | null>(null);
  const [livePortal, setLivePortal] = useState<PortalBundle>(EMPTY_PORTAL);
  const [tenant, setTenant] = useState<TenantClaims | null>(null);
  const [liveLocations, setLiveLocations] = useState<StaffLocation[]>([]);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [operationsEnabled, setOperationsEnabled] = useState(false);
  const [brandUserId, setBrandUserId] = useState<string | null>(null);
  const [brandConfig, setBrandConfig] = useState<unknown>(null);
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
      const context = await loadStaffContext(supabase, expectedSession);
      if (!isCurrent()) return;
      setLivePortal(context.bundle);
      setTenant(context.claims);
      setLiveLocations(context.locations);
      setBrandName(context.brandName);
      setOperationsEnabled(context.operationsEnabled);
      setBrandUserId(context.brandUserId);
      setBrandConfig(context.brandConfig);
    } catch (loadError) {
      if (!isCurrent()) return;
      setLivePortal(EMPTY_PORTAL);
      setTenant(null);
      setLiveLocations([]);
      setBrandName(null);
      setOperationsEnabled(false);
      setBrandUserId(null);
      setBrandConfig(null);
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
        setOperationsEnabled(false);
        setBrandUserId(null);
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

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl(Linking.createURL),
    });
    if (resetError) throw new Error(resetError.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    // Queued tickets carry the guest's name and their whole order, and this is
    // a shared tablet. They go before the session does, so a sign-out that
    // fails on the network still leaves nothing behind for the next person.
    await wipePrintOutboxes(AsyncStorage, printSecureStorage);
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
    tenant: isDemo ? null : tenant,
    liveLocations: isDemo ? [] : liveLocations,
    brandName: isDemo ? demoTenant?.brandName ?? null : brandName,
    // Demo DEFAULTS the capability; it does not replace the check. `isDemo ||
    // operationsEnabled` read as "demo, or else ask", which is the same
    // sentence a fail-open gate is written in: any future path that set
    // isDemo without meaning "fixtures only" would have granted operations
    // outright. `operationsEnabled` itself initialises false and is reset to
    // false on every load failure, so the live branch stays fail-closed.
    operationsEnabled: isDemo ? DEMO_OPERATIONS_ENABLED : operationsEnabled,
    brandUserId: isDemo ? 'demo-member' : brandUserId,
    brandConfig: isDemo ? demoTenant?.brandConfig ?? null : brandConfig,
    isLoading: demo.isHydrating || (!isDemo && (
      isLoading || (Boolean(session) && !livePortal.profile.id && !error)
    )),
    isAuthenticated: isDemo || Boolean(session),
    isDemo,
    isPasswordRecovery,
    error: isDemo ? null : error,
    signIn,
    requestPasswordReset,
    updatePassword,
    signOut,
    refresh: () => loadPortal(session),
  }), [brandConfig, brandName, brandUserId, demo.isHydrating, demo.portal, demoTenant, error, isDemo, isLoading, isPasswordRecovery, livePortal, liveLocations, loadPortal, operationsEnabled, requestPasswordReset, session, signIn, signOut, tenant, updatePassword]);

  // Publish the resolved shop for the plain helpers that cannot hold a hook
  // (openWebPath is called from module-level functions). Components read
  // useBusiness() instead and re-render when this changes.
  useEffect(() => {
    setCurrentBusiness(resolveBusiness({
      isDemo,
      brandConfig: value.brandConfig,
      brandName: value.brandName,
      location: value.liveLocations[0] ?? null,
    }));
  }, [isDemo, value.brandConfig, value.brandName, value.liveLocations]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
