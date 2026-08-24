/**
 * What a pickup board says about a ticket, and what it refuses to say.
 *
 * This module is the whole of the display's judgement, kept framework-free so
 * `node:test` can reach it without a renderer -- the board itself is a wall
 * screen nobody can click, so unit tests are the only place its behaviour is
 * ever actually exercised.
 *
 * Two rules run through everything here:
 *
 * 1. A board is read at fifteen feet in under two seconds. Anything that does
 *    not survive that distance is noise, so every label is short and every
 *    fallback is "show less", never "show a placeholder".
 * 2. A board is read by a whole room. Tier is a bucket, never a balance;
 *    channel is a provenance, never an account. Nothing here can widen that,
 *    because nothing here has anything wider to widen it with.
 */
import type {
  BoardTicketRow, FulfillmentType, OrderChannel, OrderStatus,
} from '@platform/schema';

import { REWARD_TIERS, sortedTiers, type RewardTier } from './rules';

/**
 * A rung of the ladder as a wall screen shows it.
 *
 * Not `RewardTier`, and the difference is not cosmetic. `RewardTier` is the
 * earn ladder: it carries perks, a description and a points-per-dollar rate,
 * and it is keyed on *annual* points. A badge on a wall needs none of that
 * and cannot have the last of it -- `loyalty_accounts` stores `points_balance`
 * and `lifetime_points` and no rolling annual figure at all, so no server-side
 * projection can compute an annual rung today (see docs/AUDIT.md).
 *
 * So the board reads lifetime points, and the two ladders share the one thing
 * that must not drift: the brand's words. `boardLadderFrom` derives these
 * rungs from the earn ladder's names rather than asking a tenant to write the
 * same vocabulary twice and then keep it in sync by hand.
 */
export type BoardTier = {
  /** Stable key. The SQL projection emits this; nothing displays it. */
  slug: string;
  /** What the badge says. Brand words -- "House Regular", "Silver". */
  label: string;
  /** Lifetime points at which a guest reaches this rung. */
  minLifetimePoints: number;
  /**
   * Which semantic token tints the badge when no explicit colour is set. A
   * ladder is a ranking, and the token palette is where a colour comes from
   * by default (rule 4), so a tier names a role rather than a hex value.
   */
  tone: TierTone;
  /**
   * An explicit badge colour, overriding `tone`.
   *
   * Rule 4 says no *component* hard-codes a colour; it does not say a brand
   * cannot choose one. A status ladder is exactly where a brand wants to --
   * the rungs are a ranking people are supposed to recognise across a room,
   * and four steps of one accent do not read as four steps. This comes from
   * `brand_config`, same as every token, and is null until a brand sets it.
   */
  color: string | null;
  /**
   * The mark in front of the label, or null to fall back to the brand's own
   * `rewardMark`. Per rung so a ladder can escalate its marks the way it
   * escalates its colours.
   */
  icon: string | null;
};

export type TierTone = 'muted' | 'accent' | 'success' | 'primary';

const TIER_TONES: readonly TierTone[] = ['muted', 'accent', 'success', 'primary'];

/**
 * A tier name reduced to a key the database can hold and match on.
 *
 * Names are owner-editable free text ("First Sip"), so they cannot be the key
 * -- renaming a rung in HQ would orphan every badge until the next order. The
 * slug is derived once at onboarding and stored; renaming then changes only
 * what the badge says.
 */
export function tierSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * The board's rungs, derived from the brand's earn ladder.
 *
 * The thresholds carry across unchanged and are then read against LIFETIME
 * points. An earlier version of this comment called that an approximation. It
 * is not — it is exact, and the reason is worth stating because it is the
 * whole argument for having two ladders:
 *
 *   Lifetime points are a running total of every point ever earned. Annual
 *   points are the trailing twelve months of the same series. Lifetime is
 *   therefore always >= annual, for every guest, at every moment.
 *
 * So a rung set at 1500 means "reached 1500 in a year" on the earn ladder and
 * "reached 1500 ever" here. The badge is the easier of the two to earn and,
 * once earned, cannot be lost — which is exactly what recognition should be,
 * and exactly what an entitlement should not.
 *
 * A brand that wants the badge to be harder than the rate sets `board.tiers`
 * explicitly with its own lifetime thresholds; 0035 makes both figures
 * computable server-side, so neither ladder has to stand in for the other.
 */
export function boardLadderFrom(tiers: readonly RewardTier[] = REWARD_TIERS): readonly BoardTier[] {
  return sortedTiers(tiers.length > 0 ? tiers : REWARD_TIERS).map((tier, index) => ({
    slug: tierSlug(tier.name) || `tier-${index}`,
    label: tier.name,
    minLifetimePoints: Math.max(0, Math.round(tier.minimumAnnualPoints)),
    tone: TIER_TONES[Math.min(index, TIER_TONES.length - 1)] ?? 'muted',
    // Unset by default: a derived ladder inherits the token palette, and a
    // brand that wants four distinguishable rungs says so explicitly.
    color: null,
    icon: null,
  }));
}

/** The ladder a brand gets before it configures one: its own earn ladder's words. */
export const DEFAULT_TIER_LADDER: readonly BoardTier[] = boardLadderFrom();

/** How the board is configured for one brand. All of it optional, all of it safe by default. */
export type BoardConfig = {
  /**
   * Off by default. A tier badge on a public wall tells the room roughly what
   * someone spends, so it is opt-in per brand rather than a default anyone
   * inherits by upgrading.
   */
  showGuestStatus: boolean;
  /** "via kiosk" under a name. On by default: it is provenance, not personal. */
  showChannel: boolean;
  ladder: readonly BoardTier[];
  /** Absolute https URL the QR panel points at, or null to hide the panel. */
  appUrl: string | null;
  /**
   * How many lines the board draws before it collapses the rest into a count.
   * A board that silently clips is a board that lies about the queue.
   */
  maxLines: number;
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  showGuestStatus: false,
  showChannel: true,
  ladder: DEFAULT_TIER_LADDER,
  appUrl: null,
  maxLines: 8,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Only https, and only an absolute URL.
 *
 * A QR on a wall is scanned by strangers who cannot see where it points until
 * they are already there, which makes it the one link in this product with no
 * hover state and no back button. http:// and javascript:/data: are refused
 * outright rather than normalised.
 */
export function isDisplayableAppUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname.length > 0;
}

/** #RRGGBB only. Same rule `resolveTokens` applies, for the same reason. */
const HEX = /^#[0-9a-fA-F]{6}$/;

function resolveTier(value: unknown, index: number): BoardTier | null {
  if (!isRecord(value)) return null;
  const { slug, label, minLifetimePoints, tone, color, icon } = value;
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 64) return null;
  if (typeof label !== 'string' || label.length === 0 || label.length > 32) return null;
  if (typeof minLifetimePoints !== 'number'
      || !Number.isInteger(minLifetimePoints)
      || minLifetimePoints < 0) return null;
  return {
    slug,
    label,
    minLifetimePoints,
    // An unnamed rung still needs a colour, and walking the tone list by
    // position means a three-rung ladder reads as a ladder without the
    // tenant having to know the token names.
    tone: TIER_TONES.includes(tone as TierTone)
      ? (tone as TierTone)
      : (TIER_TONES[Math.min(index, TIER_TONES.length - 1)] ?? 'muted'),
    // A bad hex drops to the tone rather than rejecting the rung: one typo in
    // HQ must not remove a guest's badge from the wall.
    color: typeof color === 'string' && HEX.test(color) ? color : null,
    // Capped short because this is one mark, not a sentence -- and because a
    // long string here would push the label off a badge sized for a glance.
    // Graphemes, not code units: most marks worth using here are multi-unit.
    icon: typeof icon === 'string' && icon.trim().length > 0 && [...icon.trim()].length <= 2
      ? icon.trim()
      : null,
  };
}

/**
 * Merges a tenant's (untrusted, possibly partial or malformed) board config
 * over the defaults, dropping bad values field by field rather than rejecting
 * the whole object -- the same bargain `resolveTokens` makes, for the same
 * reason: one typo must not blank a screen bolted to a wall.
 */
export function resolveBoardConfig(config: unknown): BoardConfig {
  const resolved: BoardConfig = { ...DEFAULT_BOARD_CONFIG };
  if (!isRecord(config)) return resolved;
  const board = isRecord(config.board) ? config.board : config;

  if (typeof board.showGuestStatus === 'boolean') resolved.showGuestStatus = board.showGuestStatus;
  if (typeof board.showChannel === 'boolean') resolved.showChannel = board.showChannel;
  if (isDisplayableAppUrl(board.appUrl)) resolved.appUrl = board.appUrl;
  if (typeof board.maxLines === 'number'
      && Number.isInteger(board.maxLines)
      && board.maxLines > 0
      && board.maxLines <= 40) {
    resolved.maxLines = board.maxLines;
  }

  if (Array.isArray(board.tiers)) {
    const tiers = board.tiers
      .map((tier, index) => resolveTier(tier, index))
      .filter((tier): tier is BoardTier => tier !== null)
      // Ascending, so `tierFor` can walk from the top and stop at the first
      // rung a guest has reached regardless of what order the tenant wrote.
      .sort((a, b) => a.minLifetimePoints - b.minLifetimePoints);
    // An array that resolves to nothing is a broken config, not a request for
    // an empty ladder; keeping the defaults leaves the feature working.
    if (tiers.length > 0) resolved.ladder = tiers;
  }
  return resolved;
}

/**
 * The highest rung `lifetimePoints` has reached, or null below the first one.
 *
 * Null rather than the bottom rung, unlike `tierForAnnualPoints`, which always
 * returns a tier because the app always has to name the guest's standing. A
 * board has the better option of saying nothing: a badge on every single
 * ticket is a column of noise that stops meaning anything.
 *
 * The SQL projection is the authority at runtime (0030 computes the slug
 * server-side, where the points are); this is the same rule in TypeScript for
 * fixtures, for HQ previews, and for the test that keeps the two honest.
 */
export function tierFor(
  lifetimePoints: number,
  ladder: readonly BoardTier[] = DEFAULT_TIER_LADDER,
): BoardTier | null {
  if (!Number.isFinite(lifetimePoints) || lifetimePoints < 0) return null;
  let reached: BoardTier | null = null;
  for (const tier of ladder) {
    if (tier.minLifetimePoints <= lifetimePoints) reached = tier;
  }
  return reached;
}

/** The ladder rung a `board_tickets.loyalty_tier` slug names, or null. */
export function tierBySlug(
  slug: string | null | undefined,
  ladder: readonly BoardTier[] = DEFAULT_TIER_LADDER,
): BoardTier | null {
  if (!slug) return null;
  return ladder.find((tier) => tier.slug === slug) ?? null;
}

/**
 * Where the order came from, in the guest's words.
 *
 * Fulfillment wins over channel when the two disagree, because it is the more
 * actionable fact: a delivery courier's order was placed in the app, but what
 * the room needs to know is that nobody is going to walk up for it.
 */
export function provenanceLabel(
  channel: OrderChannel,
  fulfillment: FulfillmentType,
): string {
  switch (fulfillment) {
    case 'delivery': return 'for delivery';
    case 'curbside': return 'for curbside';
    case 'catering': return 'for catering';
    case 'pickup': break;
  }
  switch (channel) {
    case 'kiosk': return 'via kiosk';
    case 'pos': return 'via point of sale';
    case 'web': return 'via web';
    case 'app': return 'via the app';
  }
}

/**
 * One line of the queue, as the room reads it.
 *
 * The board used to be two columns -- "Making now" and "Ready" -- which is how
 * the *kitchen* thinks and not how the queue does. A guest does not want to
 * know which of two stages their order is in; they want to know how many
 * people are in front of them, and then to be told when to walk up. So there
 * is one list: a position while you wait, a check when it is yours.
 */
export type BoardEntry = {
  id: string;
  /**
   * Place in line, 1-based -- or null once the order is ready, where a check
   * replaces the number. Numbering counts only the people still waiting, so
   * "3" always means three, and never drifts because a ticket ahead was
   * collected.
   */
  position: number | null;
  /** True once the order is ready: the check, and the top of the list. */
  ready: boolean;
  name: string;
  tier: BoardTier | null;
  provenance: string | null;
  arrived: boolean;
};

/**
 * The queue position of every ticket, by id.
 *
 * Exported on its own, and taking the narrowest possible shape, because the
 * operator app needs the same answer: a barista asked "what number am I?" has
 * to say what the wall says, and two implementations of "the queue" would
 * disagree the first time either changed. `apps/operator` reads this over its
 * own `BoardOrder`; `apps/display` reads it over `BoardTicketRow`.
 */
export type QueueMember = {
  id: string;
  status: OrderStatus;
  daily_number: number | null;
  updated_at: string;
};

/** Ready first (longest-waiting at the top), then the line in ticket order. */
function queueOrder(a: QueueMember, b: QueueMember): number {
  const aReady = a.status === 'ready';
  const bReady = b.status === 'ready';
  if (aReady !== bReady) return aReady ? -1 : 1;
  if (aReady && bReady) {
    // Whoever has been ready longest is nearest the counter, and moving a
    // finished ticket back down the list as newer ones land would take a
    // guest's own line out from under them mid-walk.
    const byWait = a.updated_at.localeCompare(b.updated_at);
    if (byWait !== 0) return byWait;
  }
  return (a.daily_number ?? 0) - (b.daily_number ?? 0);
}

export function queuePositions(
  members: readonly QueueMember[],
): Map<string, number | null> {
  const positions = new Map<string, number | null>();
  let place = 0;
  for (const member of [...members].sort(queueOrder)) {
    if (member.status === 'ready') {
      positions.set(member.id, null);
      continue;
    }
    place += 1;
    positions.set(member.id, place);
  }
  return positions;
}

/**
 * The guest's name, trimmed to what a wall can hold.
 *
 * A blank label is normal -- a till operator in a rush skips the name -- and
 * the position is the identifier anyway, so the fallback is silence rather
 * than "Guest", which reads like the guest's actual name from across a room.
 */
export function displayName(label: string | null | undefined, max = 18): string {
  const name = (label ?? '').trim();
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1).trimEnd()}…`;
}

export function toEntry(
  ticket: BoardTicketRow,
  config: BoardConfig,
  position: number | null,
): BoardEntry {
  return {
    id: ticket.id,
    position,
    ready: ticket.status === 'ready',
    name: displayName(ticket.guest_label),
    tier: config.showGuestStatus ? tierBySlug(ticket.loyalty_tier, config.ladder) : null,
    provenance: config.showChannel
      ? provenanceLabel(ticket.channel, ticket.fulfillment_type)
      : null,
    arrived: ticket.arrived_at !== null,
  };
}

/**
 * The list, capped.
 *
 * `.ticket-list { overflow: hidden }` used to be the whole of this: on a busy
 * Saturday the eleventh ticket simply left the screen, and the guest holding
 * it had no way to know the board had not forgotten them. A stated overflow
 * ("+7 more waiting") is a smaller lie than a silent one.
 *
 * A ready ticket is never what gets dropped. It is the one line on the board
 * somebody is about to act on, and it is also the shortest-lived -- the row
 * leaves the moment staff hand the order over.
 */
export type BoardQueue = {
  entries: BoardEntry[];
  overflow: number;
};

export function boardQueue(
  tickets: readonly BoardTicketRow[],
  config: BoardConfig,
): BoardQueue {
  const positions = queuePositions(tickets);
  const ordered = [...tickets].sort(queueOrder);
  const entries = ordered.map((ticket) =>
    toEntry(ticket, config, positions.get(ticket.id) ?? null));

  if (config.maxLines <= 0 || entries.length <= config.maxLines) {
    return { entries, overflow: 0 };
  }
  const readyCount = entries.filter((entry) => entry.ready).length;
  // Never cut into the ready block, however long it gets: those are the people
  // being called up right now.
  const limit = Math.max(config.maxLines, readyCount);
  return { entries: entries.slice(0, limit), overflow: entries.length - limit };
}
