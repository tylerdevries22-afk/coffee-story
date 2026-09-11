import type { SquareOrderLine } from '../square/client';

/** The cart lines in Square's shape. Pure; covered by orders.test.ts. */
export function buildSquareLines(
  lines: readonly {
    name: string;
    quantity: number;
    unitPriceCents: number;
    options: readonly string[];
    packContents?: readonly { name: string; quantity: number }[];
  }[],
): SquareOrderLine[] {
  return lines.map((line) => {
    const packNote = line.packContents && line.packContents.length > 0
      ? `Inside each pack: ${line.packContents.map((content) => `${content.quantity}x ${content.name}`).join(', ')}`
      : undefined;
    return {
      name: line.options.length > 0 ? `${line.name} (${line.options.join(', ')})` : line.name,
      quantity: String(line.quantity),
      base_price_money: { amount: line.unitPriceCents, currency: 'USD' },
      ...(packNote ? { note: packNote } : {}),
    };
  });
}

/** One exact provider line when another tender already paid part of the order. */
export function buildSquareBalanceLine(amountCents: number): SquareOrderLine[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('Square order balance must be positive integer cents.');
  }
  return [{
    name: 'Card-funded order balance',
    quantity: '1',
    base_price_money: { amount: amountCents, currency: 'USD' },
  }];
}
