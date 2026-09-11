import { createContext } from 'react';

import type { AnyRoleSetup } from '@/features/setup/setup';
import type { DemoOrderInput } from '@/state/demo-state';
import type {
  AppRole,
  GiftCard,
  GuestPreferences,
  PortalBundle,
  PortalOrder,
  PortalProfile,
  RewardCatalogItem,
} from '@platform/domain';

export type AppMode = 'demo' | 'live';

export type DemoState = {
  mode: AppMode;
  isHydrating: boolean;
  portal: PortalBundle;
  chooseDemo: () => Promise<void>;
  chooseLive: () => Promise<void>;
  canGoLive: boolean;
  resetDemo: () => Promise<void>;
  setRole: (role: AppRole) => void;
  book: (input: Omit<DemoOrderInput, 'id'>) => void;
  bookSynced: (order: PortalOrder) => void;
  cancelOrder: (orderId: string) => Promise<void>;
  rescheduleOrder: (orderId: string, placedAt: string) => void;
  reviewOrder: (orderId: string, rating: number, note: string) => void;
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

export const DemoContext = createContext<DemoState | null>(null);
