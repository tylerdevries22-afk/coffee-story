export const BRAND_FLAGS = [
  'drops',
  'catering',
  'delivery',
  'multi_location',
  'sms',
  'stored_value',
  'referrals',
] as const;

export const EDITABLE_TOKEN_KEYS = [
  'primary',
  'surface',
  'surfaceElevated',
  'accent',
  'textPrimary',
  'textMuted',
] as const;

export type EditableTokens = Record<(typeof EDITABLE_TOKEN_KEYS)[number], string>;
export type EditableTier = {
  slug: string;
  label: string;
  minLifetimePoints: number;
  tone: 'muted' | 'accent' | 'success' | 'primary';
  color: string;
  icon: string;
};
export type BrandEditorState = {
  tokens: EditableTokens;
  appName: string;
  pointsName: string;
  flags: Record<(typeof BRAND_FLAGS)[number], boolean>;
  tiers: EditableTier[];
};

const HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * What an unconfigured brand sees in this editor, and what it persists if the
 * owner saves without touching a field. Neutral on purpose: these were the
 * launch tenant's palette and its ladder down to `coffee-legend`, so a second
 * franchisee opening Brand config was shown another shop's identity already
 * filled in, one Save away from being written to their own brand row.
 */
const DEFAULT_TOKENS: EditableTokens = {
  primary: '#1F2933',
  surface: '#F7F7F5',
  surfaceElevated: '#FFFFFF',
  accent: '#4A5568',
  textPrimary: '#1A202C',
  textMuted: '#5A6472',
};
const DEFAULT_TIERS: EditableTier[] = [
  { slug: 'member', label: 'Member', minLifetimePoints: 0, tone: 'muted', color: '', icon: '' },
  { slug: 'regular', label: 'Regular', minLifetimePoints: 500, tone: 'accent', color: '', icon: '' },
  { slug: 'insider', label: 'Insider', minLifetimePoints: 1500, tone: 'success', color: '', icon: '' },
  { slug: 'legend', label: 'Legend', minLifetimePoints: 2500, tone: 'primary', color: '', icon: '' },
];

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function shortText(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text.length > 0 && text.length <= maximum ? text : fallback;
}

/** Converts persisted config into total, bounded editor state. */
export function brandEditorStateOf(config: unknown): BrandEditorState {
  const root = objectOf(config);
  const storedTokens = objectOf(root.tokens);
  const storedCopy = objectOf(root.copy);
  const storedFlags = objectOf(root.features);
  const board = objectOf(root.board);
  const tokens = { ...DEFAULT_TOKENS };
  for (const key of EDITABLE_TOKEN_KEYS) {
    if (typeof storedTokens[key] === 'string' && HEX.test(storedTokens[key])) {
      tokens[key] = storedTokens[key];
    }
  }
  const tiers = Array.isArray(board.tiers)
    ? board.tiers.flatMap((value, index): EditableTier[] => {
      const tier = objectOf(value);
      const slug = shortText(tier.slug, '', 64);
      const label = shortText(tier.label, '', 80);
      if (!slug || !label) return [];
      return [{
        slug,
        label,
        minLifetimePoints: typeof tier.minLifetimePoints === 'number'
          && Number.isInteger(tier.minLifetimePoints)
          && tier.minLifetimePoints >= 0
          ? tier.minLifetimePoints
          : DEFAULT_TIERS[index]?.minLifetimePoints ?? index * 500,
        tone: tier.tone === 'muted' || tier.tone === 'accent' || tier.tone === 'success' || tier.tone === 'primary'
          ? tier.tone
          : DEFAULT_TIERS[index]?.tone ?? 'muted',
        color: typeof tier.color === 'string' && HEX.test(tier.color) ? tier.color : '',
        icon: shortText(tier.icon, '', 4),
      }];
    })
    : [];
  return {
    tokens,
    appName: shortText(storedCopy.appName, 'Your Brand', 80),
    pointsName: shortText(storedCopy.pointsName, 'Points', 40),
    flags: Object.fromEntries(BRAND_FLAGS.map((flag) => [flag, storedFlags[flag] === true])) as BrandEditorState['flags'],
    tiers: tiers.length > 0 ? tiers : DEFAULT_TIERS.map((tier) => ({ ...tier })),
  };
}

/** Produces only the nested keys this editor owns; the database merges them atomically. */
export function brandSettingsPatch(draft: unknown): Record<string, unknown> {
  const state = brandEditorStateOf(draft);
  return {
    tokens: state.tokens,
    copy: { appName: state.appName, pointsName: state.pointsName },
    features: state.flags,
    board: { tiers: state.tiers },
  };
}

export function isBrandHex(value: string): boolean {
  return HEX.test(value);
}
