import { createContext, useContext } from 'react';

import type { OrderStatus } from '@platform/schema';
import type { BoardOrder } from '@/features/operator/board';
import type { OperatorConflict } from '@/state/operator-conflicts';
import type { OperatorLocation } from '@/state/operator-locations';

export type OperatorSettings = {
  newOrderAlert: boolean;
  kdsMode: boolean;
  printerEnabled: boolean;
};

/** The result of an awaited cancel/refund, so the sheet that started it can
 * tell a rejection from a confirmation instead of assuming success. */
export type ActionOutcome = { ok: true } | { ok: false; message: string };

export type OperatorState = {
  orders: BoardOrder[];
  /** True once the first fetch (or realtime snapshot) has resolved, so an
   * empty column can be told apart from one still loading. */
  ordersLoaded: boolean;
  unseenIds: ReadonlySet<string>;
  markSeen: () => void;
  advance: (orderId: string, to: OrderStatus) => void;
  refund: (orderId: string, amountCents: number | 'full') => Promise<ActionOutcome>;
  cancel: (orderId: string) => Promise<ActionOutcome>;
  location: OperatorLocation;
  setLocation: (location: OperatorLocation) => void;
  locations: readonly OperatorLocation[];
  locationReady: boolean;
  settings: OperatorSettings;
  updateSettings: (patch: Partial<OperatorSettings>) => void;
  menuItems: readonly { slug: string; name: string }[];
  eightySixed: ReadonlySet<string>;
  toggleEightySix: (itemId: string) => void;
  orderingPaused: boolean;
  setOrderingPaused: (paused: boolean) => void;
  hoursOverride: string;
  setHoursOverride: (note: string) => void;
  conflicts: readonly OperatorConflict[];
  dismissConflict: (id: string) => void;
};

export const OperatorContext = createContext<OperatorState | null>(null);

export function useOperator(): OperatorState {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator requires OperatorProvider');
  return context;
}
