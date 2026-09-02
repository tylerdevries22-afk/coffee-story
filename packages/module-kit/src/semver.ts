/**
 * Just enough semver for module versions.
 *
 * Module versions are release-managed: the platform publishes them, tenants
 * pin them, and nobody ranges over prereleases. So this accepts exactly
 * `x.y.z` and ranges of exactly `^x.y.z`, and refuses everything else --
 * a build-metadata edge case is not worth a comparison bug in the code that
 * decides which capabilities a tenant gets.
 */

export type SemVer = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RANGE = /^\^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemVer(text: string): SemVer | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** Negative, zero, or positive, the way sort comparators expect. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

/**
 * Whether `version` satisfies `range`: an exact `x.y.z` match, or caret
 * semantics -- same major, at least the given minor.patch. Major 0 keeps
 * caret narrow (same minor, at least the patch): with 0.x every minor is
 * allowed to break, so the range may not pretend otherwise.
 */
export function satisfiesRange(version: SemVer, range: string): boolean {
  const floor = RANGE.exec(range);
  if (!floor) {
    const exact = parseSemVer(range);
    return exact !== null && compareSemVer(version, exact) === 0;
  }
  const [, major, minor, patch] = floor;
  const base = { major: Number(major), minor: Number(minor), patch: Number(patch) };
  if (compareSemVer(version, base) < 0) return false;
  if (base.major > 0) return version.major === base.major;
  return version.major === 0 && version.minor === base.minor;
}
