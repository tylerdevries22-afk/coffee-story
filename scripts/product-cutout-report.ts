import type { ProductCutoutFault } from '@platform/ui/src/product-cutout';

export function reportProductCutoutFaults(
  refused: readonly (readonly [string, ProductCutoutFault[]])[],
): void {
  if (refused.length === 0) return;
  console.log(`\n${refused.length} cut-out(s) are outside what the pipeline may fix, and need regenerating:`);
  for (const [name, faults] of refused) console.log(`  ${name} (${faults.join(', ')})`);
  console.log('See docs/PRODUCT-CUTOUTS.md for the locked template that produced the set.');
}
