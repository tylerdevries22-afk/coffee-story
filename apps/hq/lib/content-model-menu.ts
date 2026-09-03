import { isRecord, isSafePublicHttpsUrl, SLUG } from './content-guards';
import type { ContentMenuSize, ContentOptionGroup, MenuItemDraft } from './content-model';

function isContentMenuSize(value: unknown): value is ContentMenuSize {
  return isRecord(value) && typeof value.slug === 'string' && typeof value.label === 'string'
    && typeof value.priceCents === 'number';
}

function isContentOptionGroup(value: unknown): value is ContentOptionGroup {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
      || (value.select !== 'single' && value.select !== 'multi') || typeof value.required !== 'boolean'
      || typeof value.maxChoices !== 'number' || !Array.isArray(value.choices)) return false;
  const dependency = value.dependsOn;
  const dependencyValid = dependency === undefined || (isRecord(dependency)
    && typeof dependency.groupId === 'string' && Array.isArray(dependency.choiceIds)
    && dependency.choiceIds.every((choice) => typeof choice === 'string'));
  return dependencyValid && value.choices.every((choice) => isRecord(choice)
    && typeof choice.id === 'string' && typeof choice.name === 'string'
    && typeof choice.priceDeltaCents === 'number');
}

export function isMenuItemDraft(value: unknown): value is MenuItemDraft {
  if (!isRecord(value)) return false;
  return (value.id === null || typeof value.id === 'string')
    && typeof value.name === 'string'
    && typeof value.slug === 'string'
    && typeof value.description === 'string'
    && typeof value.categoryId === 'string'
    && typeof value.basePriceCents === 'number'
    && Array.isArray(value.sizes) && value.sizes.every(isContentMenuSize)
    && Array.isArray(value.optionGroups) && value.optionGroups.every(isContentOptionGroup)
    && (value.imageUrl === null || typeof value.imageUrl === 'string')
    && ['public', 'staff', 'manager', 'owner'].includes(value.audience as string)
    && typeof value.isListed === 'boolean'
    && typeof value.is86d === 'boolean'
    && typeof value.sortOrder === 'number';
}

export function validateMenuItemDraft(
  draft: MenuItemDraft,
  categoryIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  if (draft.name.trim().length < 2 || draft.name.trim().length > 120) {
    issues.push('Name must contain 2–120 characters.');
  }
  if (!SLUG.test(draft.slug) || draft.slug.length > 80) {
    issues.push('Slug must use lowercase letters, numbers, and single hyphens.');
  }
  if (draft.description.trim().length > 600) {
    issues.push('Description cannot exceed 600 characters.');
  }
  if (!categoryIds.has(draft.categoryId)) issues.push('Choose a category from this menu.');
  if (!Number.isInteger(draft.basePriceCents) || draft.basePriceCents < 0 || draft.basePriceCents > 1_000_000) {
    issues.push('Price must be between $0.00 and $10,000.00.');
  }
  const sizeSlugs = new Set<string>();
  if (draft.sizes.length > 12) issues.push('A menu item can contain no more than 12 sizes.');
  for (const size of draft.sizes) {
    if (!SLUG.test(size.slug) || sizeSlugs.has(size.slug)) issues.push('Every size needs a unique portable slug.');
    sizeSlugs.add(size.slug);
    if (size.label.trim().length < 1 || size.label.trim().length > 50) issues.push('Every size needs a label of 1–50 characters.');
    if (!Number.isInteger(size.priceCents) || size.priceCents < 0 || size.priceCents > 1_000_000) issues.push('Every size price must be between $0.00 and $10,000.00.');
  }
  issues.push(...optionGroupIssues(draft.optionGroups));
  if (new TextEncoder().encode(JSON.stringify(draft.optionGroups)).byteLength > 100_000) {
    issues.push('Menu options cannot exceed 100 KB.');
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 100_000) {
    issues.push('Sort order must be a whole number between 0 and 100,000.');
  }
  if (draft.imageUrl && (!isSafePublicHttpsUrl(draft.imageUrl) || draft.imageUrl.length > 2_048)) {
    issues.push('Image URL must use public HTTPS and be at most 2,048 characters.');
  }
  return issues;
}

function optionGroupIssues(optionGroups: ContentOptionGroup[]): string[] {
  const issues: string[] = [];
  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  const choicesByGroup = new Map<string, Set<string>>();
  if (optionGroups.length > 20) issues.push('A menu item can contain no more than 20 option groups.');
  for (const group of optionGroups) {
    if (!SLUG.test(group.id) || groupIds.has(group.id)) issues.push('Every option group needs a unique portable key.');
    // A condition may only look backwards, so the groups it names are already
    // in choicesByGroup and a cycle cannot be expressed at all.
    const parentChoices = group.dependsOn ? choicesByGroup.get(group.dependsOn.groupId) : undefined;
    if (group.dependsOn && (!parentChoices || group.dependsOn.choiceIds.length < 1
        || group.dependsOn.choiceIds.some((choice) => !parentChoices.has(choice)))) {
      issues.push('Option display conditions must reference an earlier group and its choices.');
    }
    groupIds.add(group.id);
    if (group.name.trim().length < 1 || group.name.trim().length > 80) issues.push('Every option group needs a name of 1–80 characters.');
    if (!Number.isInteger(group.maxChoices) || group.maxChoices < 1 || group.maxChoices > 30
        || (group.select === 'single' && group.maxChoices !== 1)) issues.push('Option limits must match their selection type.');
    if (group.choices.length < 1 || group.choices.length > 40) issues.push('Every option group needs 1–40 choices.');
    const currentChoices = new Set<string>();
    for (const choice of group.choices) {
      if (!SLUG.test(choice.id) || choiceIds.has(choice.id)) issues.push('Every option choice needs a unique portable key.');
      choiceIds.add(choice.id);
      currentChoices.add(choice.id);
      if (choice.name.trim().length < 1 || choice.name.trim().length > 80) issues.push('Every option choice needs a name of 1–80 characters.');
      if (!Number.isInteger(choice.priceDeltaCents) || choice.priceDeltaCents < 0 || choice.priceDeltaCents > 1_000_000) issues.push('Option prices must be between $0.00 and $10,000.00.');
    }
    choicesByGroup.set(group.id, currentChoices);
  }
  return issues;
}
