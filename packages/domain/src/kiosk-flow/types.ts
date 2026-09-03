/**
 * The shape of a resolved kiosk flow, and the two canonical instances of it.
 *
 * `DEFAULT_KIOSK_FLOW` sits beside the type it fills because every reader falls
 * back to it field by field, and a default kept apart from its type drifts
 * from it.
 */

/** Which middle steps run between the first screen and the review. */
export type KioskStepFamily =
  /** A drink or a dish: pick the item, then its size and options. */
  | 'item'
  /** A container: pick the pack, then allocate its slots across a lineup. */
  | 'pack';

/** How much of the first screen one node takes. Purely a size, not a role. */
export type KioskNodeEmphasis = 'hero' | 'standard' | 'minor';

/** The always-available chrome in the top-right of every step. */
export type KioskUtility = 'rewards' | 'giftBalance' | 'allergens';

/**
 * How a guest may pay. `card` is the reader; `stored_value` and `gift_card`
 * are additionally gated on the brand's own feature column, because the flags
 * are columns on `brands` and a config file is not allowed to grant itself a
 * capability the platform has not enabled.
 */
export type KioskTender = 'card' | 'gift_card' | 'stored_value' | 'cash';

export type KioskIdentifyMethod = 'phone' | 'scan';

/**
 * Where a tile goes.
 *
 * `categoryId` is the category's TITLE, not a uuid and not a slug, because
 * `menu_categories` (0003) has neither -- only `id uuid` and `title text`. A
 * uuid differs per environment so a tenant file cannot carry one, and the
 * title is what `menu.csv` already keys a row by. The cost is that renaming a
 * category orphans a tile; the resolver catches exactly that and
 * `inspectKioskFlow` reports it, which is why the check is worth having.
 */
export type KioskNodeTarget =
  | { kind: 'category'; categoryId: string }
  | { kind: 'item'; itemSlug: string }
  /** Bounded nested folders derived from the published catalog hierarchy. */
  | { kind: 'group'; nodes: readonly KioskEntryNode[] }
  | { kind: 'utility'; utility: KioskUtility };

export type KioskEntryNode = {
  id: string;
  label: string;
  emphasis: KioskNodeEmphasis;
  target: KioskNodeTarget;
  /** A menu asset slug. The renderer resolves it; this module never sees a file. */
  imageSlug?: string;
  caption?: string;
};

export type KioskSurveyOption = { id: string; label: string };
export type KioskSurveyGroup = { id: string; label: string; options: readonly KioskSurveyOption[] };

export type KioskFlow = {
  attract: { headline: string | null; invite: string; showLogo: boolean };
  entry: { prompt: string; nodes: readonly KioskEntryNode[] };
  family: KioskStepFamily;
  utilities: readonly KioskUtility[];
  identify: { mode: 'off' | 'optional'; methods: readonly KioskIdentifyMethod[] };
  tenders: readonly KioskTender[];
  tip: { enabled: boolean; presetsCents: readonly number[] };
  guestName: { mode: 'off' | 'optional' | 'required' };
  survey: { enabled: boolean; prompt: string; groups: readonly KioskSurveyGroup[] };
  idle: { warnMs: number; resetMs: number };
  motion: 'full' | 'reduced';
  /**
   * True when nothing usable in the config drove the entry list, so the screen
   * is being derived from the menu. HQ reads it to label the preview, and
   * `normalizeForSave` reads it to avoid freezing a derived list into stored
   * config -- which would silently stop the kiosk tracking the menu.
   */
  entryDerived: boolean;
};

/**
 * What the resolver needs to know about the tenant's menu to tell a live tile
 * from a dead one. Both HQ and the device can build it.
 */
export type KioskMenuFacts = {
  categories: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
    parentId?: string | null;
    hasItems?: boolean;
  }[];
  itemSlugs: readonly string[];
  /** Menu item slug → current tenant media URL, for browser previews. */
  imageUrls?: Readonly<Record<string, string>>;
};

export const EMPTY_MENU_FACTS: KioskMenuFacts = { categories: [], itemSlugs: [] };

/** One field the resolver dropped, and why. For the HQ editor to render. */
export type KioskFlowNote = { path: string; message: string };

export const DEFAULT_KIOSK_FLOW: KioskFlow = {
  attract: { headline: null, invite: 'Touch anywhere to order', showLogo: true },
  entry: { prompt: 'What would you like today?', nodes: [] },
  family: 'item',
  utilities: [],
  identify: { mode: 'off', methods: ['phone'] },
  tenders: ['card'],
  tip: { enabled: false, presetsCents: [] },
  guestName: { mode: 'optional' },
  survey: { enabled: false, prompt: '', groups: [] },
  idle: { warnMs: 60_000, resetMs: 90_000 },
  motion: 'full',
  entryDerived: true,
};

export type KioskFlowContext = {
  /**
   * The tenant's own menu. When it is empty the resolver treats every target as
   * unverifiable and keeps the tile: a caller who does not yet know the menu
   * (HQ before the rows load, a unit test) must never be able to blank the
   * first screen.
   */
  menu?: KioskMenuFacts;
  /** The brand's feature columns. Absent means nothing extra is granted. */
  features?: { readonly stored_value?: boolean } | null;
};
