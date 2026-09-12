/**
 * Pure validation for the "Save draft" campaign form. A saved draft never
 * enqueues a send (see saveCampaignDraft) -- this only shapes and validates
 * what a `campaigns` row is allowed to hold.
 */
export const CAMPAIGN_CHANNELS = ['push', 'sms', 'email'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

// Keys the audience <select> posts, mapped to the jsonb shapes documented on
// public.campaigns. The column itself has no CHECK constraint, but writing
// only these shapes keeps every row a future audience evaluator can read.
export const CAMPAIGN_AUDIENCE_KEYS = ['all', 'lapsed_30', 'loyalty_500', 'last_drop'] as const;
export type CampaignAudienceKey = (typeof CAMPAIGN_AUDIENCE_KEYS)[number];

const CAMPAIGN_AUDIENCES: Record<CampaignAudienceKey, Readonly<Record<string, unknown>>> = {
  all: { kind: 'all' },
  lapsed_30: { kind: 'lapsed', days: 30 },
  loyalty_500: { kind: 'loyalty_tier', min_points: 500 },
  last_drop: { kind: 'last_drop_purchasers' },
};

export type CampaignDraft = {
  readonly name: string;
  readonly channel: CampaignChannel;
  readonly audience: Readonly<Record<string, unknown>>;
  readonly subject: string;
  readonly body: string;
  readonly scheduledAt: string | null;
};

export type CampaignInput = {
  name?: string;
  channel?: string;
  audience?: string;
  subject?: string;
  message?: string;
  scheduledAt?: string;
};

function member<T extends string>(value: string | undefined, values: readonly T[]): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

export function parseCampaignDraft(input: CampaignInput):
  { ok: true; draft: CampaignDraft } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a campaign name.' };
  if (name.length > 160) return { ok: false, error: 'That campaign name is too long.' };

  const channel = member(input.channel, CAMPAIGN_CHANNELS);
  if (!channel) return { ok: false, error: 'Choose a valid channel.' };

  const audienceKey = member(input.audience, CAMPAIGN_AUDIENCE_KEYS);
  if (!audienceKey) return { ok: false, error: 'Choose a valid audience.' };

  const body = (input.message ?? '').trim();
  if (!body) return { ok: false, error: 'Enter the campaign message.' };
  if (body.length > 4000) return { ok: false, error: 'That message is too long.' };

  const subject = (input.subject ?? '').trim();
  if (channel === 'email' && !subject) {
    return { ok: false, error: 'Enter a subject line for an email campaign.' };
  }
  if (subject.length > 200) return { ok: false, error: 'That subject line is too long.' };

  let scheduledAt: string | null = null;
  const rawSchedule = (input.scheduledAt ?? '').trim();
  if (rawSchedule) {
    const parsed = new Date(rawSchedule);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Enter a valid schedule date and time.' };
    }
    scheduledAt = parsed.toISOString();
  }

  return {
    ok: true,
    draft: {
      name, channel, audience: CAMPAIGN_AUDIENCES[audienceKey],
      subject: channel === 'email' ? subject : '', body, scheduledAt,
    },
  };
}
