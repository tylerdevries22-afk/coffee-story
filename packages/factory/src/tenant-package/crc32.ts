const TABLE = new Uint32Array(256);

for (let index = 0; index < TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  TABLE[index] = value >>> 0;
}

export function crc32(buffer: Uint8Array): number {
  return crc32Finish(crc32Update(crc32Start(), buffer));
}

export const crc32Start = (): number => 0xffffffff;

export function crc32Update(state: number, buffer: Uint8Array): number {
  let value = state;
  for (const byte of buffer) value = TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return value >>> 0;
}

export const crc32Finish = (state: number): number => (state ^ 0xffffffff) >>> 0;
