/**
 * The demo order feed the board runs on: a believable morning, plus a
 * generator that keeps new orders arriving so the alert path stays live.
 */
import type { BoardOrder } from '@/features/operator/board';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function minutesAhead(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function initialDemoOrders(): BoardOrder[] {
  return [
    {
      id: 'ord-a12', shortCode: 'A12', guestName: 'Maya', status: 'ready',
      placedAt: minutesAgo(14), dailyNumber: 12, updatedAt: minutesAgo(2), scheduledFor: null,
      lines: [
        { name: 'Spanish Latte', quantity: 1, options: ['16 oz', 'Oat milk'] },
        { name: 'Croissant', quantity: 1, options: [] },
      ],
      totalCents: 1125, note: '',
      tenderType: 'square_card',
    },
    {
      id: 'ord-a13', shortCode: 'A13', guestName: 'Dev', status: 'in_progress',
      placedAt: minutesAgo(9), dailyNumber: 13, updatedAt: minutesAgo(7), scheduledFor: null,
      lines: [{ name: 'Cold Brew', quantity: 2, options: ['16 oz'] }],
      totalCents: 1050, note: 'Light ice please',
      tenderType: 'square_card',
    },
    {
      id: 'ord-a14', shortCode: 'A14', guestName: 'Rosa', status: 'in_progress',
      placedAt: minutesAgo(6), dailyNumber: 14, updatedAt: minutesAgo(5), scheduledFor: null,
      lines: [{ name: 'Honey Lavender Latte', quantity: 1, options: ['12 oz', 'Hot'] }],
      totalCents: 675, note: '',
      tenderType: 'square_card',
    },
    {
      id: 'ord-a15', shortCode: 'A15', guestName: 'Sam', status: 'paid',
      placedAt: minutesAgo(3), dailyNumber: 15, updatedAt: minutesAgo(3), scheduledFor: null,
      lines: [
        { name: 'Cortado', quantity: 1, options: [] },
        { name: 'Avocado Toast', quantity: 1, options: ['No chili'] },
      ],
      totalCents: 1400, note: '',
      tenderType: 'square_card',
    },
    {
      id: 'ord-a16', shortCode: 'A16', guestName: 'Lena', status: 'paid',
      placedAt: minutesAgo(1), dailyNumber: 16, updatedAt: minutesAgo(1), scheduledFor: minutesAhead(90),
      lines: [{ name: 'Boba Milk Tea', quantity: 4, options: ['Brown sugar'] }],
      totalCents: 2600, note: 'Team meeting at 2pm',
      tenderType: 'square_card',
    },
  ];
}

const NAMES = ['Ari', 'Noor', 'Jules', 'Kim', 'Omar', 'Priya', 'Tess', 'Yusuf'];
const ITEMS: readonly { name: string; options: readonly string[]; priceCents: number }[] = [
  { name: 'Flat White', options: ['12 oz'], priceCents: 525 },
  { name: 'Chai Latte', options: ['16 oz', 'Oat milk'], priceCents: 625 },
  { name: 'Americano', options: ['12 oz'], priceCents: 400 },
  { name: 'Matcha Latte', options: ['16 oz', 'Iced'], priceCents: 650 },
];
const DEFAULT_ITEM = ITEMS[0] ?? { name: 'Coffee', options: [], priceCents: 0 };

/** A fresh paid order, varied by index so a shift never repeats itself. */
export function spawnDemoOrder(index: number): BoardOrder {
  const item = ITEMS[index % ITEMS.length] ?? DEFAULT_ITEM;
  const quantity = (index % 3) + 1;
  return {
    id: `ord-live-${index}`,
    shortCode: `B${20 + index}`,
    guestName: NAMES[index % NAMES.length] ?? 'Guest',
    status: 'paid',
    placedAt: new Date().toISOString(),
    // Numbering continues past the opening board, the way a service date does.
    dailyNumber: 20 + index,
    updatedAt: new Date().toISOString(),
    scheduledFor: null,
    lines: [{ name: item.name, quantity, options: item.options }],
    totalCents: item.priceCents * quantity,
    note: index % 4 === 0 ? 'Extra hot' : '',
    tenderType: 'square_card',
  };
}
