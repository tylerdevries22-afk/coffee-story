export type Generator<T> = (random: () => number) => T;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function forAll(
  seed: number,
  count: number,
  property: (random: () => number, index: number) => void,
): void;

export function forAll<T>(
  seed: number,
  count: number,
  generate: Generator<T>,
  property: (value: T, index: number) => void,
): void;

export function forAll<T>(
  seed: number,
  count: number,
  generateOrProperty: Generator<T> | ((random: () => number, index: number) => void),
  property?: (value: T, index: number) => void,
): void {
  const random = mulberry32(seed);
  for (let index = 0; index < count; index += 1) {
    if (property) {
      property((generateOrProperty as Generator<T>)(random), index);
    } else {
      (generateOrProperty as (random: () => number, index: number) => void)(random, index);
    }
  }
}
