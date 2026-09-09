import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import type { TenantClaims } from '@platform/schema';

import {
  createRequestSequence,
  recoveryCodeFromUrl,
  type PortalBundle,
} from '@platform/domain';
import { resolveBusiness, setCurrentBusiness } from '@/data/business';
import { SELECTED_DEMO_TENANT } from '@/data/demo-tenant';
import { DEMO_OPERATIONS_ENABLED } from '@/features/operations/demo';
import { loadStaffContext, type StaffLocation } from '@/lib/live-portal';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { EMPTY_PORTAL, type AuthState } from '@/state/auth-state';
import { useDemo } from '@/state/demo-context';
import { useAuthActions } from './auth-actions';

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

  const { requestPasswordReset, signIn, signOut, updatePassword } = useAuthActions({
    setError, setIsLoading, setIsPasswordRecovery,
  });


  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    role: (isDemo ? demo.portal.role : livePortal.role),
    portal: isDemo ? demo.portal : livePortal,
    tenant: isDemo ? null : tenant,
    liveLocations: isDemo ? [] : liveLocations,
    brandName: isDemo ? demoTenant?.brandName ?? null : brandName,
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
