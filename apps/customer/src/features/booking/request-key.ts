export function requestKey(
  scope: string,
  clock: () => number = Date.now,
  random: () => number = Math.random,
): string {
  return `${scope}-${clock()}-${random().toString(36).slice(2, 10)}`;
}
