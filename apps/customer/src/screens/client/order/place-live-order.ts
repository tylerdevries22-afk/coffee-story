import * as Haptics from 'expo-haptics';

import { platformApi } from '@/lib/api';
import { liveOrderContext } from '@/lib/live-portal';
import { supabase } from '@/lib/supabase';
import {
  newIdempotencyKey
} from '@platform/api-client';


import { placeLiveOrderCore, type LiveOrderDependencies } from './place-live-order-core';
import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';

const liveDependencies: LiveOrderDependencies = {
  configured: Boolean(supabase && platformApi),
  loadLocationId: async () => {
    if (!supabase) return null;
    return (await liveOrderContext(supabase))?.locationId ?? null;
  },
  placeOrder: async (...args) => {
    if (!platformApi) throw new Error('Live ordering is not configured in this build.');
    return platformApi.placeOrder(...args);
  },
  createKey: newIdempotencyKey,
  notify: (feedback) => Haptics.notificationAsync(
    feedback === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Error,
  ),
};

export async function placeLiveOrder(
  state: OrderState,
  submitted: SubmittedOrder,
): Promise<void> {
  return placeLiveOrderCore(state, submitted, liveDependencies);
}
