import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { assertAndroidConfig } from '../../../scripts/assert-android-config.ts';

/**
 * docs/franchise-readiness/tasks.yaml MOB-01: Android was fully configured in
 * all three native apps -- package names, permissions, adaptive icons, config
 * plugins -- and never bundled anywhere in CI. `verify.yml`'s bundling loop
 * only ran `ios web`, `simulators.yml` is iOS-only, and nothing ever rendered
 * a config plugin's Android output at all. A franchisee's Android tablet was
 * the first thing to find a broken import, asset path, or manifest defect.
 *
 * This does not claim the gap is closed. `expo export` bundles JavaScript
 * and never touches native config; catching a real Gradle-only failure needs
 * an actual `gradlew assembleRelease` or EAS build, and nothing in this
 * repository's CI runs one. What these assertions pin down is only the two
 * things that changed: every guest app now bundles for Android in the same
 * gate as iOS and web, and its config-plugin-resolved manifest (package,
 * permissions) is rendered and checked, both in CI and in each app's own
 * `verify` script.
 */
const ROOT = join(process.cwd(), '..', '..');
const verify = readFileSync(join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');

function packageVerifyScript(app: string): string {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'apps', app, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const script = manifest.scripts?.verify;
  assert.ok(script, `apps/${app}/package.json has no verify script`);
  return script;
}

describe('Android joins the guest-app bundling gate (MOB-01)', () => {
  it('bundles customer and kiosk for Android alongside iOS and web', () => {
    const step = /Bundle both tenant guest apps[\s\S]*?for platform in ([a-z ]+); do/.exec(verify);
    assert.ok(step, 'could not find the tenant guest app bundling step');
    const platforms = step[1]?.trim().split(/\s+/) ?? [];
    assert.deepEqual(platforms.sort(), ['android', 'ios', 'web']);
  });

  it('bundles the operator app for Android alongside iOS', () => {
    const step = /Bundle the operator app[\s\S]*?working-directory: apps\/operator[\s\S]*?run: \|([\s\S]*?)\n\n/.exec(verify);
    assert.ok(step, 'could not find the operator bundling step');
    assert.match(step[1] ?? '', /expo export --platform ios/);
    assert.match(step[1] ?? '', /expo export --platform android/);
  });

  it('renders and asserts every app\'s Android manifest config via introspection', () => {
    assert.match(verify, /expo config\s*\\\s*\n\s*--type introspect --json/);
    assert.match(verify, /assert-android-config\.ts --label "\$app\/\$tenant"/);
    assert.match(verify, /--filter @platform\/operator exec expo config[\s\S]*?assert-android-config\.ts --label operator/);
    // The introspection step must cover the same two tenants the bundling
    // step does, not just whichever one happens to be the CI default.
    assert.match(verify, /Render each app's Android manifest config[\s\S]*?for tenant in coffee-story stillpoint-builders/);
  });

  it('keeps each guest app\'s own verify script exporting Android, not just iOS', () => {
    for (const app of ['customer', 'kiosk', 'operator']) {
      const script = packageVerifyScript(app);
      assert.match(script, /expo export --platform ios/, `apps/${app} verify no longer exports iOS`);
      assert.match(script, /expo export --platform android/, `apps/${app} verify does not export Android`);
    }
  });
});

describe('assertAndroidConfig (the introspection gate\'s own logic)', () => {
  it('accepts a resolved package name and permission arrays', () => {
    assert.doesNotThrow(() => assertAndroidConfig(
      JSON.stringify({ android: { package: 'com.example.app', permissions: ['android.permission.INTERNET'] } }),
      'ok',
    ));
  });

  it('rejects a missing or malformed package name', () => {
    assert.throws(() => assertAndroidConfig(JSON.stringify({ android: {} }), 'x'), /package name/);
    assert.throws(
      () => assertAndroidConfig(JSON.stringify({ android: { package: 'not a package!' } }), 'x'),
      /package name/,
    );
  });

  it('rejects permissions or blockedPermissions that are not string arrays', () => {
    assert.throws(
      () => assertAndroidConfig(
        JSON.stringify({ android: { package: 'com.example.app', permissions: 'oops' } }),
        'x',
      ),
      /permissions/,
    );
  });

  it('rejects a response with no android section and invalid JSON alike', () => {
    assert.throws(() => assertAndroidConfig(JSON.stringify({}), 'x'), /no android section/);
    assert.throws(() => assertAndroidConfig('not json', 'x'), /valid JSON/);
  });
});
