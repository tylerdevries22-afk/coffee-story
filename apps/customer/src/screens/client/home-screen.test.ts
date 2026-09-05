import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const home = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-screen.tsx'), 'utf8');
const content = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-content.ts'), 'utf8');

test('home hero is a three-story paged media carousel', () => {
  assert.match(home, /const HERO_SLIDES = \['opening', 'packages', 'gifting'\] as const/);
  assert.match(home, /<Animated\.ScrollView/);
  assert.match(home, /pagingEnabled/);
  assert.match(home, /onMomentumScrollEnd/);
});

test('both retail and project tenants have complete package stories', () => {
  for (const name of [
    'The Daily Ritual', 'Latte Lover', 'Boba Week', 'The Sweet Pair',
    'Project Consultation', 'Preconstruction Plan', 'Kitchen Renovation', 'Bathroom Renovation',
  ]) {
    assert.match(content, new RegExp(name));
  }
  assert.match(home, /HOME_PACKAGES\.map/);
});

test('hero media bleeds into the status bar and parallax respects reduced motion', () => {
  assert.match(home, /marginTop: -insets\.top/);
  assert.match(home, /translateX: reducedMotion \? 0 : parallax/);
  assert.match(home, /contentInsetAdjustmentBehavior="never"/);
});

test('primary action pill keeps tenant-aware detail and a live pulse', () => {
  assert.match(home, /BookNowPill/);
  assert.match(home, /ACTION_DETAIL/);
  assert.match(home, /PulseDot/);
  assert.match(home, /Animated\.loop/);
});
