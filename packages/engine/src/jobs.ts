/**
 * The scheduled tick: drop state transitions and due campaign sends. The
 * selectors are pure (tested); the runner script applies their decisions
 * with the service-role client.
 */

export type DropJobRow = {
  id: string;
  status: 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';
  startsAt: string;
  endsAt: string;
};

export type DropTransition = { id: string; to: 'live' | 'ended' };

/** scheduled -> live at startsAt; live -> ended at endsAt. Drafts stay put. */
export function dueDropTransitions(drops: readonly DropJobRow[], now: Date): DropTransition[] {
  const transitions: DropTransition[] = [];
  for (const drop of drops) {
    if (drop.status === 'scheduled' && new Date(drop.startsAt) <= now && new Date(drop.endsAt) > now) {
      transitions.push({ id: drop.id, to: 'live' });
    } else if ((drop.status === 'scheduled' || drop.status === 'live') && new Date(drop.endsAt) <= now) {
      transitions.push({ id: drop.id, to: 'ended' });
    }
  }
  return transitions;
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
