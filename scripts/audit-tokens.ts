/**
 * Rule 4 as a gate, not a habit.
 *
 * "No component hard-codes a color" is the rule the whole white-label promise
 * rests on: a tenant hydrates its palette and every surface follows. It is also
 * the rule that decays silently. Nothing breaks when a screen ships a literal
 * `#F1F0EE` -- it looks right, for the one brand it was picked against, and the
 * cost lands on the second franchisee months later when their screens come up
 * wearing somebody else's beige.
 *
 * So it is checked. Colour literals are legal in exactly two kinds of place:
 * where a colour is being *defined* (the default token palette, a tenant
 * fixture, a third party's own mark) and where it is a CSS custom-property
 * fallback, which by construction only renders when the tenant's value is
 * absent. Everywhere else a literal is a bug, and this exits non-zero.
 *
 * Adding a file to ALLOWED is a deliberate act that needs a reason written
 * beside it, which is the point: the allowlist is the conversation.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * A hex literal, or a functional colour that is not a neutral scrim.
 *
 * `rgba(255,255,255,0.3)` over a photograph is a lighting effect -- a highlight
 * on glass, a gradient falling off, a scrim holding type legible over an image.
 * It carries no brand and no tenant would ever want to override it, so treating
 * it as a rule 4 violation would flood this gate with noise and teach everyone
 * to ignore it. Pure white and pure black at any alpha are therefore fine.
 *
 * Anything chromatic is not: `rgba(36,23,16,0.38)` is this brand's espresso
 * brown spelled out in decimal, and the next tenant does not have it.
 */
const HEX = /#([0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?)\b/g;
const FUNCTIONAL = /\b(?:rgba?|hsla?)\(([^)]*)\)/g;

/**
 * Pure black and pure white are lighting, not brand.
 *
 * A scrim, a letterbox, a highlight over a photograph: those are the same
 * value for every tenant, and forcing them through a token would invent a
 * brand decision nobody made. Judged identically whether written `#000`,
 * `#000000` or `rgba(0,0,0,.4)` -- the notation is not the question.
 */
function neutralHex(digits: string): boolean {
  const solid = digits.length <= 4
    ? [...digits.slice(0, 3)].map((digit) => digit + digit).join('')
    : digits.slice(0, 6);
  return solid.length === 6 && /^(?:0{6}|f{6})$/i.test(solid);
}

function chromatic(line: string): boolean {
  for (const match of line.matchAll(HEX)) {
    if (!neutralHex(match[1] ?? '')) return true;
  }
  for (const match of line.matchAll(FUNCTIONAL)) {
    const parts = (match[1] ?? '').split(/[,\s/]+/).filter(Boolean).slice(0, 3);
    if (parts.length < 3) return true;
    const channels = parts.map(Number);
    if (channels.some(Number.isNaN)) return true;
    const neutral = channels.every((c) => c === 0) || channels.every((c) => c === 255);
    if (!neutral) return true;
  }
  return false;
}

/**
 * Files where a colour literal is the subject, not a shortcut.
 *
 * Each entry is a claim that this file *defines* colour rather than consuming
 * it. If that stops being true the entry should go, not grow.
 */
const ALLOWED = new Map<string, string>([
  ['packages/ui/src/tokens.ts', 'the default palette itself: the thing tenants override'],
  ['packages/ui/src/app-tokens.ts', 'derives the legacy palette from tokens; the Siri gradient is platform identity, not tenant brand'],
  ['apps/hq/lib/brand-config.ts', 'the default brand a new tenant starts from before they pick anything'],
  ['apps/hq/components/brand-config-editor.tsx', 'the editor whose subject is colour; literals are neutral fallbacks for invalid tenant input'],
  ['packages/integrations/src/catalog.ts', "other companies' official marks -- Square, Stripe, Slack -- which are theirs, not ours to theme"],
  ['apps/display/lib/demo-board.ts', 'a fixture brand, playing the part of tenant data'],
  ['apps/customer/app.config.ts', 'Expo build-time splash: reads brand.tokens first, literal only as the last resort'],
  ['apps/kiosk/app.config.ts', 'as apps/customer/app.config.ts'],
  ['apps/customer/src/components/rewards/glass-cup.tsx', 'the vessel drawing itself: glass is refraction, not brand, and its palettes file is allowed for the same reason'],
  ['apps/operator/src/components/preview-role-picker.tsx', "Apple's system fill for a segmented well -- a platform control's own grey, which no tenant owns"],
  ['apps/customer/src/components/rewards/glass-cup-palettes.ts', 'decorative liquid inside the glass vessel; documented in the file as deliberately outside the token set'],
  ['packages/domain/src/training-artwork.ts', 'generates art written to immutable, content-addressed Storage keys, so it cannot vary by tenant'],
  ['apps/display/app/layout.tsx', 'browser chrome themeColor for a board that is always letterboxed black'],
]);

type Violation = { file: string; line: number; text: string };

function tracked(...patterns: string[]): string[] {
  return execFileSync('git', ['ls-files', ...patterns], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

/**
 * A CSS literal is fine when it is a custom-property fallback.
 *
 * `var(--board-accent, #8a7350)` renders the literal only when the tenant set
 * nothing, which is the same bargain the token defaults make. A bare literal
 * is not, because no tenant value can ever reach it.
 */
function cssViolations(file: string): Violation[] {
  const out: Violation[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const stripped = line.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var(--x)');
    if (chromatic(stripped)) out.push({ file, line: index + 1, text: line.trim() });
  });
  return out;
}

function sourceViolations(file: string): Violation[] {
  const out: Violation[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    // Prose is not a palette: "#4285F4" in a sentence explaining why a colour
    // moved is exactly the documentation this rule wants people to write.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (/^\s*\*/.test(line)) return;
    if (chromatic(code)) out.push({ file, line: index + 1, text: line.trim() });
  });
  return out;
}

const violations: Violation[] = [];
for (const file of tracked('apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx')) {
  // Tests are where literals belong: asserting that a resolver returns the
  // brand's own green *requires* naming a green. Excluding them is not a hole,
  // it is the difference between checking shipped surfaces and checking proofs.
  if (ALLOWED.has(file) || /\.test\.tsx?$/.test(file)) continue;
  violations.push(...sourceViolations(file));
}
for (const file of tracked('apps/**/*.css', 'packages/**/*.css')) {
  violations.push(...cssViolations(file));
}

if (violations.length === 0) {
  console.log(`rule 4: no colour literals outside ${ALLOWED.size} declared definition sites`);
  process.exit(0);
}

console.error(`rule 4: ${violations.length} colour literal(s) outside the declared definition sites\n`);
for (const { file, line, text } of violations) {
  console.error(`  ${file}:${line}\n    ${text.slice(0, 120)}`);
}
console.error(
  '\nRead the colour from design tokens (useTokens / useAppTokens), or from a'
  + '\nCSS custom property with the token as its fallback. If this file genuinely'
  + '\ndefines colour rather than consuming it, add it to ALLOWED in'
  + '\nscripts/audit-tokens.ts with the reason written beside it.',
);
process.exit(1);
