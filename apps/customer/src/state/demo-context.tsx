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
import Constants from 'expo-constants';

import { hasCompleteLiveConfig } from '@/lib/runtime-config';
import {
  addDemoOrder,
  addDemoGift,
  addDemoMessage,
  cancelDemoOrder,
  completeDemoRewardActivity,
  createInitialDemoPortal,
  dismissDemoSetupAutoPrompt,
  redeemDemoReward,
  removeDemoPaymentMethod,
  rescheduleDemoOrder,
  reviewDemoOrder,
  setDemoRole,
  setDemoMembershipStatus,
  updateDemoIntake,
  updateDemoProfile,
  type DemoOrderInput,
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
  GuestPreferences,
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
  /**
   * False unless live mode could actually run. Measured by the same
   * `missingLiveConfig` the root layout uses -- offering the switch on a
   * weaker test let a guest persist a mode that immediately swapped the whole
   * tree for the setup-incomplete screen, with no way back.
   */
  canGoLive: boolean;
  resetDemo: () => Promise<void>;
  setRole: (role: AppRole) => void;
  book: (input: Omit<DemoOrderInput, 'id'>) => void;
  cancelAppointment: (appointmentId: string) => void;
  rescheduleAppointment: (appointmentId: string, placedAt: string) => void;
  reviewAppointment: (appointmentId: string, rating: number, note: string) => void;
  redeemReward: (reward: RewardCatalogItem) => void;
  completeActivity: (activityKey: string) => void;
  addGift: (gift: Omit<GiftCard, 'id' | 'createdAt'>) => void;
  updateProfile: (profile: PortalProfile) => void;
  updatePreferences: (preferences: GuestPreferences) => void;
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
  // Expo Go cannot run the native payment flows live mode needs, so it is
  // never the startup default there. See `parseStoredAppMode`.
  const isExpoGo = Constants.appOwnership === 'expo';
  const canGoLive = hasCompleteLiveConfig();
  const [mode, setMode] = useState<AppMode>(() => parseStoredAppMode(null, canGoLive, isExpoGo));
  const [portal, setPortal] = useState<PortalBundle>(createInitialDemoPortal);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadStoredAppMode(),
      loadStoredPortal(),
    ]).then(([storedMode, storedPortal]) => {
      if (!mounted) return;
      setMode(parseStoredAppMode(storedMode, canGoLive, isExpoGo));
      if (storedPortal) setPortal(storedPortal);
    }).finally(() => {
      if (mounted) setIsHydrating(false);
    });
    return () => {
      mounted = false;
    };
  }, [canGoLive, isExpoGo]);

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
    if (!canGoLive) throw new Error('Finish the live payment and account setup before switching.');
    setMode('live');
    await saveStoredAppMode('live');
  }, [canGoLive]);

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
    canGoLive,
    resetDemo,
    setRole: (role) => savePortal((current) => setDemoRole(current, role)),
    book: (input) => savePortal((current) => addDemoOrder(current, { ...input, id: uniqueId('appointment') })),
    cancelAppointment: (appointmentId) => savePortal((current) => cancelDemoOrder(current, appointmentId)),
    rescheduleAppointment: (appointmentId, startsAt) => savePortal((current) => (
      rescheduleDemoOrder(current, appointmentId, startsAt)
    )),
    redeemReward: (reward) => savePortal((current) => redeemDemoReward(current, reward, uniqueId('ledger'), new Date().toISOString())),
    completeActivity: (activityKey) => savePortal((current) => completeDemoRewardActivity(current, activityKey, uniqueId('ledger'), new Date().toISOString())),
    addGift: (gift) => savePortal((current) => addDemoGift(current, {
      ...gift,
      id: uniqueId('gift'),
      createdAt: new Date().toISOString(),
    })),
    reviewAppointment: (appointmentId, rating, note) => savePortal((current) => (
      reviewDemoOrder(current, appointmentId, rating, note, new Date().toISOString())
    )),
    updateProfile: (profile) => savePortal((current) => updateDemoProfile(current, profile)),
    updatePreferences: (preferences) => savePortal((current) => updateDemoIntake(current, preferences)),
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
  }), [canGoLive, chooseDemo, chooseLive, isHydrating, mode, portal, resetDemo, savePortal]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const value = useContext(DemoContext);
  if (!value) throw new Error('useDemo must be used within DemoProvider');
  return value;
}
