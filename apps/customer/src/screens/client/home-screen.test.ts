import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const homeFiles = [
  'home-screen.tsx',
  'home-hero.tsx',
  'home-hero-controls.tsx',
  'home-screen.styles.ts',
];
const home = homeFiles
  .map((file) => readFileSync(join(process.cwd(), 'src', 'screens', 'client', file), 'utf8'))
  .join('\n');
const content = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-content.ts'), 'utf8');
// The per-vertical package names moved here when the two-way industry flag
// became a three-pack lookup; home-content.ts is now only the selector.
const packs = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-industry-copy.ts'), 'utf8');

test('home hero is a three-story paged media carousel', () => {
  assert.match(home, /const HERO_SLIDES = \['opening', 'packages', 'gifting'\] as const/);
  assert.match(home, /<Animated\.ScrollView/);
  assert.match(home, /pagingEnabled/);
  assert.match(home, /onMomentumScrollEnd/);
});

test('each vertical keeps a complete package story, and neither is the default', () => {
  for (const name of [
    'The Daily Ritual', 'Latte Lover', 'Boba Week', 'The Sweet Pair',
    'Project Consultation', 'Preconstruction Plan', 'Kitchen Renovation', 'Bathroom Renovation',
  ]) {
    assert.match(packs, new RegExp(name));
  }
  assert.match(home, /HOME_PACKAGES\.map/);
  // The selector must not carry a vertical's wording itself: that is how a
  // tenant belonging to no vertical ended up with the coffee branch.
  assert.doesNotMatch(content, /Latte|Boba|caf[e\u00e9]|Renovation/i);
  assert.match(content, /homeIndustryPack/);
});

test('hero media bleeds into the status bar and parallax respects reduced motion', () => {
  assert.match(home, /insetTop=\{insets\.top\}/);
  assert.match(home, /marginTop: -insetTop/);
  assert.match(home, /translateX: reducedMotion \? 0 : parallax/);
  assert.match(home, /contentInsetAdjustmentBehavior="never"/);
});

test('primary action pill keeps tenant-aware detail and a live pulse', () => {
  assert.match(home, /BookNowPill/);
  assert.match(home, /ACTION_DETAIL/);
  assert.match(home, /PulseDot/);
  assert.match(home, /Animated\.loop/);
});
