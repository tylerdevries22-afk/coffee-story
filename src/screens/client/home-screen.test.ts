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

test('next opening reserves compact copy and action columns', () => {
  assert.match(home, /nextOpeningCopy: \{ flex: 1, minWidth: 0 \}/);
  assert.match(home, /adjustsFontSizeToFit/);
  assert.match(home, /nextOpeningCta: \{[\s\S]*width: 112/);
});
