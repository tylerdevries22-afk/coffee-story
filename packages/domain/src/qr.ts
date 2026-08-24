/**
 * QR encoding for surfaces nobody can tap.
 *
 * A wall display and a printed receipt have the same problem: the only way to
 * hand someone a URL is to let their phone read it off a surface. Encoding is
 * delegated to `qrcode-generator` (the reference JS implementation of the
 * spec, dependency-free) because a hand-rolled encoder that is subtly wrong
 * produces a code that scans on the developer's phone and fails on a guest's.
 *
 * What is ours is the rendering: the library's own `createSvgTag` emits one
 * `<rect>` per dark module -- upwards of a thousand nodes -- with its own
 * hard-coded colours, which both bloats the document and breaks rule 4. We
 * take the module matrix and emit a single path whose fill is a token.
 */
import qrcode from 'qrcode-generator';

/**
 * 'M' (~15% recovery) rather than a higher level on purpose.
 *
 * Raising correction adds modules, and more modules inside a fixed panel
 * means each one is smaller. A wall QR is read from two metres away by a
 * hand-held camera, where module size dominates: the failure mode here is "too
 * small to resolve", not "partially obscured".
 */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export type QrMatrix = {
  /** Row-major dark/light modules, excluding the quiet zone. */
  modules: readonly (readonly boolean[])[];
  /** Modules per side. */
  count: number;
};

export class QrEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrEncodeError';
  }
}

/**
 * The spec's own limit for byte mode at version 40 / level L. Anything near
 * it is far past what a scannable wall panel can hold anyway, so the real
 * purpose of the check is to fail loudly at build time rather than emit a
 * dense grey square nobody's phone can read.
 */
const MAX_BYTES = 2_953;

export function qrMatrix(text: string, correction: QrErrorCorrection = 'M'): QrMatrix {
  if (typeof text !== 'string' || text.length === 0) {
    throw new QrEncodeError('nothing to encode');
  }
  if (text.length > MAX_BYTES) {
    throw new QrEncodeError(`too long to encode: ${text.length} characters`);
  }
  const code = qrcode(0, correction);
  code.addData(text, 'Byte');
  try {
    code.make();
  } catch (cause) {
    throw new QrEncodeError(`could not encode: ${(cause as Error).message}`);
  }
  const count = code.getModuleCount();
  const modules: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < count; col += 1) line.push(code.isDark(row, col));
    modules.push(line);
  }
  return { modules, count };
}

/**
 * One `d` attribute for every dark module, in a viewBox of
 * `count + 2 * quietZone` units so the caller scales with CSS alone.
 *
 * Horizontal runs are merged into a single rectangle each. On a typical URL
 * that is roughly a third of the node count of per-module rects, and the
 * result is one DOM node either way -- which is what keeps a board that
 * re-renders every few seconds from doing real layout work.
 */
export function qrSvgPath(matrix: QrMatrix, quietZone = 2): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.count; row += 1) {
    const line = matrix.modules[row] ?? [];
    let runStart = -1;
    for (let col = 0; col <= matrix.count; col += 1) {
      const dark = col < matrix.count && line[col] === true;
      if (dark && runStart === -1) runStart = col;
      if (!dark && runStart !== -1) {
        parts.push(`M${runStart + quietZone} ${row + quietZone}h${col - runStart}v1h-${col - runStart}z`);
        runStart = -1;
      }
    }
  }
  return parts.join('');
}

/** The viewBox side length for a matrix drawn with `qrSvgPath`. */
export function qrViewBoxSize(matrix: QrMatrix, quietZone = 2): number {
  return matrix.count + quietZone * 2;
}
