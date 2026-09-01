import type { ChannelRevenueCents, KpiDay } from './demo-data';

export type ChannelMixRow = {
  readonly key: keyof ChannelRevenueCents;
  readonly label: string;
  readonly revenueCents: number;
  readonly share: number;
};

const CHANNEL_LABELS: Record<keyof ChannelRevenueCents, string> = {
  app: 'Customer app',
  web: 'Web ordering',
  kiosk: 'Kiosk',
  pos: 'Point of sale',
};

/** Ranked, part-to-whole channel data for the overview's accessible bar view. */
export function buildChannelMix(channels: ChannelRevenueCents): ChannelMixRow[] {
  const total = Object.values(channels).reduce((sum, value) => sum + value, 0);
  return (Object.entries(channels) as [keyof ChannelRevenueCents, number][])
    .map(([key, revenueCents]) => ({
      key,
      label: CHANNEL_LABELS[key],
      revenueCents,
      share: total === 0 ? 0 : revenueCents / total,
    }))
    .sort((left, right) => right.revenueCents - left.revenueCents);
}

function dateAtNoonUtc(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** Short reporting range copied into the dashboard header. */
export function formatKpiRange(days: readonly KpiDay[]): string {
  const values = [...new Set(days.map((day) => day.day))].sort();
  const first = values[0];
  const last = values.at(-1);
  if (!first || !last) return 'No reporting period';
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const withYear = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  if (first === last) return withYear.format(dateAtNoonUtc(first));
  const firstDate = dateAtNoonUtc(first);
  const lastDate = dateAtNoonUtc(last);
  const firstLabel = firstDate.getUTCFullYear() === lastDate.getUTCFullYear()
    ? monthDay.format(firstDate)
    : withYear.format(firstDate);
  return `${firstLabel} – ${withYear.format(lastDate)}`;
}

/** Number of distinct calendar days represented across every location. */
export function coverageDays(days: readonly KpiDay[]): number {
  return new Set(days.map((day) => day.day)).size;
}
