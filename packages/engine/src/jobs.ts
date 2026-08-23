/**
 * The scheduled tick: drop state transitions and due campaign sends. The
 * selectors are pure (tested); the runner script applies their decisions
 * with the service-role client.
 */

export type DropJobRow = {
  id: string;
  status: 'draft' | 'scheduled' | 'revealed' | 'live' | 'ended' | 'cancelled';
  /** Visible as a teaser from here. Null = no separate reveal. */
  revealAt?: string | null;
  startsAt: string;
  endsAt: string;
};

export type DropTransition = { id: string; to: 'revealed' | 'live' | 'ended' };

/**
 * scheduled -> revealed at revealAt; -> live at startsAt; -> ended at endsAt.
 * Drafts and cancelled drops stay put.
 *
 * Written so a missed tick cannot strand a drop in the wrong state. The job
 * runs every minute or five, and a deploy, a sleep or a cold start can drop
 * one: each branch therefore tests where `now` actually is rather than
 * assuming the previous edge fired. A drop whose reveal AND start both passed
 * between two ticks goes straight to live, and one whose whole window passed
 * goes straight to ended -- the same reasoning the ended case already used,
 * extended to the edge that was added.
 */
export function dueDropTransitions(drops: readonly DropJobRow[], now: Date): DropTransition[] {
  const transitions: DropTransition[] = [];
  const pending = new Set(['scheduled', 'revealed']);
  for (const drop of drops) {
    const starts = new Date(drop.startsAt);
    const ends = new Date(drop.endsAt);
    if (!pending.has(drop.status) && drop.status !== 'live') continue;

    if (ends <= now) {
      transitions.push({ id: drop.id, to: 'ended' });
    } else if (pending.has(drop.status) && starts <= now) {
      transitions.push({ id: drop.id, to: 'live' });
    } else if (
      drop.status === 'scheduled'
      && drop.revealAt != null
      && new Date(drop.revealAt) <= now
    ) {
      transitions.push({ id: drop.id, to: 'revealed' });
    }
  }
  return transitions;
}

export type DropVisibility = 'hidden' | 'revealed' | 'orderable' | 'ended';

/**
 * What a guest may do with a drop right now.
 *
 * Mirrors app.drop_visibility in migration 0026. Three clients ask this
 * question, and a disagreement between them is the bug it exists to prevent:
 * a kiosk listing something the app still calls upcoming, or a bake list
 * filling for a window that has not opened.
 */
export function dropVisibility(drop: DropJobRow, now: Date): DropVisibility {
  if (drop.status === 'draft' || drop.status === 'cancelled') return 'hidden';
  if (new Date(drop.endsAt) <= now) return 'ended';
  if (new Date(drop.startsAt) <= now) return 'orderable';
  if (drop.revealAt != null && new Date(drop.revealAt) <= now) return 'revealed';
  return 'hidden';
}

export type CampaignJobRow = {
  id: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: string | null;
};

/** Campaigns whose moment has arrived. `sending` rows belong to a running worker. */
export function dueCampaigns(campaigns: readonly CampaignJobRow[], now: Date): string[] {
  return campaigns
    .filter((campaign) =>
      campaign.status === 'scheduled'
      && campaign.scheduledAt !== null
      && new Date(campaign.scheduledAt) <= now)
    .map((campaign) => campaign.id);
}
