/**
 * Opening and closing lists.
 *
 * The task and its completion are separate ideas: a list can be edited without
 * rewriting the record of who did what yesterday. That separation lives in the
 * schema (0025) and is mirrored here.
 */
export type ChecklistRecurrence = 'opening' | 'closing' | 'daily';

export type ChecklistItem = {
  id: string;
  title: string;
  detail: string;
  recurrence: ChecklistRecurrence;
  sortOrder: number;
  /** Null until someone ticks it. */
  completedAt: string | null;
  completedBy: string | null;
};

export function itemsFor(
  items: readonly ChecklistItem[],
  recurrence: ChecklistRecurrence,
): ChecklistItem[] {
  return items
    .filter((item) => item.recurrence === recurrence)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function progressOf(items: readonly ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.completedAt !== null).length, total: items.length };
}

/**
 * Ticking an item, and un-ticking it.
 *
 * Un-ticking is allowed on purpose. A checklist people cannot correct is a
 * checklist people stop trusting, and a mis-tap at 6am should not leave the
 * closing manager reading a lie.
 */
export function toggleItem(
  items: readonly ChecklistItem[],
  id: string,
  by: string,
  at: string,
): ChecklistItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    return item.completedAt === null
      ? { ...item, completedAt: at, completedBy: by }
      : { ...item, completedAt: null, completedBy: null };
  });
}

/**
 * What still stands between the shift and closing.
 *
 * Opening tasks count too: an opening job nobody did is still undone at 9pm,
 * and hiding it because the list is called "opening" is how it stays undone.
 */
export function outstandingAtClose(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items
    .filter((item) => item.completedAt === null && item.recurrence !== 'daily')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
