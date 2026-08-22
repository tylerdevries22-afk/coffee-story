/**
 * Demo drop calendar. Dates are relative to "today" so the demo always shows
 * a live drop with a running countdown, whatever day it is opened.
 */
import type { Drop } from '@/features/drops';

function daysFromNow(days: number, hour = 8): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

export function demoDrops(): Drop[] {
  return [
    {
      id: 'drop-honey-lav',
      itemId: 'honey-lavender-latte',
      title: 'Honey Lavender Latte',
      blurb: 'Local honey, house lavender syrup, back for one week only.',
      startsAt: daysFromNow(-2),
      endsAt: daysFromNow(5),
    },
    {
      id: 'drop-medina-mocha',
      itemId: 'biscoff-latte',
      title: 'Biscoff Latte',
      blurb: 'Cookie butter and espresso. The drop that started the tradition.',
      startsAt: daysFromNow(-16),
      endsAt: daysFromNow(-9),
    },
    {
      id: 'drop-cardamom-cold-brew',
      itemId: 'cold-brew',
      title: 'Cardamom Cold Brew',
      blurb: 'Slow-steeped, spiced, gone in a weekend.',
      startsAt: daysFromNow(-30),
      endsAt: daysFromNow(-27),
    },
    {
      id: 'drop-next-week',
      itemId: 'spanish-latte',
      title: 'Toasted Sesame Spanish Latte',
      blurb: 'Next week. Set a reminder.',
      startsAt: daysFromNow(7),
      endsAt: daysFromNow(12),
    },
  ];
}
