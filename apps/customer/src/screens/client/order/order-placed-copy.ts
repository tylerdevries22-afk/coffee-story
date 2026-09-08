import type { OrderStatus } from '@platform/schema';

type PickupWindow = { dayLabel: string; timeLabel: string } | null;

export function orderPlacedCopy(input: {
  status: OrderStatus;
  isDelivery: boolean;
  guestName: string;
  window: PickupWindow;
  pointsEarned: number;
  pointsLabel: string;
}) {
  if (input.status === 'cancelled') {
    return {
      title: 'Order cancelled',
      detail: 'This order was cancelled before preparation.',
      paymentLabel: 'Cancelled',
      pointsNote: `${input.pointsEarned} ${input.pointsLabel} were not added to your account.`,
    };
  }
  if (input.status === 'refunded') {
    return {
      title: 'Order refunded',
      detail: 'The payment for this order was refunded.',
      paymentLabel: 'Refunded',
      pointsNote: `Any ${input.pointsLabel} earned from this order were reversed.`,
    };
  }
  return {
    title: input.isDelivery ? 'On its way' : 'We’ll have it ready',
    detail: input.window
      ? `${input.isDelivery ? 'Delivering' : 'Ready for'} ${input.guestName || 'you'} ${input.window.dayLabel.toLowerCase()}, ${input.window.timeLabel}.`
      : `Thanks, ${input.guestName || 'friend'}.`,
    paymentLabel: input.status === 'created' ? 'Due at counter' : 'Paid',
    pointsNote: `${input.pointsEarned} ${input.pointsLabel} land on your account once the shop confirms the order.`,
  };
}
