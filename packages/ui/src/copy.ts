/**
 * The brand copy dictionary: every user-facing string a component or screen
 * needs, keyed, with {placeholders}. Rule 4 covers words too -- no component
 * hard-codes a brand string.
 *
 * A dictionary is resolved in three layers, the same shape `packages/domain`
 * uses for catalog vocabulary: universal <- industry <- tenant. The keys whose
 * wording depends on the vertical live in `copy-industry.ts`; what stays here
 * is what reads the same whether the tenant sells espresso or builds houses.
 */
import { industryCopy } from './copy-industry';

export type BrandCopy = Record<string, string>;

/**
 * Wording no vertical needs to restate.
 *
 * The test for a key belonging here is not whether the words are bland -- it
 * is whether a new vertical would want to change them. "Checkout" and
 * "Reconnecting" survive any industry; "Add to Bag" does not, and lives in a
 * pack instead.
 */
export const UNIVERSAL_COPY: BrandCopy = {
  pointsName: 'Points',
  checkoutTitle: 'Checkout',
  /**
   * The referral share text, filled with {appName}, {code} and {url}.
   *
   * Universal rather than per-vertical: it already names no reward, only that
   * there is one, so a renovation firm and a coffee shop can both send it
   * unchanged. What the reward actually is stays the tenant's to write.
   */
  referralShare: 'Try {appName} — use my code {code} and we both get a reward. {url}',
  dropEndsIn: 'Ends in {time}',
  /**
   * The status mark. One glyph, shown beside a tier name wherever a tier name
   * appears -- the customer app's rewards chip and the in-store board read the
   * same key, so a brand that changes its mark changes both.
   */
  rewardMark: '✦',
  closedLabel: 'Closed',
  opensLabel: 'Opens {time}',

  // The pickup display. Its own block because a wall screen is read across a
  // room in under two seconds: these are the shortest words that still say the
  // thing, and a tenant lengthening one has to see the rest to know what fits.
  // The queue's own vocabulary is the vertical's, so it sits in the industry
  // packs; what is left here is the screen talking about itself.
  /**
   * Shown when a production screen has no device token. Addressed to staff,
   * not guests -- a guest can do nothing about it, and the one person who can
   * needs to know what to do rather than that something is wrong.
   */
  boardUnpairedTitle: 'This screen is not paired',
  boardUnpairedBody: 'Pair it from the console under Locations → Devices.',
  boardReady: 'Ready',
  boardLive: 'Live',
  boardStale: 'Reconnecting',
  boardOffline: 'Sample board',
  /**
   * The rewards pitch. `\n` is a hard line break, honoured by the board.
   *
   * Set as three stops rather than a sentence because it is read at a glance
   * from across a room: three short words each landing on their own beat are
   * legible in the time somebody spends looking up, where a clause is not.
   * The break is in the copy rather than left to the container so a tenant
   * controls where their own headline turns. Universal because a rewards
   * ladder reads the same in any trade.
   */
  boardQrTitle: 'Perks. Status.\nRewards',
  boardQrBody: 'Scan to get {appName} and start earning {pointsName}.',
  /**
   * How a tier reads on a badge. `{tier}` is the rung's own label.
   *
   * A template because the wording is brand voice: a ladder of single words
   * ("Silver") wants "Silver Status", while one of phrases ("House Regular")
   * does not. Neither is the platform's call.
   */
  boardTierBadge: '{tier}',
};

/**
 * Universal <- industry <- tenant.
 *
 * `industryKey` is read off the brand config rather than passed by each caller
 * so an unknown, absent, or malformed key lands on neutral wording in one
 * place. Omitting it is safe by construction: no argument means no industry
 * means the generic pack, never the first vertical the platform happened to
 * ship.
 */
export function resolveCopy(config: unknown, industryKey?: unknown): BrandCopy {
  const copy: BrandCopy = { ...UNIVERSAL_COPY, ...industryCopy(industryKey) };
  if (typeof config !== 'object' || config === null) return copy;
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length <= 500) copy[key] = value;
  }
  return copy;
}

/** `formatCopy(copy, 'earnBanner', { points: 96, pointsName: 'Beans' })` */
export function formatCopy(
  copy: BrandCopy,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = copy[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
