import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const home = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-screen.tsx'), 'utf8');

test('home hero is a three-story paged media carousel', () => {
  assert.match(home, /const HERO_SLIDES = \['opening', 'packages', 'gifting'\] as const/);
  assert.match(home, /<Animated\.ScrollView/);
  assert.match(home, /pagingEnabled/);
  assert.match(home, /onMomentumScrollEnd/);
});

test('every package is present on the package story', () => {
  for (const name of ['The Daily Ritual', 'Latte Lover', 'Boba Week', 'The Sweet Pair']) {
    assert.match(home, new RegExp(name));
  }
  assert.match(home, /HOME_PACKAGES\.map/);
});

test('hero media bleeds into the status bar and parallax respects reduced motion', () => {
  assert.match(home, /marginTop: -insets\.top/);
  assert.match(home, /translateX: reducedMotion \? 0 : parallax/);
  assert.match(home, /contentInsetAdjustmentBehavior="never"/);
});

test('book now pill keeps a compact wait-time and live pulse', () => {
  assert.match(home, /BookNowPill/);
  assert.match(home, /~ 3 min/);
  assert.match(home, /PulseDot/);
  assert.match(home, /Animated\.loop/);
});
