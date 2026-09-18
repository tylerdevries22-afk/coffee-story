/**
 * The originality gate: refuses a generated demo pack that names anyone on
 * DEMO_ORIGINALITY_DENYLIST, matched as a whole word rather than a
 * substring -- .claude/skills/audit-originality/SKILL.md explains why a
 * substring match fails forever on a coincidence. Names live only in that
 * environment variable and must never be spelled out here, in a comment, a
 * test, or anywhere else in this repository.
 *
 * The factory is fail-closed on this the same way it already is on a
 * missing Places key or builder name: apps/hq/lib/demo-factory/console-data.ts
 * reports the gate unready while the list is unset or empty, and both the
 * kill switch (app/(console)/demos/actions.ts) and the scheduled run
 * (app/api/jobs/demos/route.ts) refuse to work while it is unready.
 */
import { packTextFields, type OriginalityPack } from './originality-scan';

export type OriginalityFieldHit = { readonly field: string; readonly count: number };
export type OriginalityCheck = { readonly hit: boolean; readonly fields: readonly OriginalityFieldHit[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Newline- or comma-separated names, trimmed, with blanks dropped. */
export function parseOriginalityDenylist(raw: string | undefined): readonly string[] {
  return (raw ?? '').split(/[\n,]+/).map((name) => name.trim()).filter((name) => name.length > 0);
}

export function originalityDenylistFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  return parseOriginalityDenylist(env.DEMO_ORIGINALITY_DENYLIST);
}

/** Whether the gate has names to check against. The factory stays off without this, same as no Places key. */
export function originalityGateReady(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return originalityDenylistFromEnv(env).length > 0;
}

/**
 * One matcher per name: case-insensitive, on Unicode word boundaries rather
 * than a substring, so a name cannot match inside a longer word but still
 * matches next to punctuation or at either end of a field. `iu` -- `i` for
 * case, `u` so `\p{L}`/`\p{N}` and the lookarounds read Unicode letters and
 * digits rather than only ASCII ones. `g` so one pattern counts every
 * occurrence in a field instead of only the first.
 */
function matcher(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');
}

function hitCount(text: string, denylist: readonly string[]): number {
  let count = 0;
  for (const name of denylist) count += text.match(matcher(name))?.length ?? 0;
  return count;
}

/**
 * Every text field of an assembled pack against the denylist. Never returns
 * the matched text, only which field hit and how many times -- enough for
 * someone to go looking, without this function becoming a second place a
 * name could leak from into a log.
 *
 * An empty denylist never hits, by construction: the factory's kill switch
 * (see the header) is what refuses to run at all in that case, so this
 * function does not need to fail closed on its own.
 */
export function checkPackOriginality(
  businessName: string,
  pack: OriginalityPack,
  denylist: readonly string[],
): OriginalityCheck {
  if (denylist.length === 0) return { hit: false, fields: [] };
  const fields: OriginalityFieldHit[] = [];
  for (const { field, text } of packTextFields(businessName, pack)) {
    const count = hitCount(text, denylist);
    if (count > 0) fields.push({ field, count });
  }
  return { hit: fields.length > 0, fields };
}
