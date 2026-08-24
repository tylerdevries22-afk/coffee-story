/** Live availability is authoritative once loaded; demo uses the compiled flag. */
export function isItemSoldOut(
  itemId: string,
  compiledSoldOut: boolean | undefined,
  liveSoldOutIds: ReadonlySet<string> | null,
): boolean {
  return liveSoldOutIds === null ? Boolean(compiledSoldOut) : liveSoldOutIds.has(itemId);
}
