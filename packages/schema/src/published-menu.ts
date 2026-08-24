/** Structured config failure shared by menu readers and the pricing service. */
export class PublishedMenuConfigurationError extends Error {
  readonly code = 'published_menu_count';
  readonly count: number;

  constructor(count: number) {
    super(`Expected exactly one published menu; found ${count}.`);
    this.name = 'PublishedMenuConfigurationError';
    this.count = count;
  }
}

/** A slug is only unique inside one menu, so callers must choose one first. */
export function requireSinglePublishedMenuId(rows: readonly { id: string }[]): string {
  const [menu] = rows;
  if (rows.length !== 1 || !menu) throw new PublishedMenuConfigurationError(rows.length);
  return menu.id;
}
