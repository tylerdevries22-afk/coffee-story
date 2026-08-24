/**
 * Customer-facing order tracking: rule 2's statuses presented as a timeline.
 * The live subscription is in `lib/realtime-orders.ts`; the demo simulator
 * advances through the same model so both paths render identically.
 */
import type { OrderStatus } from '@platform/schema';

export type TrackingStep = {
  status: OrderStatus;
  title: string;
  detail: string;
};

/** The steps a guest watches, in order. Terminal failures replace the tail. */
export const TRACKING_STEPS: readonly TrackingStep[] = [
  { status: 'created', title: 'Awaiting payment', detail: 'Pay at the counter before the shop starts your order.' },
  { status: 'paid', title: 'Order received', detail: 'The shop has your order.' },
  { status: 'in_progress', title: 'Being made', detail: 'The bar is on it.' },
  { status: 'ready', title: 'Ready for pickup', detail: 'Come and get it while it is hot.' },
  { status: 'picked_up', title: 'Picked up', detail: 'Enjoy.' },
] as const;

export type TrackingView = {
  steps: readonly TrackingStep[];
  /** Index into steps of the current state. */
  activeIndex: number;
  failed: 'cancelled' | 'refunded' | null;
};

export function trackingView(status: OrderStatus): TrackingView {
  if (status === 'cancelled' || status === 'refunded') {
    return { steps: TRACKING_STEPS, activeIndex: -1, failed: status };
  }
  const activeIndex = TRACKING_STEPS.findIndex((step) => step.status === status);
  return { steps: TRACKING_STEPS, activeIndex, failed: null };
}

/**
 * Demo progression: paid -> in_progress -> ready, on believable delays.
 * Injected timers keep it reachable from node:test.
 */
export function simulateProgress(
  onStatus: (status: OrderStatus) => void,
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  timers.push(schedule(() => onStatus('in_progress'), 6_000));
  timers.push(schedule(() => onStatus('ready'), 26_000));
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
