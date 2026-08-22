import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { withRoleSetup, type AnyRoleSetup } from '@/features/setup/setup';
import { hasSupabaseConfig } from '@/lib/supabase';
import {
  addDemoBooking,
  addDemoGift,
  addDemoMessage,
  cancelDemoAppointment,
  completeDemoRewardActivity,
  createInitialDemoPortal,
  dismissDemoSetupAutoPrompt,
  redeemDemoReward,
  removeDemoPaymentMethod,
  rescheduleDemoAppointment,
  reviewDemoAppointment,
  setDemoRole,
  setDemoMembershipStatus,
  updateDemoIntake,
  updateDemoProfile,
  type DemoBookingInput,
} from '@/state/demo-state';
import {
  loadStoredAppMode,
  loadStoredPortal,
  parseStoredAppMode,
  resetStoredDemoPortal,
  saveStoredAppMode,
  saveStoredPortal,
} from '@/state/demo-storage';
import type {
  GiftCard,
  AppRole,
  IntakeProfile,
  PortalBundle,
  PortalProfile,
  RewardCatalogItem,
} from '@/types/domain';

export type AppMode = 'demo' | 'live';

type DemoState = {
  mode: AppMode;
  isHydrating: boolean;
  portal: PortalBundle;
  chooseDemo: () => Promise<void>;
  chooseLive: () => Promise<void>;
  /** False when the build carries no Supabase credentials to sign in against. */
  canGoLive: boolean;
  resetDemo: () => Promise<void>;
  setRole: (role: AppRole) => void;
  book: (input: Omit<DemoBookingInput, 'id'>) => void;
  cancelAppointment: (appointmentId: string) => void;
  rescheduleAppointment: (appointmentId: string, startsAt: string) => void;
  reviewAppointment: (appointmentId: string, rating: number, note: string) => void;
  redeemReward: (reward: RewardCatalogItem) => void;
  completeActivity: (activityKey: string) => void;
  addGift: (gift: Omit<GiftCard, 'id' | 'createdAt'>) => void;
  updateProfile: (profile: PortalProfile) => void;
  updateIntake: (intake: IntakeProfile) => void;
  sendMessage: (body: string) => void;
  removePaymentMethod: (methodId: string) => void;
  setMembershipStatus: (status: 'active' | 'paused' | 'cancelled') => void;
  updateSetup: (role: AppRole, setup: AnyRoleSetup) => void;
  dismissSetupAutoPrompt: () => void;
};

const DemoContext = createContext<DemoState | null>(null);

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DemoProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<AppMode>(() => parseStoredAppMode(null, hasSupabaseConfig));
  const [portal, setPortal] = useState<PortalBundle>(createInitialDemoPortal);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadStoredAppMode(),
      loadStoredPortal(),
    ]).then(([storedMode, storedPortal]) => {
      if (!mounted) return;
      setMode(parseStoredAppMode(storedMode, hasSupabaseConfig));
      if (storedPortal) setPortal(storedPortal);
    }).finally(() => {
      if (mounted) setIsHydrating(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const savePortal = useCallback((transform: (current: PortalBundle) => PortalBundle) => {
    setPortal((current) => {
      const next = transform(current);
      void saveStoredPortal(next).catch((persistError: unknown) => {
        console.warn('Demo portal changes could not be saved and will not survive a restart.', persistError);
      });
      return next;
    });
  }, []);

  const chooseDemo = useCallback(async () => {
    setMode('demo');
    await saveStoredAppMode('demo');
  }, []);

  const chooseLive = useCallback(async () => {
    if (!hasSupabaseConfig) throw new Error('Connect Supabase before switching to live mode.');
    setMode('live');
    await saveStoredAppMode('live');
  }, []);

  const resetDemo = useCallback(async () => {
    setMode('demo');
    setPortal(await resetStoredDemoPortal());
  }, []);

  const value = useMemo<DemoState>(() => ({
    mode,
    isHydrating,
    portal,
    chooseDemo,
    chooseLive,
    canGoLive: hasSupabaseConfig,
    resetDemo,
    setRole: (role) => savePortal((current) => setDemoRole(current, role)),
    book: (input) => savePortal((current) => addDemoBooking(current, { ...input, id: uniqueId('appointment') })),
    cancelAppointment: (appointmentId) => savePortal((current) => cancelDemoAppointment(current, appointmentId)),
    rescheduleAppointment: (appointmentId, startsAt) => savePortal((current) => (
      rescheduleDemoAppointment(current, appointmentId, startsAt)
    )),
    redeemReward: (reward) => savePortal((current) => redeemDemoReward(current, reward, uniqueId('ledger'), new Date().toISOString())),
    completeActivity: (activityKey) => savePortal((current) => completeDemoRewardActivity(current, activityKey, uniqueId('ledger'), new Date().toISOString())),
    addGift: (gift) => savePortal((current) => addDemoGift(current, {
      ...gift,
      id: uniqueId('gift'),
      createdAt: new Date().toISOString(),
    })),
    reviewAppointment: (appointmentId, rating, note) => savePortal((current) => (
      reviewDemoAppointment(current, appointmentId, rating, note, new Date().toISOString())
    )),
    updateProfile: (profile) => savePortal((current) => updateDemoProfile(current, profile)),
    updateIntake: (intake) => savePortal((current) => updateDemoIntake(current, intake)),
    sendMessage: (body) => savePortal((current) => addDemoMessage(current, {
      id: uniqueId('message'),
      sender: 'client',
      body: body.trim(),
      sentAt: new Date().toISOString(),
      read: true,
    })),
    removePaymentMethod: (methodId) => savePortal((current) => removeDemoPaymentMethod(current, methodId)),
    setMembershipStatus: (status) => savePortal((current) => setDemoMembershipStatus(current, status)),
    updateSetup: (role, setup) => savePortal((current) => withRoleSetup(current, role, setup)),
    dismissSetupAutoPrompt: () => savePortal(dismissDemoSetupAutoPrompt),
  }), [chooseDemo, chooseLive, isHydrating, mode, portal, resetDemo, savePortal]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const value = useContext(DemoContext);
  if (!value) throw new Error('useDemo must be used within DemoProvider');
  return value;
}
