import { createContext, useContext } from 'react';

import type { OrderStatus } from '@platform/schema';
import type { BoardOrder } from '@/features/operator/board';
import type { OperatorLocation } from '@/state/operator-locations';

export type OperatorSettings = {
  newOrderAlert: boolean;
  kdsMode: boolean;
  printerEnabled: boolean;
};

export type OperatorState = {
  orders: BoardOrder[];
  unseenIds: ReadonlySet<string>;
  markSeen: () => void;
  advance: (orderId: string, to: OrderStatus) => void;
  refund: (orderId: string, amountCents: number | 'full') => void;
  cancel: (orderId: string) => void;
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
  conflicts: readonly { orderId: string; message: string }[];
};

export const OperatorContext = createContext<OperatorState | null>(null);

export function useOperator(): OperatorState {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator requires OperatorProvider');
  return context;
}
