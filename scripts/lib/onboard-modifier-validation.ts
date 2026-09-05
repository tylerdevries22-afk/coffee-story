import { nonEmptyString, objectRecord } from './onboard-json.js';

function choiceId(
  itemSlug: string, groupId: string, value: unknown, problems: string[],
): string | null {
  const choice = objectRecord(value);
  if (!choice || !nonEmptyString(choice.id) || !nonEmptyString(choice.name)
    || !Number.isInteger(choice.priceDeltaCents) || Number(choice.priceDeltaCents) < 0) {
    problems.push(`modifiers.json: "${itemSlug}" group "${groupId}" has an invalid choice.`);
    return null;
  }
  return choice.id;
}

function groupShape(
  itemSlug: string, value: unknown, problems: string[],
): Record<string, unknown> | null {
  const group = objectRecord(value);
  if (!group || !nonEmptyString(group.id) || !nonEmptyString(group.name)
    || (group.select !== 'single' && group.select !== 'multi')
    || typeof group.required !== 'boolean' || !Number.isInteger(group.maxChoices)
    || Number(group.maxChoices) < 1 || !Array.isArray(group.choices) || group.choices.length === 0) {
    problems.push(`modifiers.json: "${itemSlug}" has an invalid option group.`);
    return null;
  }
  if (group.select === 'single' && group.maxChoices !== 1) {
    problems.push(`modifiers.json: "${itemSlug}" group "${group.id}" must set maxChoices to 1 for single select.`);
  }
  return group;
}

export function validateModifierGroups(
  itemSlug: string, groups: unknown[], problems: string[],
): void {
  const choicesByGroup = new Map<string, Set<string>>();
  const allChoiceIds = new Set<string>();
  const validGroups: Record<string, unknown>[] = [];
  for (const value of groups) {
    const group = groupShape(itemSlug, value, problems);
    if (!group || !nonEmptyString(group.id) || !Array.isArray(group.choices)) continue;
    if (choicesByGroup.has(group.id)) {
      problems.push(`modifiers.json: "${itemSlug}" repeats group id "${group.id}".`);
    }
    const groupChoiceIds = new Set<string>();
    for (const choice of group.choices) {
      const id = choiceId(itemSlug, group.id, choice, problems);
      if (id && allChoiceIds.has(id)) {
        problems.push(`modifiers.json: "${itemSlug}" repeats choice id "${id}".`);
      }
      if (id) { groupChoiceIds.add(id); allChoiceIds.add(id); }
    }
    choicesByGroup.set(group.id, groupChoiceIds);
    validGroups.push(group);
  }
  for (const group of validGroups) {
    if (group.dependsOn === undefined) continue;
    const dependency = objectRecord(group.dependsOn);
    const ids = dependency && Array.isArray(dependency.choiceIds) ? dependency.choiceIds : [];
    const source = dependency && nonEmptyString(dependency.groupId)
      ? choicesByGroup.get(dependency.groupId) : undefined;
    if (!dependency || !source || ids.length === 0
      || ids.some((id) => !nonEmptyString(id) || !source.has(id))) {
      problems.push(`modifiers.json: "${itemSlug}" group "${String(group.id)}" has an invalid dependency.`);
    }
  }
}
