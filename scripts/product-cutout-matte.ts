import type { ProductCutoutMatte } from '@platform/ui/src/product-cutout';

import { alphaBox, round, type Raw } from './product-cutout-raster.js';

/**
 * The failures background removal produces, which no colour band can see.
 *
 * `subjectMass` is a flood fill from the largest opaque seed: leftover confetti
 * from the source background shows up as alpha mass outside it. `softEdge` is
 * the share of non-transparent pixels that are partial -- a hard-thresholded
 * mask lands near zero, and it reads jagged at 3x where nobody catches it at
 * thumbnail size.
 */
export function measureMatte(raw: Raw): ProductCutoutMatte {
  const { width, height, data } = raw;
  const alphaAt = (i: number) => data[i * 4 + 3] ?? 0;

  let partial = 0;
  let opaque = 0;
  let totalMass = 0;
  let seed = -1;
  for (let i = 0; i < width * height; i++) {
    const a = alphaAt(i);
    if (a === 0) continue;
    totalMass += a;
    if (a === 255) {
      opaque++;
      if (seed < 0) seed = i;
    } else {
      partial++;
    }
  }

  // Flood fill the connected region the subject occupies.
  let connectedMass = 0;
  if (seed >= 0) {
    const seen = new Uint8Array(width * height);
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      connectedMass += alphaAt(i);
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || seen[n] === 1 || alphaAt(n) === 0) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }

  // "rim" and "inner" have to be a spatial measurement of the SIDE WALLS
  // specifically, not distance from background in general. Two earlier
  // versions of this got that wrong in opposite ways:
  //
  //   - a global alpha-band split (any partial-alpha pixel vs any opaque
  //     pixel) picked up an ice cube's translucent facet deep inside the
  //     drink, or the glass rim's own highlight, and counted them as if they
  //     were edge antialiasing -- so every dark-liquid drink (chai, London
  //     fog, ube) false-flagged, because a bright rim-and-ice zone will
  //     always beat a mid-tone liquid body, independent of matte quality.
  //   - a multi-source BFS distance from ANY background pixel "fixed" that,
  //     but a tall glass is open to background both above the rim and below
  //     the base, so most of its close-to-background pixels are still in the
  //     rim/ice/base zones -- the same failure at one remove.
  //
  // A real halo is a light fringe hugging the glass's actual vertical walls,
  // for the height of the walls, independent of what is happening at the top
  // or bottom. So this measures row by row, restricted to the vertical
  // middle band of the subject (excluding the rim/ice zone above and the
  // base/reflection zone below): for each row, a thin band hugging the left
  // and right silhouette edges is "rim", and the row's own centre band is
  // "inner" -- the same liquid, at the same height, so nothing about drink
  // colour can bias the comparison.
  const bbox = alphaBox(raw);
  const bandTop = bbox.top + Math.round(bbox.height * 0.22);
  const bandBottom = bbox.top + Math.round(bbox.height * 0.85);
  const EDGE_BAND = 3; // px hugging each silhouette edge, per row
  let rim = 0, rimN = 0, inner = 0, innerN = 0;
  for (let y = bandTop; y <= bandBottom; y++) {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (alphaAt(y * width + x) > 8) { if (left < 0) left = x; right = x; }
    }
    if (left < 0 || right - left < EDGE_BAND * 4) continue; // too narrow a row to measure meaningfully
    const lumAt = (x: number) => {
      const i = (y * width + x) * 4;
      return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    };
    for (let x = left; x < left + EDGE_BAND; x++) { rim += lumAt(x); rimN++; }
    for (let x = right - EDGE_BAND + 1; x <= right; x++) { rim += lumAt(x); rimN++; }
    const innerLeft = left + Math.round((right - left) * 0.3);
    const innerRight = left + Math.round((right - left) * 0.7);
    for (let x = innerLeft; x <= innerRight; x++) { inner += lumAt(x); innerN++; }
  }

  return {
    subjectMass: round(totalMass === 0 ? 0 : connectedMass / totalMass, 4),
    softEdge: round(partial + opaque === 0 ? 0 : partial / (partial + opaque), 4),
    rimLuminance: round(rimN === 0 ? 0 : rim / rimN, 1),
    innerLuminance: round(innerN === 0 ? 0 : inner / innerN, 1),
  };
}

/**
 * Bleed the edge colour outward, then zero everything beyond it.
 *
 * A nearest-opaque dilation of RGB only -- alpha is never touched. Without it a
 * bilinear sampler on the client mixes whatever the removal tool happened to
 * leave under the transparency into the rim; with it, the file is also
 * deterministic, which is what makes the manifest hash a real gate.
 */
export function bleedUnderAlpha(raw: Raw, radius: number): Buffer {
  const { width, height, data } = raw;
  const out = Buffer.from(data);
  let frontier: number[] = [];
  const filled = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    if ((data[i * 4 + 3] ?? 0) > 0) {
      filled[i] = 1;
      frontier.push(i);
    } else {
      out[i * 4] = 0;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
    }
  }

  for (let step = 0; step < radius; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || filled[n] === 1) continue;
        filled[n] = 1;
        out[n * 4] = out[i * 4] ?? 0;
        out[n * 4 + 1] = out[i * 4 + 1] ?? 0;
        out[n * 4 + 2] = out[i * 4 + 2] ?? 0;
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return out;
}
