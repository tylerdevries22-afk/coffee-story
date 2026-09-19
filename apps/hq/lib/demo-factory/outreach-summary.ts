/**
 * The outreach window as the console shows it: one row per UTC day, newest
 * first, with how many demos that day built and how many of them have a
 * draft. Counting needs no sender or link, so the console can say what is
 * waiting even before the settings that let it be exported are in place.
 */
import { OUTREACH_DAYS } from './outreach-data';
import { outreachSkip, type OutreachSite, type OutreachSkip } from './outreach-draft';

const DAY_MS = 86_400_000;

export type OutreachDaySummary = {
  readonly day: string;
  readonly built: number;
  readonly drafts: number;
  readonly skipped: Readonly<Record<OutreachSkip, number>>;
};

/** The window's days, newest first: today (UTC) and the thirteen before it. */
export function outreachWindow(now = new Date()): string[] {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Array.from({ length: OUTREACH_DAYS }, (_, back) => new Date(today - back * DAY_MS).toISOString().slice(0, 10));
}

/** The first and last day of the window, for the one read that covers it. */
export function outreachRange(now = new Date()): { readonly from: string; readonly to: string } {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return {
    from: new Date(today - (OUTREACH_DAYS - 1) * DAY_MS).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
  };
}

export function outreachDaySummaries(sites: readonly OutreachSite[], now = new Date()): OutreachDaySummary[] {
  const byDay = new Map<string, OutreachSite[]>();
  for (const site of sites) {
    const day = site.createdAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), site]);
  }
  return outreachWindow(now).map((day) => {
    const skipped: Record<OutreachSkip, number> = { not_ready: 0, outside_us: 0, no_email: 0, expiring: 0 };
    let drafts = 0;
    const built = byDay.get(day) ?? [];
    for (const site of built) {
      const reason = outreachSkip(site, now);
      if (reason === null) drafts += 1;
      else skipped[reason] += 1;
    }
    return { day, built: built.length, drafts, skipped };
  });
}
