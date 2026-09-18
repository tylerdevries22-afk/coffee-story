/**
 * robots.txt, read the way RFC 9309 says a crawler must.
 *
 * The demo builder reads a business's site once, a handful of pages, and it
 * still honours what the site asks: the group naming its own product token
 * wins, `*` applies otherwise, and within a group the longest matching rule
 * decides, with Allow winning a tie. Patterns support `*` and a trailing `$`.
 * Matching is a small wildcard walk rather than a generated regular
 * expression, so a hostile file cannot make a pattern that backtracks forever.
 */
export type RobotsRules = {
  readonly allow: readonly string[];
  readonly disallow: readonly string[];
};

export const ALLOW_ALL: RobotsRules = { allow: [], disallow: [] };
export const DISALLOW_ALL: RobotsRules = { allow: [], disallow: ['/'] };

const MAX_RULES = 500;
const MAX_PATTERN = 256;

type Group = { agents: string[]; allow: string[]; disallow: string[] };

/** The rules that apply to `productToken`, from the text of a robots.txt. */
export function parseRobots(text: string, productToken: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  let rules = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === null || (key !== 'allow' && key !== 'disallow')) continue;
    // An empty Disallow allows everything, so it adds no rule at all.
    if (value === '' || value.length > MAX_PATTERN || rules >= MAX_RULES) continue;
    (key === 'allow' ? current.allow : current.disallow).push(value);
    rules += 1;
  }
  const token = productToken.toLowerCase();
  const named = groups.filter((group) => group.agents.some((agent) => agent.split('/')[0]?.trim() === token));
  const chosen = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  return {
    allow: chosen.flatMap((group) => group.allow),
    disallow: chosen.flatMap((group) => group.disallow),
  };
}

/** Whether `pattern` (with `*` and an optional trailing `$`) matches the start of `path`. */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  let p = 0;
  let s = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (s < path.length) {
    if (p < body.length && body[p] === '*') {
      starAt = p;
      resumeAt = s;
      p += 1;
    } else if (p < body.length && body[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (p === body.length && !anchored) {
      return true;
    } else if (starAt >= 0) {
      p = starAt + 1;
      resumeAt += 1;
      s = resumeAt;
    } else {
      return false;
    }
  }
  while (p < body.length && body[p] === '*') p += 1;
  return p === body.length;
}

/** Whether the rules let this crawler fetch `path` (path plus query). */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (patterns: readonly string[]): number => patterns
    .filter((pattern) => robotsPatternMatches(pattern, path))
    .reduce((best, pattern) => Math.max(best, pattern.length), -1);
  const disallowed = longest(rules.disallow);
  if (disallowed < 0) return true;
  return longest(rules.allow) >= disallowed;
}
