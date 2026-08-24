import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { STEP_ROUTES, stepSpine } from './step-flow';

const APP_DIR = join(__dirname, '..', 'app');

/** Every .tsx under src/app, as the URL expo-router will serve it at. */
function routeFiles(dir: string, prefix = ''): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // A (group) does not appear in the URL.
      const segment = entry.startsWith('(') && entry.endsWith(')') ? prefix : `${prefix}/${entry}`;
      routes.push(...routeFiles(full, segment));
      continue;
    }
    if (!entry.endsWith('.tsx')) continue;
    const name = entry.replace(/\.tsx$/, '');
    if (name === '_layout' || name.startsWith('+')) continue;
    routes.push(name === 'index' ? prefix || '/' : `${prefix}/${name}`);
  }
  return routes;
}

describe('every step can actually be navigated to', () => {
  /**
   * The `as never` cast at the router call site is what stops typedRoutes
   * catching this, and the symptom is not an error -- it is a guest tapping a
   * tile and landing on a dead end. Fourteen of fifteen routes had no screen
   * when this test was written.
   */
  it('has a screen file for every route in STEP_ROUTES', () => {
    const onDisk = new Set(routeFiles(APP_DIR));
    const missing = Object.entries(STEP_ROUTES)
      .filter(([, route]) => !onDisk.has(route))
      .map(([step, route]) => `${step} -> ${route}`);
    assert.deepEqual(missing, [], `steps with no screen file:\n  ${missing.join('\n  ')}`);
  });

  it('routes every step both spines can reach', () => {
    const steps = new Set([...stepSpine('item'), ...stepSpine('pack')]);
    for (const step of steps) {
      assert.ok(STEP_ROUTES[step], `${step} has no route`);
    }
  });

  it('still has the attract screen and a themed dead end', () => {
    const onDisk = new Set(routeFiles(APP_DIR));
    assert.ok(onDisk.has('/'), 'the attract screen is what the kiosk shows most of its life');
    assert.ok(
      readdirSync(APP_DIR).includes('+not-found.tsx'),
      'without this a stray route shows expo-router dev screen on a lobby device',
    );
  });
});
