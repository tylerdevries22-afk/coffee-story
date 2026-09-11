import { createContext, useContext } from 'react';

import { DISABLED_OPERATIONS, type OperationsState } from '@/state/operations-state';

export const OperationsContext = createContext<OperationsState | null>(null);

export function useOperations(): OperationsState {
  return useContext(OperationsContext) ?? DISABLED_OPERATIONS;
}
