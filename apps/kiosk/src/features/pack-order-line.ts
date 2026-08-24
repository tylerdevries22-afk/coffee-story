import type { OrderLine } from '@platform/domain';

import { isComplete, packFingerprint, packSummary, type PackFill } from '@/features/pack-fill';

/**
 * Carries a completed box as structured data all the way to fulfillment.
 *
 * The contents also become part of the cart-line identity, so two differently
 * filled boxes cannot merge and leave the barista with only the first fill.
 */
export function withPackFill(
  line: OrderLine,
  packSize: number,
  fill: PackFill,
  nameOf: (choiceId: string) => string,
): OrderLine | null {
  if (!isComplete({ packSize }, fill)) return null;
  const summary = packSummary(fill, nameOf);
  const packContents = Object.entries(fill)
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([itemSlug, quantity]) => ({ itemSlug, name: nameOf(itemSlug), quantity }));
  if (!summary || packContents.length === 0) return null;
  return {
    ...line,
    id: `${line.id}#pack:${packFingerprint(fill)}`,
    optionSummary: [line.optionSummary, summary].filter(Boolean).join(' · '),
    packContents,
  };
}
