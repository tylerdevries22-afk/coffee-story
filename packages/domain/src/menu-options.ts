/**
 * The option model: how a menu item's customizations are shaped, shown,
 * validated and priced.
 *
 * Generic on purpose. A tenant's groups and choices come from its own menu
 * (`item.optionGroups`, written by `pnpm onboard --apply`); this module only
 * knows what a group is and what selecting from one means. One shop's actual
 * vocabulary -- its categories, its milks, its flavour lists -- lives in
 * `menu-options.fixture.ts` and is used only by tests.
 *
 * Pure by construction: no asset imports, so `node:test` can reach it.
 */

export type OptionSelect = 'single' | 'multi';

export type OptionChoice = {
  id: string;
  name: string;
  /**
   * Added to the line's unit price, in integer cents. Never negative: a
   * customization that took money off would let a guest price a drink down.
   */
  priceDeltaCents: number;
};

/**
 * A group is either a radio list (`single`) or a checkbox list (`multi`).
 *
 * `dependsOn` is what lets "Ice" appear only once a guest has asked for the
 * drink iced. A hidden group is not selectable, not required, not priced and
 * not summarised -- see `visibleOptionGroups`.
 */
export type OptionGroup = {
  id: string;
  name: string;
  select: OptionSelect;
  /** Blocks Add to Bag until a choice is made, while the group is visible. */
  required: boolean;
  /** Upper bound for `multi` groups. Always 1 for `single`. */
  maxChoices: number;
  dependsOn?: { groupId: string; choiceIds: readonly string[] };
  choices: readonly OptionChoice[];
};

/** Chosen choice ids, keyed by group id. */
export type OptionSelection = Readonly<Record<string, readonly string[]>>;


/** A group is only in play when its dependency is satisfied by the selection. */
export function isGroupVisible(group: OptionGroup, selection: OptionSelection): boolean {
  const dependency = group.dependsOn;
  if (!dependency) return true;
  const chosen = selection[dependency.groupId] ?? [];
  return chosen.some((id) => dependency.choiceIds.includes(id));
}

export function visibleOptionGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionGroup[] {
  return groups.filter((group) => isGroupVisible(group, selection));
}

/**
 * Applies a tap on one choice.
 *
 * A `single` group replaces its selection; tapping the chosen row again in a
 * required group keeps it, because a required group with nothing chosen is a
 * dead end the guest cannot leave. An optional single group clears instead, so
 * "Whole Milk" can be un-picked. A `multi` group toggles up to `maxChoices`.
 */
export function toggleOptionChoice(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
  groupId: string,
  choiceId: string,
): OptionSelection {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group || !group.choices.some((choice) => choice.id === choiceId)) return selection;
  const current = selection[groupId] ?? [];

  if (group.select === 'single') {
    const next = current.includes(choiceId) && !group.required ? [] : [choiceId];
    return pruneHiddenGroups(groups, { ...selection, [groupId]: next });
  }

  const next = current.includes(choiceId)
    ? current.filter((id) => id !== choiceId)
    : current.length >= group.maxChoices
      ? current
      : [...current, choiceId];
  return pruneHiddenGroups(groups, { ...selection, [groupId]: next });
}

/**
 * Drops selections belonging to groups the current selection has hidden.
 *
 * Without this, switching a drink from Iced to Hot left the ice level chosen
 * and still in the summary: the bag read "Hot · Extra Ice" and the barista
 * got a contradiction.
 */
export function pruneHiddenGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionSelection {
  const next: Record<string, readonly string[]> = {};
  for (const group of groups) {
    if (!isGroupVisible(group, selection)) continue;
    const chosen = selection[group.id];
    if (chosen && chosen.length > 0) next[group.id] = chosen;
  }
  return next;
}

/** Pre-selects the first choice of every visible required group. */
export function defaultOptionSelection(groups: readonly OptionGroup[]): OptionSelection {
  let selection: OptionSelection = {};
  for (const group of groups) {
    if (!group.required || !isGroupVisible(group, selection)) continue;
    const first = group.choices[0];
    if (first) selection = { ...selection, [group.id]: [first.id] };
  }
  return selection;
}

/** Required, visible groups that still have nothing chosen. */
export function missingRequiredGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionGroup[] {
  return visibleOptionGroups(groups, selection).filter(
    (group) => group.required && (selection[group.id] ?? []).length === 0,
  );
}

/** The chosen choices, in group order, ignoring anything hidden or unknown. */
export function selectedChoices(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionChoice[] {
  return visibleOptionGroups(groups, selection).flatMap((group) => {
    const chosen = selection[group.id] ?? [];
    return group.choices.filter((choice) => chosen.includes(choice.id));
  });
}

export function optionDeltaCents(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): number {
  return selectedChoices(groups, selection).reduce(
    (total, choice) => total + Math.max(0, choice.priceDeltaCents),
    0,
  );
}

/**
 * A stable fingerprint for one configuration.
 *
 * Sorted, so the same drink configured in a different tap order merges with
 * the line already in the bag instead of adding a second one.
 */
export function optionFingerprint(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): string {
  const ids = selectedChoices(groups, selection).map((choice) => choice.id);
  return [...ids].sort().join('+') || 'plain';
}
