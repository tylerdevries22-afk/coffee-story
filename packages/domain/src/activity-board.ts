export type ActivityBoardConfig = {
  enabled: boolean;
  title: string;
  showAvatars: boolean;
  maxItems: number;
};

export const DEFAULT_ACTIVITY_BOARD_CONFIG: ActivityBoardConfig = {
  enabled: false,
  title: 'Activity Board',
  showAvatars: true,
  maxItems: 18,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Resolves the tenant-owned wall mode without letting malformed copy blank it. */
export function resolveActivityBoardConfig(value: unknown): ActivityBoardConfig {
  const root = record(value);
  const board = record(root?.board) ?? root;
  if (!board || board.mode !== 'activity') return { ...DEFAULT_ACTIVITY_BOARD_CONFIG };
  const title = typeof board.title === 'string' && board.title.trim().length > 0
    && board.title.trim().length <= 48
    ? board.title.trim()
    : DEFAULT_ACTIVITY_BOARD_CONFIG.title;
  const maxItems = typeof board.maxLines === 'number' && Number.isInteger(board.maxLines)
    && board.maxLines >= 3 && board.maxLines <= 40
    ? board.maxLines
    : DEFAULT_ACTIVITY_BOARD_CONFIG.maxItems;
  return {
    enabled: true,
    title,
    showAvatars: board.showAvatars !== false,
    maxItems,
  };
}

/** Initials are a privacy-preserving avatar when no staff photo is published. */
export function activityInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, '').at(0) ?? '')
    .join('').toUpperCase() || '•';
}
