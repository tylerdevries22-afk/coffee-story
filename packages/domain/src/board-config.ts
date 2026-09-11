import {
  DEFAULT_TIER_LADDER,
  TIER_TONES,
  type BoardTier,
  type TierTone,
} from './board-tiers';

/** How the board is configured for one brand. */
export type BoardConfig = {
  showGuestStatus: boolean;
  showChannel: boolean;
  ladder: readonly BoardTier[];
  appUrl: string | null;
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

/** Only absolute HTTPS URLs can be displayed. */
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
    tone: TIER_TONES.includes(tone as TierTone)
      ? (tone as TierTone)
      : (TIER_TONES[Math.min(index, TIER_TONES.length - 1)] ?? 'muted'),
    color: typeof color === 'string' && HEX.test(color) ? color : null,
    icon: typeof icon === 'string' && icon.trim().length > 0 && [...icon.trim()].length <= 2
      ? icon.trim()
      : null,
  };
}

/** Merge a tenant's partial board config over safe defaults. */
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
      .sort((a, b) => a.minLifetimePoints - b.minLifetimePoints);
    if (tiers.length > 0) resolved.ladder = tiers;
  }
  return resolved;
}
