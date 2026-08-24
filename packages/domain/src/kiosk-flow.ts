/**
 * The kiosk's flow, declared by the tenant rather than by this code.
 *
 * A kiosk in a coffee shop and a kiosk in a bakery ask different first
 * questions and take different middle steps, and neither of them should need a
 * release to change. So the whole shape of the flow -- what the first screen
 * offers, which step family runs, which tenders appear, whether a name is
 * asked for -- is data in `brand_config.kiosk`, resolved here.
 *
 * The resolver follows `resolveTokens` (packages/ui/src/tokens.ts) rather than
 * `parseTaxJurisdictions` (packages/engine/src/tax.ts): a bad field is clamped
 * or dropped, never fatal. Throwing is the right answer when the alternative is
 * undercharging tax; it is the wrong answer when the alternative is a kiosk
 * that will not open because someone mistyped one entry label.
 *
 * The tenant's menu is an input, not an assumption. That is what lets the
 * resolver drop a tile pointing at a category somebody deleted last week --
 * a dead button on a guest-facing screen is the most likely way this config
 * goes wrong, and it is invisible to any check that only reads the config.
 *
 * Framework-free, so `node:test` covers every rule below without a renderer.
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
  /** One level of nesting only -- "Large" / "Mini" above the packs. */
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
  categories: readonly { id: string; title: string }[];
  itemSlugs: readonly string[];
};

export const EMPTY_MENU_FACTS: KioskMenuFacts = { categories: [], itemSlugs: [] };

/** One field the resolver dropped, and why. For the HQ editor to render. */
export type KioskFlowNote = { path: string; message: string };

/**
 * Bounds, not preferences.
 *
 * `MAX_ENTRY_NODES` is the one worth explaining: the first screen is read by a
 * standing guest from two or three feet with a queue behind them, and a
 * constellation of thirty circles is not a menu, it is a search problem. Twelve
 * is where a tenant should be nesting instead, and a config that asks for more
 * gets the first twelve rather than an unusable screen.
 */
export const MAX_ENTRY_NODES = 12;
const MAX_SURVEY_GROUPS = 4;
const MAX_SURVEY_OPTIONS = 24;
const MAX_TIP_PRESETS = 4;
const MAX_LABEL = 60;
const MAX_PROMPT = 140;

/** A kiosk nobody is standing at must not reset every few seconds, nor sit for an hour. */
export const KIOSK_IDLE_MIN_MS = 15_000;
export const KIOSK_IDLE_MAX_MS = 600_000;
/** The gap the warning needs to be readable and actionable before the reset lands. */
const MIN_IDLE_GAP_MS = 10_000;

const EMPHASES: readonly KioskNodeEmphasis[] = ['hero', 'standard', 'minor'];
const UTILITIES: readonly KioskUtility[] = ['rewards', 'giftBalance', 'allergens'];
const TENDERS: readonly KioskTender[] = ['card', 'gift_card', 'stored_value', 'cash'];
const IDENTIFY_METHODS: readonly KioskIdentifyMethod[] = ['phone', 'scan'];
const FAMILIES: readonly KioskStepFamily[] = ['item', 'pack'];

/** Tenders the platform will not hand out on a config file's say-so alone. */
const FEATURE_GATED_TENDERS: Readonly<Record<string, 'stored_value'>> = {
  stored_value: 'stored_value',
  gift_card: 'stored_value',
};

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

/**
 * Merges a tenant's (untrusted, possibly partial or malformed) kiosk config
 * over the defaults, field by field.
 */
export function resolveKioskFlow(config: unknown, context: KioskFlowContext = {}): KioskFlow {
  return walk(config, context, null);
}

/**
 * The same walk, reporting what it would drop rather than dropping it silently.
 *
 * Deliberately the same function with a note sink rather than a second
 * implementation: two copies of these rules would drift within a release, and
 * the copy HQ shows a brand owner is the one that must match the device.
 */
export function inspectKioskFlow(config: unknown, context: KioskFlowContext = {}): KioskFlowNote[] {
  const notes: KioskFlowNote[] = [];
  walk(config, context, notes);
  return notes;
}

/**
 * What HQ persists.
 *
 * Drops the entry list when it was derived. Saving a derived list would freeze
 * this week's menu into stored config, and the kiosk would quietly stop
 * following the menu from then on -- the silent-drift class this whole change
 * exists to close.
 */
export function normalizeForSave(flow: KioskFlow): Record<string, unknown> {
  const { entryDerived, entry, ...rest } = flow;
  return {
    ...rest,
    entry: entryDerived ? { prompt: entry.prompt } : entry,
  };
}

function walk(config: unknown, context: KioskFlowContext, notes: KioskFlowNote[] | null): KioskFlow {
  const source = asRecord(config);
  const menu = context.menu ?? EMPTY_MENU_FACTS;
  const configured = readNodes(source?.entry, menu, notes);
  const entryDerived = configured.length === 0;
  const nodes = entryDerived ? entryNodesFromCategories(menu.categories) : configured;
  if (entryDerived && notes && asRecord(source?.entry)?.nodes !== undefined) {
    notes.push({
      path: 'kiosk.entry.nodes',
      message: 'No usable tile survived; the first screen is being derived from the menu.',
    });
  }

  return {
    attract: readAttract(source?.attract),
    entry: {
      prompt: text(asRecord(source?.entry)?.prompt, MAX_PROMPT) ?? DEFAULT_KIOSK_FLOW.entry.prompt,
      nodes,
    },
    family: oneOf(source?.family, FAMILIES, DEFAULT_KIOSK_FLOW.family),
    utilities: uniqueMembers(source?.utilities, UTILITIES),
    identify: readIdentify(source?.identify),
    tenders: readTenders(source?.tenders, context.features, notes),
    tip: readTip(source?.tip, notes),
    guestName: {
      mode: oneOf(
        asRecord(source?.guestName)?.mode,
        ['off', 'optional', 'required'] as const,
        DEFAULT_KIOSK_FLOW.guestName.mode,
      ),
    },
    survey: readSurvey(source?.survey, notes),
    idle: readIdle(source?.idle, notes),
    motion: oneOf(source?.motion, ['full', 'reduced'] as const, DEFAULT_KIOSK_FLOW.motion),
    entryDerived,
  };
}

/**
 * The zero-config first screen: the tenant's own menu categories, the first one
 * given the hero slot because a constellation with no anchor reads as a grid.
 */
export function entryNodesFromCategories(
  categories: readonly { id: string; title: string }[],
): KioskEntryNode[] {
  const nodes: KioskEntryNode[] = [];
  for (const category of categories) {
    if (nodes.length >= MAX_ENTRY_NODES) break;
    const id = text(category?.id, MAX_LABEL);
    const label = text(category?.title, MAX_LABEL);
    if (!id || !label) continue;
    nodes.push({
      id,
      label,
      emphasis: nodes.length === 0 ? 'hero' : 'standard',
      target: { kind: 'category', categoryId: id },
    });
  }
  return nodes;
}

// -- readers ---------------------------------------------------------------

function readAttract(value: unknown): KioskFlow['attract'] {
  const source = asRecord(value);
  return {
    headline: text(source?.headline, MAX_PROMPT),
    invite: text(source?.invite, MAX_PROMPT) ?? DEFAULT_KIOSK_FLOW.attract.invite,
    showLogo: bool(source?.showLogo, DEFAULT_KIOSK_FLOW.attract.showLogo),
  };
}

/** The tiles a tenant configured, after every unusable one is dropped. */
function readNodes(
  entry: unknown,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
): readonly KioskEntryNode[] {
  const raw = asRecord(entry)?.nodes;
  if (!Array.isArray(raw)) return [];
  return parseNodeList(raw, 0, menu, notes, 'kiosk.entry.nodes');
}

function parseNodeList(
  raw: readonly unknown[],
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskEntryNode[] {
  const nodes: KioskEntryNode[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of raw.entries()) {
    if (nodes.length >= MAX_ENTRY_NODES) {
      note(notes, path, `Only the first ${MAX_ENTRY_NODES} tiles are shown.`);
      break;
    }
    const node = parseNode(candidate, depth, menu, notes, `${path}[${index}]`);
    if (!node) continue;
    // First id wins. A duplicate is a copy-paste in the editor, and silently
    // rendering two tiles that route to the same place is worse than one.
    if (seen.has(node.id)) {
      note(notes, `${path}[${index}].id`, `Another tile already uses the id "${node.id}".`);
      continue;
    }
    seen.add(node.id);
    nodes.push(node);
  }
  return nodes;
}

function parseNode(
  value: unknown,
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskEntryNode | null {
  const source = asRecord(value);
  if (!source) {
    note(notes, path, 'Not a tile.');
    return null;
  }
  const id = text(source.id, MAX_LABEL);
  const label = text(source.label, MAX_LABEL);
  if (!id || !label) {
    note(notes, path, 'A tile needs an id and a label.');
    return null;
  }
  const target = parseTarget(source.target, depth, menu, notes, `${path}.target`);
  if (!target) return null;
  const imageSlug = text(source.imageSlug, MAX_LABEL);
  const caption = text(source.caption, MAX_PROMPT);
  return {
    id,
    label,
    emphasis: oneOf(source.emphasis, EMPHASES, 'standard'),
    target,
    ...(imageSlug ? { imageSlug } : {}),
    ...(caption ? { caption } : {}),
  };
}

function parseTarget(
  value: unknown,
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskNodeTarget | null {
  const source = asRecord(value);
  if (!source) {
    note(notes, path, 'A tile needs to point somewhere.');
    return null;
  }
  switch (source.kind) {
    case 'category': {
      const categoryId = text(source.categoryId, MAX_LABEL);
      if (!categoryId) return null;
      // Only checkable when the menu is known. A caller who has not loaded it
      // gets the tile kept, never a blanked screen.
      if (menu.categories.length > 0 && !menu.categories.some((c) => c.id === categoryId)) {
        note(notes, path, `No category "${categoryId}" on this menu; the tile would be a dead button.`);
        return null;
      }
      return { kind: 'category', categoryId };
    }
    case 'item': {
      const itemSlug = text(source.itemSlug, MAX_LABEL);
      if (!itemSlug) return null;
      if (menu.itemSlugs.length > 0 && !menu.itemSlugs.includes(itemSlug)) {
        note(notes, path, `No item "${itemSlug}" on this menu; the tile would be a dead button.`);
        return null;
      }
      return { kind: 'item', itemSlug };
    }
    case 'utility': {
      const utility = oneOf(source.utility, UTILITIES, null);
      return utility ? { kind: 'utility', utility } : null;
    }
    case 'group': {
      // One level only. A kiosk is a linear task; a guest who can get three
      // taps deep into nested groups has been given a file browser.
      if (depth > 0) {
        note(notes, path, 'Groups nest one level only.');
        return null;
      }
      if (!Array.isArray(source.nodes)) return null;
      const nodes = parseNodeList(source.nodes, depth + 1, menu, notes, `${path}.nodes`);
      return nodes.length > 0 ? { kind: 'group', nodes } : null;
    }
    default:
      note(notes, path, 'Unknown tile kind.');
      return null;
  }
}

function readIdentify(value: unknown): KioskFlow['identify'] {
  const source = asRecord(value);
  const methods = uniqueMembers(source?.methods, IDENTIFY_METHODS);
  const mode = oneOf(source?.mode, ['off', 'optional'] as const, DEFAULT_KIOSK_FLOW.identify.mode);
  // Identify with no way to identify is off, not a dead end the guest can enter.
  if (mode === 'off' || methods.length === 0) return { mode: 'off', methods: [] };
  return { mode, methods };
}

/**
 * The tenders on offer, intersected with what the platform has enabled.
 *
 * `card` always survives: a kiosk that cannot take a card is not a kiosk, and a
 * config that lists nothing usable falls back to it rather than to a payment
 * screen with no buttons.
 */
function readTenders(
  value: unknown,
  features: KioskFlowContext['features'],
  notes: KioskFlowNote[] | null,
): readonly KioskTender[] {
  const listed = uniqueMembers(value, TENDERS);
  const allowed = listed.filter((tender) => {
    const required = FEATURE_GATED_TENDERS[tender];
    if (!required) return true;
    if (features?.[required] === true) return true;
    note(notes, 'kiosk.tenders', `"${tender}" needs the brand's stored-value feature switched on.`);
    return false;
  });
  return allowed.length > 0 ? allowed : DEFAULT_KIOSK_FLOW.tenders;
}

function readTip(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['tip'] {
  const source = asRecord(value);
  const enabled = bool(source?.enabled, DEFAULT_KIOSK_FLOW.tip.enabled);
  if (!enabled) return { enabled: false, presetsCents: [] };
  const presets = Array.isArray(source?.presetsCents) ? source.presetsCents : [];
  const cents: number[] = [];
  for (const preset of presets) {
    if (cents.length >= MAX_TIP_PRESETS) break;
    // Integer cents, never float dollars (CLAUDE.md), and never negative: a
    // "tip" that took money off would be a discount with a friendly name.
    if (typeof preset !== 'number' || !Number.isInteger(preset) || preset <= 0) continue;
    if (!cents.includes(preset)) cents.push(preset);
  }
  if (cents.length > 0) return { enabled: true, presetsCents: cents };
  note(notes, 'kiosk.tip', 'Tipping is on but no usable preset survived, so it is off.');
  return { enabled: false, presetsCents: [] };
}

function readSurvey(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['survey'] {
  const source = asRecord(value);
  if (!bool(source?.enabled, false)) return { enabled: false, prompt: '', groups: [] };
  const raw = Array.isArray(source?.groups) ? source.groups : [];
  const groups: KioskSurveyGroup[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (groups.length >= MAX_SURVEY_GROUPS) break;
    const group = asRecord(candidate);
    const id = text(group?.id, MAX_LABEL);
    const label = text(group?.label, MAX_LABEL);
    if (!id || !label || seen.has(id)) continue;
    const options = parseSurveyOptions(group?.options);
    if (options.length === 0) continue;
    seen.add(id);
    groups.push({ id, label, options });
  }
  if (groups.length === 0) {
    note(notes, 'kiosk.survey', 'The survey is on but no group has a usable option, so it is off.');
    return { enabled: false, prompt: '', groups: [] };
  }
  return {
    enabled: true,
    prompt: text(source?.prompt, MAX_PROMPT) ?? 'Where have you heard about us?',
    groups,
  };
}

function parseSurveyOptions(value: unknown): KioskSurveyOption[] {
  if (!Array.isArray(value)) return [];
  const options: KioskSurveyOption[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (options.length >= MAX_SURVEY_OPTIONS) break;
    const option = asRecord(candidate);
    const id = text(option?.id, MAX_LABEL);
    const label = text(option?.label, MAX_LABEL);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

/**
 * The idle clock.
 *
 * The warning has to land far enough before the reset to be read and acted on,
 * so a config that inverts them or collapses the gap is corrected rather than
 * honoured -- a warning that appears one second before the bag vanishes is a
 * flicker, not a warning.
 */
function readIdle(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['idle'] {
  const source = asRecord(value);
  const warnMs = clampInt(
    source?.warnMs, KIOSK_IDLE_MIN_MS, KIOSK_IDLE_MAX_MS, DEFAULT_KIOSK_FLOW.idle.warnMs,
  );
  const resetMs = clampInt(
    source?.resetMs, KIOSK_IDLE_MIN_MS, KIOSK_IDLE_MAX_MS, DEFAULT_KIOSK_FLOW.idle.resetMs,
  );
  if (resetMs - warnMs >= MIN_IDLE_GAP_MS) return { warnMs, resetMs };
  note(notes, 'kiosk.idle.resetMs', 'The reset was moved out so the warning is readable before it lands.');
  return { warnMs, resetMs: Math.min(KIOSK_IDLE_MAX_MS, warnMs + MIN_IDLE_GAP_MS) };
}

// -- primitives ------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A trimmed non-empty string within bounds, or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string, F extends T | null>(
  value: unknown,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function uniqueMembers<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const members: T[] = [];
  for (const candidate of value) {
    const member = oneOf(candidate, allowed, null);
    if (member && !members.includes(member)) members.push(member);
  }
  return members;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** No-op when resolving, a record when inspecting. One walk, two behaviours. */
function note(sink: KioskFlowNote[] | null, path: string, message: string): void {
  if (sink) sink.push({ path, message });
}
