/** Maps rule 2's statuses onto label + tone, shared by both apps' pills. */
import type { OrderStatus } from '@platform/schema';

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const STATUS_PRESENTATION: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  created: { label: 'Started', tone: 'neutral' },
  paid: { label: 'Received', tone: 'accent' },
  in_progress: { label: 'Being made', tone: 'warning' },
  ready: { label: 'Ready', tone: 'success' },
  picked_up: { label: 'Picked up', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'danger' },
};
