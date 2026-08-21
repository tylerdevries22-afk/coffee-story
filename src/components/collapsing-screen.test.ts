import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SRC = join(process.cwd(), 'src');
const source = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

test('CollapsingScreen pins the shared header and tracks scroll position', () => {
  const shell = source('components', 'collapsing-screen.tsx');
  assert.match(shell, /stickyHeaderIndices=\{\[0\]\}/);
  assert.match(shell, /paddingTop: 0/);
  assert.match(shell, /scrollY\.setValue\(event\.nativeEvent\.contentOffset\.y\)/);
  assert.match(shell, /<CollapsingPageHeader/);
  assert.match(shell, /onBack=\{onBack\}/);
});

test('shared headers support edge-to-edge pages and screen-centered compact titles', () => {
  const header = source('components', 'collapsing-page-header.tsx');
  const gifts = source('components', 'gift', 'gift-shelves.tsx');
  assert.match(header, /flush && styles\.containerFlush/);
  assert.match(header, /minimumFontScale=\{0\.72\}\s+numberOfLines=\{2\}/);
  assert.match(header, /left: 0/);
  assert.match(header, /textAlign: 'center'/);
  assert.match(gifts, /scrollY=\{scrollY\}\s+flush/);
});

test('the order flow uses one continuous page and header surface', () => {
  const order = source('screens', 'client', 'order-screen.tsx');
  assert.match(order, /headerBackgroundColor=\{colors\.brand200\}/);
  assert.match(order, /headerBorderColor=\{colors\.brand200\}/);
});

test('navigable client pages use the sticky header contract', () => {
  const files = [
    ['screens', 'client', 'more', 'account-pages.tsx'],
    ['screens', 'client', 'more', 'information-page.tsx'],
    ['screens', 'client', 'more', 'profile-and-intake.tsx'],
    ['screens', 'client', 'more', 'visits.tsx'],
    ['screens', 'client', 'gift-screen.tsx'],
    ['screens', 'client', 'order-screen.tsx'],
    ['screens', 'notifications-screen.tsx'],
  ];
  for (const file of files) {
    assert.match(source(...file), /<CollapsingScreen/, `${file.join('/')} bypasses CollapsingScreen`);
  }
});

test('persona navigation waits for role state before replacing shells', () => {
  const appState = source('state', 'app-context.tsx');
  assert.match(appState, /modeOverride\.role !== role/);
  assert.match(appState, /pathname\.startsWith\('\/staff'\)/);
  assert.match(appState, /staffTabHref\('more'\) : clientMoreHref\('menu'\)/);
});
