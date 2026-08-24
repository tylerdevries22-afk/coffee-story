export type PackSelectionInput = {
  itemSlug: string;
  quantity: number;
};

export type PackDefinition = {
  packSize: number | null;
  choiceSource: 'lineup' | 'static' | null;
  eligibleItemSlugs: readonly string[];
};

export type PackChoiceAvailability = {
  itemSlug: string;
  name: string;
  isListed: boolean;
  is86d: boolean;
  packSize: number | null;
  rotation: 'permanent' | 'rotating' | 'day_specific';
  dropOrderable: boolean;
};

export type ResolvedPackContent = {
  item_slug: string;
  name: string;
  quantity: number;
};

export class PackOrderError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'catalog_invalid' | 'item_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PackOrderError';
  }
}

/**
 * Validate one line's pack recipe against authored eligibility and live stock.
 * The returned names come from the server catalog, never from the kiosk.
 */
export function validatePackSelection(
  definition: PackDefinition,
  contents: readonly PackSelectionInput[] | undefined,
  choices: readonly PackChoiceAvailability[],
): ResolvedPackContent[] {
  if (definition.packSize === null) {
    if (contents !== undefined) {
      throw new PackOrderError('invalid_request', 'Only a pack item may carry packContents.');
    }
    return [];
  }
  if (!Number.isInteger(definition.packSize) || definition.packSize < 1 || definition.packSize > 100
    || (definition.choiceSource !== 'lineup' && definition.choiceSource !== 'static')
    || definition.eligibleItemSlugs.length < 1 || definition.eligibleItemSlugs.length > 100) {
    throw new PackOrderError('catalog_invalid', 'This pack has an invalid server configuration.');
  }
  if (!contents || contents.length < 1 || contents.length > 100) {
    throw new PackOrderError('invalid_request', 'A pack needs its exact contents.');
  }

  const seen = new Set<string>();
  let allocated = 0;
  for (const content of contents) {
    if (!content.itemSlug || content.itemSlug.length > 100
      || !Number.isInteger(content.quantity) || content.quantity < 1 || content.quantity > 100
      || seen.has(content.itemSlug)) {
      throw new PackOrderError('invalid_request', 'Pack contents need unique item slugs and positive quantities.');
    }
    seen.add(content.itemSlug);
    allocated += content.quantity;
  }
  if (allocated !== definition.packSize) {
    throw new PackOrderError('invalid_request', `This pack must contain exactly ${definition.packSize} items.`);
  }

  const eligible = new Set(definition.eligibleItemSlugs);
  const bySlug = new Map(choices.map((choice) => [choice.itemSlug, choice]));
  return [...contents]
    .sort((left, right) => left.itemSlug.localeCompare(right.itemSlug))
    .map((content) => {
      if (!eligible.has(content.itemSlug)) {
        throw new PackOrderError('invalid_request', `"${content.itemSlug}" is not eligible for this pack.`);
      }
      const choice = bySlug.get(content.itemSlug);
      const available = choice && choice.isListed && !choice.is86d && choice.packSize === null
        && (definition.choiceSource === 'static' || choice.rotation === 'permanent' || choice.dropOrderable);
      if (!choice || !available) {
        throw new PackOrderError('item_unavailable', `"${content.itemSlug}" is not available for this pack right now.`);
      }
      return { item_slug: choice.itemSlug, name: choice.name, quantity: content.quantity };
    });
}
