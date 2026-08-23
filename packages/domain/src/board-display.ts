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
import type { BoardTicketRow, OrderChannel, FulfillmentType } from '@platform/schema';

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
   * Which semantic token tints the badge. A ladder is a ranking, and the
   * token palette is the only place a colour may come from (rule 4), so a
   * tier names a role rather than a hex value.
   */
  tone: TierTone;
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
 * The thresholds carry across unchanged and are then read as lifetime points.
 * That is a deliberate, stated approximation and not a claim the two metrics
 * are the same: it puts a guest on the rung they have *ever* reached rather
 * than the one they hold this year, which for a badge in a shop -- where the
 * point is recognition, not entitlement -- is the kinder of the two errors.
 * A brand that wants different cut-offs sets `board.tiers` explicitly.
 */
export function boardLadderFrom(tiers: readonly RewardTier[] = REWARD_TIERS): readonly BoardTier[] {
  return sortedTiers(tiers.length > 0 ? tiers : REWARD_TIERS).map((tier, index) => ({
    slug: tierSlug(tier.name) || `tier-${index}`,
    label: tier.name,
    minLifetimePoints: Math.max(0, Math.round(tier.minimumAnnualPoints)),
    tone: TIER_TONES[Math.min(index, TIER_TONES.length - 1)] ?? 'muted',
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
   * How many tickets a column draws before it collapses the rest into a
   * count. A board that silently clips is a board that lies about the queue.
   */
  maxPerColumn: number;
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  showGuestStatus: false,
  showChannel: true,
  ladder: DEFAULT_TIER_LADDER,
  appUrl: null,
  maxPerColumn: 8,
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

function resolveTier(value: unknown, index: number): BoardTier | null {
  if (!isRecord(value)) return null;
  const { slug, label, minLifetimePoints, tone } = value;
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
  if (typeof board.maxPerColumn === 'number'
      && Number.isInteger(board.maxPerColumn)
      && board.maxPerColumn > 0
      && board.maxPerColumn <= 40) {
    resolved.maxPerColumn = board.maxPerColumn;
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
 * What the board draws for one ticket: no row, no column, no colour --
 * only the decisions, so a test can assert them without a DOM.
 */
export type BoardEntry = {
  id: string;
  /** The ticket number, or a dash: a board never invents a number. */
  number: string;
  name: string;
  tier: BoardTier | null;
  provenance: string | null;
  arrived: boolean;
  /** True while a collected order lingers, so it draws faded rather than gone. */
  collected: boolean;
};

/**
 * The guest's name, trimmed to what a wall can hold.
 *
 * A blank label is normal -- a till operator in a rush skips the name -- and
 * the number is the identifier anyway, so the fallback is silence rather than
 * "Guest", which reads like the guest's actual name from across a room.
 */
export function displayName(label: string | null | undefined, max = 18): string {
  const name = (label ?? '').trim();
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1).trimEnd()}…`;
}

export function toEntry(
  ticket: BoardTicketRow,
  config: BoardConfig,
  options: { collected?: boolean } = {},
): BoardEntry {
  return {
    id: ticket.id,
    number: ticket.daily_number === null ? '—' : String(ticket.daily_number),
    name: displayName(ticket.guest_label),
    tier: config.showGuestStatus ? tierBySlug(ticket.loyalty_tier, config.ladder) : null,
    provenance: config.showChannel
      ? provenanceLabel(ticket.channel, ticket.fulfillment_type)
      : null,
    arrived: ticket.arrived_at !== null,
    collected: options.collected === true,
  };
}

/**
 * A column, capped.
 *
 * `.ticket-list { overflow: hidden }` used to be the whole of this: on a busy
 * Saturday the eleventh ticket simply left the screen, and the guest holding
 * it had no way to know the board had not forgotten them. A stated overflow
 * ("+7 more") is a smaller lie than a silent one.
 */
export type BoardColumnView = {
  entries: BoardEntry[];
  overflow: number;
};

export function capColumn(entries: readonly BoardEntry[], max: number): BoardColumnView {
  if (max <= 0 || entries.length <= max) return { entries: [...entries], overflow: 0 };
  return { entries: entries.slice(0, max), overflow: entries.length - max };
}

/**
 * A ticket the board is still drawing, and whether the database has stopped
 * returning it. `goneSince` is null while the read still carries the row.
 */
export type BoardSlot = {
  ticket: BoardTicketRow;
  goneSince: number | null;
};

/**
 * Folds a fresh read into what is already on screen.
 *
 * The reason this is not just "replace the array": `board_tickets` drops an
 * order the moment it is collected, so a number vanished between one blink
 * and the next -- including out from under the guest walking toward the
 * counter to answer it. They then have to ask, which is the exact interaction
 * a pickup board exists to remove.
 *
 * So a collected ticket lingers, faded, for `lingerMs`, and only then leaves.
 * Ordering is by ticket number rather than by update time, so a ticket never
 * jumps position for a reason nobody in the room can see.
 */
export function reconcileBoard(
  previous: readonly BoardSlot[],
  incoming: readonly BoardTicketRow[],
  now: number,
  lingerMs: number,
): BoardSlot[] {
  const live = new Map(incoming.map((ticket) => [ticket.id, ticket]));
  const slots: BoardSlot[] = incoming.map((ticket) => ({ ticket, goneSince: null }));

  for (const slot of previous) {
    if (live.has(slot.ticket.id)) continue;
    const goneSince = slot.goneSince ?? now;
    if (now - goneSince >= lingerMs) continue;
    // Held at its last known state, which is 'ready' for anything collected
    // from the board -- so it lingers in the column the guest last saw it in.
    slots.push({ ticket: slot.ticket, goneSince });
  }

  return slots.sort((a, b) => (a.ticket.daily_number ?? 0) - (b.ticket.daily_number ?? 0));
}

/** Splits reconciled slots the way the board draws them, capped per column. */
export function boardColumns(
  slots: readonly BoardSlot[],
  config: BoardConfig,
): { inProgress: BoardColumnView; ready: BoardColumnView } {
  const pick = (match: (status: BoardTicketRow['status']) => boolean): BoardEntry[] =>
    slots
      .filter((slot) => match(slot.ticket.status))
      // A ticket already collected is the one the room needs least, so it
      // sorts behind the live queue and is therefore the first thing the cap
      // drops. Without this, a lingering ghost could push a guest who is
      // still waiting off the bottom of their own board.
      .sort((a, b) => Number(a.goneSince !== null) - Number(b.goneSince !== null))
      .map((slot) => toEntry(slot.ticket, config, { collected: slot.goneSince !== null }));

  return {
    inProgress: capColumn(
      pick((status) => status === 'paid' || status === 'in_progress'),
      config.maxPerColumn,
    ),
    ready: capColumn(pick((status) => status === 'ready'), config.maxPerColumn),
  };
}
