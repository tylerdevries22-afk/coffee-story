import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QrEncodeError, qrMatrix, qrSvgPath, qrViewBoxSize } from './qr';

/**
 * A QR nobody can tap is a QR nobody can debug in the field: if the wall
 * panel is wrong, the failure looks like guests simply not downloading the
 * app. So the encoder's structural invariants are pinned here rather than
 * trusted to a glance at a rendered square.
 */
describe('qrMatrix', () => {
  it('produces a square matrix of a legal version size', () => {
    const matrix = qrMatrix('https://example.com/app');
    // Every QR version is 21 + 4n modules per side.
    assert.equal(matrix.count % 4, 1);
    assert.ok(matrix.count >= 21 && matrix.count <= 177);
    assert.equal(matrix.modules.length, matrix.count);
    for (const row of matrix.modules) assert.equal(row.length, matrix.count);
  });

  it('places the three finder patterns the scanner looks for', () => {
    const { modules, count } = qrMatrix('https://example.com/app');
    // A finder is a 7x7 with a dark ring and a 3x3 dark core. Checking the
    // corners of all three is what separates "a QR" from "a grey square".
    const corners: [number, number][] = [[0, 0], [0, count - 7], [count - 7, 0]];
    for (const [top, left] of corners) {
      assert.equal(modules[top]?.[left], true, 'finder corner must be dark');
      assert.equal(modules[top + 1]?.[left + 1], false, 'finder ring must be light');
      assert.equal(modules[top + 3]?.[left + 3], true, 'finder core must be dark');
    }
  });

  it('grows with the payload rather than truncating it', () => {
    const short = qrMatrix('https://example.com/a');
    const long = qrMatrix(`https://example.com/${'a'.repeat(300)}`);
    assert.ok(long.count > short.count);
  });

  it('is deterministic, so a board that re-renders does not flicker a new code', () => {
    assert.deepEqual(qrMatrix('https://example.com/app'), qrMatrix('https://example.com/app'));
  });

  it('encodes more densely at a higher correction level for the same payload', () => {
    const m = qrMatrix('https://example.com/download-the-app', 'M');
    const h = qrMatrix('https://example.com/download-the-app', 'H');
    assert.ok(h.count >= m.count, 'H must not be smaller than M');
  });

  it('refuses an empty payload rather than emitting an unscannable square', () => {
    assert.throws(() => qrMatrix(''), QrEncodeError);
  });

  it('refuses a payload past what byte mode can hold', () => {
    assert.throws(() => qrMatrix('a'.repeat(3_000)), QrEncodeError);
  });
});

describe('qrSvgPath', () => {
  it('covers exactly the dark modules, offset by the quiet zone', () => {
    const matrix = qrMatrix('https://example.com/app');
    const path = qrSvgPath(matrix, 2);
    // Sum the widths of every run; it must equal the dark module count.
    const drawn = [...path.matchAll(/h(\d+)v1/g)]
      .reduce((total, match) => total + Number(match[1]), 0);
    const dark = matrix.modules.flat().filter(Boolean).length;
    assert.equal(drawn, dark);
  });

  it('merges horizontal runs instead of emitting one rect per module', () => {
    const matrix = qrMatrix('https://example.com/app');
    const runs = qrSvgPath(matrix).split('M').length - 1;
    const dark = matrix.modules.flat().filter(Boolean).length;
    assert.ok(runs < dark, 'a run-merged path must have fewer subpaths than dark modules');
  });

  it('never draws outside the viewBox it declares', () => {
    const matrix = qrMatrix('https://example.com/app');
    const size = qrViewBoxSize(matrix, 2);
    assert.equal(size, matrix.count + 4);
    for (const [, x, y] of qrSvgPath(matrix, 2).matchAll(/M(\d+) (\d+)h/g)) {
      assert.ok(Number(x) >= 2 && Number(y) >= 2, 'must clear the quiet zone');
      assert.ok(Number(x) < size - 2 && Number(y) < size - 2, 'must stay inside the matrix');
    }
  });

  it('leaves a quiet zone, without which most scanners refuse to read', () => {
    const path = qrSvgPath(qrMatrix('https://example.com/app'), 4);
    assert.match(path, /^M4 4h/, 'the first dark module is the finder at the quiet-zone offset');
  });
});

/**
 * The end-to-end check: does a phone actually read what we drew?
 *
 * Every test above verifies structure -- the right module count, the finder
 * patterns present, the path covering the dark modules. All of that can be
 * true of a code that no scanner will read, because the failure modes that
 * matter (an inverted matrix, a transposed row/column, a missing quiet zone,
 * an off-by-one in the run merge) each preserve structure while destroying
 * meaning. So this rasterises the SVG path THIS module emits -- not the
 * library's matrix -- and puts a real decoder on it.
 */
describe('the rendered path, decoded', () => {
  const QUIET = 4;
  const SCALE = 4;

  /** Replays `qrSvgPath`'s own output into a bitmap, exactly as an SVG would. */
  function rasterize(path: string, size: number): Uint8ClampedArray {
    const side = size * SCALE;
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
    for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
      for (let row = 0; row < SCALE; row += 1) {
        for (let column = 0; column < Number(width) * SCALE; column += 1) {
          const px = Number(x) * SCALE + column;
          const py = Number(y) * SCALE + row;
          const offset = (py * side + px) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
    return pixels;
  }

  async function decode(text: string): Promise<string | null> {
    const { default: jsQR } = await import('jsqr');
    const matrix = qrMatrix(text, 'M');
    const size = qrViewBoxSize(matrix, QUIET);
    const pixels = rasterize(qrSvgPath(matrix, QUIET), size);
    return jsQR(pixels, size * SCALE, size * SCALE)?.data ?? null;
  }

  it('round-trips the URL a wall panel would carry', async () => {
    const url = 'https://coffeestoryco.com';
    assert.equal(await decode(url), url);
  });

  it('round-trips a longer link with a path and query', async () => {
    const url = 'https://example.com/get-the-app?location=downtown&utm_source=board';
    assert.equal(await decode(url), url);
  });

  it('round-trips a punycoded host, which is what URL() hands us', async () => {
    const url = new URL('https://café.example/ünicode').toString();
    assert.equal(await decode(url), url);
  });
});
